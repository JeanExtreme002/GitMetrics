import { BarChart } from '@mantine/charts';
import {
  ActionIcon,
  Anchor,
  Avatar,
  Box,
  Button,
  Grid,
  Group,
  SegmentedControl,
  Text,
  Tooltip,
} from '@mantine/core';
import { MarkGithubIcon } from '@primer/octicons-react';
import {
  IconArrowUpRight,
  IconCalendarTime,
  IconChevronDown,
  IconCircleCheck,
  IconInfoCircle,
  IconRocket,
  IconServer2,
  IconWorld,
} from '@tabler/icons-react';
import { useState } from 'react';
import type { DeploymentItem, DeploymentsResponse } from '../../../shared/types';
import {
  Counter,
  Counters,
  EmptyState,
  NoData,
  PageHeader,
  QueryView,
  SectionHeader,
} from '../../components/ui';
import { dayLabel, hourLabel, monthLabel, num, percent, relative } from '../../lib/format';
import { useRepoParams, useSection } from '../../lib/queries';
import { cutoff, rangeOptions, type RangeValue } from '../../lib/ranges';

/**
 * GitHub marks a deployment "inactive" once a newer one replaces it, so inactive ones did work.
 * Pending, queued and in-progress deployments have no outcome yet and are left out.
 */
const SUCCEEDED = new Set(['success', 'inactive']);
const FAILED = new Set(['failure', 'error']);

const ENV_COLORS = ['indigo.5', 'teal.5', 'orange.5', 'pink.5', 'cyan.5'];
const OTHER_ENVS = 'gray.5';

const stateColor = (state: string | null) =>
  state && SUCCEEDED.has(state)
    ? 'var(--mantine-color-green-6)'
    : state && FAILED.has(state)
      ? 'var(--mantine-color-red-6)'
      : state
        ? 'var(--mantine-color-yellow-6)'
        : 'var(--mantine-color-gray-5)';

const stateLabel = (state: string | null) =>
  state === 'inactive'
    ? 'Succeeded, since replaced'
    : state
      ? state.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())
      : 'No status';

/** Success rate among deployments whose outcome is known. */
function successRate(counts: DeploymentsResponse['stateCounts']) {
  const ok = counts.filter((c) => SUCCEEDED.has(c.state)).reduce((s, c) => s + c.count, 0);
  const failed = counts.filter((c) => FAILED.has(c.state)).reduce((s, c) => s + c.count, 0);
  return { rate: ok + failed ? ok / (ok + failed) : null, known: ok + failed };
}

function DeploymentStats({ data }: { data: DeploymentsResponse }) {
  const { rate, known } = successRate(data.stateCounts);
  const last = data.recent[0];
  return (
    <Counters>
      <Counter
        icon={IconRocket}
        value={num(data.total)}
        label="Deployments"
        hint="Every deployment on record"
      />
      <Counter
        icon={IconServer2}
        value={num(data.environments.length)}
        label="Environments"
        hint="Places this repository deploys to"
      />
      <Counter
        icon={IconCircleCheck}
        value={percent(rate)}
        label="Success"
        hint={`Of the latest ${num(known)} with a final status; replaced deployments count as successful`}
      />
      <Counter
        icon={IconCalendarTime}
        value={last ? relative(last.createdAt).replace(/ ago$/, '') : '—'}
        label="Since last"
        hint={last ? `To ${last.environment}, ${relative(last.createdAt)}` : undefined}
      />
    </Counters>
  );
}

/** Deployments per month, stacked by environment, with the usual time windows. */
/** "2025-06-14T15" → "Jun 14, 3pm" (UTC). */
const hourName = (key: string) => `${dayLabel(key.slice(0, 10))}, ${hourLabel(Number(key.slice(11, 13)))}`;

