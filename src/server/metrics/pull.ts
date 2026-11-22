import type {
  PullActivityPoint,
  PullDetail,
  PullReviewMark,
  PullFolder,
  PullPhase,
  PullReviewer,
  PullStage,
} from '../../shared/types.js';
import type { GitHubClient } from '../github.js';
import { hoursBetween, toDay } from '../util.js';
import { type RawCheck, checksState, isBot, readChecks } from './mine.js';

/*
 * Everything on the pull request page is exact: every list is read to its end, page by page, and
 * a section whose data GitHub can't list in full (more than 250 commits, 3,000 files, a thread
 * with more than 100 comments) is left out instead of shown from part of it.
 */

interface Page<T> {
  totalCount?: number;
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
  nodes: T[];
}

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

export interface RawReview {
  submittedAt: string | null;
  state: string;
  body: string | null;
  author: Person | null;
}

export interface RawEvent {
  __typename: string;
  createdAt?: string;
  requestedReviewer?: Requested | null;
}

export interface RawThread {
  comments: { totalCount: number; nodes: { createdAt: string; author?: Person | null }[] };
}

export interface RawFile {
  path: string;
  additions: number;
  deletions: number;
}

/** Each connection of the pull request, as one page of it. */
const CONNECTIONS = {
  reviews:
    'reviews(first: 100, after: $after) { totalCount pageInfo { hasNextPage endCursor } nodes { submittedAt state body author { __typename login avatarUrl } } }',
  comments:
    'comments(first: 100, after: $after) { totalCount pageInfo { hasNextPage endCursor } nodes { createdAt author { __typename login } } }',
  commits:
    'commits(first: 100, after: $after) { totalCount pageInfo { hasNextPage endCursor } nodes { commit { committedDate author { name user { login } } } } }',
  threads:
    'reviewThreads(first: 100, after: $after) { totalCount pageInfo { hasNextPage endCursor } nodes { comments(first: 100) { totalCount nodes { createdAt author { __typename login avatarUrl } } } } }',
  requests:
    'reviewRequests(first: 100, after: $after) { totalCount pageInfo { hasNextPage endCursor } nodes { requestedReviewer { __typename ... on User { login avatarUrl } ... on Team { name } } } }',
  people:
    'participants(first: 100, after: $after) { totalCount pageInfo { hasNextPage endCursor } nodes { login avatarUrl } }',
  files:
    'files(first: 100, after: $after) { totalCount pageInfo { hasNextPage endCursor } nodes { path additions deletions } }',
  // The timeline only for the events nothing else gives. Its pages can come back short, so it is
  // read until GitHub says there is no next page.
  events: `timelineItems(first: 100, after: $after, itemTypes: [READY_FOR_REVIEW_EVENT, CONVERT_TO_DRAFT_EVENT, REVIEW_REQUESTED_EVENT, HEAD_REF_FORCE_PUSHED_EVENT, MERGED_EVENT]) {
    pageInfo { hasNextPage endCursor }
    nodes {
      __typename
      ... on ReadyForReviewEvent { createdAt }
      ... on ConvertToDraftEvent { createdAt }
      ... on ReviewRequestedEvent { createdAt requestedReviewer { __typename ... on User { login avatarUrl } ... on Team { name } } }
      ... on HeadRefForcePushedEvent { createdAt }
      ... on MergedEvent { createdAt }
    }
  }`,
} as const;

type Connection = keyof typeof CONNECTIONS;

const alias = (name: Connection) => `${name}: ${CONNECTIONS[name]}`;

const CHECKS = `contexts(first: 100, after: $after) {
  pageInfo { hasNextPage endCursor }
  nodes {
    __typename
    ... on CheckRun { name conclusion status startedAt completedAt }
    ... on StatusContext { context state }
  }
}`;

