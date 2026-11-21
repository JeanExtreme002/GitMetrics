import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { RepoSummary } from '../src/shared/types';
import { GitHubClient } from '../src/server/github';
import { buildActivityRanking, getActivityRanking, getTrafficRanking } from '../src/server/metrics/rankings';
import { TrafficStore } from '../src/server/store';

describe('activity ranking', () => {
  it('ranks repositories by recent commits and drops quiet ones', () => {
    const node = (name: string, commits: number | null) => ({
      name,
      nameWithOwner: `me/${name}`,
      defaultBranchRef: commits === null ? null : { target: { history: { totalCount: commits } } },
    });
    expect(
      buildActivityRanking([node('a', 3), node('b', 40), node('empty', null), node('quiet', 0)]),
    ).toEqual([
      { fullName: 'me/b', name: 'b', value: 40, secondary: null },
      { fullName: 'me/a', name: 'a', value: 3, secondary: null },
    ]);
  });
});

describe('activity ranking across pages', () => {
  it('follows the cursor through every page of repositories', async () => {
    const node = (name: string, commits: number) => ({
      name,
      nameWithOwner: `me/${name}`,
      defaultBranchRef: { target: { history: { totalCount: commits } } },
    });
    const pages = [
      { pageInfo: { hasNextPage: true, endCursor: 'after-a' }, nodes: [node('a', 2)] },
      { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [node('b', 7)] },
    ];
    const cursors: (string | null)[] = [];
    const fetchImpl = (async (_input: string | URL | Request, init?: RequestInit) => {
      cursors.push(JSON.parse(String(init?.body)).variables.cursor);
      return new Response(JSON.stringify({ data: { viewer: { repositories: pages.shift() } } }));
    }) as typeof fetch;
    const result = await getActivityRanking(new GitHubClient('t', fetchImpl));
    expect(cursors).toEqual([null, 'after-a']);
    expect(result.entries.map((e) => [e.name, e.value])).toEqual([
      ['b', 7],
      ['a', 2],
    ]);
  });
});

describe('traffic ranking', () => {
  it('ranks by unique visitors, skips repositories without access and stores history', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'gitmetrics-'));
    try {
      const fetchImpl = (async (input: string | URL | Request) => {
        const url = String(input);
        if (url.includes('/me/popular/')) {
          return new Response(
            JSON.stringify({
              count: 50,
              uniques: 9,
              views: [{ timestamp: '2025-06-01T00:00:00Z', count: 50, uniques: 9 }],
            }),
          );
        }
        if (url.includes('/me/small/'))
          return new Response(JSON.stringify({ count: 2, uniques: 1, views: [] }));
        return new Response(JSON.stringify({ message: 'Must have push access' }), { status: 403 });
      }) as typeof fetch;
      const repo = (name: string) => ({ fullName: `me/${name}`, name }) as RepoSummary;
      const result = await getTrafficRanking(new GitHubClient('t', fetchImpl), new TrafficStore(dir), [
        repo('small'),
        repo('popular'),
        repo('locked'),
      ]);
      expect(result.entries.map((e) => [e.name, e.value, e.secondary])).toEqual([
        ['popular', 9, 50],
        ['small', 1, 2],
      ]);
      expect(new TrafficStore(dir).merge('me/popular', 'views', {})).toEqual({ '2025-06-01': [50, 9] });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
