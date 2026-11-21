import { BarChart, Heatmap } from '@mantine/charts';
import {
  Anchor,
  Avatar,
  Box,
  Button,
  Grid,
  Group,
  ScrollArea,
  SegmentedControl,
  Text,
  Tooltip,
} from '@mantine/core';
import { IconArrowUpRight, IconCalendarWeek, IconClock, IconFlame, IconGitCommit } from '@tabler/icons-react';
import { useElementSize } from '@mantine/hooks';
import { MarkGithubIcon } from '@primer/octicons-react';
import { useState } from 'react';
import type { CommitsResponse } from '../../../shared/types';
import { Counter, Counters, NoData, PageHeader, QueryView, SectionHeader } from '../../components/ui';
import { axisNumber, dayLabel, hourLabel, num, relative, timeTick } from '../../lib/format';
import { useRepoParams, useSection } from '../../lib/queries';
import { cutoff, rangeOptions, type RangeValue } from '../../lib/ranges';
import { semantic, useHeatScale } from '../../theme';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const HOURS = Array.from({ length: 24 }, (_, h) => hourLabel(h));

function CommitStats({ data }: { data: CommitsResponse }) {
  return (
    <Counters>
      <Counter
        icon={IconGitCommit}
        value={num(data.totals.lastYear)}
        label="This year"
        hint="Commits in the last 52 weeks"
      />
      <Counter
        icon={IconCalendarWeek}
        value={num(data.totals.avgPerWeek)}
        label="Per week"
        hint="Average commits per week over the last year"
      />
      <Counter
        icon={IconFlame}
        value={`${data.totals.activeWeeks}/${data.weekly.length || 52}`}
        label="Active weeks"
        hint="Weeks with at least one commit"
      />
      <Counter
        icon={IconClock}
        value={data.totals.busiestDay ? data.totals.busiestDay.slice(0, 3) : '—'}
        label="Busiest day"
        hint={
          data.totals.busiestDay
            ? `${data.totals.busiestDay}${data.totals.busiestHour != null ? `, around ${hourLabel(data.totals.busiestHour)} UTC` : ''}`
            : undefined
        }
      />
    </Counters>
  );
}

const FULL_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * A punch card like GitHub's original one: a dot for every day and hour, sized and tinted by
 * how many commits landed there. Hour labels stay horizontal, every three hours.
 */
function PunchCard({ data }: { data: CommitsResponse['punchCard'] }) {
  const counts = new Map(data.map((p) => [`${p.day}-${p.hour}`, p.commits]));
  const max = Math.max(1, ...data.map((p) => p.commits));
  return (
    <div className="punch">
      {DAYS.map((day, d) => (
        <div key={day} className="punch-row">
          <Text size="xs" c="dimmed" className="punch-day">
            {day}
          </Text>
          {HOURS.map((hour, h) => {
            const value = counts.get(`${d}-${h}`) ?? 0;
            const ratio = value / max;
            return (
              <Tooltip
                key={hour}
                label={`${FULL_DAYS[d]} at ${hour} UTC: ${num(value)} ${value === 1 ? 'commit' : 'commits'}`}
                openDelay={0}
              >
                <span className="punch-cell">
                  <span
                    className={value ? 'punch-dot' : 'punch-dot punch-empty'}
                    style={
                      value
                        ? { width: `${6 + 14 * Math.sqrt(ratio)}px`, opacity: 0.35 + 0.65 * ratio }
                        : undefined
                    }
                  />
                </span>
              </Tooltip>
            );
          })}
        </div>
      ))}
      <div className="punch-row">
        <span />
        {HOURS.map((hour, h) => (
          <Text key={hour} size="xs" c="dimmed" ta="center" className="punch-hour">
            {h % 3 === 0 ? hour : ''}
          </Text>
        ))}
      </div>
    </div>
  );
}

const CAL_GAP = 4;
const CAL_LABELS = 36;
const CAL_MIN = 8;

/** GitHub-style contribution calendar whose squares grow to fill the available width. */
function ContributionCalendar({ daily }: { daily: CommitsResponse['daily'] }) {
  const scale = useHeatScale();
  const { ref, width } = useElementSize();
  const end = new Date();
  const start = new Date();
  start.setUTCFullYear(start.getUTCFullYear() - 1);
  // Count the columns exactly as the heatmap draws them: weeks start on Monday.
  const day = 86_400_000;
  const offset = (start.getUTCDay() + 6) % 7;
  const days = Math.floor((end.getTime() - start.getTime()) / day) + 1;
  const weeks = Math.ceil((offset + days) / 7);
  // The heatmap adds one trailing gap after the last column.
  const fitted = (width - CAL_LABELS - CAL_GAP) / weeks - CAL_GAP;
  const rectSize = width ? Math.min(Math.max(fitted, CAL_MIN), 26) : 16;
  return (
    <ScrollArea type="auto">
      <Box ref={ref} miw={weeks * (CAL_MIN + CAL_GAP) + CAL_LABELS}>
        <Heatmap
          data={Object.fromEntries(Object.entries(daily).filter(([, v]) => v > 0))}
          startDate={start}
          endDate={end}
          withMonthLabels
          withWeekdayLabels
          withTooltip
          withOutsideDates={false}
          weekdaysLabelsWidth={CAL_LABELS}
          rectSize={rectSize}
          gap={CAL_GAP}
          rectRadius={Math.max(2, Math.round(rectSize / 4))}
          colors={scale}
          getTooltipLabel={({ date, value }) => `${dayLabel(date)}: ${num(value ?? 0)} commits`}
        />
      </Box>
    </ScrollArea>
  );
}