const PULL_QUERY = `
query ($owner: String!, $name: String!, $number: Int!, $after: String) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      id number title url state isDraft createdAt mergedAt closedAt reviewDecision mergeable
      additions deletions changedFiles baseRefName headRefName
      author { login avatarUrl }
      participants { totalCount }
      ${(Object.keys(CONNECTIONS) as Connection[]).map(alias).join('\n      ')}
      latest: commits(last: 1) { nodes { commit { id statusCheckRollup { ${CHECKS} } } } }
    }
  }
}`;

/** The next page of one connection of the pull request. */
const moreOf = (name: Connection) => `
query ($id: ID!, $after: String) {
  node(id: $id) { ... on PullRequest { ${alias(name)} } }
}`;

const MORE_CHECKS = `
query ($id: ID!, $after: String) {
  node(id: $id) { ... on Commit { statusCheckRollup { ${CHECKS} } } }
}`;

type Contexts = { contexts: Page<RawCheck> } | null;

interface RawCommit {
  commit: { committedDate: string; author: { name: string | null; user: { login: string } | null } | null };
}

export interface RawPull {
  number: number;
  /** Whether it merges cleanly; UNKNOWN while GitHub works it out, right after a push. */
  mergeable?: 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN';
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
  participants: { totalCount: number };
  /** Everyone involved, read to the end; left out when GitHub couldn't list them all. */
  people?: { login: string; avatarUrl: string }[];
  reviews: RawReview[];
  /** Comments in the conversation: when, and by whom (same order). */
  comments: { totalCount: number; createdAt: string[]; by?: (string | null)[]; bot?: boolean[] };
  commits: { totalCount: number; committedAt: string[]; by?: (string | null)[] };
  threads: { totalCount: number; nodes: RawThread[] };
  requests: { requestedReviewer: Requested | null }[];
  files: { totalCount: number; nodes: RawFile[] };
  events: RawEvent[];
  checks: RawCheck[];
}

/** A person by login, a team by name. */
const reviewerKey = (r: Requested) => (r.login ?? r.name ?? '').toLowerCase();

/**
 * When the pull request became approved for good: the first approval after the last request for
 * changes, as GitHub keeps them now. An approval or a request later dismissed no longer counts, so
 * from then on nothing took the approval back until it was merged (or closed, or now).
 */
export function finalApproval(reviews: { submittedAt: string | null; state: string }[]): string | null {
  const dated = reviews.filter((r) => r.submittedAt);
  const lastChanges = dated
    .filter((r) => r.state === 'CHANGES_REQUESTED')
    .map((r) => r.submittedAt!)
    .sort()
    .at(-1);
  return (
    dated
      .filter((r) => r.state === 'APPROVED' && (!lastChanges || r.submittedAt! > lastChanges))
      .map((r) => r.submittedAt!)
      .sort()[0] ?? null
  );
}

/**
 * The whole life of the pull request, in order, as stretches of one kind each: as a draft (every
 * time it was one), waiting for a first review, in review (all the back and forth until the final
 * approval), and after the final approval until merged, closed or now.
 */
export function buildPhases(
  createdAt: string,
  draftEvents: { kind: 'draft' | 'ready'; at: string }[],
  isDraft: boolean,
  firstReview: string | null,
  approvedAt: string | null,
  end: string,
  open: boolean,
): PullPhase[] {
  // Draft stretches, from the events that switch it: one marked ready without being converted
  // first was opened as a draft.
  const switches = [...draftEvents].sort((a, b) => a.at.localeCompare(b.at));
  const drafts: [string, string][] = [];
  let since: string | null =
    switches[0]?.kind === 'ready' || (!switches.length && isDraft) ? createdAt : null;
  for (const e of switches) {
    if (e.kind === 'draft' && since === null) since = e.at;
    if (e.kind === 'ready' && since !== null) {
      drafts.push([since, e.at]);
      since = null;
    }
  }
  if (since !== null) drafts.push([since, end]);

  const kindAt = (t: string): PullPhase['kind'] => {
    if (drafts.some(([from, to]) => t >= from && t < to)) return 'draft';
    if (!firstReview || t < firstReview) return 'waiting';
    return approvedAt && t >= approvedAt ? 'approved' : 'review';
  };
  const marks = [createdAt, end, ...drafts.flat(), firstReview, approvedAt]
    .filter((t): t is string => !!t && t >= createdAt && t <= end)
    .sort();
  const bounds = [...new Set(marks)];

  const phases: PullPhase[] = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    const kind = kindAt(bounds[i]!);
    const hours = hoursBetween(bounds[i]!, bounds[i + 1]!);
    const last = phases.at(-1);
    if (last?.kind === kind) last.hours += hours;
    else phases.push({ kind, hours, ongoing: false });
  }
  if (!phases.length) phases.push({ kind: kindAt(createdAt), hours: 0, ongoing: false });
  if (open) phases.at(-1)!.ongoing = true;
  return phases.filter((p) => p.hours > 0 || p.ongoing);
}

