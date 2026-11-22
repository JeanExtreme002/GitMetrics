import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/server/app';

/**
 * End-to-end checks of each repository page: requests go through the local server, exactly as
 * the web app makes them, against a fake GitHub that answers with real API shapes. They catch a
 * page breaking because a route or a loader changed, which the unit tests of the math cannot.
 */

const DAY = 86_400_000;
const isoDaysAgo = (days: number) => new Date(Date.now() - days * DAY).toISOString();
const weekStart = (weeksAgo: number) => Math.floor((Date.now() - weeksAgo * 7 * DAY) / 1000);

const json = (body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json', ...headers },
  });
const notFound = () => new Response(JSON.stringify({ message: 'Not Found' }), { status: 404 });
const computing = () => new Response(null, { status: 202 });

const REPO = {
  id: 1,
  name: 'app',
  full_name: 'octo/app',
  owner: { login: 'octo', avatar_url: '' },
  description: 'An app',
  private: false,
  fork: false,
  archived: false,
  stargazers_count: 3,
  forks_count: 1,
  watchers_count: 3,
  open_issues_count: 1,
  language: 'TypeScript',
  pushed_at: isoDaysAgo(1),
  created_at: isoDaysAgo(400),
  html_url: 'https://github.com/octo/app',
  default_branch: 'main',
  license: null,
  homepage: null,
  size: 1,
};

const person = (login: string) => ({ login, avatarUrl: `https://avatars/${login}` });

const PULLS = [
  {
    number: 3,
    title: 'Open one',
    url: '',
    state: 'OPEN',
    createdAt: isoDaysAgo(5),
    mergedAt: null,
    closedAt: null,
    additions: 5,
    deletions: 1,
    isDraft: false,
    author: person('ana'),
  },
  {
    number: 2,
    title: 'Merged one',
    url: '',
    state: 'MERGED',
    createdAt: isoDaysAgo(10),
    mergedAt: isoDaysAgo(9),
    closedAt: isoDaysAgo(9),
    additions: 300,
    deletions: 20,
    isDraft: false,
    author: person('ana'),
  },
  {
    number: 1,
    title: 'Closed one',
    url: '',
    state: 'CLOSED',
    createdAt: isoDaysAgo(20),
    mergedAt: null,
    closedAt: isoDaysAgo(19),
    additions: 2,
    deletions: 0,
    isDraft: false,
    author: person('bo'),
  },
];

const ISSUES = [
  {
    number: 5,
    title: 'Busy bug',
    url: '',
    state: 'OPEN',
    createdAt: isoDaysAgo(30),
    closedAt: null,
    author: person('cy'),
    comments: { totalCount: 12 },
    labels: { nodes: [{ name: 'bug', color: 'd73a4a' }] },
  },
  {
    number: 4,
    title: 'Quiet idea',
    url: '',
    state: 'OPEN',
    createdAt: isoDaysAgo(3),
    closedAt: null,
    author: person('cy'),
    comments: { totalCount: 0 },
    labels: { nodes: [] },
  },
  {
    number: 3,
    title: 'Fixed',
    url: '',
    state: 'CLOSED',
    createdAt: isoDaysAgo(40),
    closedAt: isoDaysAgo(38),
    author: person('di'),
    comments: { totalCount: 2 },
    labels: { nodes: [{ name: 'bug', color: 'd73a4a' }] },
  },
];

/** An open pull request on the fake repository, waiting for your review. */
const MY_PULL = {
  number: 7,
  title: 'Add caching',
  url: 'https://github.com/octo/app/pull/7',
  state: 'OPEN',
  isDraft: false,
  createdAt: isoDaysAgo(2),
  updatedAt: isoDaysAgo(1),
  mergedAt: null,
  closedAt: null,
  additions: 120,
  deletions: 30,
  reviewDecision: 'REVIEW_REQUIRED',
  author: { login: 'bo', avatarUrl: '' },
  repository: { nameWithOwner: 'octo/app', name: 'app', owner: { login: 'octo', avatarUrl: '' } },
  reviews: { nodes: [] },
  reviewRequests: { nodes: [{ requestedReviewer: { __typename: 'User', login: 'octo' } }] },
  timelineItems: {
    nodes: [{ createdAt: isoDaysAgo(2), requestedReviewer: { __typename: 'User', login: 'octo' } }],
  },
  commits: { nodes: [] },
};

