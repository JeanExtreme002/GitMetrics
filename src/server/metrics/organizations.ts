import type {
  AccountPerson,
  QualityResponse,
  SecurityResponse,
  PeopleResponse,
  QualityMeasure,
  AlertDetailsResponse,
  SeverityCounts,
  SponsorsResponse,
  TeamsResponse,
} from '../../shared/types.js';
import { SEVERITIES } from '../../shared/types.js';
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

const MEMBER_TEAMS = `
query ($login: String!, $member: String!, $after: String) {
  organization(login: $login) {
    teams(first: 100, after: $after, userLogins: [$member]) {
      totalCount
      pageInfo { hasNextPage endCursor }
      nodes { slug }
    }
  }
}`;

/**
 * The teams a member belongs to, by slug, out of those you can see; null when there's no such
 * organization. GitHub filters them itself, so it's one small read whatever the organization's size.
 */
export async function getMemberTeams(
  gh: GitHubClient,
  login: string,
  member: string,
): Promise<{ teams: string[]; complete: boolean } | null> {
  const read = await readPages<{ slug: string }>(
    gh,
    MEMBER_TEAMS,
    { login, member },
    (data) => (data as { organization: { teams: Page<{ slug: string }> } | null }).organization?.teams,
  );
  if (!read.found) return null;
  return { teams: read.items.map((t) => t.slug), complete: read.complete };
}

// Security and quality ----------------------------------------------------------------------------