/** How many folders to show before the rest are grouped as "Other". */
const MAX_FOLDERS = 8;

/**
 * Lines changed per top-level folder, or deeper ones when every file sits in a single folder.
 */
export function buildFolders(files: RawFile[]): PullFolder[] {
  const atDepth = (depth: number) => {
    const map = new Map<string, PullFolder>();
    for (const f of files) {
      const parts = f.path.split('/');
      // A file above that depth counts under the folder it sits in.
      const path =
        parts.length > depth ? parts.slice(0, depth).join('/') : parts.slice(0, -1).join('/') || '(root)';
      const entry = map.get(path) ?? { path, additions: 0, deletions: 0, files: 0 };
      entry.additions += f.additions;
      entry.deletions += f.deletions;
      entry.files++;
      map.set(path, entry);
    }
    return [...map.values()];
  };
  // Go deeper while everything sits in one folder, so the breakdown still says something.
  let depth = 1;
  let folders = atDepth(depth);
  while (folders.length === 1 && folders[0]!.path !== '(root)' && depth < 6) folders = atDepth(++depth);
  folders.sort(
    (a, b) => b.additions + b.deletions - (a.additions + a.deletions) || a.path.localeCompare(b.path),
  );
  if (folders.length <= MAX_FOLDERS) return folders;
  const others = folders.slice(MAX_FOLDERS - 1).reduce<PullFolder>(
    (sum, f) => ({
      path: 'Other',
      additions: sum.additions + f.additions,
      deletions: sum.deletions + f.deletions,
      files: sum.files + f.files,
    }),
    { path: 'Other', additions: 0, deletions: 0, files: 0 },
  );
  return [...folders.slice(0, MAX_FOLDERS - 1), others];
}

/** Past this many days, activity is counted per week so the chart stays readable. */
const DAILY_UP_TO = 60;

const DAY_MS = 86_400_000;

/**
 * Commits, reviews and comments per day (or week) from the day the pull request was opened to the
 * day it ended (or today). Anything dated before it was opened, like commits pushed with it,
 * counts on its first day.
 */
export function buildActivity(
  createdAt: string,
  end: string,
  dates: { commits: string[]; reviews: string[]; comments: string[] },
): { unit: 'day' | 'week'; points: PullActivityPoint[] } {
  const start = new Date(`${toDay(createdAt)}T00:00:00Z`).getTime();
  const last = new Date(`${toDay(end)}T00:00:00Z`).getTime();
  const days = Math.round((last - start) / DAY_MS) + 1;
  const unit = days > DAILY_UP_TO ? 'week' : 'day';
  const step = unit === 'week' ? 7 * DAY_MS : DAY_MS;
  const points: PullActivityPoint[] = [];
  for (let t = start; t <= last; t += step)
    points.push({ day: toDay(t), commits: 0, reviews: 0, comments: 0 });
  const add = (iso: string, key: 'commits' | 'reviews' | 'comments') => {
    const at = Math.min(Math.max(new Date(iso).getTime(), start), last + DAY_MS - 1);
    points[Math.min(points.length - 1, Math.floor((at - start) / step))]![key]++;
  };
  for (const iso of dates.commits) add(iso, 'commits');
  for (const iso of dates.reviews) add(iso, 'reviews');
  for (const iso of dates.comments) add(iso, 'comments');
  return { unit, points };
}