function History({ data }: { data: DeploymentsResponse }) {
  const [range, setRange] = useState<RangeValue>('12');
  // Busy repositories: the fetched deployments cover only hours or days, so chart those instead.
  const timeline = data.timeline?.points.length ? data.timeline : null;
  const from = cutoff(range).slice(0, 7);
  const points = timeline
    ? timeline.points.map((p) => ({
        label: timeline.unit === 'hour' ? hourName(p.date) : dayLabel(p.date),
        deployments: p.deployments,
        byEnvironment: p.byEnvironment,
      }))
    : data.monthly
        .filter((m) => m.month > from)
        .map((m) => ({
          label: monthLabel(m.month),
          deployments: m.deployments,
          byEnvironment: m.byEnvironment,
        }));
  // The environments busiest in the chart get their own color; the rest share one.
  const counts = new Map<string, number>();
  for (const p of points) {
    for (const [name, n] of Object.entries(p.byEnvironment ?? {}))
      counts.set(name, (counts.get(name) ?? 0) + n);
  }
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name);
  const top = ranked.slice(0, ENV_COLORS.length);
  const hasOthers = ranked.length > top.length;
  const rows = points.map((p) => {
    const row: Record<string, string | number> = { label: p.label };
    for (const name of top) row[name] = p.byEnvironment?.[name] ?? 0;
    if (hasOthers) row.__other = p.deployments - top.reduce((s, n) => s + (p.byEnvironment?.[n] ?? 0), 0);
    return row;
  });
  const span = timeline?.points.length ?? 0;
  const unit = timeline?.unit === 'hour' ? (span === 1 ? 'hour' : 'hours') : span === 1 ? 'day' : 'days';
  // Hourly ticks show the hour, and the date where a new day starts.
  const tick = (label: string) =>
    timeline?.unit === 'hour'
      ? label.endsWith(', 12am')
        ? label.slice(0, -6)
        : label.split(', ')[1]!
      : label;

  return (
    <Box>
      <SectionHeader
        title={timeline ? `Deployments per ${timeline.unit}` : 'Deployments per month'}
        caption={
          timeline
            ? `How often each environment received a deployment over the last ${num(span)} ${unit}${timeline.unit === 'hour' ? ' (UTC)' : ''}`
            : 'How often each environment received a deployment'
        }
        right={
          !timeline && (
            <SegmentedControl
              size="xs"
              value={range}
              onChange={(v) => setRange(v as RangeValue)}
              data={rangeOptions(`${data.monthly[0]!.month}-01`)}
            />
          )
        }
      />
      <BarChart
        h={260}
        data={rows}
        dataKey="label"
        type="stacked"
        series={[
          ...top.map((name, i) => ({ name, label: name, color: ENV_COLORS[i]! })),
          ...(hasOthers ? [{ name: '__other', label: 'Other environments', color: OTHER_ENVS }] : []),
        ]}
        gridAxis="y"
        withLegend
        legendProps={{ verticalAlign: 'top', height: 40 }}
        xAxisProps={{ tickFormatter: tick, minTickGap: 24 }}
        yAxisProps={{ allowDecimals: false }}
        barProps={{ radius: 3, maxBarSize: 22 }}
      />
    </Box>
  );
}

/** Environments as rows: name with its live link, share of deployments and the latest outcome. */
function Environments({ environments }: { environments: DeploymentsResponse['environments'] }) {
  if (!environments.length) return <NoData />;
  // Exact all-time totals when GitHub gave them, otherwise the count among the fetched ones.
  const count = (e: DeploymentsResponse['environments'][number]) => e.total ?? e.deployments;
  const max = Math.max(1, ...environments.map(count));
  return (
    <div className="rank-list">
      <div className="env-row rank-head">
        <div className="rank-head-label">Environment</div>
        <span />
        <div className="rank-head-label rank-head-right">Deploys</div>
        <div className="rank-head-label rank-head-right">Latest</div>
      </div>
      {environments.map((e) => (
        <div key={e.name} className="env-row">
          <Group gap={8} wrap="nowrap" miw={0}>
            <Text size="sm" fw={500} truncate>
              {e.name}
            </Text>
            {e.url && (
              <Tooltip label={`Open ${e.url.replace(/^https?:\/\//, '')}`}>
                <ActionIcon
                  component="a"
                  href={e.url}
                  target="_blank"
                  variant="subtle"
                  color="gray"
                  size="sm"
                  aria-label={`Open ${e.name}`}
                >
                  <IconWorld size={14} />
                </ActionIcon>
              </Tooltip>
            )}
          </Group>
          <div className="rank-track">
            <div
              className="rank-fill"
              style={{
                width: `${(count(e) / max) * 100}%`,
                background: 'var(--mantine-color-indigo-5)',
              }}
            />
          </div>
          <Text size="sm" fw={600} ta="right" className="tabular">
            {num(count(e))}
          </Text>
          <Group gap={6} wrap="nowrap" justify="flex-end">
            <Tooltip label={stateLabel(e.lastState)}>
              <span className="state-dot" style={{ background: stateColor(e.lastState) }} />
            </Tooltip>
            <Text size="xs" c="dimmed" style={{ whiteSpace: 'nowrap' }}>
              {relative(e.lastDeployedAt)}
            </Text>
          </Group>
        </div>
      ))}
    </div>
  );
}

const PAGE = 8;

