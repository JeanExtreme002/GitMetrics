import { describe, expect, it } from 'vitest';
import { buildActions, getDailyRunCounts, type RawRun } from '../src/server/metrics/actions';
import { lastDays } from '../src/server/util';
import { buildCommits } from '../src/server/metrics/commits';
import { buildContributors } from '../src/server/metrics/contributors';
import { buildFiles, extensionOf } from '../src/server/metrics/files';
import {
  buildIssues,
  buildPulls,
  getMonthlyCounts,
  getMonthlyIssueCounts,
  getMonthlyPullCounts,
  monthBounds,
  monthlySearchQuery,
  sizeLabel,
  windowMonths,
  type RawIssue,
  type RawPull,
} from '../src/server/metrics/pulls';
import { GitHubClient } from '../src/server/github';
import { buildDeployments, buildReleases } from '../src/server/metrics/releases';
import { buildLanguages } from '../src/server/metrics/repos';
import { toDays, toSeries } from '../src/server/metrics/traffic';

const now = new Date('2025-06-15T12:00:00Z');

describe('commits', () => {
  it('summarizes weekly activity and the punch card', () => {
    const week = Date.UTC(2025, 5, 1) / 1000;
    const result = buildCommits(
      [
        { week, total: 3, days: [0, 1, 2, 0, 0, 0, 0] },
        { week: week + 7 * 86400, total: 0, days: [0, 0, 0, 0, 0, 0, 0] },
      ],
      [[week, 120, -40]],
      [
        [1, 9, 2],
        [2, 14, 5],
      ],
      [],
    );
    expect(result.pending).toBe(false);
    expect(result.totals).toMatchObject({
      lastYear: 3,
      activeWeeks: 1,
      busiestDay: 'Tuesday',
      busiestHour: 14,
    });
    expect(result.daily['2025-06-02']).toBe(1);
    expect(result.codeFrequency).toEqual([{ week: '2025-06-01', additions: 120, deletions: 40 }]);
  });

  it('reports pending stats', () => {
    expect(buildCommits(null, null, null, []).pending).toBe(true);
  });
});

const pull = (overrides: Partial<RawPull>): RawPull => ({
  number: 1,
  title: 'Change',
  url: 'https://github.com/o/r/pull/1',
  state: 'MERGED',
  createdAt: '2025-06-01T00:00:00Z',
  mergedAt: '2025-06-01T10:00:00Z',
  closedAt: '2025-06-01T10:00:00Z',
  additions: 5,
  deletions: 1,
  isDraft: false,
  author: { login: 'octocat', avatarUrl: '' },
  ...overrides,
});

describe('pull requests', () => {
  it('labels sizes by lines changed', () => {
    expect([5, 20, 100, 500, 5000].map(sizeLabel)).toEqual(['XS', 'S', 'M', 'L', 'XL']);
  });

  it('computes merge time, merge rate and monthly buckets', () => {
    const result = buildPulls(
      { open: 1, merged: 3, closed: 1 },
      [
        pull({ number: 1 }),
        pull({ number: 2, mergedAt: '2025-06-02T06:00:00Z' }),
        pull({ number: 3, state: 'OPEN', mergedAt: null, closedAt: null, createdAt: '2025-05-01T00:00:00Z' }),
        pull({ number: 4, state: 'CLOSED', mergedAt: null, author: null }),
        pull({ number: 5, state: 'OPEN', mergedAt: null, closedAt: null, createdAt: '2025-05-20T00:00:00Z' }),
      ],
      now,
    );
    expect(result.medianTimeToMergeHours).toBe(20);
    expect(result.mergeRate).toBe(0.75);
    expect(result.monthly.at(-1)).toEqual({ month: '2025-06', opened: 3, merged: 2, closed: 1 });
    expect(result.openOldest.map((p) => p.number)).toEqual([3, 5]);
    // The same open pull requests, the most recently opened first.
    expect(result.openNewest.map((p) => p.number)).toEqual([5, 3]);
    expect(result.topAuthors).toEqual([{ login: 'octocat', avatarUrl: '', count: 4 }]);
  });
});

