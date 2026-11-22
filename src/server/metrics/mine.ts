import type {
  ChecksState,
  MyPull,
  MyPullsResponse,
  MyPullsSummary,
  PullCheck,
  PullFilter,
  RepoBaseline,
} from '../../shared/types.js';
import type { GitHubClient } from '../github.js';
import { hoursBetween, median } from '../util.js';

// Checks ------------------------------------------------------------------

export interface RawCheck {
  __typename?: string;
  name?: string;
  conclusion?: string | null;
  status?: string;
  startedAt?: string | null;
  completedAt?: string | null;
  context?: string;
  state?: string;
}

const CONCLUSIONS: Record<string, PullCheck['conclusion']> = {
  SUCCESS: 'success',
  FAILURE: 'failure',
  TIMED_OUT: 'failure',
  STARTUP_FAILURE: 'failure',
  ACTION_REQUIRED: 'failure',
  ERROR: 'failure',
  CANCELLED: 'cancelled',
  SKIPPED: 'skipped',
  NEUTRAL: 'neutral',
  STALE: 'neutral',
  PENDING: 'pending',
  EXPECTED: 'pending',
};

/**
 * The checks on a commit, one per name (the latest run wins, so a run cancelled and started
 * again doesn't count as a failure), with how long each took.
 */
export function readChecks(raw: RawCheck[]): PullCheck[] {
  const latest = new Map<string, RawCheck>();
  for (const check of raw) {
    const name = check.name ?? check.context ?? '';
    const previous = latest.get(name);
    if (!previous || (check.startedAt ?? '') >= (previous.startedAt ?? '')) latest.set(name, check);
  }
  return [...latest.entries()].map(([name, check]) => {
    const value = check.conclusion ?? check.state ?? null;
    const minutes =
      check.startedAt && check.completedAt
        ? Math.max(0, hoursBetween(check.startedAt, check.completedAt) * 60)
        : null;
    return { name, conclusion: value ? (CONCLUSIONS[value] ?? 'neutral') : 'pending', minutes };
  });
}

/** Failing if any check fails, pending while any runs, passing once something passed. */
export function checksState(checks: PullCheck[]): ChecksState | null {
  if (checks.some((c) => c.conclusion === 'failure')) return 'failure';
  if (checks.some((c) => c.conclusion === 'pending')) return 'pending';
  return checks.some((c) => c.conclusion === 'success') ? 'success' : null;
}

// Your pull requests --------------------------------------------------------

const CHECKS_FIELDS = `
  commits(last: 1) { nodes { commit { statusCheckRollup { contexts(first: 40) { nodes {
    __typename
    ... on CheckRun { name conclusion status startedAt completedAt }
    ... on StatusContext { context state }
  } } } } } }`;

const PULL_FIELDS = `
fragment pull on PullRequest {
  number title url state isDraft createdAt updatedAt mergedAt closedAt additions deletions reviewDecision
  author { login avatarUrl }
  repository { nameWithOwner name owner { login avatarUrl } }
  reviews(first: 20) { nodes { submittedAt author { __typename login } } }
  reviewRequests(first: 20) { nodes { requestedReviewer { __typename ... on User { login } } } }
  timelineItems(last: 20, itemTypes: [REVIEW_REQUESTED_EVENT]) {
    nodes { ... on ReviewRequestedEvent { createdAt requestedReviewer { __typename ... on User { login } } } }
  }
  ${CHECKS_FIELDS}
}`;

/** Pull requests per filter. Fewer than this many keeps each search to a couple of seconds. */
const PER_FILTER = 30;

const LIST_QUERY = `
query ($q: String!) {
  search(query: $q, type: ISSUE, first: ${PER_FILTER}) { issueCount nodes { ...pull } }
}
${PULL_FIELDS}`;

/**
 * Closed pull requests only need their dates: reviews, requests and checks no longer matter, and
 * leaving them out makes the search several times faster.
 */
const CLOSED_QUERY = `
query ($q: String!) {
  search(query: $q, type: ISSUE, first: ${PER_FILTER}) { issueCount nodes { ... on PullRequest {
    number title url state isDraft createdAt updatedAt mergedAt closedAt additions deletions
    author { login avatarUrl }
    repository { nameWithOwner name owner { login avatarUrl } }
  } } }
}`;

interface Login {
  login: string;
}

/** Who a review was asked from: a person, or a team (whose members aren't listed). */
interface Reviewer {
  __typename?: string;
  login?: string;
}

/** A request to you, or to a team. GitHub's review-requested:@me counts your teams too. */
const askedOf = (reviewer: Reviewer | null | undefined, login: string) =>
  same(reviewer?.login, login) || reviewer?.__typename === 'Team';

export interface RawListPull {
  number: number;
  title: string;
  url: string;
  state: MyPull['state'];
  isDraft: boolean;
  createdAt: string;
  updatedAt: string;
  mergedAt: string | null;
  closedAt: string | null;
  additions: number;
  deletions: number;
  reviewDecision?: MyPull['reviewDecision'];
  author: (Login & { avatarUrl: string }) | null;
  repository: { nameWithOwner: string; name: string; owner: { login: string; avatarUrl: string } };
  reviews: { nodes: { submittedAt: string | null; author: (Login & { __typename?: string }) | null }[] };
  reviewRequests: { nodes: { requestedReviewer: Reviewer | null }[] };
  timelineItems: { nodes: { createdAt?: string; requestedReviewer?: Reviewer | null }[] };
  commits?: { nodes: { commit: { statusCheckRollup: { contexts: { nodes: RawCheck[] } } | null } }[] };
}