const DETAIL = {
  ...MY_PULL,
  // The full timeline names each event's type, as GitHub does.
  timelineItems: {
    nodes: MY_PULL.timelineItems.nodes.map((e) => ({ ...e, __typename: 'ReviewRequestedEvent' })),
  },
  changedFiles: 4,
  baseRefName: 'main',
  headRefName: 'cache',
  commits: { totalCount: 2 },
  comments: { totalCount: 1 },
  reviewThreads: { totalCount: 0 },
  participants: { totalCount: 2 },
  history: { nodes: [] },
  latest: { nodes: [] },
};

/** A whole repository on a fake GitHub; `calls` records every path that was requested. */
function fakeGitHub(overrides: Record<string, () => Response> = {}) {
  const calls: string[] = [];
  const urls: URL[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const p = url.pathname;
    calls.push(p);
    urls.push(url);
    if (overrides[p]) return overrides[p]();

    if (p === '/user')
      return json(
        {
          login: 'octo',
          name: 'Octo',
          avatar_url: '',
          html_url: '',
          followers: 0,
          following: 0,
          public_repos: 1,
          created_at: REPO.created_at,
        },
        { 'x-oauth-scopes': 'repo, read:user' },
      );
    if (p === '/repos/octo/app') return json(REPO);
    if (p === '/search/repositories') return json({ total_count: 1, items: [REPO] });

    if (p === '/graphql') {
      const body = JSON.parse(String(init?.body)) as { query: string; variables?: Record<string, unknown> };
      const query = String(body.query);
      // Your pull requests: one search per filter, the summary, a repository's baseline, one pull request.
      if (query.includes('search(query: $q')) {
        const q = String(body.variables?.q);
        const nodes = q.includes('review-requested:@me') ? [MY_PULL] : [];
        return json({ data: { search: { issueCount: nodes.length, nodes } } });
      }
      if (query.includes('reviewed: search')) {
        return json({
          data: {
            reviewed: { nodes: [] },
            merged: { nodes: [{ createdAt: isoDaysAgo(2), mergedAt: isoDaysAgo(1) }] },
          },
        });
      }
      if (query.includes('states: MERGED, orderBy')) {
        return json({
          data: {
            repository: {
              pullRequests: {
                nodes: [
                  {
                    createdAt: isoDaysAgo(3),
                    mergedAt: isoDaysAgo(2),
                    additions: 40,
                    deletions: 10,
                    author: { login: 'bo' },
                    reviews: { nodes: [] },
                  },
                ],
              },
            },
          },
        });
      }
      if (query.includes('pullRequest(number: $number)')) {
        const pull = body.variables?.number === 7 ? DETAIL : null;
        return json({ data: { repository: { pullRequest: pull } } });
      }
      if (query.includes('pullRequests(first')) {
        return json({
          data: {
            repository: {
              open: { totalCount: 1 },
              merged: { totalCount: 1 },
              closed: { totalCount: 1 },
              pullRequests: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: PULLS },
            },
          },
        });
      }
      if (query.includes('issues(first')) {
        return json({
          data: {
            repository: {
              open: { totalCount: 2 },
              closed: { totalCount: 1 },
              issues: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: ISSUES },
            },
          },
        });
      }
      if (query.includes('search(')) {
        // Monthly counts: one alias per month and kind; give each a count of 1.
        const aliases = [...query.matchAll(/(\w+): search\(/g)].map((m) => m[1]!);
        return json({ data: Object.fromEntries(aliases.map((a) => [a, { issueCount: 1 }])) });
      }
      if (query.includes('stargazers(last')) {
        return json({
          data: {
            repository: {
              stargazers: {
                edges: [
                  { starredAt: isoDaysAgo(1), node: { login: 'fan', name: null, avatarUrl: '', url: '' } },
                ],
              },
            },
          },
        });
      }
      if (query.includes('deployments(environments')) {
        return json({ data: { repository: { e0: { totalCount: 120 } } } });
      }
      return notFound();
    }

    if (p === '/repos/octo/app/stargazers') {
      return json([30, 20, 2].map((d) => ({ starred_at: isoDaysAgo(d) })));
    }

    if (p === '/repos/octo/app/stats/commit_activity') {
      return json([{ week: weekStart(1), total: 4, days: [0, 2, 2, 0, 0, 0, 0] }]);
    }
    if (p === '/repos/octo/app/stats/code_frequency') return json([[weekStart(1), 120, -30]]);
    if (p === '/repos/octo/app/stats/punch_card') return json([[1, 14, 3]]);
    if (p === '/repos/octo/app/commits') {
      if (url.searchParams.get('per_page') === '8') {
        return json([
          {
            sha: 'c3',
            html_url: '',
            commit: { message: 'feat: more', author: { name: 'Ana', date: isoDaysAgo(1) } },
            author: { login: 'ana', avatar_url: '' },
          },
        ]);
      }
      return json([{ sha: 'c3' }, { sha: 'm2' }, { sha: 'c1' }]);
    }
    if (p === '/repos/octo/app/commits/c3')
      return json({
        sha: 'c3',
        parents: [{}],
        files: [{ filename: 'src/app/main.ts', additions: 10, deletions: 2 }],
      });
    if (p === '/repos/octo/app/commits/m2')
      return json({
        sha: 'm2',
        parents: [{}, {}],
        files: [{ filename: 'README.md', additions: 500, deletions: 0 }],
      });
    if (p === '/repos/octo/app/commits/c1')
      return json({
        sha: 'c1',
        parents: [{}],
        files: [{ filename: 'src/app/main.ts', additions: 3, deletions: 1 }],
      });

    if (p === '/repos/octo/app/stats/contributors') {
      return json([
        {
          total: 7,
          author: { login: 'ana', avatar_url: '', html_url: '' },
          weeks: [{ w: weekStart(2), a: 50, d: 5, c: 7 }],
        },
      ]);
    }
    if (p === '/repos/octo/app/contributors') {
      // Counted with per_page=1 through the Link header: five people, one without a linked account.
      return json([{ login: 'ana', contributions: 7, type: 'User' }], {
        link: '<https://api.github.com/repos/octo/app/contributors?per_page=1&page=5>; rel="last"',
      });
    }

    if (p === '/repos/octo/app/actions/workflows') {
      return json({ workflows: [{ id: 9, name: 'CI', path: '.github/workflows/ci.yml', state: 'active' }] });
    }
    if (p === '/repos/octo/app/actions/runs') {
      const run = (id: number, conclusion: string) => ({
        id,
        name: 'CI',
        workflow_id: 9,
        status: 'completed',
        conclusion,
        event: 'push',
        head_branch: 'main',
        created_at: isoDaysAgo(1),
        run_started_at: isoDaysAgo(1),
        updated_at: new Date(Date.now() - DAY + 120_000).toISOString(),
        html_url: '',
        actor: { login: 'ana' },
      });
      return json({ total_count: 2, workflow_runs: [run(2, 'success'), run(1, 'failure')] });
    }

    if (p === '/repos/octo/app/releases') {
      return json([
        {
          id: 1,
          tag_name: 'v1.0.0',
          name: 'First',
          published_at: isoDaysAgo(15),
          prerelease: false,
          draft: false,
          html_url: '',
          assets: [{ download_count: 40 }],
          author: { login: 'ana', avatar_url: '' },
        },
      ]);
    }

    if (p === '/repos/octo/app/deployments') {
      // 35 deployments, newest first; only the latest 30 should have their status fetched.
      return json(
        Array.from({ length: 35 }, (_, i) => ({
          id: 100 - i,
          environment: 'production',
          ref: 'main',
          sha: 'abcdef1234',
          created_at: isoDaysAgo(i + 1),
          creator: { login: 'ana', avatar_url: '' },
        })),
      );
    }
    if (/^\/repos\/octo\/app\/deployments\/\d+\/statuses$/.test(p)) {
      return json([
        { state: 'success', environment_url: 'https://app.example.com', log_url: 'https://ci.example.com/1' },
      ]);
    }

    return notFound();
  }) as typeof fetch;
  return { fetchImpl, calls, urls };
}

