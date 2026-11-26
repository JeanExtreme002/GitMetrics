import { DonutChart } from '@mantine/charts';
import {
  ActionIcon,
  Anchor,
  Avatar,
  Badge,
  Box,
  Button,
  Grid,
  Group,
  SimpleGrid,
  Skeleton,
  Text,
  Title,
  Tooltip,
} from '@mantine/core';
import { MarkGithubIcon } from '@primer/octicons-react';
import {
  IconArrowRight,
  IconBook2,
  IconBrandX,
  IconBuilding,
  IconCalendar,
  IconGitFork,
  IconLink,
  IconMapPin,
  IconRosetteDiscountCheck,
  IconStar,
  IconUsers,
} from '@tabler/icons-react';
import { useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import type { AccountResponse, AccountTotals } from '../../shared/types';
import { LanguagesDonut, SectionTitle } from '../components/overview';
import { RepoCard, repoPath } from '../components/repo';
import { EmptyState, ErrorState, MiniStat, PageSkeleton, RefreshButton } from '../components/ui';
import { ApiError, api } from '../lib/api';
import { compact, date, num, percent } from '../lib/format';
import { accountKey, useAccount, useAccountTotals, useAuth } from '../lib/queries';

/** A theme color (like blue.5) as a CSS value. */
const cssColor = (color: string) => `var(--mantine-color-${color.replace('.', '-')})`;

/** A website as people write it: no scheme, no trailing slash. */
const site = (url: string) => url.replace(/^https?:\/\//i, '').replace(/\/$/, '');
const href = (url: string) => (/^https?:\/\//i.test(url) ? url : `https://${url}`);

/** One fact under the bio, with its icon. */
function Fact({ icon: Icon, children }: { icon: typeof IconMapPin; children: ReactNode }) {
  return (
    <Group gap={5} wrap="nowrap" miw={0}>
      <Icon size={15} stroke={1.7} style={{ flex: 'none' }} />
      <Text size="sm" c="dimmed" truncate>
        {children}
      </Text>
    </Group>
  );
}

/** The numbers beside the name, as on the home page. */
function Stats({ account, totals }: { account: AccountResponse; totals: AccountTotals | null | undefined }) {
  const user = account.kind === 'user';
  return (
    <Group gap={0} wrap="nowrap" className="mini-stats">
      {user ? (
        <MiniStat
          label="Followers"
          icon={IconUsers}
          value={compact(account.followers)}
          hint={`Following ${num(account.following)}`}
        />
      ) : (
        <MiniStat
          label="Members"
          icon={IconUsers}
          value={compact(account.members)}
          hint="Members your account can see"
        />
      )}
      <MiniStat
        label="Repositories"
        icon={IconBook2}
        value={num(account.repositories.total)}
        hint={`${num(account.repositories.sources)} of its own, ${num(account.repositories.forks)} forks`}
      />
      {/* Added up over every repository: left out when there are too many to add up exactly. */}
      {totals !== null && (
        <>
          <MiniStat
            label="Stars"
            icon={IconStar}
            value={totals ? compact(totals.stars) : '…'}
            hint="Across the repositories it owns"
          />
          <MiniStat
            label="Forks"
            icon={IconGitFork}
            value={totals ? compact(totals.forks) : '…'}
            hint="People building on its work"
          />
        </>
      )}
    </Group>
  );
}

/**
 * What it owns, at a glance: a donut of its own repositories and forks (together, all of them),
 * then how many are archived and private, as bars of the whole (either can be its own or a fork).
 */
function Owns({ account }: { account: AccountResponse }) {
  const r = account.repositories;
  const [active, setActive] = useState<string | null>(null);
  const slices = [
    { name: 'Of its own', value: r.sources, color: 'blue.5', hint: 'Repositories that are not forks' },
    { name: 'Forks', value: r.forks, color: 'grape.4', hint: 'Copies of other repositories' },
  ];
  const share = (value: number) => (r.total ? value / r.total : 0);
  const bars = [
    { name: 'Archived', value: r.archived, color: 'yellow.6', hint: 'Read-only, kept for reference' },
    ...(r.private
      ? [{ name: 'Private', value: r.private, color: 'gray.5', hint: 'Visible to you through your access' }]
      : []),
  ];
  return (
    <Box>
      <SectionTitle title="What it owns" caption={`Its ${num(r.total)} repositories`} />
      <Group gap="lg" wrap="nowrap" align="center">
        <Box className="donut">
          <DonutChart
            data={slices.map((s) => ({
              name: s.name,
              value: s.value,
              color: active && active !== s.name ? 'var(--mantine-color-default-border)' : s.color,
            }))}
            size={120}
            thickness={11}
            paddingAngle={r.sources && r.forks ? 3 : 0}
            startAngle={90}
            endAngle={-270}
            pieProps={{ cornerRadius: 2, isAnimationActive: false }}
            strokeWidth={0}
            tooltipDataSource="segment"
            valueFormatter={(v) => `${num(v)} repositories`}
          />
          <div className="donut-label">
            <Text fz={22} fw={600} lh={1} className="tabular">
              {compact(r.total)}
            </Text>
            <Text size="xs" c="dimmed" mt={3}>
              in all
            </Text>
          </div>
        </Box>
        <div className="rank-list" style={{ flex: 1, minWidth: 0 }}>
          {slices.map((s) => (
            <Tooltip key={s.name} label={s.hint} position="top-start">
              <div
                className="legend-row"
                onMouseEnter={() => setActive(s.name)}
                onMouseLeave={() => setActive(null)}
              >
                <span className="lang-dot" style={{ background: cssColor(s.color), margin: 0 }} />
                <Text size="sm" truncate>
                  {s.name}
                </Text>
                <Text size="sm" ta="right" className="tabular">
                  <Text component="span" inherit fw={600}>
                    {num(s.value)}
                  </Text>{' '}
                  <Text component="span" inherit c="dimmed">
                    {percent(share(s.value))}
                  </Text>
                </Text>
              </div>
            </Tooltip>
          ))}
        </div>
      </Group>
      {/* Archived and private cut across both, so each is a bar of the whole instead of a slice. */}
      <Box mt="lg">
        {bars.map((b) => (
          <Tooltip key={b.name} label={b.hint} position="top-start">
            <Box className="owns-bar">
              <Group justify="space-between" wrap="nowrap">
                <Text size="sm">{b.name}</Text>
                <Text size="sm" ta="right" className="tabular">
                  <Text component="span" inherit fw={600}>
                    {num(b.value)}
                  </Text>{' '}
                  <Text component="span" inherit c="dimmed">
                    {percent(share(b.value))}
                  </Text>
                </Text>
              </Group>
              <div className="rank-track">
                <div
                  className="rank-fill"
                  style={{ width: `${share(b.value) * 100}%`, background: cssColor(b.color) }}
                />
              </div>
            </Box>
          </Tooltip>
        ))}
      </Box>
    </Box>
  );
}

/** The organizations a user shows publicly, each opening its own page. */
function Organizations({ account }: { account: AccountResponse }) {
  if (!account.organizations.length) return null;
  return (
    <Box mt={36}>
      <SectionTitle title="Organizations" caption="The ones it shows on its profile" />
      <div className="rank-list">
        {account.organizations.map((o) => (
          <Anchor
            key={o.login}
            component={Link}
            to={`/a/${o.login}`}
            underline="never"
            c="inherit"
            className="account-row account-link"
          >
            <Group gap={10} wrap="nowrap" miw={0}>
              <Avatar src={o.avatarUrl} size={22} radius="sm" />
              <Text size="sm" truncate>
                {o.login}
              </Text>
            </Group>
            <IconArrowRight size={14} stroke={1.7} color="var(--mantine-color-dimmed)" />
          </Anchor>
        ))}
      </div>
    </Box>
  );
}

function Languages({
  account,
  totals,
}: {
  account: AccountResponse;
  totals: AccountTotals | null | undefined;
}) {
  if (totals === undefined) {
    return (
      <Box>
        <SectionTitle title="Languages" caption="Adding up its repositories…" />
        <Group gap="xl" wrap="nowrap" align="center">
          <Skeleton circle h={176} w={176} style={{ flex: 'none' }} />
          <Box style={{ flex: 1 }}>
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} h={12} my={14} w={`${80 - i * 10}%`} />
            ))}
          </Box>
        </Group>
      </Box>
    );
  }
  if (!totals) {
    return (
      <Box>
        <SectionTitle title="Languages" />
        <Text size="sm" c="dimmed">
          It owns more repositories than can be added up exactly, so its languages are left out.
        </Text>
      </Box>
    );
  }
  const counted = totals.languages.reduce((sum, l) => sum + l.count, 0);
  if (!counted) {
    return (
      <Box>
        <SectionTitle title="Languages" />
        <Text size="sm" c="dimmed">
          None of its repositories has code in a known language.
        </Text>
      </Box>
    );
  }
  return (
    <LanguagesDonut
      title="Languages"
      caption={`${num(counted)} of its ${num(account.repositories.sources)} repositories, leaving out forks and those without code`}
      counts={totals.languages.map((l) => [l.name, l.count])}
    />
  );
}

