import { describe, expect, it } from 'vitest';
import { GitHubError, type GitHubClient } from '../src/server/github';
import {
  buildActivity,
  coolDown,
  customPeriod,
  getActivity,
  period,
  periodDays,
  searchPeriod,
  slices,
  UnknownScope,
  type RawActivityPull,
} from '../src/server/metrics/activity';

coolDown.ms = 0;
const NOW = new Date('2026-11-27T12:00:00Z');

const pull = (n: number, over: Partial<RawActivityPull> = {}): RawActivityPull => ({
  number: n,
  title: `PR ${n}`,
  url: `https://github.com/acme/app/pull/${n}`,
  state: 'OPEN',
  isDraft: false,
  createdAt: '2026-11-20T10:00:00Z',
  mergedAt: null,
  updatedAt: '2026-11-26T10:00:00Z',
  additions: 3,
  deletions: 1,
  repository: { nameWithOwner: 'acme/app' },
  author: { login: 'ana', avatarUrl: 'a' },
  ...over,
});

describe('the period', () => {
  it('runs over the last days, today included', () => {
    expect(period(30, NOW)).toEqual({ from: '2026-10-29', to: '2026-11-27' });
    expect(period(1, NOW)).toEqual({ from: '2026-11-27', to: '2026-11-27' });
  });

  it('takes a custom period of real days, in order, up to today and two years long', () => {
    expect(customPeriod('2026-01-01', '2026-03-31', NOW)).toEqual({ from: '2026-01-01', to: '2026-03-31' });
    expect(periodDays({ from: '2026-01-01', to: '2026-03-31' })).toBe(90);
    for (const [from, to] of [
      ['2026-03-31', '2026-01-01'], // backwards
      ['2026-02-31', '2026-03-01'], // no such day
      ['2026-11-01', '2026-12-01'], // ends after today
      ['2024-01-01', '2026-11-27'], // longer than two years
      ['2026-1-1', '2026-02-01'], // not a day as search writes it
    ]) {
      expect(customPeriod(from!, to!, NOW), `${from}..${to}`).toBeNull();
    }
  });

  it('is cut into slices covering it to the second, with no gap or overlap', () => {
    const cut = slices('2026-11-01', '2026-11-10', 4);
    expect(cut.map(([a, b]) => [new Date(a).toISOString(), new Date(b).toISOString()])).toEqual([
      ['2026-11-01T00:00:00.000Z', '2026-11-04T23:59:59.000Z'],
      ['2026-11-05T00:00:00.000Z', '2026-11-08T23:59:59.000Z'],
      ['2026-11-09T00:00:00.000Z', '2026-11-10T23:59:59.000Z'],
    ]);
  });
});

