import { describe, expect, it } from 'vitest';
import { GitHubError, type GitHubClient } from '../src/server/github';
import { listRepos } from '../src/server/metrics/repos';
import {
  MAX_SOURCES,
  buildAccount,
  buildTotals,
  getAccount,
  getAccountRepos,
  getAccountTotals,
  searchAccounts,
  type RawAccount,
} from '../src/server/metrics/accounts';
import { parseAccountQuery } from '../src/web/lib/accounts';

const repo = (name: string, stars: number, extra: Record<string, unknown> = {}) => ({
  databaseId: stars + 1,
  name,
  nameWithOwner: `octo/${name}`,
  description: null,
  isPrivate: false,
  isFork: false,
  isArchived: false,
  stargazerCount: stars,
  forkCount: 1,
  pushedAt: '2026-11-01T00:00:00Z',
  createdAt: '2020-01-01T00:00:00Z',
  url: `https://github.com/octo/${name}`,
  owner: { login: 'octo', avatarUrl: 'https://avatars/octo' },
  primaryLanguage: { name: 'Go' },
  watchers: { totalCount: 2 },
  issues: { totalCount: 3 },
  repositoryTopics: { nodes: [{ topic: { name: 'cli' } }] },
  ...extra,
});

const raw = (over: Partial<RawAccount> = {}): RawAccount => ({
  __typename: 'User',
  login: 'octo',
  avatarUrl: 'https://avatars/octo',
  url: 'https://github.com/octo',
  name: 'Octo Cat',
  bio: '  Builds things.  ',
  company: '',
  location: 'Lisbon',
  websiteUrl: null,
  twitterUsername: null,
  createdAt: '2015-03-01T00:00:00Z',
  followers: { totalCount: 40 },
  following: { totalCount: 3 },
  organizations: { nodes: [{ login: 'acme', avatarUrl: 'https://avatars/acme' }] },
  all: { totalCount: 10 },
  forks: { totalCount: 2 },
  archived: { totalCount: 1 },
  private: { totalCount: 0 },
  repos: { nodes: [repo('fresh', 1), repo('big', 50), repo('empty', 0, { pushedAt: null })] },
  top: { nodes: [repo('big', 50), repo('fresh', 1), repo('none', 0)] },
  ...over,
});

describe('an account', () => {
  it('reads a user: its counts, its organizations and its repositories', () => {
    const account = buildAccount(raw());
    expect(account).toMatchObject({
      kind: 'user',
      login: 'octo',
      name: 'Octo Cat',
      bio: 'Builds things.',
      company: null,
      location: 'Lisbon',
      followers: 40,
      following: 3,
      members: null,
      organizations: [{ login: 'acme' }],
      repositories: { total: 10, sources: 8, forks: 2, archived: 1, private: 0 },
    });
    // Its repositories in GitHub's order, all of them; the most starred only those with a star.
    expect(account.repos.map((r) => r.name)).toEqual(['fresh', 'big', 'empty']);
    expect(account.top.map((r) => r.name)).toEqual(['big', 'fresh']);
    expect(account.repos[1]).toMatchObject({
      fullName: 'octo/big',
      stars: 50,
      language: 'Go',
      topics: ['cli'],
    });
  });

  it('reads an organization: its members and description, no followers', () => {
    const account = buildAccount(
      raw({
        __typename: 'Organization',
        description: 'We build.',
        isVerified: true,
        membersWithRole: { totalCount: 12 },
        followers: undefined,
      }),
    );
    expect(account).toMatchObject({
      kind: 'organization',
      bio: 'We build.',
      verified: true,
      members: 12,
      followers: null,
      organizations: [],
    });
  });

  it("tells internal repositories apart from private ones, which GitHub's count adds them to", () => {
    const account = buildAccount(
      raw({ __typename: 'Organization', private: { totalCount: 9 }, privateOnly: { totalCount: 5 } }),
    );
    expect(account.repositories).toMatchObject({ private: 5, internal: 4 });
  });

  it('is null when no user or organization has the login', async () => {
    const gh = { graphql: async () => ({ repositoryOwner: null }) } as unknown as GitHubClient;
    expect(await getAccount(gh, 'nobody')).toBeNull();
  });
});

