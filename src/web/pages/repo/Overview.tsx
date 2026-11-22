import { AreaChart, BarChart } from '@mantine/charts';
import {
  ActionIcon,
  Anchor,
  Avatar,
  Badge,
  Box,
  Button,
  Grid,
  Group,
  Progress,
  SegmentedControl,
  Text,
  Title,
  Tooltip,
} from '@mantine/core';
import { useLocalStorage } from '@mantine/hooks';
import { MarkGithubIcon } from '@primer/octicons-react';
import {
  IconArchive,
  IconArrowRight,
  IconBook2,
  IconCalendar,
  IconCheck,
  IconEye,
  IconGitCommit,
  IconGitFork,
  IconHistory,
  IconLink,
  IconLock,
  IconMinus,
  IconScale,
  IconStar,
  IconUsers,
  IconWorld,
  type Icon,
} from '@tabler/icons-react';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import type { CommitsResponse, OverviewResponse, StarsResponse } from '../../../shared/types';
import { Counter, NoData, QueryView, RefreshButton } from '../../components/ui';
import {
  cleanText,
  compact,
  date,
  dayLabel,
  num,
  percent,
  relative,
  resampleCumulative,
  timeTick,
} from '../../lib/format';
import { languageColor } from '../../lib/languages';
import { useRepoParams, useSection } from '../../lib/queries';
import { semantic } from '../../theme';

type Growth = 'stars' | 'commits';