describe('reading a search over a period', () => {
  /** A GitHub holding these pull requests, answering search by their date, in pages. */
  const github = (
    pulls: RawActivityPull[],
    fail: (q: string, first: number) => GitHubError | null = () => null,
  ) => {
    const asked: { q: string; first: number }[] = [];
    const gh = {
      graphql: async (_query: string, v: { q: string; first: number; after: string | null }) => {
        asked.push({ q: v.q, first: v.first });
        const error = fail(v.q, v.first);
        if (error) throw error;
        const [, start, end] = /updated:(\S+)\.\.(\S+)/.exec(v.q)!;
        const found = pulls.filter((p) => p.updatedAt >= start! && p.updatedAt <= end!);
        const offset = v.after ? Number(v.after) : 0;
        const nodes = found.slice(offset, offset + v.first);
        return {
          search: {
            issueCount: found.length,
            pageInfo: {
              hasNextPage: offset + v.first < Math.min(found.length, 1000),
              endCursor: String(offset + v.first),
            },
            nodes,
          },
        };
      },
    } as unknown as GitHubClient;
    return { gh, asked };
  };
  const at = (i: number) =>
    new Date(Date.parse('2026-11-01T00:00:00Z') + i * 60_000).toISOString().replace('.000Z', 'Z');

  it('reads every page of every slice, each pull request once', async () => {
    const pulls = Array.from({ length: 250 }, (_, i) => pull(i, { updatedAt: at(i * 10) }));
    const { gh } = github(pulls);
    const read = await searchPeriod(gh, 'is:pr', 'updated', '2026-11-01', '2026-11-30', 'x', 100);
    expect(read.pulls).toHaveLength(250);
    expect(read.complete).toBe(true);
  });

  it('splits a period with more than search returns until each part fits, to the second', async () => {
    // 1,500 in one day: more than search gives for any one query.
    const pulls = Array.from({ length: 1500 }, (_, i) => pull(i, { updatedAt: at(i % 1440) }));
    const { gh, asked } = github(pulls);
    const read = await searchPeriod(gh, 'is:pr', 'updated', '2026-11-01', '2026-11-01', 'x', 100);
    expect(read.pulls).toHaveLength(1500);
    expect(read.complete).toBe(true);
    expect(asked.some((a) => /T\d\d:\d\d:\d\dZ\.\./.test(a.q))).toBe(true);
  });

  it('asks again with smaller pages when search gives up on a heavy one', async () => {
    const pulls = Array.from({ length: 30 }, (_, i) => pull(i, { updatedAt: at(i) }));
    const { gh, asked } = github(pulls, (_q, first) =>
      first > 25 ? new GitHubError(502, 'Bad Gateway') : null,
    );
    const read = await searchPeriod(gh, 'is:pr', 'updated', '2026-11-01', '2026-11-01', 'x', 100);
    expect(read.pulls).toHaveLength(30);
    expect(asked.map((a) => a.first).slice(0, 3)).toEqual([100, 50, 25]);
  });

  it('waits and asks again when GitHub asks to slow down, then gives up', async () => {
    let refusals = 2;
    const pulls = [pull(1, { updatedAt: at(1) })];
    const slowDown = () => new GitHubError(403, 'You have exceeded a secondary rate limit.');
    const patient = github(pulls, () => (refusals-- > 0 ? slowDown() : null));
    expect(
      (await searchPeriod(patient.gh, 'is:pr', 'updated', '2026-11-01', '2026-11-01', 'x', 100)).pulls,
    ).toHaveLength(1);
    const refusing = github(pulls, slowDown);
    await expect(
      searchPeriod(refusing.gh, 'is:pr', 'updated', '2026-11-01', '2026-11-01', 'x', 100),
    ).rejects.toThrow(/secondary rate limit/);
  });

  it('says a list is short when GitHub answered a pull request only in part', async () => {
    const gh = {
      graphql: async () => ({
        search: { issueCount: 2, pageInfo: { hasNextPage: false, endCursor: null }, nodes: [pull(1), null] },
      }),
    } as unknown as GitHubClient;
    const read = await searchPeriod(gh, 'is:pr', 'created', '2026-11-01', '2026-11-01', 'x', 100);
    expect(read).toMatchObject({ complete: false, short: ['partial-answer'] });
  });
});

