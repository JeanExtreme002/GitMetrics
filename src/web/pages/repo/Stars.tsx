import { AreaChart, BarChart } from '@mantine/charts';
import { Avatar, Badge, Box, Button, Grid, Group, SegmentedControl, Text, Tooltip } from '@mantine/core';
import {
  IconArrowUpRight,
  IconCalendarStats,
  IconFlag,
  IconStar,
  IconTrendingUp,
  IconTrophy,
} from '@tabler/icons-react';
import { useState } from 'react';
import { MarkGithubIcon } from '@primer/octicons-react';
import type { StarPoint, StarsResponse } from '../../../shared/types';
import {
  Counter,
  Counters,
  EmptyState,
  PageHeader,
  PersonAnchor,
  QueryView,
  SectionHeader,
} from '../../components/ui';
import {
  compact,
  date,
  monthLabel,
  monthName,
  num,
  relative,
  resampleCumulative,
  timeTick,
} from '../../lib/format';
import { cutoff, rangeOptions, type RangeValue } from '../../lib/ranges';
import { useRepoParams, useSection } from '../../lib/queries';
import { semantic } from '../../theme';

const MARKS = [
  1, 10, 25, 50, 100, 250, 500, 1_000, 2_500, 5_000, 10_000, 25_000, 50_000, 100_000, 250_000, 500_000,
  1_000_000,
];

const DAY = 86_400_000;

/** When the repository first reached each round number of stars, and how long each step took. */
function milestones(points: StarPoint[], total: number) {
  const reached = MARKS.filter((m) => m <= total).map((mark) => ({
    mark,
    date: points.find((p) => p.stars >= mark)?.date ?? null,
  }));
  return reached
    .map((m, i) => {
      const previous = reached[i - 1]?.date;
      const days =
        m.date && previous
          ? Math.round((new Date(m.date).getTime() - new Date(previous).getTime()) / DAY)
          : null;
      return { ...m, days };
    })
    .reverse();
}

function after(days: number) {
  if (days < 1) return 'The same day as the previous mark';
  if (days < 60) return `${days} days after the previous mark`;
  if (days < 730) return `${Math.round(days / 30)} months after the previous mark`;
  return `${(days / 365).toFixed(1)} years after the previous mark`;
}

function Milestones({ data }: { data: StarsResponse }) {
  const list = milestones(data.points, data.total);
  const next = MARKS.find((m) => m > data.total);
  return (
    <Box>
      <SectionHeader title="Milestones" caption="When the repository reached each mark" />
      <div className="rank-list lines-between">
        {next && (
          <div className="milestone-row milestone-next">
            <IconFlag size={16} stroke={1.7} />
            <Text size="sm" fw={500}>
              {num(next)} stars
            </Text>
            <Text size="xs" ta="right">
              {num(next - data.total)} to go
            </Text>
          </div>
        )}
        {list.map((m) => (
          <div key={m.mark} className="milestone-row">
            <IconStar size={16} stroke={1.7} color="var(--mantine-color-yellow-6)" />
            <Box miw={0}>
              <Text size="sm" fw={500}>
                {num(m.mark)} {m.mark === 1 ? 'star' : 'stars'}
              </Text>
              {m.days !== null && (
                <Text size="xs" c="dimmed">
                  {after(m.days)}
                </Text>
              )}
            </Box>
            <Text size="xs" c="dimmed" ta="right" style={{ whiteSpace: 'nowrap' }}>
              {data.sampled ? '≈ ' : ''}
              {date(m.date)}
            </Text>
          </div>
        ))}
      </div>
    </Box>
  );
}

/** The latest people to star the repository, as hairline rows under the monthly chart. */
function RecentStargazers({ people, total }: { people: StarsResponse['recent']; total: number }) {
  const { fullName } = useRepoParams();
  if (!people.length) return null;
  return (
    <Box mt={44}>
      <SectionHeader title="Recent stargazers" caption="The latest people to star this repository" />
      <div className="rank-list lines-between">
        {people.map((p) => (
          <PersonAnchor
            key={p.login}
            login={p.login}
            url={p.url}
            underline="never"
            c="inherit"
            className="stargazer-row"
          >
            <Avatar src={p.avatarUrl} size={28} radius="xl" />
            <Box miw={0}>
              <Text size="sm" fw={500} truncate>
                {p.name ?? p.login}
              </Text>
              {p.name && (
                <Text size="xs" c="dimmed" truncate>
                  @{p.login}
                </Text>
              )}
            </Box>
            <Text size="xs" c="dimmed" ta="right" style={{ whiteSpace: 'nowrap' }}>
              {relative(p.starredAt)}
            </Text>
          </PersonAnchor>
        ))}
      </div>
      {total > people.length && (
        <Group justify="center" mt="sm">
          <Button
            component="a"
            href={`https://github.com/${fullName}/stargazers`}
            target="_blank"
            variant="subtle"
            color="gray"
            size="compact-sm"
            leftSection={<MarkGithubIcon size={14} />}
            rightSection={<IconArrowUpRight size={14} />}
          >
            See all {num(total)} stargazers on GitHub
          </Button>
        </Group>
      )}
    </Box>
  );
}

