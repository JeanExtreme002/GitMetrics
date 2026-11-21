import type { Stargazer as StargazerInfo, StarPoint, StarsResponse } from '../../shared/types.js';
import { type GitHubClient, optional } from '../github.js';
import { lastMonths, mapLimit, monthsBetween, toDay, toMonth } from '../util.js';

const STAR_ACCEPT = 'application/vnd.github.star+json';
/** GitHub stops listing stargazers after 400 pages (40k stars). */
const MAX_PAGES = 400;
/** Up to this many pages we fetch every star; above it we sample evenly. */
const FULL_FETCH_PAGES = 30;
const SAMPLE_PAGES = 20;

interface Stargazer {
  starred_at: string;
}

/** Page numbers to sample: always the first and last page, evenly spread in between. */
export function samplePages(totalPages: number, samples = SAMPLE_PAGES): number[] {
  if (totalPages <= samples) return Array.from({ length: totalPages }, (_, i) => i + 1);
  const pages = new Set<number>();
  for (let i = 0; i < samples; i++) {
    pages.add(Math.round(1 + (i * (totalPages - 1)) / (samples - 1)));
  }
  return [...pages].sort((a, b) => a - b);
}

/** Cumulative star count at the end of each day. `offset` is the count before the first item. */
export function pointsFromPage(items: Stargazer[], offset: number): StarPoint[] {
  return items.map((item, i) => ({ date: item.starred_at, stars: offset + i + 1 }));
}

/** Collapses raw points into one point per day (keeping the highest count). */
export function dailyPoints(points: StarPoint[]): StarPoint[] {
  const byDay = new Map<string, number>();
  for (const p of points) {
    const day = toDay(p.date);
    byDay.set(day, Math.max(byDay.get(day) ?? 0, p.stars));
  }
  return [...byDay.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, stars]) => ({ date, stars }));
}

/** A daily point ("2025-03-01") holds the count at the end of that day. */
const pointTime = (date: string) => new Date(date).getTime() + (date.length === 10 ? 86_400_000 - 1 : 0);

/**
 * Cumulative stars at a given time. With every star known the count is exact (a step
 * function); with sampled pages it interpolates linearly between the samples.
 */
export function starsAt(points: StarPoint[], time: number, interpolate = true): number {
  if (points.length === 0) return 0;
  if (time < pointTime(points[0]!.date)) return 0;
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1]!;
    const next = points[i]!;
    const t0 = pointTime(prev.date);
    const t1 = pointTime(next.date);
    if (time < t1) {
      if (t1 === t0 || !interpolate) return prev.stars;
      return prev.stars + ((next.stars - prev.stars) * (time - t0)) / (t1 - t0);
    }
  }
  return points[points.length - 1]!.stars;
}

export function buildStars(
  points: StarPoint[],
  total: number,
  sampled: boolean,
  now: Date = new Date(),
  recent: StargazerInfo[] = [],
): StarsResponse {
  const daily = dailyPoints(points);
  if (daily.length && daily[daily.length - 1]!.stars < total) {
    daily.push({ date: toDay(now), stars: total });
  }

  const firstStarAt = points[0]?.date ?? null;
  const monthly: { month: string; stars: number }[] = [];
  if (firstStarAt) {
    let previous = 0;
    for (const month of monthsBetween(toMonth(firstStarAt), toMonth(now))) {
      const [y, m] = month.split('-').map(Number);
      const end = Math.min(Date.UTC(y!, m!, 1), now.getTime());
      const value = Math.round(month === toMonth(now) ? total : starsAt(daily, end, sampled));
      monthly.push({ month, stars: Math.max(0, value - previous) });
      previous = value;
    }
  }

  const since = (days: number) =>
    Math.max(0, Math.round(total - starsAt(daily, now.getTime() - days * 86_400_000, sampled)));

  const recentMonths = new Set(lastMonths(12, now));
  const lastYear = monthly.filter((m) => recentMonths.has(m.month));
  const best = monthly.reduce<{ month: string; stars: number } | null>(
    (acc, m) => (!acc || m.stars > acc.stars ? m : acc),
    null,
  );

  return {
    total,
    sampled,
    firstStarAt,
    points: daily,
    monthly,
    stats: {
      last7Days: since(7),
      last30Days: since(30),
      avgPerMonth: lastYear.length
        ? Math.round(lastYear.reduce((s, m) => s + m.stars, 0) / lastYear.length)
        : 0,
      bestMonth: best && best.stars > 0 ? best : null,
    },
    recent,
  };
}

const RECENT_QUERY = `
query ($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    stargazers(last: 30, orderBy: { field: STARRED_AT, direction: ASC }) {
      edges { starredAt node { login name avatarUrl url } }
    }
  }
}`;

interface RecentResult {
  repository: {
    stargazers: {
      edges: {
        starredAt: string;
        node: { login: string; name: string | null; avatarUrl: string; url: string };
      }[];
    };
  } | null;
}

/** The latest stargazers through GraphQL: one request, newest first, and no 40k listing limit. */
export async function getRecentStargazers(
  gh: GitHubClient,
  owner: string,
  name: string,
): Promise<StargazerInfo[]> {
  const data = await optional(gh.graphql<RecentResult>(RECENT_QUERY, { owner, name }), { repository: null });
  return (data.repository?.stargazers.edges ?? [])
    .map((e) => ({ ...e.node, starredAt: e.starredAt }))
    .reverse();
}

export async function getStars(
  gh: GitHubClient,
  owner: string,
  repo: string,
  total: number,
): Promise<StarsResponse> {
  if (total === 0) return buildStars([], 0, false);

  const path = `/repos/${owner}/${repo}/stargazers`;
  const first = await gh.request<Stargazer[]>(path, {
    query: { per_page: 100, page: 1 },
    accept: STAR_ACCEPT,
  });
  const pages = Math.min(first.lastPage, MAX_PAGES);
  const sampled = pages > FULL_FETCH_PAGES;
  const wanted = (sampled ? samplePages(pages) : samplePages(pages, pages)).filter((p) => p > 1);

  const fetched = await mapLimit(wanted, 8, async (page) => ({
    page,
    items: await gh.get<Stargazer[]>(path, { per_page: 100, page }, STAR_ACCEPT),
  }));

  const points = [{ page: 1, items: first.data }, ...fetched]
    .sort((a, b) => a.page - b.page)
    .flatMap(({ page, items }) => pointsFromPage(items, (page - 1) * 100));

  return buildStars(points, total, sampled, new Date(), await getRecentStargazers(gh, owner, repo));
}