describe("an account's totals", () => {
  const node = (stars: number, language: string | null, isFork = false) => ({
    isFork,
    stargazerCount: stars,
    forkCount: 1,
    primaryLanguage: language ? { name: language } : null,
  });

  it('adds up stars and forks over every repository, and languages leaving out forks', () => {
    expect(
      buildTotals([node(5, 'Go'), node(3, 'Rust'), node(2, 'Go'), node(1, null), node(4, 'Java', true)]),
    ).toEqual({
      stars: 15,
      forks: 5,
      languages: [
        { name: 'Go', count: 2 },
        { name: 'Rust', count: 1 },
      ],
    });
  });

  /** A GitHub that answers repositories in pages of two. */
  const paged = (total: number, count = total) => {
    const all = Array.from({ length: count }, (_, i) => node(i, 'Go'));
    let calls = 0;
    const gh = {
      graphql: async (_query: string, { after }: { after: string | null }) => {
        calls++;
        const start = after ? Number(after) : 0;
        const nodes = all.slice(start, start + 2);
        const next = start + 2 < all.length;
        return {
          repositoryOwner: {
            sources: {
              totalCount: total,
              pageInfo: { hasNextPage: next, endCursor: String(start + 2) },
              nodes,
            },
          },
        };
      },
    } as unknown as GitHubClient;
    return { gh, calls: () => calls };
  };

  it('reads every page', async () => {
    const { gh, calls } = paged(5);
    expect(await getAccountTotals(gh, 'octo')).toMatchObject({ stars: 0 + 1 + 2 + 3 + 4 });
    expect(calls()).toBe(3);
  });

  it('leaves them out past what can be read, or when the list changed while reading', async () => {
    const big = paged(MAX_SOURCES + 1, 2);
    expect(await getAccountTotals(big.gh, 'octo')).toBeNull();
    expect(big.calls()).toBe(1);
    expect(await getAccountTotals(paged(5, 4).gh, 'octo')).toBeNull();
  });
});

describe('repositories and search', () => {
  it("lists an outside account's repositories, saying when there were more than read", async () => {
    const rawRepo = { id: 1, name: 'a', full_name: 'octo/a', owner: { login: 'octo', avatar_url: '' } };
    let asked = '';
    const gh = {
      pages: async (path: string) => {
        asked = path;
        return [[rawRepo]];
      },
    } as unknown as GitHubClient;
    const result = await getAccountRepos(gh, 'octo');
    expect(asked).toBe('/users/octo/repos');
    expect(result).toMatchObject({ complete: true, repos: [{ fullName: 'octo/a' }] });

    // An organization's: its own list, every one you can see, not only its public ones.
    let query: Record<string, unknown> = {};
    const org = {
      pages: async (path: string, q: Record<string, unknown>) => {
        asked = path;
        query = q;
        return [[rawRepo]];
      },
    } as unknown as GitHubClient;
    await getAccountRepos(org, 'acme', true);
    expect(asked).toBe('/orgs/acme/repos');
    expect(query.type).toBe('all');

    const full = { pages: async () => [Array.from({ length: MAX_SOURCES }, () => rawRepo)] };
    expect((await getAccountRepos(full as unknown as GitHubClient, 'octo')).complete).toBe(false);
  });

  it('finds accounts by login, telling users and organizations apart', async () => {
    let query: Record<string, unknown> = {};
    const gh = {
      get: async (_path: string, q: Record<string, unknown>) => {
        query = q;
        return {
          items: [
            { login: 'octo', avatar_url: 'a', type: 'User' },
            { login: 'octo-org', avatar_url: 'b', type: 'Organization' },
          ],
        };
      },
    } as unknown as GitHubClient;
    expect(await searchAccounts(gh, 'octo')).toEqual([
      { login: 'octo', avatarUrl: 'a', kind: 'user' },
      { login: 'octo-org', avatarUrl: 'b', kind: 'organization' },
    ]);
    expect(query.q).toBe('octo in:login');
  });

  it('reads an account typed or pasted in the quick search', () => {
    expect(parseAccountQuery('https://github.com/octo-org/')).toEqual({ login: 'octo-org', exact: true });
    expect(parseAccountQuery('github.com/octo')).toEqual({ login: 'octo', exact: true });
    expect(parseAccountQuery('@octo')).toEqual({ login: 'octo', exact: true });
    expect(parseAccountQuery('  octo ')).toEqual({ login: 'octo', exact: false });
    // A repository, a pull request, words or an invalid name aren't an account.
    for (const text of ['octo/app', 'github.com/octo/app', 'two words', '-octo', 'a--b', '@', '']) {
      expect(parseAccountQuery(text)).toBeNull();
    }
  });
});

describe('your repositories', () => {
  const raw = (id: number, fullName: string, pushed: string) => ({
    id,
    name: fullName.split('/')[1],
    full_name: fullName,
    owner: { login: fullName.split('/')[0], avatar_url: '' },
    private: false,
    fork: false,
    archived: false,
    pushed_at: pushed,
  });

  it("adds each organization's own list, where its public and internal ones are", async () => {
    const gh = {
      paginate: async (path: string) =>
        path === '/user/orgs'
          ? [{ login: 'acme' }, { login: 'sso' }]
          : [raw(1, 'me/tool', '2026-01-03T00:00:00Z'), raw(2, 'acme/given', '2026-01-01T00:00:00Z')],
      pages: async (path: string) => {
        // An organization that refuses, as with single sign-on, adds nothing.
        if (path === '/orgs/sso/repos') throw new GitHubError(403, 'SAML enforcement');
        return [
          [raw(2, 'acme/given', '2026-01-01T00:00:00Z'), raw(3, 'acme/internal', '2026-01-02T00:00:00Z')],
        ];
      },
    } as unknown as GitHubClient;
    // Each once, pushed to most recently first.
    expect((await listRepos(gh)).map((r) => r.fullName)).toEqual(['me/tool', 'acme/internal', 'acme/given']);
  });
});
