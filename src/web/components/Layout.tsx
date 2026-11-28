import {
  ActionIcon,
  Affix,
  AppShell,
  Avatar,
  Box,
  Burger,
  CloseButton,
  CopyButton,
  Group,
  Kbd,
  Menu,
  Paper,
  Progress,
  NavLink as MantineNavLink,
  ScrollArea,
  Skeleton,
  Text,
  Tooltip,
  Transition,
  UnstyledButton,
  useComputedColorScheme,
  useMantineColorScheme,
} from '@mantine/core';
import { useDebouncedValue, useDisclosure, useLocalStorage } from '@mantine/hooks';
import { Spotlight, spotlight, type SpotlightActionData } from '@mantine/spotlight';
import {
  IconArrowLeft,
  IconBook2,
  IconCode,
  IconChartArea,
  IconGitCommit,
  IconGitPullRequest,
  IconHome,
  IconLayoutDashboard,
  IconLogout,
  IconMoon,
  IconPlayerPlay,
  IconRadar,
  IconRocket,
  IconSearch,
  IconSettings,
  IconStar,
  IconSun,
  IconTag,
  IconUsers,
  IconUser,
  IconWorld,
  IconCircleDot,
  IconHeart,
  IconChecklist,
  IconShieldCheck,
  IconUsersGroup,
} from '@tabler/icons-react';
import { MarkGithubIcon } from '@primer/octicons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation, useMatch, useNavigate } from 'react-router';
import { api, post } from '../lib/api';
import { compact, num } from '../lib/format';
import { languageColor } from '../lib/languages';
import { useRecentRepos } from '../lib/recent';
import { snoozed, type Dismissed } from '../lib/update';
import {
  sectionQuery,
  accountPageKey,
  useAccount,
  useAccountSearch,
  useAuth,
  useMyPulls,
  useOwners,
  useRateLimit,
  useRepos,
} from '../lib/queries';
import { parseAccountQuery } from '../lib/accounts';
import { parsePullQuery } from '../lib/pulls';
import type { OverviewResponse, SearchResponse, SecurityResponse, UpdateInfo } from '../../shared/types';
import { PinButton, repoPath } from './repo';
import { Logo } from './ui';
import { LaunchOffer } from './launch';

interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
}

const icon = (Component: typeof IconStar) => <Component size={18} stroke={1.6} />;

export const REPO_SECTIONS: { group: string; items: NavItem[] }[] = [
  { group: '', items: [{ to: '', label: 'Overview', icon: icon(IconLayoutDashboard) }] },
  {
    group: 'Popularity',
    items: [
      { to: 'stars', label: 'Stars', icon: icon(IconStar) },
      { to: 'traffic', label: 'Traffic', icon: icon(IconChartArea) },
    ],
  },
  {
    group: 'Activity',
    items: [
      { to: 'commits', label: 'Commits', icon: icon(IconGitCommit) },
      { to: 'pulls', label: 'Pull requests', icon: icon(IconGitPullRequest) },
      { to: 'issues', label: 'Issues', icon: icon(IconCircleDot) },
      { to: 'contributors', label: 'Contributors', icon: icon(IconUsers) },
    ],
  },
  { group: 'Code', items: [{ to: 'code', label: 'Hotspots', icon: icon(IconCode) }] },
  {
    group: 'Delivery',
    items: [
      { to: 'actions', label: 'Actions', icon: icon(IconPlayerPlay) },
      { to: 'releases', label: 'Releases', icon: icon(IconTag) },
      { to: 'deployments', label: 'Deployments', icon: icon(IconRocket) },
    ],
  },
];

function NavItemLink({
  to,
  label,
  icon,
  end,
  right,
  active,
  title,
  onClick,
}: NavItem & {
  end?: boolean;
  right?: ReactNode;
  active?: boolean;
  title?: string;
  onClick?: () => void;
}) {
  return (
    <NavLink
      to={to}
      end={end}
      title={title}
      style={{ textDecoration: 'none', color: 'inherit' }}
      onClick={onClick}
    >
      {({ isActive }) => (
        <MantineNavLink
          component="span"
          label={label}
          leftSection={icon}
          rightSection={right}
          active={active ?? isActive}
          className="nav-link"
        />
      )}
    </NavLink>
  );
}

