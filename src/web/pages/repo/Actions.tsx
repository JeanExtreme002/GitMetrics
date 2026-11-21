import { BarChart, DonutChart } from '@mantine/charts';
import { Anchor, Box, Button, Grid, Group, Text, Tooltip } from '@mantine/core';
import { MarkGithubIcon } from '@primer/octicons-react';
import {
  IconAlertTriangle,
  IconArrowUpRight,
  IconCircleCheck,
  IconClockHour4,
  IconInfoCircle,
  IconMathAvg,
  IconPlayerPlay,
  IconSum,
  IconX,
} from '@tabler/icons-react';
import { useState } from 'react';
import type { ActionsResponse, WorkflowStat } from '../../../shared/types';
import {
  Counter,
  Counters,
  EmptyState,
  NoData,
  PageHeader,
  QueryView,
  SectionHeader,
} from '../../components/ui';
import { dayLabel, duration, num, percent, relative } from '../../lib/format';
import { useRepoParams, useSection } from '../../lib/queries';
import { semantic } from '../../theme';

const EVENT_COLORS = [
  'var(--mantine-color-indigo-5)',
  'var(--mantine-color-teal-5)',
  'var(--mantine-color-orange-5)',
  'var(--mantine-color-cyan-5)',
  'var(--mantine-color-pink-5)',
  'var(--mantine-color-violet-5)',
];
const OTHER_EVENTS = 'var(--mantine-color-gray-6)';

const FAILED = new Set(['failure', 'timed_out', 'startup_failure']);

/** Green when runs pass, yellow when some fail, red when most do. */
const rateColor = (rate: number | null) =>
  rate == null
    ? 'var(--mantine-color-gray-5)'
    : rate >= 0.9
      ? 'var(--mantine-color-green-6)'
      : rate >= 0.7
        ? 'var(--mantine-color-yellow-6)'
        : 'var(--mantine-color-red-6)';

const resultColor = (conclusion: string | null) =>
  conclusion === 'success'
    ? 'var(--mantine-color-green-6)'
    : FAILED.has(conclusion ?? '')
      ? 'var(--mantine-color-red-6)'
      : 'var(--mantine-color-gray-5)';

const resultLabel = (conclusion: string | null) =>
  conclusion === 'success'
    ? 'Succeeded'
    : FAILED.has(conclusion ?? '')
      ? 'Failed'
      : conclusion
        ? conclusion.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())
        : 'Running';

const eventLabel = (event: string) => event.replace(/_/g, ' ');

function ActionStats({ data }: { data: ActionsResponse }) {
  return (
    <Counters>
      <Counter
        icon={IconPlayerPlay}
        value={num(data.totalRuns)}
        label="Runs"
        hint={`Workflow runs in the last ${data.windowDays} days`}
      />
      <Counter
        icon={IconCircleCheck}
        value={percent(data.successRate, 1)}
        label="Success"
        hint="Share of finished runs that passed; cancelled and skipped runs are ignored"
      />
      <Counter
        icon={IconAlertTriangle}
        value={num(data.failure)}
        label="Failures"
        hint={`${num(data.cancelled)} more were cancelled`}
      />
      <Counter
        icon={IconClockHour4}
        value={duration(data.medianDurationMs)}
        label="Median run"
        hint="Half of the runs finish faster than this; a few very long runs do not move it"
      />
      <Counter
        icon={IconMathAvg}
        value={duration(data.avgDurationMs)}
        label="Average run"
        hint="Total run time divided by the number of runs; long runs pull it up"
      />
      <Counter
        icon={IconSum}
        value={duration(data.totalDurationMs)}
        label="Run time"
        hint="Wall-clock time of every run added up"
      />
    </Counters>
  );
}

/** The latest results of a workflow as small dots, newest on the right, like a status history. */
function RecentResults({ runs }: { runs: WorkflowStat['recent'] }) {
  if (!runs.length) return <span />;
  return (
    <div className="run-dots">
      {[...runs].reverse().map((r) => (
        <Tooltip key={r.url} label={`${resultLabel(r.conclusion)} · ${relative(r.createdAt)}`} openDelay={0}>
          {/* Not a link: the whole row already is one, and links cannot nest. */}
          <span
            role="link"
            tabIndex={0}
            className="run-dot"
            style={{ background: resultColor(r.conclusion) }}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              window.open(r.url, '_blank', 'noopener');
            }}
          />
        </Tooltip>
      ))}
    </div>
  );
}