describe('issues', () => {
  it('counts labels and time to close', () => {
    const issue = (overrides: Partial<RawIssue>): RawIssue => ({
      number: 1,
      title: 'Bug',
      url: '',
      state: 'CLOSED',
      createdAt: '2025-06-01T00:00:00Z',
      closedAt: '2025-06-03T00:00:00Z',
      author: { login: 'a', avatarUrl: '' },
      comments: { totalCount: 0 },
      labels: { nodes: [{ name: 'bug', color: 'd73a4a' }] },
      ...overrides,
    });
    const result = buildIssues(
      { open: 1, closed: 1 },
      [issue({}), issue({ number: 2, state: 'OPEN', closedAt: null })],
      now,
    );
    expect(result.medianTimeToCloseHours).toBe(48);
    expect(result.labels).toEqual([{ name: 'bug', color: 'd73a4a', count: 2 }]);
    expect(result.openOldest).toHaveLength(1);
  });
});

describe('contributors', () => {
  it('derives totals, activity and new contributors', () => {
    const week = (iso: string) => Date.parse(iso) / 1000;
    const result = buildContributors(
      [
        {
          total: 10,
          author: { login: 'old', avatar_url: '', html_url: '' },
          weeks: [{ w: week('2023-01-01'), a: 50, d: 5, c: 10 }],
        },
        {
          total: 20,
          author: { login: 'new', avatar_url: '', html_url: '' },
          weeks: [
            { w: week('2025-05-04'), a: 10, d: 2, c: 15 },
            { w: week('2025-06-08'), a: 1, d: 1, c: 5 },
          ],
        },
      ],
      [],
      2,
      now,
    );
    expect(result.contributors.map((c) => c.login)).toEqual(['new', 'old']);
    expect(result.contributors[0]).toMatchObject({ additions: 11, deletions: 3 });
    expect(result.activeLast90Days).toBe(1);
    expect(result.newPerMonth.find((m) => m.month === '2025-05')?.count).toBe(1);
    // Full history from the first commit, with people active and new per month.
    expect(result.history[0]).toEqual({ month: '2023-01', active: 1, new: 1 });
    expect(result.history.at(-1)).toEqual({ month: '2025-06', active: 1, new: 0 });
    expect(result.history.find((m) => m.month === '2025-05')).toEqual({
      month: '2025-05',
      active: 1,
      new: 1,
    });
    expect(result.history.find((m) => m.month === '2024-03')).toEqual({
      month: '2024-03',
      active: 0,
      new: 0,
    });
    expect(result.contributors.find((c) => c.login === 'new')?.recentCommits).toBe(20);
    expect(result.contributors.find((c) => c.login === 'old')?.recentCommits).toBe(0);
  });

  it('falls back to the plain contributor list', () => {
    const result = buildContributors(null, [{ login: 'x', contributions: 4, type: 'User' }], null, now);
    // The plain list is shown while GitHub computes the history, which is flagged for polling.
    expect(result.historyPending).toBe(true);
    expect(result.pending).toBe(false);
    expect(result.pending).toBe(false);
    expect(result.total).toBe(1);
  });
});

describe('files', () => {
  it('ranks files and counts each folder once per commit', () => {
    const result = buildFiles([
      {
        sha: 'a',
        merge: false,
        files: [
          { filename: 'src/app/main.ts', additions: 10, deletions: 2 },
          { filename: 'src/app/util.ts', additions: 1, deletions: 0 },
        ],
      },
      { sha: 'b', merge: false, files: [{ filename: 'src/app/main.ts', additions: 3, deletions: 1 }] },
      { sha: 'c', merge: true, files: [{ filename: 'README.md', additions: 100, deletions: 0 }] },
    ]);
    expect(result.commitsAnalyzed).toBe(2);
    expect(result.filesTouched).toBe(2);
    // Merge commits are skipped, so README's 100 lines do not count.
    expect(result.lines).toEqual({ additions: 14, deletions: 3 });
    expect(result.files[0]).toEqual({ path: 'src/app/main.ts', changes: 2, additions: 13, deletions: 3 });
    expect(result.folders.find((f) => f.path === 'src')?.changes).toBe(2);
    // The full tree: src (3 changes) > app (3) > main.ts (2) and util.ts (1).
    expect(result.tree.value).toBe(3);
    const src = result.tree.children![0]!;
    expect(src).toMatchObject({ name: 'src', path: 'src', value: 3 });
    const app = src.children![0]!;
    expect(app.children!.map((c) => [c.path, c.value, c.children])).toEqual([
      ['src/app/main.ts', 2, undefined],
      ['src/app/util.ts', 1, undefined],
    ]);
  });

  it('extracts extensions', () => {
    expect(extensionOf('a/b/file.TS')).toBe('.ts');
    expect(extensionOf('Makefile')).toBe('Makefile');
    expect(extensionOf('.gitignore')).toBe('.gitignore');
  });
});