describe('repository pages, end to end', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'gitmetrics-sections-'));
  });
  afterEach(() => {
    vi.useRealTimers();
    rmSync(dir, { recursive: true, force: true });
  });

  async function signedIn(overrides: Record<string, () => Response> = {}) {
    const github = fakeGitHub(overrides);
    const app = createApp({ dataDir: dir, fetchImpl: github.fetchImpl, ghToken: async () => 'gho_cli' });
    const send = (url: string, init: RequestInit = {}) =>
      app.request(url, {
        ...init,
        headers: { host: 'localhost:4280', 'x-gitmetrics': '1', ...init.headers },
      });
    expect((await send('/api/auth/gh', { method: 'POST' })).status).toBe(200);
    const page = async <T = Record<string, unknown>>(section: string) => {
      const res = await send(`/api/repos/octo/app/${section}`);
      expect(res.status, section).toBe(200);
      return (await res.json()) as T;
    };
    return { ...github, send, page };
  }

  it('stars: history, recent stargazers and totals', async () => {
    const { page } = await signedIn();
    const stars = await page<{
      total: number;
      recent: { login: string }[];
      points: unknown[];
      firstStarAt: string;
      stats: { last7Days: number };
    }>('stars');
    expect(stars.total).toBe(3);
    expect(stars.recent.map((s) => s.login)).toEqual(['fan']);
    expect(stars.points.length).toBeGreaterThan(0);
    expect(stars.firstStarAt.slice(0, 10)).toBe(isoDaysAgo(30).slice(0, 10));
    expect(stars.stats.last7Days).toBe(1);
  });

  it('stars: keeps the exact total when GitHub hides the stargazers from someone without write access', async () => {
    const { page } = await signedIn({ '/repos/octo/app/stargazers': notFound });
    const stars = await page<{
      total: number;
      historyHidden: boolean;
      points: unknown[];
      monthly: unknown[];
    }>('stars');
    expect(stars).toMatchObject({ total: 3, historyHidden: true, points: [], monthly: [] });
  });

  it('stars: any other GitHub failure is still reported, not taken for a hidden history', async () => {
    const { send } = await signedIn({
      '/repos/octo/app/stargazers': () =>
        new Response(JSON.stringify({ message: 'Server Error' }), { status: 500 }),
    });
    const res = await send('/api/repos/octo/app/stars');
    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(await res.json()).not.toHaveProperty('historyHidden');
  });

  it('commits: weekly activity, code frequency and the latest commits', async () => {
    const { page } = await signedIn();
    const commits = await page<{
      totals: { lastYear: number };
      codeFrequency: { additions: number; deletions: number }[];
      recent: { sha: string; author: string }[];
    }>('commits');
    expect(commits.totals.lastYear).toBe(4);
    expect(commits.codeFrequency.at(-1)).toMatchObject({ additions: 120, deletions: 30 });
    expect(commits.recent).toEqual([expect.objectContaining({ sha: 'c3', author: 'ana' })]);
  });

  it('pull requests: counts, sizes and the exact monthly chart', async () => {
    const { page } = await signedIn();
    const pulls = await page<{
      counts: object;
      mergeRate: number;
      openOldest: { number: number }[];
      monthly: { opened: number }[];
    }>('pulls');
    expect(pulls.counts).toEqual({ open: 1, merged: 1, closed: 1 });
    expect(pulls.mergeRate).toBe(0.5);
    expect(pulls.openOldest.map((p) => p.number)).toEqual([3]);
    // The monthly chart comes from GitHub search, one count per month.
    expect(pulls.monthly).toHaveLength(12);
    expect(pulls.monthly.every((m) => m.opened === 1)).toBe(true);
  });

  it('issues: labels, most discussed and the exact monthly chart', async () => {
    const { page } = await signedIn();
    const issues = await page<{
      counts: object;
      labels: { name: string; count: number }[];
      mostDiscussed: { number: number }[];
      monthly: unknown[];
    }>('issues');
    expect(issues.counts).toEqual({ open: 2, closed: 1 });
    expect(issues.labels).toEqual([{ name: 'bug', color: 'd73a4a', count: 2 }]);
    expect(issues.mostDiscussed.map((i) => i.number)).toEqual([5]);
    expect(issues.monthly).toHaveLength(12);
  });

  it('contributors: statistics, the total with anonymous authors, and history', async () => {
    const { page } = await signedIn();
    const people = await page<{
      total: number;
      contributors: { login: string; commits: number }[];
      historyPending: boolean;
    }>('contributors');
    expect(people.total).toBe(5);
    expect(people.contributors).toEqual([expect.objectContaining({ login: 'ana', commits: 7 })]);
    expect(people.historyPending).toBe(false);
  });

  it('contributors: an answer GitHub is still computing is not cached', async () => {
    vi.useFakeTimers();
    let ready = false;
    const { send } = await signedIn({
      '/repos/octo/app/stats/contributors': () =>
        ready
          ? json([
              {
                total: 7,
                author: { login: 'ana', avatar_url: '', html_url: '' },
                weeks: [{ w: weekStart(2), a: 1, d: 0, c: 7 }],
              },
            ])
          : computing(),
    });
    const load = async () => {
      const pending = send('/api/repos/octo/app/contributors');
      // GitHub answers 202 while computing; the client retries a few times before giving up.
      await vi.advanceTimersByTimeAsync(10_000);
      return (await (await pending).json()) as { historyPending: boolean };
    };
    expect((await load()).historyPending).toBe(true);
    ready = true;
    expect((await load()).historyPending).toBe(false);
  });

  it('hotspots: skips merge commits and reuses commit details saved on disk', async () => {
    const { page, send, calls } = await signedIn();
    const files = await page<{ commitsAnalyzed: number; files: { path: string; changes: number }[] }>(
      'files',
    );
    expect(files.commitsAnalyzed).toBe(2);
    expect(files.files[0]).toMatchObject({ path: 'src/app/main.ts', changes: 2 });
    expect(files.files.some((f) => f.path === 'README.md')).toBe(false);

    const details = () => calls.filter((c) => /\/commits\/\w+$/.test(c)).length;
    const before = details();
    expect((await send('/api/repos/octo/app/files?refresh=1')).status).toBe(200);
    expect(details()).toBe(before);
  });

  it('actions: success rate, failures and per-workflow results', async () => {
    const { page } = await signedIn();
    const actions = await page<{
      available: boolean;
      successRate: number;
      recentFailures: unknown[];
      workflows: { name: string; runs: number }[];
    }>('actions');
    expect(actions.available).toBe(true);
    expect(actions.successRate).toBe(0.5);
    expect(actions.recentFailures).toHaveLength(1);
    expect(actions.workflows).toEqual([expect.objectContaining({ name: 'CI', runs: 2 })]);
  });

  it('releases: downloads and authors', async () => {
    const { page } = await signedIn();
    const releases = await page<{
      total: number;
      totalDownloads: number;
      releases: { tag: string; author: string }[];
    }>('releases');
    expect(releases.total).toBe(1);
    expect(releases.totalDownloads).toBe(40);
    expect(releases.releases[0]).toMatchObject({ tag: 'v1.0.0', author: 'ana' });
  });

  it('deployments: statuses for the latest 30 only, and exact environment totals', async () => {
    const { page, calls } = await signedIn();
    const deployments = await page<{
      sampleSize: number;
      environments: { name: string; total: number; url: string }[];
    }>('deployments');
    expect(deployments.sampleSize).toBe(35);
    expect(deployments.environments).toEqual([
      expect.objectContaining({ name: 'production', total: 120, url: 'https://app.example.com' }),
    ]);
    expect(calls.filter((c) => c.endsWith('/statuses'))).toHaveLength(30);
  });

  it('rejects unknown sections and invalid repository names', async () => {
    const { send } = await signedIn();
    expect((await send('/api/repos/octo/app/wiki')).status).toBe(404);
    expect((await send('/api/repos/octo/a%20b/stars')).status).toBe(400);
    expect((await send('/api/repos/octo/app/monthly/pr?range=banana')).status).toBe(400);
    expect((await send('/api/repos/octo/app/monthly/commits')).status).toBe(404);
  });

  it('searches GitHub for repositories outside your own list', async () => {
    const { send, urls } = await signedIn();
    const searches = () => urls.filter((u) => u.pathname === '/search/repositories');
    const search = async (q: string) => {
      const res = await send(`/api/search/repos?q=${encodeURIComponent(q)}`);
      return { status: res.status, body: (await res.json()) as { repos: { fullName: string }[] } };
    };

    const found = await search('app');
    expect(found.status).toBe(200);
    expect(found.body.repos.map((r) => r.fullName)).toEqual(['octo/app']);
    expect(searches()[0]!.searchParams.get('q')).toBe('app in:name');

    // The same search again, in any case, comes from the cache.
    await search('APP');
    expect(searches()).toHaveLength(1);

    // owner/name searches that owner's repositories by name, so the exact one comes up.
    await search('octo/ap');
    expect(searches()[1]!.searchParams.get('q')).toBe('ap in:name user:octo');
  });

  it('never lets search qualifiers or odd characters reach GitHub', async () => {
    const { send, urls } = await signedIn();
    for (const bad of ['', 'a user:octo', 'org:x', 'a/b/c', 'x'.repeat(101), '../secret', 'a  b']) {
      const res = await send(`/api/search/repos?q=${encodeURIComponent(bad)}`);
      expect(res.status, bad).toBe(400);
    }
    expect(urls.some((u) => u.pathname === '/search/repositories')).toBe(false);
  });

  it("your pull requests: what waits on you, a summary, and each repository's usual pace", async () => {
    const { send } = await signedIn();
    const list = (await (await send('/api/pulls')).json()) as {
      pulls: { repo: string; number: number; roles: string[]; reviewRequestedAt: string }[];
      counts: Record<string, number>;
    };
    expect(list.pulls).toEqual([
      expect.objectContaining({
        repo: 'octo/app',
        number: 7,
        roles: ['review'],
        reviewRequestedAt: MY_PULL.timelineItems.nodes[0]!.createdAt,
      }),
    ]);
    expect(list.counts).toMatchObject({ all: 1, review: 1, authored: 0 });

    const summary = (await (await send('/api/pulls/summary')).json()) as Record<string, unknown>;
    expect(summary).toMatchObject({ waitingForReview: 1, timeToMergeHours: 24, mergesSampled: 1 });

    const baseline = (await (await send('/api/repos/octo/app/baseline')).json()) as Record<string, unknown>;
    expect(baseline).toEqual({ firstReviewHours: null, mergeHours: 24, size: 50, sample: 1 });
  });

  it('your pull requests from one account only, and nothing but an account name in the search', async () => {
    const { send, urls } = await signedIn();
    expect((await send('/api/pulls?owner=octo')).status).toBe(200);
    const searches = () => urls.filter((u) => u.pathname === '/graphql').length;
    const before = searches();
    for (const bad of ['a%20b', 'user%3Ax', '-octo', 'octo%2Fapp']) {
      expect((await send(`/api/pulls?owner=${bad}`)).status, bad).toBe(400);
    }
    expect(searches()).toBe(before);
  });

  it('one pull request in detail, and the ones that do not exist', async () => {
    const { send } = await signedIn();
    const pull = (await (await send('/api/repos/octo/app/pull/7')).json()) as {
      waitingOn: { kind: string; who: string[] };
      sizePercentile: number;
    };
    expect(pull.waitingOn).toMatchObject({ kind: 'review', who: ['octo'] });
    expect(pull.sizePercentile).toBe(1);
    expect((await send('/api/repos/octo/app/pull/8')).status).toBe(404);
    expect((await send('/api/repos/octo/app/pull/abc')).status).toBe(400);
    expect((await send('/api/repos/octo/a%20b/baseline')).status).toBe(400);
  });

  it('serves monthly counts for a longer window', async () => {
    const { send } = await signedIn();
    const res = await send('/api/repos/octo/app/monthly/issue?range=24');
    const body = (await res.json()) as { months: { opened: number; closed: number }[] };
    expect(body.months).toHaveLength(24);
    expect(body.months[0]).toMatchObject({ opened: 1, closed: 1 });
  });
});
