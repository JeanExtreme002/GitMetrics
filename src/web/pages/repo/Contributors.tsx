import { BarChart, DonutChart } from '@mantine/charts';
import { Anchor, Avatar, Box, Button, Grid, Group, Loader, SegmentedControl, Text } from '@mantine/core';
import { MarkGithubIcon } from '@primer/octicons-react';
import {
  IconActivity,
  IconArrowUpRight,
  IconChevronDown,
  IconCrown,
  IconLifebuoy,
  IconUsers,
} from '@tabler/icons-react';
import { useState } from 'react';
import type { Contributor, ContributorsResponse } from '../../../shared/types';
import { Counter, Counters, NoData, PageHeader, QueryView, SectionHeader } from '../../components/ui';
import { compact, date, monthLabel, num, percent, relative } from '../../lib/format';
import { useRepoParams, useSection } from '../../lib/queries';
import { cutoff, rangeOptions, type RangeValue } from '../../lib/ranges';

/** The smallest number of people who together wrote half of all commits. */
export function busFactor(contributors: Contributor[]): number {
  const total = contributors.reduce((s, c) => s + c.commits, 0);
  let sum = 0;
  for (let i = 0; i < contributors.length; i++) {
    sum += contributors[i]!.commits;
    if (sum >= total / 2) return i + 1;
  }
  return contributors.length;
}

function ContributorStats({ data }: { data: ContributorsResponse }) {
  const commits = data.contributors.reduce((s, c) => s + c.commits, 0);
  const top = data.contributors[0];
  const hasHistory = (data.history ?? []).length > 0;
  return (
    <Counters>
      <Counter
        icon={IconUsers}
        value={num(data.total)}
        label="Contributors"
        hint="Everyone with a commit, including people without a GitHub account"
      />
      <Counter
        icon={IconActivity}
        value={hasHistory ? num(data.activeLast90Days) : '—'}
        label="Active"
        hint="Committed in the last 90 days"
      />
      <Counter
        icon={IconLifebuoy}
        value={num(busFactor(data.contributors))}
        label="Bus factor"
        hint="The fewest people who together wrote half of all commits"
      />
      <Counter
        icon={IconCrown}
        value={top ? percent(top.commits / Math.max(commits, 1)) : '—'}
        label="Top share"
        hint={top ? `Share of all commits written by ${top.login}` : undefined}
      />
    </Counters>
  );
}

/** People who committed each month and how many of them were there for the first time. */
function History({ history }: { history: ContributorsResponse['history'] }) {
  const [range, setRange] = useState<RangeValue>('12');
  // Months after the cutoff month, so "1Y" is exactly the last 12 months.
  const from = cutoff(range).slice(0, 7);
  const shown = history.filter((m) => m.month > from);
  return (
    <Box>
      <SectionHeader
        title="Contributors per month"
        caption="People who committed in each month, and how many of them were new"
        right={
          <SegmentedControl
            size="xs"
            value={range}
            onChange={(v) => setRange(v as RangeValue)}
            data={rangeOptions(`${history[0]!.month}-01`)}
          />
        }
      />
      <BarChart
        h={280}
        data={shown}
        dataKey="month"
        series={[
          { name: 'active', label: 'Active', color: 'teal.5' },
          { name: 'new', label: 'First commit', color: 'yellow.5' },
        ]}
        gridAxis="y"
        withLegend
        legendProps={{ verticalAlign: 'top', height: 40 }}
        xAxisProps={{ tickFormatter: monthLabel, minTickGap: 24 }}
        yAxisProps={{ allowDecimals: false }}
        barProps={{ radius: [3, 3, 0, 0], maxBarSize: 22 }}
      />
    </Box>
  );
}

const SHARE_COLORS = [
  'var(--mantine-color-teal-5)',
  'var(--mantine-color-cyan-5)',
  'var(--mantine-color-blue-5)',
  'var(--mantine-color-indigo-5)',
  'var(--mantine-color-violet-5)',
];
const OTHERS_COLOR = 'var(--mantine-color-gray-6)';

