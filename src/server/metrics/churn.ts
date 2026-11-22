import type { ChurnEntry, PullChurn } from '../../shared/types.js';
import type { GitHubClient } from '../github.js';
import type { DiskCache } from '../store.js';
import { mapLimit } from '../util.js';

/*
 * Which files and folders the commits of a pull request keep coming back to. Exact or nothing:
 * GitHub lists at most 250 commits of a pull request and 3,000 files of a commit, so past either
 * limit there is no answer rather than one from part of the commits.
 */

const COMMITS_QUERY = `
query ($owner: String!, $name: String!, $number: Int!, $after: String) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      commits(first: 100, after: $after) {
        totalCount
        pageInfo { hasNextPage endCursor }
        nodes { commit { oid parents { totalCount } } }
      }
    }
  }
}`;

interface CommitsPage {
  totalCount: number;
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
  nodes: { commit: { oid: string; parents: { totalCount: number } } }[];
}

interface CommitFile {
  filename: string;
  additions: number;
  deletions: number;
}

/** GitHub stops listing a commit's files here. */
const MAX_FILES = 3000;
const PER_PAGE = 100;
/** How many files and folders to list. */
const TOP = 12;

/** Every file a commit changed, read page by page; null when GitHub can't list them all. */
async function commitFiles(gh: GitHubClient, base: string, sha: string): Promise<CommitFile[] | null> {
  const first = await gh.request<{ files?: CommitFile[] }>(`${base}/commits/${sha}`, {
    query: { per_page: PER_PAGE, page: 1 },
  });
  const files = [...(first.data.files ?? [])];
  for (let page = 2; page <= first.lastPage; page++) {
    const next = await gh.get<{ files?: CommitFile[] }>(`${base}/commits/${sha}`, {
      per_page: PER_PAGE,
      page,
    });
    files.push(...(next.files ?? []));
  }
  return files.length >= MAX_FILES ? null : files;
}

const folderOf = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '(root)');

/** Counts, for each path, how many commits touched it, and the lines those commits changed there. */
export function buildChurn(perCommit: CommitFile[][], merges: number): PullChurn {
  const files = new Map<string, ChurnEntry>();
  const folders = new Map<string, ChurnEntry>();
  const count = (
    map: Map<string, ChurnEntry>,
    path: string,
    additions: number,
    deletions: number,
    seen: Set<string>,
  ) => {
    const entry = map.get(path) ?? { path, commits: 0, additions: 0, deletions: 0 };
    if (!seen.has(path)) {
      entry.commits++;
      seen.add(path);
    }
    entry.additions += additions;
    entry.deletions += deletions;
    map.set(path, entry);
  };
  for (const commit of perCommit) {
    const seenFiles = new Set<string>();
    const seenFolders = new Set<string>();
    for (const f of commit) {
      count(files, f.filename, f.additions, f.deletions, seenFiles);
      count(folders, folderOf(f.filename), f.additions, f.deletions, seenFolders);
    }
  }
  const top = (map: Map<string, ChurnEntry>) =>
    [...map.values()]
      .sort(
        (a, b) =>
          b.commits - a.commits ||
          b.additions + b.deletions - (a.additions + a.deletions) ||
          a.path.localeCompare(b.path),
      )
      .slice(0, TOP);
  return { commits: perCommit.length, merges, files: top(files), folders: top(folders) };
}

export async function getPullChurn(
  gh: GitHubClient,
  cache: DiskCache,
  owner: string,
  name: string,
  number: number,
): Promise<PullChurn | null> {
  // Every commit of the pull request, page by page.
  const commits: CommitsPage['nodes'] = [];
  let after: string | null = null;
  let total: number;
  do {
    const data: { repository: { pullRequest: { commits: CommitsPage } | null } | null } = await gh.graphql(
      COMMITS_QUERY,
      { owner, name, number, after },
    );
    const page = data.repository?.pullRequest?.commits;
    if (!page) return null;
    total = page.totalCount;
    commits.push(...page.nodes);
    after = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
  } while (after);
  if (commits.length < total) return null;

  // Merge commits bring the base branch in; they don't say what the pull request itself changes.
  const own = commits.filter((c) => c.commit.parents.totalCount < 2).map((c) => c.commit.oid);
  const base = `/repos/${owner}/${name}`;
  // A commit never changes, so its files are kept on disk once read in full.
  const perCommit = await mapLimit(own, 8, async (sha) => {
    const key = `pull-commit-files:${owner}/${name}@${sha}`.toLowerCase();
    const hit = cache.get<CommitFile[]>(key);
    if (hit) return hit;
    const files = await commitFiles(gh, base, sha);
    if (files) cache.set(key, files);
    return files;
  });
  if (perCommit.some((files) => files === null)) return null;
  return buildChurn(perCommit as CommitFile[][], commits.length - own.length);
}