export function buildPull(raw: RawPull, repo: string, now = new Date()): PullDetail {
  const author = raw.author?.login ?? null;
  const byAuthor = (login: string | undefined) => !!author && login?.toLowerCase() === author.toLowerCase();
  const open = raw.state === 'OPEN';
  const end = raw.mergedAt ?? (raw.state === 'CLOSED' ? raw.closedAt : null) ?? now.toISOString();

  // Reviews by people other than the author, in order. Unsubmitted reviews and apps don't count.
  const reviews = raw.reviews
    .filter((r) => r.submittedAt && r.author && !isBot(r.author) && !byAuthor(r.author.login))
    .sort((a, b) => a.submittedAt!.localeCompare(b.submittedAt!));
  // Comments on the code by other people. Before GitHub had reviews (2016), reviewing was
  // commenting on the code, so these count as reviewing too. A thread's first page holds its
  // earliest comments, so the first one is always among those read.
  const codeReviews = raw.threads.nodes
    .flatMap((t) => t.comments.nodes)
    .filter((c) => c.author && !isBot(c.author) && !byAuthor(c.author.login))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const firstReview =
    [reviews[0]?.submittedAt, codeReviews[0]?.createdAt].filter((t): t is string => !!t).sort()[0] ?? null;
  const approvedAt = finalApproval(reviews);
  const ready = raw.events.find((e) => e.__typename === 'ReadyForReviewEvent')?.createdAt ?? null;
  // Review time starts when the pull request was ready for it.
  const reviewStart = ready ?? raw.createdAt;

  const stages: Omit<PullStage, 'hours'>[] = [{ kind: 'opened', at: raw.createdAt }];
  if (ready) stages.push({ kind: 'ready', at: ready });
  if (firstReview) stages.push({ kind: 'first-review', at: firstReview });
  if (approvedAt) stages.push({ kind: 'approved', at: approvedAt });
  if (raw.mergedAt) stages.push({ kind: 'merged', at: raw.mergedAt });
  else if (raw.state === 'CLOSED' && raw.closedAt) stages.push({ kind: 'closed', at: raw.closedAt });
  stages.sort((a, b) => a.at.localeCompare(b.at));
  const timed = stages.map((s, i) => ({ ...s, hours: i ? hoursBetween(stages[i - 1]!.at, s.at) : null }));

  // Reviewers: everyone who reviewed, plus everyone still asked to.
  const pending = new Set(
    raw.requests.flatMap((r) => (r.requestedReviewer ? [reviewerKey(r.requestedReviewer)] : [])),
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
  for (const e of raw.events) {
    if (e.__typename === 'ReviewRequestedEvent' && e.requestedReviewer && e.createdAt) {
      person(e.requestedReviewer).requestedAt ??= e.createdAt;
    }
  }
  for (const r of raw.requests) if (r.requestedReviewer) person(r.requestedReviewer);
  for (const review of reviews) {
    const r = person({ __typename: 'User', ...review.author! });
    r.reviews++;
    r.firstReviewAt ??= review.submittedAt!;
    // A later comment doesn't undo an approval or a request for changes.
    if (review.state !== 'COMMENTED' || r.state === 'PENDING')
      r.state = review.state as PullReviewer['state'];
  }
  // Someone who only commented on the code reviewed too, the way it was done before reviews.
  for (const c of codeReviews) {
    const r = person({ __typename: 'User', ...c.author! });
    if (!r.firstReviewAt || c.createdAt < r.firstReviewAt) r.firstReviewAt = c.createdAt;
    if (r.reviews === 0) r.state = 'COMMENTED';
  }
  for (const r of people.values()) {
    // Still asked: pending while open. Once merged or closed, a request left over doesn't hide
    // the review someone gave.
    if (pending.has(r.login.toLowerCase()) && (open || !r.firstReviewAt)) r.state = 'PENDING';
    if (r.firstReviewAt) {
      const from = r.requestedAt && r.requestedAt <= r.firstReviewAt ? r.requestedAt : reviewStart;
      r.responseHours = Math.max(0, hoursBetween(from, r.firstReviewAt));
    }
  }
  const reviewers = [...people.values()].filter(
    (r) => r.reviews > 0 || r.firstReviewAt !== null || pending.has(r.login.toLowerCase()),
  );

  // Checks on the latest commit, read in full.
  const list = readChecks(raw.checks).sort((a, b) => a.name.localeCompare(b.name));
  const minutes = list.flatMap((c) => (c.minutes === null ? [] : [c.minutes]));

  const changesRequested = reviews.filter((r) => r.state === 'CHANGES_REQUESTED');
  // Every comment on the code is in a thread; a thread longer than one page leaves dates out.
  const threadDates = raw.threads.nodes.flatMap((t) => t.comments.nodes.map((c) => c.createdAt));
  const codeComments = raw.threads.nodes.reduce((sum, t) => sum + t.comments.totalCount, 0);
  const written = raw.reviews.filter((r) => (r.body ?? '').trim()).length;
  // Comments can be placed on the timeline only when every one of them was read.
  const everyComment =
    raw.comments.createdAt.length === raw.comments.totalCount && threadDates.length === codeComments;
  const everyDate = raw.commits.committedAt.length === raw.commits.totalCount && everyComment;

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
    // Like GitHub's Conversation tab: the conversation, the code, and written reviews.
    comments: raw.comments.totalCount + codeComments + written,
    reviewThreads: raw.threads.totalCount,
    participants: raw.participants.totalCount,
    involved: involved(raw, everyComment),
    stages: timed,
    firstReviewHours: firstReview ? hoursBetween(reviewStart, firstReview) : null,
    ageHours: raw.mergedAt
      ? hoursBetween(raw.createdAt, raw.mergedAt)
      : open
        ? hoursBetween(raw.createdAt, now.toISOString())
        : null,
    phases: buildPhases(
      raw.createdAt,
      raw.events.flatMap((e) =>
        e.createdAt && (e.__typename === 'ConvertToDraftEvent' || e.__typename === 'ReadyForReviewEvent')
          ? [
              {
                kind: e.__typename === 'ConvertToDraftEvent' ? ('draft' as const) : ('ready' as const),
                at: e.createdAt,
              },
            ]
          : [],
      ),
      raw.isDraft,
      firstReview,
      approvedAt,
      end,
      open,
    ),
    // Every review by a person, placed on the pull request's life, as GitHub keeps it now: an
    // approval or a request for changes that was later dismissed shows as dismissed.
    // Every commit, placed on the pull request's life by the date written in it (not when it was
    // pushed); commits dated before the opening go at its start.
    commitMarks:
      raw.commits.committedAt.length === raw.commits.totalCount
        ? raw.commits.committedAt
            .map((at, i) => ({ at, login: raw.commits.by?.[i] ?? 'someone' }))
            .sort((a, b) => a.at.localeCompare(b.at))
            .map((c) => ({ ...c, hours: Math.max(0, hoursBetween(raw.createdAt, c.at)) }))
        : null,
    // Every comment, in the conversation and on the code, placed on the pull request's life.
    commentMarks: everyComment
      ? [
          ...raw.comments.createdAt.map((at, i) => ({
            at,
            login: raw.comments.by?.[i] ?? 'ghost',
            ...(raw.comments.bot?.[i] ? { bot: true as const } : {}),
          })),
          ...raw.threads.nodes.flatMap((t) =>
            t.comments.nodes.map((c) => ({
              at: c.createdAt,
              login: c.author?.login ?? 'ghost',
              ...(isBot(c.author) ? { bot: true as const } : {}),
            })),
          ),
        ]
          .sort((a, b) => a.at.localeCompare(b.at))
          .map((c) => ({ ...c, hours: Math.max(0, hoursBetween(raw.createdAt, c.at)) }))
      : null,
    reviewMarks: reviews.map((r) => ({
      hours: Math.max(0, hoursBetween(raw.createdAt, r.submittedAt!)),
      state: r.state as PullReviewMark['state'],
      login: r.author!.login,
      at: r.submittedAt!,
    })),
    rounds: {
      changesRequested: changesRequested.length,
      forcePushes: raw.events.filter((e) => e.__typename === 'HeadRefForcePushedEvent').length,
    },
    reviewers,
    checks: {
      state: checksState(list),
      list,
      minutes: minutes.length ? Math.max(...minutes) : null,
      totalMinutes: minutes.length ? minutes.reduce((a, b) => a + b, 0) : null,
    },
    folders: raw.files.nodes.length === raw.files.totalCount ? buildFolders(raw.files.nodes) : null,
    activity: everyDate
      ? buildActivity(raw.createdAt, end, {
          commits: raw.commits.committedAt,
          reviews: reviews.map((r) => r.submittedAt!),
          comments: [...raw.comments.createdAt, ...threadDates],
        })
      : null,
    // Only when GitHub knows: right after a push it may still be working it out.
    conflicts: open && raw.mergeable === 'CONFLICTING',
    waitingOn: open
      ? waitingOn(raw, reviewers, checksState(list), reviewStart, author, changesRequested)
      : null,
  };
}