function GroupLabel({ children, right }: { children: ReactNode; right?: ReactNode }) {
  const label = (
    <Text size="xs" fw={600} c="dimmed" tt="uppercase" px="sm" mt="lg" mb={6} style={{ letterSpacing: 0.6 }}>
      {children}
    </Text>
  );
  if (!right) return label;
  return (
    <Group justify="space-between" wrap="nowrap" pr="sm">
      {label}
      <Box mt="lg" mb={6}>
        {right}
      </Box>
    </Group>
  );
}

function RepoNavigation({
  owner,
  repo,
  onNavigate,
}: {
  owner: string;
  repo: string;
  onNavigate: () => void;
}) {
  const base = `/r/${owner}/${repo}`;
  const { data } = useRepos();
  const summary = data?.repos.find((r) => r.fullName === `${owner}/${repo}`);
  const overview = useQuery({
    ...sectionQuery<OverviewResponse>(owner, repo, 'overview'),
    staleTime: 5 * 60_000,
  });
  // Remember the repository once it has actually loaded, under GitHub's own spelling of its name,
  // so a mistyped or moved address never lands in the list.
  const { visit } = useRecentRepos();
  const loaded = overview.data?.repo;
  useEffect(() => {
    if (loaded) visit({ fullName: loaded.fullName, ownerAvatarUrl: loaded.ownerAvatarUrl });
  }, [loaded, visit]);

  // Counts shown next to the sections they open, like the repository count on the home sidebar.
  const counts: Record<string, number | null | undefined> = {
    stars: overview.data?.repo.stars ?? summary?.stars,
    issues: overview.data?.totals.openIssues,
    pulls: overview.data?.totals.openPullRequests,
    contributors: overview.data?.totals.contributors,
  };
  return (
    <>
      <Group gap="sm" wrap="nowrap" px="xs" py="sm" mb="xs" className="repo-identity">
        {/* The owner's logo and name open its page, as a user's or an organization's. */}
        <NavLink
          to={`/a/${owner}`}
          onClick={onNavigate}
          className="identity-link"
          title={`Open ${owner}'s page`}
        >
          <Avatar src={summary?.ownerAvatarUrl ?? `https://github.com/${owner}.png`} size={34} radius="md" />
          <Box miw={0} style={{ flex: 1 }}>
            <Text fw={600} size="sm" truncate>
              {repo}
            </Text>
            <Text size="xs" c="dimmed" truncate className="identity-owner">
              {owner}
            </Text>
          </Box>
        </NavLink>
        <PinButton fullName={`${owner}/${repo}`} />
      </Group>
      {REPO_SECTIONS.map(({ group, items }) => (
        <Box key={group || 'main'}>
          {group && <GroupLabel>{group}</GroupLabel>}
          {items.map((item) => (
            <NavItemLink
              key={item.to}
              {...item}
              to={item.to ? `${base}/${item.to}` : base}
              end={!item.to}
              right={counts[item.to] != null ? <Count>{compact(counts[item.to]!)}</Count> : undefined}
              onClick={onNavigate}
            />
          ))}
        </Box>
      ))}
    </>
  );
}

