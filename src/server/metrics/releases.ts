import type {
  DeploymentItem,
  DeploymentsResponse,
  ReleaseItem,
  ReleasesResponse,
} from '../../shared/types.js';
import { type GitHubClient, optional } from '../github.js';
import { countBy, lastDays, lastMonths, mapLimit, median, monthsBetween, toDay, toMonth } from '../util.js';

export interface RawRelease {
  id: number;
  tag_name: string;
  name: string | null;
  published_at: string | null;
  prerelease: boolean;
  draft: boolean;
  html_url: string;
  assets: { download_count: number }[];
  author?: { login: string; avatar_url: string } | null;
}

export interface RawDeployment {
  id: number;
  environment: string;
  ref: string;
  sha: string;
  created_at: string;
  creator: { login: string; avatar_url?: string } | null;
}

export interface DeploymentStatus {
  state: string | null;
  environmentUrl?: string | null;
  logUrl?: string | null;
}

/** The most deployments fetched in full. */
const MAX_DEPLOYMENT_PAGES = 3;
/** Samples covering less than this many days are charted per day… */
const DAILY_MAX_DAYS = 62;
/** …and those covering at most this many whole days, per hour. */
const HOURLY_MAX_DAYS = 3;

/** Every whole UTC hour after the one containing `since`, up to the current hour ("YYYY-MM-DDTHH"). */
export function hoursSince(since: string, now: Date = new Date()): string[] {
  const hour = 3_600_000;
  const start = Math.floor(new Date(since).getTime() / hour) * hour + hour;
  const end = Math.floor(now.getTime() / hour) * hour;
  const out: string[] = [];
  for (let t = start; t <= end; t += hour) out.push(new Date(t).toISOString().slice(0, 13));
  return out;
}

/**
 * Exact deployment totals per environment, in one GraphQL query: GitHub counts them without
 * returning the deployments themselves. Returns an empty map when the query fails.
 */
export async function getEnvironmentTotals(
  gh: GitHubClient,
  owner: string,
  repo: string,
  names: string[],
): Promise<Map<string, number>> {
  if (!names.length) return new Map();
  const fields = names
    .map((name, i) => `e${i}: deployments(environments: [${JSON.stringify(name)}]) { totalCount }`)
    .join('\n    ');
  const query = `query($owner: String!, $repo: String!) {\n  repository(owner: $owner, name: $repo) {\n    ${fields}\n  }\n}`;
  try {
    const data = await gh.graphql<{ repository: Record<string, { totalCount: number }> }>(query, {
      owner,
      repo,
    });
    return new Map(names.map((name, i) => [name, data.repository[`e${i}`]?.totalCount ?? 0]));
  } catch {
    return new Map();
  }
}

/** The most releases fetched in full; enough for the history of nearly every project. */
const MAX_PAGES = 3;

export function buildReleases(raw: RawRelease[], now: Date = new Date(), total?: number): ReleasesResponse {
  const releases: ReleaseItem[] = raw
    .filter((r) => !r.draft)
    .map((r) => ({
      id: r.id,
      tag: r.tag_name,
      name: r.name || r.tag_name,
      publishedAt: r.published_at,
      prerelease: r.prerelease,
      url: r.html_url,
      downloads: r.assets.reduce((sum, a) => sum + a.download_count, 0),
      assets: r.assets.length,
      author: r.author?.login ?? null,
      avatarUrl: r.author?.avatar_url ?? null,
    }))
    .sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''));

  const dates = releases
    .map((r) => r.publishedAt)
    .filter((d): d is string => Boolean(d))
    .map((d) => new Date(d).getTime())
    .sort((a, b) => a - b);
  const gaps = dates.slice(1).map((t, i) => (t - dates[i]!) / 86_400_000);

  const stable = countBy(
    releases.filter((r) => !r.prerelease),
    (r) => (r.publishedAt ? toMonth(r.publishedAt) : null),
  );
  const pre = countBy(
    releases.filter((r) => r.prerelease),
    (r) => (r.publishedAt ? toMonth(r.publishedAt) : null),
  );
  // From the first release on, but never fewer than the last 12 months.
  const recent = lastMonths(12, now);
  const first = [...stable.keys(), ...pre.keys()].sort()[0];
  const months = first && first < recent[0]! ? monthsBetween(first, toMonth(now)) : recent;
  return {
    total: Math.max(total ?? 0, releases.length),
    sampleSize: releases.length,
    totalDownloads: releases.reduce((sum, r) => sum + r.downloads, 0),
    medianDaysBetween: median(gaps),
    releases,
    monthly: months.map((month) => ({
      month,
      releases: stable.get(month) ?? 0,
      prereleases: pre.get(month) ?? 0,
    })),
  };
}