/** Workflows as ranking rows: name and file, recent results, runs, success rate and duration. */
function Workflows({ workflows }: { workflows: WorkflowStat[] }) {
  const { fullName } = useRepoParams();
  if (!workflows.length) return <NoData>No workflows found.</NoData>;
  return (
    <div className="rank-list">
      <div className="workflow-row rank-head">
        <div className="rank-head-label">Workflow</div>
        <div className="rank-head-label workflow-dots-col">Latest runs</div>
        <div className="rank-head-label rank-head-right">Runs</div>
        <div className="rank-head-label">Success</div>
        <div className="rank-head-label rank-head-right">Median</div>
        <div className="rank-head-label rank-head-right">Average</div>
      </div>
      {workflows.map((w) => {
        const file = w.path.replace('.github/workflows/', '');
        return (
          <Anchor
            key={w.id}
            href={
              file
                ? `https://github.com/${fullName}/actions/workflows/${file}`
                : `https://github.com/${fullName}/actions`
            }
            target="_blank"
            underline="never"
            c="inherit"
            className="workflow-row"
            style={{ opacity: w.runs ? 1 : 0.55 }}
          >
            <Box miw={0}>
              <Text size="sm" fw={500} truncate>
                {w.name}
              </Text>
              <Text size="xs" c="dimmed" ff="monospace" truncate>
                {file || 'No workflow file'}
                {w.state !== 'active' && w.state !== 'unknown' ? ` · ${w.state.replace(/_/g, ' ')}` : ''}
              </Text>
            </Box>
            <div className="workflow-dots-col">
              <RecentResults runs={w.recent ?? []} />
            </div>
            <Text size="sm" fw={600} ta="right" className="tabular">
              {num(w.runs)}
            </Text>
            {w.successRate == null ? (
              <Text size="sm" c="dimmed">
                —
              </Text>
            ) : (
              <Group gap={10} wrap="nowrap">
                <div className="rank-track" style={{ flex: 1 }}>
                  <div
                    className="rank-fill"
                    style={{ width: `${w.successRate * 100}%`, background: rateColor(w.successRate) }}
                  />
                </div>
                <Text size="xs" c="dimmed" ta="right" className="tabular" w={34}>
                  {percent(w.successRate)}
                </Text>
              </Group>
            )}
            <Text size="sm" ta="right" className="tabular">
              {duration(w.medianDurationMs)}
            </Text>
            <Text size="sm" c="dimmed" ta="right" className="tabular">
              {duration(w.avgDurationMs)}
            </Text>
          </Anchor>
        );
      })}
    </div>
  );
}

/** Failed runs as hairline rows: workflow, branch, trigger and who started it. */
function Failures({
  failures,
  windowDays,
}: {
  failures: ActionsResponse['recentFailures'];
  windowDays: number;
}) {
  if (!failures.length) return <NoData>No failures in the last {windowDays} days. Nice.</NoData>;
  return (
    <div className="rank-list">
      {failures.slice(0, 6).map((f) => (
        <Anchor key={f.id} href={f.url} target="_blank" underline="never" c="inherit" className="pull-row">
          <span className="run-fail-icon">
            <IconX size={13} stroke={2.4} />
          </span>
          <Box miw={0}>
            <Text size="sm" fw={500} truncate>
              {f.name}
            </Text>
            <Text size="xs" c="dimmed" truncate>
              {f.branch ?? 'unknown branch'} · {eventLabel(f.event)}
              {f.actor ? ` · ${f.actor}` : ''}
            </Text>
          </Box>
          <Text size="xs" c="dimmed" style={{ whiteSpace: 'nowrap' }}>
            {relative(f.createdAt)}
          </Text>
        </Anchor>
      ))}
    </div>
  );
}

/** What starts the runs (push, pull request, schedule…), as a donut like the other breakdowns. */
function Triggers({ events }: { events: ActionsResponse['events'] }) {
  const [active, setActive] = useState<string | null>(null);
  if (!events.length) return <NoData />;
  const top = events.slice(0, EVENT_COLORS.length);
  const rest = events.slice(EVENT_COLORS.length).reduce((s, e) => s + e.count, 0);
  const slices = [
    ...top.map((e, i) => ({
      name: e.name,
      label: eventLabel(e.name),
      value: e.count,
      color: EVENT_COLORS[i]!,
    })),
    ...(rest ? [{ name: '__other', label: 'other', value: rest, color: OTHER_EVENTS }] : []),
  ];
  const total = slices.reduce((s, e) => s + e.value, 0);
  return (
    <Group gap="xl" wrap="nowrap" align="center">
      <Box className="donut">
        <DonutChart
          data={slices.map((s) => ({
            name: s.label,
            value: s.value,
            color: active && active !== s.name ? 'var(--mantine-color-default-border)' : s.color,
          }))}
          size={176}
          thickness={14}
          paddingAngle={2}
          startAngle={90}
          endAngle={-270}
          pieProps={{ cornerRadius: 2, isAnimationActive: false }}
          strokeWidth={0}
          tooltipDataSource="segment"
          valueFormatter={(v) => `${num(v)} runs`}
        />
        <div className="donut-label">
          <Text fz={30} fw={600} lh={1} className="tabular">
            {num(slices.length)}
          </Text>
          <Text size="xs" c="dimmed" mt={4}>
            {slices.length === 1 ? 'trigger' : 'triggers'}
          </Text>
        </div>
      </Box>
      <div className="rank-list" style={{ flex: 1, minWidth: 0 }}>
        {slices.map((s) => (
          <div
            key={s.name}
            className="legend-row"
            onMouseEnter={() => setActive(s.name)}
            onMouseLeave={() => setActive(null)}
          >
            <span className="lang-dot" style={{ background: s.color, margin: 0 }} />
            <Text size="sm" truncate>
              {s.label}
            </Text>
            <Text size="sm" c="dimmed" ta="right" className="tabular">
              {percent(s.value / total)}
            </Text>
          </div>
        ))}
      </div>
    </Group>
  );
}