/** An organization's own sidebar, as a repository has one: its pages, with their counts. */
function OrgNavigation({ login, onNavigate }: { login: string; onNavigate: () => void }) {
  const { data } = useAccount(login);
  const base = `/a/${data?.login ?? login}`;
  const security = useQuery<{ security: SecurityResponse | null }>({
    queryKey: accountPageKey(login, 'security'),
    enabled: false,
  });
  const securityCount = security.data?.security?.alerts?.open;
  const items: (NavItem & { count?: number | null })[] = [
    { to: '', label: 'Overview', icon: icon(IconLayoutDashboard) },
    { to: 'repositories', label: 'Repositories', icon: icon(IconBook2), count: data?.repositories.total },
    { to: 'people', label: 'People', icon: icon(IconUsers), count: data?.members },
    ...(data?.teams ? [{ to: 'teams', label: 'Teams', icon: icon(IconUsersGroup), count: data.teams }] : []),
    { to: 'quality', label: 'Quality', icon: icon(IconChecklist) },
    // The count only once the page has read it: asking for it here would make the sidebar slow.
    { to: 'security', label: 'Security', icon: icon(IconShieldCheck), count: securityCount },
    ...(data && data.sponsoring + data.sponsors > 0
      ? [{ to: 'sponsors', label: 'Sponsors', icon: icon(IconHeart), count: data.sponsoring + data.sponsors }]
      : []),
  ];
  return (
    <>
      <Group gap="sm" wrap="nowrap" px="xs" py="sm" mb="xs" className="repo-identity">
        <Avatar src={data?.avatarUrl ?? `https://github.com/${login}.png`} size={34} radius="md" />
        <Box miw={0} style={{ flex: 1 }}>
          <Text fw={600} size="sm" truncate>
            {data?.name ?? data?.login ?? login}
          </Text>
          <Text size="xs" c="dimmed" truncate>
            Organization
          </Text>
        </Box>
      </Group>
      {items.map(({ count, ...item }) => (
        <NavItemLink
          key={item.to}
          {...item}
          to={item.to ? `${base}/${item.to}` : base}
          end={!item.to}
          right={count != null ? <Count>{compact(count)}</Count> : undefined}
          onClick={onNavigate}
        />
      ))}
    </>
  );
}

const Count = ({ children }: { children: ReactNode }) => (
  <Text size="xs" c="dimmed" className="tabular">
    {children}
  </Text>
);

/** Rows of the sidebar still loading: an icon and a label, at the size of the real ones. */
function NavSkeleton({ rows }: { rows: number }) {
  return (
    <Box px="sm" aria-busy="true">
      {Array.from({ length: rows }, (_, i) => (
        <Group key={i} gap={12} h={42} wrap="nowrap">
          <Skeleton height={18} width={18} radius="sm" />
          <Skeleton height={10} width={`${70 - i * 12}%`} radius="xl" />
        </Group>
      ))}
    </Box>
  );
}

/** An account's sidebar before it's known whether the account is an organization. */
function AccountNavigationLoading() {
  return (
    <>
      <Group gap="sm" wrap="nowrap" px="xs" py="sm" mb="xs" className="repo-identity" aria-busy="true">
        <Skeleton height={34} width={34} radius="md" />
        <Box style={{ flex: 1 }}>
          <Skeleton height={10} width="70%" radius="xl" />
          <Skeleton height={8} width="45%" radius="xl" mt={8} />
        </Box>
      </Group>
      <NavSkeleton rows={6} />
    </>
  );
}