export function buildDeployments(
  raw: RawDeployment[],
  statuses: Map<number, DeploymentStatus>,
  now: Date = new Date(),
  total?: number,
  envTotals?: Map<string, number>,
): DeploymentsResponse {
  const recent: DeploymentItem[] = raw.map((d) => ({
    id: d.id,
    environment: d.environment,
    ref: d.ref,
    sha: d.sha.slice(0, 7),
    createdAt: d.created_at,
    state: statuses.get(d.id)?.state ?? null,
    creator: d.creator?.login ?? null,
    avatarUrl: d.creator?.avatar_url ?? null,
    logUrl: statuses.get(d.id)?.logUrl ?? null,
  }));

  const environments = new Map<string, DeploymentsResponse['environments'][number]>();
  for (const d of raw) {
    const status = statuses.get(d.id);
    const env = environments.get(d.environment);
    if (env) {
      env.deployments++;
      // The live address comes from the newest deployment that reported one.
      env.url ??= status?.environmentUrl || null;
    } else {
      // Deployments arrive newest first, so the first one seen is the latest.
      environments.set(d.environment, {
        name: d.environment,
        deployments: 1,
        lastDeployedAt: d.created_at,
        lastState: status?.state ?? null,
        url: status?.environmentUrl || null,
        total: envTotals?.get(d.environment) ?? null,
      });
    }
  }

  // Every month the sample covers, but never fewer than the last 12.
  const recentMonths = lastMonths(12, now);
  const oldest = raw.length ? toMonth(raw[raw.length - 1]!.created_at) : recentMonths[0]!;
  const months = oldest < recentMonths[0]! ? monthsBetween(oldest, toMonth(now)) : recentMonths;
  const monthly = new Map(
    months.map((month) => [month, { month, deployments: 0, byEnvironment: {} as Record<string, number> }]),
  );
  for (const d of raw) {
    const entry = monthly.get(toMonth(d.created_at));
    if (!entry) continue;
    entry.deployments++;
    entry.byEnvironment[d.environment] = (entry.byEnvironment[d.environment] ?? 0) + 1;
  }

  // A short sample (a busy repository) gets an hourly or daily view of the time it fully covers.
  // The oldest hour or day is only partly covered, so it is left out rather than shown as quiet.
  let timeline: DeploymentsResponse['timeline'] = null;
  const truncated = (total ?? 0) > raw.length;
  if (truncated && raw.length) {
    const oldest = raw[raw.length - 1]!.created_at;
    const days = lastDays(DAILY_MAX_DAYS, now).filter((day) => day > toDay(oldest));
    const hours = days.length <= HOURLY_MAX_DAYS ? hoursSince(oldest, now) : [];
    const unit = hours.length ? 'hour' : days.length && days.length < DAILY_MAX_DAYS ? 'day' : null;
    if (unit) {
      const keys = unit === 'hour' ? hours : days;
      const keyOf = (iso: string) => (unit === 'hour' ? iso.slice(0, 13) : toDay(iso));
      const buckets = new Map(
        keys.map((date) => [date, { date, deployments: 0, byEnvironment: {} as Record<string, number> }]),
      );
      for (const d of raw) {
        const entry = buckets.get(keyOf(d.created_at));
        if (!entry) continue;
        entry.deployments++;
        entry.byEnvironment[d.environment] = (entry.byEnvironment[d.environment] ?? 0) + 1;
      }
      timeline = { unit, points: [...buckets.values()] };
    }
  }

  const stateCounts = countBy(
    recent.filter((d) => d.state),
    (d) => d.state,
  );
  return {
    total: Math.max(total ?? 0, recent.length),
    sampleSize: recent.length,
    environments: [...environments.values()].sort(
      (a, b) => (b.total ?? b.deployments) - (a.total ?? a.deployments) || b.deployments - a.deployments,
    ),
    monthly: [...monthly.values()],
    timeline,
    stateCounts: [...stateCounts.entries()].map(([state, count]) => ({ state, count })),
    recent: recent.slice(0, 30),
  };
}

export async function getReleases(gh: GitHubClient, owner: string, repo: string) {
  const base = `/repos/${owner}/${repo}/releases`;
  const raw = await optional(gh.paginate<RawRelease>(base, {}, { maxPages: MAX_PAGES }), []);
  // Only a full sample can hide older releases; then ask GitHub how many there are in all.
  const total = raw.length >= MAX_PAGES * 100 ? await optional(gh.count(base), undefined) : undefined;
  return buildReleases(raw, new Date(), total);
}

export async function getDeployments(gh: GitHubClient, owner: string, repo: string) {
  const base = `/repos/${owner}/${repo}/deployments`;
  const raw = await optional(gh.paginate<RawDeployment>(base, {}, { maxPages: MAX_DEPLOYMENT_PAGES }), []);
  // Statuses cost one request each, so only the most recent deployments get one.
  const withStatus = raw.slice(0, 30);
  const statuses = new Map(
    await mapLimit(withStatus, 8, async (d) => {
      const list = await optional(
        gh.get<{ state: string; environment_url?: string; log_url?: string; target_url?: string }[]>(
          `${base}/${d.id}/statuses`,
          { per_page: 1 },
        ),
        [],
      );
      const latest = list[0];
      return [
        d.id,
        {
          state: latest?.state ?? null,
          environmentUrl: latest?.environment_url || null,
          logUrl: latest?.log_url || latest?.target_url || null,
        },
      ] as const;
    }),
  );
  // Only a full sample can hide older deployments; then ask GitHub how many there are in all.
  const total =
    raw.length >= MAX_DEPLOYMENT_PAGES * 100 ? await optional(gh.count(base), undefined) : undefined;
  const names = [...new Set(raw.map((d) => d.environment))].slice(0, 50);
  const envTotals = await getEnvironmentTotals(gh, owner, repo, names);
  return buildDeployments(raw, statuses, new Date(), total, envTotals);
}
