import { describe, expect, it } from 'vitest';
import type { MyPull } from '../src/shared/types';
import { hasStatus, pullSignals, slower, span, STATUSES, listCount } from '../src/web/lib/pulls';

const NOW = Date.UTC(2026, 10, 22, 12);
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString();

const pull = (overrides: Partial<MyPull> = {}): MyPull => ({
  repo: 'octo/app',
  owner: 'octo',
  name: 'app',
  ownerAvatarUrl: '',
  number: 1,
  title: 'A change',
  url: '',
  author: 'me',
  authorAvatarUrl: null,
  state: 'OPEN',
  isDraft: false,
  createdAt: hoursAgo(10),
  updatedAt: hoursAgo(1),
  mergedAt: null,
  closedAt: null,
  additions: 1,
  deletions: 1,
  reviewDecision: null,
  checks: null,
  reviewRequestedAt: null,
  firstReviewAt: null,
  roles: [],
  ...overrides,
});

const labels = (p: MyPull, firstReviewHours: number | null = 4, mergeHours: number | null = 20) =>
  pullSignals(p, { firstReviewHours, mergeHours, size: 50, sample: 10 }, NOW).map((s) => [s.label, s.color]);

describe('short spans', () => {
  it('reads naturally at each scale', () => {
    expect([0.5, 5, 47, 72, 24 * 20].map(span)).toEqual(['<1h', '5h', '47h', '3d', '3w']);
  });

  it('only calls a wait slow when it is clearly over the usual pace and over a day', () => {
    expect(slower(30, 4)).toBe(true);
    expect(slower(20, 4)).toBe(false);
    expect(slower(50, 30)).toBe(false);
    expect(slower(999, null)).toBe(false);
  });
});

describe('what a pull request needs', () => {
  it('flags your pending review, in red once it is far slower than the repository usually is', () => {
    expect(labels(pull({ reviewRequestedAt: hoursAgo(6) }))).toEqual([['Your review · 6h', 'yellow']]);
    expect(labels(pull({ reviewRequestedAt: hoursAgo(72) }))).toEqual([['Your review · 3d', 'red']]);
  });

  it('tells you when your own pull request has no review yet, except a draft', () => {
    expect(labels(pull({ roles: ['authored'], createdAt: hoursAgo(5) }))).toEqual([
      ['No review yet · 5h', 'gray'],
    ]);
    expect(labels(pull({ roles: ['authored'], createdAt: hoursAgo(96) }))).toEqual([
      ['No review yet · 4d', 'orange'],
    ]);
    expect(labels(pull({ roles: ['authored'], isDraft: true }))).toEqual([]);
  });

  it('shows what blocks it, most pressing first, two at most', () => {
    expect(
      labels(
        pull({
          reviewRequestedAt: hoursAgo(2),
          checks: 'failure',
          reviewDecision: 'CHANGES_REQUESTED',
          updatedAt: hoursAgo(24 * 30),
        }),
      ),
    ).toEqual([
      ['Your review · 2h', 'yellow'],
      ['Checks failing', 'red'],
    ]);
    expect(labels(pull({ reviewDecision: 'APPROVED', updatedAt: hoursAgo(24 * 21) }))).toEqual([
      ['Approved', 'green'],
      ['Idle 3w', 'gray'],
    ]);
  });

  it('says how long a merged one took next to the usual pace, and marks closed ones', () => {
    expect(labels(pull({ state: 'MERGED', createdAt: hoursAgo(30), mergedAt: hoursAgo(20) }))).toEqual([
      ['Merged in 10h', 'violet'],
    ]);
    expect(labels(pull({ state: 'MERGED', createdAt: hoursAgo(200), mergedAt: hoursAgo(20) }))).toEqual([
      ['Merged in 8d', 'orange'],
    ]);
    expect(labels(pull({ state: 'CLOSED' }))).toEqual([['Closed', 'gray']]);
  });

  it('explains the usual pace in the hint when it is known', () => {
    const [signal] = pullSignals(pull({ reviewRequestedAt: hoursAgo(6) }), undefined, NOW);
    expect(signal!.hint).toBe('Your review was asked for 6h ago.');
    const [withContext] = pullSignals(
      pull({ reviewRequestedAt: hoursAgo(6) }),
      { firstReviewHours: 4, mergeHours: null, size: null, sample: 3 },
      NOW,
    );
    expect(withContext!.hint).toBe(
      'Your review was asked for 6h ago. Here, a first review usually takes 4h.',
    );
  });
});

describe('filtering by status', () => {
  const states = (p: MyPull) => STATUSES.map((s) => s.value).filter((s) => hasStatus(p, s, NOW));

  it('matches each open pull request by the same rules as its signals', () => {
    // A draft isn't waiting for a review yet.
    expect(states(pull({ isDraft: true }))).toEqual([]);
    expect(states(pull({ reviewDecision: 'APPROVED', firstReviewAt: hoursAgo(5) }))).toEqual(['approved']);
    expect(states(pull({ checks: 'failure', firstReviewAt: hoursAgo(5) }))).toEqual(['failing']);
    expect(states(pull())).toEqual(['unreviewed']);
    expect(states(pull({ firstReviewAt: hoursAgo(500), updatedAt: hoursAgo(24 * 15) }))).toEqual(['idle']);
  });

  it('never puts a merged or closed pull request in any of them', () => {
    expect(states(pull({ state: 'MERGED', isDraft: true }))).toEqual([]);
    expect(states(pull({ state: 'CLOSED' }))).toEqual([]);
  });
});

describe('the numbers on the tabs', () => {
  const pulls = [
    pull({ roles: ['authored'], isDraft: true }),
    pull({ roles: ['authored'] }),
    pull({ roles: ['review'] }),
  ];
  const noDrafts = (p: MyPull) => !p.isDraft;

  it('count what each tab lists, with the draft and status filters applied', () => {
    expect(listCount('authored', pulls, null)).toBe(2);
    expect(listCount('authored', pulls, noDrafts)).toBe(1);
    expect(listCount('review', pulls, noDrafts)).toBe(1);
    expect(listCount('assigned', pulls, null)).toBe(0);
    expect(listCount('all', pulls, noDrafts)).toBe(2);
    // Involved is what GitHub's involves:@me found, not everything listed.
    expect(listCount('involved', [pull({ roles: ['review'] }), pull({ roles: ['involved'] })], null)).toBe(1);
  });
});
