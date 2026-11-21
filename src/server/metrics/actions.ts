import type { ActionsResponse, WorkflowStat } from '../../shared/types.js';
import { type GitHubClient, GitHubError } from '../github.js';
import { average, countBy, daysAgo, lastDays, mapLimit, median, toDay } from '../util.js';

export const ACTIONS_WINDOW_DAYS = 30;
/** GitHub returns at most 1,000 runs for a query filtered by date. */
const MAX_PAGES = 10;

export interface RawRun {
  id: number;
  name: string | null;
  workflow_id: number;
  status: string;
  conclusion: string | null;
  event: string;
  head_branch: string | null;
  created_at: string;
  run_started_at?: string;
  updated_at: string;
  html_url: string;
  actor?: { login: string } | null;
}

export interface RawWorkflow {
  id: number;
  name: string;
  path: string;
  state: string;
}

export type DailyRuns = ActionsResponse['daily'][number] & { cancelled: number };

/** Finished days never change, so their counts are kept for a while; today is always recounted. */
const PAST_DAY_TTL = 6 * 60 * 60 * 1000;
const dailyCache = new Map<string, { at: number; value: DailyRuns }>();

/**
 * Exact run counts for each day, read from the total GitHub reports for a filtered query, so the
 * 1,000-run limit of a single query does not apply. Four small requests per uncached day.
 * Timed-out and startup failures are rare and count as "other" here.
 */
export async function getDailyRunCounts(
  gh: GitHubClient,
  base: string,
  days: string[],
  today: string = toDay(new Date()),
): Promise<DailyRuns[]> {
  const count = async (day: string, status: string) =>
    (await gh.get<{ total_count: number }>(`${base}/runs`, { created: day, status, per_page: 1 }))
      .total_count;
  return mapLimit(days, 4, async (day) => {
    const key = `${base}:${day}`;
    const hit = dailyCache.get(key);
    if (hit && day !== today && Date.now() - hit.at < PAST_DAY_TTL) return hit.value;
    const [completed, success, failure, cancelled] = await Promise.all([
      count(day, 'completed'),
      count(day, 'success'),
      count(day, 'failure'),
      count(day, 'cancelled'),
    ]);
    const value = {
      date: day,
      success,
      failure,
      other: Math.max(completed - success - failure, 0),
      cancelled,
    };
    dailyCache.set(key, { at: Date.now(), value });
    return value;
  });
}

const FAILED = new Set(['failure', 'timed_out', 'startup_failure']);

export const durationMs = (run: RawRun) =>
  new Date(run.updated_at).getTime() - new Date(run.run_started_at ?? run.created_at).getTime();

function successRate(runs: RawRun[]): number | null {
  const success = runs.filter((r) => r.conclusion === 'success').length;
  const failure = runs.filter((r) => r.conclusion && FAILED.has(r.conclusion)).length;
  return success + failure ? success / (success + failure) : null;
}