/** Who or what the pull request needs next, in the order it would unblock it. */
/** How many people's faces the activity line shows. */
const FACES = 7;

/**
 * The people most involved: those who approved it first, then the rest, each most active first.
 * Commits, reviews and comments each count one, and opening it counts one for the author. Only when
 * every one of those was read, so the order is right. An approval later dismissed doesn't count.
 */
export function involved(raw: RawPull, everyComment: boolean): PullDetail['involved'] {
  if (!raw.people || !everyComment || raw.commits.committedAt.length !== raw.commits.totalCount) return null;
  const actions = new Map<string, number>();
  const add = (login: string | null | undefined) => {
    if (login) actions.set(login.toLowerCase(), (actions.get(login.toLowerCase()) ?? 0) + 1);
  };
  add(raw.author?.login);
  raw.commits.by?.forEach(add);
  raw.reviews.forEach((r) => add(r.author?.login));
  raw.comments.by?.forEach(add);
  raw.threads.nodes.forEach((t) => t.comments.nodes.forEach((c) => add(c.author?.login)));
  const approvers = new Set(
    raw.reviews.flatMap((r) => (r.state === 'APPROVED' && r.author ? [r.author.login.toLowerCase()] : [])),
  );
  return raw.people
    .map((p) => ({
      login: p.login,
      avatarUrl: p.avatarUrl,
      actions: actions.get(p.login.toLowerCase()) ?? 0,
      approved: approvers.has(p.login.toLowerCase()),
    }))
    .sort(
      (a, b) =>
        Number(b.approved) - Number(a.approved) || b.actions - a.actions || a.login.localeCompare(b.login),
    )
    .slice(0, FACES);
}

