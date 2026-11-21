import { describe, expect, it } from 'vitest';
import { buildStars, dailyPoints, pointsFromPage, samplePages, starsAt } from '../src/server/metrics/stars';

describe('samplePages', () => {
  it('returns every page when there are few', () => {
    expect(samplePages(4)).toEqual([1, 2, 3, 4]);
  });

  it('always includes the first and last page when sampling', () => {
    const pages = samplePages(400, 20);
    expect(pages[0]).toBe(1);
    expect(pages.at(-1)).toBe(400);
    expect(pages.length).toBeLessThanOrEqual(20);
  });
});

describe('star history', () => {
  const items = [
    { starred_at: '2025-01-05T10:00:00Z' },
    { starred_at: '2025-01-05T12:00:00Z' },
    { starred_at: '2025-02-10T09:00:00Z' },
    { starred_at: '2025-03-01T09:00:00Z' },
  ];

  it('numbers stars from the page offset', () => {
    expect(pointsFromPage(items, 100).map((p) => p.stars)).toEqual([101, 102, 103, 104]);
  });

  it('keeps one point per day', () => {
    expect(dailyPoints(pointsFromPage(items, 0))).toEqual([
      { date: '2025-01-05', stars: 2 },
      { date: '2025-02-10', stars: 3 },
      { date: '2025-03-01', stars: 4 },
    ]);
  });

  it('interpolates between known points', () => {
    const points = [
      { date: '2025-01-01T00:00:00Z', stars: 0 },
      { date: '2025-01-11T00:00:00Z', stars: 10 },
    ];
    expect(starsAt(points, new Date('2025-01-06T00:00:00Z').getTime())).toBe(5);
    expect(starsAt(points, new Date('2024-12-01').getTime())).toBe(0);
    expect(starsAt(points, new Date('2025-06-01').getTime())).toBe(10);
  });

  it('builds monthly gains and recent stats', () => {
    const now = new Date('2025-03-20T00:00:00Z');
    const result = buildStars(pointsFromPage(items, 0), 4, false, now);
    expect(result.monthly).toEqual([
      { month: '2025-01', stars: 2 },
      { month: '2025-02', stars: 1 },
      { month: '2025-03', stars: 1 },
    ]);
    expect(result.stats.last30Days).toBe(1);
    expect(result.stats.bestMonth).toEqual({ month: '2025-01', stars: 2 });
    expect(result.firstStarAt).toBe('2025-01-05T10:00:00Z');
  });

  it('handles repositories without stars', () => {
    const result = buildStars([], 0, false);
    expect(result.points).toEqual([]);
    expect(result.stats.bestMonth).toBeNull();
  });
});

describe('recent stargazers', () => {
  it('returns the latest stargazers newest first', async () => {
    const { GitHubClient } = await import('../src/server/github');
    const { getRecentStargazers } = await import('../src/server/metrics/stars');
    const edge = (login: string, starredAt: string) => ({
      starredAt,
      node: { login, name: null, avatarUrl: '', url: `https://github.com/${login}` },
    });
    const fetchImpl = (async () =>
      new Response(
        JSON.stringify({
          data: {
            repository: {
              stargazers: {
                edges: [edge('older', '2025-01-01T00:00:00Z'), edge('newer', '2025-02-01T00:00:00Z')],
              },
            },
          },
        }),
      )) as typeof fetch;
    const people = await getRecentStargazers(new GitHubClient('t', fetchImpl), 'o', 'r');
    expect(people.map((p) => p.login)).toEqual(['newer', 'older']);
    expect(people[0]).toMatchObject({ starredAt: '2025-02-01T00:00:00Z', url: 'https://github.com/newer' });
  });
});