/** Recent deployments as hairline rows: who, where, which ref and how it went. */
function RecentDeployments({ deployments }: { deployments: DeploymentItem[] }) {
  const { fullName } = useRepoParams();
  const [limit, setLimit] = useState(PAGE);
  if (!deployments.length) return <NoData />;
  return (
    <>
      <div className="rank-list">
        {deployments.slice(0, limit).map((d) => (
          <Anchor
            key={d.id}
            href={
              d.logUrl ?? `https://github.com/${fullName}/deployments/${encodeURIComponent(d.environment)}`
            }
            target="_blank"
            underline="never"
            c="inherit"
            className="pull-row"
          >
            {d.avatarUrl ? (
              <Avatar src={d.avatarUrl} size={22} radius="xl" />
            ) : (
              <Avatar size={22} radius="xl">
                <IconRocket size={12} />
              </Avatar>
            )}
            <Box miw={0}>
              <Group gap={6} wrap="nowrap">
                <Text size="sm" fw={500} truncate>
                  {d.environment}
                </Text>
                <Text size="xs" c="dimmed" ff="monospace" truncate>
                  {d.ref.replace(/^refs\/(heads|tags)\//, '')} · {d.sha}
                </Text>
              </Group>
              <Text size="xs" c="dimmed" truncate>
                {d.creator ? `${d.creator} · ` : ''}
                {relative(d.createdAt)}
              </Text>
            </Box>
            <Group gap={6} wrap="nowrap">
              <span className="state-dot" style={{ background: stateColor(d.state) }} />
              <Text size="xs" c="dimmed" style={{ whiteSpace: 'nowrap' }}>
                {stateLabel(d.state)}
              </Text>
            </Group>
          </Anchor>
        ))}
      </div>
      {deployments.length > limit && (
        <Group justify="center" mt="sm">
          <Button
            variant="subtle"
            color="gray"
            size="compact-sm"
            rightSection={<IconChevronDown size={14} />}
            onClick={() => setLimit((l) => l + PAGE)}
          >
            Show {num(Math.min(PAGE, deployments.length - limit))} more
          </Button>
        </Group>
      )}
    </>
  );
}

export function Deployments() {
  const query = useSection<DeploymentsResponse>('deployments');
  const { fullName } = useRepoParams();

  return (
    <>
      <PageHeader
        title="Deployments"
        icon={<IconRocket size={26} stroke={1.6} />}
        description="Where your code goes live, how often, and whether it worked."
        stats={query.data?.total ? <DeploymentStats data={query.data} /> : undefined}
        onRefresh={query.refresh}
        refreshing={query.refreshing}
      />
      <QueryView query={query}>
        {(data) => {
          if (!data.total) {
            return (
              <EmptyState
                icon={<IconRocket size={28} stroke={1.5} />}
                title="No deployments recorded"
                description="Deployments created through GitHub environments or the Deployments API will appear here."
              />
            );
          }
          const sample = data.sampleSize ?? data.total;
          const limited = sample < data.total;
          const exactTotals = data.environments.some((e) => e.total != null);
          return (
            <>
              <History data={data} />

              {limited && (
                <Group gap={8} wrap="nowrap" mt={36} c="dimmed" align="flex-start">
                  <IconInfoCircle size={16} stroke={1.7} style={{ flex: 'none', marginTop: 2 }} />
                  <Text size="sm">
                    This repository has {num(data.total)} deployments. The environment totals count all of
                    them; the chart and the recent deployments cover the latest {num(sample)}.
                  </Text>
                </Group>
              )}

              <Grid gap={48} mt={limited ? 28 : 44}>
                <Grid.Col span={{ base: 12, lg: 6 }}>
                  <SectionHeader
                    title="Environments"
                    caption={
                      exactTotals
                        ? 'All-time deployments per environment and how the latest one went'
                        : 'Deployments per environment and how the latest one went'
                    }
                  />
                  <Environments environments={data.environments} />
                </Grid.Col>
                <Grid.Col span={{ base: 12, lg: 6 }}>
                  <SectionHeader title="Recent deployments" caption="The latest deployments, newest first" />
                  <RecentDeployments deployments={data.recent} />
                </Grid.Col>
              </Grid>

              <Group justify="center" mt="xl">
                <Button
                  component="a"
                  href={`https://github.com/${fullName}/deployments`}
                  target="_blank"
                  variant="subtle"
                  color="gray"
                  size="compact-sm"
                  leftSection={<MarkGithubIcon size={14} />}
                  rightSection={<IconArrowUpRight size={14} />}
                >
                  See all deployments on GitHub
                </Button>
              </Group>
            </>
          );
        }}
      </QueryView>
    </>
  );
}
