import type { OverviewResponse, RepoDetails, RepoSummary } from '../../shared/types.js';
import { type GitHubClient, optional } from '../github.js';

export interface RawRepo {
  id: number;
  name: string;
  full_name: string;
  owner: { login: string; avatar_url: string };
  description: string | null;
  private: boolean;
  fork: boolean;
  archived: boolean;
  stargazers_count: number;
  forks_count: number;
  watchers_count: number;
  open_issues_count: number;
  language: string | null;
  topics?: string[];
  pushed_at: string | null;
  created_at: string;
  html_url: string;
  default_branch: string;
  license: { spdx_id: string | null; name: string } | null;
  homepage: string | null;
  size: number;
  subscribers_count?: number;
  visibility?: string;
}

export const toSummary = (repo: RawRepo): RepoSummary => ({
  id: repo.id,
  owner: repo.owner.login,
  name: repo.name,
  fullName: repo.full_name,
  description: repo.description,
  private: repo.private,
  fork: repo.fork,
  archived: repo.archived,
  stars: repo.stargazers_count,
  forks: repo.forks_count,
  watchers: repo.subscribers_count ?? repo.watchers_count,
  openIssues: repo.open_issues_count,
  language: repo.language,
  topics: repo.topics ?? [],
  pushedAt: repo.pushed_at,
  createdAt: repo.created_at,
  htmlUrl: repo.html_url,
  ownerAvatarUrl: repo.owner.avatar_url,
});

export const toDetails = (repo: RawRepo): RepoDetails => ({
  ...toSummary(repo),
  defaultBranch: repo.default_branch,
  license:
    repo.license?.spdx_id && repo.license.spdx_id !== 'NOASSERTION'
      ? repo.license.spdx_id
      : (repo.license?.name ?? null),
  homepage: repo.homepage || null,
  sizeKb: repo.size,
  subscribers: repo.subscribers_count ?? 0,
  visibility: repo.visibility ?? (repo.private ? 'private' : 'public'),
});

export async function listRepos(gh: GitHubClient): Promise<RepoSummary[]> {
  const repos = await gh.paginate<RawRepo>(
    '/user/repos',
    { affiliation: 'owner,organization_member', sort: 'pushed' },
    { maxPages: 10 },
  );
  return repos.map(toSummary);
}

export const getRepo = (gh: GitHubClient, owner: string, repo: string) =>
  gh.get<RawRepo>(`/repos/${owner}/${repo}`);

const COUNTS_QUERY = `
query ($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    pullRequests(states: OPEN) { totalCount }
    issues(states: OPEN) { totalCount }
    releases { totalCount }
    isSecurityPolicyEnabled
    defaultBranchRef { target { ... on Commit { history { totalCount } } } }
  }
}`;

interface CountsResult {
  repository: {
    pullRequests: { totalCount: number };
    issues: { totalCount: number };
    releases: { totalCount: number };
    isSecurityPolicyEnabled?: boolean | null;
    defaultBranchRef: { target: { history?: { totalCount: number } } } | null;
  } | null;
}

const HEALTH_FILES: [string, string][] = [
  ['readme', 'README'],
  ['license', 'License'],
  ['contributing', 'Contributing guide'],
  ['code_of_conduct', 'Code of conduct'],
  ['security_policy', 'Security policy'],
  ['issue_template', 'Issue templates'],
  ['pull_request_template', 'Pull request template'],
];

export function buildLanguages(languages: Record<string, number>) {
  const total = Object.values(languages).reduce((sum, bytes) => sum + bytes, 0);
  return Object.entries(languages)
    .sort((a, b) => b[1] - a[1])
    .map(([name, bytes]) => ({ name, bytes, share: total ? bytes / total : 0 }));
}

export async function getOverview(gh: GitHubClient, owner: string, name: string): Promise<OverviewResponse> {
  const [repo, languages, health, counts, contributors, latest] = await Promise.all([
    getRepo(gh, owner, name),
    optional(gh.get<Record<string, number>>(`/repos/${owner}/${name}/languages`), {}),
    optional(
      gh.get<{ health_percentage: number; files: Record<string, unknown> }>(
        `/repos/${owner}/${name}/community/profile`,
      ),
      null,
    ),
    optional(gh.graphql<CountsResult>(COUNTS_QUERY, { owner, name }), { repository: null }),
    optional(gh.count(`/repos/${owner}/${name}/contributors`, { anon: 1 }), null),
    optional(
      gh.get<{ tag_name: string; name: string | null; published_at: string; html_url: string }>(
        `/repos/${owner}/${name}/releases/latest`,
      ),
      null,
    ),
  ]);

  // The community profile only reports the legacy single ISSUE_TEMPLATE.md. Repositories using
  // the template folder (issue forms or several templates) come back as null, so check the folder.
  const files = { ...health?.files };
  if (health && !files.issue_template) {
    const templates = await optional(
      gh.get<unknown[]>(`/repos/${owner}/${name}/contents/.github/ISSUE_TEMPLATE`),
      [],
    );
    if (Array.isArray(templates) && templates.length > 0) files.issue_template = true;
  }

  const r = counts.repository;
  // Not part of the community profile; GraphQL knows about SECURITY.md in the root, .github or docs.
  if (r?.isSecurityPolicyEnabled) files.security_policy = true;
  return {
    repo: toDetails(repo),
    totals: {
      commits: r?.defaultBranchRef?.target.history?.totalCount ?? null,
      contributors,
      openPullRequests: r?.pullRequests.totalCount ?? null,
      openIssues: r?.issues.totalCount ?? null,
      releases: r?.releases.totalCount ?? null,
    },
    languages: buildLanguages(languages),
    health: health
      ? {
          percentage: health.health_percentage,
          files: HEALTH_FILES.map(([key, label]) => ({
            name: label,
            present: Boolean(files[key]),
          })),
        }
      : null,
    latestRelease: latest
      ? {
          tag: latest.tag_name,
          name: latest.name || latest.tag_name,
          publishedAt: latest.published_at,
          url: latest.html_url,
        }
      : null,
  };
}
