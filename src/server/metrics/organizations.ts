import type {
  AccountPerson,
  HealthResponse,
  PeopleResponse,
  QualityMeasure,
  SponsorsResponse,
  TeamsResponse,
} from '../../shared/types.js';
import type { GitHubClient } from '../github.js';
import { mapLimit } from '../util.js';

/*
 * The pages of an organization beyond its overview: its people, its teams, how well kept and how
 * safe its repositories are, and its sponsors. Each list is read to the end, up to a thousand;
 * past that it says so, and what can't be counted exactly is left out.
 */

/** Pages of a hundred read for a list. */
const MAX_PAGES = 10;
const DAY_MS = 86_400_000;

interface Page<T> {
  totalCount: number;
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
  nodes?: T[];
  edges?: T[];
}

/**
 * Reads a connection page by page, up to the limit. `pick` finds it in each answer; `items` are its
 * nodes (or edges). Returns what was read, its total, and whether that's all of it.
 */
async function readPages<T>(
  gh: GitHubClient,
  query: string,
  variables: Record<string, unknown>,
  pick: (data: unknown) => Page<T> | null | undefined,
): Promise<{ items: T[]; total: number; complete: boolean; found: boolean }> {
  const items: T[] = [];
  let after: string | null = null;
  let total = 0;
  for (let page = 0; page < MAX_PAGES; page++) {
    const data = await gh.graphql<unknown>(query, { ...variables, after });
    const connection = pick(data);
    if (!connection) return { items, total, complete: false, found: false };
    total = connection.totalCount;
    // More than can be read: no use reading the rest.
    if (total > MAX_PAGES * 100) return { items, total, complete: false, found: true };
    items.push(...(connection.nodes ?? connection.edges ?? []));
    after = connection.pageInfo.hasNextPage ? connection.pageInfo.endCursor : null;
    if (!after) break;
  }
  return { items, total, complete: !after && items.length === total, found: true };
}

// People ------------------------------------------------------------------------------------------

const PEOPLE = `
query ($login: String!, $after: String) {
  organization(login: $login) {
    viewerIsAMember
    membersWithRole(first: 100, after: $after) {
      totalCount
      pageInfo { hasNextPage endCursor }
      edges { role node { login name avatarUrl } }
    }
  }
}`;

interface PeopleEdge {
  role: 'ADMIN' | 'MEMBER' | null;
  node: { login: string; name: string | null; avatarUrl: string };
}

/** An organization's members, admins first; null when no organization has that login. */
export async function getPeople(gh: GitHubClient, login: string): Promise<PeopleResponse | null> {
  let member = false;
  const read = await readPages<PeopleEdge>(gh, PEOPLE, { login }, (data) => {
    const org = (
      data as { organization: { viewerIsAMember: boolean; membersWithRole: Page<PeopleEdge> } | null }
    ).organization;
    if (org) member = org.viewerIsAMember;
    return org?.membersWithRole;
  });
  if (!read.found) return null;
  return {
    member,
    // Roles are GitHub's to show only to members.
    people: read.items
      .map((e) => ({
        login: e.node.login,
        name: e.node.name || null,
        avatarUrl: e.node.avatarUrl,
        role: member ? (e.role === 'ADMIN' ? ('admin' as const) : ('member' as const)) : null,
      }))
      .sort(
        (a, b) => Number(b.role === 'admin') - Number(a.role === 'admin') || a.login.localeCompare(b.login),
      ),
    total: read.total,
    complete: read.complete,
  };
}

// Teams -------------------------------------------------------------------------------------------

const TEAMS = `
query ($login: String!, $after: String) {
  organization(login: $login) {
    teams(first: 100, after: $after) {
      totalCount
      pageInfo { hasNextPage endCursor }
      nodes {
        name slug description privacy url
        members { totalCount }
        repositories { totalCount }
        parentTeam { name }
      }
    }
  }
}`;

interface RawTeam {
  name: string;
  slug: string;
  description: string | null;
  privacy: 'SECRET' | 'VISIBLE';
  url: string;
  members: { totalCount: number };
  repositories: { totalCount: number };
  parentTeam: { name: string } | null;
}

