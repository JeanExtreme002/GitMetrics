import type { RankingEntry, RankingResponse, RepoSummary } from '../../shared/types.js';
import { type GitHubClient, optional } from '../github.js';
import type { TrafficStore } from '../store.js';
import { daysAgo, mapLimit } from '../util.js';
import { toDays } from './traffic.js';

export const ACTIVITY_WINDOW_DAYS = 90;
export const TRAFFIC_WINDOW_DAYS = 14;

const ACTIVITY_QUERY = `
query ($cursor: String, $since: GitTimestamp!) {
  viewer {
    repositories(first: 100, after: $cursor, ownerAffiliations: OWNER, isFork: false) {
      pageInfo { hasNextPage endCursor }
      nodes {
        name
        nameWithOwner
        defaultBranchRef { target { ... on Commit { history(since: $since) { totalCount } } } }
      }
    }
  }
}`;

export interface ActivityNode {
  name: string;
  nameWithOwner: string;
  defaultBranchRef: { target: { history?: { totalCount: number } } } | null;
}

const byValue = (a: RankingEntry, b: RankingEntry) => b.value - a.value || a.name.localeCompare(b.name);

export function buildActivityRanking(nodes: ActivityNode[]): RankingEntry[] {
  return nodes
    .map((n) => ({
      fullName: n.nameWithOwner,
      name: n.name,
      value: n.defaultBranchRef?.target.history?.totalCount ?? 0,
      secondary: null,
    }))
    .filter((e) => e.value > 0)
    .sort(byValue);
}

/** Commits on each repository's default branch in the last 90 days, in one GraphQL query per 100 repos. */
export async function getActivityRanking(gh: GitHubClient, now: Date = new Date()): Promise<RankingResponse> {
  const since = daysAgo(ACTIVITY_WINDOW_DAYS, now).toISOString();
  const nodes: ActivityNode[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 5; page++) {
    const data: {
      viewer: {
        repositories: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: ActivityNode[] };
      };
    } = await gh.graphql(ACTIVITY_QUERY, { cursor, since });
    nodes.push(...data.viewer.repositories.nodes);
    if (!data.viewer.repositories.pageInfo.hasNextPage) break;
    cursor = data.viewer.repositories.pageInfo.endCursor;
  }
  return { mode: 'activity', windowDays: ACTIVITY_WINDOW_DAYS, entries: buildActivityRanking(nodes) };
}

interface RawViews {
  count: number;
  uniques: number;
  views: { timestamp: string; count: number; uniques: number }[];
}

/**
 * Unique visitors in the last 14 days for every original repository you own. GitHub has no batch
 * endpoint for traffic, so this costs one request per repository; each answer is also
 * saved locally so the traffic history grows for all of them.
 */
export async function getTrafficRanking(
  gh: GitHubClient,
  store: TrafficStore,
  repos: RepoSummary[],
): Promise<RankingResponse> {
  const results = await mapLimit(repos, 8, async (repo): Promise<RankingEntry | null> => {
    const views = await optional(gh.get<RawViews>(`/repos/${repo.fullName}/traffic/views`), null);
    if (!views) return null;
    store.merge(repo.fullName, 'views', toDays(views));
    // Unique visitors are the headline; total page views stay available as the secondary value.
    return { fullName: repo.fullName, name: repo.name, value: views.uniques, secondary: views.count };
  });
  return {
    mode: 'traffic',
    windowDays: TRAFFIC_WINDOW_DAYS,
    entries: results.filter((e): e is RankingEntry => e !== null && e.value > 0).sort(byValue),
  };
}