describe('actions', () => {
  const run = (overrides: Partial<RawRun>): RawRun => ({
    id: 1,
    name: 'CI',
    workflow_id: 7,
    status: 'completed',
    conclusion: 'success',
    event: 'push',
    head_branch: 'main',
    created_at: '2025-06-14T10:00:00Z',
    run_started_at: '2025-06-14T10:00:00Z',
    updated_at: '2025-06-14T10:02:00Z',
    html_url: '',
    ...overrides,
  });

  it('computes success rate, durations and per-workflow stats', () => {
    const result = buildActions(
      [{ id: 7, name: 'CI', path: '.github/workflows/ci.yml', state: 'active' }],
      [
        run({ id: 1 }),
        run({ id: 2, conclusion: 'failure', updated_at: '2025-06-14T10:04:00Z' }),
        run({ id: 3, conclusion: 'cancelled' }),
        run({ id: 4, status: 'in_progress', conclusion: null }),
      ],
      30,
      now,
    );
    expect(result.successRate).toBe(0.5);
    expect(result.medianDurationMs).toBe(180_000);
    expect(result.failure).toBe(1);
    expect(result.cancelled).toBe(1);
    // Durations of 2 min (success), 4 min (failure) and 2 min (cancelled): median 2 min, average 2:40.
    expect(result.workflows[0]).toMatchObject({
      name: 'CI',
      runs: 4,
      successRate: 0.5,
      medianDurationMs: 120_000,
      avgDurationMs: 160_000,
    });
    expect(result.daily.find((d) => d.date === '2025-06-14')).toEqual({
      date: '2025-06-14',
      success: 1,
      failure: 1,
      other: 1,
    });
    expect(result.recentFailures).toHaveLength(1);
    expect(result.workflows[0]!.recent.map((r) => r.conclusion)).toEqual(['success', 'failure', 'cancelled']);
    expect(result.sampleSize).toBe(4);
  });

  it('uses the exact total and only charts fully covered days when runs were cut short', () => {
    const result = buildActions(
      [],
      [
        run({ id: 1, created_at: '2025-06-14T10:00:00Z' }),
        run({ id: 2, created_at: '2025-06-12T10:00:00Z' }),
      ],
      30,
      now,
      900,
    );
    expect(result.totalRuns).toBe(900);
    expect(result.sampleSize).toBe(2);
    // June 12 is only partly covered, so the chart starts on June 13.
    expect(result.daily[0]!.date).toBe('2025-06-13');
  });

  it('prefers exact per-day counts for the chart and the totals', () => {
    const exact = lastDays(30, now).map((date) => ({ date, success: 9, failure: 1, other: 2, cancelled: 1 }));
    const result = buildActions([], [run({ id: 1 })], 30, now, 300, exact);
    expect(result.exactDaily).toBe(true);
    expect(result.daily).toHaveLength(30);
    expect(result.daily[0]).toEqual({ date: exact[0]!.date, success: 9, failure: 1, other: 2 });
    expect(result.failure).toBe(30);
    expect(result.cancelled).toBe(30);
    expect(result.successRate).toBe(0.9);
    // 30 days of 12 finished runs: more than the 300 GitHub reported for the whole month.
    expect(result.totalRuns).toBe(360);
  });

  it('counts each day with four filtered requests and reuses finished days', async () => {
    const asked: string[] = [];
    const fetchImpl = (async (url: string | URL | Request) => {
      const u = new URL(String(url));
      asked.push(`${u.searchParams.get('created')}:${u.searchParams.get('status')}`);
      const totals: Record<string, number> = { completed: 10, success: 7, failure: 2, cancelled: 1 };
      return new Response(JSON.stringify({ total_count: totals[u.searchParams.get('status')!] }));
    }) as typeof fetch;
    const gh = new GitHubClient('t', fetchImpl);
    const days = ['2025-06-14', '2025-06-15'];
    const counts = await getDailyRunCounts(gh, '/repos/cache-test/r/actions', days, '2025-06-15');
    expect(counts[0]).toEqual({ date: '2025-06-14', success: 7, failure: 2, other: 1, cancelled: 1 });
    expect(asked).toHaveLength(8);
    // A second load only recounts today.
    await getDailyRunCounts(gh, '/repos/cache-test/r/actions', days, '2025-06-15');
    expect(asked).toHaveLength(12);
    expect(asked.slice(8).every((a) => a.startsWith('2025-06-15'))).toBe(true);
  });
});

