import type { IssueItem, IssuesResponse, PersonCount, PullItem, PullsResponse } from '../../shared/types.js';
import type { GitHubClient } from '../github.js';
import { hoursBetween, lastMonths, median, monthsBetween, toMonth } from '../util.js';

/** Pull requests and issues share most of their analysis, so they live together. */

const MAX_PAGES = 3;

interface Author {
  login: string;
  avatarUrl: string;
}

export interface RawPull {
  number: number;
  title: string;
  url: string;
  state: 'OPEN' | 'MERGED' | 'CLOSED';
  createdAt: string;
  mergedAt: string | null;
  closedAt: string | null;
  additions: number;
  deletions: number;
  isDraft: boolean;
  author: Author | null;
}

export interface RawIssue {
  number: number;
  title: string;
  url: string;
  state: 'OPEN' | 'CLOSED';
  createdAt: string;
  closedAt: string | null;
  author: Author | null;
  comments: { totalCount: number };
  labels: { nodes: { name: string; color: string }[] };
}

const PULLS_QUERY = `
query ($owner: String!, $name: String!, $cursor: String) {
  repository(owner: $owner, name: $name) {
    open: pullRequests(states: OPEN) { totalCount }
    merged: pullRequests(states: MERGED) { totalCount }
    closed: pullRequests(states: CLOSED) { totalCount }
    pullRequests(first: 100, after: $cursor, orderBy: { field: CREATED_AT, direction: DESC }) {
      pageInfo { hasNextPage endCursor }
      nodes {
        number title url state createdAt mergedAt closedAt additions deletions isDraft
        author { login avatarUrl }
      }
    }
  }
}`;

const ISSUES_QUERY = `
query ($owner: String!, $name: String!, $cursor: String) {
  repository(owner: $owner, name: $name) {
    open: issues(states: OPEN) { totalCount }
    closed: issues(states: CLOSED) { totalCount }
    issues(first: 100, after: $cursor, orderBy: { field: CREATED_AT, direction: DESC }) {
      pageInfo { hasNextPage endCursor }
      nodes {
        number title url state createdAt closedAt
        author { login avatarUrl }
        comments { totalCount }
        labels(first: 6) { nodes { name color } }
      }
    }
  }
}`;

interface Connection<T> {
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
  nodes: T[];
}

type Counts = Record<string, { totalCount: number }>;

async function collect<T>(
  gh: GitHubClient,
  query: string,
  field: 'pullRequests' | 'issues',
  owner: string,
  name: string,
): Promise<{ counts: Counts; nodes: T[] }> {
  let cursor: string | null = null;
  const nodes: T[] = [];
  let counts: Counts = {};
  for (let page = 0; page < MAX_PAGES; page++) {
    const data: { repository: Counts & Record<string, Connection<T>> } = await gh.graphql(query, {
      owner,
      name,
      cursor,
    });
    const repo = data.repository;
    counts = repo as Counts;
    const connection = repo[field] as Connection<T>;
    nodes.push(...connection.nodes);
    if (!connection.pageInfo.hasNextPage) break;
    cursor = connection.pageInfo.endCursor;
  }
  return { counts, nodes };
}

export function topAuthors(items: { author: Author | null }[], limit = 8): PersonCount[] {
  const map = new Map<string, PersonCount>();
  for (const { author } of items) {
    if (!author) continue;
    const entry = map.get(author.login) ?? { login: author.login, avatarUrl: author.avatarUrl, count: 0 };
    entry.count++;
    map.set(author.login, entry);
  }
  return [...map.values()].sort((a, b) => b.count - a.count).slice(0, limit);
}

export function sizeLabel(lines: number): string {
  if (lines < 10) return 'XS';
  if (lines < 50) return 'S';
  if (lines < 250) return 'M';
  if (lines < 1000) return 'L';
  return 'XL';
}

const toPullItem = (p: RawPull): PullItem => ({
  number: p.number,
  title: p.title,
  url: p.url,
  author: p.author?.login ?? 'ghost',
  avatarUrl: p.author?.avatarUrl ?? null,
  createdAt: p.createdAt,
  mergedAt: p.mergedAt,
  additions: p.additions,
  deletions: p.deletions,
  draft: p.isDraft,
});

