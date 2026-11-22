import { describe, expect, it } from 'vitest';
import type { GitHubClient } from '../src/server/github';
import {
  finalApproval,
  buildActivity,
  buildFolders,
  buildPhases,
  buildPull,
  getPull,
  readAll,
  type RawPull,
} from '../src/server/metrics/pull';

const at = (hours: number) => new Date(Date.UTC(2026, 10, 1) + hours * 3_600_000).toISOString();
const person = (login: string) => ({ __typename: 'User', login, avatarUrl: `https://avatars/${login}` });
const review = (hours: number, login: string, state: string, body = '', typename = 'User') => ({
  submittedAt: at(hours),
  state,
  body,
  author: { ...person(login), __typename: typename },
});
const asked = (hours: number, reviewer: { __typename: string; login?: string; name?: string }) => ({
  __typename: 'ReviewRequestedEvent',
  createdAt: at(hours),
  requestedReviewer: reviewer,
});

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
    changedFiles: 2,
    baseRefName: 'main',
    headRefName: 'cache',
    author: person('ana'),
    participants: { totalCount: 3 },
    reviews: [],
    comments: { totalCount: 0, createdAt: [] },
    commits: { totalCount: 1, committedAt: [at(0)] },
    threads: { totalCount: 0, nodes: [] },
    requests: [],
    files: {
      totalCount: 2,
      nodes: [
        { path: 'src/cache.ts', additions: 150, deletions: 40 },
        { path: 'tests/cache.test.ts', additions: 50, deletions: 10 },
      ],
    },
    events: [],
    checks: [],
    ...overrides,
  };
}

const now = new Date(at(100));

describe('where the time went', () => {
  const ready = (h: number) => ({ kind: 'ready' as const, at: at(h) });
  const toDraft = (h: number) => ({ kind: 'draft' as const, at: at(h) });

  it('splits the life of a pull request into stretches in order, that add up', () => {
    const phases = buildPhases(at(0), [ready(2)], false, at(8), at(12), at(20), false);
    expect(phases).toEqual([
      { kind: 'draft', hours: 2, ongoing: false },
      { kind: 'waiting', hours: 6, ongoing: false },
      { kind: 'review', hours: 4, ongoing: false },
      { kind: 'approved', hours: 8, ongoing: false },
    ]);
    expect(phases.reduce((sum, p) => sum + p.hours, 0)).toBe(20);
  });

  it('shows every time it went back to draft, in order', () => {
    expect(
      buildPhases(at(0), [toDraft(10), ready(14)], false, at(4), null, at(20), false).map((p) => [
        p.kind,
        p.hours,
      ]),
    ).toEqual([
      ['waiting', 4],
      ['review', 6],
      ['draft', 4],
      ['review', 6],
    ]);
    // Still a draft now: the last stretch is draft, and ongoing.
    expect(buildPhases(at(0), [], true, null, null, at(5), true)).toEqual([
      { kind: 'draft', hours: 5, ongoing: true },
    ]);
  });

  it('marks the stretch an open pull request is in now', () => {
    expect(buildPhases(at(0), [], false, null, null, at(30), true)).toEqual([
      { kind: 'waiting', hours: 30, ongoing: true },
    ]);
    // Approved with its first review: no time in review.
    expect(buildPhases(at(0), [], false, at(5), at(5), at(9), true)).toEqual([
      { kind: 'waiting', hours: 5, ongoing: false },
      { kind: 'approved', hours: 4, ongoing: true },
    ]);
  });

  it('takes the first approval after the last request for changes, and ignores later extra ones', () => {
    const r = (h: number, state: string) => ({ submittedAt: at(h), state });
    expect(
      finalApproval([r(1, 'APPROVED'), r(2, 'CHANGES_REQUESTED'), r(5, 'APPROVED'), r(6, 'COMMENTED')]),
    ).toBe(at(5));
    expect(finalApproval([r(1, 'APPROVED'), r(3, 'CHANGES_REQUESTED')])).toBeNull();
    // More approvals after it don't move it: it stayed approved since the first one.
    expect(finalApproval([r(1, 'CHANGES_REQUESTED'), r(4, 'APPROVED'), r(9, 'APPROVED')])).toBe(at(4));
    // A dismissed approval doesn't count.
    expect(finalApproval([r(1, 'DISMISSED')])).toBeNull();
  });
});

