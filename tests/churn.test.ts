import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { GitHubClient } from '../src/server/github';
import { buildChurn, fileUrl, getPullChurn } from '../src/server/metrics/churn';
import { DiskCache } from '../src/server/store';

const file = (filename: string, additions = 1, deletions = 0) => ({ filename, additions, deletions });

describe('what the commits keep coming back to', () => {
  it('counts each file and folder once per commit, most touched first', () => {
    const churn = buildChurn(
      [
        [file('src/app.ts', 10), file('src/util.ts', 2), file('README.md')],
        [file('src/app.ts', 3, 1)],
        [file('src/app.ts', 1), file('src/util.ts', 1)],
      ],
      2,
    );
    expect(churn.commits).toBe(3);
    expect(churn.merges).toBe(2);
    expect(churn.files).toEqual([
      { path: 'src/app.ts', commits: 3, additions: 14, deletions: 1 },
      { path: 'src/util.ts', commits: 2, additions: 3, deletions: 0 },
      { path: 'README.md', commits: 1, additions: 1, deletions: 0 },
    ]);
    // Two files in src in one commit count once for the folder.
    expect(churn.folders).toEqual([
      { path: 'src', commits: 3, additions: 17, deletions: 1 },
      { path: '(root)', commits: 1, additions: 1, deletions: 0 },
    ]);
  });

  it('links a file to its place in the pull request, named as GitHub names it', () => {
    // The SHA-256 of the path, as on GitHub's own page.
    expect(fileUrl('octo', 'app', 32, 'src/web/pages/MyPulls.tsx')).toBe(
      'https://github.com/octo/app/pull/32/files#diff-866e1c5ab5b73b01474375632e95fde5a260674920d4170e545ab30644cb8245',
    );
  });

  it('lists the twelve most touched', () => {
    const commits = Array.from({ length: 2 }, () => Array.from({ length: 20 }, (_, i) => file(`f${i}.ts`)));
    expect(buildChurn(commits, 0).files).toHaveLength(12);
  });
});

describe('reading every commit of a pull request', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'gitmetrics-churn-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const commits = (nodes: [string, number][], totalCount = nodes.length) => ({
    repository: {
      pullRequest: {
        commits: {
          totalCount,
          pageInfo: { hasNextPage: false, endCursor: null },
          nodes: nodes.map(([oid, parents]) => ({ commit: { oid, parents: { totalCount: parents } } })),
        },
      },
    },
  });

  function github(
    graphql: unknown,
    files: Record<string, { pages: number; list: ReturnType<typeof file>[][] }>,
  ) {
    const asked: string[] = [];
    const gh = {
      graphql: async () => graphql,
      request: async (url: string) => {
        asked.push(url);
        const sha = url.split('/').at(-1)!;
        return { data: { files: files[sha]!.list[0] }, lastPage: files[sha]!.pages, status: 200 };
      },
      get: async (url: string, query: { page: number }) => {
        asked.push(`${url}#${query.page}`);
        return { files: files[url.split('/').at(-1)!]!.list[query.page - 1] };
      },
    } as unknown as GitHubClient;
    return { gh, asked };
  }

  it('leaves merge commits out, reads every page of files, and keeps them on disk', async () => {
    const { gh, asked } = github(
      commits([
        ['a', 1],
        ['m', 2],
        ['b', 1],
      ]),
      {
        a: { pages: 2, list: [[file('x.ts')], [file('y.ts')]] },
        b: { pages: 1, list: [[file('x.ts')]] },
      },
    );
    const cache = new DiskCache(dir);
    const churn = await getPullChurn(gh, cache, 'octo', 'app', 7);
    expect(churn).toMatchObject({ commits: 2, merges: 1 });
    expect(churn!.files.map((f) => [f.path, f.commits])).toEqual([
      ['x.ts', 2],
      ['y.ts', 1],
    ]);
    // Each file links to its place in the pull request's "Files changed" tab.
    expect(churn!.files[0]!.url).toBe(fileUrl('octo', 'app', 7, 'x.ts'));
    // Commits are read side by side, so only what was asked matters, not the order.
    expect(asked.sort()).toEqual([
      '/repos/octo/app/commits/a',
      '/repos/octo/app/commits/a#2',
      '/repos/octo/app/commits/b',
    ]);

    // A second time, the commits' files come from disk.
    asked.length = 0;
    await getPullChurn(gh, cache, 'octo', 'app', 7);
    expect(asked).toEqual([]);
  });

  it('gives no answer past what GitHub can list', async () => {
    const cache = new DiskCache(dir);
    // More commits than GitHub lists for a pull request.
    const many = github(commits([['a', 1]], 300), { a: { pages: 1, list: [[file('x.ts')]] } });
    expect(await getPullChurn(many.gh, cache, 'octo', 'app', 7)).toBeNull();
    // A commit with 3,000 files or more.
    const big = Array.from({ length: 3000 }, (_, i) => file(`f${i}.ts`));
    const huge = github(commits([['h', 1]]), { h: { pages: 1, list: [big] } });
    expect(await getPullChurn(huge.gh, cache, 'octo', 'app', 7)).toBeNull();
  });
});
