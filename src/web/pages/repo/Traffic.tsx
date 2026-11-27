import { AreaChart } from '@mantine/charts';
import { Anchor, Box, Grid, SegmentedControl, Text, Tooltip } from '@mantine/core';
import { IconChartArea, IconCopy, IconDownload, IconEye, IconLock, IconUser } from '@tabler/icons-react';
import { useState } from 'react';
import type { TrafficResponse } from '../../../shared/types';
import {
  Counter,
  Counters,
  EmptyState,
  NoData,
  PageHeader,
  QueryView,
  SectionHeader,
} from '../../components/ui';
import { compact, date, dayLabel, num, percent } from '../../lib/format';
import { useRepoParams, useSection } from '../../lib/queries';
import { type TrafficGap, withGaps } from '../../lib/traffic';
import { semantic } from '../../theme';

type Kind = 'views' | 'clones';
type Window = '14' | 'all';

const WINDOW_DAYS = 14;

function TrafficStats({ data }: { data: TrafficResponse }) {
  return (
    <Counters>
      <Counter
        icon={IconEye}
        value={compact(data.views.count)}
        label="Views"
        hint="Page views in the last 14 days"
      />
      <Counter
        icon={IconUser}
        value={compact(data.views.uniques)}
        label="Visitors"
        hint="Unique visitors in the last 14 days"
      />
      <Counter
        icon={IconDownload}
        value={compact(data.clones.count)}
        label="Clones"
        hint="Git clones in the last 14 days"
      />
      <Counter
        icon={IconCopy}
        value={compact(data.clones.uniques)}
        label="Cloners"
        hint="Unique cloners in the last 14 days"
      />
    </Counters>
  );
}

interface RankItem {
  key: string;
  label: string;
  href?: string;
  count: number;
  uniques: number;
}

/** Referrers and pages as hairline leaderboard rows: bar for views, unique visitors on the right. */
function TrafficRanking({ items, empty }: { items: RankItem[]; empty: string }) {
  if (!items.length) return <NoData>{empty}</NoData>;
  const max = Math.max(1, ...items.map((i) => i.count));
  const total = items.reduce((s, i) => s + i.count, 0);
  return (
    <div className="rank-list lines-between">
      {items.map((item, i) => {
        const row = (
          <>
            <Text size="xs" c="dimmed" className="tabular rank-pos">
              {String(i + 1).padStart(2, '0')}
            </Text>
            <Text size="sm" fw={500} truncate className="rank-name">
              {item.label}
            </Text>
            <Tooltip label={`${percent(item.count / total)} of these views`}>
              <div className="rank-track">
                <div
                  className="rank-fill"
                  style={{
                    width: `${(item.count / max) * 100}%`,
                    background: 'var(--mantine-color-indigo-4)',
                  }}
                />
              </div>
            </Tooltip>
            <Text size="sm" fw={600} ta="right" className="tabular">
              {num(item.count)}
            </Text>
            <Text size="xs" c="dimmed" ta="right" className="tabular">
              {num(item.uniques)} {item.uniques === 1 ? 'visitor' : 'visitors'}
            </Text>
          </>
        );
        return item.href ? (
          <Anchor
            key={item.key}
            href={item.href}
            target="_blank"
            underline="never"
            c="inherit"
            className="rank-row traffic-row"
          >
            {row}
          </Anchor>
        ) : (
          <div key={item.key} className="rank-row traffic-row">
            {row}
          </div>
        );
      })}
    </div>
  );
}

/** The longest of the gaps. */
const longest = (gaps: TrafficGap[]) => gaps.reduce((a, b) => (b.days > a.days ? b : a));