describe('where the change is', () => {
  it('adds up lines per top-level folder, biggest first', () => {
    expect(
      buildFolders([
        { path: 'src/a.ts', additions: 10, deletions: 2 },
        { path: 'src/b/c.ts', additions: 5, deletions: 0 },
        { path: 'docs/readme.md', additions: 30, deletions: 0 },
        { path: 'package.json', additions: 1, deletions: 1 },
      ]),
    ).toEqual([
      { path: 'docs', additions: 30, deletions: 0, files: 1 },
      { path: 'src', additions: 15, deletions: 2, files: 2 },
      { path: '(root)', additions: 1, deletions: 1, files: 1 },
    ]);
  });

  it('goes deeper while everything is in one folder, naming files by where they sit', () => {
    expect(
      buildFolders([
        { path: 'infra/prod/web/app.tf', additions: 9, deletions: 0 },
        { path: 'infra/prod/web/db.tf', additions: 3, deletions: 0 },
        { path: 'infra/prod/vars.tf', additions: 1, deletions: 0 },
      ]).map((f) => [f.path, f.files]),
    ).toEqual([
      ['infra/prod/web', 2],
      ['infra/prod', 1],
    ]);
  });

  it('groups what is past the first seven folders as Other', () => {
    const files = Array.from({ length: 10 }, (_, i) => ({
      path: `f${i}/x.ts`,
      additions: 10 - i,
      deletions: 0,
    }));
    const folders = buildFolders(files);
    expect(folders).toHaveLength(8);
    expect(folders.at(-1)).toEqual({ path: 'Other', additions: 3 + 2 + 1, deletions: 0, files: 3 });
  });
});

describe('activity over time', () => {
  it('counts commits, reviews and comments per day, anything earlier on the first day', () => {
    const activity = buildActivity(at(0), at(50), {
      commits: [at(-30), at(1), at(26)],
      reviews: [at(27)],
      comments: [at(2), at(49)],
    });
    expect(activity.unit).toBe('day');
    expect(activity.points).toEqual([
      { day: '2026-11-01', commits: 2, reviews: 0, comments: 1 },
      { day: '2026-11-02', commits: 1, reviews: 1, comments: 0 },
      { day: '2026-11-03', commits: 0, reviews: 0, comments: 1 },
    ]);
  });

  it('counts per week past two months, so the chart stays readable', () => {
    const activity = buildActivity(at(0), at(24 * 90), { commits: [at(24 * 89)], reviews: [], comments: [] });
    expect(activity.unit).toBe('week');
    expect(activity.points).toHaveLength(13);
    expect(activity.points.at(-1)!.commits).toBe(1);
  });
});

