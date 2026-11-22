import { describe, expect, it } from 'vitest';
import { withGaps } from '../src/web/lib/traffic';

const d = (date: string, count = 1) => ({ date, count, uniques: count });

describe('days the traffic was not saved', () => {
  it('leaves them empty, never zero, and says where they are', () => {
    const { days, gaps } = withGaps([d('2026-03-05', 0), d('2026-03-01'), d('2026-03-02'), d('2026-03-06')]);
    expect(days.map((x) => [x.date, x.count])).toEqual([
      ['2026-03-01', 1],
      ['2026-03-02', 1],
      ['2026-03-03', null],
      ['2026-03-04', null],
      // A quiet day GitHub reported stays a zero.
      ['2026-03-05', 0],
      ['2026-03-06', 1],
    ]);
    expect(gaps).toEqual([{ from: '2026-03-03', to: '2026-03-04', days: 2 }]);
  });

  it('has no gap when every day was saved, across months', () => {
    expect(withGaps([d('2026-02-27'), d('2026-02-28'), d('2026-03-01')]).gaps).toEqual([]);
    expect(withGaps([]).days).toEqual([]);
  });
});
