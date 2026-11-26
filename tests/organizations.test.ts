import { describe, expect, it } from 'vitest';
import type { GitHubClient } from '../src/server/github';
import {
  alertable,
  buildHealth,
  getHealth,
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

describe('security and quality', () => {
  it('measures the active repositories, leaving out forks and archived ones', () => {
    const health = buildHealth(
      [
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
      ],
      new Map(),
      NOW,
    );
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
    // No repository you can write to: no alerts to show, rather than a misleading zero.
    expect(health.alerts).toBeNull();
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
    const health = buildHealth(
      repos,
      new Map([
        ['acme/a', 3],
        ['acme/b', 0],
        ['acme/c', 7],
        ['acme/read', 99],
      ]),
      NOW,
    );
    expect(health.alerts).toEqual({
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
    expect(await getHealth(big.gh, 'acme')).toBeNull();
    expect(big.calls()).toBe(1);
    const none = { graphql: async () => ({ repositoryOwner: null }) } as unknown as GitHubClient;
    expect(await getHealth(none, 'nobody')).toBeNull();
    const all = paged([repo('a'), repo('b'), repo('c')], wrap);
    expect(await getHealth(all.gh, 'acme')).toMatchObject({ active: 3, alerts: null });
  });
});

describe('people and teams', () => {
  const person = (login: string, role: 'ADMIN' | 'MEMBER') => ({
    role,
    node: { login, name: login === 'zed' ? 'Zed' : '', avatarUrl: `https://avatars/${login}` },
  });
  const people = [person('bo', 'MEMBER'), person('zed', 'ADMIN'), person('al', 'MEMBER')];

  it('lists every member, admins first, with roles only for members', async () => {
    const asMember = paged(people, (page) => ({
      organization: { viewerIsAMember: true, membersWithRole: page },
    }));
    expect(await getPeople(asMember.gh, 'acme')).toEqual({
      member: true,
      people: [
        { login: 'zed', name: 'Zed', avatarUrl: 'https://avatars/zed', role: 'admin' },
        { login: 'al', name: null, avatarUrl: 'https://avatars/al', role: 'member' },
        { login: 'bo', name: null, avatarUrl: 'https://avatars/bo', role: 'member' },
      ],
      total: 3,
      complete: true,
    });
    const outside = paged(people, (page) => ({
      organization: { viewerIsAMember: false, membersWithRole: page },
    }));
    const seen = await getPeople(outside.gh, 'acme');
    expect(seen?.member).toBe(false);
    expect(seen?.people.map((p) => p.role)).toEqual([null, null, null]);
  });

  it('says when there were more members than read, and is null with no organization', async () => {
    const big = paged(
      people,
      (page) => ({ organization: { viewerIsAMember: true, membersWithRole: page } }),
      5000,
    );
    expect(await getPeople(big.gh, 'acme')).toMatchObject({ total: 5000, complete: false });
    const none = { graphql: async () => ({ organization: null }) } as unknown as GitHubClient;
    expect(await getPeople(none, 'octo')).toBeNull();
    expect(await getTeams(none, 'octo')).toBeNull();
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