const HEALTH = `
query ($login: String!, $after: String) {
  repositoryOwner(login: $login) {
    repositories(first: 100, after: $after, ownerAffiliations: OWNER) {
      totalCount
      pageInfo { hasNextPage endCursor }
      nodes {
        nameWithOwner isFork isArchived pushedAt description viewerPermission primaryLanguage { name }
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
  primaryLanguage?: { name: string } | null;
  repositoryTopics: { totalCount: number };
}

/** GitHub shows a repository's Dependabot alerts only to people who can write to it. */
const SEES_ALERTS = new Set(['ADMIN', 'MAINTAIN', 'WRITE']);

/** Repositories whose alerts you can see: active ones (its own, not archived) you can write to. */
export const alertable = (repos: RawHealthRepo[]) =>
  repos.filter(
    (r) => !r.isFork && !r.isArchived && r.viewerPermission && SEES_ALERTS.has(r.viewerPermission),
  );

/** How well kept an organization's repositories are, measured over all of them. */
export function buildQuality(repos: RawHealthRepo[], now = new Date()): QualityResponse {
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
  // Untouched for over a year, or never pushed to: candidates for archiving.
  const stale = active
    .filter((r) => {
      const days = age(r);
      return days === null || days > 365;
    })
    .map((r) => ({
      fullName: r.nameWithOwner,
      pushedAt: r.pushedAt,
      description: r.description?.trim() || null,
      language: r.primaryLanguage?.name ?? null,
    }))
    .sort(
      (a, b) => (a.pushedAt ?? '').localeCompare(b.pushedAt ?? '') || a.fullName.localeCompare(b.fullName),
    );
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
    stale,
  };
}

const noSeverity = (): SeverityCounts => ({ critical: 0, high: 0, moderate: 0, low: 0 });

/**
 * Open Dependabot alerts over an organization's active repositories. `alerts` holds each one's
 * count, by full name, for those you can see them on.
 */
export function buildSecurity(repos: RawHealthRepo[], alerts: Map<string, number>): SecurityResponse {
  const active = repos.filter((r) => !r.isFork && !r.isArchived).length;
  const readable = alertable(repos);
  const withAlerts = readable
    .map((r) => ({ fullName: r.nameWithOwner, open: alerts.get(r.nameWithOwner) ?? 0 }))
    .filter((r) => r.open > 0)
    .sort((a, b) => b.open - a.open || a.fullName.localeCompare(b.fullName));
  return {
    active,
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

/** How many open alerts each repository has: a batch of repositories per query, a few at once. */
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

const SEVERITY_PAGE = `
query ($owner: String!, $name: String!, $after: String) {
  repository(owner: $owner, name: $name) {
    vulnerabilityAlerts(states: OPEN, first: 100, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes { createdAt securityVulnerability { severity package { name ecosystem } } }
    }
  }
}`;

interface Alert {
  fullName: string;
  createdAt: string;
  severity: keyof SeverityCounts;
  package: string;
  ecosystem: string;
}

interface RawAlert {
  createdAt: string;
  securityVulnerability: { severity: string; package: { name: string; ecosystem: string } } | null;
}

/**
 * Every open alert of a repository, read page by page; null unless all of the `open` alerts were
 * read whole, so what's added up from them is exact or not shown.
 */
async function readAlerts(gh: GitHubClient, fullName: string, open: number): Promise<Alert[] | null> {
  const [owner, name] = fullName.split('/') as [string, string];
  const alerts: Alert[] = [];
  let after: string | null = null;
  do {
    const data: {
      repository: {
        vulnerabilityAlerts: {
          pageInfo: { hasNextPage: boolean; endCursor: string | null };
          nodes: (RawAlert | null)[];
        } | null;
      } | null;
    } = await gh.graphql(SEVERITY_PAGE, { owner, name, after });
    const page = data.repository?.vulnerabilityAlerts;
    if (!page) return null;
    for (const node of page.nodes) {
      const vulnerability = node?.securityVulnerability;
      const severity = vulnerability?.severity.toLowerCase();
      if (!node || !vulnerability || !severity || !(SEVERITIES as readonly string[]).includes(severity)) {
        return null;
      }
      alerts.push({
        fullName,
        createdAt: node.createdAt,
        severity: severity as keyof SeverityCounts,
        package: vulnerability.package.name,
        ecosystem: vulnerability.package.ecosystem,
      });
    }
    after = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
  } while (after);
  return alerts.length === open ? alerts : null;
}

const countSeverities = (alerts: Alert[]) => {
  const counts = noSeverity();
  for (const a of alerts) counts[a.severity]++;
  return counts;
};

/** What the alerts say together: how old they are, where they come from, and which packages. */
export function buildAlertDetails(
  alerts: Alert[],
  now = new Date(),
): NonNullable<AlertDetailsResponse['details']> {
  const age = { month: 0, quarter: 0, year: 0, older: 0 };
  const ecosystems = new Map<string, number>();
  const packages = new Map<
    string,
    { name: string; ecosystem: string; alerts: number; repositories: Set<string> }
  >();
  let oldestCritical: Alert | null = null;
  for (const a of alerts) {
    const days = (now.getTime() - new Date(a.createdAt).getTime()) / DAY_MS;
    if (days <= 30) age.month++;
    else if (days <= 90) age.quarter++;
    else if (days <= 365) age.year++;
    else age.older++;
    ecosystems.set(a.ecosystem, (ecosystems.get(a.ecosystem) ?? 0) + 1);
    const key = `${a.ecosystem}:${a.package}`;
    const found = packages.get(key) ?? {
      name: a.package,
      ecosystem: a.ecosystem,
      alerts: 0,
      repositories: new Set(),
    };
    found.alerts++;
    found.repositories.add(a.fullName);
    packages.set(key, found);
    if (a.severity === 'critical' && (!oldestCritical || a.createdAt < oldestCritical.createdAt))
      oldestCritical = a;
  }
  return {
    age,
    oldestCritical: oldestCritical
      ? {
          fullName: oldestCritical.fullName,
          createdAt: oldestCritical.createdAt,
          package: oldestCritical.package,
        }
      : null,
    ecosystems: [...ecosystems.entries()]
      .map(([name, count]) => ({ name, alerts: count }))
      .sort((a, b) => b.alerts - a.alerts || a.name.localeCompare(b.name)),
    packages: [...packages.values()]
      .map((p) => ({
        name: p.name,
        ecosystem: p.ecosystem,
        alerts: p.alerts,
        repositories: p.repositories.size,
      }))
      .sort((a, b) => b.alerts - a.alerts || b.repositories - a.repositories || a.name.localeCompare(b.name))
      .slice(0, 10),
  };
}

/**
 * Every open alert of the repositories that have some, each repository's read page by page, those
 * with the most first, as their pages take longest. Totals and details are null unless every
 * repository's alerts were all read, so what's shown is exact.
 */
export async function getAlertDetails(
  gh: GitHubClient,
  repositories: { fullName: string; open: number }[],
  now = new Date(),
): Promise<AlertDetailsResponse> {
  const order = [...repositories].sort((a, b) => b.open - a.open);
  const read = await mapLimit(order, 8, async (r) => ({
    fullName: r.fullName,
    alerts: r.open ? await readAlerts(gh, r.fullName, r.open) : [],
  }));
  const complete = read.every((r) => r.alerts);
  const all = complete ? read.flatMap((r) => r.alerts!) : [];
  return {
    severity: complete ? countSeverities(all) : null,
    repositories: read.map((r) => ({
      fullName: r.fullName,
      severity: r.alerts ? countSeverities(r.alerts) : null,
    })),
    details: complete ? buildAlertDetails(all, now) : null,
  };
}

/**
 * Every repository an account owns, with what its quality and security are measured from; null
 * when there's no such account or more than can be read, rather than measures of only part.
 */
export async function readOrgRepos(gh: GitHubClient, login: string): Promise<RawHealthRepo[] | null> {
  const read = await readPages<RawHealthRepo>(
    gh,
    HEALTH,
    { login },
    (data) =>
      (data as { repositoryOwner: { repositories: Page<RawHealthRepo> } | null }).repositoryOwner
        ?.repositories,
  );
  return read.found && read.complete ? read.items : null;
}

/** Open Dependabot alerts over those repositories, counted where GitHub shows them. */
export async function getSecurity(gh: GitHubClient, repos: RawHealthRepo[]): Promise<SecurityResponse> {
  const alerts = await openAlerts(
    gh,
    alertable(repos).map((r) => r.nameWithOwner),
  );
  return buildSecurity(repos, alerts);
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
