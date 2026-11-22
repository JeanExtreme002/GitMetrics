import type { MyPull, PullFilter, RepoBaseline } from '../../shared/types';

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

/** Pull requests nobody touched for this long are called out as idle. */
const IDLE_DAYS = 14;

export type PullStatus = 'approved' | 'failing' | 'unreviewed' | 'idle';

export const STATUSES: { value: PullStatus; label: string }[] = [
  { value: 'approved', label: 'Approved' },
  { value: 'failing', label: 'Checks failing' },
  { value: 'unreviewed', label: 'No review yet' },
  { value: 'idle', label: 'Idle' },
];

/** Whether an open pull request is in that state, by the same rules as its signals. */
export function hasStatus(p: MyPull, status: PullStatus, now = Date.now()): boolean {
  if (p.state !== 'OPEN') return false;
  switch (status) {
    case 'approved':
      return p.reviewDecision === 'APPROVED';
    case 'failing':
      return p.checks === 'failure';
    case 'unreviewed':
      return !p.isDraft && !p.firstReviewAt;
    case 'idle':
      return now - new Date(p.updatedAt).getTime() > IDLE_DAYS * 24 * HOUR;
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
    return [{ label: 'Closed', color: 'gray', hint: 'Closed without being merged.' }];
  }

  if (p.reviewRequestedAt) {
    const waited = since(p.reviewRequestedAt);
    signals.push({
      label: `Your review · ${span(waited)}`,
      color: slower(waited, baseline?.firstReviewHours) ? 'red' : 'yellow',
      hint: `Your review was asked for ${span(waited)} ago.${usually('a first review', baseline?.firstReviewHours)}`,
    });
  } else if (p.roles.includes('authored') && !p.firstReviewAt && !p.isDraft) {
    const waited = since(p.createdAt);
    signals.push({
      label: `No review yet · ${span(waited)}`,
      color: slower(waited, baseline?.firstReviewHours) ? 'orange' : 'gray',
      hint: `Opened ${span(waited)} ago and not reviewed yet.${usually('a first review', baseline?.firstReviewHours)}`,
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
  const idle = since(p.updatedAt);
  if (idle > IDLE_DAYS * 24) {
    signals.push({ label: `Idle ${span(idle)}`, color: 'gray', hint: `No activity for ${span(idle)}.` });
  }
  return signals.slice(0, 2);
}

/**
 * Whether a pull request belongs to a tab: the GitHub search that found it. "Involved" leaves out
 * review requests nobody acted on yet, exactly like GitHub's involves:@me; "All" holds everything.
 */
export const inFilter = (p: MyPull, filter: PullFilter) => filter === 'all' || p.roles.includes(filter);

/** How many pull requests a tab shows, once the draft and status filters (if any) are applied. */
export const listCount = (filter: PullFilter, pulls: MyPull[], passes: ((p: MyPull) => boolean) | null) =>
  pulls.filter((p) => inFilter(p, filter) && (!passes || passes(p))).length;
