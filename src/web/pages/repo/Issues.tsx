import { DonutChart } from '@mantine/charts';
import { Anchor, Avatar, Badge, Box, Button, Grid, Group, Text } from '@mantine/core';
import { MarkGithubIcon } from '@primer/octicons-react';
import {
  IconArrowUpRight,
  IconCircleCheck,
  IconCircleDot,
  IconClockHour4,
  IconInfoCircle,
  IconMessage,
  IconPercentage,
} from '@tabler/icons-react';
import { useState } from 'react';
import type { IssueItem, IssuesResponse, PersonCount } from '../../../shared/types';
import { MonthlyChart } from '../../components/monthly';
import {
  Counter,
  Counters,
  EmptyState,
  NoData,
  PageHeader,
  PersonAnchor,
  QueryView,
  SectionHeader,
} from '../../components/ui';
import { hours, num, percent, relative, sampleScope } from '../../lib/format';
import { useRepoParams, useSection } from '../../lib/queries';
import { semantic, useVisibleColor } from '../../theme';

function IssueStats({ data }: { data: IssuesResponse }) {
  const total = data.counts.open + data.counts.closed;
  return (
    <Counters>
      <Counter icon={IconCircleDot} value={num(data.counts.open)} label="Open" hint="Open issues" />
      <Counter icon={IconCircleCheck} value={num(data.counts.closed)} label="Closed" hint="Closed issues" />
      <Counter
        icon={IconPercentage}
        value={percent(total ? data.counts.closed / total : null)}
        label="Resolved"
        hint="Share of all issues that are closed"
      />
      <Counter
        icon={IconClockHour4}
        value={hours(data.medianTimeToCloseHours)}
        label="Time to close"
        hint={`Median ${sampleScope(data.sampleSize, total, 'issues')}`}
      />
    </Counters>
  );
}

/** The labels in use as a donut in their own GitHub colors, with a legend beside it. */
function Labels({ labels }: { labels: IssuesResponse['labels'] }) {
  const [active, setActive] = useState<string | null>(null);
  const visible = useVisibleColor();
  if (!labels.length) return <NoData>No labels in use.</NoData>;
  const top = labels.slice(0, 6);
  const max = Math.max(1, ...top.map((l) => l.count));
  return (
    <Group gap="xl" wrap="nowrap" align="center">
      <Box className="donut">
        <DonutChart
          data={top.map((l) => ({
            name: l.name,
            value: l.count,
            color: active && active !== l.name ? 'var(--mantine-color-default-border)' : visible(l.color),
          }))}
          size={176}
          thickness={14}
          paddingAngle={2}
          startAngle={90}
          endAngle={-270}
          pieProps={{ cornerRadius: 2, isAnimationActive: false }}
          strokeWidth={0}
          tooltipDataSource="segment"
          valueFormatter={(v) => `${v} issues`}
        />
        <div className="donut-label">
          <Text fz={30} fw={600} lh={1} className="tabular">
            {num(labels.length)}
          </Text>
          <Text size="xs" c="dimmed" mt={4}>
            {labels.length === 1 ? 'label' : 'labels'}
          </Text>
        </div>
      </Box>
      <div className="rank-list no-lines" style={{ flex: 1, minWidth: 0 }}>
        {top.map((l) => (
          <div
            key={l.name}
            className="legend-row label-legend-row"
            onMouseEnter={() => setActive(l.name)}
            onMouseLeave={() => setActive(null)}
          >
            <span className="lang-dot" style={{ background: visible(l.color), margin: 0 }} />
            <Text size="sm" truncate>
              {l.name}
            </Text>
            <Text size="sm" fw={600} ta="right" className="tabular">
              {num(l.count)}
            </Text>
            {/* How often it's used next to the most used one, in the label's own color. */}
            <div className="rank-track legend-bar">
              <div
                className="rank-fill"
                style={{ width: `${(l.count / max) * 100}%`, background: visible(l.color) }}
              />
            </div>
          </div>
        ))}
      </div>
    </Group>
  );
}

/** The people opening the most issues, as leaderboard rows with their share of all of them. */
function Reporters({ people, analyzed }: { people: PersonCount[]; analyzed: number }) {
  if (!people.length) return <NoData>No reporters yet.</NoData>;
  const top = people.slice(0, 10);
  const max = Math.max(1, ...top.map((p) => p.count));
  return (
    <div className="rank-list lines-between">
      {top.map((p, i) => (
        <PersonAnchor key={p.login} login={p.login} underline="never" c="inherit" className="rank-row">
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
              style={{ width: `${(p.count / max) * 100}%`, background: 'var(--mantine-color-green-6)' }}
            />
          </div>
          <Text size="sm" fw={600} ta="right" className="tabular">
            {num(p.count)}
          </Text>
          <Text size="xs" c="dimmed" ta="right" className="tabular">
            {percent(analyzed ? p.count / analyzed : 0)}
          </Text>
        </PersonAnchor>
      ))}
    </div>
  );
}

