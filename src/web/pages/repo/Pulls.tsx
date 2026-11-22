import { DonutChart } from '@mantine/charts';
import { Anchor, Avatar, Badge, Box, Button, Grid, Group, Text } from '@mantine/core';
import { MarkGithubIcon } from '@primer/octicons-react';
import { Link } from 'react-router';
import {
  IconArrowUpRight,
  IconInfoCircle,
  IconClockHour4,
  IconGitMerge,
  IconGitPullRequest,
  IconGitPullRequestClosed,
  IconPercentage,
} from '@tabler/icons-react';
import { useState } from 'react';
import type { PersonCount, PullItem, PullsResponse } from '../../../shared/types';
import { MonthlyChart } from '../../components/monthly';
import {
  Counter,
  Counters,
  EmptyState,
  NoData,
  PageHeader,
  QueryView,
  SectionHeader,
} from '../../components/ui';
import { hours, num, percent, relative, sampleScope } from '../../lib/format';
import { useRepoParams, useSection } from '../../lib/queries';
import { semantic } from '../../theme';

const SIZE_HINTS: Record<string, string> = {
  XS: 'Under 10 lines',
  S: '10 to 49 lines',
  M: '50 to 249 lines',
  L: '250 to 999 lines',
  XL: '1,000 lines or more',
};

function PullStats({ data }: { data: PullsResponse }) {
  const total = data.counts.open + data.counts.merged + data.counts.closed;
  return (
    <Counters>
      <Counter
        icon={IconGitPullRequest}
        value={num(data.counts.open)}
        label="Open"
        hint="Open pull requests"
      />
      <Counter
        icon={IconGitMerge}
        value={num(data.counts.merged)}
        label="Merged"
        hint="Merged pull requests"
      />
      <Counter
        icon={IconGitPullRequestClosed}
        value={num(data.counts.closed)}
        label="Closed"
        hint="Closed without being merged"
      />
      <Counter
        icon={IconPercentage}
        value={percent(data.mergeRate)}
        label="Merge rate"
        hint="Share of finished pull requests that were merged"
      />
      <Counter
        icon={IconClockHour4}
        value={hours(data.medianTimeToMergeHours)}
        label="Time to merge"
        hint={`Median ${sampleScope(data.sampleSize, total, 'pull requests')}`}
      />
    </Counters>
  );
}

const SIZE_COLORS: Record<string, string> = {
  XS: 'var(--mantine-color-cyan-4)',
  S: 'var(--mantine-color-blue-4)',
  M: 'var(--mantine-color-indigo-5)',
  L: 'var(--mantine-color-violet-5)',
  XL: 'var(--mantine-color-grape-6)',
};

/** Pull request sizes as a donut, like the languages one on the home page, with a legend beside it. */
function Sizes({ sizes }: { sizes: PullsResponse['sizes'] }) {
  const [active, setActive] = useState<string | null>(null);
  const total = sizes.reduce((s, x) => s + x.count, 0);
  return (
    <Group gap="xl" wrap="nowrap" align="center">
      <Box className="donut">
        <DonutChart
          data={sizes
            .filter((x) => x.count > 0)
            .map((x) => ({
              name: x.size,
              value: x.count,
              color:
                active && active !== x.size ? 'var(--mantine-color-default-border)' : SIZE_COLORS[x.size]!,
            }))}
          size={176}
          thickness={14}
          paddingAngle={2}
          startAngle={90}
          endAngle={-270}
          pieProps={{ cornerRadius: 2, isAnimationActive: false }}
          strokeWidth={0}
          tooltipDataSource="segment"
          valueFormatter={(v) => `${v} pull requests`}
        />
        <div className="donut-label">
          <Text fz={30} fw={600} lh={1} className="tabular">
            {num(total)}
          </Text>
          <Text size="xs" c="dimmed" mt={4}>
            pull requests
          </Text>
        </div>
      </Box>
      <div className="rank-list" style={{ flex: 1, minWidth: 0 }}>
        {sizes.map((x) => (
          <div
            key={x.size}
            className="legend-row size-legend-row"
            onMouseEnter={() => setActive(x.size)}
            onMouseLeave={() => setActive(null)}
          >
            <span className="lang-dot" style={{ background: SIZE_COLORS[x.size], margin: 0 }} />
            <Text size="sm" fw={600}>
              {x.size}
            </Text>
            <Text size="sm" c="dimmed" truncate>
              {SIZE_HINTS[x.size]}
            </Text>
            <Text size="sm" fw={600} ta="right" className="tabular">
              {num(x.count)}
            </Text>
            <Text size="xs" c="dimmed" ta="right" className="tabular">
              {percent(total ? x.count / total : 0)}
            </Text>
          </div>
        ))}
      </div>
    </Group>
  );
}

/** The people opening the most pull requests, as leaderboard rows with their share of all of them. */
function Authors({ people, analyzed }: { people: PersonCount[]; analyzed: number }) {
  if (!people.length) return <NoData>No authors yet.</NoData>;
  const top = people.slice(0, 10);
  const max = Math.max(1, ...top.map((p) => p.count));
  return (
    <div className="rank-list">
      {top.map((p, i) => (
        <Anchor
          key={p.login}
          href={`https://github.com/${p.login}`}
          target="_blank"
          underline="never"
          c="inherit"
          className="rank-row"
        >
          <Text size="xs" c="dimmed" className="tabular rank-pos">
            {String(i + 1).padStart(2, '0')}
          </Text>
          <Group gap={8} wrap="nowrap" miw={0}>
            <Avatar src={p.avatarUrl} size={20} radius="xl" />
            <Text size="sm" fw={500} truncate>
              {p.login}
            </Text>
          </Group>
          <div className="rank-track">
            <div
              className="rank-fill"
              style={{ width: `${(p.count / max) * 100}%`, background: 'var(--mantine-color-violet-5)' }}
            />
          </div>
          <Text size="sm" fw={600} ta="right" className="tabular">
            {num(p.count)}
          </Text>
          <Text size="xs" c="dimmed" ta="right" className="tabular">
            {percent(analyzed ? p.count / analyzed : 0)}
          </Text>
        </Anchor>
      ))}
    </div>
  );
}