/**
 * A user's or an organization's page, read the way the home page reads: who it is and its numbers,
 * its repositories in GitHub's order and its most starred, then its languages and how its repositories
 * split up. Its repositories open in the Repositories page.
 */
export function Account() {
  const { login = '' } = useParams();
  const query = useAccount(login);
  const totals = useAccountTotals(login);
  const { data: auth } = useAuth();
  const client = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);

  if (query.isLoading) return <PageSkeleton />;
  if (query.error instanceof ApiError && query.error.status === 404) {
    return (
      <EmptyState
        icon={<IconUsers size={28} />}
        title="No account with this name"
        description={`GitHub has no user or organization called ${login}.`}
      />
    );
  }
  if (query.error || !query.data) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;

  const account = query.data;
  const user = account.kind === 'user';
  // Undefined while adding up, null when there are too many repositories (or it failed).
  const sums = totals.isError ? null : totals.data === undefined ? undefined : totals.data.totals;
  const own = account.login.toLowerCase() === auth?.viewer?.login.toLowerCase();

  const refresh = async () => {
    setRefreshing(true);
    try {
      const [fresh, freshTotals] = await Promise.all([
        api<AccountResponse>(`/accounts/${login}?refresh=1`),
        api<{ totals: AccountTotals | null }>(`/accounts/${login}/totals?refresh=1`),
      ]);
      client.setQueryData(accountKey(login), fresh);
      client.setQueryData(['account-totals', login.toLowerCase()], freshTotals);
    } finally {
      setRefreshing(false);
    }
  };

  const facts: ReactNode[] = [
    account.company && (
      <Fact key="company" icon={IconBuilding}>
        {account.company}
      </Fact>
    ),
    account.location && (
      <Fact key="location" icon={IconMapPin}>
        {account.location}
      </Fact>
    ),
    account.websiteUrl && (
      <Fact key="site" icon={IconLink}>
        <Anchor href={href(account.websiteUrl)} target="_blank" rel="noreferrer" inherit c="dimmed">
          {site(account.websiteUrl)}
        </Anchor>
      </Fact>
    ),
    account.twitter && (
      <Fact key="x" icon={IconBrandX}>
        <Anchor href={`https://x.com/${account.twitter}`} target="_blank" rel="noreferrer" inherit c="dimmed">
          @{account.twitter}
        </Anchor>
      </Fact>
    ),
    <Fact key="joined" icon={IconCalendar}>
      On GitHub since {date(account.createdAt)}
    </Fact>,
  ].filter(Boolean);

  return (
    <>
      {/* Who it is on the left, its numbers and actions on the right, as on the home page. */}
      <Group justify="space-between" align="center" gap="xl">
        <Group gap="lg" wrap="nowrap" align="center" miw={0} style={{ flex: '1 1 320px' }}>
          <Avatar src={account.avatarUrl} size={64} radius={user ? 'xl' : 'md'} />
          <Box miw={0} style={{ flex: 1 }}>
            <Group gap={8} wrap="wrap" align="center">
              <Title order={1} fz={30} fw={650} lts={-0.5}>
                {account.name ?? account.login}
              </Title>
              {account.verified && (
                <Tooltip label="GitHub verified this organization's domain">
                  <IconRosetteDiscountCheck size={22} stroke={1.8} color="var(--mantine-color-blue-5)" />
                </Tooltip>
              )}
            </Group>
            <Group gap={8} mt={2} wrap="wrap">
              <Text c="dimmed">{account.login}</Text>
              <Badge variant="light" color="gray" tt="none" radius="sm">
                {own ? 'You' : user ? 'User' : 'Organization'}
              </Badge>
            </Group>
          </Box>
        </Group>
        <Group gap="xl" wrap="wrap" align="center" justify="flex-end">
          <Stats account={account} totals={sums} />
          <Group gap="xs" wrap="nowrap">
            <Tooltip label="Open on GitHub">
              <ActionIcon
                component="a"
                href={account.url}
                target="_blank"
                rel="noreferrer"
                variant="default"
                size={36}
                aria-label="Open on GitHub"
              >
                <MarkGithubIcon size={16} />
              </ActionIcon>
            </Tooltip>
            <RefreshButton onRefresh={refresh} refreshing={refreshing} />
          </Group>
        </Group>
      </Group>
      {/* The bio and the facts under the name, across the page's width, so they don't wrap early. */}
      <Box pl={{ base: 0, sm: 84 }} mt={12} mb={36}>
        {account.bio && (
          <Text size="sm" maw={720}>
            {account.bio}
          </Text>
        )}
        <Group gap="lg" mt={10} wrap="wrap">
          {facts}
        </Group>
      </Box>

      <Grid gap="md">
        <Grid.Col span={{ base: 12, lg: 8 }}>
          <SectionTitle
            title="Repositories"
            action={
              <Button
                component={Link}
                to={`/repositories?owner=${encodeURIComponent(account.login)}`}
                variant="subtle"
                size="compact-sm"
                rightSection={<IconArrowRight size={14} />}
              >
                All {num(account.repositories.total)} repositories
              </Button>
            }
          />
          {account.repos.length ? (
            <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
              {account.repos.slice(0, 4).map((repo) => (
                <RepoCard key={repo.id} repo={repo} />
              ))}
            </SimpleGrid>
          ) : (
            <EmptyState icon={<IconBook2 size={28} />} title="No repositories yet" />
          )}
        </Grid.Col>
        <Grid.Col span={{ base: 12, lg: 4 }}>
          <Owns account={account} />
        </Grid.Col>
      </Grid>

      <Grid gap="md" mt="xl">
        <Grid.Col span={{ base: 12, md: 7 }} pr={{ md: 'xl' }}>
          <Languages account={account} totals={sums} />
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 5 }} pl={{ md: 'xl' }} className="split-col">
          {/* Its most starred, each opening its Stars page, as the home page's ranking does. */}
          <SectionTitle title="Most starred" />
          {account.top.length ? (
            <div className="rank-list">
              {account.top.map((repo) => (
                <Anchor
                  key={repo.id}
                  component={Link}
                  to={`${repoPath(repo)}/stars`}
                  underline="never"
                  c="inherit"
                  className="account-row account-link"
                >
                  <Text size="sm" fw={500} truncate>
                    {repo.name}
                  </Text>
                  <Group gap={5} wrap="nowrap" style={{ flex: 'none' }}>
                    <IconStar size={14} stroke={1.8} color="var(--mantine-color-yellow-6)" />
                    <Text size="sm" fw={600} className="tabular">
                      {compact(repo.stars)}
                    </Text>
                  </Group>
                </Anchor>
              ))}
            </div>
          ) : (
            <Text size="sm" c="dimmed" py="md">
              None of its repositories has a star yet.
            </Text>
          )}
          <Organizations account={account} />
        </Grid.Col>
      </Grid>
    </>
  );
}