export function buildPulls(
  counts: { open: number; merged: number; closed: number },
  pulls: RawPull[],
  now: Date = new Date(),
): PullsResponse {
  const months = lastMonths(12, now);
  const monthly = new Map(months.map((m) => [m, { month: m, opened: 0, merged: 0, closed: 0 }]));
  for (const p of pulls) {
    const opened = monthly.get(toMonth(p.createdAt));
    if (opened) opened.opened++;
    if (p.mergedAt) {
      const merged = monthly.get(toMonth(p.mergedAt));
      if (merged) merged.merged++;
    } else if (p.state === 'CLOSED' && p.closedAt) {
      const closed = monthly.get(toMonth(p.closedAt));
      if (closed) closed.closed++;
    }
  }

  const merged = pulls.filter((p) => p.mergedAt);
  const sizes = ['XS', 'S', 'M', 'L', 'XL'].map((size) => ({
    size,
    count: pulls.filter((p) => sizeLabel(p.additions + p.deletions) === size).length,
  }));
  const finished = counts.merged + counts.closed;

  return {
    counts,
    sampleSize: pulls.length,
    monthly: [...monthly.values()],
    medianTimeToMergeHours: median(merged.map((p) => hoursBetween(p.createdAt, p.mergedAt!))),
    mergeRate: finished ? counts.merged / finished : null,
    sizes,
    topAuthors: topAuthors(pulls, 10),
    openOldest: pulls
      .filter((p) => p.state === 'OPEN')
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .slice(0, 6)
      .map(toPullItem),
    recentMerged: merged
      .sort((a, b) => b.mergedAt!.localeCompare(a.mergedAt!))
      .slice(0, 6)
      .map(toPullItem),
  };
}

export function buildIssues(
  counts: { open: number; closed: number },
  issues: RawIssue[],
  now: Date = new Date(),
): IssuesResponse {
  const months = lastMonths(12, now);
  const monthly = new Map(months.map((m) => [m, { month: m, opened: 0, closed: 0 }]));
  const labels = new Map<string, { name: string; color: string; count: number }>();

  for (const issue of issues) {
    const opened = monthly.get(toMonth(issue.createdAt));
    if (opened) opened.opened++;
    if (issue.closedAt) {
      const closed = monthly.get(toMonth(issue.closedAt));
      if (closed) closed.closed++;
    }
    for (const label of issue.labels.nodes) {
      const entry = labels.get(label.name) ?? { ...label, count: 0 };
      entry.count++;
      labels.set(label.name, entry);
    }
  }

  const toItem = (i: RawIssue): IssueItem => ({
    number: i.number,
    title: i.title,
    url: i.url,
    author: i.author?.login ?? 'ghost',
    avatarUrl: i.author?.avatarUrl ?? null,
    createdAt: i.createdAt,
    comments: i.comments.totalCount,
    labels: i.labels.nodes,
  });

  return {
    counts,
    sampleSize: issues.length,
    monthly: [...monthly.values()],
    medianTimeToCloseHours: median(
      issues.filter((i) => i.closedAt).map((i) => hoursBetween(i.createdAt, i.closedAt!)),
    ),
    labels: [...labels.values()].sort((a, b) => b.count - a.count).slice(0, 10),
    topAuthors: topAuthors(issues, 10),
    openOldest: issues
      .filter((i) => i.state === 'OPEN')
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .slice(0, 6)
      .map(toItem),
    mostDiscussed: issues
      .filter((i) => i.state === 'OPEN' && i.comments.totalCount > 0)
      .sort((a, b) => b.comments.totalCount - a.comments.totalCount || a.createdAt.localeCompare(b.createdAt))
      .slice(0, 6)
      .map(toItem),
  };
}

/** First and last day (YYYY-MM-DD) of a YYYY-MM month. */
export function monthBounds(month: string): [string, string] {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return [`${month}-01`, `${month}-${String(last).padStart(2, '0')}`];
}

/**
 * One GraphQL query with search counts per month. Pull requests get opened, merged and closed
 * unmerged ("o", "m", "c"); issues get opened and closed ("o", "c").
 */