describe("putting someone's activity together", () => {
  const review = (state: string, submittedAt: string) => ({ state, submittedAt });
  const build = (opened: RawActivityPull[], reviewed: RawActivityPull[]) =>
    buildActivity({
      user: { login: 'Bo', name: 'Bo', avatarUrl: 'b' },
      scope: { kind: 'all' },
      days: 30,
      ...period(30, NOW),
      opened: { pulls: opened, complete: true },
      reviewed: { pulls: reviewed, complete: true },
    });

  it('counts what they opened, merged, left open and closed, and how long merging took', () => {
    const activity = build(
      [
        pull(1, { createdAt: '2026-11-01T00:00:00Z', mergedAt: '2026-11-01T10:00:00Z', state: 'MERGED' }),
        pull(2, { createdAt: '2026-11-02T00:00:00Z', mergedAt: '2026-11-02T20:00:00Z', state: 'MERGED' }),
        pull(3, { createdAt: '2026-11-03T00:00:00Z' }),
        pull(4, { createdAt: '2026-11-04T00:00:00Z', state: 'CLOSED' }),
        // Before the period: not theirs to count here.
        pull(5, { createdAt: '2026-09-01T00:00:00Z' }),
      ],
      [],
    );
    expect(activity.opened).toEqual({
      total: 4,
      merged: 2,
      open: 1,
      closed: 1,
      medianMergeHours: 15,
      sizes: [
        { size: 'XS', count: 4 },
        { size: 'S', count: 0 },
        { size: 'M', count: 0 },
        { size: 'L', count: 0 },
        { size: 'XL', count: 0 },
      ],
      complete: true,
    });
    expect(activity.timeline.reduce((s, b) => s + b.opened, 0)).toBe(4);
    expect(activity.pulls.opened.map((p) => p.number)).toEqual([4, 3, 2, 1]);
  });

  it('counts each review by its own date, only in the period, never on their own pull requests', () => {
    const activity = build(
      [],
      [
        pull(10, {
          createdAt: '2026-09-01T00:00:00Z',
          author: { login: 'ana', avatarUrl: 'a' },
          reviews: {
            totalCount: 3,
            nodes: [
              review('COMMENTED', '2026-10-01T00:00:00Z'),
              review('CHANGES_REQUESTED', '2026-11-05T00:00:00Z'),
              review('APPROVED', '2026-11-06T00:00:00Z'),
            ],
          },
        }),
        pull(11, {
          createdAt: '2026-09-01T00:00:00Z',
          author: { login: 'cy', avatarUrl: 'c' },
          reviews: { totalCount: 1, nodes: [review('APPROVED', '2026-11-07T00:00:00Z')] },
        }),
        // Reviewed before the period only: updated in it, but no review of theirs in it.
        pull(12, { reviews: { totalCount: 1, nodes: [review('APPROVED', '2026-09-01T00:00:00Z')] } }),
        // Their own, which search can find too.
        pull(13, {
          author: { login: 'bo', avatarUrl: 'b' },
          reviews: { totalCount: 1, nodes: [review('COMMENTED', '2026-11-08T00:00:00Z')] },
        }),
      ],
    );
    expect(activity.reviews).toEqual({
      total: 3,
      pulls: 2,
      approved: 2,
      changes: 1,
      commented: 0,
      dismissed: 0,
      // Both opened before the period: how soon they came to them isn't this period's.
      medianFirstReviewHours: null,
      times: ['2026-11-05T00:00:00Z', '2026-11-06T00:00:00Z', '2026-11-07T00:00:00Z'],
      complete: true,
    });
    expect(activity.reviewsGiven).toEqual([
      { login: 'ana', avatarUrl: 'a', count: 2 },
      { login: 'cy', avatarUrl: 'c', count: 1 },
    ]);
    // Their latest review in the period, and when.
    expect(activity.pulls.reviewed[1]).toMatchObject({
      number: 10,
      review: 'approved',
      at: '2026-11-06T00:00:00Z',
    });
  });

  it('tells how soon they review, from opening to their first review, for those opened in the period', () => {
    const activity = build(
      [],
      [
        pull(1, {
          createdAt: '2026-11-10T00:00:00Z',
          reviews: {
            totalCount: 2,
            nodes: [review('APPROVED', '2026-11-11T12:00:00Z'), review('COMMENTED', '2026-11-10T06:00:00Z')],
          },
        }),
        pull(2, {
          createdAt: '2026-11-12T00:00:00Z',
          reviews: { totalCount: 1, nodes: [review('APPROVED', '2026-11-12T02:00:00Z')] },
        }),
      ],
    );
    // 6 hours and 2 hours: the median of the two.
    expect(activity.reviews.medianFirstReviewHours).toBe(4);
  });

  it('says reviews are short when a pull request has more of theirs than were read', () => {
    const activity = build(
      [],
      [pull(1, { reviews: { totalCount: 60, nodes: [review('APPROVED', '2026-11-05T00:00:00Z')] } })],
    );
    expect(activity.reviews.complete).toBe(false);
  });

  it('tells who reviews the pull requests they opened, leaving themselves out', () => {
    const activity = build(
      [
        pull(1, {
          createdAt: '2026-11-01T00:00:00Z',
          reviews: {
            nodes: [
              { state: 'APPROVED', author: { login: 'ana', avatarUrl: 'a' } },
              { state: 'COMMENTED', author: { login: 'bo', avatarUrl: 'b' } },
              { state: 'PENDING', author: { login: 'cy', avatarUrl: 'c' } },
            ],
          },
        }),
      ],
      [],
    );
    expect(activity.reviewsReceived).toEqual([{ login: 'ana', avatarUrl: 'a', count: 1 }]);
  });

  it('is by day for a month and by week for longer', () => {
    expect(build([], []).timeline).toHaveLength(30);
    const year = buildActivity({
      user: { login: 'bo', name: null, avatarUrl: '' },
      scope: { kind: 'all' },
      days: 365,
      ...period(365, NOW),
      opened: { pulls: [], complete: true },
      reviewed: { pulls: [], complete: true },
    });
    expect(year.timeline).toHaveLength(53);
  });

  it("looks the scope up first, as search would only find nothing in one that doesn't exist", async () => {
    const gh = {
      graphql: async (query: string) =>
        query.includes('repositoryOwner')
          ? { repositoryOwner: null }
          : { user: { login: 'bo', name: null, avatarUrl: '' } },
    } as unknown as GitHubClient;
    await expect(
      getActivity(gh, 'bo', { kind: 'account', name: 'nowhere' }, period(30, NOW)),
    ).rejects.toBeInstanceOf(UnknownScope);
  });

  it('is null for a login no user has', async () => {
    const gh = { graphql: async () => ({ user: null }) } as unknown as GitHubClient;
    expect(await getActivity(gh, 'acme', { kind: 'all' }, period(30, NOW))).toBeNull();
  });
});
