import {
  Anchor,
  Avatar,
  Box,
  Button,
  Grid,
  SegmentedControl,
  Skeleton,
  Group,
  SimpleGrid,
  Text,
  Title,
  Tooltip,
} from '@mantine/core';
import { IconArrowRight, IconBook2, IconGitFork, IconStar, IconUsers } from '@tabler/icons-react';
import { useLocalStorage } from '@mantine/hooks';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';
import { Link } from 'react-router';
import type { RankingEntry, RankingResponse, RepoSummary } from '../../shared/types';
import { api } from '../lib/api';
import { LanguagesDonut, RecentActivity, SectionTitle } from '../components/overview';
import { RepoCard } from '../components/repo';
import { EmptyState, ErrorState, MiniStat, PageSkeleton } from '../components/ui';
import { compact, num, percent } from '../lib/format';
import { useAuth, useRepos } from '../lib/queries';

function greeting() {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 12) return 'Good morning';
  if (hour >= 12 && hour < 18) return 'Good afternoon';
  return 'Good evening';
}

type TopMode = 'stars' | 'activity' | 'traffic';

const TOP_MODES: Record<TopMode, { caption: string; page: string; fill: string; secondary: string }> = {
  stars: {
    caption: 'Your original repositories with the most stars',
    page: 'stars',
    fill: 'var(--mantine-color-yellow-6)',
    secondary: 'Share of all your stars',
  },
  activity: {
    caption: 'Commits on the default branch in the last 90 days',
    page: 'commits',
    fill: 'var(--mantine-color-teal-6)',
    secondary: 'Share of all your recent commits',
  },
  traffic: {
    caption: 'Unique visitors in the last 14 days, with total page views on the right',
    page: 'traffic',
    fill: 'var(--mantine-color-indigo-4)',
    secondary: 'Total page views in the last 14 days',
  },
};

const rankingQuery = (mode: 'activity' | 'traffic') => ({
  queryKey: ['ranking', mode],
  queryFn: () => api<RankingResponse>(`/rankings/${mode}`),
  staleTime: 10 * 60_000,
});

/**
 * A leaderboard of your repositories, ranked by stars, recent commits or traffic.
 * Stars come with the repository list; the other two are fetched when first needed.
 */
function TopRepositories({ repos }: { repos: RepoSummary[] }) {
  const [mode, setMode] = useLocalStorage<TopMode>({ key: 'gitmetrics:top-mode', defaultValue: 'stars' });
  const ranking = useQuery({
    ...rankingQuery(mode === 'stars' ? 'activity' : mode),
    enabled: mode !== 'stars',
  });
  const config = TOP_MODES[mode];

  const entries: RankingEntry[] =
    mode === 'stars'
      ? repos
          .map((r) => ({ fullName: r.fullName, name: r.name, value: r.stars, secondary: null }))
          .filter((e) => e.value > 0)
      : (ranking.data?.entries ?? []);
  const top = entries.slice(0, 6);
  const total = entries.reduce((s, e) => s + e.value, 0);
  const max = Math.max(1, top[0]?.value ?? 1);
  const loading = mode !== 'stars' && ranking.isLoading;

  return (
    <Box>
      <SectionTitle
        title="Top repositories"
        caption={config.caption}
        action={
          <SegmentedControl
            size="xs"
            value={mode}
            onChange={(v) => setMode(v as TopMode)}
            data={[
              { label: 'Stars', value: 'stars' },
              { label: 'Activity', value: 'activity' },
              { label: 'Traffic', value: 'traffic' },
            ]}
          />
        }
      />
      <div className="rank-list">
        {loading &&
          Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="rank-row">
              <Skeleton h={10} w={16} />
              <Skeleton h={12} w={`${70 - i * 6}%`} />
              <Skeleton h={4} />
              <Skeleton h={12} />
              <Skeleton h={10} />
            </div>
          ))}
        {!loading && ranking.error && mode !== 'stars' && (
          <Text size="sm" c="dimmed" py="md">
            Could not load this ranking.{' '}
            <Anchor component="button" size="sm" onClick={() => ranking.refetch()}>
              Try again
            </Anchor>
          </Text>
        )}
        {!loading && !ranking.error && top.length === 0 && (
          <Text size="sm" c="dimmed" py="md">
            Nothing to rank here yet.
          </Text>
        )}
        {!loading &&
          top.map((e, i) => (
            <Anchor
              key={e.fullName}
              component={Link}
              to={`/r/${e.fullName}/${config.page}`}
              underline="never"
              c="inherit"
              className="rank-row"
            >
              <Text size="xs" c="dimmed" className="tabular rank-pos">
                {String(i + 1).padStart(2, '0')}
              </Text>
              <Text size="sm" fw={500} truncate className="rank-name">
                {e.name}
              </Text>
              <div className="rank-track">
                <div
                  className="rank-fill"
                  style={{ width: `${(e.value / max) * 100}%`, background: config.fill }}
                />
              </div>
              <Text size="sm" fw={600} ta="right" className="tabular">
                {num(e.value)}
              </Text>
              <Tooltip label={config.secondary}>
                <Text size="xs" c="dimmed" ta="right" className="tabular">
                  {mode === 'traffic'
                    ? `${num(e.secondary ?? 0)} views`
                    : percent(total ? e.value / total : 0)}
                </Text>
              </Tooltip>
            </Anchor>
          ))}
      </div>
    </Box>
  );
}