describe('releases and deployments', () => {
  it('sums downloads and measures cadence', () => {
    const result = buildReleases(
      [
        {
          id: 1,
          tag_name: 'v1',
          name: null,
          published_at: '2025-06-01T00:00:00Z',
          prerelease: false,
          draft: false,
          html_url: '',
          assets: [{ download_count: 5 }],
        },
        {
          id: 2,
          tag_name: 'v2',
          name: 'Two',
          published_at: '2025-06-11T00:00:00Z',
          prerelease: false,
          draft: false,
          html_url: '',
          assets: [{ download_count: 7 }, { download_count: 1 }],
          author: { login: 'octo', avatar_url: 'a.png' },
        },
        {
          id: 4,
          tag_name: 'v3-rc1',
          name: null,
          published_at: '2023-01-05T00:00:00Z',
          prerelease: true,
          draft: false,
          html_url: '',
          assets: [],
        },
        {
          id: 3,
          tag_name: 'v3',
          name: null,
          published_at: null,
          prerelease: false,
          draft: true,
          html_url: '',
          assets: [],
        },
      ],
      now,
    );
    expect(result.total).toBe(3);
    expect(result.sampleSize).toBe(3);
    expect(result.totalDownloads).toBe(13);
    expect(result.releases[0]).toMatchObject({ tag: 'v2', author: 'octo', avatarUrl: 'a.png' });
    // The full history since the first release, stable and pre-releases apart.
    expect(result.monthly[0]).toEqual({ month: '2023-01', releases: 0, prereleases: 1 });
    expect(result.monthly.at(-1)).toEqual({ month: '2025-06', releases: 2, prereleases: 0 });
    expect(result.monthly).toHaveLength(30);
    // A larger total from GitHub wins over the fetched sample.
    expect(buildReleases([], now, 450).total).toBe(450);
  });

  it('groups deployments by environment', () => {
    const result = buildDeployments(
      [
        {
          id: 2,
          environment: 'production',
          ref: 'main',
          sha: 'abcdef123',
          created_at: '2025-06-10T00:00:00Z',
          creator: null,
        },
        {
          id: 1,
          environment: 'production',
          ref: 'main',
          sha: '123456789',
          created_at: '2025-05-10T00:00:00Z',
          creator: null,
        },
      ],
      new Map([
        [2, { state: 'success', logUrl: 'https://ci/2' }],
        [1, { state: 'inactive', environmentUrl: 'https://app.example.com' }],
      ]),
      now,
    );
    // The live address comes from the newest deployment that reported one.
    expect(result.environments).toEqual([
      {
        name: 'production',
        deployments: 2,
        lastDeployedAt: '2025-06-10T00:00:00Z',
        lastState: 'success',
        url: 'https://app.example.com',
        total: null,
      },
    ]);
    expect(result.recent[0]).toMatchObject({ sha: 'abcdef1', logUrl: 'https://ci/2' });
    expect(result.monthly).toHaveLength(12);
    expect(result.monthly.at(-1)).toEqual({
      month: '2025-06',
      deployments: 1,
      byEnvironment: { production: 1 },
    });
    expect(buildDeployments([], new Map(), now, 900).total).toBe(900);
    // A small sample covering everything keeps the monthly view only.
    expect(result.timeline).toBeNull();
  });

  it('uses exact environment totals and a per-day view for busy repositories', () => {
    const deploy = (id: number, environment: string, created_at: string) => ({
      id,
      environment,
      ref: 'main',
      sha: 'abcdef123',
      created_at,
      creator: null,
    });
    const result = buildDeployments(
      [
        deploy(3, 'staging', '2025-06-15T08:00:00Z'),
        deploy(2, 'production', '2025-06-14T08:00:00Z'),
        deploy(1, 'staging', '2025-06-13T08:00:00Z'),
      ],
      new Map(),
      now,
      5000,
      new Map([
        ['staging', 4000],
        ['production', 1000],
      ]),
    );
    expect(result.environments.map((e) => [e.name, e.deployments, e.total])).toEqual([
      ['staging', 2, 4000],
      ['production', 1, 1000],
    ]);
    // Three days covered: charted per hour, from the hour after the oldest deployment.
    expect(result.timeline!.unit).toBe('hour');
    expect(result.timeline!.points[0]!.date).toBe('2025-06-13T09');
    expect(result.timeline!.points.at(-1)!.date).toBe('2025-06-15T12');
    expect(result.timeline!.points.find((p) => p.date === '2025-06-14T08')).toEqual({
      date: '2025-06-14T08',
      deployments: 1,
      byEnvironment: { production: 1 },
    });

    // Longer stretches are charted per day; June 1 is only partly covered, so days start on June 2.
    const weeks = buildDeployments(
      [deploy(2, 'staging', '2025-06-15T08:00:00Z'), deploy(1, 'staging', '2025-06-01T08:00:00Z')],
      new Map(),
      now,
      5000,
    );
    expect(weeks.timeline!.unit).toBe('day');
    expect(weeks.timeline!.points[0]!.date).toBe('2025-06-02');
    expect(weeks.timeline!.points).toHaveLength(14);
  });
});