describe('a pull request in detail', () => {
  it('times each stage from the reviews of people, not apps or the author', () => {
    const pull = buildPull(
      raw({
        state: 'MERGED',
        mergedAt: at(20),
        reviewDecision: 'APPROVED',
        events: [{ __typename: 'ReadyForReviewEvent', createdAt: at(2) }],
        reviews: [
          review(1, 'coverage-bot', 'COMMENTED', 'Coverage report', 'Bot'),
          review(3, 'ana', 'COMMENTED'),
          review(8, 'bo', 'COMMENTED'),
          review(12, 'bo', 'APPROVED'),
        ],
      }),
      'octo/app',
      now,
    );
    expect(pull.stages.map((s) => [s.kind, s.hours])).toEqual([
      ['opened', null],
      ['ready', 2],
      ['first-review', 6],
      ['approved', 4],
      ['merged', 8],
    ]);
    expect(pull.firstReviewHours).toBe(6);
    expect(pull.ageHours).toBe(20);
    expect(pull.phases.map((p) => [p.kind, p.hours])).toEqual([
      ['draft', 2],
      ['waiting', 6],
      ['review', 4],
      ['approved', 8],
    ]);
    // Each review by a person where it happened; the bot and the author's own are left out.
    expect(pull.reviewMarks.map((m) => [m.login, m.state, m.hours])).toEqual([
      ['bo', 'COMMENTED', 8],
      ['bo', 'APPROVED', 12],
    ]);
    expect(pull.waitingOn).toBeNull();
  });

  it('counts comments like the Conversation tab: conversation, code and written reviews', () => {
    const pull = buildPull(
      raw({
        reviews: [review(1, 'bo', 'COMMENTED', 'Looks good'), review(2, 'bo', 'COMMENTED', '  ')],
        comments: { totalCount: 4, createdAt: [at(1), at(2), at(3), at(4)] },
        threads: {
          totalCount: 2,
          nodes: [
            {
              comments: {
                totalCount: 3,
                nodes: [{ createdAt: at(1) }, { createdAt: at(2) }, { createdAt: at(3) }],
              },
            },
            { comments: { totalCount: 2, nodes: [{ createdAt: at(5) }, { createdAt: at(6) }] } },
          ],
        },
      }),
      'octo/app',
      now,
    );
    expect(pull.comments).toBe(4 + 5 + 1);
    expect(pull.reviewThreads).toBe(2);
  });

  it('says it has conflicts only when GitHub knows, and only while open', () => {
    expect(buildPull(raw({ mergeable: 'CONFLICTING' }), 'octo/app', now).conflicts).toBe(true);
    // Right after a push GitHub may still be working it out.
    expect(buildPull(raw({ mergeable: 'UNKNOWN' }), 'octo/app', now).conflicts).toBe(false);
    expect(buildPull(raw({ mergeable: 'MERGEABLE' }), 'octo/app', now).conflicts).toBe(false);
    expect(
      buildPull(raw({ state: 'MERGED', mergedAt: at(5), mergeable: 'CONFLICTING' }), 'octo/app', now)
        .conflicts,
    ).toBe(false);
  });

  it('places every commit by the date written in it, and none when GitHub lists only some', () => {
    const pull = buildPull(
      raw({ commits: { totalCount: 3, committedAt: [at(4), at(-2), at(1)], by: ['bo', null, 'cy'] } }),
      'octo/app',
      now,
    );
    // A commit dated before the opening goes at its start; one without an author says so.
    expect(pull.commitMarks).toEqual([
      { at: at(-2), login: 'someone', hours: 0 },
      { at: at(1), login: 'cy', hours: 1 },
      { at: at(4), login: 'bo', hours: 4 },
    ]);
    expect(
      buildPull(raw({ commits: { totalCount: 300, committedAt: [at(0)] } }), 'octo/app', now).commitMarks,
    ).toBeNull();
  });

  it('places every comment, in the conversation and on the code, in order', () => {
    const pull = buildPull(
      raw({
        comments: {
          totalCount: 3,
          createdAt: [at(3), at(1), at(4)],
          by: ['bo', null, 'ci'],
          bot: [false, false, true],
        },
        threads: {
          totalCount: 1,
          nodes: [
            {
              comments: {
                totalCount: 2,
                nodes: [
                  { createdAt: at(2), author: person('cy') },
                  { createdAt: at(5), author: { __typename: 'Bot', login: 'lint', avatarUrl: '' } },
                ],
              },
            },
          ],
        },
      }),
      'octo/app',
      now,
    );
    expect(pull.commentMarks).toEqual([
      { at: at(1), login: 'ghost', hours: 1 },
      { at: at(2), login: 'cy', hours: 2 },
      { at: at(3), login: 'bo', hours: 3 },
      // Comments by apps are marked, so the reviewer chart can leave them out.
      { at: at(4), login: 'ci', hours: 4, bot: true },
      { at: at(5), login: 'lint', hours: 5, bot: true },
    ]);
    // A thread longer than one page: the comments can't all be placed, so none are.
    const long = { comments: { totalCount: 150, nodes: [{ createdAt: at(1), author: person('cy') }] } };
    expect(
      buildPull(raw({ threads: { totalCount: 1, nodes: [long] } }), 'octo/app', now).commentMarks,
    ).toBeNull();
  });

  it('leaves out what GitHub could not list in full instead of showing part of it', () => {
    const complete = buildPull(raw(), 'octo/app', now);
    expect(complete.folders).not.toBeNull();
    expect(complete.activity).not.toBeNull();

    // More files than GitHub lists, more commits than it lists, a thread longer than one page.
    expect(
      buildPull(raw({ files: { ...raw().files, totalCount: 3001 } }), 'octo/app', now).folders,
    ).toBeNull();
    expect(
      buildPull(raw({ commits: { totalCount: 300, committedAt: [at(0)] } }), 'octo/app', now).activity,
    ).toBeNull();
    const longThread = { comments: { totalCount: 120, nodes: [{ createdAt: at(1) }] } };
    const pull = buildPull(raw({ threads: { totalCount: 1, nodes: [longThread] } }), 'octo/app', now);
    expect(pull.activity).toBeNull();
    // The count itself stays exact: it comes from GitHub's total, not from the dates read.
    expect(pull.comments).toBe(120);
  });

  it('follows each reviewer from their request, and keeps an approval a later comment does not undo', () => {
    const pull = buildPull(
      raw({
        requests: [
          { requestedReviewer: person('cy') },
          { requestedReviewer: { __typename: 'Team', name: 'Core' } },
        ],
        events: [
          asked(1, person('bo')),
          asked(1, person('cy')),
          asked(1, { __typename: 'Team', name: 'Core' }),
        ],
        reviews: [review(5, 'bo', 'APPROVED'), review(9, 'bo', 'COMMENTED')],
      }),
      'octo/app',
      now,
    );
    expect(pull.reviewers.map((r) => [r.login, r.state, r.reviews, r.responseHours])).toEqual([
      ['bo', 'APPROVED', 2, 4],
      ['cy', 'PENDING', 0, null],
      ['Core', 'PENDING', 0, null],
    ]);
    expect(pull.waitingOn).toEqual({ kind: 'review', who: ['cy', 'Core'], since: at(1) });
  });

  it('keeps the review someone gave once merged, even if they were asked again', () => {
    const base = {
      requests: [{ requestedReviewer: person('bo') }, { requestedReviewer: person('cy') }],
      reviews: [review(5, 'bo', 'APPROVED')],
    };
    const open = buildPull(raw(base), 'octo/app', now);
    expect(open.reviewers.map((r) => [r.login, r.state])).toEqual([
      ['bo', 'PENDING'],
      ['cy', 'PENDING'],
    ]);
    const merged = buildPull(raw({ ...base, state: 'MERGED', mergedAt: at(10) }), 'octo/app', now);
    expect(merged.reviewers.map((r) => [r.login, r.state])).toEqual([
      ['bo', 'APPROVED'],
      ['cy', 'PENDING'],
    ]);
  });

  it('counts comments on the code by others as reviewing, as before GitHub had reviews', () => {
    const thread = (h: number, login: string, typename = 'User') => ({
      comments: {
        totalCount: 1,
        nodes: [{ createdAt: at(h), author: { ...person(login), __typename: typename } }],
      },
    });
    const pull = buildPull(
      raw({
        state: 'CLOSED',
        closedAt: at(100),
        // The author's own and an app's comments don't count; bo's does, long before any review.
        threads: { totalCount: 3, nodes: [thread(2, 'ana'), thread(3, 'lint-bot', 'Bot'), thread(5, 'bo')] },
        reviews: [review(60, 'cy', 'CHANGES_REQUESTED')],
      }),
      'octo/app',
      now,
    );
    expect(pull.firstReviewHours).toBe(5);
    expect(pull.stages.find((s) => s.kind === 'first-review')?.at).toBe(at(5));
    expect(pull.phases.map((p) => [p.kind, p.hours])).toEqual([
      ['waiting', 5],
      ['review', 95],
    ]);
    expect(pull.reviewers.map((r) => [r.login, r.state, r.responseHours])).toEqual([
      ['cy', 'CHANGES_REQUESTED', 60],
      ['bo', 'COMMENTED', 5],
    ]);
  });

  it('counts requested changes and force pushes, and then waits on the author', () => {
    const pull = buildPull(
      raw({
        reviewDecision: 'CHANGES_REQUESTED',
        reviews: [review(4, 'bo', 'CHANGES_REQUESTED'), review(9, 'bo', 'CHANGES_REQUESTED')],
        events: [{ __typename: 'HeadRefForcePushedEvent', createdAt: at(6) }],
      }),
      'octo/app',
      now,
    );
    expect(pull.rounds).toEqual({ changesRequested: 2, forcePushes: 1 });
    expect(pull.waitingOn).toEqual({ kind: 'author', who: ['ana'], since: at(9) });
  });

  it('adds up the checks on the latest commit, one run per check', () => {
    const pull = buildPull(
      raw({
        checks: [
          { name: 'tests', conclusion: 'CANCELLED', startedAt: at(1), completedAt: at(1.1) },
          { name: 'tests', conclusion: 'FAILURE', startedAt: at(2), completedAt: at(2.25) },
          { name: 'lint', conclusion: 'SUCCESS', startedAt: at(2), completedAt: at(2.05) },
        ],
      }),
      'octo/app',
      now,
    );
    expect(pull.checks.list.map((c) => [c.name, c.conclusion])).toEqual([
      ['lint', 'success'],
      ['tests', 'failure'],
    ]);
    expect(pull.checks.minutes).toBeCloseTo(15);
    expect(pull.checks.totalMinutes).toBeCloseTo(18);
    expect(pull.waitingOn).toEqual({ kind: 'checks', who: ['ana'], since: null });
  });

  it('knows a draft waits on its author, and an approved one waits to be merged', () => {
    expect(buildPull(raw({ isDraft: true }), 'octo/app', now).waitingOn?.kind).toBe('draft');
    const approved = buildPull(
      raw({ reviewDecision: 'APPROVED', reviews: [review(6, 'bo', 'APPROVED')] }),
      'octo/app',
      now,
    );
    expect(approved.waitingOn).toEqual({ kind: 'merge', who: [], since: at(6) });
    expect(buildPull(raw(), 'octo/app', now).waitingOn).toEqual({ kind: 'review', who: [], since: at(0) });
  });

  it('has no age or waiting state once closed without merging', () => {
    const closed = buildPull(raw({ state: 'CLOSED', closedAt: at(5) }), 'octo/app', now);
    expect(closed.ageHours).toBeNull();
    expect(closed.waitingOn).toBeNull();
    expect(closed.stages.at(-1)).toEqual({ kind: 'closed', at: at(5), hours: 5 });
    expect(closed.phases).toEqual([{ kind: 'waiting', hours: 5, ongoing: false }]);
  });
});

