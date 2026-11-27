import { describe, expect, it } from 'vitest';
import type { GitHubClient } from '../src/server/github';
import {
  alertable,
  buildAlertDetails,
  getAlertDetails,
  buildQuality,
  buildSecurity,
  getSecurity,
  readOrgRepos,
  getMemberTeams,
  getPeople,
  getSponsors,
  getTeams,
  openAlerts,
  type RawHealthRepo,
} from '../src/server/metrics/organizations';

const NOW = new Date('2026-11-26T00:00:00Z');
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString();

const repo = (name: string, over: Partial<RawHealthRepo> = {}): RawHealthRepo => ({
  nameWithOwner: `acme/${name}`,
  isFork: false,
  isArchived: false,
  pushedAt: daysAgo(5),
  description: 'Does things',
  viewerPermission: 'READ',
  hasIssuesEnabled: true,
  licenseInfo: { spdxId: 'MIT', name: 'MIT License' },
  repositoryTopics: { totalCount: 1 },
  ...over,
});

/** A GitHub answering one connection in pages of two, found under `wrap`. */
const paged = <T>(items: T[], wrap: (page: unknown) => unknown, total = items.length) => {
  let calls = 0;
  const gh = {
    graphql: async (_query: string, { after }: { after: string | null }) => {
      calls++;
      const start = after ? Number(after) : 0;
      const slice = items.slice(start, start + 2);
      return wrap({
        totalCount: total,
        pageInfo: { hasNextPage: start + 2 < items.length, endCursor: String(start + 2) },
        nodes: slice,
        edges: slice,
      });
    },
  } as unknown as GitHubClient;
  return { gh, calls: () => calls };
};

describe('quality and security', () => {
  it('measures the active repositories, leaving out forks and archived ones', () => {
    const repos = [
      repo('a'),
      repo('b', {
        description: '  ',
        licenseInfo: null,
        repositoryTopics: { totalCount: 0 },
        pushedAt: daysAgo(60),
      }),
      repo('c', { licenseInfo: { spdxId: 'NOASSERTION', name: 'Other' }, pushedAt: daysAgo(200) }),
      repo('d', { hasIssuesEnabled: false, pushedAt: daysAgo(900) }),
      repo('e', { pushedAt: null }),
      repo('old', { isArchived: true, licenseInfo: null }),
      repo('fork', { isFork: true, licenseInfo: null }),
    ];
    const health = buildQuality(repos, NOW);
    expect(health).toMatchObject({ sources: 6, archived: 1, active: 5 });
    expect(health.quality).toEqual([
      { key: 'license', count: 4 },
      { key: 'description', count: 4 },
      { key: 'topics', count: 4 },
      { key: 'issues', count: 4 },
    ]);
    // A license GitHub can't name is a custom one; none comes last.
    expect(health.licenses).toEqual([
      { name: 'MIT', count: 3 },
      { name: 'Custom', count: 1 },
      { name: 'None', count: 1 },
    ]);
    expect(health.activity).toEqual({ month: 1, quarter: 1, year: 1, older: 1, never: 1 });
    // Untouched for over a year, or never pushed to, the longest untouched first.
    expect(health.stale).toEqual([
      { fullName: 'acme/e', pushedAt: null, description: 'Does things', language: null },
      { fullName: 'acme/d', pushedAt: daysAgo(900), description: 'Does things', language: null },
    ]);
    // No repository you can write to: no alerts to show, rather than a misleading zero.
    expect(buildSecurity(repos, new Map())).toEqual({ active: 5, alerts: null });
  });

  it('counts alerts only where GitHub shows them: active repositories you can write to', () => {
    const repos = [
      repo('a', { viewerPermission: 'ADMIN' }),
      repo('b', { viewerPermission: 'WRITE' }),
      repo('c', { viewerPermission: 'MAINTAIN' }),
      repo('read', { viewerPermission: 'READ' }),
      repo('triage', { viewerPermission: 'TRIAGE' }),
      repo('old', { viewerPermission: 'ADMIN', isArchived: true }),
      repo('fork', { viewerPermission: 'ADMIN', isFork: true }),
    ];
    expect(alertable(repos).map((r) => r.nameWithOwner)).toEqual(['acme/a', 'acme/b', 'acme/c']);
    const security = buildSecurity(
      repos,
      new Map([
        ['acme/a', 3],
        ['acme/b', 0],
        ['acme/c', 7],
        ['acme/read', 99],
      ]),
    );
    expect(security.alerts).toEqual({
      readable: 3,
      open: 10,
      repositories: [
        { fullName: 'acme/c', open: 7 },
        { fullName: 'acme/a', open: 3 },
      ],
    });
  });

  it('asks for alerts in batches, each repository under its own alias', async () => {
    const queries: Record<string, string>[] = [];
    const gh = {
      graphql: async (_query: string, variables: Record<string, string>) => {
        queries.push(variables);
        const answer: Record<string, unknown> = {};
        for (const key of Object.keys(variables).filter((k) => k.startsWith('n')))
          answer[`r${key.slice(1)}`] =
            variables[key] === 'gone'
              ? null
              : { vulnerabilityAlerts: { totalCount: Number(variables[key]) } };
        return answer;
      },
    } as unknown as GitHubClient;
    const names = [...Array.from({ length: 30 }, (_, i) => `acme/${i}`), 'acme/gone'];
    const counts = await openAlerts(gh, names);
    expect(queries).toHaveLength(2);
    expect(counts.get('acme/29')).toBe(29);
    expect(counts.get('acme/gone')).toBe(0);
    expect(counts.size).toBe(31);
  });

  it('is left out past what can be read, and for no such account', async () => {
    const wrap = (page: unknown) => ({ repositoryOwner: { repositories: page } });
    const big = paged([repo('a')], wrap, 1001);
    expect(await readOrgRepos(big.gh, 'acme')).toBeNull();
    expect(big.calls()).toBe(1);
    const none = { graphql: async () => ({ repositoryOwner: null }) } as unknown as GitHubClient;
    expect(await readOrgRepos(none, 'nobody')).toBeNull();
    const all = paged([repo('a'), repo('b'), repo('c')], wrap);
    const repos = await readOrgRepos(all.gh, 'acme');
    expect(repos).toHaveLength(3);
    // Read-only everywhere: the alerts aren't asked for at all.
    expect(await getSecurity(all.gh, repos!)).toEqual({ active: 3, alerts: null });
  });
});

