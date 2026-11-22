import { describe, expect, it } from 'vitest';
import type { Baseline } from '../src/server/metrics/mine';
import { buildPull, type RawPull } from '../src/server/metrics/pull';

const at = (hours: number) => new Date(Date.UTC(2026, 10, 1) + hours * 3_600_000).toISOString();
const person = (login: string) => ({ __typename: 'User', login, avatarUrl: `https://avatars/${login}` });
const review = (hours: number, login: string, state: string, typename = 'User') => ({
  __typename: 'PullRequestReview',
  submittedAt: at(hours),
  state,
  author: { ...person(login), __typename: typename },
});
const asked = (hours: number, reviewer: { __typename: string; login?: string; name?: string }) => ({
  __typename: 'ReviewRequestedEvent',
  createdAt: at(hours),
  requestedReviewer: reviewer,
});
const commit = (hours: number, checks: string[] | null) => ({
  commit: {
    committedDate: at(hours),
    statusCheckRollup: checks && {
      contexts: { nodes: checks.map((c, i) => ({ name: `job${i}`, conclusion: c })) },
    },
  },
});

const baseline: Baseline = {
  firstReviewHours: 4,
  mergeHours: 30,
  size: 100,
  sample: 4,
  sizes: [20, 80, 120, 400],
};

function raw(overrides: Partial<RawPull> = {}): RawPull {
  return {
    number: 7,
    title: 'Add caching',
    url: 'https://github.com/octo/app/pull/7',
    state: 'OPEN',
    isDraft: false,
    createdAt: at(0),
    mergedAt: null,
    closedAt: null,
    reviewDecision: 'REVIEW_REQUIRED',
    additions: 200,
    deletions: 50,
    changedFiles: 6,
    baseRefName: 'main',
    headRefName: 'cache',
    author: person('ana'),
    commits: { totalCount: 3 },
    comments: { totalCount: 4 },
    reviewThreads: { totalCount: 2 },
    participants: { totalCount: 3 },
    reviewRequests: { nodes: [] },
    timelineItems: { nodes: [] },
    history: { nodes: [] },
    latest: { nodes: [] },
    ...overrides,
  };
}