function waitingOn(
  raw: RawPull,
  reviewers: PullReviewer[],
  checks: PullDetail['checks']['state'],
  reviewStart: string,
  author: string | null,
  changesRequested: RawReview[],
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

interface FirstPage {
  id: string;
  number: number;
  title: string;
  url: string;
  state: PullDetail['state'];
  isDraft: boolean;
  createdAt: string;
  mergedAt: string | null;
  closedAt: string | null;
  reviewDecision: RawPull['reviewDecision'];
  mergeable?: RawPull['mergeable'];
  additions: number;
  deletions: number;
  changedFiles: number;
  baseRefName: string;
  headRefName: string;
  author: Person | null;
  participants: { totalCount: number };
  reviews: Page<RawReview>;
  comments: Page<{ createdAt: string; author: { __typename?: string; login: string } | null }>;
  commits: Page<RawCommit>;
  threads: Page<RawThread>;
  requests: Page<{ requestedReviewer: Requested | null }>;
  people: Page<{ login: string; avatarUrl: string }>;
  files: Page<RawFile>;
  events: Page<RawEvent>;
  latest: { nodes: { commit: { id: string; statusCheckRollup: Contexts } }[] };
}

/** Reads the rest of a connection, one page at a time, until GitHub says there is no next page. */
export async function readAll<T>(
  first: Page<T>,
  next: (after: string) => Promise<Page<T> | undefined>,
): Promise<T[]> {
  const nodes = [...first.nodes];
  let page: Page<T> | undefined = first;
  while (page?.pageInfo.hasNextPage && page.pageInfo.endCursor) {
    page = await next(page.pageInfo.endCursor);
    if (page) nodes.push(...page.nodes);
  }
  return nodes;
}

export async function getPull(
  gh: GitHubClient,
  owner: string,
  name: string,
  number: number,
): Promise<PullDetail | null> {
  const data = await gh.graphql<{ repository: { pullRequest: FirstPage | null } | null }>(PULL_QUERY, {
    owner,
    name,
    number,
  });
  const p = data.repository?.pullRequest;
  if (!p) return null;

  const more =
    <T>(key: Connection) =>
    (after: string) =>
      gh
        .graphql<{ node: Record<Connection, Page<T>> | null }>(moreOf(key), { id: p.id, after })
        .then((d) => d.node?.[key]);
  const commit = p.latest.nodes[0]?.commit;
  const firstChecks = commit?.statusCheckRollup?.contexts;

  const [reviews, comments, commits, threads, requests, people, files, events, checks] = await Promise.all([
    readAll(p.reviews, more<RawReview>('reviews')),
    readAll(
      p.comments,
      more<{ createdAt: string; author: { __typename?: string; login: string } | null }>('comments'),
    ),
    readAll(p.commits, more<RawCommit>('commits')),
    readAll(p.threads, more<RawThread>('threads')),
    readAll(p.requests, more<{ requestedReviewer: Requested | null }>('requests')),
    readAll(p.people, more<{ login: string; avatarUrl: string }>('people')),
    readAll(p.files, more<RawFile>('files')),
    readAll(p.events, more<RawEvent>('events')),
    firstChecks && commit
      ? readAll(firstChecks, (after) =>
          gh
            .graphql<{ node: { statusCheckRollup: Contexts } | null }>(MORE_CHECKS, { id: commit.id, after })
            .then((d) => d.node?.statusCheckRollup?.contexts),
        )
      : Promise.resolve([]),
  ]);

  return buildPull(
    {
      ...p,
      reviews,
      comments: {
        totalCount: p.comments.totalCount ?? comments.length,
        createdAt: comments.map((c) => c.createdAt),
        by: comments.map((c) => c.author?.login ?? null),
        bot: comments.map((c) => isBot(c.author)),
      },
      commits: {
        totalCount: p.commits.totalCount ?? commits.length,
        committedAt: commits.map((c) => c.commit.committedDate),
        // Who wrote each commit: their account, or the name in the commit when it has none.
        by: commits.map((c) => c.commit.author?.user?.login ?? c.commit.author?.name ?? null),
      },
      threads: { totalCount: p.threads.totalCount ?? threads.length, nodes: threads },
      requests,
      people: people.length === (p.people.totalCount ?? people.length) ? people : undefined,
      files: { totalCount: p.files.totalCount ?? files.length, nodes: files },
      events,
      checks,
    },
    `${owner}/${name}`,
  );
}