/** The teams you can see in an organization, biggest first; null when there's no such organization. */
export async function getTeams(gh: GitHubClient, login: string): Promise<TeamsResponse | null> {
  const read = await readPages<RawTeam>(
    gh,
    TEAMS,
    { login },
    (data) => (data as { organization: { teams: Page<RawTeam> } | null }).organization?.teams,
  );
  if (!read.found) return null;
  return {
    teams: read.items
      .map((t) => ({
        name: t.name,
        slug: t.slug,
        description: t.description?.trim() || null,
        secret: t.privacy === 'SECRET',
        url: t.url,
        members: t.members.totalCount,
        repositories: t.repositories.totalCount,
        parent: t.parentTeam?.name ?? null,
      }))
      .sort((a, b) => b.members - a.members || a.name.localeCompare(b.name)),
    total: read.total,
    complete: read.complete,
  };
}

// Security and quality ----------------------------------------------------------------------------

const HEALTH = `
query ($login: String!, $after: String) {
  repositoryOwner(login: $login) {
    repositories(first: 100, after: $after, ownerAffiliations: OWNER) {
      totalCount
      pageInfo { hasNextPage endCursor }
      nodes {
        nameWithOwner isFork isArchived pushedAt description viewerPermission
        hasIssuesEnabled
        licenseInfo { spdxId name }
        repositoryTopics(first: 1) { totalCount }
      }
    }
  }
}`;

export interface RawHealthRepo {
  nameWithOwner: string;
  isFork: boolean;
  isArchived: boolean;
  pushedAt: string | null;
  description: string | null;
  viewerPermission: 'ADMIN' | 'MAINTAIN' | 'WRITE' | 'TRIAGE' | 'READ' | null;
  hasIssuesEnabled: boolean;
  licenseInfo: { spdxId: string | null; name: string } | null;
  repositoryTopics: { totalCount: number };
}

/** GitHub shows a repository's Dependabot alerts only to people who can write to it. */
const SEES_ALERTS = new Set(['ADMIN', 'MAINTAIN', 'WRITE']);

/** Repositories whose alerts you can see: active ones (its own, not archived) you can write to. */
export const alertable = (repos: RawHealthRepo[]) =>
  repos.filter(
    (r) => !r.isFork && !r.isArchived && r.viewerPermission && SEES_ALERTS.has(r.viewerPermission),
  );

/**
 * Measures repositories that were all read. `alerts` holds the open Dependabot alerts of each one
 * you can see them on, by full name.
 */
