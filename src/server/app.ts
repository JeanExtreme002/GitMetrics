import { closeSync, existsSync, fstatSync, openSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { Hono, type Context } from 'hono';
import type { AuthStatus, RepoBaseline, ReposResponse, SearchResponse, UpdateInfo } from '../shared/types.js';
import { DeviceFlow, clientId, readGhToken, validateToken } from './auth.js';
import { GitHubClient, GitHubError } from './github.js';
import { getActions } from './metrics/actions.js';
import { getCommits } from './metrics/commits.js';
import { getContributors } from './metrics/contributors.js';
import { getFiles } from './metrics/files.js';
import { getIssues, getMonthlyCounts, getPulls, windowMonths } from './metrics/pulls.js';
import { getDeployments, getReleases } from './metrics/releases.js';
import { getActivityRanking, getTrafficRanking } from './metrics/rankings.js';
import { getOverview, getRepo, listRepos, searchRepos } from './metrics/repos.js';
import { getBaseline, getMyPulls, getMySummary } from './metrics/mine.js';
import { getPull } from './metrics/pull.js';
import { getStars } from './metrics/stars.js';
import { getTraffic } from './metrics/traffic.js';
import { ConfigStore, DiskCache, MemoryCache, TrafficStore } from './store.js';

const MINUTE = 60_000;
const NAME = /^[A-Za-z0-9_.-]{1,100}$/;
/**
 * What the quick search accepts: words made of GitHub's name characters, or owner/name (an
 * account name is letters, digits and hyphens only). Nothing
 * else, so no search qualifiers (user:, org:...) can be slipped into the GitHub query.
 */
const SEARCH = /^(?:[A-Za-z0-9_.-]+(?: [A-Za-z0-9_.-]+)*|[A-Za-z0-9-]+\/[A-Za-z0-9_.-]*)$/;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

export interface AppOptions {
  dataDir?: string;
  webDir?: string | null;
  fetchImpl?: typeof fetch;
  ghToken?: () => Promise<string | null>;
  /** What the CLI found out about updates when it started. */
  update?: UpdateInfo;
}

type Section = (gh: GitHubClient, owner: string, repo: string, c: Context) => Promise<unknown>;

export function createApp(options: AppOptions = {}) {
  const config = new ConfigStore(options.dataDir);
  const commitCache = new DiskCache(path.join(config.dir, 'cache'));
  const traffic = new TrafficStore(path.join(config.dir, 'traffic'));
  const memory = new MemoryCache();
  const fetchImpl = options.fetchImpl ?? fetch;
  const ghToken = options.ghToken ?? readGhToken;
  let device = new DeviceFlow(fetchImpl);
  let client: { token: string; gh: GitHubClient } | null = null;

  const github = (): GitHubClient | null => {
    const auth = config.auth;
    if (!auth) return null;
    if (client?.token !== auth.token)
      client = { token: auth.token, gh: new GitHubClient(auth.token, fetchImpl) };
    return client.gh;
  };

  const signIn = async (token: string, source: 'device' | 'token' | 'gh') => {
    const { viewer, scopes } = await validateToken(token, fetchImpl);
    config.setAuth({ token, source, login: viewer.login, scopes, createdAt: new Date().toISOString() });
    memory.clear();
    return viewer;
  };

  const app = new Hono();

  // Only answer requests addressed to this machine (blocks DNS rebinding), and require a
  // custom header on writes so other websites cannot trigger them from the browser.
  app.use('*', async (c, next) => {
    const host = (c.req.header('host') ?? '').replace(/:\d+$/, '');
    if (!LOCAL_HOSTS.has(host)) return c.text('Forbidden', 403);
    if (c.req.method !== 'GET' && c.req.path.startsWith('/api') && c.req.header('x-gitmetrics') !== '1') {
      return c.json({ error: 'Missing request header.', status: 403 }, 403);
    }
    await next();
  });

  app.onError((error, c) => {
    if (error instanceof GitHubError) {
      if (error.status === 401) config.clearAuth();
      const status = error.status === 403 && /rate limit/i.test(error.message) ? 429 : error.status;
      return c.json({ error: error.message, status }, status as 400);
    }
    console.error(error);
    return c.json({ error: 'Something went wrong on the local server.', status: 500 }, 500);
  });

  app.get('/api/update', (c) =>
    c.json(
      options.update ?? ({ current: '', latest: null, available: false, command: null } satisfies UpdateInfo),
    ),
  );

  // Auth ------------------------------------------------------------------

  app.get('/api/auth/status', async (c) => {
    const gh = github();
    const status: AuthStatus = {
      authenticated: false,
      methods: { device: Boolean(clientId()), gh: Boolean(await ghToken()) },
    };
    if (!gh) return c.json(status);
    const user = await memory.wrap(`viewer:${config.auth!.login}`, 5 * MINUTE, () =>
      validateToken(config.auth!.token, fetchImpl),
    );
    return c.json({
      ...status,
      authenticated: true,
      viewer: user.viewer,
      scopes: user.scopes,
      source: config.auth!.source,
    } satisfies AuthStatus);
  });

  app.post('/api/auth/device/start', async (c) => {
    device = new DeviceFlow(fetchImpl);
    return c.json(await device.start());
  });

  app.post('/api/auth/device/poll', async (c) => {
    const { token, ...result } = await device.poll();
    if (token) await signIn(token, 'device');
    return c.json(result);
  });

  app.post('/api/auth/token', async (c) => {
    const body = await c.req.json<{ token?: string }>().catch(() => ({ token: undefined }));
    const token = body.token?.trim();
    if (!token) return c.json({ error: 'Paste a token to continue.', status: 400 }, 400);
    return c.json({ viewer: await signIn(token, 'token') });
  });

  app.post('/api/auth/gh', async (c) => {
    const token = await ghToken();
    if (!token) return c.json({ error: 'No GitHub CLI session was found.', status: 404 }, 404);
    return c.json({ viewer: await signIn(token, 'gh') });
  });

  app.post('/api/auth/logout', (c) => {
    config.clearAuth();
    memory.clear();
    client = null;
    return c.json({ ok: true });
  });

  // Everything below needs a signed-in user.
  app.use('/api/*', async (c, next) => {
    if (c.req.path.startsWith('/api/auth/')) return next();
    if (!github()) return c.json({ error: 'You are not signed in.', status: 401 }, 401);
    await next();
  });

  app.get('/api/rate-limit', async (c) => {
    const gh = github()!;
    // GET /rate_limit does not count against the limit, so these readings are free.
    // Read it fresh when unknown or when the hourly window has already reset.
    if (!gh.rateLimit || new Date(gh.rateLimit.resetAt).getTime() <= Date.now()) {
      const { resources } = await gh.get<{
        resources: { core: { limit: number; remaining: number; reset: number } };
      }>('/rate_limit');
      gh.rateLimit = {
        limit: resources.core.limit,
        remaining: resources.core.remaining,
        resetAt: new Date(resources.core.reset * 1000).toISOString(),
      };
    }
    return c.json(gh.rateLimit);
  });

  app.get('/api/repos', async (c) => {
    const gh = github()!;
    const repos = await memory.wrap(
      `${config.auth!.login}:repos`,
      10 * MINUTE,
      () => listRepos(gh),
      c.req.query('refresh') === '1',
    );
    return c.json({ repos, favorites: config.favorites } satisfies ReposResponse);
  });

  // Your pull requests, across every repository ---------------------------------

  /** What a repository's merged pull requests usually look like, kept for an hour. */
  const baseline = (gh: GitHubClient, repo: string) =>
    memory.wrap(`${config.auth!.login}:baseline:${repo.toLowerCase()}`, 60 * MINUTE, () =>
      getBaseline(gh, repo),
    );

  const myPulls = (state: 'open' | 'closed', refresh = false) => {
    const gh = github()!;
    const login = config.auth!.login;
    return memory.wrap(`${login}:my-pulls:${state}`, 2 * MINUTE, () => getMyPulls(gh, login, state), refresh);
  };

  app.get('/api/pulls', async (c) => {
    const state = c.req.query('state') === 'closed' ? 'closed' : 'open';
    return c.json(await myPulls(state, c.req.query('refresh') === '1'));
  });

  // A repository's usual review and merge times, to put its pull requests in context.
  app.get('/api/repos/:owner/:repo/baseline', async (c) => {
    const { owner, repo } = c.req.param();
    if (!NAME.test(owner) || !NAME.test(repo)) {
      return c.json({ error: 'Invalid repository name.', status: 400 }, 400);
    }
    const { firstReviewHours, mergeHours, size, sample } = await baseline(github()!, `${owner}/${repo}`);
    return c.json({ firstReviewHours, mergeHours, size, sample } satisfies RepoBaseline);
  });

  // One pull request, with how it compares with the repository's usual ones.
  app.get('/api/repos/:owner/:repo/pull/:number', async (c) => {
    const { owner, repo, number } = c.req.param();
    if (!NAME.test(owner) || !NAME.test(repo) || !/^\d{1,9}$/.test(number)) {
      return c.json({ error: 'Invalid pull request.', status: 400 }, 400);
    }
    const gh = github()!;
    const pull = await memory.wrap(
      `${config.auth!.login}:pull:${owner}/${repo}#${number}`.toLowerCase(),
      2 * MINUTE,
      async () => getPull(gh, owner, repo, Number(number), await baseline(gh, `${owner}/${repo}`)),
      c.req.query('refresh') === '1',
    );
    if (!pull) return c.json({ error: 'Pull request not found.', status: 404 }, 404);
    return c.json(pull);
  });

  app.get('/api/pulls/summary', async (c) => {
    const login = config.auth!.login;
    const refresh = c.req.query('refresh') === '1';
    const summary = await memory.wrap(
      `${login}:my-pulls:summary`,
      30 * MINUTE,
      async () => getMySummary(github()!, login, await myPulls('open')),
      refresh,
    );
    return c.json(summary);
  });

  // Repositories anywhere on GitHub, for opening one that is not in your own list.
  app.get('/api/search/repos', async (c) => {
    const text = (c.req.query('q') ?? '').trim();
    if (text.length > 100 || !SEARCH.test(text)) {
      return c.json({ error: 'Invalid search.', status: 400 }, 400);
    }
    const repos = await memory.wrap(`${config.auth!.login}:search:${text.toLowerCase()}`, 10 * MINUTE, () =>
      searchRepos(github()!, text),
    );
    return c.json({ repos } satisfies SearchResponse);
  });

  app.get('/api/rankings/:mode', async (c) => {
    const gh = github()!;
    const login = config.auth!.login;
    const mode = c.req.param('mode');
    const refresh = c.req.query('refresh') === '1';
    if (mode === 'activity') {
      return c.json(
        await memory.wrap(`${login}:ranking:activity`, 30 * MINUTE, () => getActivityRanking(gh), refresh),
      );
    }
    if (mode === 'traffic') {
      const repos = await memory.wrap(`${login}:repos`, 10 * MINUTE, () => listRepos(gh));
      const owned = repos.filter((r) => r.owner.toLowerCase() === login.toLowerCase() && !r.fork);
      return c.json(
        await memory.wrap(
          `${login}:ranking:traffic`,
          30 * MINUTE,
          () => getTrafficRanking(gh, traffic, owned),
          refresh,
        ),
      );
    }
    return c.json({ error: 'Unknown ranking.', status: 404 }, 404);
  });

  app.put('/api/favorites', async (c) => {
    const body = await c.req.json<{ favorites?: unknown }>().catch(() => ({ favorites: [] }));
    const favorites = Array.isArray(body.favorites)
      ? body.favorites.filter((f): f is string => typeof f === 'string' && f.includes('/'))
      : [];
    config.setFavorites(favorites);
    return c.json({ favorites: config.favorites });
  });

  app.post('/api/cache/clear', (c) => {
    memory.clear();
    commitCache.clear();
    return c.json({ ok: true });
  });

  // Repository sections ---------------------------------------------------

  const repoTotal = async (gh: GitHubClient, owner: string, repo: string) =>
    (await memory.wrap(`${owner}/${repo}:meta`, 10 * MINUTE, () => getRepo(gh, owner, repo)))
      .stargazers_count;

  const sections: Record<string, { ttl: number; load: Section }> = {
    overview: { ttl: 10 * MINUTE, load: (gh, o, r) => getOverview(gh, o, r) },
    stars: { ttl: 60 * MINUTE, load: async (gh, o, r) => getStars(gh, o, r, await repoTotal(gh, o, r)) },
    traffic: { ttl: 30 * MINUTE, load: (gh, o, r) => getTraffic(gh, traffic, o, r) },
    commits: { ttl: 30 * MINUTE, load: (gh, o, r) => getCommits(gh, o, r) },
    pulls: { ttl: 15 * MINUTE, load: (gh, o, r) => getPulls(gh, o, r) },
    issues: { ttl: 15 * MINUTE, load: (gh, o, r) => getIssues(gh, o, r) },
    contributors: { ttl: 60 * MINUTE, load: (gh, o, r) => getContributors(gh, o, r) },
    files: {
      ttl: 60 * MINUTE,
      load: (gh, o, r, c) => {
        const limit = Math.min(Math.max(Number(c.req.query('commits')) || 100, 20), 300);
        return getFiles(gh, commitCache, o, r, limit);
      },
    },
    actions: { ttl: 10 * MINUTE, load: (gh, o, r) => getActions(gh, o, r) },
    releases: { ttl: 30 * MINUTE, load: (gh, o, r) => getReleases(gh, o, r) },
    deployments: { ttl: 15 * MINUTE, load: (gh, o, r) => getDeployments(gh, o, r) },
  };

  // Monthly pull request or issue counts for any window, straight from GitHub search.
  app.get('/api/repos/:owner/:repo/monthly/:kind', async (c) => {
    const { owner, repo, kind } = c.req.param();
    if (!NAME.test(owner) || !NAME.test(repo)) {
      return c.json({ error: 'Invalid repository name.', status: 400 }, 400);
    }
    if (kind !== 'pr' && kind !== 'issue') return c.json({ error: 'Unknown kind.', status: 404 }, 404);
    const range = c.req.query('range') ?? '12';
    if (!/^(all|\d{1,3})$/.test(range)) return c.json({ error: 'Unknown range.', status: 400 }, 400);
    const gh = github()!;
    const meta = await memory.wrap(`${owner}/${repo}:meta`, 10 * MINUTE, () => getRepo(gh, owner, repo));
    let months: string[];
    try {
      months = windowMonths(range, meta.created_at);
    } catch {
      return c.json({ error: 'Unknown range.', status: 400 }, 400);
    }
    const counts = await memory.wrap(
      `${config.auth!.login}:${owner}/${repo}:monthly:${kind}:${range}`,
      30 * MINUTE,
      () => getMonthlyCounts(gh, `${owner}/${repo}`, kind, months),
      c.req.query('refresh') === '1',
    );
    return c.json({ months: counts });
  });

  app.get('/api/repos/:owner/:repo/:section', async (c) => {
    const { owner, repo, section } = c.req.param();
    const entry = sections[section];
    if (!entry) return c.json({ error: 'Unknown section.', status: 404 }, 404);
    if (!NAME.test(owner) || !NAME.test(repo)) {
      return c.json({ error: 'Invalid repository name.', status: 400 }, 400);
    }

    const gh = github()!;
    const key = `${config.auth!.login}:${owner}/${repo}:${section}:${c.req.query('commits') ?? ''}`;
    const result = await memory.wrap(
      key,
      entry.ttl,
      () => entry.load(gh, owner, repo, c),
      c.req.query('refresh') === '1',
    );
    // GitHub is still computing statistics: don't keep the empty or partial answer around.
    const state = result as { pending?: boolean; historyPending?: boolean };
    if (state.pending || state.historyPending) memory.delete(key);
    return c.json(result);
  });

  app.all('/api/*', (c) => c.json({ error: 'Not found.', status: 404 }, 404));

  // Static web app --------------------------------------------------------

  const webDir = options.webDir;
  if (webDir && existsSync(webDir)) {
    // Read on every request so a rebuild shows up on refresh, without restarting.
    const index = () => readFileSync(path.join(webDir, 'index.html'));
    const root = path.resolve(webDir);
    app.get('*', (c) => {
      const file = resolveInside(root, c.req.path);
      const body = file ? readRegularFile(file) : null;
      if (file && body) {
        const immutable = c.req.path.startsWith('/assets/');
        return c.body(body, 200, {
          'Content-Type': contentType(file),
          'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
        });
      }
      return c.body(index(), 200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-cache',
      });
    });
  }

  return app;
}

/**
 * Reads a regular file, or returns null for anything else. The file is opened once and checked
 * through that same descriptor, so it cannot be swapped between the check and the read.
 */
export function readRegularFile(file: string): Buffer<ArrayBuffer> | null {
  let fd: number;
  try {
    fd = openSync(file, 'r');
  } catch {
    return null;
  }
  try {
    return fstatSync(fd).isFile() ? readFileSync(fd) : null;
  } catch {
    return null;
  } finally {
    closeSync(fd);
  }
}

/**
 * Maps a URL path to a file inside root, or null when it would point anywhere else. Comparing
 * against root plus a separator keeps out sibling folders whose names start the same way.
 */
export function resolveInside(root: string, urlPath: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  const file = path.resolve(root, `.${path.sep}${decoded}`);
  return file.startsWith(root + path.sep) ? file : null;
}

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.webmanifest': 'application/manifest+json',
};

const contentType = (file: string) => TYPES[path.extname(file)] ?? 'application/octet-stream';
