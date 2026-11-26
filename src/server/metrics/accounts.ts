import type {
  AccountHit,
  AccountResponse,
  AccountReposResponse,
  AccountTotals,
  RepoSummary,
} from '../../shared/types.js';
import type { GitHubClient } from '../github.js';
import { type RawRepo, toSummary } from './repos.js';

/*
 * A user's or an organization's page: who it is, and the repositories it owns. Counts come from
 * GitHub's own totals, so they are exact; stars, forks and languages are added up over every
 * repository that isn't a fork, read page by page, and left out for accounts with too many to read.
 */

/** Repositories read to add up stars, forks and languages: ten pages of a hundred. */
export const MAX_SOURCES = 1000;

const REPO = `
  databaseId name nameWithOwner description isPrivate isFork isArchived stargazerCount forkCount
  pushedAt createdAt url owner { login avatarUrl } primaryLanguage { name }
  watchers { totalCount } issues(states: OPEN) { totalCount }
  repositoryTopics(first: 10) { nodes { topic { name } } }`;

const ACCOUNT_QUERY = `
query ($login: String!) {
  repositoryOwner(login: $login) {
    __typename login avatarUrl url
    ... on User {
      name bio company location websiteUrl twitterUsername createdAt
      followers { totalCount } following { totalCount }
      organizations(first: 30) { nodes { login avatarUrl } }
    }
    ... on Organization {
      name description location websiteUrl twitterUsername createdAt isVerified
      membersWithRole { totalCount }
    }
    all: repositories(ownerAffiliations: OWNER) { totalCount }
    forks: repositories(ownerAffiliations: OWNER, isFork: true) { totalCount }
    archived: repositories(ownerAffiliations: OWNER, isArchived: true) { totalCount }
    private: repositories(ownerAffiliations: OWNER, privacy: PRIVATE) { totalCount }
    top: repositories(first: 6, ownerAffiliations: OWNER, isFork: false, orderBy: { field: STARGAZERS, direction: DESC }) {
      nodes { ${REPO} }
    }
    recent: repositories(first: 5, ownerAffiliations: OWNER, orderBy: { field: PUSHED_AT, direction: DESC }) {
      nodes { ${REPO} }
    }
  }
}`;

const SOURCES = `
query ($login: String!, $after: String) {
  repositoryOwner(login: $login) {
    sources: repositories(first: 100, after: $after, ownerAffiliations: OWNER) {
      totalCount
      pageInfo { hasNextPage endCursor }
      nodes { isFork stargazerCount forkCount primaryLanguage { name } }
    }
  }
}`;

interface RawGraphRepo {
  databaseId: number;
  name: string;
  nameWithOwner: string;
  description: string | null;
  isPrivate: boolean;
  isFork: boolean;
  isArchived: boolean;
  stargazerCount: number;
  forkCount: number;
  pushedAt: string | null;
  createdAt: string;
  url: string;
  owner: { login: string; avatarUrl: string };
  primaryLanguage: { name: string } | null;
  watchers: { totalCount: number };
  issues: { totalCount: number };
  repositoryTopics: { nodes: { topic: { name: string } }[] };
}

interface SourceNode {
  isFork: boolean;
  stargazerCount: number;
  forkCount: number;
  primaryLanguage: { name: string } | null;
}

interface SourcesPage {
  totalCount?: number;
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
  nodes: SourceNode[];
}

export interface RawAccount {
  __typename: 'User' | 'Organization';
  login: string;
  avatarUrl: string;
  url: string;
  name?: string | null;
  bio?: string | null;
  description?: string | null;
  company?: string | null;
  location?: string | null;
  websiteUrl?: string | null;
  twitterUsername?: string | null;
  createdAt: string;
  isVerified?: boolean;
  followers?: { totalCount: number };
  following?: { totalCount: number };
  membersWithRole?: { totalCount: number };
  organizations?: { nodes: { login: string; avatarUrl: string }[] };
  all: { totalCount: number };
  forks: { totalCount: number };
  archived: { totalCount: number };
  private: { totalCount: number };
  top: { nodes: RawGraphRepo[] };
  recent: { nodes: RawGraphRepo[] };
}

export const fromGraph = (r: RawGraphRepo): RepoSummary => ({
  id: r.databaseId,
  owner: r.owner.login,
  name: r.name,
  fullName: r.nameWithOwner,
  description: r.description,
  private: r.isPrivate,
  fork: r.isFork,
  archived: r.isArchived,
  stars: r.stargazerCount,
  forks: r.forkCount,
  watchers: r.watchers.totalCount,
  openIssues: r.issues.totalCount,
  language: r.primaryLanguage?.name ?? null,
  topics: r.repositoryTopics.nodes.map((t) => t.topic.name),
  pushedAt: r.pushedAt,
  createdAt: r.createdAt,
  htmlUrl: r.url,
  ownerAvatarUrl: r.owner.avatarUrl,
});

