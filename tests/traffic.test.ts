import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GitHubClient } from '../src/server/github';
import { getTraffic } from '../src/server/metrics/traffic';
import { TrafficStore } from '../src/server/store';

type Day = [string, number, number];

/** GitHub's traffic API, returning the given 14-day window of views and clones. */
function trafficApi(views: Day[], clones: Day[], status = 200) {
  const window = (days: Day[]) => ({
    count: days.reduce((s, d) => s + d[1], 0),
    uniques: days.reduce((s, d) => s + d[2], 0),
    views: days.map(([date, count, uniques]) => ({ timestamp: `${date}T00:00:00Z`, count, uniques })),
  });
  return (async (input: string | URL | Request) => {
    if (status !== 200) return new Response(JSON.stringify({ message: 'Must have push access' }), { status });
    const url = String(input);
    if (url.endsWith('/views')) return new Response(JSON.stringify(window(views)));
    if (url.endsWith('/clones')) {
      const w = window(clones);
      return new Response(JSON.stringify({ count: w.count, uniques: w.uniques, clones: w.views }));
    }
    return new Response('[]');
  }) as typeof fetch;
}

describe('traffic history', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'gitmetrics-traffic-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('keeps days that have left GitHub 14-day window', async () => {
    const store = new TrafficStore(dir);
    const first = new GitHubClient(
      't',
      trafficApi(
        [
          ['2025-06-01', 10, 4],
          ['2025-06-02', 8, 3],
        ],
        [['2025-06-01', 2, 1]],
      ),
    );
    await getTraffic(first, store, 'me', 'app');

    // A week later the window has moved on; June 2 got a final, higher count.
    const later = new GitHubClient(
      't',
      trafficApi(
        [
          ['2025-06-02', 9, 3],
          ['2025-06-08', 5, 2],
        ],
        [],
      ),
    );
    const result = await getTraffic(later, new TrafficStore(dir), 'me', 'app');

    expect(result.views.daily).toEqual([
      { date: '2025-06-01', count: 10, uniques: 4 },
      { date: '2025-06-02', count: 9, uniques: 3 },
      { date: '2025-06-08', count: 5, uniques: 2 },
    ]);
    expect(result.clones.daily).toEqual([{ date: '2025-06-01', count: 2, uniques: 1 }]);
    // The totals stay GitHub's own figures for the current window.
    expect(result.views.count).toBe(14);
    expect(result.trackedSince).toBe('2025-06-01');
  });

  it('explains that traffic needs push access instead of failing', async () => {
    const result = await getTraffic(
      new GitHubClient('t', trafficApi([], [], 403)),
      new TrafficStore(dir),
      'me',
      'app',
    );
    expect(result.available).toBe(false);
    expect(result.reason).toMatch(/push access/);
    expect(result.views.daily).toEqual([]);
  });

  it('lets other errors through', async () => {
    await expect(
      getTraffic(new GitHubClient('t', trafficApi([], [], 500)), new TrafficStore(dir), 'me', 'app'),
    ).rejects.toMatchObject({ status: 500 });
  });
});
