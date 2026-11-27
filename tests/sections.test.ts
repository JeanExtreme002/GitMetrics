import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
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

/** The same pull request as the detail page reads it: every connection as one complete page. */
const done = { hasNextPage: false, endCursor: null };
const DETAIL = {
  ...MY_PULL,
  id: 'PR_7',
  changedFiles: 1,
  baseRefName: 'main',
  headRefName: 'cache',
  participants: { totalCount: 2 },
  reviews: { totalCount: 0, pageInfo: done, nodes: [] },
  comments: { totalCount: 1, pageInfo: done, nodes: [{ createdAt: isoDaysAgo(1) }] },
  commits: { totalCount: 1, pageInfo: done, nodes: [{ commit: { committedDate: isoDaysAgo(2) } }] },
  threads: { totalCount: 0, pageInfo: done, nodes: [] },
  requests: {
    totalCount: 1,
    pageInfo: done,
    nodes: [{ requestedReviewer: { __typename: 'User', login: 'octo', avatarUrl: '' } }],
  },
  people: {
    totalCount: 2,
    pageInfo: done,
    nodes: [
      { login: 'octocat', avatarUrl: 'https://avatars/octocat' },
      { login: 'octo', avatarUrl: 'https://avatars/octo' },
    ],
  },
  files: { totalCount: 1, pageInfo: done, nodes: [{ path: 'src/cache.ts', additions: 120, deletions: 30 }] },
  // The timeline names each event's type, as GitHub does.
  events: {
    pageInfo: done,
    nodes: MY_PULL.timelineItems.nodes.map((e) => ({ ...e, __typename: 'ReviewRequestedEvent' })),
  },
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
      // A user's page, its totals, and an account that doesn't exist.
      if (query.includes('repositoryOwner(login: $login)')) {
        if (body.variables?.login !== 'octo') return json({ data: { repositoryOwner: null } });
        const sources = {
          totalCount: 2,
          pageInfo: { hasNextPage: false, endCursor: null },
          nodes: [
            { isFork: false, stargazerCount: 3, forkCount: 1, primaryLanguage: { name: 'TypeScript' } },
            { isFork: false, stargazerCount: 2, forkCount: 0, primaryLanguage: null },
          ],
        };
        if (query.includes('after: $after')) return json({ data: { repositoryOwner: { sources } } });
        const count = (totalCount: number) => ({ totalCount });
        return json({
          data: {
            repositoryOwner: {
              __typename: 'User',
              login: 'octo',
              avatarUrl: '',
              url: 'https://github.com/octo',
              name: 'Octo',
              bio: null,
              createdAt: REPO.created_at,
              followers: count(4),
              following: count(1),
              organizations: { nodes: [] },
              all: count(3),
              forks: count(1),
              archived: count(0),
              private: count(0),
              repos: { nodes: [] },
              top: { nodes: [] },
            },
          },
        });
      }
      // Your pull requests: one search per filter, a repository's baseline, one pull request.
      if (query.includes('search(query: $q')) {
        const q = String(body.variables?.q);
        const nodes = q.includes('review-requested:@me') ? [MY_PULL] : [];
        return json({ data: { search: { issueCount: nodes.length, nodes } } });
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
      // The commits of a pull request, for which files they keep coming back to.
      if (query.includes('oid parents')) {
        const nodes = [
          { commit: { oid: 'c3', parents: { totalCount: 1 } } },
          { commit: { oid: 'm2', parents: { totalCount: 2 } } },
          { commit: { oid: 'c1', parents: { totalCount: 1 } } },
        ];
        return json({
          data: {
            repository: {
              pullRequest: {
                commits: { totalCount: 3, pageInfo: { hasNextPage: false, endCursor: null }, nodes },
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
      if (url.searchParams.get('per_page') === '30') {
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

  it("an account's page, its totals and repositories, and the accounts search", async () => {
    const { send } = await signedIn({
      '/users/octo/repos': () => json([REPO]),
      '/search/users': () => json({ items: [{ login: 'octo', avatar_url: '', type: 'User' }] }),
      '/users/Copilot[bot]': () =>
        json({ login: 'Copilot[bot]', type: 'Bot', html_url: 'https://github.com/apps/copilot' }),
    });
    const account = (await (await send('/api/accounts/octo')).json()) as Record<string, unknown>;
    expect(account).toMatchObject({
      kind: 'user',
      login: 'octo',
      followers: 4,
      repositories: { total: 3, sources: 2 },
    });
    const { totals } = (await (await send('/api/accounts/octo/totals')).json()) as { totals: unknown };
    expect(totals).toEqual({ stars: 5, forks: 1, languages: [{ name: 'TypeScript', count: 1 }] });
    const repos = (await (await send('/api/accounts/octo/repos')).json()) as {
      repos: { fullName: string }[];
    };
    expect(repos.repos.map((r) => r.fullName)).toEqual(['octo/app']);
    const search = (await (await send('/api/search/accounts?q=octo')).json()) as { accounts: unknown[] };
    expect(search.accounts).toEqual([{ login: 'octo', avatarUrl: '', kind: 'user' }]);

    expect((await send('/api/accounts/nobody')).status).toBe(404);
    // An app's name, as GitHub writes it on pull requests: told apart, with its page on GitHub.
    const app = await send('/api/accounts/Copilot');
    expect(app.status).toBe(404);
    expect(await app.json()).toMatchObject({
      app: { login: 'Copilot[bot]', url: 'https://github.com/apps/copilot' },
    });
    // An organization's pages answer for any account; quality and security always, the rest only
    // when found.
    expect(await (await send('/api/accounts/octo/quality')).json()).toEqual({ quality: null });
    expect(await (await send('/api/accounts/octo/security')).json()).toEqual({ security: null });
    expect(await (await send('/api/accounts/octo/alerts')).json()).toEqual({
      severity: { critical: 0, high: 0, moderate: 0, low: 0 },
      repositories: [],
      details: {
        age: { month: 0, quarter: 0, year: 0, older: 0 },
        oldestCritical: null,
        ecosystems: [],
        packages: [],
      },
    });
    expect((await send('/api/accounts/nobody/sponsors')).status).toBe(404);
    expect((await send('/api/accounts/octo/projects')).status).toBe(404);
    // Only the pages' own names: not any address with one of them in it.
    expect((await send('/api/accounts/octo/peoplex')).status).toBe(404);
    for (const path of [
      '/api/accounts/bad..name',
      '/api/accounts/-x/totals',
      '/api/accounts/-x/people',
      '/api/accounts/octo/teams/bad..name',
      '/api/accounts/bad..name/quality',
      '/api/accounts/bad..name/security',
      '/api/search/accounts?q=two%20words',
      // Activity: a user, a scope and a period it knows.
      '/api/activity/-x',
      '/api/activity/octo?days=7',
      '/api/activity/octo?days=731',
      '/api/activity/octo?in=a/b/c',
      '/api/activity/octo?in=bad..name',
      '/api/activity/octo/commented?days=abc',
      '/api/activity/octo?from=2026-03-01&to=2026-01-01',
      '/api/activity/octo?from=2020-01-01',
    ]) {
      expect((await send(path)).status, path).toBe(400);
    }
  });

  it('keeps the traffic history growing on its own, for your repositories and the ones you open', async () => {
    const day = isoDaysAgo(1);
    const traffic = (kind: string) => () =>
      json({ count: 4, uniques: 3, [kind]: [{ timestamp: day, count: 4, uniques: 3 }] });
    const { send, page, calls } = await signedIn({
      '/user/repos': () => json([REPO]),
      '/repos/octo/app/traffic/views': traffic('views'),
      '/repos/octo/app/traffic/clones': traffic('clones'),
    });
    // Opening a repository's page: a visit, and the first request starts today's collection.
    await page('stars');
    const history = path.join(dir, 'traffic', 'octo__app.json');
    await vi.waitFor(() => expect(existsSync(history)).toBe(true));
    expect(JSON.parse(readFileSync(history, 'utf8'))).toEqual({
      views: { [day.slice(0, 10)]: [4, 3] },
      clones: { [day.slice(0, 10)]: [4, 3] },
    });
    // The pull request list's baselines, and a page that didn't load, aren't visits.
    await send('/api/repos/acme/api/baseline');
    await send('/api/repos/acme/missing/stars');
    const saved = JSON.parse(readFileSync(path.join(dir, 'collection.json'), 'utf8'));
    expect(Object.keys(saved.octo.visits)).toEqual(['octo/app']);
    expect(saved.octo.collectedOn).toBe(new Date().toISOString().slice(0, 10));
    // Once a day: later requests don't collect again.
    const asked = calls.filter((c) => c.includes('/traffic/')).length;
    await page('stars');
    expect(calls.filter((c) => c.includes('/traffic/')).length).toBe(asked);
  });

  it('collects every day while it stays open, with nobody on the page', async () => {
    vi.useFakeTimers({
      now: new Date('2026-11-22T10:00:00Z'),
      toFake: ['Date', 'setTimeout', 'setInterval'],
    });
    try {
      const traffic = (kind: string) => () =>
        json({ count: 1, uniques: 1, [kind]: [{ timestamp: '2026-11-21T00:00:00Z', count: 1, uniques: 1 }] });
      const github = fakeGitHub({
        '/user/repos': () => json([REPO]),
        '/repos/octo/app/traffic/views': traffic('views'),
        '/repos/octo/app/traffic/clones': traffic('clones'),
      });
      const app = createApp({
        dataDir: dir,
        fetchImpl: github.fetchImpl,
        ghToken: async () => 'gho_cli',
        collectEvery: 60 * 60_000,
      });
      const send = (url: string, init: RequestInit = {}) =>
        app.request(url, {
          ...init,
          headers: { host: 'localhost:4280', 'x-gitmetrics': '1', ...init.headers },
        });
      const collections = () => github.calls.filter((c) => c.endsWith('/traffic/views')).length;

      // Signing in starts the day's collection; no page is opened afterwards.
      expect((await send('/api/auth/gh', { method: 'POST' })).status).toBe(200);
      await vi.waitFor(() => expect(collections()).toBe(1));
      // The same day, the clock finds it done.
      await vi.advanceTimersByTimeAsync(5 * 60 * 60_000);
      expect(collections()).toBe(1);
      // Past midnight (UTC), the next check collects again.
      await vi.advanceTimersByTimeAsync(10 * 60 * 60_000);
      await vi.waitFor(() => expect(collections()).toBe(2));
    } finally {
      vi.useRealTimers();
    }
  });

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

  it("your pull requests: what waits on you, and each repository's usual pace", async () => {
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

    const baseline = (await (await send('/api/repos/octo/app/baseline')).json()) as Record<string, unknown>;
    // Its dates are made from "now" a moment apart, so the hours can be off by a hair.
    expect(baseline).toEqual({
      firstReviewHours: null,
      mergeHours: expect.closeTo(24, 3),
      size: 50,
      sample: 1,
    });
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

  it('searches your pull requests on GitHub, and only with plain words', async () => {
    const { send, urls } = await signedIn();
    const res = await send('/api/pulls?state=closed&q=cache%20bug&tab=authored');
    expect(res.status).toBe(200);
    const searches = () => urls.filter((u) => u.pathname === '/graphql').length;
    const before = searches();
    for (const bad of ['user%3Aother', '%22quoted%22', 'a%2Fb', 'x'.repeat(101)]) {
      expect((await send(`/api/pulls?q=${bad}`)).status, bad).toBe(400);
    }
    expect((await send('/api/pulls?q=cache&tab=everything')).status).toBe(400);
    expect(searches()).toBe(before);
  });

  it('which files the commits of a pull request keep coming back to', async () => {
    const { send } = await signedIn();
    const { churn } = (await (await send('/api/repos/octo/app/pull/7/churn')).json()) as {
      churn: { commits: number; merges: number; files: { path: string; commits: number }[] };
    };
    expect(churn).toMatchObject({ commits: 2, merges: 1 });
    expect(churn.files).toEqual([expect.objectContaining({ path: 'src/app/main.ts', commits: 2 })]);
    expect((await send('/api/repos/octo/app/pull/x/churn')).status).toBe(400);
  });

  it('one pull request in detail, and the ones that do not exist', async () => {
    const { send } = await signedIn();
    const pull = (await (await send('/api/repos/octo/app/pull/7')).json()) as {
      waitingOn: { kind: string; who: string[] };
      folders: { path: string }[];
      comments: number;
    };
    expect(pull.waitingOn).toMatchObject({ kind: 'review', who: ['octo'] });
    expect(pull.folders.map((f) => f.path)).toEqual(['src']);
    expect(pull.comments).toBe(1);
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
