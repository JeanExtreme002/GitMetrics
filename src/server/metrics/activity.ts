import type {
  ActivityCommentedResponse,
  ActivityPerson,
  ActivityPull,
  ActivityResponse,
  ActivityScope,
} from '../../shared/types.js';
import { GitHubError, type GitHubClient } from '../github.js';
import { hoursBetween, median } from '../util.js';

/*
 * What someone does with pull requests, as far as you can see: the ones they open, and every
 * review they submit, each by its own date. Read through GitHub's search, which shows what your
 * access allows, private repositories included, unlike the contributions graph, which hides
 * other people's private work.
 *
 * Search returns at most 1,000 results a query: a period with more is split into shorter ones
 * until each fits, so the lists are whole. Reviews are found through the pull requests a person
 * reviewed that changed in the period, with that person's reviews read on each: a review in the
 * period always leaves its pull request updated in it, so none is missed.
 */

const DAY_MS = 86_400_000;
/** GitHub's own ceiling on the results of one search. */
const SEARCH_LIMIT = 1000;
/** Pages read for one list at most, across all its slices: past that, it says it's incomplete. */
const MAX_PAGES = 150;

const PULL = `
  number title url state isDraft createdAt mergedAt updatedAt additions deletions
  repository { nameWithOwner }
  author { login avatarUrl }`;

/** Their own pull requests, with who reviewed them. */
const OPENED = `${PULL}
  reviews(first: 50) { nodes { state author { login avatarUrl } } }`;

/** Pull requests they reviewed, with their reviews alone, each with its date. */
const REVIEWED = `${PULL}
  reviews(author: $login, first: 50) { totalCount nodes { state submittedAt } }`;

export interface RawActivityPull {
  number: number;
  title: string;
  url: string;
  state: 'OPEN' | 'CLOSED' | 'MERGED';
  isDraft: boolean;
  createdAt: string;
  mergedAt: string | null;
  updatedAt: string;
  additions: number;
  deletions: number;
  repository: { nameWithOwner: string };
  author: { login: string; avatarUrl: string } | null;
  reviews?: {
    totalCount?: number;
    nodes: {
      state: string;
      submittedAt?: string | null;
      author?: { login: string; avatarUrl: string } | null;
    }[];
  };
}

/** A day as GitHub's search writes it. */
const day = (date: Date) => date.toISOString().slice(0, 10);

/** The period of the last `days` days, today included, as days. */
export function period(days: number, now = new Date()) {
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const from = new Date(to.getTime() - (days - 1) * DAY_MS);
  return { from: day(from), to: day(to) };
}

const qualifier = (scope: ActivityScope) =>
  scope.kind === 'account' ? ` user:${scope.name}` : scope.kind === 'repo' ? ` repo:${scope.name}` : '';

const SEARCH = (fields: string, withLogin: boolean) => `
query ($q: String!, $first: Int!, $after: String${withLogin ? ', $login: String!' : ''}) {
  search(type: ISSUE, query: $q, first: $first, after: $after) {
    issueCount
    pageInfo { hasNextPage endCursor }
    nodes { ... on PullRequest { ${fields} } }
  }
}`;

interface SearchPage {
  search: {
    issueCount: number;
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    nodes: (RawActivityPull | null)[];
  };
}

/** Why a list may be short, for whoever looks into it. */
export type Shortfall = 'second-over-limit' | 'pages' | 'partial-answer';

/**
 * Search pages asked at once, across every search here: slow one by one, but GitHub limits how
 * hard search can be pressed (its "secondary rate limit"), so never more than a few side by side.
 */
const AT_ONCE = 4;

/** A gate letting `limit` tasks through at a time, the rest waiting their turn. */
function gate(limit: number) {
  let running = 0;
  const waiting: (() => void)[] = [];
  return async <T>(task: () => Promise<T>): Promise<T> => {
    if (running >= limit) await new Promise<void>((resolve) => waiting.push(resolve));
    running++;
    try {
      return await task();
    } finally {
      running--;
      waiting.shift()?.();
    }
  };
}
const searchGate = gate(AT_ONCE);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
/** How long to wait when GitHub asks to slow down anyway, and how many times: tests set it to 0. */
export const coolDown = { ms: 30_000, times: 3 };

/** A moment as search reads it, to the second. */
const moment = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');

