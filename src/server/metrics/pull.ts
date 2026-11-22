import type { PullDetail, PullReviewer, PullStage } from '../../shared/types.js';
import type { GitHubClient } from '../github.js';
import { hoursBetween } from '../util.js';
import {
  type Baseline,
  type RawCheck,
  checksState,
  commentCount,
  isBot,
  percentile,
  readChecks,
} from './mine.js';

const CHECK_NODES = `nodes {
  __typename
  ... on CheckRun { name conclusion status startedAt completedAt }
  ... on StatusContext { context state }
}`;

const PULL_QUERY = `
query ($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      number title url state isDraft createdAt mergedAt closedAt reviewDecision
      additions deletions changedFiles baseRefName headRefName
      author { login avatarUrl }
      commits { totalCount }
      comments { totalCount }
      reviewThreads { totalCount }
      threadComments: reviewThreads(first: 100) { nodes { comments { totalCount } } }
      written: reviews(first: 100) { nodes { body } }
      participants { totalCount }
      reviewRequests(first: 30) {
        nodes { requestedReviewer { __typename ... on User { login avatarUrl } ... on Team { name } } }
      }
      timelineItems(first: 250, itemTypes: [
        READY_FOR_REVIEW_EVENT, CONVERT_TO_DRAFT_EVENT, REVIEW_REQUESTED_EVENT, PULL_REQUEST_REVIEW,
        HEAD_REF_FORCE_PUSHED_EVENT, MERGED_EVENT
      ]) {
        nodes {
          __typename
          ... on ReadyForReviewEvent { createdAt }
          ... on ConvertToDraftEvent { createdAt }
          ... on ReviewRequestedEvent {
            createdAt
            requestedReviewer { __typename ... on User { login avatarUrl } ... on Team { name } }
          }
          ... on PullRequestReview { submittedAt state author { __typename login avatarUrl } }
          ... on HeadRefForcePushedEvent { createdAt }
          ... on MergedEvent { createdAt }
        }
      }
      history: commits(last: 50) {
        nodes { commit { committedDate statusCheckRollup { contexts(first: 30) { ${CHECK_NODES} } } } }
      }
      latest: commits(last: 1) {
        nodes { commit { statusCheckRollup { contexts(first: 100) { ${CHECK_NODES} } } } }
      }
    }
  }
}`;

interface Person {
  __typename?: string;
  login: string;
  avatarUrl: string;
}

interface Requested {
  __typename: string;
  login?: string;
  avatarUrl?: string;
  name?: string;
}

interface Event {
  __typename: string;
  createdAt?: string;
  submittedAt?: string | null;
  state?: string;
  author?: Person | null;
  requestedReviewer?: Requested | null;
}

type Contexts = { contexts: { nodes: RawCheck[] } } | null;

export interface RawPull {
  number: number;
  title: string;
  url: string;
  state: PullDetail['state'];
  isDraft: boolean;
  createdAt: string;
  mergedAt: string | null;
  closedAt: string | null;
  reviewDecision: 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED' | null;
  additions: number;
  deletions: number;
  changedFiles: number;
  baseRefName: string;
  headRefName: string;
  author: Person | null;
  commits: { totalCount: number };
  comments: { totalCount: number };
  reviewThreads: { totalCount: number };
  /** Comments on the code, thread by thread, and every review's summary: see commentCount. */
  threadComments?: { nodes: { comments: { totalCount: number } }[] };
  written?: { nodes: { body: string | null }[] };
  participants: { totalCount: number };
  reviewRequests: { nodes: { requestedReviewer: Requested | null }[] };
  timelineItems: { nodes: Event[] };
  history: { nodes: { commit: { committedDate: string; statusCheckRollup: Contexts } }[] };
  latest: { nodes: { commit: { statusCheckRollup: Contexts } }[] };
}

/** A person by login, a team by name. */
const reviewerKey = (r: Requested) => (r.login ?? r.name ?? '').toLowerCase();