/** Puts an account together from what GitHub said about it. */
export function buildAccount(raw: RawAccount): AccountResponse {
  const user = raw.__typename === 'User';
  return {
    kind: user ? 'user' : 'organization',
    login: raw.login,
    name: raw.name || null,
    avatarUrl: raw.avatarUrl,
    url: raw.url,
    bio: (user ? raw.bio : raw.description)?.trim() || null,
    company: raw.company?.trim() || null,
    location: raw.location?.trim() || null,
    websiteUrl: raw.websiteUrl?.trim() || null,
    twitter: raw.twitterUsername || null,
    createdAt: raw.createdAt,
    verified: Boolean(raw.isVerified),
    followers: user ? (raw.followers?.totalCount ?? 0) : null,
    following: user ? (raw.following?.totalCount ?? 0) : null,
    members: user ? null : (raw.membersWithRole?.totalCount ?? null),
    organizations: user ? (raw.organizations?.nodes ?? []) : [],
    repositories: {
      total: raw.all.totalCount,
      sources: raw.all.totalCount - raw.forks.totalCount,
      forks: raw.forks.totalCount,
      archived: raw.archived.totalCount,
      private: raw.private.totalCount,
    },
    top: raw.top.nodes.filter((r) => r.stargazerCount > 0).map(fromGraph),
    recent: raw.recent.nodes.filter((r) => r.pushedAt).map(fromGraph),
  };
}

/** One account, or null when no user or organization has that login. */
export async function getAccount(gh: GitHubClient, login: string): Promise<AccountResponse | null> {
  const data = await gh.graphql<{ repositoryOwner: RawAccount | null }>(ACCOUNT_QUERY, { login });
  return data.repositoryOwner ? buildAccount(data.repositoryOwner) : null;
}

/**
 * Adds up stars and forks over every repository it owns, as the home page does, and main languages
 * over those that aren't forks.
 */
export function buildTotals(sources: SourceNode[]): AccountTotals {
  const languages = new Map<string, number>();
  for (const s of sources) {
    const name = s.isFork ? null : s.primaryLanguage?.name;
    if (name) languages.set(name, (languages.get(name) ?? 0) + 1);
  }
  return {
    stars: sources.reduce((sum, s) => sum + s.stargazerCount, 0),
    forks: sources.reduce((sum, s) => sum + s.forkCount, 0),
    languages: [...languages.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
  };
}

/**
 * Stars, forks and languages over every repository the account owns, read page by page. Null when
 * there are more than can be read, rather than totals for only part of them.
 */
export async function getAccountTotals(gh: GitHubClient, login: string): Promise<AccountTotals | null> {
  const nodes: SourceNode[] = [];
  let after: string | null = null;
  let total = 0;
  do {
    const data: { repositoryOwner: { sources: SourcesPage } | null } = await gh.graphql(SOURCES, {
      login,
      after,
    });
    const page = data.repositoryOwner?.sources;
    if (!page) return null;
    total = page.totalCount ?? total;
    if (total > MAX_SOURCES) return null;
    nodes.push(...page.nodes);
    after = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
  } while (after);
  // Repositories created or deleted while reading would make the totals uneven: none then.
  return nodes.length === total ? buildTotals(nodes) : null;
}

/** The repositories an account shows to you, most recently pushed first, up to a thousand. */
export async function getAccountRepos(gh: GitHubClient, login: string): Promise<AccountReposResponse> {
  const pages = await gh.pages<RawRepo[]>(`/users/${login}/repos`, { type: 'owner', sort: 'pushed' });
  const repos = pages.flat();
  return { repos: repos.map(toSummary), complete: repos.length < MAX_SOURCES };
}

/** Accounts whose login matches, for the quick search. */
export async function searchAccounts(gh: GitHubClient, text: string): Promise<AccountHit[]> {
  const { items } = await gh.get<{ items: { login: string; avatar_url: string; type: string }[] }>(
    '/search/users',
    { q: `${text} in:login`, per_page: 4 },
  );
  return items.map((i) => ({
    login: i.login,
    avatarUrl: i.avatar_url,
    kind: i.type === 'Organization' ? 'organization' : 'user',
  }));
}