/** Pull requests as hairline rows: author, title with number and age, and lines changed. */
function PullList({ pulls, empty, merged }: { pulls: PullItem[]; empty: string; merged?: boolean }) {
  const { fullName } = useRepoParams();
  if (!pulls.length) return <NoData>{empty}</NoData>;
  return (
    <div className="rank-list">
      {pulls.map((p) => (
        <Link key={p.number} to={`/r/${fullName}/pull/${p.number}`} className="pull-row">
          <Avatar src={p.avatarUrl} size={22} radius="xl" />
          <Box miw={0}>
            <Group gap={6} wrap="nowrap">
              <Text size="sm" fw={500} truncate>
                {p.title}
              </Text>
              {p.draft && (
                <Badge size="xs" variant="default" tt="none" style={{ flex: 'none' }}>
                  Draft
                </Badge>
              )}
            </Group>
            <Text size="xs" c="dimmed" truncate>
              #{p.number} by {p.author} ·{' '}
              {merged ? `merged ${relative(p.mergedAt)}` : `opened ${relative(p.createdAt)}`}
            </Text>
          </Box>
          <Group gap={6} wrap="nowrap" className="tabular">
            <Text size="xs" c="green">
              +{num(p.additions)}
            </Text>
            <Text size="xs" c="red">
              −{num(p.deletions)}
            </Text>
          </Group>
        </Link>
      ))}
    </div>
  );
}

export function Pulls() {
  const query = useSection<PullsResponse>('pulls');
  const { fullName } = useRepoParams();
  const hasData =
    query.data && query.data.counts.open + query.data.counts.merged + query.data.counts.closed > 0;

  return (
    <>
      <PageHeader
        title="Pull requests"
        icon={<IconGitPullRequest size={26} stroke={1.6} />}
        description="How changes flow into the project and how quickly they land."
        stats={hasData ? <PullStats data={query.data!} /> : undefined}
        onRefresh={query.refresh}
        refreshing={query.refreshing}
      />
      <QueryView query={query}>
        {(data) => {
          const total = data.counts.open + data.counts.merged + data.counts.closed;
          // Only the latest pull requests are fetched in full; say so when that is not all of them.
          const limited = data.sampleSize < total;
          if (!total) {
            return (
              <EmptyState
                icon={<IconGitPullRequest size={28} stroke={1.5} />}
                title="No pull requests yet"
                description="When someone opens a pull request, its numbers will appear here."
              />
            );
          }
          return (
            <>
              <MonthlyChart
                kind="pr"
                title="Pull requests per month"
                caption="Opened, merged and closed in each month"
                initial={data.monthly}
                series={[
                  { name: 'opened', label: 'Opened', color: semantic.open },
                  { name: 'merged', label: 'Merged', color: semantic.merged },
                  { name: 'closed', label: 'Closed', color: semantic.closed },
                ]}
              />

              {limited && (
                <Group gap={8} wrap="nowrap" mt={36} c="dimmed" align="flex-start">
                  <IconInfoCircle size={16} stroke={1.7} style={{ flex: 'none', marginTop: 2 }} />
                  <Text size="sm">
                    This repository has {num(total)} pull requests. To keep things fast, the sections below
                    look at the {num(data.sampleSize)} most recent ones; the numbers above cover all of them.
                  </Text>
                </Group>
              )}

              {/* Two independent columns, so a longer list never leaves a gap on the other side. */}
              <Grid gap={48} mt={limited ? 28 : 44}>
                <Grid.Col span={{ base: 12, lg: 6 }}>
                  <SectionHeader
                    title="Pull request size"
                    caption={`Lines changed, ${sampleScope(data.sampleSize, total, 'pull requests')}`}
                  />
                  <Sizes sizes={data.sizes} />
                  <Box mt={44}>
                    <SectionHeader
                      title="Top authors"
                      caption={`Who opened the most, ${sampleScope(data.sampleSize, total, 'pull requests')}`}
                    />
                    <Authors people={data.topAuthors} analyzed={data.sampleSize} />
                  </Box>
                </Grid.Col>
                <Grid.Col span={{ base: 12, lg: 6 }}>
                  <SectionHeader
                    title="Waiting the longest"
                    caption={`Open pull requests still waiting for a review or decision, oldest first${limited ? `, among the latest ${num(data.sampleSize)}` : ''}`}
                  />
                  <PullList pulls={data.openOldest} empty="No open pull requests. Nice." />
                  <Box mt={44}>
                    <SectionHeader title="Recently merged" caption="The latest pull requests to land" />
                    <PullList pulls={data.recentMerged} empty="Nothing merged yet." merged />
                  </Box>
                </Grid.Col>
              </Grid>

              <Group justify="center" mt="xl">
                <Button
                  component="a"
                  href={`https://github.com/${fullName}/pulls`}
                  target="_blank"
                  variant="subtle"
                  color="gray"
                  size="compact-sm"
                  leftSection={<MarkGithubIcon size={14} />}
                  rightSection={<IconArrowUpRight size={14} />}
                >
                  See all pull requests on GitHub
                </Button>
              </Group>
            </>
          );
        }}
      </QueryView>
    </>
  );
}
