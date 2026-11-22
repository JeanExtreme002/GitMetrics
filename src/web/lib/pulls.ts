import type { MyPull, RepoBaseline } from '../../shared/types';

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
