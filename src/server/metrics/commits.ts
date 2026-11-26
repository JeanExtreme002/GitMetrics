import type { CommitItem, CommitsResponse } from '../../shared/types.js';
import { type GitHubClient, optional } from '../github.js';
import { toDay } from '../util.js';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export interface RawWeek {
  week: number;
  total: number;
  days: number[];
}

interface RawCommit {
  sha: string;
  html_url: string;
  commit: { message: string; author: { name: string; date: string } | null };
  author: { login: string; avatar_url: string } | null;
}

export const toCommitItem = (c: RawCommit): CommitItem => ({
  sha: c.sha,
  message: c.commit.message.split('\n')[0] ?? '',
  author: c.author?.login ?? c.commit.author?.name ?? 'unknown',
  avatarUrl: c.author?.avatar_url ?? null,
  date: c.commit.author?.date ?? '',
  url: c.html_url,
});

export function buildCommits(
  activity: RawWeek[] | null,
  codeFrequency: [number, number, number][] | null,
  punchCard: [number, number, number][] | null,
  recent: CommitItem[],
): CommitsResponse {
  const weeks = activity ?? [];
  const daily: Record<string, number> = {};
  for (const week of weeks) {
    week.days.forEach((count, i) => {
      daily[toDay((week.week + i * 86_400) * 1000)] = count;
    });
  }

  const punch = (punchCard ?? []).map(([day, hour, commits]) => ({ day, hour, commits }));
  const byDay = new Array<number>(7).fill(0);
  const byHour = new Array<number>(24).fill(0);
  for (const p of punch) {
    byDay[p.day]! += p.commits;
    byHour[p.hour]! += p.commits;
  }
  const argmax = (values: number[]) =>
    values.some((v) => v > 0) ? values.indexOf(Math.max(...values)) : null;
  const busiestDay = argmax(byDay);

  const lastYear = weeks.reduce((sum, w) => sum + w.total, 0);
  return {
    pending: activity === null,
    weekly: weeks.map((w) => ({ week: toDay(w.week * 1000), commits: w.total })),
    daily,
    codeFrequency: codeFrequency
      ? codeFrequency.map(([week, additions, deletions]) => ({
          week: toDay(week * 1000),
          additions,
          deletions: Math.abs(deletions),
        }))
      : null,
    punchCard: punch,
    totals: {
      lastYear,
      avgPerWeek: weeks.length ? Math.round((lastYear / weeks.length) * 10) / 10 : 0,
      activeWeeks: weeks.filter((w) => w.total > 0).length,
      busiestDay: busiestDay === null ? null : WEEKDAYS[busiestDay]!,
      busiestHour: argmax(byHour),
    },
    recent,
  };
}

export async function getCommits(gh: GitHubClient, owner: string, repo: string): Promise<CommitsResponse> {
  const base = `/repos/${owner}/${repo}`;
  const [activity, frequency, punch, recent] = await Promise.all([
    optional(gh.stats<RawWeek[]>(`${base}/stats/commit_activity`), null),
    // GitHub refuses code frequency for repositories with 10k+ commits (422).
    optional(gh.stats<[number, number, number][]>(`${base}/stats/code_frequency`), null),
    optional(gh.stats<[number, number, number][]>(`${base}/stats/punch_card`), null),
    // The latest, for the list that starts short and shows more on request.
    optional(gh.get<RawCommit[]>(`${base}/commits`, { per_page: 30 }), []),
  ]);
  return buildCommits(activity, frequency, punch, recent.map(toCommitItem));
}
