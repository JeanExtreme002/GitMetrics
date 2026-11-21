import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/server/app';
import { GitHubClient, GitHubError, optional, parseLastPage } from '../src/server/github';
import { ConfigStore, MemoryCache } from '../src/server/store';

type Handler = (url: URL, init?: RequestInit) => Response | undefined;

function fakeFetch(handler: Handler): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    return handler(url, init) ?? new Response(JSON.stringify({ message: 'Not Found' }), { status: 404 });
  }) as typeof fetch;
}

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    status: 200,
    ...init,
    headers: { 'content-type': 'application/json', ...init.headers },
  });

const USER = {
  login: 'octocat',
  name: 'The Octocat',
  avatar_url: '',
  html_url: 'https://github.com/octocat',
  followers: 1,
  following: 2,
  public_repos: 3,
  created_at: '2011-01-25T18:44:36Z',
};

describe('GitHubClient', () => {
  it('parses the last page from a Link header', () => {
    expect(
      parseLastPage(
        '<https://api.github.com/x?page=2>; rel="next", <https://api.github.com/x?page=7>; rel="last"',
      ),
    ).toBe(7);
    expect(parseLastPage(null)).toBe(1);
  });

  it('paginates in parallel and tracks the rate limit', async () => {
    const gh = new GitHubClient(
      't',
      fakeFetch((url) => {
        const page = Number(url.searchParams.get('page') ?? 1);
        return json([page], {
          headers: {
            link: '<https://api.github.com/items?page=3>; rel="last"',
            'x-ratelimit-limit': '5000',
            'x-ratelimit-remaining': '4999',
            'x-ratelimit-reset': '1700000000',
          },
        });
      }),
    );
    expect(await gh.paginate('/items')).toEqual([1, 2, 3]);
    expect(gh.rateLimit?.remaining).toBe(4999);
  });

  it('retries statistics until GitHub has computed them', async () => {
    let calls = 0;
    const gh = new GitHubClient(
      't',
      fakeFetch(() => (++calls < 3 ? new Response(null, { status: 202 }) : json([1]))),
      undefined,
      0,
    );
    expect(await gh.stats('/stats')).toEqual([1]);
    expect(calls).toBe(3);
  });

  it('returns null when statistics never become ready', async () => {
    const gh = new GitHubClient(
      't',
      fakeFetch(() => new Response(null, { status: 202 })),
      undefined,
      0,
    );
    expect(await gh.stats('/stats', 2)).toBeNull();
  });

  it('turns failures into GitHubError and lets optional() absorb 404s', async () => {
    const gh = new GitHubClient(
      't',
      fakeFetch(() => undefined),
    );
    await expect(gh.get('/missing')).rejects.toBeInstanceOf(GitHubError);
    expect(await optional(gh.get('/missing'), 'fallback')).toBe('fallback');
  });
});

describe('MemoryCache', () => {
  it('does not keep failures, so the next request tries again', async () => {
    const cache = new MemoryCache();
    let calls = 0;
    const load = async () => {
      calls++;
      if (calls === 1) throw new Error('GitHub is down');
      return 'ok';
    };
    await expect(cache.wrap('k', 60_000, load)).rejects.toThrow('GitHub is down');
    await expect(cache.wrap('k', 60_000, load)).resolves.toBe('ok');
    expect(calls).toBe(2);
  });

  it('reuses values until forced', async () => {
    const cache = new MemoryCache();
    let n = 0;
    const load = async () => ++n;
    expect(await cache.wrap('k', 1000, load)).toBe(1);
    expect(await cache.wrap('k', 1000, load)).toBe(1);
    expect(await cache.wrap('k', 1000, load, true)).toBe(2);
  });
});