function MainNavigation({ onNavigate }: { onNavigate: () => void }) {
  const { data } = useRepos();
  const owners = useOwners();
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const onRepositories = location.pathname === '/repositories';
  const pinned = (data?.repos ?? []).filter((r) => data?.favorites.includes(r.fullName));
  // How many pull requests wait for your review, next to the link that lists them.
  const reviews = useMyPulls('open').data?.counts.review;

  // The last repositories opened, exactly as they were opened, pinned ones included.
  const { recent, clear } = useRecentRepos();
  const recentShown = recent.slice(0, 4);

  return (
    <>
      <NavItemLink to="/" label="Home" icon={icon(IconHome)} end onClick={onNavigate} />
      <NavItemLink
        to="/repositories"
        label="Repositories"
        icon={icon(IconBook2)}
        active={onRepositories && !params.get('owner')}
        right={<Count>{data ? data.repos.length : ''}</Count>}
        onClick={onNavigate}
      />

      <NavItemLink
        to="/pulls"
        label="Pull requests"
        icon={icon(IconGitPullRequest)}
        right={reviews ? <Count>{reviews}</Count> : undefined}
        onClick={onNavigate}
      />
      <NavItemLink
        to="/radar"
        label="Radar"
        icon={icon(IconRadar)}
        // A faint glow in the logo's red, breathing softly: there's something here worth a look.
        right={<span className="nav-dot" aria-hidden />}
        onClick={onNavigate}
      />

      {/* While your repositories load, the accounts they belong to aren't known yet: hold their place. */}
      {!data && (
        <>
          <GroupLabel>Accounts</GroupLabel>
          <NavSkeleton rows={3} />
        </>
      )}
      {owners.length > 1 && (
        <>
          <GroupLabel>Accounts</GroupLabel>
          {owners.map((o) => (
            <NavItemLink
              key={o.login}
              to={`/a/${o.login}`}
              label={o.login}
              icon={<Avatar src={o.avatarUrl} size={18} radius="sm" />}
              // The account's page, and its repositories opened from there.
              active={
                location.pathname.toLowerCase() === `/a/${o.login.toLowerCase()}` ||
                (onRepositories && params.get('owner') === o.login)
              }
              right={<Count>{o.count}</Count>}
              onClick={onNavigate}
            />
          ))}
        </>
      )}

      <GroupLabel>Pinned</GroupLabel>
      {/* Until your repositories load, which are pinned isn't known: no "nothing pinned" yet. */}
      {!data ? (
        <NavSkeleton rows={2} />
      ) : pinned.length ? (
        pinned.map((r) => (
          <NavItemLink
            key={r.id}
            to={repoPath(r)}
            label={r.name}
            icon={<span className="lang-dot" style={{ background: languageColor(r.language) }} />}
            right={<Count>{compact(r.stars)}</Count>}
            onClick={onNavigate}
          />
        ))
      ) : (
        <Text size="xs" c="dimmed" px="sm" lh={1.5}>
          Use the pin on any repository to keep it one click away.
        </Text>
      )}

      {recentShown.length > 0 && (
        <>
          <GroupLabel
            right={
              <UnstyledButton onClick={clear} className="group-action" aria-label="Clear recent repositories">
                Clear
              </UnstyledButton>
            }
          >
            Recent
          </GroupLabel>
          {recentShown.map((r) => {
            const [owner, name] = r.fullName.split('/') as [string, string];
            return (
              <NavItemLink
                key={r.fullName}
                to={repoPath({ owner, name })}
                label={name}
                title={r.fullName}
                icon={<Avatar src={r.ownerAvatarUrl} size={18} radius="sm" />}
                onClick={onNavigate}
              />
            );
          })}
        </>
      )}
    </>
  );
}

/**
 * A newer GitMetrics is on npm: a small card in the bottom right corner with the command that
 * updates it. Started through npx GitMetrics updates itself, so this mostly shows for a global
 * install. Closing it hides it for a week, or until an even newer version comes out.
 */
function UpdatePopup() {
  const { data } = useQuery({
    queryKey: ['update'],
    queryFn: () => api<UpdateInfo>('/update'),
    staleTime: Infinity,
  });
  const [dismissed, setDismissed] = useLocalStorage<Dismissed | null>({
    key: 'gitmetrics:update-dismissed',
    defaultValue: null,
    getInitialValueInEffect: false,
  });
  const show = Boolean(data?.available && data.command && !snoozed(dismissed, data.latest));

  return (
    <Affix position={{ bottom: 20, right: 20 }} zIndex={150}>
      <Transition mounted={show} transition="slide-up" duration={220}>
        {(style) => (
          <Paper style={style} className="update-popup" shadow="lg" withBorder role="status">
            <Group justify="space-between" wrap="nowrap" align="center" gap="sm">
              <Group gap={12} wrap="nowrap" align="center">
                <Logo size={36} />
                <Text fw={700}>GitMetrics has a new version</Text>
              </Group>
              <CloseButton
                size="sm"
                aria-label="Dismiss"
                onClick={() => setDismissed({ version: data?.latest ?? '', at: Date.now() })}
              />
            </Group>
            <Text size="sm" mt="md" lh={1.5}>
              You are missing the latest features and fixes. Update now, then start GitMetrics again:
            </Text>
            <Group gap={8} wrap="nowrap" mt={10} className="update-command">
              <Text component="code" size="xs" truncate>
                <span className="update-prompt" aria-hidden>
                  ${' '}
                </span>
                {data?.command}
              </Text>
              <CopyButton value={data?.command ?? ''}>
                {({ copied, copy }) => (
                  <UnstyledButton
                    onClick={copy}
                    className="group-action"
                    aria-label="Copy the update command"
                  >
                    {copied ? 'Copied' : 'Copy'}
                  </UnstyledButton>
                )}
              </CopyButton>
            </Group>
          </Paper>
        )}
      </Transition>
    </Affix>
  );
}