export function monthlySearchQuery(repo: string, months: string[], kind: 'pr' | 'issue' = 'pr'): string {
  const fields = months.flatMap((month, i) => {
    const [from, to] = monthBounds(month);
    const search = (alias: string, filters: string) =>
      `${alias}${i}: search(query: ${JSON.stringify(`repo:${repo} is:${kind} ${filters}`)}, type: ISSUE) { issueCount }`;
    return kind === 'pr'
      ? [
          search('o', `created:${from}..${to}`),
          search('m', `is:merged merged:${from}..${to}`),
          search('c', `is:closed is:unmerged closed:${from}..${to}`),
        ]
      : [search('o', `created:${from}..${to}`), search('c', `is:closed closed:${from}..${to}`)];
  });
  return `query {\n  ${fields.join('\n  ')}\n}`;
}

/** Months per GraphQL query: keeps each search batch small enough for GitHub's search limits. */
const MONTHS_PER_QUERY = 24;

export type MonthlyCounts = { month: string; opened: number; merged?: number; closed: number }[];

/**
 * Exact counts per month from GitHub search, in batches of 24 months. Pull requests get opened,
 * merged and closed unmerged; issues get opened and closed. Throws if search fails.
 */
export async function getMonthlyCounts(
  gh: GitHubClient,
  repo: string,
  kind: 'pr' | 'issue',
  months: string[],
): Promise<MonthlyCounts> {
  const result: MonthlyCounts = [];
  for (let start = 0; start < months.length; start += MONTHS_PER_QUERY) {
    const batch = months.slice(start, start + MONTHS_PER_QUERY);
    const data = await gh.graphql<Record<string, { issueCount: number }>>(
      monthlySearchQuery(repo, batch, kind),
    );
    batch.forEach((month, i) =>
      result.push({
        month,
        opened: data[`o${i}`]?.issueCount ?? 0,
        ...(kind === 'pr' ? { merged: data[`m${i}`]?.issueCount ?? 0 } : {}),
        closed: data[`c${i}`]?.issueCount ?? 0,
      }),
    );
  }
  return result;
}

/** The months a chart window covers: the last N months, or every month since the repository began. */
export function windowMonths(range: string, createdAt: string, now: Date = new Date()): string[] {
  if (range === 'all') return monthsBetween(toMonth(createdAt), toMonth(now));
  const count = Number(range);
  if (!Number.isInteger(count) || count < 1 || count > 240) throw new RangeError(`Unknown range: ${range}`);
  return lastMonths(count, now);
}

/**
 * Exact pull request counts for the last 12 months, so busy repositories are not limited to
 * the latest 300 pull requests. Returns null when search is unavailable (for example rate limited).
 */
export async function getMonthlyPullCounts(
  gh: GitHubClient,
  owner: string,
  name: string,
  now: Date = new Date(),
): Promise<PullsResponse['monthly'] | null> {
  try {
    return (await getMonthlyCounts(
      gh,
      `${owner}/${name}`,
      'pr',
      lastMonths(12, now),
    )) as PullsResponse['monthly'];
  } catch {
    return null;
  }
}

export async function getPulls(gh: GitHubClient, owner: string, name: string) {
  const [{ counts, nodes }, monthly] = await Promise.all([
    collect<RawPull>(gh, PULLS_QUERY, 'pullRequests', owner, name),
    getMonthlyPullCounts(gh, owner, name),
  ]);
  const result = buildPulls(
    {
      open: counts.open?.totalCount ?? 0,
      merged: counts.merged?.totalCount ?? 0,
      closed: counts.closed?.totalCount ?? 0,
    },
    nodes,
  );
  // Prefer the exact monthly counts; fall back to the sample-based ones if search failed.
  return monthly ? { ...result, monthly } : result;
}

/** Exact issue counts for the last 12 months; null when search is unavailable. */
export async function getMonthlyIssueCounts(
  gh: GitHubClient,
  owner: string,
  name: string,
  now: Date = new Date(),
): Promise<IssuesResponse['monthly'] | null> {
  try {
    return await getMonthlyCounts(gh, `${owner}/${name}`, 'issue', lastMonths(12, now));
  } catch {
    return null;
  }
}

export async function getIssues(gh: GitHubClient, owner: string, name: string) {
  const [{ counts, nodes }, monthly] = await Promise.all([
    collect<RawIssue>(gh, ISSUES_QUERY, 'issues', owner, name),
    getMonthlyIssueCounts(gh, owner, name),
  ]);
  const result = buildIssues(
    { open: counts.open?.totalCount ?? 0, closed: counts.closed?.totalCount ?? 0 },
    nodes,
  );
  // Prefer the exact monthly counts; fall back to the sample-based ones if search failed.
  return monthly ? { ...result, monthly } : result;
}