export function buildActions(
  workflows: RawWorkflow[],
  runs: RawRun[],
  windowDays = ACTIONS_WINDOW_DAYS,
  now: Date = new Date(),
  runsTotal: number = runs.length,
  exactDaily?: DailyRuns[],
): ActionsResponse {
  // Runs come newest first. When not all of them could be fetched, the oldest days are only
  // partly covered, so the daily chart starts at the first day the sample fully covers.
  const truncated = runsTotal > runs.length;
  const oldestDay = runs.length ? toDay(runs[runs.length - 1]!.created_at) : '';
  const completed = runs.filter((r) => r.status === 'completed');
  const timed = completed.filter((r) => r.conclusion === 'success' || FAILED.has(r.conclusion ?? ''));
  const durations = timed.map(durationMs).filter((d) => d >= 0);

  const daily = new Map(
    lastDays(windowDays, now).map((date) => [date, { date, success: 0, failure: 0, other: 0 }]),
  );
  if (truncated && !exactDaily) for (const date of daily.keys()) if (date <= oldestDay) daily.delete(date);
  for (const run of completed) {
    const day = daily.get(toDay(run.created_at));
    if (!day) continue;
    if (run.conclusion === 'success') day.success++;
    else if (FAILED.has(run.conclusion ?? '')) day.failure++;
    else day.other++;
  }

  const byWorkflow = new Map<number, RawRun[]>();
  for (const run of runs) {
    byWorkflow.set(run.workflow_id, [...(byWorkflow.get(run.workflow_id) ?? []), run]);
  }

  const known = new Map(workflows.map((w) => [w.id, w]));
  for (const run of runs) {
    if (!known.has(run.workflow_id)) {
      known.set(run.workflow_id, {
        id: run.workflow_id,
        name: run.name ?? `Workflow ${run.workflow_id}`,
        path: '',
        state: 'unknown',
      });
    }
  }

  const workflowStats: WorkflowStat[] = [...known.values()]
    .map((w) => {
      const list = byWorkflow.get(w.id) ?? [];
      const last = list[0];
      const wDurations = list
        .filter((r) => r.status === 'completed' && r.conclusion !== 'skipped')
        .map(durationMs)
        .filter((d) => d >= 0);
      return {
        id: w.id,
        name: w.name,
        path: w.path,
        state: w.state,
        runs: list.length,
        successRate: successRate(list),
        avgDurationMs: average(wDurations),
        medianDurationMs: median(wDurations),
        lastRun: last
          ? {
              status: last.status,
              conclusion: last.conclusion,
              createdAt: last.created_at,
              url: last.html_url,
            }
          : null,
        recent: list
          .filter((r) => r.status === 'completed' && r.conclusion !== 'skipped')
          .slice(0, 10)
          .map((r) => ({ conclusion: r.conclusion, url: r.html_url, createdAt: r.created_at })),
      };
    })
    .sort((a, b) => b.runs - a.runs);

  const events = countBy(runs, (r) => r.event);
  const failures = completed.filter((r) => FAILED.has(r.conclusion ?? ''));

  // With exact per-day counts, the chart and the totals cover the whole window.
  const exact = exactDaily
    ? exactDaily.reduce(
        (t, d) => ({
          success: t.success + d.success,
          failure: t.failure + d.failure,
          cancelled: t.cancelled + d.cancelled,
        }),
        { success: 0, failure: 0, cancelled: 0 },
      )
    : null;

  return {
    available: true,
    windowDays,
    // GitHub also caps the total it reports for a whole month, so prefer the sum of the days.
    totalRuns: Math.max(
      runsTotal,
      runs.length,
      exactDaily ? exactDaily.reduce((n, d) => n + d.success + d.failure + d.other, 0) : 0,
    ),
    sampleSize: runs.length,
    exactDaily: !!exact,
    success: exact ? exact.success : completed.filter((r) => r.conclusion === 'success').length,
    failure: exact ? exact.failure : failures.length,
    cancelled: exact ? exact.cancelled : completed.filter((r) => r.conclusion === 'cancelled').length,
    successRate: exact
      ? exact.success + exact.failure
        ? exact.success / (exact.success + exact.failure)
        : null
      : successRate(completed),
    avgDurationMs: average(durations),
    medianDurationMs: median(durations),
    totalDurationMs: durations.reduce((s, d) => s + d, 0),
    daily: exactDaily ? exactDaily.map(({ cancelled: _, ...d }) => d) : [...daily.values()],
    workflows: workflowStats,
    events: [...events.entries()].sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count })),
    recentFailures: failures.slice(0, 6).map((r) => ({
      id: r.id,
      name: r.name ?? known.get(r.workflow_id)?.name ?? 'Workflow',
      branch: r.head_branch,
      event: r.event,
      createdAt: r.created_at,
      url: r.html_url,
      actor: r.actor?.login ?? null,
    })),
  };
}

export async function getActions(gh: GitHubClient, owner: string, repo: string): Promise<ActionsResponse> {
  const base = `/repos/${owner}/${repo}/actions`;
  const since = toDay(daysAgo(ACTIONS_WINDOW_DAYS - 1));
  try {
    const [workflows, runPages] = await Promise.all([
      gh.get<{ workflows: RawWorkflow[] }>(`${base}/workflows`, { per_page: 100 }),
      gh.pages<{ total_count: number; workflow_runs: RawRun[] }>(
        `${base}/runs`,
        { created: `>=${since}` },
        { maxPages: MAX_PAGES },
      ),
    ]);
    const runs = runPages.flatMap((p) => p.workflow_runs);
    const total = runPages[0]?.total_count ?? runs.length;
    // Too many runs for one query: count each day separately so the chart covers the whole window.
    const exactDaily =
      total > runs.length
        ? await getDailyRunCounts(gh, base, lastDays(ACTIONS_WINDOW_DAYS)).catch(() => undefined)
        : undefined;
    return buildActions(workflows.workflows, runs, ACTIONS_WINDOW_DAYS, new Date(), total, exactDaily);
  } catch (error) {
    if (error instanceof GitHubError && (error.status === 403 || error.status === 404)) {
      return { ...buildActions([], []), available: false };
    }
    throw error;
  }
}