export function Actions() {
  const query = useSection<ActionsResponse>('actions');
  const { fullName } = useRepoParams();
  const hasData = query.data && query.data.available && query.data.totalRuns > 0;

  return (
    <>
      <PageHeader
        title="Actions"
        icon={<IconPlayerPlay size={26} stroke={1.6} />}
        description="Health and speed of your GitHub Actions workflows over the last 30 days."
        stats={hasData ? <ActionStats data={query.data!} /> : undefined}
        statsFrom="xl"
        onRefresh={query.refresh}
        refreshing={query.refreshing}
      />
      <QueryView query={query}>
        {(data) => {
          if (!data.available || data.totalRuns === 0) {
            return (
              <EmptyState
                icon={<IconPlayerPlay size={28} stroke={1.5} />}
                title={data.available ? 'No workflow runs lately' : 'Actions are not available'}
                description={
                  data.available
                    ? `Nothing ran in the last ${data.windowDays} days. Runs will show up here as soon as a workflow is triggered.`
                    : 'GitHub Actions is disabled for this repository, or your token cannot read it.'
                }
              />
            );
          }
          // Busy repositories have more runs than GitHub returns; say what the sections look at.
          const sample = data.sampleSize ?? data.totalRuns;
          const limited = sample < data.totalRuns;
          const days = data.daily.length;
          return (
            <>
              {limited && !data.exactDaily && (
                <Group gap={8} wrap="nowrap" mb={28} c="dimmed" align="flex-start">
                  <IconInfoCircle size={16} stroke={1.7} style={{ flex: 'none', marginTop: 2 }} />
                  <Text size="sm">
                    This repository had {num(data.totalRuns)} runs in the last {data.windowDays} days. GitHub
                    returns up to {num(sample)} of them, so the sections below cover the last {num(days)}{' '}
                    {days === 1 ? 'day' : 'days'}; the run count above covers all of them.
                  </Text>
                </Group>
              )}

              <Box>
                <SectionHeader
                  title="Runs per day"
                  caption={`Finished runs by result over the last ${num(days)} days`}
                />
                <BarChart
                  h={260}
                  data={data.daily}
                  dataKey="date"
                  type="stacked"
                  series={[
                    { name: 'success', label: 'Succeeded', color: semantic.success },
                    { name: 'failure', label: 'Failed', color: semantic.failure },
                    { name: 'other', label: 'Cancelled or skipped', color: semantic.neutral },
                  ]}
                  gridAxis="y"
                  withLegend
                  legendProps={{ verticalAlign: 'top', height: 40 }}
                  xAxisProps={{ tickFormatter: dayLabel, minTickGap: 24 }}
                  yAxisProps={{ allowDecimals: false }}
                  barProps={{ radius: [3, 3, 0, 0], maxBarSize: 22 }}
                />
              </Box>

              {limited && data.exactDaily && (
                <Group gap={8} wrap="nowrap" mt={36} c="dimmed" align="flex-start">
                  <IconInfoCircle size={16} stroke={1.7} style={{ flex: 'none', marginTop: 2 }} />
                  <Text size="sm">
                    This repository had {num(data.totalRuns)} runs in the last {data.windowDays} days. The
                    chart and the numbers above count all of them; the sections below look at the latest{' '}
                    {num(sample)}.
                  </Text>
                </Group>
              )}

              <Grid gap={48} mt={limited && data.exactDaily ? 28 : 44}>
                <Grid.Col span={{ base: 12, lg: 6 }}>
                  <SectionHeader
                    title="What triggers runs"
                    caption="Share of runs by the event that started them"
                  />
                  <Triggers events={data.events} />
                </Grid.Col>
                <Grid.Col span={{ base: 12, lg: 6 }}>
                  <SectionHeader title="Recent failures" caption="The latest runs that failed or timed out" />
                  <Failures failures={data.recentFailures} windowDays={data.windowDays} />
                </Grid.Col>
              </Grid>

              <Box mt={44}>
                <SectionHeader
                  title="Workflows"
                  caption="Runs, success rate and duration of each workflow; dots are the latest results"
                />
                <Workflows workflows={data.workflows} />
              </Box>

              <Group justify="center" mt="xl">
                <Button
                  component="a"
                  href={`https://github.com/${fullName}/actions`}
                  target="_blank"
                  variant="subtle"
                  color="gray"
                  size="compact-sm"
                  leftSection={<MarkGithubIcon size={14} />}
                  rightSection={<IconArrowUpRight size={14} />}
                >
                  See all runs on GitHub
                </Button>
              </Group>
            </>
          );
        }}
      </QueryView>
    </>
  );
}