type Role = Exclude<PullFilter, 'all' | 'involved'>;
type SearchResult = { search: { issueCount: number; nodes: (RawListPull | object)[] } };

const same = (a: string | null | undefined, b: string) => (a ?? '').toLowerCase() === b.toLowerCase();

/** Reviews posted by apps (coverage reports, code scanning, AI reviewers) aren't a person reviewing. */
export const isBot = (who: { __typename?: string } | null | undefined) => who?.__typename === 'Bot';

/** The first review by a person other than the author. */
export function firstReviewAt(pull: {
  author: Login | null;
  reviews: RawListPull['reviews'];
}): string | null {
  const times = pull.reviews.nodes
    .filter((r) => r.submittedAt && !isBot(r.author) && !same(r.author?.login, pull.author?.login ?? ''))
    .map((r) => r.submittedAt!)
    .sort();
  return times[0] ?? null;
}

/**
 * While your review is pending: when it was last asked of you, or of one of your teams when no
 * request names you (team members aren't listed, so any team request counts).
 */
export function reviewRequestedAt(pull: RawListPull, login: string, requested: boolean): string | null {
  const events = pull.timelineItems.nodes.filter((e) => e.createdAt);
  const latest = (list: typeof events) =>
    list
      .map((e) => e.createdAt!)
      .sort()
      .at(-1);
  const toYou = latest(events.filter((e) => same(e.requestedReviewer?.login, login)));
  if (toYou) return toYou;
  if (!requested) return null;
  return latest(events.filter((e) => askedOf(e.requestedReviewer, login))) ?? pull.createdAt;
}

export function toMyPull(raw: RawListPull, login: string, roles: Role[]): MyPull {
  const contexts = raw.commits?.nodes[0]?.commit.statusCheckRollup?.contexts.nodes ?? [];
  return {
    repo: raw.repository.nameWithOwner,
    owner: raw.repository.owner.login,
    name: raw.repository.name,
    ownerAvatarUrl: raw.repository.owner.avatarUrl,
    number: raw.number,
    title: raw.title,
    url: raw.url,
    author: raw.author?.login ?? null,
    authorAvatarUrl: raw.author?.avatarUrl ?? null,
    state: raw.state,
    isDraft: raw.isDraft,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    mergedAt: raw.mergedAt,
    closedAt: raw.closedAt,
    additions: raw.additions,
    deletions: raw.deletions,
    reviewDecision: raw.reviewDecision ?? null,
    checks: checksState(readChecks(contexts)),
    reviewRequestedAt:
      raw.state === 'OPEN' && roles.includes('review') ? reviewRequestedAt(raw, login, true) : null,
    firstReviewAt: raw.reviews ? firstReviewAt(raw) : null,
    roles,
  };
}

/** GitHub's own search, one query per filter, all in a single request. */
export function searchQueries(state: 'open' | 'closed'): Record<Exclude<PullFilter, 'all'>, string> {
  const base = `is:pr is:${state} archived:false sort:updated-desc`;
  return {
    authored: `${base} author:@me`,
    assigned: `${base} assignee:@me`,
    involved: `${base} involves:@me`,
    // Review requests go away once you review, so closed ones are the ones you reviewed.
    review: state === 'open' ? `${base} review-requested:@me` : `${base} reviewed-by:@me`,
  };
}

export async function getMyPulls(
  gh: GitHubClient,
  login: string,
  state: 'open' | 'closed',
): Promise<MyPullsResponse> {
  // One request per filter, side by side: a single request with all four takes their sum.
  const queries = searchQueries(state);
  const filters = ['authored', 'assigned', 'involved', 'review'] as const;
  const results = await Promise.all(
    filters.map((filter) =>
      gh.graphql<SearchResult>(state === 'open' ? LIST_QUERY : CLOSED_QUERY, { q: queries[filter] }),
    ),
  );

  const byKey = new Map<string, { raw: RawListPull; roles: Set<Role> }>();
  filters.forEach((filter, i) => {
    for (const node of results[i]!.search.nodes) {
      if (!('number' in node)) continue;
      const key = `${node.repository.nameWithOwner}#${node.number}`;
      const entry = byKey.get(key) ?? { raw: node, roles: new Set<Role>() };
      if (filter !== 'involved') entry.roles.add(filter);
      byKey.set(key, entry);
    }
  });
  const pulls = [...byKey.values()]
    .map(({ raw, roles }) => toMyPull(raw, login, [...roles]))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  const count = (filter: (typeof filters)[number]) => results[filters.indexOf(filter)]!.search.issueCount;
  return {
    state,
    pulls,
    counts: {
      all: pulls.length,
      authored: count('authored'),
      assigned: count('assigned'),
      involved: count('involved'),
      review: count('review'),
    },
  };
}