/** The period, from its first day's start to its last day's end, cut into slices of `size` days. */
export function slices(from: string, to: string, size: number): [number, number][] {
  const end = Date.parse(to) + DAY_MS - 1000;
  const out: [number, number][] = [];
  for (let t = Date.parse(from); t <= end; t += size * DAY_MS) {
    out.push([t, Math.min(t + size * DAY_MS - 1000, end)]);
  }
  return out;
}

/**
 * Every pull request a search finds with `field` (created or updated) in the period. The period is
 * read in slices, a few pages at once, and a slice holding more than search returns is split in two until
 * each fits. `complete` is false when a single second held more than that, the pages ran out, or GitHub
 * answered a pull request only in part; `short` says which.
 */
export async function searchPeriod(
  gh: GitHubClient,
  base: string,
  field: 'created' | 'updated',
  from: string,
  to: string,
  fields: string,
  first: number,
  login?: string,
): Promise<{ pulls: RawActivityPull[]; complete: boolean; short: Shortfall[] }> {
  const query = SEARCH(fields, Boolean(login));
  let pages = 0;
  const short = new Set<Shortfall>();
  const pulls: RawActivityPull[] = [];

  /**
   * A page of results. Search gives up on a heavy page (502 or 504, its own time running out): asked
   * again with half as many, down to ten. Asked to slow down, it waits and asks again.
   */
  const page = async (q: string, after: string | null) => {
    let size = first;
    let waits = 0;
    for (;;) {
      pages++;
      try {
        const data = await searchGate(() =>
          gh.graphql<SearchPage>(query, { q, first: size, after, ...(login ? { login } : {}) }),
        );
        return data.search;
      } catch (error) {
        if (!(error instanceof GitHubError)) throw error;
        const timedOut = error.status === 502 || error.status === 504;
        const slowDown =
          error.status === 429 || (error.status === 403 && /secondary rate limit/i.test(error.message));
        if (timedOut && size > 10) size = Math.max(10, Math.floor(size / 2));
        else if (slowDown && waits < coolDown.times) {
          waits++;
          await sleep(coolDown.ms);
        } else throw error;
      }
    }
  };

  /** From `start` to `end`, both in milliseconds and both included, to the second. */
  const read = async (start: number, end: number): Promise<void> => {
    if (pages >= MAX_PAGES) {
      short.add('pages');
      return;
    }
    const q = `${base} ${field}:${moment(start)}..${moment(end)}`;
    let result = await page(q, null);
    // More than search returns: two halves, down to the second. A bot touching a thousand pull
    // requests in one day (labels, a mass update) is no reason to stop at days.
    if (result.issueCount > SEARCH_LIMIT && end > start) {
      const mid = start + Math.floor((end - start) / 2000) * 1000;
      await Promise.all([read(start, mid), read(mid + 1000, end)]);
      return;
    }
    if (result.issueCount > SEARCH_LIMIT) short.add('second-over-limit');
    for (;;) {
      for (const node of result.nodes) {
        // A pull request GitHub couldn't answer in full: what's added up from it would be short.
        if (node && node.number !== undefined) pulls.push(node);
        else short.add('partial-answer');
      }
      if (!result.pageInfo.hasNextPage || !result.pageInfo.endCursor) break;
      if (pages >= MAX_PAGES) {
        short.add('pages');
        break;
      }
      result = await page(q, result.pageInfo.endCursor);
    }
  };

  // Slices of about a month, or a week for a short period, all at once: the gate keeps the pages
  // asked at a time down to a few.
  const size = Math.max(7, Math.ceil((Date.parse(to) - Date.parse(from)) / DAY_MS / 12));
  await Promise.all(slices(from, to, size).map(([start, end]) => read(start, end)));
  // One pull request is in one slice only, but a page boundary can repeat it: once each.
  const seen = new Set<string>();
  return {
    pulls: pulls.filter((p) => {
      const key = `${p.repository.nameWithOwner}#${p.number}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }),
    complete: short.size === 0,
    short: [...short],
  };
}

const REVIEW_STATES: Record<string, NonNullable<ActivityPull['review']>> = {
  APPROVED: 'approved',
  CHANGES_REQUESTED: 'changes',
  COMMENTED: 'commented',
  DISMISSED: 'dismissed',
};

const toPull = (r: RawActivityPull, at: string): ActivityPull => ({
  repo: r.repository.nameWithOwner,
  number: r.number,
  title: r.title,
  url: r.url,
  state: r.mergedAt ? 'merged' : r.state === 'OPEN' ? 'open' : 'closed',
  draft: r.isDraft,
  author: r.author ? { login: r.author.login, avatarUrl: r.author.avatarUrl } : null,
  createdAt: r.createdAt,
  mergedAt: r.mergedAt,
  additions: r.additions,
  deletions: r.deletions,
  at,
});

/** People by how often they come up, the most first, ties by login. */
function rank(counts: Map<string, ActivityPerson>, limit = 30): ActivityPerson[] {
  return [...counts.values()]
    .sort((a, b) => b.count - a.count || a.login.localeCompare(b.login))
    .slice(0, limit);
}

function tally(counts: Map<string, ActivityPerson>, who: { login: string; avatarUrl: string }) {
  const entry = counts.get(who.login) ?? { login: who.login, avatarUrl: who.avatarUrl, count: 0 };
  entry.count++;
  counts.set(who.login, entry);
}

/** Puts someone's activity together from what the searches found. */
export function buildActivity(input: {
  user: ActivityResponse['user'];
  scope: ActivityScope;
  days: number;
  from: string;
  to: string;
  opened: { pulls: RawActivityPull[]; complete: boolean };
  reviewed: { pulls: RawActivityPull[]; complete: boolean };
}): ActivityResponse {
  const { user, from, to, days } = input;
  const login = user.login.toLowerCase();
  const start = Date.parse(from);
  const end = Date.parse(to) + DAY_MS;
  const inPeriod = (iso: string | null | undefined) => {
    const t = iso ? Date.parse(iso) : NaN;
    return t >= start && t < end;
  };

  // Day by day for a month, week by week otherwise, from the period's first day.
  const size = days <= 31 ? 1 : 7;
  const buckets = Array.from({ length: Math.ceil(days / size) }, (_, i) => ({
    start: day(new Date(start + i * size * DAY_MS)),
    opened: 0,
    reviews: 0,
  }));
  const bucket = (iso: string) => buckets[Math.floor((Date.parse(iso) - start) / (size * DAY_MS))];

  const repos = new Map<string, { name: string; opened: number; reviews: number }>();
  const repo = (name: string) => {
    const entry = repos.get(name) ?? { name, opened: 0, reviews: 0 };
    repos.set(name, entry);
    return entry;
  };

  // Their own pull requests, opened in the period.
  const opened = input.opened.pulls.filter((p) => inPeriod(p.createdAt));
  const received = new Map<string, ActivityPerson>();
  const mergeHours: number[] = [];
  for (const p of opened) {
    bucket(p.createdAt)!.opened++;
    repo(p.repository.nameWithOwner).opened++;
    if (p.mergedAt) mergeHours.push(hoursBetween(p.createdAt, p.mergedAt));
    for (const r of p.reviews?.nodes ?? []) {
      if (r.author && r.author.login.toLowerCase() !== login && r.state !== 'PENDING')
        tally(received, r.author);
    }
  }

  // Their reviews, each by its own date, on pull requests by others.
  const given = new Map<string, ActivityPerson>();
  const states = { approved: 0, changes: 0, commented: 0, dismissed: 0 };
  let reviewsComplete = input.reviewed.complete;
  const reviewed: ActivityPull[] = [];
  for (const p of input.reviewed.pulls) {
    if (p.author?.login.toLowerCase() === login) continue;
    const reviews = p.reviews;
    if (reviews && (reviews.totalCount ?? 0) > reviews.nodes.length) reviewsComplete = false;
    const mine = (reviews?.nodes ?? []).filter((r) => r.state in REVIEW_STATES && inPeriod(r.submittedAt));
    if (!mine.length) continue;
    for (const r of mine) {
      states[REVIEW_STATES[r.state]!]++;
      bucket(r.submittedAt!)!.reviews++;
      repo(p.repository.nameWithOwner).reviews++;
      if (p.author) tally(given, p.author);
    }
    const latest = mine.reduce((a, b) => (a.submittedAt! >= b.submittedAt! ? a : b));
    reviewed.push({ ...toPull(p, latest.submittedAt!), review: REVIEW_STATES[latest.state] });
  }
  const reviewTotal = states.approved + states.changes + states.commented + states.dismissed;

  return {
    user: input.user,
    scope: input.scope,
    from,
    to,
    days,
    opened: {
      total: opened.length,
      merged: opened.filter((p) => p.mergedAt).length,
      open: opened.filter((p) => !p.mergedAt && p.state === 'OPEN').length,
      closed: opened.filter((p) => !p.mergedAt && p.state !== 'OPEN').length,
      medianMergeHours: median(mergeHours),
      complete: input.opened.complete,
    },
    reviews: { total: reviewTotal, pulls: reviewed.length, ...states, complete: reviewsComplete },
    timeline: buckets,
    repos: [...repos.values()]
      .sort((a, b) => b.opened + b.reviews - (a.opened + a.reviews) || a.name.localeCompare(b.name))
      .slice(0, 30),
    reviewsGiven: rank(given),
    reviewsReceived: rank(received),
    pulls: {
      opened: opened.map((p) => toPull(p, p.createdAt)).sort((a, b) => b.at.localeCompare(a.at)),
      reviewed: reviewed.sort((a, b) => b.at.localeCompare(a.at)),
    },
  };
}

/** No account or repository you can see has the scope's name: search would only find nothing there. */
export class UnknownScope extends Error {}

/**
 * The scope under GitHub's spelling of its name. Search finds nothing in an account or repository
 * that doesn't exist, rather than failing, which would read as someone doing nothing there: so it's
 * looked up first, and an unknown one is an error.
 */
export async function resolveScope(gh: GitHubClient, scope: ActivityScope): Promise<ActivityScope> {
  if (scope.kind === 'all') return scope;
  if (scope.kind === 'account') {
    const data = await gh.graphql<{ repositoryOwner: { login: string } | null }>(
      `query ($login: String!) { repositoryOwner(login: $login) { login } }`,
      { login: scope.name },
    );
    if (!data.repositoryOwner) throw new UnknownScope(scope.name);
    return { kind: 'account', name: data.repositoryOwner.login };
  }
  const [owner, name] = scope.name.split('/') as [string, string];
  const data = await gh.graphql<{ repository: { nameWithOwner: string } | null }>(
    `query ($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { nameWithOwner } }`,
    { owner, name },
  );
  if (!data.repository) throw new UnknownScope(scope.name);
  return { kind: 'repo', name: data.repository.nameWithOwner };
}

/** A user's name and face; null when no user has that login (an organization included). */
async function getUser(gh: GitHubClient, login: string): Promise<ActivityResponse['user'] | null> {
  const data = await gh.graphql<{ user: { login: string; name: string | null; avatarUrl: string } | null }>(
    `query ($login: String!) { user(login: $login) { login name avatarUrl } }`,
    { login },
  );
  return data.user
    ? { login: data.user.login, name: data.user.name || null, avatarUrl: data.user.avatarUrl }
    : null;
}

/** Someone's activity over the last `days` days, in a scope; null when no user has that login. */
export async function getActivity(
  gh: GitHubClient,
  login: string,
  scope: ActivityScope,
  days: number,
  now = new Date(),
): Promise<ActivityResponse | null> {
  const [user, place] = await Promise.all([getUser(gh, login), resolveScope(gh, scope)]);
  if (!user) return null;
  const { from, to } = period(days, now);
  const where = qualifier(place);
  const [opened, reviewed] = await Promise.all([
    searchPeriod(gh, `is:pr author:${user.login}${where}`, 'created', from, to, OPENED, 50),
    searchPeriod(
      gh,
      `is:pr reviewed-by:${user.login}${where}`,
      'updated',
      from,
      to,
      REVIEWED,
      100,
      user.login,
    ),
  ]);
  return buildActivity({ user, scope: place, days, from, to, opened, reviewed });
}

/**
 * Pull requests by others someone commented on that changed in the period, newest first. Search
 * knows who commented, not when, so this is where they took part lately, not their comments' dates.
 */
export async function getCommented(
  gh: GitHubClient,
  login: string,
  scope: ActivityScope,
  days: number,
  now = new Date(),
): Promise<ActivityCommentedResponse> {
  const { from, to } = period(days, now);
  const place = await resolveScope(gh, scope);
  const found = await searchPeriod(
    gh,
    `is:pr commenter:${login} -author:${login}${qualifier(place)}`,
    'updated',
    from,
    to,
    PULL,
    100,
  );
  const pulls = found.pulls.map((p) => toPull(p, p.updatedAt)).sort((a, b) => b.at.localeCompare(a.at));
  return { total: pulls.length, pulls, complete: found.complete };
}
