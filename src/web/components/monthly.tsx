import { BarChart, type BarChartSeries } from '@mantine/charts';
import { Box, SegmentedControl, Skeleton } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../lib/api';
import { monthLabel } from '../lib/format';
import { useRepoParams, useRepos } from '../lib/queries';
import { rangeOptions, type RangeValue } from '../lib/ranges';
import { NoData, SectionHeader } from './ui';

type Month = { month: string; opened: number; merged?: number; closed: number };

/**
 * Pull requests or issues per month, with the same time windows as the other history charts.
 * The last 12 months come with the page; longer or shorter windows are counted by GitHub search
 * the first time they are picked, then cached.
 */
export function MonthlyChart({
  kind,
  title,
  caption,
  initial,
  series,
}: {
  kind: 'pr' | 'issue';
  title: string;
  caption: string;
  initial: Month[];
  series: BarChartSeries[];
}) {
  const { owner, repo, fullName } = useRepoParams();
  const { data: repos } = useRepos();
  const createdAt = repos?.repos.find((r) => r.fullName === fullName)?.createdAt;
  const [range, setRange] = useState<RangeValue>('12');

  const remote = useQuery({
    queryKey: ['monthly', owner, repo, kind, range],
    queryFn: () => api<{ months: Month[] }>(`/repos/${owner}/${repo}/monthly/${kind}?range=${range}`),
    enabled: range !== '12',
    staleTime: 10 * 60_000,
  });
  const months = range === '12' ? initial : remote.data?.months;

  return (
    <Box>
      <SectionHeader
        title={title}
        caption={caption}
        right={
          <SegmentedControl
            size="xs"
            value={range}
            onChange={(v) => setRange(v as RangeValue)}
            data={rangeOptions(createdAt)}
          />
        }
      />
      {months ? (
        <BarChart
          h={280}
          data={months}
          dataKey="month"
          series={series}
          gridAxis="y"
          withLegend
          legendProps={{ verticalAlign: 'top', height: 40 }}
          xAxisProps={{ tickFormatter: monthLabel, minTickGap: 24 }}
          yAxisProps={{ allowDecimals: false }}
          barProps={{ radius: [3, 3, 0, 0], maxBarSize: 22 }}
        />
      ) : remote.isError ? (
        <NoData>GitHub search could not count this period right now. Try again in a minute.</NoData>
      ) : (
        <Skeleton h={320} radius="md" />
      )}
    </Box>
  );
}
