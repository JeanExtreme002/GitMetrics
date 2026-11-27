import { closeSync, existsSync, fstatSync, openSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { Hono, type Context } from 'hono';
import type {
  ActivityScope,
  AuthStatus,
  PullFilter,
  RepoBaseline,
  ReposResponse,
  SearchResponse,
  UpdateInfo,
} from '../shared/types.js';
import { DeviceFlow, clientId, readGhToken, validateToken } from './auth.js';
import { CollectionStore, TrafficCollector } from './collect.js';
import { GitHubClient, GitHubError } from './github.js';
import { getAccount, getAccountRepos, getAccountTotals, searchAccounts } from './metrics/accounts.js';
import { getActions } from './metrics/actions.js';
import { UnknownScope, getActivity, getCommented } from './metrics/activity.js';
import {
  getAlertDetails,
  buildQuality,
  getSecurity,
  readOrgRepos,
  getMemberTeams,
  getPeople,
  getSponsors,
  getTeams,
} from './metrics/organizations.js';
import { getCommits } from './metrics/commits.js';
import { getContributors } from './metrics/contributors.js';
import { getFiles } from './metrics/files.js';
import { getIssues, getMonthlyCounts, getPulls, windowMonths } from './metrics/pulls.js';
import { getDeployments, getReleases } from './metrics/releases.js';
import { getActivityRanking, getTrafficRanking } from './metrics/rankings.js';
import { getOverview, getRepo, listRepos, searchRepos } from './metrics/repos.js';
import { ACCOUNT, SEARCH_TEXT, getBaseline, getMyPulls } from './metrics/mine.js';
import { getPullChurn } from './metrics/churn.js';
import { getPull } from './metrics/pull.js';
import { getStars } from './metrics/stars.js';
import { getTraffic } from './metrics/traffic.js';
import { ConfigStore, DiskCache, MemoryCache, TrafficStore } from './store.js';

const MINUTE = 60_000;
const TABS = new Set<string>(['all', 'authored', 'assigned', 'involved', 'review', 'owned']);
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
  /** Set to false to leave the traffic history alone (tests that count requests). */
  collectTraffic?: boolean;
  /**
   * How often the server itself checks that today's traffic was collected, in ms. The CLI sets it,
   * so a GitMetrics left open for days collects every day even with nobody on the page.
   */
  collectEvery?: number;
  /** What the CLI found out about updates when it started. */
  update?: UpdateInfo;
}

type Section = (gh: GitHubClient, owner: string, repo: string, c: Context) => Promise<unknown>;