export function buildPull(raw: RawPull, repo: string, baseline: Baseline, now = new Date()): PullDetail {
  const author = raw.author?.login ?? null;
  const events = raw.timelineItems.nodes;
  const byAuthor = (login: string | undefined) => !!author && login?.toLowerCase() === author.toLowerCase();

  // Reviews by other people, in order. Pending (unsubmitted) reviews and apps don't count.
  const reviews = events
    .filter(
      (e) =>
        e.__typename === 'PullRequestReview' &&
        e.submittedAt &&
        e.author &&
        !isBot(e.author) &&
        !byAuthor(e.author.login),
    )
    .sort((a, b) => a.submittedAt!.localeCompare(b.submittedAt!));
  const firstReview = reviews[0]?.submittedAt ?? null;
  const firstApproval = reviews.find((r) => r.state === 'APPROVED')?.submittedAt ?? null;
  const ready = events.find((e) => e.__typename === 'ReadyForReviewEvent')?.createdAt ?? null;
  const merged = raw.mergedAt;
  // Review time starts when the pull request was ready for it.
  const reviewStart = ready ?? raw.createdAt;

  const stages: Omit<PullStage, 'hours'>[] = [{ kind: 'opened', at: raw.createdAt }];
  if (ready) stages.push({ kind: 'ready', at: ready });
  if (firstReview) stages.push({ kind: 'first-review', at: firstReview });
  if (firstApproval) stages.push({ kind: 'approved', at: firstApproval });
  if (merged) stages.push({ kind: 'merged', at: merged });
  else if (raw.state === 'CLOSED' && raw.closedAt) stages.push({ kind: 'closed', at: raw.closedAt });
  stages.sort((a, b) => a.at.localeCompare(b.at));
  const timed = stages.map((s, i) => ({ ...s, hours: i ? hoursBetween(stages[i - 1]!.at, s.at) : null }));

  // Reviewers: everyone who reviewed, plus everyone still asked to.
  const pending = new Set(
    raw.reviewRequests.nodes.flatMap((r) => (r.requestedReviewer ? [reviewerKey(r.requestedReviewer)] : [])),
  );
  const people = new Map<string, PullReviewer>();
  const person = (who: Requested): PullReviewer => {
    const key = reviewerKey(who);
    const known = people.get(key);
    if (known) return known;
    const entry: PullReviewer = {
      login: who.login ?? who.name ?? '',
      avatarUrl: who.avatarUrl ?? null,
      state: 'PENDING',
      reviews: 0,
      requestedAt: null,
      firstReviewAt: null,
      responseHours: null,
    };
    people.set(key, entry);
    return entry;
  };
  for (const e of events) {
    if (e.__typename === 'ReviewRequestedEvent' && e.requestedReviewer && e.createdAt) {
      const r = person(e.requestedReviewer);
      r.requestedAt ??= e.createdAt;
    }
  }
  for (const review of reviews) {
    const r = person({ __typename: 'User', ...review.author! });
    r.reviews++;
    r.firstReviewAt ??= review.submittedAt!;
    // A later comment doesn't undo an approval or a request for changes.
    if (review.state !== 'COMMENTED' || r.state === 'PENDING')
      r.state = review.state as PullReviewer['state'];
  }
  for (const r of people.values()) {
    if (pending.has(r.login.toLowerCase())) r.state = 'PENDING';
    if (r.firstReviewAt) {
      const from = r.requestedAt && r.requestedAt <= r.firstReviewAt ? r.requestedAt : reviewStart;
      r.responseHours = Math.max(0, hoursBetween(from, r.firstReviewAt));
    }
  }
  const reviewers = [...people.values()].filter((r) => r.reviews > 0 || pending.has(r.login.toLowerCase()));

  // Checks: the latest commit in full, and how many commits had failing checks along the way.
  const latestChecks = readChecks(raw.latest.nodes[0]?.commit.statusCheckRollup?.contexts.nodes ?? []);
  const withChecks = raw.history.nodes
    .map((n) => n.commit.statusCheckRollup)
    .filter((c): c is NonNullable<Contexts> => c !== null)
    .map((c) => checksState(readChecks(c.contexts.nodes)));
  const minutes = latestChecks.flatMap((c) => (c.minutes === null ? [] : [c.minutes]));
  const checks = {
    state: checksState(latestChecks),
    list: latestChecks.sort((a, b) => a.name.localeCompare(b.name)),
    minutes: minutes.length ? Math.max(...minutes) : null,
    failedPushes: withChecks.filter((s) => s === 'failure').length,
    pushesWithChecks: withChecks.filter((s) => s !== null).length,
  };

  const size = raw.additions + raw.deletions;
  const changesRequested = reviews.filter((r) => r.state === 'CHANGES_REQUESTED');
  const open = raw.state === 'OPEN';

  return {
    repo,
    number: raw.number,
    title: raw.title,
    url: raw.url,
    author,
    authorAvatarUrl: raw.author?.avatarUrl ?? null,
    state: raw.state,
    isDraft: raw.isDraft,
    createdAt: raw.createdAt,
    mergedAt: raw.mergedAt,
    closedAt: raw.closedAt,
    baseRef: raw.baseRefName,
    headRef: raw.headRefName,
    additions: raw.additions,
    deletions: raw.deletions,
    changedFiles: raw.changedFiles,
    commits: raw.commits.totalCount,
    // Counted like the list and GitHub's Conversation tab: comments, code comments, written reviews.
    comments: commentCount({
      comments: raw.comments,
      reviewThreads: raw.threadComments,
      written: raw.written,
    }),
    reviewThreads: raw.reviewThreads.totalCount,
    participants: raw.participants.totalCount,
    stages: timed,
    firstReviewHours: firstReview ? hoursBetween(reviewStart, firstReview) : null,
    ageHours: merged
      ? hoursBetween(raw.createdAt, merged)
      : open
        ? hoursBetween(raw.createdAt, now.toISOString())
        : null,
    baseline: {
      firstReviewHours: baseline.firstReviewHours,
      mergeHours: baseline.mergeHours,
      size: baseline.size,
      sample: baseline.sample,
    },
    sizePercentile: percentile(size, baseline.sizes),
    rounds: {
      changesRequested: changesRequested.length,
      commitsAfterFirstReview: firstReview
        ? raw.history.nodes.filter((n) => n.commit.committedDate > firstReview).length
        : 0,
      forcePushes: events.filter((e) => e.__typename === 'HeadRefForcePushedEvent').length,
    },
    reviewers,
    checks,
    waitingOn: open ? waitingOn(raw, reviewers, checks.state, reviewStart, author, changesRequested) : null,
  };
}