/** The signed-in account and how much of the hourly GitHub API budget is left. */
function AccountFooter({ onNavigate }: { onNavigate: () => void }) {
  const { data } = useAuth();
  const rate = useRateLimit();
  const viewer = data?.viewer;
  if (!viewer) return null;
  const left = rate.data ? rate.data.remaining / rate.data.limit : null;
  return (
    <UnstyledButton component={NavLink} to="/settings" className="account-footer" onClick={onNavigate}>
      <Group gap="sm" wrap="nowrap">
        <Avatar src={viewer.avatarUrl} size={32} radius="xl" />
        <Box miw={0} style={{ flex: 1 }}>
          <Text size="sm" fw={600} truncate>
            {viewer.name ?? viewer.login}
          </Text>
          <Text size="xs" c="dimmed" truncate>
            @{viewer.login}
          </Text>
        </Box>
        <IconSettings size={17} stroke={1.6} color="var(--mantine-color-dimmed)" />
      </Group>
      {rate.data && left !== null && (
        <Box mt={12}>
          <Group justify="space-between" mb={5}>
            <Text size="xs" c="dimmed">
              API calls left
            </Text>
            <Text size="xs" c="dimmed" className="tabular">
              {num(rate.data.remaining)} / {num(rate.data.limit)}
            </Text>
          </Group>
          <Progress value={left * 100} size={4} color={left < 0.15 ? 'red' : 'gray'} />
        </Box>
      )}
    </UnstyledButton>
  );
}

/** The search shortcut is "mod + K": Command on macOS, Control everywhere else. */
const IS_MAC =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

function SearchButton() {
  return (
    <UnstyledButton onClick={() => spotlight.open()} className="search-button" visibleFrom="sm">
      <Group gap="xs" wrap="nowrap">
        <IconSearch size={16} stroke={1.6} />
        {/* What the search finds: repositories, accounts and pull requests, by name or by link. */}
        <Text size="sm" c="dimmed" truncate style={{ flex: 1 }}>
          Search repositories, accounts and PRs
        </Text>
        <Kbd size="xs">{IS_MAC ? '⌘ K' : 'Ctrl K'}</Kbd>
      </Group>
    </UnstyledButton>
  );
}

function ColorSchemeToggle() {
  const { setColorScheme } = useMantineColorScheme();
  const computed = useComputedColorScheme('dark');
  return (
    <Tooltip label={computed === 'dark' ? 'Light mode' : 'Dark mode'}>
      <ActionIcon
        variant="default"
        size="lg"
        aria-label="Toggle color scheme"
        onClick={() => setColorScheme(computed === 'dark' ? 'light' : 'dark')}
      >
        {computed === 'dark' ? <IconSun size={18} stroke={1.6} /> : <IconMoon size={18} stroke={1.6} />}
      </ActionIcon>
    </Tooltip>
  );
}