describe('people and teams', () => {
  /**
   * A GitHub with these members (and these admins among them, as members see them), their names,
   * and these enterprise owners: what the People page reads.
   */
  const github = ({
    member = true,
    admins = ['zed'],
    total = 3,
    owners = null as unknown,
    failNames = false,
  } = {}) => {
    const logins = ['bo', 'zed', 'al'];
    const asked: string[] = [];
    const gh = {
      graphql: async (query: string, variables: Record<string, string>) => {
        if (query.includes('enterpriseOwners')) return { organization: { enterpriseOwners: owners } };
        if (query.includes('membersWithRole'))
          return { organization: { viewerIsAMember: member, membersWithRole: { totalCount: total } } };
        if (failNames) throw new Error('timeout');
        // Names: one alias per login.
        const answer: Record<string, unknown> = {};
        for (const [key, login] of Object.entries(variables))
          answer[`u${key.slice(1)}`] = { name: login === 'zed' ? ' Zed ' : null };
        return answer;
      },
      pages: async (path: string, query: { role?: string } = {}) => {
        asked.push(`${path}${query.role ? `?role=${query.role}` : ''}`);
        const list = query.role === 'admin' ? admins : logins;
        return [list.map((login) => ({ login, avatar_url: `https://avatars/${login}` }))];
      },
    } as unknown as GitHubClient;
    return { gh, asked };
  };

  it('lists every member, admins first, with their names and, for members, their roles', async () => {
    const { gh, asked } = github();
    expect(await getPeople(gh, 'acme')).toEqual({
      member: true,
      people: [
        { login: 'zed', name: 'Zed', avatarUrl: 'https://avatars/zed', role: 'admin' },
        { login: 'al', name: null, avatarUrl: 'https://avatars/al', role: 'member' },
        { login: 'bo', name: null, avatarUrl: 'https://avatars/bo', role: 'member' },
      ],
      total: 3,
      complete: true,
      enterpriseOwners: null,
    });
    expect(asked).toEqual(['/orgs/acme/members', '/orgs/acme/members?role=admin']);

    // Outside it: its public members, no roles, and admins aren't asked for.
    const outside = github({ member: false });
    const seen = await getPeople(outside.gh, 'acme');
    expect(seen?.people.map((p) => p.role)).toEqual([null, null, null]);
    expect(outside.asked).toEqual(['/orgs/acme/members']);
  });

  it('keeps the logins when names fail, says when there were more than read, and is null without an organization', async () => {
    expect((await getPeople(github({ failNames: true }).gh, 'acme'))?.people[0]).toMatchObject({
      login: 'zed',
      name: null,
    });
    // Still the ones read, not none: the page says how many of them it shows.
    const many = await getPeople(github({ total: 5000 }).gh, 'acme');
    expect(many).toMatchObject({ total: 5000, complete: false });
    expect(many?.people).toHaveLength(3);
    const none = { graphql: async () => ({ organization: null }) } as unknown as GitHubClient;
    expect(await getPeople(none, 'octo')).toBeNull();
    expect(await getTeams(none, 'octo')).toBeNull();
  });

  it("reads the owners of the organization's enterprise, when GitHub shows them all", async () => {
    const owner = (login: string) => ({ login, name: '', avatarUrl: '' });
    const owners = async (value: unknown) =>
      (await getPeople(github({ owners: value }).gh, 'acme'))?.enterpriseOwners;
    expect(await owners({ totalCount: 2, nodes: [owner('zed'), owner('al')] })).toEqual([
      { login: 'al', name: null, avatarUrl: '' },
      { login: 'zed', name: null, avatarUrl: '' },
    ]);
    // No enterprise: none. More than were read: left out rather than part of them.
    expect(await owners({ totalCount: 0, nodes: [] })).toEqual([]);
    expect(await owners({ totalCount: 3, nodes: [owner('al')] })).toBeNull();
  });

  it('lists teams biggest first', async () => {
    const team = (name: string, members: number, extra: Record<string, unknown> = {}) => ({
      name,
      slug: name,
      description: ' ',
      privacy: 'VISIBLE',
      url: `https://github.com/orgs/acme/teams/${name}`,
      members: { totalCount: members },
      repositories: { totalCount: 4 },
      parentTeam: null,
      ...extra,
    });
    const { gh } = paged(
      [team('web', 3), team('core', 9, { privacy: 'SECRET', parentTeam: { name: 'eng' } }), team('ops', 3)],
      (page) => ({ organization: { teams: page } }),
    );
    const teams = await getTeams(gh, 'acme');
    expect(teams?.teams.map((t) => t.name)).toEqual(['core', 'ops', 'web']);
    expect(teams?.teams[0]).toMatchObject({
      secret: true,
      parent: 'eng',
      description: null,
      repositories: 4,
    });
  });
});

