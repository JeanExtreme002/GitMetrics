import { describe, expect, it } from 'vitest';
import { lastDays, lastMonths, mapLimit, median, monthsBetween } from '../src/server/util';

describe('date helpers', () => {
  const now = new Date('2025-03-15T10:00:00Z');

  it('lists the last months, oldest first', () => {
    expect(lastMonths(3, now)).toEqual(['2025-01', '2025-02', '2025-03']);
  });

  it('crosses year boundaries', () => {
    expect(monthsBetween('2024-11', '2025-02')).toEqual(['2024-11', '2024-12', '2025-01', '2025-02']);
  });

  it('lists the last days, oldest first', () => {
    expect(lastDays(3, now)).toEqual(['2025-03-13', '2025-03-14', '2025-03-15']);
  });
});

describe('median', () => {
  it('handles empty, odd and even inputs', () => {
    expect(median([])).toBeNull();
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });
});

describe('mapLimit', () => {
  it('keeps order and never exceeds the concurrency limit', async () => {
    let active = 0;
    let peak = 0;
    const result = await mapLimit([1, 2, 3, 4, 5, 6], 2, async (n) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return n * 10;
    });
    expect(result).toEqual([10, 20, 30, 40, 50, 60]);
    expect(peak).toBe(2);
  });
});
