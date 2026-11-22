import type {
  MyPull,
  MyPullsResponse,
  PullDetail,
  PullFilter,
  PullReviewMark,
  RepoBaseline,
} from '../../shared/types';

const HOUR = 3_600_000;

/** A short span for badges: "<1h", "5h", "3d", "2w". */
export function span(hours: number): string {
  if (hours < 1) return '<1h';
  if (hours < 48) return `${Math.round(hours)}h`;
  const days = hours / 24;
  if (days < 14) return `${Math.round(days)}d`;
  return `${Math.round(days / 7)}w`;
}

/**
 * Noticeably slower than the repository usually is: more than twice its median, and more than a
 * day, so a few hours over a fast median don't raise an alarm.
 */
export const slower = (hours: number, usual: number | null | undefined) =>
  usual != null && hours > Math.max(usual * 2, 24);

const usually = (what: string, usual: number | null | undefined) =>
  usual == null ? '' : ` Here, ${what} usually takes ${span(usual)}.`;

export interface Signal {
  label: string;
  color: string;
  hint: string;
}

export type PullStatus = 'approved' | 'failing' | 'conflicts' | 'unreviewed';

export const STATUSES: { value: PullStatus; label: string }[] = [
  { value: 'approved', label: 'Approved' },
  { value: 'failing', label: 'Checks failing' },
  { value: 'conflicts', label: 'Has conflicts' },
  { value: 'unreviewed', label: 'No review yet' },
];

/** Whether an open pull request is in that state, by the same rules as its signals. */
export function hasStatus(p: MyPull, status: PullStatus): boolean {
  if (p.state !== 'OPEN') return false;
  switch (status) {
    case 'approved':
      return p.reviewDecision === 'APPROVED';
    case 'failing':
      return p.checks === 'failure';
    case 'conflicts':
      return p.conflicts;
    case 'unreviewed':
      return !p.isDraft && !p.firstReviewAt;
  }
}

/**
 * What matters about a pull request at a glance, most pressing first, at most two: whether it
 * waits on you, how its wait compares with the repository's usual pace, and what blocks it.
 */
export function pullSignals(p: MyPull, baseline?: RepoBaseline, now = Date.now()): Signal[] {
  const since = (iso: string) => (now - new Date(iso).getTime()) / HOUR;
  const signals: Signal[] = [];

  if (p.state === 'MERGED' && p.mergedAt) {
    const took = (new Date(p.mergedAt).getTime() - new Date(p.createdAt).getTime()) / HOUR;
    signals.push({
      label: `Merged in ${span(took)}`,
      color: slower(took, baseline?.mergeHours) ? 'orange' : 'violet',
      hint: `Merged ${span(took)} after it was opened.${usually('getting merged', baseline?.mergeHours)}`,
    });
    return signals;
  }
  if (p.state === 'CLOSED') {
    return [{ label: 'Closed', color: 'red', hint: 'Closed without being merged.' }];
  }

  if (p.reviewRequestedAt) {
    const waited = since(p.reviewRequestedAt);
    signals.push({
      label: `Your review · ${span(waited)}`,
      color: slower(waited, baseline?.firstReviewHours) ? 'red' : 'yellow',
      hint: `Your review was asked for ${span(waited)} ago.${usually('a first review', baseline?.firstReviewHours)}`,
    });
  } else if ((p.roles.includes('authored') || p.roles.includes('owned')) && !p.firstReviewAt && !p.isDraft) {
    const waited = since(p.createdAt);
    signals.push({
      label: `No review yet · ${span(waited)}`,
      color: slower(waited, baseline?.firstReviewHours) ? 'orange' : 'gray',
      hint: `Opened ${span(waited)} ago and not reviewed yet.${usually('a first review', baseline?.firstReviewHours)}`,
    });
  }
  // A blocker GitHub only shows at the bottom of the pull request: it can't merge as it is.
  if (p.conflicts) {
    signals.push({
      label: 'Conflicts',
      color: 'red',
      hint: "Conflicts with its base branch, so it can't be merged until they are resolved.",
    });
  }
  if (p.checks === 'failure') {
    signals.push({ label: 'Checks failing', color: 'red', hint: 'A check failed on the latest commit.' });
  }
  if (p.reviewDecision === 'CHANGES_REQUESTED') {
    signals.push({ label: 'Changes requested', color: 'orange', hint: 'A reviewer asked for changes.' });
  } else if (p.reviewDecision === 'APPROVED') {
    signals.push({ label: 'Approved', color: 'green', hint: 'Approved and ready to be merged.' });
  }
  return signals.slice(0, 2);
}

/**
 * Whether a pull request belongs to a tab: the GitHub search that found it. "Involved" leaves out
 * review requests nobody acted on yet, exactly like GitHub's involves:@me; "All" holds everything.
 */
export const inFilter = (p: MyPull, filter: PullFilter) => filter === 'all' || p.roles.includes(filter);

/**
 * The same list on github.com/pulls, which lists everything, not just the latest. "All" opens
 * involves:@me, the closest single GitHub search to it.
 */