describe('local server', () => {
  let dir: string;
  const github: Handler = (url) => {
    if (url.pathname === '/user') return json(USER, { headers: { 'x-oauth-scopes': 'repo, read:user' } });
    if (url.pathname === '/user/repos') {
      return json([
        {
          id: 1,
          name: 'hello',
          full_name: 'octocat/hello',
          owner: { login: 'octocat', avatar_url: '' },
          description: null,
          private: false,
          fork: false,
          archived: false,
          stargazers_count: 3,
          forks_count: 1,
          watchers_count: 3,
          open_issues_count: 0,
          language: 'Go',
          pushed_at: null,
          created_at: '2020-01-01T00:00:00Z',
          html_url: '',
          default_branch: 'main',
          license: null,
          homepage: null,
          size: 1,
        },
      ]);
    }
    if (url.pathname.endsWith('/releases')) return json([]);
    if (url.pathname === '/repos/octocat/hello') {
      return json({
        id: 1,
        name: 'hello',
        full_name: 'octocat/hello',
        owner: { login: 'octocat', avatar_url: '' },
        description: null,
        private: false,
        fork: false,
        archived: false,
        stargazers_count: 3,
        forks_count: 1,
        watchers_count: 3,
        open_issues_count: 0,
        language: 'Go',
        pushed_at: null,
        created_at: '2020-01-01T00:00:00Z',
        html_url: '',
        default_branch: 'main',
        license: null,
        homepage: null,
        size: 1,
      });
    }
    if (url.pathname.endsWith('/community/profile')) {
      return json({ health_percentage: 100, files: { readme: {}, issue_template: null } });
    }
    if (url.pathname === '/graphql') {
      return json({
        data: {
          repository: {
            pullRequests: { totalCount: 0 },
            issues: { totalCount: 0 },
            releases: { totalCount: 0 },
            isSecurityPolicyEnabled: true,
            defaultBranchRef: null,
          },
        },
      });
    }
    if (url.pathname.endsWith('/contents/.github/ISSUE_TEMPLATE')) {
      return json([{ name: 'bug_report.yml' }]);
    }
    if (url.pathname === '/rate_limit') {
      return json({ resources: { core: { limit: 5000, remaining: 4321, reset: 1_700_000_000 } } });
    }
    return undefined;
  };

  const request = (app: ReturnType<typeof createApp>, url: string, init: RequestInit = {}) =>
    app.request(url, { ...init, headers: { host: 'localhost:4280', ...init.headers } });

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'gitmetrics-'));
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const make = (ghToken: string | null = null) =>
    createApp({ dataDir: dir, fetchImpl: fakeFetch(github), ghToken: async () => ghToken });

  it('rejects requests that are not addressed to localhost', async () => {
    const res = await make().request('/api/auth/status', { headers: { host: 'evil.example' } });
    expect(res.status).toBe(403);
  });

  it('requires the custom header on writes', async () => {
    const res = await request(make(), '/api/auth/logout', { method: 'POST' });
    expect(res.status).toBe(403);
  });

  it('keeps data routes behind sign-in', async () => {
    expect((await request(make(), '/api/repos')).status).toBe(401);
  });

  it('signs in with a token, stores it privately and serves data', async () => {
    const app = make('gho_cli');
    const status = await (await request(app, '/api/auth/status')).json();
    expect(status).toMatchObject({ authenticated: false, methods: { gh: true } });

    const signIn = await request(app, '/api/auth/token', {
      method: 'POST',
      headers: { 'x-gitmetrics': '1', 'content-type': 'application/json' },
      body: JSON.stringify({ token: 'ghp_test' }),
    });
    expect(signIn.status).toBe(200);
    expect(new ConfigStore(dir).auth).toMatchObject({ token: 'ghp_test', login: 'octocat', source: 'token' });
    if (process.platform !== 'win32') {
      expect(statSync(path.join(dir, 'config.json')).mode & 0o777).toBe(0o600);
    }

    const repos = await (await request(app, '/api/repos')).json();
    expect(repos.repos[0].fullName).toBe('octocat/hello');

    const releases = await (await request(app, '/api/repos/octocat/hello/releases')).json();
    expect(releases.total).toBe(0);

    expect((await request(app, '/api/repos/octocat/hello/nope')).status).toBe(404);
  });

  it('counts issue template folders and the security policy', async () => {
    const app = make();
    await request(app, '/api/auth/token', {
      method: 'POST',
      headers: { 'x-gitmetrics': '1', 'content-type': 'application/json' },
      body: JSON.stringify({ token: 'ghp_test' }),
    });
    const overview = await (await request(app, '/api/repos/octocat/hello/overview')).json();
    const files = Object.fromEntries(
      overview.health.files.map((f: { name: string; present: boolean }) => [f.name, f.present]),
    );
    expect(files).toMatchObject({
      README: true,
      'Issue templates': true,
      'Security policy': true,
      'Contributing guide': false,
    });
  });

  it('reports the API budget even before the first GitHub call', async () => {
    const app = make();
    await request(app, '/api/auth/token', {
      method: 'POST',
      headers: { 'x-gitmetrics': '1', 'content-type': 'application/json' },
      body: JSON.stringify({ token: 'ghp_test' }),
    });
    expect(await (await request(app, '/api/rate-limit')).json()).toMatchObject({
      limit: 5000,
      remaining: 4321,
    });
    expect((await request(app, '/api/repos/oct%20cat/hello/stars')).status).toBe(400);
  });

  it('saves favorites and signs out', async () => {
    const app = make('gho_cli');
    const headers = { 'x-gitmetrics': '1', 'content-type': 'application/json' };
    await request(app, '/api/auth/gh', { method: 'POST', headers });
    const saved = await request(app, '/api/favorites', {
      method: 'PUT',
      headers,
      body: JSON.stringify({ favorites: ['octocat/hello', 'octocat/hello', 'bad', 3] }),
    });
    expect(await saved.json()).toEqual({ favorites: ['octocat/hello'] });

    await request(app, '/api/auth/logout', { method: 'POST', headers });
    expect(new ConfigStore(dir).auth).toBeUndefined();
  });

  it('signs out when GitHub rejects the stored token', async () => {
    const headers = { 'x-gitmetrics': '1' };
    let revoked = false;
    const app = createApp({
      dataDir: dir,
      ghToken: async () => 'gho_cli',
      fetchImpl: fakeFetch((url, init) =>
        revoked && url.pathname !== '/user'
          ? json({ message: 'Bad credentials' }, { status: 401 })
          : github(url, init),
      ),
    });
    await request(app, '/api/auth/gh', { method: 'POST', headers });
    revoked = true;
    expect((await request(app, '/api/repos?refresh=1')).status).toBe(401);
    expect(new ConfigStore(dir).auth).toBeUndefined();
  });

  it('reports a GitHub rate limit as 429', async () => {
    const app = createApp({
      dataDir: dir,
      ghToken: async () => 'gho_cli',
      fetchImpl: fakeFetch((url, init) =>
        url.pathname === '/user/repos'
          ? json({ message: 'API rate limit exceeded for user.' }, { status: 403 })
          : github(url, init),
      ),
    });
    await request(app, '/api/auth/gh', { method: 'POST', headers: { 'x-gitmetrics': '1' } });
    const res = await request(app, '/api/repos');
    expect(res.status).toBe(429);
    expect(new ConfigStore(dir).auth).toBeDefined();
  });

  describe('web app files', () => {
    const serve = () => {
      const web = path.join(dir, 'web');
      mkdirSync(path.join(web, 'assets'), { recursive: true });
      writeFileSync(path.join(web, 'index.html'), '<!doctype html>app');
      writeFileSync(path.join(web, 'assets', 'app.js'), 'console.log(1)');
      // Next to the web folder, with a name that starts the same way.
      mkdirSync(path.join(dir, 'web-private'));
      writeFileSync(path.join(dir, 'web-private', 'secret.txt'), 'secret');
      writeFileSync(path.join(dir, 'config.json'), '{"token":"secret"}');
      return createApp({ dataDir: path.join(dir, 'data'), webDir: web, ghToken: async () => null });
    };

    it('serves built files, caching only the hashed assets for long', async () => {
      const res = await request(serve(), '/assets/app.js');
      expect(res.headers.get('content-type')).toBe('text/javascript; charset=utf-8');
      expect(res.headers.get('cache-control')).toContain('immutable');
      expect(await res.text()).toBe('console.log(1)');
    });

    it('answers client-side routes with the app', async () => {
      const res = await request(serve(), '/r/octocat/hello/stars');
      expect(res.headers.get('cache-control')).toBe('no-cache');
      expect(await res.text()).toBe('<!doctype html>app');
    });

    it('never serves files outside the web folder', async () => {
      const app = serve();
      for (const attempt of [
        '/..%2Fconfig.json',
        '/..%2Fweb-private%2Fsecret.txt',
        '/%2E%2E/config.json',
        '/%E0%A4%A',
      ]) {
        const res = await request(app, attempt);
        expect(res.status, attempt).toBe(200);
        expect(await res.text(), attempt).toBe('<!doctype html>app');
      }
    });
  });
});