describe('reading every page', () => {
  const page = <T>(nodes: T[], endCursor: string | null) => ({
    pageInfo: { hasNextPage: endCursor !== null, endCursor },
    nodes,
  });

  it('follows the next page until there is none, even when pages come back short', async () => {
    const asked: string[] = [];
    const pages: Record<string, ReturnType<typeof page<number>>> = {
      a: page([3], 'b'),
      b: page([], 'c'),
      c: page([4, 5], null),
    };
    const all = await readAll(page([1, 2], 'a'), async (after) => {
      asked.push(after);
      return pages[after];
    });
    expect(all).toEqual([1, 2, 3, 4, 5]);
    expect(asked).toEqual(['a', 'b', 'c']);
  });

  it('reads the rest of a long connection through the pull request itself', async () => {
    const done = { hasNextPage: false, endCursor: null };
    const empty = { totalCount: 0, pageInfo: done, nodes: [] };
    const first = {
      id: 'PR_1',
      ...raw(),
      reviews: {
        totalCount: 2,
        pageInfo: { hasNextPage: true, endCursor: 'r1' },
        nodes: [review(1, 'bo', 'COMMENTED')],
      },
      comments: empty,
      commits: { totalCount: 1, pageInfo: done, nodes: [{ commit: { committedDate: at(0) } }] },
      threads: empty,
      requests: empty,
      files: { totalCount: 2, pageInfo: done, nodes: raw().files.nodes },
      events: empty,
      latest: { nodes: [] },
    };
    const queries: string[] = [];
    const gh = {
      graphql: async (query: string, variables: Record<string, unknown>) => {
        queries.push(query);
        if (query.includes('pullRequest(number: $number)')) return { repository: { pullRequest: first } };
        expect(variables).toEqual({ id: 'PR_1', after: 'r1' });
        return { node: { reviews: { totalCount: 2, pageInfo: done, nodes: [review(3, 'cy', 'APPROVED')] } } };
      },
    } as unknown as GitHubClient;
    const pull = await getPull(gh, 'octo', 'app', 7);
    expect(pull!.reviewers.map((r) => r.login)).toEqual(['bo', 'cy']);
    expect(queries).toHaveLength(2);
  });
});