describe('a pull request in detail', () => {
  const now = new Date(at(100));

  it('times each stage, counting review time from when it was ready for review', () => {
    const pull = buildPull(
      raw({
        state: 'MERGED',
        mergedAt: at(20),
        reviewDecision: 'APPROVED',
        timelineItems: {
          nodes: [
            { __typename: 'ReadyForReviewEvent', createdAt: at(2) },
            review(1, 'coverage-bot', 'COMMENTED', 'Bot'),
            review(3, 'ana', 'COMMENTED'),
            review(8, 'bo', 'COMMENTED'),
            review(12, 'bo', 'APPROVED'),
            { __typename: 'MergedEvent', createdAt: at(20) },
          ],
        },
      }),
      'octo/app',
      baseline,
      now,
    );
    expect(pull.stages.map((s) => [s.kind, s.hours])).toEqual([
      ['opened', null],
      ['ready', 2],
      ['first-review', 6],
      ['approved', 4],
      ['merged', 8],
    ]);
    // The bot and the author's own comment don't count as the first review.
    expect(pull.firstReviewHours).toBe(6);
    expect(pull.ageHours).toBe(20);
    expect(pull.waitingOn).toBeNull();
  });

  it('places the size among the repository and keeps the baseline without its raw sizes', () => {
    const pull = buildPull(raw(), 'octo/app', baseline, now);
    expect(pull.sizePercentile).toBe(0.75);
    expect(pull.baseline).toEqual({ firstReviewHours: 4, mergeHours: 30, size: 100, sample: 4 });
    expect(pull.ageHours).toBe(100);
  });

  it('follows each reviewer: response time from their request, and an approval a comment does not undo', () => {
    const pull = buildPull(
      raw({
        reviewRequests: {
          nodes: [
            { requestedReviewer: person('cy') },
            { requestedReviewer: { __typename: 'Team', name: 'Core' } },
          ],
        },
        timelineItems: {
          nodes: [
            asked(1, person('bo')),
            asked(1, person('cy')),
            asked(1, { __typename: 'Team', name: 'Core' }),
            review(5, 'bo', 'APPROVED'),
            review(9, 'bo', 'COMMENTED'),
          ],
        },
      }),
      'octo/app',
      baseline,
      now,
    );
    expect(pull.reviewers.map((r) => [r.login, r.state, r.reviews, r.responseHours])).toEqual([
      ['bo', 'APPROVED', 2, 4],
      ['cy', 'PENDING', 0, null],
      ['Core', 'PENDING', 0, null],
    ]);
    expect(pull.waitingOn).toEqual({ kind: 'review', who: ['cy', 'Core'], since: at(1) });
  });

  it('counts review rounds: changes requested, commits after the first review and force pushes', () => {
    const pull = buildPull(
      raw({
        reviewDecision: 'CHANGES_REQUESTED',
        timelineItems: {
          nodes: [
            review(4, 'bo', 'CHANGES_REQUESTED'),
            { __typename: 'HeadRefForcePushedEvent', createdAt: at(6) },
            review(9, 'bo', 'CHANGES_REQUESTED'),
          ],
        },
        history: { nodes: [commit(1, null), commit(5, null), commit(7, null)] },
      }),
      'octo/app',
      baseline,
      now,
    );
    expect(pull.rounds).toEqual({ changesRequested: 2, commitsAfterFirstReview: 2, forcePushes: 1 });
    expect(pull.waitingOn).toEqual({ kind: 'author', who: ['ana'], since: at(9) });
  });

  it('reads the checks of the latest commit and how many commits failed along the way', () => {
    const pull = buildPull(
      raw({
        history: { nodes: [commit(1, ['FAILURE', 'SUCCESS']), commit(2, null), commit(3, ['SUCCESS'])] },
        latest: {
          nodes: [
            {
              commit: {
                statusCheckRollup: {
                  contexts: {
                    nodes: [
                      { name: 'tests', conclusion: 'FAILURE', startedAt: at(3), completedAt: at(3.25) },
                      { name: 'lint', conclusion: 'SUCCESS', startedAt: at(3), completedAt: at(3.05) },
                    ],
                  },
                },
              },
            },
          ],
        },
      }),
      'octo/app',
      baseline,
      now,
    );
    expect(pull.checks).toMatchObject({
      state: 'failure',
      minutes: 15,
      failedPushes: 1,
      pushesWithChecks: 2,
    });
    expect(pull.checks.list.map((c) => c.name)).toEqual(['lint', 'tests']);
    expect(pull.waitingOn).toEqual({ kind: 'checks', who: ['ana'], since: null });
  });

  it('knows a draft waits on its author, and an approved one waits to be merged', () => {
    expect(buildPull(raw({ isDraft: true }), 'octo/app', baseline, now).waitingOn?.kind).toBe('draft');
    const approved = buildPull(
      raw({ reviewDecision: 'APPROVED', timelineItems: { nodes: [review(6, 'bo', 'APPROVED')] } }),
      'octo/app',
      baseline,
      now,
    );
    expect(approved.waitingOn).toEqual({ kind: 'merge', who: [], since: at(6) });
    // Nobody asked and nobody reviewed: it waits for a first review since it opened.
    expect(buildPull(raw(), 'octo/app', baseline, now).waitingOn).toEqual({
      kind: 'review',
      who: [],
      since: at(0),
    });
  });

  it('counts comments like the list: the conversation, the code and written reviews', () => {
    const pull = buildPull(
      raw({
        comments: { totalCount: 4 },
        threadComments: { nodes: [{ comments: { totalCount: 3 } }, { comments: { totalCount: 2 } }] },
        written: { nodes: [{ body: 'LGTM' }, { body: '' }, { body: null }] },
      }),
      'octo/app',
      baseline,
      now,
    );
    expect(pull.comments).toBe(10);
  });

  it('has no age or waiting state once closed without merging', () => {
    const closed = buildPull(raw({ state: 'CLOSED', closedAt: at(5) }), 'octo/app', baseline, now);
    expect(closed.ageHours).toBeNull();
    expect(closed.waitingOn).toBeNull();
    expect(closed.stages.at(-1)).toEqual({ kind: 'closed', at: at(5), hours: 5 });
  });
});
