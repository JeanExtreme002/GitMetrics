import type { TrafficResponse, TrafficSeries } from '../../shared/types.js';
import { type GitHubClient, GitHubError } from '../github.js';
import type { TrafficStore } from '../store.js';
import { toDay } from '../util.js';

interface RawTraffic {
  count: number;
  uniques: number;
  views?: { timestamp: string; count: number; uniques: number }[];
  clones?: { timestamp: string; count: number; uniques: number }[];
}

const EMPTY: TrafficSeries = { count: 0, uniques: 0, daily: [] };

export function toDays(raw: RawTraffic): Record<string, [number, number]> {
  const days: Record<string, [number, number]> = {};
  for (const d of raw.views ?? raw.clones ?? []) days[toDay(d.timestamp)] = [d.count, d.uniques];
  return days;
}

export function toSeries(raw: RawTraffic, history: Record<string, [number, number]>): TrafficSeries {
  return {
    count: raw.count,
    uniques: raw.uniques,
    daily: Object.entries(history)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, [count, uniques]]) => ({ date, count, uniques })),
  };
}

export async function getTraffic(
  gh: GitHubClient,
  store: TrafficStore,
  owner: string,
  repo: string,
): Promise<TrafficResponse> {
  const base = `/repos/${owner}/${repo}/traffic`;
  try {
    const [views, clones, referrers, paths] = await Promise.all([
      gh.get<RawTraffic>(`${base}/views`),
      gh.get<RawTraffic>(`${base}/clones`),
      gh.get<{ referrer: string; count: number; uniques: number }[]>(`${base}/popular/referrers`),
      gh.get<{ path: string; title: string; count: number; uniques: number }[]>(`${base}/popular/paths`),
    ]);

    const fullName = `${owner}/${repo}`;
    const viewHistory = store.merge(fullName, 'views', toDays(views));
    const cloneHistory = store.merge(fullName, 'clones', toDays(clones));
    const tracked = [...Object.keys(viewHistory), ...Object.keys(cloneHistory)].sort();

    return {
      available: true,
      views: toSeries(views, viewHistory),
      clones: toSeries(clones, cloneHistory),
      referrers,
      paths,
      trackedSince: tracked[0] ?? null,
    };
  } catch (error) {
    if (error instanceof GitHubError && (error.status === 403 || error.status === 404)) {
      return {
        available: false,
        reason: 'Traffic is only visible to people with push access to this repository.',
        views: EMPTY,
        clones: EMPTY,
        referrers: [],
        paths: [],
        trackedSince: null,
      };
    }
    throw error;
  }
}