export function createApp(options: AppOptions = {}) {
  const config = new ConfigStore(options.dataDir);
  const commitCache = new DiskCache(path.join(config.dir, 'cache'));
  const traffic = new TrafficStore(path.join(config.dir, 'traffic'));
  const memory = new MemoryCache();
  const collection = new CollectionStore(config.dir);
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

  // Your repositories, shared by the pages and the traffic collection.
  const ownRepos = (gh: GitHubClient) =>
    memory.wrap(`${config.auth!.login}:repos`, 10 * MINUTE, () => listRepos(gh));
  const collector = new TrafficCollector(traffic, collection, ownRepos);
  const collect = () => {
    const gh = github();
    if (gh && options.collectTraffic !== false) collector.poke(gh, config.auth!.login);
  };
  if (options.collectEvery) {
    // Right away when it starts (if signed in), then on a clock: once a day is all it collects.
    setTimeout(collect, 0).unref();
    setInterval(collect, options.collectEvery).unref();
  }

  const signIn = async (token: string, source: 'device' | 'token' | 'gh') => {
    const { viewer, scopes } = await validateToken(token, fetchImpl);
    config.setAuth({ token, source, login: viewer.login, scopes, createdAt: new Date().toISOString() });
    memory.clear();
    // Signed in: the day's collection starts now, without waiting for a page.
    collect();
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
    const gh = github();
    if (!gh) return c.json({ error: 'You are not signed in.', status: 401 }, 401);
    // Keeps the traffic history growing: once a day, in the background, never in the way.
    collect();
    await next();
  });

  // A repository opened in GitMetrics keeps its traffic collected for a year. Only once its page
  // loaded, so a mistyped address doesn't count; the pull request list's baselines aren't visits.
  app.use('/api/repos/:owner/:repo/*', async (c, next) => {
    await next();
    const { owner, repo } = c.req.param();
    if (c.res.status !== 200 || !NAME.test(owner) || !NAME.test(repo) || c.req.path.endsWith('/baseline'))
      return;
    collection.visit(config.auth!.login, `${owner}/${repo}`);
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

  const myPulls = (
    state: 'open' | 'closed',
    owner = '',
    refresh = false,
    search?: { text: string; tab: PullFilter },
  ) => {
    const gh = github()!;
    const login = config.auth!.login;
    const searched = search ? `:${search.tab}:${search.text.toLowerCase()}` : '';
    return memory.wrap(
      `${login}:my-pulls:${state}:${owner.toLowerCase()}${searched}`,
      2 * MINUTE,
      () => getMyPulls(gh, login, state, owner || undefined, search),
      refresh,
    );
  };

  app.get('/api/pulls', async (c) => {
    const state = c.req.query('state') === 'closed' ? 'closed' : 'open';
    // Only an account name reaches the search, so nothing else can be slipped into it.
    const owner = c.req.query('owner') ?? '';
    if (owner && !ACCOUNT.test(owner)) return c.json({ error: 'Invalid account.', status: 400 }, 400);
    // A text search: plain words only, looked up on GitHub for the open tab.
    const text = (c.req.query('q') ?? '').trim();
    const tab = (c.req.query('tab') ?? 'all') as PullFilter;
    if (text && (text.length > 100 || !SEARCH_TEXT.test(text) || !TABS.has(tab))) {
      return c.json({ error: 'Invalid search.', status: 400 }, 400);
    }
    const search = text ? { text, tab } : undefined;
    return c.json(await myPulls(state, owner, c.req.query('refresh') === '1', search));
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

  // Which files and folders a pull request's commits keep coming back to. Read apart from the
  // rest of the page, since it takes one request per commit the first time.
  app.get('/api/repos/:owner/:repo/pull/:number/churn', async (c) => {
    const { owner, repo, number } = c.req.param();
    if (!NAME.test(owner) || !NAME.test(repo) || !/^\d{1,9}$/.test(number)) {
      return c.json({ error: 'Invalid pull request.', status: 400 }, 400);
    }
    const gh = github()!;
    const churn = await memory.wrap(
      `${config.auth!.login}:pull-churn:${owner}/${repo}#${number}`.toLowerCase(),
      10 * MINUTE,
      () => getPullChurn(gh, commitCache, owner, repo, Number(number)),
      c.req.query('refresh') === '1',
    );
    return c.json({ churn });
  });

  // One pull request, everything about it exact.
  app.get('/api/repos/:owner/:repo/pull/:number', async (c) => {
    const { owner, repo, number } = c.req.param();
    if (!NAME.test(owner) || !NAME.test(repo) || !/^\d{1,9}$/.test(number)) {
      return c.json({ error: 'Invalid pull request.', status: 400 }, 400);
    }
    const gh = github()!;
    const pull = await memory.wrap(
      `${config.auth!.login}:pull:${owner}/${repo}#${number}`.toLowerCase(),
      2 * MINUTE,
      () => getPull(gh, owner, repo, Number(number)),
      c.req.query('refresh') === '1',
    );
    if (!pull) return c.json({ error: 'Pull request not found.', status: 404 }, 404);
    return c.json(pull);
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

  // Accounts ------------------------------------------------------------------

  // A user's or an organization's page.
  app.get('/api/accounts/:login', async (c) => {
    const login = c.req.param('login');
    if (!ACCOUNT.test(login)) return c.json({ error: 'Invalid account.', status: 400 }, 400);
    const account = await memory.wrap(
      `${config.auth!.login}:account:${login.toLowerCase()}`,
      10 * MINUTE,
      () => getAccount(github()!, login),
      c.req.query('refresh') === '1',
    );
    if (!account) return c.json({ error: 'No user or organization has this name.', status: 404 }, 404);
    return c.json(account);
  });

  // Stars, forks and languages over an account's repositories: apart, as they take longer.
  app.get('/api/accounts/:login/totals', async (c) => {
    const login = c.req.param('login');
    if (!ACCOUNT.test(login)) return c.json({ error: 'Invalid account.', status: 400 }, 400);
    const totals = await memory.wrap(
      `${config.auth!.login}:account-totals:${login.toLowerCase()}`,
      10 * MINUTE,
      () => getAccountTotals(github()!, login),
      c.req.query('refresh') === '1',
    );
    return c.json({ totals });
  });

  // An organization's people and teams, and any account's security and quality and sponsors.
  // The teams one member of an organization belongs to.
  app.get('/api/accounts/:login/teams/:member', async (c) => {
    const { login, member } = c.req.param();
    if (!ACCOUNT.test(login) || !ACCOUNT.test(member)) {
      return c.json({ error: 'Invalid account.', status: 400 }, 400);
    }
    const result = await memory.wrap(
      `${config.auth!.login}:member-teams:${login.toLowerCase()}:${member.toLowerCase()}`,
      10 * MINUTE,
      () => getMemberTeams(github()!, login, member),
      c.req.query('refresh') === '1',
    );
    if (!result) return c.json({ error: 'No organization has this name.', status: 404 }, 404);
    return c.json(result);
  });

  const ORG_PAGES: Record<string, (gh: GitHubClient, login: string) => Promise<unknown>> = {
    people: getPeople,
    teams: getTeams,
    sponsors: getSponsors,
  };
  // One exact route each: a pattern like {people|teams|sponsors} isn't anchored, and would answer
  // for any page with one of those words in it.
  for (const [page, load] of Object.entries(ORG_PAGES)) {
    app.get(`/api/accounts/:login/${page}`, async (c) => {
      const login = c.req.param('login');
      if (!ACCOUNT.test(login)) return c.json({ error: 'Invalid account.', status: 400 }, 400);
      const result = await memory.wrap(
        `${config.auth!.login}:account-${page}:${login.toLowerCase()}`,
        10 * MINUTE,
        () => load(github()!, login),
        c.req.query('refresh') === '1',
      );
      if (result === null) return c.json({ error: 'No organization has this name.', status: 404 }, 404);
      return c.json(result);
    });
  }

  // An organization's quality and security pages measure the same repositories: read once for both.
  const orgRepos = (login: string, refresh: boolean) =>
    memory.wrap(
      `${config.auth!.login}:org-repos:${login.toLowerCase()}`,
      10 * MINUTE,
      () => readOrgRepos(github()!, login),
      refresh,
    );
  const orgSecurity = (login: string, refresh: boolean) =>
    memory.wrap(
      `${config.auth!.login}:org-security:${login.toLowerCase()}`,
      10 * MINUTE,
      async () => {
        const repos = await orgRepos(login, refresh);
        return repos ? getSecurity(github()!, repos) : null;
      },
      refresh,
    );

  // Null for an account with too many repositories to read: an answer, not a miss.
  app.get('/api/accounts/:login/quality', async (c) => {
    const login = c.req.param('login');
    if (!ACCOUNT.test(login)) return c.json({ error: 'Invalid account.', status: 400 }, 400);
    const repos = await orgRepos(login, c.req.query('refresh') === '1');
    return c.json({ quality: repos ? buildQuality(repos) : null });
  });

  app.get('/api/accounts/:login/security', async (c) => {
    const login = c.req.param('login');
    if (!ACCOUNT.test(login)) return c.json({ error: 'Invalid account.', status: 400 }, 400);
    return c.json({ security: await orgSecurity(login, c.req.query('refresh') === '1') });
  });

  // Open Dependabot alerts in detail, read after the security page's counts as they take longer:
  // from the repositories it found alerts on.
  app.get('/api/accounts/:login/alerts', async (c) => {
    const login = c.req.param('login');
    if (!ACCOUNT.test(login)) return c.json({ error: 'Invalid account.', status: 400 }, 400);
    const refresh = c.req.query('refresh') === '1';
    const security = await orgSecurity(login, false);
    const repositories = security?.alerts?.repositories ?? [];
    return c.json(
      await memory.wrap(
        `${config.auth!.login}:account-alerts:${login.toLowerCase()}`,
        10 * MINUTE,
        () => getAlertDetails(github()!, repositories),
        refresh,
      ),
    );
  });

  // The repositories of an account outside your own list.
  app.get('/api/accounts/:login/repos', async (c) => {
    const login = c.req.param('login');
    if (!ACCOUNT.test(login)) return c.json({ error: 'Invalid account.', status: 400 }, 400);
    const organization = c.req.query('kind') === 'organization';
    return c.json(
      await memory.wrap(
        `${config.auth!.login}:account-repos:${organization ? 'org' : 'user'}:${login.toLowerCase()}`,
        10 * MINUTE,
        () => getAccountRepos(github()!, login, organization),
        c.req.query('refresh') === '1',
      ),
    );
  });

  // Someone's activity with pull requests over a period, in all of GitHub, one account or one repo.
  const ACTIVITY_DAYS = new Set([30, 90, 365]);
  /** The scope in ?in=: nothing for all of GitHub, a login for an account, owner/name for a repo. */
  const activityScope = (value: string | undefined): ActivityScope | null => {
    const text = (value ?? '').trim();
    if (!text) return { kind: 'all' };
    const [owner, name, extra] = text.split('/');
    if (name !== undefined) {
      return extra === undefined && ACCOUNT.test(owner!) && NAME.test(name)
        ? { kind: 'repo', name: text }
        : null;
    }
    return ACCOUNT.test(text) ? { kind: 'account', name: text } : null;
  };
  /** A scope no account or repository you can see has: a miss, not a failure. */
  const unknownScope = (error: unknown) =>
    error instanceof UnknownScope ||
    (error instanceof GitHubError && /cannot be searched/i.test(error.message));
  const activityRoute =
    (
      load: (gh: GitHubClient, login: string, scope: ActivityScope, days: number) => Promise<unknown>,
      kind: string,
    ) =>
    async (c: Context) => {
      const login = c.req.param('login') ?? '';
      const scope = activityScope(c.req.query('in'));
      const days = Number(c.req.query('days') ?? 90);
      if (!ACCOUNT.test(login) || !scope || !ACTIVITY_DAYS.has(days)) {
        return c.json({ error: 'Invalid user, scope or period.', status: 400 }, 400);
      }
      const where = scope.kind === 'all' ? '' : scope.name.toLowerCase();
      try {
        const result = await memory.wrap(
          `${config.auth!.login}:activity-${kind}:${login.toLowerCase()}:${where}:${days}`,
          10 * MINUTE,
          () => load(github()!, login, scope, days),
          c.req.query('refresh') === '1',
        );
        if (result === null) return c.json({ error: 'No user has this name.', status: 404 }, 404);
        return c.json(result);
      } catch (error) {
        if (unknownScope(error)) {
          return c.json({ error: 'No account or repository you can see has this name.', status: 404 }, 404);
        }
        throw error;
      }
    };
  app.get('/api/activity/:login', activityRoute(getActivity, 'summary'));
  // What they commented on: asked only when it's opened, as it's another search of its own.
  app.get('/api/activity/:login/commented', activityRoute(getCommented, 'commented'));

  // Accounts whose login matches, for the quick search.
  app.get('/api/search/accounts', async (c) => {
    const text = (c.req.query('q') ?? '').trim();
    if (!ACCOUNT.test(text)) return c.json({ error: 'Invalid search.', status: 400 }, 400);
    const accounts = await memory.wrap(
      `${config.auth!.login}:search-accounts:${text.toLowerCase()}`,
      10 * MINUTE,
      () => searchAccounts(github()!, text),
    );
    return c.json({ accounts });
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
      const repos = await ownRepos(gh);
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