export function Traffic() {
  const query = useSection<TrafficResponse>('traffic');
  const { fullName } = useRepoParams();
  const [kind, setKind] = useState<Kind>('views');
  const [window, setWindow] = useState<Window>('14');

  return (
    <>
      <PageHeader
        title="Traffic"
        icon={<IconChartArea size={26} stroke={1.6} />}
        description="Who is visiting and cloning this repository, and where they come from."
        stats={query.data?.available ? <TrafficStats data={query.data} /> : undefined}
        onRefresh={query.refresh}
        refreshing={query.refreshing}
      />
      <QueryView query={query}>
        {(data) => {
          if (!data.available) {
            return (
              <EmptyState
                icon={<IconLock size={28} stroke={1.5} />}
                title="Traffic is private"
                description={data.reason}
              />
            );
          }
          // Days GitMetrics wasn't opened in time to save are a break in the chart, not zeros.
          const { days: daily, gaps } = withGaps(data[kind].daily);
          const hasHistory = daily.length > WINDOW_DAYS;
          const all = window === 'all' && hasHistory;
          const series = all ? daily : daily.slice(-WINDOW_DAYS);
          const missing = all ? gaps : [];
          const repoPath = `/${fullName}`;

          return (
            <>
              <Box>
                <SectionHeader
                  title={kind === 'views' ? 'Page views' : 'Git clones'}
                  caption={
                    data.trackedSince
                      ? `GitHub keeps 14 days of traffic. GitMetrics saves every snapshot on this computer, so history builds up from ${date(data.trackedSince)}.`
                      : 'The last 14 days, as reported by GitHub'
                  }
                  right={
                    <>
                      <SegmentedControl
                        size="xs"
                        value={window}
                        onChange={(v) => setWindow(v as Window)}
                        data={[
                          { label: '14 days', value: '14' },
                          { label: 'All tracked', value: 'all', disabled: !hasHistory },
                        ]}
                      />
                      <SegmentedControl
                        size="xs"
                        value={kind}
                        onChange={(v) => setKind(v as Kind)}
                        data={[
                          { label: 'Views', value: 'views' },
                          { label: 'Clones', value: 'clones' },
                        ]}
                      />
                    </>
                  }
                />
                {series.length ? (
                  <AreaChart
                    h={320}
                    data={series}
                    dataKey="date"
                    series={[
                      {
                        name: 'count',
                        label: kind === 'views' ? 'Views' : 'Clones',
                        color: kind === 'views' ? semantic.views : semantic.clones,
                      },
                      {
                        name: 'uniques',
                        label: kind === 'views' ? 'Visitors' : 'Cloners',
                        color: semantic.uniques,
                      },
                    ]}
                    curveType="monotone"
                    withDots={false}
                    gridAxis="y"
                    withLegend
                    legendProps={{ verticalAlign: 'top', height: 40 }}
                    xAxisProps={{ tickFormatter: dayLabel, minTickGap: 32 }}
                    valueFormatter={(value) => (value == null ? 'Not saved' : num(value))}
                    connectNulls={false}
                  />
                ) : (
                  <NoData>No {kind} in the last 14 days.</NoData>
                )}
                {missing.length > 0 && (
                  <Text size="xs" c="dimmed" mt="xs">
                    {missing.length === 1
                      ? `No data from ${date(missing[0]!.from)} to ${date(missing[0]!.to)}`
                      : `No data for ${num(missing.reduce((sum, g) => sum + g.days, 0))} days in ${missing.length} gaps, the longest from ${date(longest(missing).from)} to ${date(longest(missing).to)}`}
                    : GitMetrics wasn't opened within GitHub's 14 days to save it.
                  </Text>
                )}
              </Box>

              <Grid gap={48} mt={44}>
                <Grid.Col span={{ base: 12, lg: 6 }}>
                  <SectionHeader
                    title="Top referrers"
                    caption="Sites that sent visitors here in the last 14 days"
                  />
                  <TrafficRanking
                    empty="No referrers in the last 14 days."
                    items={data.referrers.map((r) => ({
                      key: r.referrer,
                      label: r.referrer,
                      count: r.count,
                      uniques: r.uniques,
                    }))}
                  />
                </Grid.Col>
                <Grid.Col span={{ base: 12, lg: 6 }}>
                  <SectionHeader title="Popular content" caption="Most visited pages of this repository" />
                  <TrafficRanking
                    empty="No page views in the last 14 days."
                    items={data.paths.map((p) => {
                      const relativePath = p.path.startsWith(repoPath)
                        ? p.path.slice(repoPath.length)
                        : p.path;
                      return {
                        key: p.path,
                        label: relativePath && relativePath !== '/' ? relativePath : 'Repository home',
                        href: `https://github.com${p.path}`,
                        count: p.count,
                        uniques: p.uniques,
                      };
                    })}
                  />
                </Grid.Col>
              </Grid>
            </>
          );
        }}
      </QueryView>
    </>
  );
}
