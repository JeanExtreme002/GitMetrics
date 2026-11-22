import { describe, expect, it } from 'vitest';
import type { PullDetail } from '../src/shared/types';
import { reviewerActivity } from '../src/web/lib/pulls';

const pull = (over: Partial<PullDetail> = {}) =>
  ({
    author: 'ana',
    activity: {
      unit: 'day',
      points: ['2026-03-01', '2026-03-02', '2026-03-03'].map((day) => ({
        day,
        commits: 0,
        reviews: 0,
        comments: 0,
      })),
    },
    reviewers: [{ login: 'Bo', avatarUrl: 'https://avatars/bo' }],
    reviewMarks: [
      { hours: 1, state: 'COMMENTED', login: 'Bo', at: '2026-03-01T10:00:00Z' },
      { hours: 30, state: 'APPROVED', login: 'Bo', at: '2026-03-02T16:00:00Z' },
      { hours: 50, state: 'CHANGES_REQUESTED', login: 'cy', at: '2026-03-03T09:00:00Z' },
    ],
    commentMarks: [
      { hours: 2, login: 'bo', at: '2026-03-01T11:00:00Z' },
      { hours: 3, login: 'ana', at: '2026-03-01T12:00:00Z' },
      { hours: 4, login: 'ci', at: '2026-03-01T13:00:00Z', bot: true },
      { hours: 5, login: 'ghost', at: '2026-03-01T14:00:00Z' },
      { hours: 99, login: 'cy', at: '2026-03-09T09:00:00Z' },
    ],
    ...over,
  }) as unknown as PullDetail;

describe("each reviewer's activity", () => {
  it('puts reviews and comments on the days of the activity chart, most active first', () => {
    const { comments, people } = reviewerActivity(pull())!;
    expect(comments).toBe(true);
    // The author, apps and deleted accounts are left out; logins match whatever their case.
    expect(people.map((p) => [p.login, p.total, p.avatarUrl])).toEqual([
      ['Bo', 3, 'https://avatars/bo'],
      ['cy', 2, null],
    ]);
    expect(people[0]!.points.map((p) => [p.COMMENTED, p.APPROVED, p.comments])).toEqual([
      [1, 0, 1],
      [0, 1, 0],
      [0, 0, 0],
    ]);
    // Past the end, a comment goes on the last day.
    expect(people[1]!.points[2]).toMatchObject({ CHANGES_REQUESTED: 1, comments: 1 });
  });

  it('counts by week on long pull requests', () => {
    const weeks = pull({
      activity: {
        unit: 'week',
        points: ['2026-03-01', '2026-03-08'].map((day) => ({ day, commits: 0, reviews: 0, comments: 0 })),
      },
    });
    expect(reviewerActivity(weeks)!.people[1]!.points.map((p) => p.comments)).toEqual([0, 1]);
  });

  it('shows reviews only when not every comment could be read, and nothing without activity', () => {
    const partial = reviewerActivity(pull({ commentMarks: null }))!;
    expect(partial.comments).toBe(false);
    expect(partial.people.map((p) => p.total)).toEqual([2, 1]);
    expect(reviewerActivity(pull({ activity: null }))).toBeNull();
  });
});