/** "https://docs.example.com/en/latest/" → "docs.example.com" */
function hostname(url: string) {
  try {
    return new URL(url.includes('://') ? url : `https://${url}`).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function DetailsLink({ to, label = 'Details' }: { to: string; label?: string }) {
  const { owner, repo } = useRepoParams();
  return (
    <Button
      component={Link}
      to={`/r/${owner}/${repo}/${to}`}
      variant="subtle"
      size="compact-sm"
      rightSection={<IconArrowRight size={14} />}
    >
      {label}
    </Button>
  );
}

/** One small fact about the repository, with an icon, quieter than the description above it. */
function Meta({ icon: Icon, children }: { icon: Icon; children: ReactNode }) {
  return (
    <Group gap={6} wrap="nowrap" className="repo-meta-item">
      <Icon size={15} stroke={1.7} />
      <Text size="xs" component="span">
        {children}
      </Text>
    </Group>
  );
}

const HINTS: Record<string, string> = {
  stars: 'People who starred this repository',
  forks: 'Copies people made to build on it',
  watchers: 'People notified about its activity',
  contributors: 'People who committed to this repository',
};

function RepoCounter({ icon, value, label }: { icon: Icon; value: number; label: string }) {
  const text = (value === 1 ? label.replace(/s$/, '') : label).replace(/^./, (c) => c.toUpperCase());
  return <Counter icon={icon} value={compact(value)} label={text} hint={HINTS[label]} />;
}

/** A quiet rounded label next to the title, like GitHub's Public / Private marker. */
function Pill({ icon: Icon, tone, children }: { icon: Icon; tone?: 'yellow'; children: ReactNode }) {
  return (
    <span className={`repo-pill${tone ? ` repo-pill-${tone}` : ''}`}>
      <Icon size={13} stroke={1.8} />
      {children}
    </span>
  );
}

function Counters({
  repo,
  contributors,
  spread = false,
}: {
  repo: OverviewResponse['repo'];
  contributors: number | null;
  spread?: boolean;
}) {
  return (
    <Group
      gap="xl"
      wrap="wrap"
      justify={spread ? 'space-between' : 'flex-start'}
      style={{ rowGap: 'var(--mantine-spacing-md)' }}
    >
      <RepoCounter icon={IconStar} value={repo.stars} label="stars" />
      <RepoCounter icon={IconGitFork} value={repo.forks} label="forks" />
      <RepoCounter icon={IconEye} value={repo.subscribers} label="watchers" />
      {contributors !== null && <RepoCounter icon={IconUsers} value={contributors} label="contributors" />}
    </Group>
  );
}

/** Star growth and commit activity behind one switch, drawn straight on the page. */
function GrowthChart() {
  const [saved, setSaved] = useLocalStorage<Growth>({
    key: 'gitmetrics:overview-chart',
    defaultValue: 'stars',
  });
  const stars = useSection<StarsResponse>('stars');
  const commits = useSection<CommitsResponse>('commits');
  const { fullName } = useRepoParams();
  // A switch clicked on this repository wins. Otherwise the saved choice, except that a
  // repository whose star history GitHub hides opens on commits, without changing the saved choice.
  const [picked, setPicked] = useState<{ repo: string; view: Growth } | null>(null);
  const view =
    picked?.repo === fullName
      ? picked.view
      : saved === 'stars' && stars.data?.historyHidden
        ? 'commits'
        : saved;

  let chart: ReactNode;
  if (view === 'stars') {
    const data = stars.data;
    chart =
      data && !data.historyHidden && data.points.length ? (
        <AreaChart
          h={260}
          data={resampleCumulative(data.points, 'stars', undefined, 120)}
          dataKey="date"
          series={[{ name: 'value', label: 'Stars', color: semantic.stars }]}
          curveType="monotone"
          withDots={false}
          gridAxis="y"
          xAxisProps={{
            tickFormatter: timeTick((Date.now() - new Date(data.points[0]!.date).getTime()) / 86_400_000),
            minTickGap: 40,
          }}
          valueFormatter={num}
        />
      ) : (
        <NoData>
          {data?.historyHidden
            ? 'GitHub only shares the star history with people who can push to this repository.'
            : data
              ? 'No stars yet.'
              : stars.isError
                ? "Couldn't load the star history."
                : 'Loading…'}
        </NoData>
      );
  } else {
    const data = commits.data;
    chart =
      data && !data.pending && data.weekly.length ? (
        <BarChart
          h={260}
          data={data.weekly}
          dataKey="week"
          series={[{ name: 'commits', label: 'Commits', color: semantic.commits }]}
          gridAxis="y"
          xAxisProps={{ tickFormatter: dayLabel, minTickGap: 40 }}
          barProps={{ radius: [3, 3, 0, 0] }}
        />
      ) : (
        <NoData>
          {data
            ? 'GitHub is still computing commit statistics.'
            : commits.isError
              ? "Couldn't load the commit activity."
              : 'Loading…'}
        </NoData>
      );
  }

  return (
    <Box>
      <Group justify="space-between" mb="lg" gap="sm">
        <Box>
          <Text fw={600}>{view === 'stars' ? 'Star growth' : 'Commit activity'}</Text>
          <Text size="sm" c="dimmed" mt={2}>
            {view === 'stars' ? 'Total stars over time' : 'Commits per week over the last year'}
          </Text>
        </Box>
        <Group gap="xs">
          <SegmentedControl
            size="xs"
            value={view}
            onChange={(v) => {
              setPicked({ repo: fullName, view: v as Growth });
              setSaved(v as Growth);
            }}
            data={[
              { label: 'Stars', value: 'stars' },
              { label: 'Commits', value: 'commits' },
            ]}
          />
          <DetailsLink to={view} />
        </Group>
      </Group>
      {chart}
    </Box>
  );
}

/** A section of the right-hand column: no frame, just a title and a hairline below. */
function Side({ title, right, children }: { title: string; right?: ReactNode; children: ReactNode }) {
  return (
    <Box className="side-section">
      <Group justify="space-between" mb="sm" mih={26}>
        <Text fw={600} size="sm">
          {title}
        </Text>
        {right}
      </Group>
      {children}
    </Box>
  );
}

/** The latest commits on the default branch, as quiet hairline rows under the chart. */
function LatestCommits() {
  const { data } = useSection<CommitsResponse>('commits');
  if (!data?.recent.length) return null;
  return (
    <Box mt={36}>
      <Group justify="space-between" mb="sm">
        <Text fw={600} size="sm">
          Latest commits
        </Text>
        <DetailsLink to="commits" label="All" />
      </Group>
      <div className="rank-list">
        {data.recent.slice(0, 7).map((c) => (
          <Anchor
            key={c.sha}
            href={c.url}
            target="_blank"
            underline="never"
            c="inherit"
            className="commit-row"
          >
            <Avatar src={c.avatarUrl} size={22} radius="xl" />
            <Text size="sm" truncate>
              {c.message}
            </Text>
            <Text size="xs" c="dimmed" truncate>
              {c.author}
            </Text>
            <Text size="xs" c="dimmed" ta="right" style={{ whiteSpace: 'nowrap' }}>
              {relative(c.date)}
            </Text>
          </Anchor>
        ))}
      </div>
    </Box>
  );
}

function Languages({ languages }: { languages: OverviewResponse['languages'] }) {
  if (!languages.length) {
    return (
      <Text size="sm" c="dimmed">
        No code detected.
      </Text>
    );
  }
  const top = languages.slice(0, 5);
  const rest = languages.slice(5).reduce((s, l) => s + l.share, 0);
  const items = [
    ...top.map((l) => ({ name: l.name, share: l.share })),
    ...(rest ? [{ name: 'Other', share: rest }] : []),
  ];
  const color = (name: string) => (name === 'Other' ? '#8c959f' : languageColor(name));
  return (
    <>
      <Progress.Root size={8} radius="xl">
        {items.map((l) => (
          <Tooltip key={l.name} label={`${l.name} ${percent(l.share, 1)}`}>
            <Progress.Section value={l.share * 100} color={color(l.name)} />
          </Tooltip>
        ))}
      </Progress.Root>
      <Box mt="sm">
        {items.map((l) => (
          <Group key={l.name} gap={8} wrap="nowrap" py={5}>
            <span className="lang-dot" style={{ background: color(l.name), margin: 0 }} />
            <Text size="sm" truncate>
              {l.name}
            </Text>
            <Text size="sm" c="dimmed" ml="auto" className="tabular">
              {percent(l.share, 1)}
            </Text>
          </Group>
        ))}
      </Box>
    </>
  );
}

function Health({ health }: { health: NonNullable<OverviewResponse['health']> }) {
  return (
    <Box>
      {health.files.map((f) => (
        <Group key={f.name} gap={8} wrap="nowrap" py={5} c={f.present ? undefined : 'dimmed'}>
          {f.present ? (
            <IconCheck size={16} stroke={2} color="var(--mantine-color-green-6)" />
          ) : (
            <IconMinus size={16} stroke={2} />
          )}
          <Text size="sm">{f.name}</Text>
        </Group>
      ))}
    </Box>
  );
}

export function Overview() {
  const query = useSection<OverviewResponse>('overview');
  return (
    <QueryView query={query}>
      {({ repo, totals, languages, health, latestRelease }) => (
        <>
          {/* Title row: only the name and two compact actions, so it never squeezes the text below. */}
          <Group justify="space-between" align="center" wrap="nowrap" gap="md">
            <Group gap="sm" wrap="nowrap" miw={0}>
              <IconBook2 size={26} stroke={1.6} style={{ flex: 'none' }} />
              <Title order={2} fz={26} lineClamp={1}>
                {repo.name}
              </Title>
              <Pill icon={repo.private ? IconLock : IconWorld}>
                {repo.visibility.charAt(0).toUpperCase() + repo.visibility.slice(1)}
              </Pill>
              {repo.fork && <Pill icon={IconGitFork}>Fork</Pill>}
              {repo.archived && (
                <Pill icon={IconArchive} tone="yellow">
                  Archived
                </Pill>
              )}
            </Group>
            <Group gap="xs" wrap="nowrap">
              <Tooltip label="Open on GitHub">
                <ActionIcon
                  component="a"
                  href={repo.htmlUrl}
                  target="_blank"
                  variant="default"
                  size={36}
                  aria-label="Open on GitHub"
                >
                  <MarkGithubIcon size={18} />
                </ActionIcon>
              </Tooltip>
              <RefreshButton onRefresh={query.refresh} refreshing={query.refreshing} />
            </Group>
          </Group>

          {/* Everything else uses the full width of the page. */}
          {repo.description && (
            <Text mt={8} maw={820} c="dimmed" fz={14}>
              {cleanText(repo.description)}
            </Text>
          )}
          <Box hiddenFrom="lg" mt="md">
            <Counters repo={repo} contributors={totals.contributors} />
          </Box>
          <Group gap="lg" mt="md" className="repo-meta">
            {repo.license && <Meta icon={IconScale}>{repo.license}</Meta>}
            <Meta icon={IconCalendar}>Created {date(repo.createdAt)}</Meta>
            <Meta icon={IconHistory}>Updated {relative(repo.pushedAt)}</Meta>
            {totals.commits !== null && <Meta icon={IconGitCommit}>{num(totals.commits)} commits</Meta>}
            {repo.homepage && (
              <Meta icon={IconLink}>
                <Anchor href={repo.homepage} target="_blank" size="xs" c="inherit" underline="hover">
                  {hostname(repo.homepage)}
                </Anchor>
              </Meta>
            )}
          </Group>
          {repo.topics.length > 0 && (
            <Group gap={6} mt="md">
              {repo.topics.slice(0, 10).map((t) => (
                <Badge key={t} radius="xl" variant="default" tt="none" fw={500}>
                  {t}
                </Badge>
              ))}
            </Group>
          )}

          <Grid gap={40} mt={36}>
            <Grid.Col span={{ base: 12, lg: 8 }}>
              <GrowthChart />
              <LatestCommits />
            </Grid.Col>
            <Grid.Col span={{ base: 12, lg: 4 }}>
              <Box visibleFrom="lg" className="side-section">
                <Counters repo={repo} contributors={totals.contributors} spread />
              </Box>
              <Side
                title="Latest release"
                right={latestRelease ? <DetailsLink to="releases" label="All" /> : undefined}
              >
                {latestRelease ? (
                  <Anchor href={latestRelease.url} target="_blank" c="inherit" underline="never">
                    <Text fw={600}>{latestRelease.tag}</Text>
                    <Text size="xs" c="dimmed" mt={2}>
                      {relative(latestRelease.publishedAt)} · {num(totals.releases)} releases in total
                    </Text>
                  </Anchor>
                ) : (
                  <Text size="sm" c="dimmed">
                    No releases published yet.
                  </Text>
                )}
              </Side>
              <Side title="Languages">
                <Languages languages={languages} />
              </Side>
              {health && (
                <Side
                  title="Community health"
                  right={
                    <Text
                      size="sm"
                      fw={600}
                      c={health.percentage >= 80 ? 'green' : health.percentage >= 50 ? 'yellow' : 'red'}
                    >
                      {health.percentage}%
                    </Text>
                  }
                >
                  <Health health={health} />
                </Side>
              )}
            </Grid.Col>
          </Grid>
        </>
      )}
    </QueryView>
  );
}