export function buildHealth(
  repos: RawHealthRepo[],
  alerts: Map<string, number>,
  now = new Date(),
): HealthResponse {
  const sources = repos.filter((r) => !r.isFork);
  const active = sources.filter((r) => !r.isArchived);
  const has: Record<QualityMeasure['key'], (r: RawHealthRepo) => boolean> = {
    license: (r) => Boolean(r.licenseInfo),
    description: (r) => Boolean(r.description?.trim()),
    topics: (r) => r.repositoryTopics.totalCount > 0,
    issues: (r) => r.hasIssuesEnabled,
  };
  const licenses = new Map<string, number>();
  for (const r of active) {
    // A license file GitHub can't name is still a license: a custom one.
    const name = !r.licenseInfo
      ? 'None'
      : r.licenseInfo.spdxId === 'NOASSERTION'
        ? 'Custom'
        : (r.licenseInfo.spdxId ?? r.licenseInfo.name);
    licenses.set(name, (licenses.get(name) ?? 0) + 1);
  }
  const age = (r: RawHealthRepo) =>
    r.pushedAt ? (now.getTime() - new Date(r.pushedAt).getTime()) / DAY_MS : null;
  const activity = { month: 0, quarter: 0, year: 0, older: 0, never: 0 };
  for (const r of active) {
    const days = age(r);
    if (days === null) activity.never++;
    else if (days <= 30) activity.month++;
    else if (days <= 90) activity.quarter++;
    else if (days <= 365) activity.year++;
    else activity.older++;
  }
  const readable = alertable(repos);
  const withAlerts = readable
    .map((r) => ({ fullName: r.nameWithOwner, open: alerts.get(r.nameWithOwner) ?? 0 }))
    .filter((r) => r.open > 0)
    .sort((a, b) => b.open - a.open || a.fullName.localeCompare(b.fullName));
  return {
    sources: sources.length,
    archived: sources.length - active.length,
    active: active.length,
    quality: (Object.keys(has) as QualityMeasure['key'][]).map((key) => ({
      key,
      count: active.filter(has[key]).length,
    })),
    licenses: [...licenses.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort(
        (a, b) =>
          Number(a.name === 'None') - Number(b.name === 'None') ||
          b.count - a.count ||
          a.name.localeCompare(b.name),
      ),
    activity,
    alerts: readable.length
      ? {
          readable: readable.length,
          open: withAlerts.reduce((sum, r) => sum + r.open, 0),
          repositories: withAlerts,
        }
      : null,
  };
}

/** Repositories asked about in one query, each under its own alias. */
const ALERTS_AT_ONCE = 25;

/**
 * Open Dependabot alerts of each repository, a batch per query, a few queries at once. They're
 * asked apart from the rest, as counting them is slow, and only where GitHub shows them.
 */
export async function openAlerts(gh: GitHubClient, fullNames: string[]): Promise<Map<string, number>> {
  const batches: string[][] = [];
  for (let i = 0; i < fullNames.length; i += ALERTS_AT_ONCE)
    batches.push(fullNames.slice(i, i + ALERTS_AT_ONCE));
  const counts = new Map<string, number>();
  await mapLimit(batches, 4, async (batch) => {
    const variables: Record<string, string> = {};
    const fields = batch.map((fullName, i) => {
      const [owner, name] = fullName.split('/') as [string, string];
      variables[`o${i}`] = owner;
      variables[`n${i}`] = name;
      return `r${i}: repository(owner: $o${i}, name: $n${i}) { vulnerabilityAlerts(states: OPEN) { totalCount } }`;
    });
    const params = batch.map((_, i) => `$o${i}: String!, $n${i}: String!`).join(', ');
    const data = await gh.graphql<
      Record<string, { vulnerabilityAlerts: { totalCount: number } | null } | null>
    >(`query (${params}) { ${fields.join(' ')} }`, variables);
    batch.forEach((fullName, i) => counts.set(fullName, data[`r${i}`]?.vulnerabilityAlerts?.totalCount ?? 0));
  });
  return counts;
}

/** Security and quality over every repository an account owns; null past what can be read. */
export async function getHealth(gh: GitHubClient, login: string): Promise<HealthResponse | null> {
  const read = await readPages<RawHealthRepo>(
    gh,
    HEALTH,
    { login },
    (data) =>
      (data as { repositoryOwner: { repositories: Page<RawHealthRepo> } | null }).repositoryOwner
        ?.repositories,
  );
  if (!read.found || !read.complete) return null;
  const alerts = await openAlerts(
    gh,
    alertable(read.items).map((r) => r.nameWithOwner),
  );
  return buildHealth(read.items, alerts);
}

// Sponsors ----------------------------------------------------------------------------------------

const SPONSORS = `
query ($login: String!) {
  repositoryOwner(login: $login) {
    ... on Sponsorable {
      sponsoring(first: 100) { totalCount nodes { ...Who } }
      sponsors(first: 100) { totalCount nodes { ...Who } }
    }
  }
}
fragment Who on Sponsor {
  ... on User { login name avatarUrl }
  ... on Organization { login name avatarUrl }
}`;

interface RawSponsors {
  sponsoring: { totalCount: number; nodes: AccountPerson[] };
  sponsors: { totalCount: number; nodes: AccountPerson[] };
}

/** Who an account sponsors and who sponsors it, up to a hundred each; null with no such account. */
export async function getSponsors(gh: GitHubClient, login: string): Promise<SponsorsResponse | null> {
  const data = await gh.graphql<{ repositoryOwner: RawSponsors | null }>(SPONSORS, { login });
  const raw = data.repositoryOwner;
  if (!raw?.sponsoring) return null;
  const people = (list: AccountPerson[]) =>
    list.map((p) => ({ login: p.login, name: p.name || null, avatarUrl: p.avatarUrl }));
  return {
    sponsoring: people(raw.sponsoring.nodes),
    sponsors: people(raw.sponsors.nodes),
    totals: { sponsoring: raw.sponsoring.totalCount, sponsors: raw.sponsors.totalCount },
    complete:
      raw.sponsoring.nodes.length === raw.sponsoring.totalCount &&
      raw.sponsors.nodes.length === raw.sponsors.totalCount,
  };
}
