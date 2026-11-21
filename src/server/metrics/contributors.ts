import type { Contributor, ContributorsResponse } from '../../shared/types.js';
import { type GitHubClient, optional } from '../github.js';
import { lastMonths, monthsBetween, toDay, toMonth } from '../util.js';

export interface RawContributorStats {
  total: number;
  author: { login: string; avatar_url: string; html_url: string } | null;
  weeks: { w: number; a: number; d: number; c: number }[];
}

interface RawContributor {
  login?: string;
  avatar_url?: string;
  html_url?: string;
  contributions: number;
  type: string;
}

export function buildContributors(
  stats: RawContributorStats[] | null,
  fallback: RawContributor[],
  total: number | null,
  now: Date = new Date(),
): ContributorsResponse {
  const cutoff = now.getTime() / 1000 - 90 * 86_400;
  const months = lastMonths(12, now);
  const newPerMonth = new Map(months.map((m) => [m, 0]));
  let activeLast90Days = 0;
  // Per month: who committed at all, and who committed for the first time.
  const activeByMonth = new Map<string, Set<string>>();
  const newByMonth = new Map<string, number>();

  let contributors: Contributor[];
  if (stats && stats.length) {
    contributors = stats
      .filter((s) => s.author)
      .map((s) => {
        const active = s.weeks.filter((w) => w.c > 0);
        const first = active[0]?.w;
        const last = active[active.length - 1]?.w;
        if (last !== undefined && last >= cutoff) activeLast90Days++;
        if (first !== undefined) {
          const month = toMonth(first * 1000);
          if (newPerMonth.has(month)) newPerMonth.set(month, newPerMonth.get(month)! + 1);
          newByMonth.set(month, (newByMonth.get(month) ?? 0) + 1);
        }
        for (const w of active) {
          const month = toMonth(w.w * 1000);
          const people = activeByMonth.get(month) ?? new Set<string>();
          people.add(s.author!.login);
          activeByMonth.set(month, people);
        }
        return {
          login: s.author!.login,
          avatarUrl: s.author!.avatar_url,
          url: s.author!.html_url,
          commits: s.total,
          additions: s.weeks.reduce((sum, w) => sum + w.a, 0),
          deletions: s.weeks.reduce((sum, w) => sum + w.d, 0),
          firstWeek: first === undefined ? null : toDay(first * 1000),
          lastWeek: last === undefined ? null : toDay(last * 1000),
          recentCommits: active.filter((w) => w.w >= cutoff).reduce((sum, w) => sum + w.c, 0),
        };
      });
  } else {
    contributors = fallback
      .filter((c) => c.login)
      .map((c) => ({
        login: c.login!,
        avatarUrl: c.avatar_url ?? '',
        url: c.html_url ?? '',
        commits: c.contributions,
        additions: 0,
        deletions: 0,
        firstWeek: null,
        lastWeek: null,
        recentCommits: 0,
      }));
  }

  contributors.sort((a, b) => b.commits - a.commits);
  const firstMonth = [...newByMonth.keys()].sort()[0];
  const history = firstMonth
    ? monthsBetween(firstMonth, toMonth(now)).map((month) => ({
        month,
        active: activeByMonth.get(month)?.size ?? 0,
        new: newByMonth.get(month) ?? 0,
      }))
    : [];
  return {
    pending: stats === null && fallback.length === 0,
    historyPending: stats === null && fallback.length > 0,
    total: total ?? contributors.length,
    contributors,
    activeLast90Days,
    newPerMonth: [...newPerMonth.entries()].map(([month, count]) => ({ month, count })),
    history,
  };
}

export async function getContributors(
  gh: GitHubClient,
  owner: string,
  repo: string,
): Promise<ContributorsResponse> {
  const base = `/repos/${owner}/${repo}`;
  const [stats, total] = await Promise.all([
    optional(gh.stats<RawContributorStats[]>(`${base}/stats/contributors`), null),
    optional(gh.count(`${base}/contributors`, { anon: 1 }), null),
  ]);
  const fallback =
    stats && stats.length
      ? []
      : await optional(gh.get<RawContributor[]>(`${base}/contributors`, { per_page: 100 }), []);
  return buildContributors(stats, fallback, total);
}
