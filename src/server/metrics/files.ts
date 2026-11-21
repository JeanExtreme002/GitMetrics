import type { FileStat, FilesResponse, TreeNode } from '../../shared/types.js';
import type { GitHubClient } from '../github.js';
import type { DiskCache } from '../store.js';
import { mapLimit } from '../util.js';

export interface CommitFiles {
  sha: string;
  merge: boolean;
  files: { filename: string; additions: number; deletions: number }[];
}

interface RawCommitDetail {
  sha: string;
  parents: unknown[];
  files?: { filename: string; additions: number; deletions: number }[];
}

const ROOT = '(root)';

function add(map: Map<string, FileStat>, path: string, additions: number, deletions: number) {
  const entry = map.get(path) ?? { path, changes: 0, additions: 0, deletions: 0 };
  entry.changes++;
  entry.additions += additions;
  entry.deletions += deletions;
  map.set(path, entry);
}

export function extensionOf(file: string): string {
  const base = file.split('/').pop() ?? file;
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot).toLowerCase() : base;
}

/** Nests every changed file under its folders; each folder adds up the changes of what it holds. */
export function buildTree(files: FileStat[]): TreeNode {
  const root: TreeNode = { name: '', path: '', value: 0, children: [] };
  for (const f of files) {
    let node = root;
    node.value += f.changes;
    const parts = f.path.split('/');
    parts.forEach((part, i) => {
      const isFile = i === parts.length - 1;
      const path = parts.slice(0, i + 1).join('/');
      let child = node.children!.find((c) => c.name === part && !c.children === isFile);
      if (!child) {
        child = isFile ? { name: part, path, value: 0 } : { name: part, path, value: 0, children: [] };
        node.children!.push(child);
      }
      child.value += f.changes;
      node = child;
    });
  }
  const sort = (node: TreeNode) => {
    node.children?.sort((a, b) => b.value - a.value || a.name.localeCompare(b.name)).forEach(sort);
  };
  sort(root);
  return root;
}

export function buildFiles(commits: CommitFiles[]): FilesResponse {
  const files = new Map<string, FileStat>();
  const folders = new Map<string, FileStat>();
  const extensions = new Map<string, number>();
  const analyzed = commits.filter((c) => !c.merge);
  const lines = { additions: 0, deletions: 0 };

  for (const commit of analyzed) {
    const touchedFolders = new Map<string, [number, number]>();
    for (const f of commit.files) {
      add(files, f.filename, f.additions, f.deletions);
      lines.additions += f.additions;
      lines.deletions += f.deletions;
      const ext = extensionOf(f.filename);
      extensions.set(ext, (extensions.get(ext) ?? 0) + 1);

      const parts = f.filename.split('/').slice(0, -1);
      const dirs = parts.length ? parts.map((_, i) => parts.slice(0, i + 1).join('/')) : [ROOT];
      for (const dir of dirs.slice(0, 3)) {
        const [a, d] = touchedFolders.get(dir) ?? [0, 0];
        touchedFolders.set(dir, [a + f.additions, d + f.deletions]);
      }
    }
    // A folder counts once per commit, no matter how many of its files changed.
    for (const [dir, [a, d]] of touchedFolders) add(folders, dir, a, d);
  }

  const sorted = (map: Map<string, FileStat>, limit: number) =>
    [...map.values()]
      .sort((a, b) => b.changes - a.changes || b.additions + b.deletions - (a.additions + a.deletions))
      .slice(0, limit);

  const allFiles = sorted(files, Infinity);
  return {
    commitsAnalyzed: analyzed.length,
    filesTouched: allFiles.length,
    lines,
    files: allFiles.slice(0, 25),
    folders: sorted(folders, 15),
    tree: buildTree(allFiles),
    extensions: [...extensions.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([name, count]) => ({ name, count })),
  };
}

export async function getFiles(
  gh: GitHubClient,
  cache: DiskCache,
  owner: string,
  repo: string,
  limit: number,
): Promise<FilesResponse> {
  const base = `/repos/${owner}/${repo}`;
  const list = await gh.paginate<{ sha: string }>(
    `${base}/commits`,
    {},
    {
      maxPages: Math.ceil(limit / 100),
    },
  );

  const commits = await mapLimit(list.slice(0, limit), 8, async ({ sha }) => {
    const key = `commit:${owner}/${repo}@${sha}`;
    const hit = cache.get<CommitFiles>(key);
    if (hit) return hit;
    const detail = await gh.get<RawCommitDetail>(`${base}/commits/${sha}`);
    const value: CommitFiles = {
      sha,
      merge: detail.parents.length > 1,
      files: (detail.files ?? []).map(({ filename, additions, deletions }) => ({
        filename,
        additions,
        deletions,
      })),
    };
    cache.set(key, value);
    return value;
  });

  return buildFiles(commits);
}