function StarStats({ data }: { data: StarsResponse }) {
  return (
    <Counters>
      <Counter
        icon={IconStar}
        value={compact(data.total)}
        label="Total"
        hint={data.firstStarAt ? `First star on ${date(data.firstStarAt)}` : undefined}
      />
      {/* Without the list of stargazers there are no rates to show, only the exact total. */}
      {!data.historyHidden && <StarRates data={data} />}
    </Counters>
  );
}

function StarRates({ data }: { data: StarsResponse }) {
  return (
    <>
      <Counter
        icon={IconTrendingUp}
        value={`+${num(data.stats.last30Days)}`}
        label="Last 30 days"
        hint={`+${num(data.stats.last7Days)} in the last 7 days`}
      />
      <Counter
        icon={IconCalendarStats}
        value={num(data.stats.avgPerMonth)}
        label="Per month"
        hint="Average over the last 12 months"
      />
      <Counter
        icon={IconTrophy}
        value={data.stats.bestMonth ? `+${num(data.stats.bestMonth.stars)}` : '—'}
        label="Best month"
        hint={data.stats.bestMonth ? monthName(data.stats.bestMonth.month) : undefined}
      />
    </>
  );
}

export function Stars() {
  const query = useSection<StarsResponse>('stars');
  const [range, setRange] = useState<RangeValue>('all');

  return (
    <>
      <PageHeader
        title="Stars"
        icon={<IconStar size={26} stroke={1.6} />}
        description="How fast people are discovering and bookmarking this repository."
        stats={query.data && query.data.total > 0 ? <StarStats data={query.data} /> : undefined}
        onRefresh={query.refresh}
        refreshing={query.refreshing}
      />
      <QueryView query={query}>
        {(data) => {
          if (data.total === 0) {
            return (
              <EmptyState
                icon={<IconStar size={28} stroke={1.5} />}
                title="No stars yet"
                description="Once people start starring this repository, its history shows up here."
              />
            );
          }
          if (data.historyHidden) {
            return (
              <EmptyState
                icon={<IconStar size={28} stroke={1.5} />}
                title="Star history not available"
                description={`GitHub only shows who starred a repository to people who can push to it, so the history, monthly chart and milestones can't be built here. The total of ${num(data.total)} stars is exact.`}
              />
            );
          }
          const from = cutoff(range);
          const points = resampleCumulative(data.points, 'stars', from || undefined);
          const spanDays = points.length ? (Date.now() - new Date(points[0]!.date).getTime()) / DAY : 0;
          const monthly = data.monthly.filter((m) => `${m.month}-31` >= from);

          return (
            <>
              <Box>
                <SectionHeader
                  title="Star history"
                  caption="Cumulative stars over time"
                  right={
                    <>
                      {data.sampled && (
                        <Tooltip
                          multiline
                          w={260}
                          label="This repository has many stars, so the curve is built from evenly spaced samples. The total is exact."
                        >
                          <Badge color="gray" variant="default" tt="none">
                            Estimated curve
                          </Badge>
                        </Tooltip>
                      )}
                      <SegmentedControl
                        size="xs"
                        value={range}
                        onChange={(v) => setRange(v as RangeValue)}
                        data={rangeOptions(data.firstStarAt)}
                      />
                    </>
                  }
                />
                <AreaChart
                  h={320}
                  data={points}
                  dataKey="date"
                  series={[{ name: 'value', label: 'Stars', color: semantic.stars }]}
                  curveType="monotone"
                  withDots={false}
                  gridAxis="y"
                  xAxisProps={{ tickFormatter: timeTick(spanDays), minTickGap: 48 }}
                  yAxisProps={{ domain: ['auto', 'auto'] }}
                  valueFormatter={num}
                />
              </Box>

              <Grid gap={40} mt={44}>
                <Grid.Col span={{ base: 12, lg: 8 }}>
                  <SectionHeader
                    title="New stars per month"
                    caption="Stars gained each month in the selected period"
                  />
                  <BarChart
                    h={300}
                    data={monthly}
                    dataKey="month"
                    series={[{ name: 'stars', label: 'New stars', color: semantic.stars }]}
                    gridAxis="y"
                    fillOpacity={0.85}
                    xAxisProps={{ tickFormatter: monthLabel, minTickGap: 24 }}
                    barProps={{ radius: [4, 4, 0, 0], maxBarSize: 28 }}
                    valueFormatter={num}
                  />
                  <RecentStargazers people={data.recent ?? []} total={data.total} />
                </Grid.Col>
                <Grid.Col span={{ base: 12, lg: 4 }}>
                  <Milestones data={data} />
                </Grid.Col>
              </Grid>
            </>
          );
        }}
      </QueryView>
    </>
  );
}
