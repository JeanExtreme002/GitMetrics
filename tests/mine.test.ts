import { describe, expect, it } from 'vitest';
import type { GitHubClient } from '../src/server/github';
import {
  ACCOUNT,
  SEARCH_TEXT,
  buildBaseline,
  checksState,
  getMyPulls,
  percentile,
  readChecks,
  reviewRequestedAt,
  searchQueries,
  type RawListPull,
} from '../src/server/metrics/mine';

const at = (hours: number) => new Date(Date.UTC(2026, 10, 1) + hours * 3_600_000).toISOString();

function pull(overrides: Partial<RawListPull> = {}): RawListPull {
  return {
    number: 1,
    title: 'A change',
    url: '',
    state: 'OPEN',
    isDraft: false,
    createdAt: at(0),
    updatedAt: at(10),
    mergedAt: null,
    closedAt: null,
    additions: 10,
    deletions: 2,
    reviewDecision: null,
    author: { login: 'ana', avatarUrl: '' },
    repository: { nameWithOwner: 'octo/app', name: 'app', owner: { login: 'octo', avatarUrl: '' } },
    reviews: { nodes: [] },
    reviewRequests: { nodes: [] },
    timelineItems: { nodes: [] },
    commits: { nodes: [] },
    ...overrides,
  };
}

describe('checks', () => {
  it('counts a run that was cancelled and started again by its latest run only', () => {
    const checks = readChecks([
      { name: 'title', conclusion: 'CANCELLED', startedAt: at(0), completedAt: at(0.01) },
      { name: 'title', conclusion: 'SUCCESS', startedAt: at(1), completedAt: at(1.01) },
      { name: 'tests', conclusion: 'SUCCESS', startedAt: at(1), completedAt: at(1.5) },
    ]);
    expect(checks).toEqual([
      { name: 'title', conclusion: 'success', minutes: expect.closeTo(0.6, 5) },
      { name: 'tests', conclusion: 'success', minutes: 30 },
    ]);
    expect(checksState(checks)).toBe('success');
  });

  it('fails on any failure, waits while anything runs, and reads commit statuses too', () => {
    expect(
      checksState(
        readChecks([
          { name: 'a', conclusion: 'SUCCESS' },
          { name: 'b', conclusion: 'TIMED_OUT' },
        ]),
      ),
    ).toBe('failure');
    expect(checksState(readChecks([{ name: 'a', conclusion: null, status: 'IN_PROGRESS' }]))).toBe('pending');
    expect(checksState(readChecks([{ context: 'ci/legacy', state: 'ERROR' }]))).toBe('failure');
    expect(checksState(readChecks([{ name: 'a', conclusion: 'SKIPPED' }]))).toBeNull();
  });
});

describe('when your review was asked for', () => {
  const events = [
    { createdAt: at(1), requestedReviewer: { __typename: 'Team' } },
    { createdAt: at(5), requestedReviewer: { __typename: 'User', login: 'someone' } },
  ];

  it('prefers a request that names you', () => {
    const p = pull({
      timelineItems: {
        nodes: [...events, { createdAt: at(3), requestedReviewer: { __typename: 'User', login: 'Me' } }],
      },
    });
    expect(reviewRequestedAt(p, 'me', true)).toBe(at(3));
  });

  it('falls back to a team request, since GitHub counts your teams as you', () => {
    expect(reviewRequestedAt(pull({ timelineItems: { nodes: events } }), 'me', true)).toBe(at(1));
    expect(reviewRequestedAt(pull(), 'me', true)).toBe(at(0));
    expect(reviewRequestedAt(pull({ timelineItems: { nodes: events } }), 'me', false)).toBeNull();
  });
});

describe('repository baseline', () => {
  it('takes medians, ignoring reviews by the author themselves', () => {
    const merged = [
      {
        createdAt: at(0),
        mergedAt: at(10),
        additions: 10,
        deletions: 0,
        author: { login: 'a' },
        reviews: {
          nodes: [
            { submittedAt: at(1), author: { login: 'a' } },
            { submittedAt: at(4), author: { login: 'b' } },
          ],
        },
      },
      {
        createdAt: at(0),
        mergedAt: at(30),
        additions: 100,
        deletions: 50,
        author: { login: 'a' },
        reviews: { nodes: [{ submittedAt: at(2), author: { login: 'c' } }] },
      },
      {
        createdAt: at(0),
        mergedAt: at(20),
        additions: 40,
        deletions: 0,
        author: { login: 'a' },
        reviews: { nodes: [] },
      },
    ];
    expect(buildBaseline(merged)).toEqual({
      firstReviewHours: 3,
      mergeHours: 20,
      size: 40,
      sample: 3,
      sizes: [10, 150, 40],
    });
  });

  it('places a size among the sample', () => {
    expect(percentile(100, [10, 20, 30, 400])).toBe(0.75);
    expect(percentile(5, [])).toBeNull();
  });
});