/** Your repositories by primary language. */
function Languages({ repos, owned }: { repos: RepoSummary[]; owned: number }) {
  const counts = new Map<string, number>();
  for (const r of repos) if (r.language) counts.set(r.language, (counts.get(r.language) ?? 0) + 1);
  const total = [...counts.values()].reduce((sum, c) => sum + c, 0);
  return (
    <LanguagesDonut
      title="Languages you build with"
      caption={`${total} of your ${owned} repositories, leaving out forks and those without code`}
      counts={[...counts.entries()]}
    />
  );
}

export function Home() {
  const { data: auth } = useAuth();
  const repos = useRepos();
  const client = useQueryClient();
  const viewer = auth?.viewer;

  // Activity is a single GraphQL call, so warm it up in the background.
  useEffect(() => {
    void client.prefetchQuery(rankingQuery('activity'));
  }, [client]);
  const login = viewer?.login.toLowerCase() ?? '';

  const all = useMemo(() => repos.data?.repos ?? [], [repos.data]);
  const mine = useMemo(() => all.filter((r) => r.owner.toLowerCase() === login), [all, login]);
  const sources = useMemo(() => mine.filter((r) => !r.fork).sort((a, b) => b.stars - a.stars), [mine]);

  if (repos.isLoading) return <PageSkeleton />;
  if (repos.error || !repos.data) return <ErrorState error={repos.error} onRetry={() => repos.refetch()} />;

  // Always four cards: pinned repositories first, then your most starred ones fill the rest, so a
  // single pin never leaves the grid (and the activity column next to it) half empty.
  const pinned = all.filter((r) => repos.data.favorites.includes(r.fullName));
  const highlighted = [...pinned, ...sources.filter((r) => !pinned.includes(r))].slice(0, 4);
  const title = !pinned.length
    ? 'Your top repositories'
    : pinned.length >= highlighted.length
      ? 'Pinned'
      : 'Pinned and top repositories';

  return (
    <>
      <Group justify="space-between" align="center" mb={32} gap="xl">
        <Group gap="lg" wrap="nowrap">
          <Avatar src={viewer?.avatarUrl} size={64} radius="xl" />
          <Box>
            <Title order={1} fz={30} fw={650} lts={-0.5}>
              {greeting()}, {viewer?.name?.split(' ')[0] ?? viewer?.login}
            </Title>
            <Text c="dimmed" mt={2}>
              Here is how your projects are doing today.
            </Text>
          </Box>
        </Group>
        <Group gap={0} wrap="nowrap" className="mini-stats">
          <MiniStat
            label="Followers"
            icon={IconUsers}
            value={num(viewer?.followers)}
            hint={`Following ${num(viewer?.following)}`}
          />
          <MiniStat
            label="Repositories"
            icon={IconBook2}
            value={num(mine.length)}
            hint={`${num(all.length - mine.length)} more in your organizations`}
          />
          <MiniStat
            label="Stars"
            icon={IconStar}
            value={compact(mine.reduce((s, r) => s + r.stars, 0))}
            hint="Across the repositories you own"
          />
          <MiniStat
            label="Forks"
            icon={IconGitFork}
            value={compact(mine.reduce((s, r) => s + r.forks, 0))}
            hint="People building on your work"
          />
        </Group>
      </Group>

      <Grid gap="md">
        <Grid.Col span={{ base: 12, lg: 8 }}>
          <SectionTitle
            title={title}
            action={
              <Button
                component={Link}
                to="/repositories"
                variant="subtle"
                size="compact-sm"
                rightSection={<IconArrowRight size={14} />}
              >
                All {num(all.length)} repositories
              </Button>
            }
          />
          {highlighted.length ? (
            <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
              {highlighted.map((repo) => (
                <RepoCard key={repo.id} repo={repo} showOwner={repo.owner.toLowerCase() !== login} />
              ))}
            </SimpleGrid>
          ) : (
            <EmptyState icon={<IconBook2 size={28} />} title="No repositories yet" />
          )}
        </Grid.Col>
        <Grid.Col span={{ base: 12, lg: 4 }}>
          <Box className="activity-col">
            <SectionTitle title="Recent activity" />
            <Box className="activity-body">
              <RecentActivity repos={mine} />
            </Box>
          </Box>
        </Grid.Col>
      </Grid>

      <Grid gap="md" mt="xl">
        <Grid.Col span={{ base: 12, md: 7 }} pr={{ md: 'xl' }}>
          <TopRepositories repos={sources} />
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 5 }} pl={{ md: 'xl' }} className="split-col">
          <Languages repos={sources} owned={mine.length} />
        </Grid.Col>
      </Grid>
    </>
  );
}
