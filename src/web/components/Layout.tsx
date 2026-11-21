import {
  ActionIcon,
  AppShell,
  Avatar,
  Box,
  Burger,
  Group,
  Kbd,
  Menu,
  Progress,
  NavLink as MantineNavLink,
  ScrollArea,
  Text,
  Tooltip,
  UnstyledButton,
  useComputedColorScheme,
  useMantineColorScheme,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
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
  IconRocket,
  IconSearch,
  IconSettings,
  IconStar,
  IconSun,
  IconTag,
  IconUsers,
  IconCircleDot,
} from '@tabler/icons-react';
import { MarkGithubIcon } from '@primer/octicons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation, useMatch, useNavigate } from 'react-router';
import { post } from '../lib/api';
import { compact, num } from '../lib/format';
import { languageColor } from '../lib/languages';
import { sectionQuery, useAuth, useOwners, useRateLimit, useRepos } from '../lib/queries';
import type { OverviewResponse } from '../../shared/types';
import { PinButton, repoPath } from './repo';
import { Logo } from './ui';

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
  onClick,
}: NavItem & { end?: boolean; right?: ReactNode; active?: boolean; onClick?: () => void }) {
  return (
    <NavLink to={to} end={end} style={{ textDecoration: 'none', color: 'inherit' }} onClick={onClick}>
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

function GroupLabel({ children }: { children: ReactNode }) {
  return (
    <Text size="xs" fw={600} c="dimmed" tt="uppercase" px="sm" mt="lg" mb={6} style={{ letterSpacing: 0.6 }}>
      {children}
    </Text>
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
        <Avatar src={summary?.ownerAvatarUrl ?? `https://github.com/${owner}.png`} size={34} radius="md" />
        <Box miw={0} style={{ flex: 1 }}>
          <Text fw={600} size="sm" truncate>
            {repo}
          </Text>
          <Text size="xs" c="dimmed" truncate>
            {owner}
          </Text>
        </Box>
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

const Count = ({ children }: { children: ReactNode }) => (
  <Text size="xs" c="dimmed" className="tabular">
    {children}
  </Text>
);

function MainNavigation({ onNavigate }: { onNavigate: () => void }) {
  const { data } = useRepos();
  const owners = useOwners();
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const onRepositories = location.pathname === '/repositories';
  const pinned = (data?.repos ?? []).filter((r) => data?.favorites.includes(r.fullName));

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

      <GroupLabel>Pinned</GroupLabel>
      {pinned.length ? (
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

      {owners.length > 1 && (
        <>
          <GroupLabel>Accounts</GroupLabel>
          {owners.map((o) => (
            <NavItemLink
              key={o.login}
              to={`/repositories?owner=${encodeURIComponent(o.login)}`}
              label={o.login}
              icon={<Avatar src={o.avatarUrl} size={18} radius="sm" />}
              active={onRepositories && params.get('owner') === o.login}
              right={<Count>{o.count}</Count>}
              onClick={onNavigate}
            />
          ))}
        </>
      )}
    </>
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
        <Text size="sm" c="dimmed" style={{ flex: 1 }}>
          Search repositories
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

function RepoSpotlight() {
  const { data } = useRepos();
  const navigate = useNavigate();
  const actions: SpotlightActionData[] = [
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
    ...(data?.repos ?? []).map((r) => ({
      id: r.fullName,
      label: r.fullName,
      description: r.description ?? undefined,
      keywords: [r.name, r.language ?? '', ...r.topics],
      leftSection: <Avatar src={r.ownerAvatarUrl} size={26} radius="md" />,
      rightSection: (
        <Group gap={4} wrap="nowrap">
          <IconStar size={14} stroke={1.6} />
          <Text size="xs">{r.stars}</Text>
        </Group>
      ),
      onClick: () => navigate(repoPath(r)),
    })),
  ];
  return (
    <Spotlight
      actions={actions}
      nothingFound="No repository matches your search"
      highlightQuery
      limit={8}
      shortcut={['mod + K', '/']}
      searchProps={{
        leftSection: <IconSearch size={18} stroke={1.5} />,
        placeholder: 'Jump to a repository…',
      }}
    />
  );
}

export function Layout() {
  const [opened, { toggle, close }] = useDisclosure();
  const repoMatch = useMatch('/r/:owner/:repo/*');
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
                  to="/repositories"
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
    </AppShell>
  );
}