describe('your pull requests', () => {
  /** A fake GitHub answering each search with the pull requests given for its filter. */
  const github = (byFilter: Record<string, RawListPull[]>, extra: Record<string, unknown> = {}) => {
    const queries = searchQueries('open');
    const asked: string[] = [];
    const gh = {
      graphql: async (_query: string, variables: Record<string, string>) => {
        if (variables.q) {
          asked.push(variables.q);
          // Recognize the tab by its qualifier, which ends every search, with or without words.
          const filter = Object.entries(queries).find(([, q]) =>
            variables.q!.endsWith(q.split(' ').at(-1)!),
          )![0];
          const nodes = byFilter[filter] ?? [];
          return { search: { issueCount: nodes.length + (filter === 'involved' ? 10 : 0), nodes } };
        }
        return extra;
      },
    } as unknown as GitHubClient;
    return { gh, asked };
  };

  it('lists each pull request once, with every filter it belongs to, newest activity first', async () => {
    const mine = pull({ number: 1, updatedAt: at(5), author: { login: 'me', avatarUrl: '' } });
    const asked = pull({
      number: 2,
      updatedAt: at(9),
      reviewRequests: { nodes: [{ requestedReviewer: { __typename: 'Team' } }] },
      timelineItems: { nodes: [{ createdAt: at(4), requestedReviewer: { __typename: 'Team' } }] },
    });
    const { gh } = github({ authored: [mine], involved: [mine, asked], review: [asked] });
    const result = await getMyPulls(gh, 'me', 'open');

    expect(result.pulls.map((p) => [p.number, p.roles, p.reviewRequestedAt])).toEqual([
      // "Involved" is its own search: GitHub's involves:@me found both.
      [2, ['involved', 'review'], at(4)],
      [1, ['authored', 'involved'], null],
    ]);
    expect(result.counts).toEqual({ all: 2, authored: 1, assigned: 0, involved: 12, review: 1 });
  });

  it("keeps one account's repositories when asked, and only takes real account names", () => {
    expect(Object.values(searchQueries('open', 'octo-org')).every((q) => q.includes(' user:octo-org '))).toBe(
      true,
    );
    expect(searchQueries('open').authored).not.toContain('user:');
    for (const ok of ['octo', 'Octo-Org', 'a1', 'x'.repeat(39)]) expect(ACCOUNT.test(ok), ok).toBe(true);
    for (const bad of ['', '-octo', 'octo-', 'oc--to', 'a b', 'user:x', 'a/b', 'x'.repeat(40)]) {
      expect(ACCOUNT.test(bad), bad).toBe(false);
    }
  });

  it("counts what was said like GitHub's Conversation tab: comments, code comments, written reviews", async () => {
    // Many reviews, few threads: counting by thread doesn't depend on how many reviews there are.
    const commented = pull({
      comments: { totalCount: 2 },
      reviews: {
        nodes: Array.from({ length: 40 }, (_, i) => ({ submittedAt: at(i), author: { login: 'bo' } })),
      },
      reviewThreads: { nodes: [{ comments: { totalCount: 3 } }, { comments: { totalCount: 1 } }] },
      // Two reviews say something; an empty or blank summary doesn't count.
      written: {
        nodes: [{ body: 'Looks good' }, { body: '' }, { body: '  ' }, { body: 'One nit' }, { body: null }],
      },
    });
    const { gh } = github({ involved: [commented, pull({ number: 2 })] });
    const result = await getMyPulls(gh, 'me', 'open');
    expect(result.pulls.map((p) => p.comments)).toEqual([8, 0]);
  });

  it('looks for words on GitHub, only with the searches the open tab needs', async () => {
    expect(searchQueries('closed', 'octo', 'cache bug').authored).toBe(
      'is:pr is:closed archived:false sort:updated-desc user:octo cache bug author:@me',
    );
    for (const ok of ['cache', 'fix login', 'versão', 'v1.2-rc_3'])
      expect(SEARCH_TEXT.test(ok), ok).toBe(true);
    for (const bad of ['user:x', 'a "b"', 'a  b', ' a', 'a OR b:', 'x/y', '-x:y', '(a)']) {
      expect(SEARCH_TEXT.test(bad), bad).toBe(false);
    }

    const { gh, asked } = github({});
    await getMyPulls(gh, 'me', 'open', undefined, { text: 'cache', tab: 'authored' });
    expect(asked).toEqual([expect.stringMatching(/ cache author:@me$/)]);
    asked.length = 0;
    await getMyPulls(gh, 'me', 'open', undefined, { text: 'cache', tab: 'all' });
    expect(asked.map((q) => q.split(' ').at(-1))).toEqual(['involves:@me', 'review-requested:@me']);
  });

  it('only searches with GitHub qualifiers for you, and reads reviewed ones once closed', () => {
    expect(searchQueries('open').review).toContain('review-requested:@me');
    expect(searchQueries('closed').review).toContain('reviewed-by:@me');
    expect(Object.values(searchQueries('closed')).every((q) => q.includes('is:closed'))).toBe(true);
  });
});