/** Issues as hairline rows: author, title with number and age, labels and comments. */
function IssueList({ issues, empty }: { issues: IssueItem[]; empty: string }) {
  if (!issues.length) return <NoData>{empty}</NoData>;
  return (
    <div className="rank-list lines-between">
      {issues.map((i) => (
        <Anchor
          key={i.number}
          href={i.url}
          target="_blank"
          underline="never"
          c="inherit"
          className="pull-row"
        >
          <Avatar src={i.avatarUrl} size={22} radius="xl" />
          <Box miw={0}>
            <Text size="sm" fw={500} truncate>
              {i.title}
            </Text>
            <Group gap={6} wrap="nowrap" mt={2}>
              <Text size="xs" c="dimmed" truncate style={{ flex: 'none', maxWidth: '60%' }}>
                #{i.number} by {i.author} · opened {relative(i.createdAt)}
              </Text>
              {i.labels.slice(0, 2).map((l) => (
                <Badge
                  key={l.name}
                  size="xs"
                  color={`#${l.color}`}
                  variant="light"
                  autoContrast
                  tt="none"
                  style={{ flex: 'none' }}
                >
                  {l.name}
                </Badge>
              ))}
            </Group>
          </Box>
          <Group gap={4} c="dimmed" wrap="nowrap" className="tabular">
            <IconMessage size={14} />
            <Text size="xs">{num(i.comments)}</Text>
          </Group>
        </Anchor>
      ))}
    </div>
  );
}

export function Issues() {
  const query = useSection<IssuesResponse>('issues');
  const { fullName } = useRepoParams();
  const hasData = query.data && query.data.counts.open + query.data.counts.closed > 0;

  return (
    <>
      <PageHeader
        title="Issues"
        icon={<IconCircleDot size={26} stroke={1.6} />}
        description="What people report and ask for, and how fast it gets resolved."
        stats={hasData ? <IssueStats data={query.data!} /> : undefined}
        onRefresh={query.refresh}
        refreshing={query.refreshing}
      />
      <QueryView query={query}>
        {(data) => {
          const total = data.counts.open + data.counts.closed;
          // Only the latest issues are fetched in full; say so when that is not all of them.
          const limited = data.sampleSize < total;
          if (!total) {
            return (
              <EmptyState
                icon={<IconCircleDot size={28} stroke={1.5} />}
                title="No issues yet"
                description="Issues opened on this repository will show up here."
              />
            );
          }
          return (
            <>
              <MonthlyChart
                kind="issue"
                title="Issues per month"
                caption="Opened and closed in each month"
                initial={data.monthly}
                series={[
                  { name: 'opened', label: 'Opened', color: semantic.open },
                  { name: 'closed', label: 'Closed', color: semantic.merged },
                ]}
              />

              {limited && (
                <Group gap={8} wrap="nowrap" mt={36} c="dimmed" align="flex-start">
                  <IconInfoCircle size={16} stroke={1.7} style={{ flex: 'none', marginTop: 2 }} />
                  <Text size="sm">
                    This repository has {num(total)} issues. To keep things fast, the sections below look at
                    the {num(data.sampleSize)} most recent ones; the numbers above cover all of them.
                  </Text>
                </Group>
              )}

              {/* Two independent columns, so a longer list never leaves a gap on the other side. */}
              <Grid gap={48} mt={limited ? 28 : 44}>
                <Grid.Col span={{ base: 12, lg: 6 }}>
                  <SectionHeader
                    title="Top labels"
                    caption={`Most used labels, ${sampleScope(data.sampleSize, total, 'issues')}`}
                  />
                  <Labels labels={data.labels} />
                  <Box mt={44}>
                    <SectionHeader
                      title="Top reporters"
                      caption={`Who opened the most, ${sampleScope(data.sampleSize, total, 'issues')}`}
                    />
                    <Reporters people={data.topAuthors} analyzed={data.sampleSize} />
                  </Box>
                </Grid.Col>
                <Grid.Col span={{ base: 12, lg: 6 }}>
                  <SectionHeader
                    title="Oldest open issues"
                    caption={`Open the longest without a resolution${limited ? `, among the latest ${num(data.sampleSize)}` : ''}`}
                  />
                  <IssueList issues={data.openOldest} empty="No open issues. Inbox zero." />
                  <Box mt={44}>
                    <SectionHeader
                      title="Most discussed"
                      caption={`Open issues with the most comments${limited ? `, among the latest ${num(data.sampleSize)}` : ''}`}
                    />
                    <IssueList issues={data.mostDiscussed ?? []} empty="No open issue has comments yet." />
                  </Box>
                </Grid.Col>
              </Grid>

              <Group justify="center" mt="xl">
                <Button
                  component="a"
                  href={`https://github.com/${fullName}/issues`}
                  target="_blank"
                  variant="subtle"
                  color="gray"
                  size="compact-sm"
                  leftSection={<MarkGithubIcon size={14} />}
                  rightSection={<IconArrowUpRight size={14} />}
                >
                  See all issues on GitHub
                </Button>
              </Group>
            </>
          );
        }}
      </QueryView>
    </>
  );
}
