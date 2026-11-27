import { describe, expect, it } from 'vitest';
import type { ActivityPull, ActivityResponse } from '../src/shared/types';
import {
  DEFAULT_REPORT,
  buildReport,
  reportContents,
  reportFileName,
  type ReportOptions,
} from '../src/web/lib/report';

const NOW = new Date('2026-11-27T12:00:00Z');

const pull = (n: number, over: Partial<ActivityPull> = {}): ActivityPull => ({
  id: `PR_${n}`,
  repo: 'acme/app',
  number: n,
  title: `Pull request ${n}`,
  url: `https://github.com/acme/app/pull/${n}`,
  state: 'merged',
  draft: false,
  author: { login: 'bo', avatarUrl: '' },
  createdAt: '2026-11-02T10:00:00Z',
  mergedAt: '2026-11-03T10:00:00Z',
  additions: 10,
  deletions: 2,
  at: '2026-11-02T10:00:00Z',
  ...over,
});

const activity = (opened: ActivityPull[], reviewed: ActivityPull[] = []): ActivityResponse => ({
  user: { login: 'bo', name: 'Bo Lee', avatarUrl: '' },
  scope: { kind: 'account', name: 'acme' },
  from: '2026-10-29',
  to: '2026-11-27',
  days: 30,
  opened: {
    total: opened.length,
    merged: opened.filter((p) => p.state === 'merged').length,
    open: 0,
    closed: 0,
    medianMergeHours: 24,
    selfMerged: 0,
    sizes: [],
    complete: true,
  },
  reviews: {
    total: reviewed.length,
    pulls: reviewed.length,
    approved: 1,
    changes: 1,
    commented: 0,
    dismissed: 0,
    medianFirstReviewHours: null,
    times: [],
    complete: true,
  },
  timeline: [],
  repos: [{ name: 'acme/app', opened: opened.length, reviews: reviewed.length }],
  reviewsGiven: [{ login: 'ana', avatarUrl: '', count: 2 }],
  reviewsReceived: [],
  pulls: { opened, reviewed },
});

const options = (
  over: {
    opened?: Partial<ReportOptions['opened']>;
    reviewed?: Partial<ReportOptions['reviewed']>;
    groupBy?: ReportOptions['groupBy'];
  } = {},
): ReportOptions => ({
  opened: { ...DEFAULT_REPORT.opened, ...over.opened },
  reviewed: { ...DEFAULT_REPORT.reviewed, ...over.reviewed },
  // By repository unless a test says otherwise: most of these look at that layout.
  groupBy: over.groupBy ?? 'repo',
});

const OPENED = [
  pull(1),
  pull(2, { state: 'open', mergedAt: null }),
  pull(3, { state: 'open', mergedAt: null, draft: true }),
  pull(4, { state: 'closed', mergedAt: null }),
];
const REVIEWED = [
  pull(10, { author: { login: 'ana', avatarUrl: '' }, review: 'approved', reviews: ['changes', 'approved'] }),
  pull(11, {
    author: { login: 'cy', avatarUrl: '' },
    state: 'open',
    mergedAt: null,
    review: 'commented',
    reviews: ['commented'],
  }),
];