export function githubPullsUrl(
  state: 'open' | 'closed',
  filter: PullFilter,
  owner = '',
  text = '',
  login = '',
): string {
  // Your repositories are your account's, so that tab names it and leaves out any other account.
  if (filter === 'owned') {
    const q = `is:pr is:${state} user:${login} -author:@me${text ? ` ${text}` : ''} sort:updated-desc`;
    return `https://github.com/pulls?q=${encodeURIComponent(q)}`;
  }
  const who: Record<Exclude<PullFilter, 'owned'>, string> = {
    all: 'involves:@me',
    authored: 'author:@me',
    assigned: 'assignee:@me',
    involved: 'involves:@me',
    review: state === 'open' ? 'review-requested:@me' : 'reviewed-by:@me',
  };
  const q = `is:pr is:${state} ${who[filter]}${owner ? ` user:${owner}` : ''}${text ? ` ${text}` : ''} sort:updated-desc`;
  return `https://github.com/pulls?q=${encodeURIComponent(q)}`;
}

/** Same rule as the server: words of letters, digits, dots, hyphens and underscores. */
const SEARCH_TEXT = /^[\p{L}\p{N}_.-]+(?: [\p{L}\p{N}_.-]+)*$/u;

/**
 * What a search box holds, ready for GitHub: spaces squeezed, at least two characters. Null when
 * there's nothing to search; `invalid` when it holds something GitHub's search would read as a
 * qualifier or an operator (a colon, quotes...).
 */
export function searchText(input: string): { text: string } | { invalid: true } | null {
  const text = input.trim().replace(/\s+/g, ' ');
  if (text.length < 2) return null;
  return text.length <= 100 && SEARCH_TEXT.test(text) ? { text } : { invalid: true };
}

/** The GitHub searches behind a tab: "All" is what you're involved in plus review requests. */
const TAB_SEARCHES: Record<PullFilter, Exclude<PullFilter, 'all'>[]> = {
  all: ['involved', 'review', 'owned'],
  authored: ['authored'],
  assigned: ['assigned'],
  involved: ['involved'],
  review: ['review'],
  owned: ['owned'],
};

/** Whether GitHub found more pull requests for a tab than the list brought, so some are missing. */
export function cutShort(data: MyPullsResponse, filter: PullFilter): boolean {
  return TAB_SEARCHES[filter].some(
    (search) => data.counts[search] > data.pulls.filter((p) => p.roles.includes(search)).length,
  );
}

/** The folder every path sits in, if they share one: "a/b" for "a/b/c" and "a/b". */
export function sharedFolder(paths: string[]): string {
  if (paths.length < 2) return '';
  const split = paths.map((p) => p.split('/'));
  const common: string[] = [];
  for (let i = 0; i < split[0]!.length; i++) {
    const part = split[0]![i]!;
    if (split.every((s) => s[i] === part)) common.push(part);
    else break;
  }
  return common.join('/');
}

/** What one reviewer did in one day (or week): their reviews, by outcome, and their comments. */
export type ReviewerPoint = { day: string; comments: number } & Record<PullReviewMark['state'], number>;

export interface ReviewerActivity {
  login: string;
  avatarUrl: string | null;
  /** Reviews and comments, all added up. */
  total: number;
  points: ReviewerPoint[];
}

const DAY_MS = 86_400_000;

/**
 * Each reviewer's reviews and comments over the pull request's life, on the same days (or weeks)
 * as its activity chart, most active first. People other than the author only, no apps and no
 * deleted accounts. Comments only count when every one of them was read (`comments` says so).
 */
export function reviewerActivity(pull: PullDetail): { comments: boolean; people: ReviewerActivity[] } | null {
  const activity = pull.activity;
  if (!activity || activity.points.length < 2) return null;
  const start = new Date(`${activity.points[0]!.day}T00:00:00Z`).getTime();
  const step = (activity.unit === 'week' ? 7 : 1) * DAY_MS;
  const slot = (iso: string) =>
    Math.min(activity.points.length - 1, Math.max(0, Math.floor((new Date(iso).getTime() - start) / step)));
  const author = pull.author?.toLowerCase();
  const avatars = new Map(pull.reviewers.map((r) => [r.login.toLowerCase(), r.avatarUrl]));
  const people = new Map<string, ReviewerActivity>();
  const person = (login: string) => {
    const key = login.toLowerCase();
    let p = people.get(key);
    if (!p) {
      p = {
        login,
        avatarUrl: avatars.get(key) ?? null,
        total: 0,
        points: activity.points.map((a) => ({
          day: a.day,
          APPROVED: 0,
          CHANGES_REQUESTED: 0,
          COMMENTED: 0,
          DISMISSED: 0,
          comments: 0,
        })),
      };
      people.set(key, p);
    }
    p.total++;
    return p;
  };
  for (const r of pull.reviewMarks) person(r.login).points[slot(r.at)]![r.state]++;
  for (const c of pull.commentMarks ?? []) {
    if (c.bot || c.login === 'ghost' || c.login.toLowerCase() === author) continue;
    person(c.login).points[slot(c.at)]!.comments++;
  }
  return {
    comments: pull.commentMarks !== null,
    people: [...people.values()].sort((a, b) => b.total - a.total || a.login.localeCompare(b.login)),
  };
}