describe('alert severities', () => {
  /** A GitHub answering each repository's alerts in pages of two, with these severities. */
  const github = (alerts: Record<string, string[]>) => {
    const calls: string[] = [];
    const gh = {
      graphql: async (
        _query: string,
        { owner, name, after }: { owner: string; name: string; after: string | null },
      ) => {
        const all = alerts[`${owner}/${name}`]!;
        const start = after ? Number(after) : 0;
        calls.push(`${name}@${start}`);
        return {
          repository: {
            vulnerabilityAlerts: {
              pageInfo: { hasNextPage: start + 2 < all.length, endCursor: String(start + 2) },
              nodes: all.slice(start, start + 2).map((severity) => ({
                createdAt: daysAgo(10),
                securityVulnerability: { severity, package: { name: 'lodash', ecosystem: 'NPM' } },
              })),
            },
          },
        };
      },
    } as unknown as GitHubClient;
    return { gh, calls };
  };

  it('reads every page of each repository, the one with most alerts first, and adds them up', async () => {
    const { gh, calls } = github({
      'acme/a': ['LOW'],
      'acme/b': ['CRITICAL', 'HIGH', 'HIGH', 'MODERATE', 'LOW'],
    });
    const result = await getAlertDetails(gh, [
      { fullName: 'acme/a', open: 1 },
      { fullName: 'acme/b', open: 5 },
    ]);
    expect(calls[0]).toBe('b@0');
    expect(calls.filter((c) => c.startsWith('b@'))).toEqual(['b@0', 'b@2', 'b@4']);
    expect(result.severity).toEqual({ critical: 1, high: 2, moderate: 1, low: 2 });
    expect(result.details?.packages).toEqual([
      { name: 'lodash', ecosystem: 'NPM', alerts: 6, repositories: 2 },
    ]);
    expect(result.repositories.find((r) => r.fullName === 'acme/b')?.severity).toEqual({
      critical: 1,
      high: 2,
      moderate: 1,
      low: 1,
    });
  });

  it('tells how old the alerts are, where they come from, and which packages have the most', () => {
    const alert = (
      fullName: string,
      days: number,
      severity: 'critical' | 'high' | 'low',
      pkg: string,
      ecosystem = 'NPM',
    ) => ({
      fullName,
      createdAt: daysAgo(days),
      severity,
      package: pkg,
      ecosystem,
    });
    const details = buildAlertDetails(
      [
        alert('acme/a', 5, 'high', 'axios'),
        alert('acme/b', 60, 'critical', 'axios'),
        alert('acme/b', 400, 'critical', 'lodash'),
        alert('acme/c', 200, 'low', 'urllib3', 'PIP'),
        alert('acme/c', 900, 'high', 'axios'),
      ],
      NOW,
    );
    expect(details.age).toEqual({ month: 1, quarter: 1, year: 1, older: 2 });
    expect(details.oldestCritical).toEqual({
      fullName: 'acme/b',
      createdAt: daysAgo(400),
      package: 'lodash',
    });
    expect(details.ecosystems).toEqual([
      { name: 'NPM', alerts: 4 },
      { name: 'PIP', alerts: 1 },
    ]);
    expect(details.packages[0]).toEqual({ name: 'axios', ecosystem: 'NPM', alerts: 3, repositories: 3 });
  });

  it("leaves the split out when a repository's alerts couldn't all be read", async () => {
    // Three alerts counted, two found when reading them: they changed in between.
    const { gh } = github({ 'acme/a': ['HIGH'], 'acme/b': ['LOW', 'LOW'] });
    const result = await getAlertDetails(gh, [
      { fullName: 'acme/a', open: 1 },
      { fullName: 'acme/b', open: 3 },
    ]);
    expect(result.severity).toBeNull();
    expect(result.details).toBeNull();
    expect(result.repositories.find((r) => r.fullName === 'acme/a')?.severity).toMatchObject({ high: 1 });
    expect(result.repositories.find((r) => r.fullName === 'acme/b')?.severity).toBeNull();
  });
});