function LatestCommits({ commits }: { commits: CommitsResponse['recent'] }) {
  if (!commits.length) return <NoData>No commits yet.</NoData>;
  return (
    <div className="rank-list">
      {commits.map((c) => (
        <Anchor
          key={c.sha}
          href={c.url}
          target="_blank"
          underline="never"
          c="inherit"
          className="commit-row commit-row-sha"
        >
          <Avatar src={c.avatarUrl} size={22} radius="xl" />
          <Text size="sm" truncate>
            {c.message}
          </Text>
          <Text size="xs" c="dimmed" truncate>
            {c.author}
          </Text>
          <Text size="xs" c="dimmed" ff="monospace">
            {c.sha.slice(0, 7)}
          </Text>
          <Text size="xs" c="dimmed" ta="right" style={{ whiteSpace: 'nowrap' }}>
            {relative(c.date)}
          </Text>
        </Anchor>
      ))}
    </div>
  );
}

export function Commits() {
  const query = useSection<CommitsResponse>('commits');
  const { fullName } = useRepoParams();
  const [range, setRange] = useState<RangeValue>('12');

  return (
    <>
      <PageHeader
        title="Commits"
        icon={<IconGitCommit size={26} stroke={1.6} />}
        description="The rhythm of work on the default branch."
        stats={query.data && !query.data.pending ? <CommitStats data={query.data} /> : undefined}
        onRefresh={query.refresh}
        refreshing={query.refreshing}
      />
      <QueryView query={query}>
        {(data) => {
          const frequency = data.codeFrequency ?? [];
          const from = cutoff(range);
          const shownFrequency = frequency.filter((w) => w.week >= from);
          const frequencyDays = shownFrequency.length
            ? (Date.now() - new Date(shownFrequency[0]!.week).getTime()) / 86_400_000
            : 0;
          return (
            <>
              <Box>
                <SectionHeader title="Contribution calendar" caption="Commits per day over the last year" />
                <ContributionCalendar daily={data.daily} />
              </Box>

              <Box mt={44}>
                <SectionHeader
                  title="Code frequency"
                  caption="Lines added and removed per week"
                  right={
                    data.codeFrequency && (
                      <SegmentedControl
                        size="xs"
                        value={range}
                        onChange={(v) => setRange(v as RangeValue)}
                        data={rangeOptions(frequency[0]?.week)}
                      />
                    )
                  }
                />
                {data.codeFrequency ? (
                  <BarChart
                    h={280}
                    // Like GitHub: one bar per week, additions above the zero line and deletions below it.
                    data={shownFrequency.map((w) => ({ ...w, deletions: -w.deletions }))}
                    dataKey="week"
                    type="stacked"
                    barChartProps={{ stackOffset: 'sign' }}
                    series={[
                      { name: 'additions', label: 'Added', color: semantic.additions },
                      { name: 'deletions', label: 'Removed', color: semantic.deletions },
                    ]}
                    gridAxis="y"
                    withLegend
                    legendProps={{ verticalAlign: 'top', height: 40 }}
                    referenceLines={[{ y: 0, color: 'var(--mantine-color-default-border)' }]}
                    xAxisProps={{ tickFormatter: timeTick(frequencyDays), minTickGap: 36 }}
                    yAxisProps={{ tickFormatter: (v: number) => axisNumber(Math.abs(v)) }}
                    valueFormatter={(v) => num(Math.abs(v))}
                    barProps={{ radius: 2 }}
                  />
                ) : (
                  <NoData>
                    GitHub does not compute code frequency for repositories with 10,000+ commits.
                  </NoData>
                )}
              </Box>

              <Grid gap={48} mt={44}>
                <Grid.Col span={{ base: 12, lg: 6 }}>
                  <SectionHeader title="Weekly commits" caption="Commits per week over the last 52 weeks" />
                  <BarChart
                    h={240}
                    data={data.weekly}
                    dataKey="week"
                    series={[{ name: 'commits', label: 'Commits', color: semantic.commits }]}
                    gridAxis="y"
                    xAxisProps={{ tickFormatter: dayLabel, minTickGap: 36 }}
                    barProps={{ radius: [3, 3, 0, 0] }}
                  />
                </Grid.Col>
                <Grid.Col span={{ base: 12, lg: 6 }}>
                  <SectionHeader
                    title="When commits happen"
                    caption="Day of the week and hour, all time (UTC)"
                  />
                  {data.punchCard.some((p) => p.commits > 0) ? (
                    <PunchCard data={data.punchCard} />
                  ) : (
                    <NoData />
                  )}
                </Grid.Col>
              </Grid>

              <Box mt={44}>
                <SectionHeader
                  title="Latest commits"
                  caption="The most recent commits on the default branch"
                />
                <LatestCommits commits={data.recent} />
                {data.recent.length > 0 && (
                  <Group justify="center" mt="sm">
                    <Button
                      component="a"
                      href={`https://github.com/${fullName}/commits`}
                      target="_blank"
                      variant="subtle"
                      color="gray"
                      size="compact-sm"
                      leftSection={<MarkGithubIcon size={14} />}
                      rightSection={<IconArrowUpRight size={14} />}
                    >
                      See all commits on GitHub
                    </Button>
                  </Group>
                )}
              </Box>
            </>
          );
        }}
      </QueryView>
    </>
  );
}