function UserMenu() {
  const { data } = useAuth();
  const navigate = useNavigate();
  const client = useQueryClient();
  const viewer = data?.viewer;
  if (!viewer) return null;

  const signOut = async () => {
    await post('/auth/logout');
    client.clear();
    navigate('/login');
  };

  return (
    <Menu position="bottom-end" width={220} shadow="md">
      <Menu.Target>
        <UnstyledButton aria-label="Account menu">
          <Avatar src={viewer.avatarUrl} size={34} radius="xl" />
        </UnstyledButton>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Label>
          <Text size="sm" fw={600} c="var(--mantine-color-text)">
            {viewer.name ?? viewer.login}
          </Text>
          <Text size="xs" c="dimmed">
            @{viewer.login}
          </Text>
        </Menu.Label>
        <Menu.Divider />
        <Menu.Item
          leftSection={<MarkGithubIcon size={16} />}
          component="a"
          href={viewer.htmlUrl}
          target="_blank"
        >
          GitHub profile
        </Menu.Item>
        <Menu.Item leftSection={<IconSettings size={16} />} onClick={() => navigate('/settings')}>
          Settings
        </Menu.Item>
        <Menu.Divider />
        <Menu.Item color="red" leftSection={<IconLogout size={16} />} onClick={signOut}>
          Sign out
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
}

/** A typed owner/name, or a pasted GitHub link, turned into owner/name. */
export function parseRepoQuery(text: string): string {
  const trimmed = text.trim();
  const link = /^(?:https?:\/\/)?(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+)/i.exec(trimmed);
  return link ? `${link[1]}/${link[2]!.replace(/\.git$/, '')}` : trimmed;
}

/** Same rule as the server: name characters in words, or owner/name. */
const SEARCHABLE = /^(?:[\w.-]+(?: [\w.-]+)*|[a-z\d-]+\/[\w.-]*)$/i;
const FULL_NAME = /^[a-z\d-]+\/[\w.-]+$/i;

/** Pages and your repositories matching the query: by name first, then by description or topic. */
function matchActions(query: string, actions: SpotlightActionData[]) {
  const q = query.trim().toLowerCase();
  if (!q) return actions;
  const byLabel = actions.filter((a) => a.label?.toLowerCase().includes(q));
  const byOther = actions.filter(
    (a) =>
      !byLabel.includes(a) &&
      (a.description?.toLowerCase().includes(q) ||
        (a.keywords as string[] | undefined)?.some((k) => k.toLowerCase().includes(q))),
  );
  return [...byLabel, ...byOther];
}

const stars = (count: number) => (
  <Group gap={4} wrap="nowrap">
    <IconStar size={14} stroke={1.6} />
    <Text size="xs">{compact(count)}</Text>
  </Group>
);

function RepoSpotlight() {
  const { data } = useRepos();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const text = parseRepoQuery(query);
  const [debounced] = useDebouncedValue(text, 300);
  // A pull request opens its own page, before anything else, with no search.
  const pull = parsePullQuery(query);
  const searchable = !pull && debounced.length >= 2 && debounced.length <= 100 && SEARCHABLE.test(debounced);

  // Accounts: yours that match, then GitHub's, in their own group below everything else. Their
  // search is a request of its own, so it never slows or breaks the repository search.
  const account = pull ? null : parseAccountQuery(query);
  const [accountTerm] = useDebouncedValue(account?.login ?? '', 300);
  const accountSearch = useAccountSearch(
    accountTerm,
    Boolean(account) && accountTerm === account?.login && accountTerm.length >= 3,
  );
  const owners = useOwners();

  // GitHub is searched only once you type, and only below your own repositories.
  const search = useQuery({
    queryKey: ['search', debounced.toLowerCase()],
    queryFn: () => api<SearchResponse>(`/search/repos?q=${encodeURIComponent(debounced)}`),
    enabled: searchable,
    staleTime: 10 * 60_000,
  });

  const own = data?.repos ?? [];
  const ownNames = new Set(own.map((r) => r.fullName.toLowerCase()));
  const pages: SpotlightActionData[] = [
    {
      id: 'home',
      label: 'Home',
      description: 'Overview of your projects, activity and top repositories',
      leftSection: <IconHome size={20} stroke={1.5} />,
      onClick: () => navigate('/'),
    },
    {
      id: 'repositories',
      label: 'Repositories',
      description: 'Browse and filter every repository',
      leftSection: <IconBook2 size={20} stroke={1.5} />,
      onClick: () => navigate('/repositories'),
    },
    {
      id: 'settings',
      label: 'Settings',
      description: 'Account, API usage and data',
      leftSection: <IconSettings size={20} stroke={1.5} />,
      onClick: () => navigate('/settings'),
    },
  ];
  const mine: SpotlightActionData[] = own.map((r) => ({
    id: r.fullName,
    label: r.fullName,
    description: r.description ?? undefined,
    keywords: [r.name, r.language ?? '', ...r.topics],
    leftSection: <Avatar src={r.ownerAvatarUrl} size={26} radius="md" />,
    rightSection: stars(r.stars),
    onClick: () => navigate(repoPath(r)),
  }));
  const local = matchActions(text, [...pages, ...mine]).slice(0, 8);

  const elsewhere: SpotlightActionData[] = [];
  if (pull) {
    const path = `${pull.owner}/${pull.name}`;
    elsewhere.push({
      id: `pull:${path}#${pull.number}`,
      label: `${path} #${pull.number}`,
      description: 'Open this pull request',
      leftSection: <IconGitPullRequest size={20} stroke={1.5} />,
      onClick: () => navigate(`/r/${path}/pull/${pull.number}`),
    });
  } else if (text) {
    const results = searchable && debounced === text ? (search.data?.repos ?? []) : [];
    // An exact owner/name opens directly, even before (or without) a search result for it.
    if (FULL_NAME.test(text) && !ownNames.has(text.toLowerCase())) {
      const [owner, name] = text.split('/') as [string, string];
      const found = results.find((r) => r.fullName.toLowerCase() === text.toLowerCase());
      elsewhere.push({
        id: `open:${text}`,
        label: found?.fullName ?? text,
        description: found?.description ?? 'Open this repository',
        leftSection: found ? (
          <Avatar src={found.ownerAvatarUrl} size={26} radius="md" />
        ) : (
          <IconWorld size={20} stroke={1.5} />
        ),
        rightSection: found ? stars(found.stars) : undefined,
        onClick: () => navigate(found ? repoPath(found) : `/r/${owner}/${name}`),
      });
    }
    for (const r of results) {
      const key = r.fullName.toLowerCase();
      if (ownNames.has(key) || elsewhere.some((a) => a.id.toLowerCase() === `open:${key}`)) continue;
      elsewhere.push({
        id: `github:${r.fullName}`,
        label: r.fullName,
        description: r.description ?? undefined,
        leftSection: <Avatar src={r.ownerAvatarUrl} size={26} radius="md" />,
        rightSection: stars(r.stars),
        onClick: () => navigate(repoPath(r)),
      });
    }
  }

  const accounts: SpotlightActionData[] = [];
  if (account) {
    const term = account.login.toLowerCase();
    const seen = new Set<string>();
    const add = (item: SpotlightActionData & { login: string }) => {
      const key = item.login.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      const { login, ...action } = item;
      accounts.push({ ...action, id: `account:${login}`, onClick: () => navigate(`/a/${login}`) });
    };
    const hits = accountTerm === account.login ? (accountSearch.data?.accounts ?? []) : [];
    const found = hits.find((h) => h.login.toLowerCase() === term);
    // A link or @login opens that account, even before (or without) a search result for it.
    if (account.exact) {
      add({
        id: '',
        login: found?.login ?? account.login,
        label: found?.login ?? account.login,
        description: 'Open this account',
        leftSection: found ? (
          <Avatar src={found.avatarUrl} size={26} radius={found.kind === 'user' ? 'xl' : 'md'} />
        ) : (
          <IconUser size={20} stroke={1.5} />
        ),
      });
    }
    for (const o of owners.filter((o) => o.login.toLowerCase().includes(term))) {
      add({
        id: '',
        login: o.login,
        label: o.login,
        description: `${o.count} of your repositories`,
        leftSection: <Avatar src={o.avatarUrl} size={26} radius="md" />,
      });
    }
    for (const h of hits) {
      add({
        id: '',
        login: h.login,
        label: h.login,
        description: h.kind === 'organization' ? 'Organization' : 'User',
        leftSection: <Avatar src={h.avatarUrl} size={26} radius={h.kind === 'user' ? 'xl' : 'md'} />,
      });
    }
  }

  const repoActions = pull
    ? elsewhere
    : elsewhere.length
      ? [...local, { group: 'On GitHub', actions: elsewhere.slice(0, 6) }]
      : local;
  const actions = accounts.length
    ? [...repoActions, { group: 'Accounts', actions: accounts.slice(0, 4) }]
    : repoActions;
  const searching =
    (searchable && (search.isFetching || debounced !== text)) ||
    (Boolean(account) && accountSearch.isFetching);

  return (
    <Spotlight
      actions={actions}
      filter={(_query, list) => list}
      query={query}
      onQueryChange={setQuery}
      nothingFound={searching ? 'Searching GitHub…' : 'No repository or account matches your search'}
      highlightQuery
      shortcut={['mod + K', '/']}
      searchProps={{
        leftSection: <IconSearch size={18} stroke={1.5} />,
        placeholder: 'Jump to a repository or account, search GitHub, or paste a link…',
      }}
    />
  );
}

export function Layout() {
  const [opened, { toggle, close }] = useDisclosure();
  const repoMatch = useMatch('/r/:owner/:repo/*');
  const accountMatch = useMatch('/a/:login/*');
  const account = useAccount(accountMatch?.params.login ?? '');
  const { data: auth } = useAuth();
  const owners = useOwners();
  // An account's kind before it's read, so its sidebar shows at once: your own login is a user, and
  // any other owner in your repositories is an organization, as your list holds only yours and your
  // organizations'. Anyone else waits for the account, a placeholder in the meantime.
  const login = accountMatch?.params.login?.toLowerCase();
  const kind =
    account.data?.kind ??
    (!login
      ? undefined
      : login === auth?.viewer?.login.toLowerCase()
        ? 'user'
        : owners.some((o) => o.login.toLowerCase() === login)
          ? 'organization'
          : undefined);
  const orgLogin = kind === 'organization' ? accountMatch?.params.login : undefined;
  const accountPending = Boolean(accountMatch) && !kind && account.isLoading;
  // From a repository, back to its owner's repositories: an organization's own list, or the list
  // filtered to the user, under GitHub's spelling of the login once known.
  const repoOwner = useAccount(repoMatch?.params.owner ?? '');
  const ownerLogin = repoOwner.data?.login ?? repoMatch?.params.owner ?? '';
  const ownerRepositories =
    repoOwner.data?.kind === 'organization'
      ? `/a/${ownerLogin}/repositories`
      : `/repositories?owner=${encodeURIComponent(ownerLogin)}`;
  const location = useLocation();

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [location.pathname]);

  return (
    <AppShell
      header={{ height: 60 }}
      navbar={{ width: 248, breakpoint: 'sm', collapsed: { mobile: !opened } }}
      padding={{ base: 'md', md: 'xl' }}
    >
      {/* Once per computer, after signing in: open GitMetrics like any app next time. */}
      <LaunchOffer />
      <AppShell.Header className="app-header">
        <Group h="100%" px="md" justify="space-between" wrap="nowrap">
          <Group gap="sm" wrap="nowrap">
            <Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" />
            <UnstyledButton component={NavLink} to="/">
              <Group gap={10} wrap="nowrap">
                <Logo />
                <Text fw={700} fz={17} style={{ letterSpacing: -0.3 }}>
                  GitMetrics
                </Text>
              </Group>
            </UnstyledButton>
          </Group>
          <SearchButton />
          <Group gap="sm" wrap="nowrap">
            <ActionIcon
              variant="default"
              size="lg"
              hiddenFrom="sm"
              onClick={() => spotlight.open()}
              aria-label="Search"
            >
              <IconSearch size={18} stroke={1.6} />
            </ActionIcon>
            <ColorSchemeToggle />
            <UserMenu />
          </Group>
        </Group>
      </AppShell.Header>

      {/* No padding on the navbar itself: the scrollbar runs flush along the edge, from the header
          to the footer, and the padding lives inside the scrolled content instead. */}
      <AppShell.Navbar p={0}>
        <AppShell.Section
          grow
          component={ScrollArea}
          scrollbarSize={6}
          type="hover"
          className="navbar-scroll"
        >
          <Box p="sm" pr={14}>
            {repoMatch ? (
              <>
                <NavItemLink
                  to={ownerRepositories}
                  label="All repositories"
                  icon={icon(IconArrowLeft)}
                  onClick={close}
                />
                <Box mt="sm" />
                <RepoNavigation
                  owner={repoMatch.params.owner!}
                  repo={repoMatch.params.repo!}
                  onNavigate={close}
                />
              </>
            ) : orgLogin || accountPending ? (
              <>
                <NavItemLink to="/" label="Home" icon={icon(IconArrowLeft)} onClick={close} />
                <Box mt="sm" />
                {orgLogin ? (
                  <OrgNavigation login={orgLogin} onNavigate={close} />
                ) : (
                  <AccountNavigationLoading />
                )}
              </>
            ) : (
              <MainNavigation onNavigate={close} />
            )}
          </Box>
        </AppShell.Section>
        <AppShell.Section className="navbar-footer">
          <AccountFooter onNavigate={close} />
        </AppShell.Section>
      </AppShell.Navbar>

      <AppShell.Main>
        <Box maw={1280} mx="auto">
          <Outlet />
        </Box>
      </AppShell.Main>
      <RepoSpotlight />
      <UpdatePopup />
    </AppShell>
  );
}