describe("a member's teams", () => {
  it('asks GitHub for the teams of that member only, by slug', async () => {
    let asked: Record<string, unknown> = {};
    const gh = {
      graphql: async (query: string, variables: Record<string, unknown>) => {
        asked = variables;
        expect(query).toContain('userLogins: [$member]');
        return {
          organization: {
            teams: {
              totalCount: 2,
              pageInfo: { hasNextPage: false, endCursor: null },
              nodes: [{ slug: 'web' }, { slug: 'ops' }],
            },
          },
        };
      },
    } as unknown as GitHubClient;
    expect(await getMemberTeams(gh, 'acme', 'bo')).toEqual({ teams: ['web', 'ops'], complete: true });
    expect(asked).toMatchObject({ login: 'acme', member: 'bo' });
    const none = { graphql: async () => ({ organization: null }) } as unknown as GitHubClient;
    expect(await getMemberTeams(none, 'octo', 'bo')).toBeNull();
  });
});

describe('sponsors', () => {
  it('lists who it sponsors and who sponsors it, saying when some are not shown', async () => {
    const who = (login: string) => ({ login, name: '', avatarUrl: '' });
    const gh = {
      graphql: async () => ({
        repositoryOwner: {
          sponsoring: { totalCount: 1, nodes: [who('a')] },
          sponsors: { totalCount: 3, nodes: [who('b')] },
        },
      }),
    } as unknown as GitHubClient;
    expect(await getSponsors(gh, 'acme')).toEqual({
      sponsoring: [{ login: 'a', name: null, avatarUrl: '' }],
      sponsors: [{ login: 'b', name: null, avatarUrl: '' }],
      totals: { sponsoring: 1, sponsors: 3 },
      complete: false,
    });
    const none = { graphql: async () => ({ repositoryOwner: null }) } as unknown as GitHubClient;
    expect(await getSponsors(none, 'nobody')).toBeNull();
  });
});