/** Who or what the pull request needs next, in the order it would unblock it. */
function waitingOn(
  raw: RawPull,
  reviewers: PullReviewer[],
  checks: PullDetail['checks']['state'],
  reviewStart: string,
  author: string | null,
  changesRequested: Event[],
): PullDetail['waitingOn'] {
  const authorOnly = author ? [author] : [];
  if (raw.isDraft) return { kind: 'draft', who: authorOnly, since: raw.createdAt };
  if (raw.reviewDecision === 'CHANGES_REQUESTED') {
    return { kind: 'author', who: authorOnly, since: changesRequested.at(-1)?.submittedAt ?? null };
  }
  if (checks === 'failure') return { kind: 'checks', who: authorOnly, since: null };
  const pending = reviewers.filter((r) => r.state === 'PENDING');
  if (pending.length) {
    const asked = pending.map((r) => r.requestedAt ?? reviewStart).sort()[0] ?? reviewStart;
    return { kind: 'review', who: pending.map((r) => r.login), since: asked };
  }
  if (raw.reviewDecision === 'APPROVED' || reviewers.some((r) => r.state === 'APPROVED')) {
    const approved = reviewers.flatMap((r) =>
      r.state === 'APPROVED' && r.firstReviewAt ? [r.firstReviewAt] : [],
    );
    return { kind: 'merge', who: [], since: approved.sort().at(-1) ?? null };
  }
  return { kind: 'review', who: [], since: reviewStart };
}

export async function getPull(
  gh: GitHubClient,
  owner: string,
  name: string,
  number: number,
  baseline: Baseline,
): Promise<PullDetail | null> {
  const data = await gh.graphql<{ repository: { pullRequest: RawPull | null } | null }>(PULL_QUERY, {
    owner,
    name,
    number,
  });
  const raw = data.repository?.pullRequest;
  return raw ? buildPull(raw, `${owner}/${name}`, baseline) : null;
}