describe('traffic and languages', () => {
  it('merges traffic days into a sorted series', () => {
    const raw = {
      count: 3,
      uniques: 2,
      views: [{ timestamp: '2025-06-02T00:00:00Z', count: 3, uniques: 2 }],
    };
    const days = toDays(raw);
    expect(days).toEqual({ '2025-06-02': [3, 2] });
    expect(toSeries(raw, { ...days, '2025-06-01': [1, 1] }).daily.map((d) => d.date)).toEqual([
      '2025-06-01',
      '2025-06-02',
    ]);
  });

  it('computes language shares', () => {
    expect(buildLanguages({ Go: 300, Shell: 100 })).toEqual([
      { name: 'Go', bytes: 300, share: 0.75 },
      { name: 'Shell', bytes: 100, share: 0.25 },
    ]);
  });
});

describe('monthly pull request counts', () => {
  it('knows the first and last day of each month', () => {
    expect(monthBounds('2024-02')).toEqual(['2024-02-01', '2024-02-29']);
    expect(monthBounds('2025-11')).toEqual(['2025-11-01', '2025-11-30']);
  });

  it('asks for opened, merged and closed counts of every month in one query', () => {
    const query = monthlySearchQuery('octo/app', ['2025-05', '2025-06']);
    expect(query).toContain('o0: search(query: "repo:octo/app is:pr created:2025-05-01..2025-05-31"');
    expect(query).toContain(
      'm1: search(query: "repo:octo/app is:pr is:merged merged:2025-06-01..2025-06-30"',
    );
    expect(query).toContain(
      'c1: search(query: "repo:octo/app is:pr is:closed is:unmerged closed:2025-06-01..2025-06-30"',
    );
  });

  it('maps the search counts onto the last 12 months, or gives up gracefully', async () => {
    const counts: Record<string, { issueCount: number }> = {};
    for (let i = 0; i < 12; i++) {
      counts[`o${i}`] = { issueCount: 100 + i };
      counts[`m${i}`] = { issueCount: 50 };
      counts[`c${i}`] = { issueCount: 5 };
    }
    const ok = (async () => new Response(JSON.stringify({ data: counts }))) as typeof fetch;
    const monthly = await getMonthlyPullCounts(new GitHubClient('t', ok), 'o', 'r', now);
    expect(monthly).toHaveLength(12);
    expect(monthly![11]).toEqual({ month: '2025-06', opened: 111, merged: 50, closed: 5 });

    const failing = (async () => new Response('{}', { status: 403 })) as typeof fetch;
    expect(await getMonthlyPullCounts(new GitHubClient('t', failing), 'o', 'r', now)).toBeNull();
  });
});