/** How the commits split between the top five people and everyone else. */
function Share({ contributors }: { contributors: Contributor[] }) {
  const [active, setActive] = useState<string | null>(null);
  if (!contributors.length) return <NoData>No contributors yet.</NoData>;
  const commits = contributors.reduce((s, c) => s + c.commits, 0);
  const top = contributors.slice(0, 5);
  const rest = contributors.slice(5);
  const others = rest.reduce((s, c) => s + c.commits, 0);
  const slices = [
    ...top.map((c, i) => ({
      key: c.login,
      label: c.login,
      avatar: c.avatarUrl as string | null,
      value: c.commits,
      color: SHARE_COLORS[i]!,
    })),
    ...(others
      ? [
          {
            key: '__others',
            label: `${num(rest.length)} others`,
            avatar: null,
            value: others,
            color: OTHERS_COLOR,
          },
        ]
      : []),
  ];
  const bus = busFactor(contributors);
  return (
    <Group gap="xl" wrap="nowrap" align="center">
      <Box className="donut">
        <DonutChart
          data={slices.map((s) => ({
            name: s.label,
            value: s.value,
            color: active && active !== s.key ? 'var(--mantine-color-default-border)' : s.color,
          }))}
          size={176}
          thickness={14}
          paddingAngle={2}
          startAngle={90}
          endAngle={-270}
          pieProps={{ cornerRadius: 2, isAnimationActive: false }}
          strokeWidth={0}
          tooltipDataSource="segment"
          valueFormatter={(v) => `${num(v)} commits`}
        />
        <div className="donut-label">
          <Text fz={30} fw={600} lh={1} className="tabular">
            {num(bus)}
          </Text>
          <Text size="xs" c="dimmed" mt={4} ta="center" maw={110}>
            {bus === 1 ? 'person wrote' : 'people wrote'} half
          </Text>
        </div>
      </Box>
      <div className="rank-list" style={{ flex: 1, minWidth: 0 }}>
        {slices.map((s) => (
          <div
            key={s.key}
            className="legend-row share-legend-row"
            onMouseEnter={() => setActive(s.key)}
            onMouseLeave={() => setActive(null)}
          >
            <span className="lang-dot" style={{ background: s.color, margin: 0 }} />
            <Group gap={8} wrap="nowrap" miw={0}>
              {s.avatar && <Avatar src={s.avatar} size={18} radius="xl" />}
              <Text size="sm" truncate c={s.avatar ? undefined : 'dimmed'}>
                {s.label}
              </Text>
            </Group>
            <Text size="sm" c="dimmed" ta="right" className="tabular">
              {percent(s.value / Math.max(commits, 1))}
            </Text>
          </div>
        ))}
      </div>
    </Group>
  );
}

/** Short people lists: avatar, name, a detail line and a number on the right. */
function PersonList({
  people,
  empty,
  detail,
  value,
}: {
  people: Contributor[];
  empty: string;
  detail: (c: Contributor) => string;
  value: (c: Contributor) => string;
}) {
  if (!people.length) return <NoData>{empty}</NoData>;
  return (
    <div className="rank-list">
      {people.map((c) => (
        <Anchor key={c.login} href={c.url} target="_blank" underline="never" c="inherit" className="pull-row">
          <Avatar src={c.avatarUrl} size={22} radius="xl" />
          <Box miw={0}>
            <Text size="sm" fw={500} truncate>
              {c.login}
            </Text>
            <Text size="xs" c="dimmed" truncate>
              {detail(c)}
            </Text>
          </Box>
          <Text size="sm" fw={600} className="tabular" style={{ whiteSpace: 'nowrap' }}>
            {value(c)}
          </Text>
        </Anchor>
      ))}
    </div>
  );
}

/**
 * GitHub's statistics list at most 100 people, and only commit authors linked to a GitHub account;
 * the total also counts authors without one.
 */
function rankingCaption(listed: number, total: number | null) {
  if (total == null || total <= listed) return 'Ranked by commits on the default branch';
  if (listed >= 100) return `Ranked by commits; GitHub lists the top ${num(listed)} of ${num(total)} people`;
  const missing = total - listed;
  return `Ranked by commits; ${num(missing)} more ${missing === 1 ? 'author has' : 'authors have'} no GitHub account linked`;
}

const PAGE = 25;

/** Everyone ranked by commits: share bar, lines changed and how long they have been around. */
function Ranking({ contributors, hasHistory }: { contributors: Contributor[]; hasHistory: boolean }) {
  const [limit, setLimit] = useState(PAGE);
  if (!contributors.length) return <NoData>No contributors yet.</NoData>;
  const max = Math.max(1, contributors[0]!.commits);
  const commits = contributors.reduce((s, c) => s + c.commits, 0);
  // GitHub reports zero lines for repositories with 10,000+ commits; hide the column then.
  const hasLines = contributors.some((c) => c.additions + c.deletions > 0);
  const rowClass = hasHistory
    ? `rank-row contributor-row${hasLines ? '' : ' contributor-row-nolines'}`
    : 'rank-row';
  return (
    <>
      <div className="rank-list">
        <div className={`${rowClass} rank-head`}>
          <span />
          <div className="rank-head-label">Contributor</div>
          <span />
          {hasHistory && hasLines && (
            <div className="rank-head-label rank-head-right contributor-extra">Lines</div>
          )}
          {hasHistory && <div className="rank-head-label rank-head-right contributor-extra">Active</div>}
          <div className="rank-head-label rank-head-right">Commits</div>
          <div className="rank-head-label rank-head-right">Share</div>
        </div>
        {contributors.slice(0, limit).map((c, i) => (
          <Anchor
            key={c.login}
            href={c.url}
            target="_blank"
            underline="never"
            c="inherit"
            className={rowClass}
          >
            <Text size="xs" c="dimmed" className="tabular rank-pos">
              {String(i + 1).padStart(2, '0')}
            </Text>
            <Group gap={8} wrap="nowrap" miw={0}>
              <Avatar src={c.avatarUrl} size={20} radius="xl" />
              <Text size="sm" fw={500} truncate>
                {c.login}
              </Text>
            </Group>
            <div className="rank-track">
              <div
                className="rank-fill"
                style={{ width: `${(c.commits / max) * 100}%`, background: 'var(--mantine-color-teal-5)' }}
              />
            </div>
            {hasHistory && hasLines && (
              <Group gap={6} wrap="nowrap" justify="flex-end" className="tabular contributor-extra">
                <Text size="xs" c="green">
                  +{compact(c.additions)}
                </Text>
                <Text size="xs" c="red">
                  −{compact(c.deletions)}
                </Text>
              </Group>
            )}
            {hasHistory && (
              <Text size="xs" c="dimmed" ta="right" truncate className="contributor-extra">
                {c.firstWeek ? `${date(c.firstWeek)} → ${relative(c.lastWeek)}` : '—'}
              </Text>
            )}
            <Text size="sm" fw={600} ta="right" className="tabular">
              {num(c.commits)}
            </Text>
            <Text size="xs" c="dimmed" ta="right" className="tabular">
              {percent(c.commits / Math.max(commits, 1))}
            </Text>
          </Anchor>
        ))}
      </div>
      {contributors.length > limit && (
        <Group justify="center" mt="sm">
          <Button
            variant="subtle"
            color="gray"
            size="compact-sm"
            rightSection={<IconChevronDown size={14} />}
            onClick={() => setLimit((l) => l + PAGE)}
          >
            Show {num(Math.min(PAGE, contributors.length - limit))} more
          </Button>
        </Group>
      )}
    </>
  );
}

