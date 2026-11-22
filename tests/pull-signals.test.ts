import { describe, expect, it } from 'vitest';
import type { MyPull } from '../src/shared/types';
import {
  cutShort,
  githubPullsUrl,
  hasStatus,
  pullSignals,
  searchText,
  slower,
  span,
  STATUSES,
} from '../src/web/lib/pulls';

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
  conflicts: false,
  comments: 0,
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

  it('says when a contribution to your repositories has no review yet', () => {
    expect(labels(pull({ roles: ['owned'], author: 'peyn', createdAt: hoursAgo(5) }))).toEqual([
      ['No review yet · 5h', 'gray'],
    ]);
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
    ]);
  });

  it('calls out conflicts with the base branch, even on an approved one', () => {
    expect(labels(pull({ conflicts: true, reviewDecision: 'APPROVED', firstReviewAt: hoursAgo(5) }))).toEqual(
      [
        ['Conflicts', 'red'],
        ['Approved', 'green'],
      ],
    );
  });

  it('says how long a merged one took next to the usual pace, and marks closed ones', () => {
    expect(labels(pull({ state: 'MERGED', createdAt: hoursAgo(30), mergedAt: hoursAgo(20) }))).toEqual([
      ['Merged in 10h', 'violet'],
    ]);
    expect(labels(pull({ state: 'MERGED', createdAt: hoursAgo(200), mergedAt: hoursAgo(20) }))).toEqual([
      ['Merged in 8d', 'orange'],
    ]);
    expect(labels(pull({ state: 'CLOSED' }))).toEqual([['Closed', 'red']]);
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
  const states = (p: MyPull) => STATUSES.map((s) => s.value).filter((s) => hasStatus(p, s));

  it('matches each open pull request by the same rules as its signals', () => {
    // A draft isn't waiting for a review yet.
    expect(states(pull({ isDraft: true }))).toEqual([]);
    expect(states(pull({ reviewDecision: 'APPROVED', firstReviewAt: hoursAgo(5) }))).toEqual(['approved']);
    expect(states(pull({ checks: 'failure', firstReviewAt: hoursAgo(5) }))).toEqual(['failing']);
    expect(states(pull({ conflicts: true, firstReviewAt: hoursAgo(5) }))).toEqual(['conflicts']);
    expect(states(pull())).toEqual(['unreviewed']);
    expect(states(pull({ firstReviewAt: hoursAgo(500), updatedAt: hoursAgo(24 * 15) }))).toEqual([]);
  });

  it('never puts a merged or closed pull request in any of them', () => {
    expect(states(pull({ state: 'MERGED', isDraft: true }))).toEqual([]);
    expect(states(pull({ state: 'CLOSED' }))).toEqual([]);
  });
});

describe('the same list on GitHub', () => {
  const query = (url: string) => decodeURIComponent(url.split('?q=')[1]!);

  it('opens github.com/pulls with the tab, state and account you are looking at', () => {
    expect(githubPullsUrl('closed', 'authored')).toMatch(/^https:\/\/github\.com\/pulls\?q=/);
    expect(query(githubPullsUrl('closed', 'authored', 'octo-org'))).toBe(
      'is:pr is:closed author:@me user:octo-org sort:updated-desc',
    );
    expect(query(githubPullsUrl('closed', 'review'))).toBe(
      'is:pr is:closed reviewed-by:@me sort:updated-desc',
    );
    expect(query(githubPullsUrl('open', 'review'))).toBe(
      'is:pr is:open review-requested:@me sort:updated-desc',
    );
    expect(query(githubPullsUrl('closed', 'all'))).toBe('is:pr is:closed involves:@me sort:updated-desc');
  });
});

describe('the search box', () => {
  it('waits for two characters, squeezes spaces, and refuses what GitHub would read as a qualifier', () => {
    expect(searchText('')).toBeNull();
    expect(searchText(' a ')).toBeNull();
    expect(searchText('  fix   login ')).toEqual({ text: 'fix login' });
    expect(searchText('versão')).toEqual({ text: 'versão' });
    expect(searchText('author:someone')).toEqual({ invalid: true });
    expect(searchText('"exact"')).toEqual({ invalid: true });
  });

  it('opens your repositories on GitHub by your account name', () => {
    expect(decodeURIComponent(githubPullsUrl('open', 'owned', '', '', 'me').split('?q=')[1]!)).toBe(
      'is:pr is:open user:me -author:@me sort:updated-desc',
    );
  });

  it('carries the words to the same list on GitHub', () => {
    expect(decodeURIComponent(githubPullsUrl('open', 'authored', '', 'cache').split('?q=')[1]!)).toBe(
      'is:pr is:open author:@me cache sort:updated-desc',
    );
  });
});

describe('telling the list is cut short', () => {
  const data = (
    counts: Partial<Record<'authored' | 'assigned' | 'involved' | 'review' | 'owned', number>>,
  ) => ({
    state: 'closed' as const,
    counts: { all: 0, authored: 0, assigned: 0, involved: 0, review: 0, owned: 0, ...counts },
    pulls: [pull({ roles: ['authored', 'involved'] }), pull({ roles: ['review'] })],
  });

  it('only when GitHub found more than the list brought for that tab', () => {
    expect(cutShort(data({ authored: 1, involved: 1, review: 1 }), 'authored')).toBe(false);
    expect(cutShort(data({ authored: 40, involved: 1, review: 1 }), 'authored')).toBe(true);
    expect(cutShort(data({ authored: 40, involved: 1, review: 1 }), 'review')).toBe(false);
    // "All" stands on what you're involved in and on review requests.
    expect(cutShort(data({ involved: 1, review: 7 }), 'all')).toBe(true);
    expect(cutShort(data({ authored: 40, involved: 1, review: 1 }), 'all')).toBe(false);
    expect(cutShort(data({ owned: 3 }), 'owned')).toBe(true);
  });
});