describe('issues: monthly counts and most discussed', () => {
  it('asks for opened and closed issues per month', () => {
    const query = monthlySearchQuery('octo/app', ['2025-06'], 'issue');
    expect(query).toContain('o0: search(query: "repo:octo/app is:issue created:2025-06-01..2025-06-30"');
    expect(query).toContain(
      'c0: search(query: "repo:octo/app is:issue is:closed closed:2025-06-01..2025-06-30"',
    );
    expect(query).not.toContain('is:merged');
  });

  it('maps issue counts onto the last 12 months', async () => {
    const counts: Record<string, { issueCount: number }> = {};
    for (let i = 0; i < 12; i++) {
      counts[`o${i}`] = { issueCount: 10 };
      counts[`c${i}`] = { issueCount: i };
    }
    const ok = (async () => new Response(JSON.stringify({ data: counts }))) as typeof fetch;
    const monthly = await getMonthlyIssueCounts(new GitHubClient('t', ok), 'o', 'r', now);
    expect(monthly![11]).toEqual({ month: '2025-06', opened: 10, closed: 11 });
  });

  it('ranks open issues by number of comments', () => {
    const issue = (number: number, comments: number, state: 'OPEN' | 'CLOSED' = 'OPEN'): RawIssue => ({
      number,
      title: `#${number}`,
      url: '',
      state,
      createdAt: '2025-06-01T00:00:00Z',
      closedAt: state === 'CLOSED' ? '2025-06-02T00:00:00Z' : null,
      author: null,
      comments: { totalCount: comments },
      labels: { nodes: [] },
    });
    const result = buildIssues(
      { open: 3, closed: 1 },
      [issue(1, 2), issue(2, 9), issue(3, 0), issue(4, 50, 'CLOSED')],
      now,
    );
    expect(result.mostDiscussed.map((i) => i.number)).toEqual([2, 1]);
  });
});

describe('monthly windows', () => {
  it('turns a range into the months it covers', () => {
    expect(windowMonths('3', '2020-01-01T00:00:00Z', now)).toEqual(['2025-04', '2025-05', '2025-06']);
    expect(windowMonths('all', '2025-03-10T00:00:00Z', now)).toEqual([
      '2025-03',
      '2025-04',
      '2025-05',
      '2025-06',
    ]);
    expect(() => windowMonths('banana', '2020-01-01T00:00:00Z', now)).toThrow();
  });

  it('splits long windows into batches of 24 months per query', async () => {
    let calls = 0;
    const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
      calls++;
      const query = JSON.parse(String(init?.body)).query as string;
      const data: Record<string, { issueCount: number }> = {};
      for (const alias of query.match(/\b[oc]\d+(?=:)/g) ?? []) data[alias] = { issueCount: 1 };
      return new Response(JSON.stringify({ data }));
    }) as typeof fetch;
    const months = windowMonths('60', '2015-01-01T00:00:00Z', now);
    const counts = await getMonthlyCounts(new GitHubClient('t', fetchImpl), 'o/r', 'issue', months);
    expect(calls).toBe(3);
    expect(counts).toHaveLength(60);
    expect(counts.every((m) => m.opened === 1 && m.closed === 1 && m.merged === undefined)).toBe(true);
  });
});