// Repository baselines -------------------------------------------------------

export const EMPTY_BASELINE: RepoBaseline = {
  firstReviewHours: null,
  mergeHours: null,
  size: null,
  sample: 0,
};

const BASELINE_QUERY = `
query ($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    pullRequests(first: 50, states: MERGED, orderBy: { field: UPDATED_AT, direction: DESC }) {
      nodes {
        createdAt mergedAt additions deletions author { login }
        reviews(first: 10) { nodes { submittedAt author { __typename login } } }
      }
    }
  }
}`;

interface RawMerged {
  createdAt: string;
  mergedAt: string;
  additions: number;
  deletions: number;
  author: Login | null;
  reviews: RawListPull['reviews'];
}

export interface Baseline extends RepoBaseline {
  /** Every size in the sample, to place one pull request among them. */
  sizes: number[];
}

export function buildBaseline(merged: RawMerged[]): Baseline {
  const reviewHours = merged.flatMap((p) => {
    const first = firstReviewAt(p);
    return first ? [hoursBetween(p.createdAt, first)] : [];
  });
  const sizes = merged.map((p) => p.additions + p.deletions);
  return {
    firstReviewHours: median(reviewHours),
    mergeHours: median(merged.map((p) => hoursBetween(p.createdAt, p.mergedAt))),
    size: median(sizes),
    sample: merged.length,
    sizes,
  };
}

/** What the repository's latest merged pull requests usually look like. */
export async function getBaseline(gh: GitHubClient, repo: string): Promise<Baseline> {
  const [owner, name] = repo.split('/');
  const data = await gh.graphql<{ repository: { pullRequests: { nodes: RawMerged[] } } | null }>(
    BASELINE_QUERY,
    { owner, name },
  );
  return buildBaseline(data.repository?.pullRequests.nodes ?? []);
}

/** The share of `sizes` that are smaller than `size`, from 0 to 1. */
export function percentile(size: number, sizes: number[]): number | null {
  if (!sizes.length) return null;
  return sizes.filter((s) => s < size).length / sizes.length;
}

// Your summary ---------------------------------------------------------------

const SUMMARY_QUERY = `
query ($reviewed: String!, $merged: String!, $login: String!) {
  reviewed: search(query: $reviewed, type: ISSUE, first: 30) { nodes { ... on PullRequest {
    reviews(author: $login, first: 1) { nodes { submittedAt } }
    timelineItems(first: 30, itemTypes: [REVIEW_REQUESTED_EVENT]) {
      nodes { ... on ReviewRequestedEvent { createdAt requestedReviewer { __typename ... on User { login } } } }
    }
  } } }
  merged: search(query: $merged, type: ISSUE, first: 30) { nodes { ... on PullRequest { createdAt mergedAt } } }
}`;

interface RawReviewed {
  reviews?: { nodes: { submittedAt: string | null }[] };
  timelineItems?: RawListPull['timelineItems'];
}

/**
 * For each review you did after being asked: hours from the latest request to you (or, when none
 * names you, to a team) before your first review. Reviews nobody asked for are left out.
 */
export function reviewTurnarounds(reviewed: RawReviewed[], login: string): number[] {
  return reviewed.flatMap((pull) => {
    const reviewedAt = pull.reviews?.nodes[0]?.submittedAt;
    if (!reviewedAt) return [];
    const before = (pull.timelineItems?.nodes ?? []).filter((e) => e.createdAt && e.createdAt <= reviewedAt);
    const latest = (list: typeof before) =>
      list
        .map((e) => e.createdAt!)
        .sort()
        .at(-1);
    const asked =
      latest(before.filter((e) => same(e.requestedReviewer?.login, login))) ??
      latest(before.filter((e) => askedOf(e.requestedReviewer, login)));
    return asked ? [hoursBetween(asked, reviewedAt)] : [];
  });
}

export async function getMySummary(
  gh: GitHubClient,
  login: string,
  open: MyPullsResponse,
): Promise<MyPullsSummary> {
  const data = await gh.graphql<{
    reviewed: { nodes: RawReviewed[] };
    merged: { nodes: { createdAt?: string; mergedAt?: string | null }[] };
  }>(SUMMARY_QUERY, {
    reviewed: 'is:pr reviewed-by:@me sort:updated-desc',
    merged: 'is:pr author:@me is:merged sort:updated-desc',
    login,
  });
  const turnarounds = reviewTurnarounds(data.reviewed.nodes, login);
  const merges = data.merged.nodes.flatMap((p) =>
    p.createdAt && p.mergedAt ? [hoursBetween(p.createdAt, p.mergedAt)] : [],
  );
  const waiting = open.pulls.filter((p) => p.reviewRequestedAt);
  return {
    waitingForReview: open.counts.review,
    oldestWaitSince: waiting.map((p) => p.reviewRequestedAt!).sort()[0] ?? null,
    openAuthored: open.counts.authored,
    reviewTurnaroundHours: median(turnarounds),
    reviewsSampled: turnarounds.length,
    timeToMergeHours: median(merges),
    mergesSampled: merges.length,
  };
}