describe('a report of what someone did with pull requests', () => {
  it('keeps their own pull requests by how each ended up', () => {
    const numbers = (o: ReportOptions) =>
      reportContents({ activity: activity(OPENED), options: o }).opened.map((p) => p.number);
    expect(numbers(options())).toEqual([1, 2]);
    expect(numbers(options({ opened: { open: false } }))).toEqual([1]);
    expect(numbers(options({ opened: { drafts: true, closed: true } }))).toEqual([1, 2, 3, 4]);
  });

  it('keeps reviews by which count and how the pull request ended up', () => {
    const numbers = (o: ReportOptions) =>
      reportContents({ activity: activity([], REVIEWED), options: o }).reviewed.map((p) => p.number);
    expect(numbers(options())).toEqual([10, 11]);
    expect(numbers(options({ reviewed: { reviews: 'approved' } }))).toEqual([10]);
    expect(numbers(options({ reviewed: { onlyMerged: true } }))).toEqual([10]);
    expect(numbers(options({ reviewed: { reviews: 'none' } }))).toEqual([]);
  });

  it('adds those only commented on, never one already reviewed', () => {
    const commented = [pull(10), pull(20, { state: 'open', mergedAt: null }), pull(21)];
    const numbers = (o: ReportOptions) =>
      reportContents({ activity: activity([], REVIEWED), options: o, commented }).commented.map(
        (p) => p.number,
      );
    expect(numbers(options())).toEqual([]);
    expect(numbers(options({ reviewed: { commented: true } }))).toEqual([20, 21]);
    expect(numbers(options({ reviewed: { commented: true, onlyMerged: true } }))).toEqual([21]);
  });

  it('writes Markdown: a summary, then each list grouped, with descriptions quoted', () => {
    const md = buildReport({
      activity: activity(OPENED, REVIEWED),
      options: options(),
      descriptions: { PR_1: 'Adds caching.\r\n<!-- template note -->\n\n\n\nFaster pages.' },
      now: NOW,
    });
    expect(md).toContain('# Pull requests: Bo Lee (@bo)');
    expect(md).toContain('in acme, from Oct 29, 2026 to Nov 27, 2026');
    expect(md).toContain('- **4** pull requests opened, **1** merged (25%)');
    // Each number with its noun as it should read: one or many.
    expect(md).toContain('- **2** reviews on **2** pull requests: 1 approval, 1 change request, 0 comments');
    expect(md).toContain('- Across **1** repository: acme/app (6)');
    expect(md).toContain('- Reviewed the work of **1** person: @ana (2)');
    expect(md).toContain('## Pull requests opened (2)');
    expect(md).toContain('### acme/app (2)');
    expect(md).toContain(
      '- **[Pull request 1](https://github.com/acme/app/pull/1)** · #1 · state: merged on Nov 3, 2026 · size: +10 −2 lines',
    );
    // The description quoted, without the template's hidden note, blank lines kept to one.
    expect(md).toContain('  > Adds caching.\n  >\n  > Faster pages.');
    expect(md).not.toContain('template note');
    expect(md).toContain('## Pull requests reviewed (2)');
    // Every value labelled: their reviews, the state.
    expect(md).toContain(
      '#10 by @ana · their reviews: requested changes, approved · state: merged on Nov 3, 2026',
    );
    // Merges by themselves, and the median time to merge on a line of its own.
    expect(md).toContain('**1** merged (25%), 0 of those merged by @bo themselves');
    expect(md).toContain('- Time from opening to merge: 24h (median)');
    // How to read it: what each word means, and what was chosen.
    expect(md).toContain('## About this report');
    expect(md).toContain('- **Opened:** a pull request @bo opened in the period');
    expect(md).toContain('  - Their own pull requests: merged, open, each with its description.');
    expect(md).toContain('  - Pull requests they only commented on: not included.');
    // Commented on is explained only when some are listed.
    expect(md).not.toContain('**Commented on:**');
    expect(md.endsWith('\n')).toBe(true);
  });

  it('groups by month, naming the repository on each line', () => {
    const md = buildReport({
      activity: activity([pull(1), pull(5, { at: '2026-10-30T00:00:00Z' })]),
      options: options({ groupBy: 'month' }),
      now: NOW,
    });
    expect(md.indexOf('### November 2026')).toBeLessThan(md.indexOf('### October 2026'));
    expect(md).toContain('· acme/app · #1 ·');
  });

  it('lays everything out as one timeline, oldest first, under each month', () => {
    const md = buildReport({
      activity: activity(
        [pull(1, { createdAt: '2026-11-02T10:00:00Z', at: '2026-11-02T10:00:00Z' })],
        [
          pull(10, {
            author: { login: 'ana', avatarUrl: '' },
            review: 'approved',
            reviews: ['approved'],
            at: '2026-10-30T09:00:00Z',
          }),
        ],
      ),
      options: options({ groupBy: 'timeline' }),
      commented: [pull(20, { author: { login: 'cy', avatarUrl: '' }, at: '2026-11-20T00:00:00Z' })],
      now: NOW,
    });
    expect(md).toContain('## Timeline (2)');
    expect(md).not.toContain('## Pull requests opened');
    expect(md.indexOf('### October 2026')).toBeLessThan(md.indexOf('### November 2026'));
    expect(md).toContain('- Oct 30, 2026 · Reviewed [Pull request 10]');
    expect(md).toContain('- Nov 2, 2026 · Opened **[Pull request 1]');
    // Each line names its repository, as no heading does.
    expect(md).toContain('· acme/app · #10 by @ana · their reviews: approved ·');
    // Commented on only when asked for.
    expect(md).not.toContain('Commented on [');
    const withComments = buildReport({
      activity: activity([], []),
      options: options({ groupBy: 'timeline', reviewed: { commented: true } }),
      commented: [pull(20, { author: { login: 'cy', avatarUrl: '' }, at: '2026-11-20T00:00:00Z' })],
      now: NOW,
    });
    // Dated by the pull request's last activity, said as such, and explained above.
    expect(withComments).toContain('- Nov 20, 2026 (last activity) · Commented on [Pull request 20]');
    expect(withComments).toContain('- **Commented on:** a pull request by someone else');
  });

  it("keeps a title's Markdown from turning into links or emphasis", () => {
    const md = buildReport({
      activity: activity([pull(1, { title: 'Fix [link](x) and *stars* in `code`' })]),
      options: options(),
      now: NOW,
    });
    expect(md).toContain(
      '[Fix \\[link\\](x) and \\*stars\\* in \\`code\\`](https://github.com/acme/app/pull/1)',
    );
  });

  it('says so when nothing matches, or when search left some out', () => {
    const nothing = buildReport({
      activity: activity(OPENED),
      options: options({ opened: { merged: false, open: false } }),
      now: NOW,
    });
    expect(nothing).toContain('_No pull requests match what was chosen for this report._');
    const partial = activity(OPENED);
    partial.opened.complete = false;
    expect(buildReport({ activity: partial, options: options(), now: NOW })).toContain('**Note:**');
  });

  it('starts as a timeline', () => {
    expect(DEFAULT_REPORT.groupBy).toBe('timeline');
  });

  it('names its file short, by whose it is', () => {
    expect(reportFileName(activity([]))).toBe('bo-report.md');
  });
});