export function Contributors() {
  const query = useSection<ContributorsResponse>('contributors');
  const { fullName } = useRepoParams();

  return (
    <>
      <PageHeader
        title="Contributors"
        icon={<IconUsers size={26} stroke={1.6} />}
        description="The people behind the code and how the community grows."
        stats={query.data && !query.data.pending ? <ContributorStats data={query.data} /> : undefined}
        onRefresh={query.refresh}
        refreshing={query.refreshing}
      />
      <QueryView query={query}>
        {(data) => {
          const history = data.history ?? [];
          const hasHistory = history.length > 0;
          const newest = data.contributors
            .filter((c) => c.firstWeek)
            .sort((a, b) => b.firstWeek!.localeCompare(a.firstWeek!))
            .slice(0, 6);
          const lately = data.contributors
            .filter((c) => (c.recentCommits ?? 0) > 0)
            .sort((a, b) => b.recentCommits - a.recentCommits)
            .slice(0, 12);
          const listed = data.contributors.length;
          return (
            <>
              {data.historyPending && (
                <Group gap={8} wrap="nowrap" mb={28} c="dimmed" align="flex-start">
                  <Loader size={14} color="gray" style={{ flex: 'none', marginTop: 3 }} />
                  <Text size="sm">
                    GitHub is still computing this repository's contribution history. The monthly chart and
                    recent activity will appear here on their own in a moment.
                  </Text>
                </Group>
              )}

              {hasHistory && <History history={history} />}

              {/* Two independent columns, so a longer list never leaves a gap on the other side. */}
              <Grid gap={48} mt={hasHistory ? 44 : 0}>
                <Grid.Col span={{ base: 12, lg: 6 }}>
                  <SectionHeader
                    title="Who writes the code"
                    caption="Share of all commits on the default branch"
                  />
                  <Share contributors={data.contributors} />
                  {hasHistory && (
                    <Box mt={44}>
                      <SectionHeader
                        title="Newest contributors"
                        caption="The latest people to make a first commit"
                      />
                      <PersonList
                        people={newest}
                        empty="No contributors yet."
                        detail={(c) => `First commit ${date(c.firstWeek)}`}
                        value={(c) => `${num(c.commits)} ${c.commits === 1 ? 'commit' : 'commits'}`}
                      />
                    </Box>
                  )}
                </Grid.Col>
                {hasHistory && (
                  <Grid.Col span={{ base: 12, lg: 6 }}>
                    <SectionHeader title="Most active lately" caption="Commits in the last 90 days" />
                    <PersonList
                      people={lately}
                      empty="Nobody has committed in the last 90 days."
                      detail={(c) => `Last commit ${relative(c.lastWeek)}`}
                      value={(c) => `${num(c.recentCommits)} ${c.recentCommits === 1 ? 'commit' : 'commits'}`}
                    />
                  </Grid.Col>
                )}
              </Grid>

              <Box mt={44}>
                <SectionHeader title="All contributors" caption={rankingCaption(listed, data.total)} />
                <Ranking contributors={data.contributors} hasHistory={hasHistory} />
                <Group justify="center" mt="sm">
                  <Button
                    component="a"
                    href={`https://github.com/${fullName}/graphs/contributors`}
                    target="_blank"
                    variant="subtle"
                    color="gray"
                    size="compact-sm"
                    leftSection={<MarkGithubIcon size={14} />}
                    rightSection={<IconArrowUpRight size={14} />}
                  >
                    See contributors on GitHub
                  </Button>
                </Group>
              </Box>
            </>
          );
        }}
      </QueryView>
    </>
  );
}
