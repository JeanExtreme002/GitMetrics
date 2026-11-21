import { BarChart } from '@mantine/charts';
import { Anchor, Avatar, Badge, Box, Button, Grid, Group, SegmentedControl, Text } from '@mantine/core';
import { MarkGithubIcon } from '@primer/octicons-react';
import {
  IconArrowUpRight,
  IconCalendarRepeat,
  IconCalendarTime,
  IconChevronDown,
  IconDownload,
  IconInfoCircle,
  IconTag,
} from '@tabler/icons-react';
import { useState } from 'react';
import type { ReleaseItem, ReleasesResponse } from '../../../shared/types';
import {
  Counter,
  Counters,
  EmptyState,
  NoData,
  PageHeader,
  QueryView,
  SectionHeader,
} from '../../components/ui';
import { compact, date, monthLabel, num, percent, relative } from '../../lib/format';
import { useRepoParams, useSection } from '../../lib/queries';
import { cutoff, rangeOptions, type RangeValue } from '../../lib/ranges';

/** "12.5 days" → "every 13 days"; short gaps read better in days, long ones in months. */
function cadence(days: number | null) {
  if (days == null) return '—';
  if (days < 1) return 'daily';
  if (days < 60) return `${num(Math.round(days))}d`;
  return `${num(Math.round(days / 30))}mo`;
}

/** Whole days since a date, for "how long since the last release". */
function since(iso: string | null) {
  if (!iso) return '—';
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days < 1) return 'today';
  if (days < 60) return `${num(days)}d`;
  if (days < 730) return `${num(Math.round(days / 30))}mo`;
  return `${num(Math.round(days / 365))}y`;
}

function ReleaseStats({ data }: { data: ReleasesResponse }) {
  const latest = data.releases[0];
  return (
    <Counters>
      <Counter
        icon={IconTag}
        value={num(data.total)}
        label="Releases"
        hint="Published releases, drafts excluded"
      />
      {data.totalDownloads > 0 && (
        <Counter
          icon={IconDownload}
          value={compact(data.totalDownloads)}
          label="Downloads"
          hint={`${num(data.totalDownloads)} downloads of release assets`}
        />
      )}
      <Counter
        icon={IconCalendarRepeat}
        value={cadence(data.medianDaysBetween)}
        label="Cadence"
        hint="Median time between two releases"
      />
      <Counter
        icon={IconCalendarTime}
        value={since(latest?.publishedAt ?? null)}
        label="Since last"
        hint={latest ? `${latest.tag}, published ${date(latest.publishedAt)}` : undefined}
      />
    </Counters>
  );
}

/** Releases per month across the whole history, with the usual time windows. */
function History({ monthly }: { monthly: ReleasesResponse['monthly'] }) {
  const [range, setRange] = useState<RangeValue>('12');
  // Months after the cutoff month, so "1Y" is exactly the last 12 months.
  const from = cutoff(range).slice(0, 7);
  const shown = monthly.filter((m) => m.month > from);
  const hasPre = monthly.some((m) => m.prereleases > 0);
  return (
    <Box>
      <SectionHeader
        title="Releases per month"
        caption={
          hasPre ? 'Stable releases and pre-releases published each month' : 'Releases published each month'
        }
        right={
          <SegmentedControl
            size="xs"
            value={range}
            onChange={(v) => setRange(v as RangeValue)}
            data={rangeOptions(`${monthly[0]!.month}-01`)}
          />
        }
      />
      <BarChart
        h={260}
        data={shown}
        dataKey="month"
        type="stacked"
        series={[
          { name: 'releases', label: 'Stable', color: 'grape.5' },
          ...(hasPre ? [{ name: 'prereleases', label: 'Pre-release', color: 'orange.4' }] : []),
        ]}
        gridAxis="y"
        withLegend={hasPre}
        legendProps={{ verticalAlign: 'top', height: 40 }}
        xAxisProps={{ tickFormatter: monthLabel, minTickGap: 24 }}
        yAxisProps={{ allowDecimals: false }}
        barProps={{ radius: 3, maxBarSize: 22 }}
      />
    </Box>
  );
}

const PAGE = 8;

/** Releases as hairline rows: tag, name, author and age, with downloads on the right. */
function ReleaseList({ releases }: { releases: ReleaseItem[] }) {
  const [limit, setLimit] = useState(PAGE);
  const hasDownloads = releases.some((r) => r.downloads > 0);
  return (
    <>
      <div className="rank-list">
        {releases.slice(0, limit).map((r, i) => (
          <Anchor key={r.id} href={r.url} target="_blank" underline="never" c="inherit" className="pull-row">
            <span className={i === 0 ? 'release-icon release-icon-latest' : 'release-icon'}>
              <IconTag size={13} stroke={1.9} />
            </span>
            <Box miw={0}>
              <Group gap={6} wrap="nowrap">
                <Text size="sm" fw={600} truncate>
                  {r.name}
                </Text>
                {r.name !== r.tag && (
                  <Text size="xs" c="dimmed" ff="monospace" style={{ flex: 'none' }}>
                    {r.tag}
                  </Text>
                )}
                {i === 0 && !r.prerelease && (
                  <Badge size="xs" color="green" variant="light" tt="none" style={{ flex: 'none' }}>
                    Latest
                  </Badge>
                )}
                {r.prerelease && (
                  <Badge size="xs" color="orange" variant="light" tt="none" style={{ flex: 'none' }}>
                    Pre-release
                  </Badge>
                )}
              </Group>
              <Group gap={6} wrap="nowrap" mt={2}>
                {r.avatarUrl && <Avatar src={r.avatarUrl} size={14} radius="xl" />}
                <Text size="xs" c="dimmed" truncate>
                  {r.author ? `${r.author} · ` : ''}
                  {date(r.publishedAt)} · {relative(r.publishedAt)}
                </Text>
              </Group>
            </Box>
            {hasDownloads ? (
              <Group gap={4} c="dimmed" wrap="nowrap" className="tabular">
                <IconDownload size={13} />
                <Text size="xs">{num(r.downloads)}</Text>
              </Group>
            ) : (
              <span />
            )}
          </Anchor>
        ))}
      </div>
      {releases.length > limit && (
        <Group justify="center" mt="sm">
          <Button
            variant="subtle"
            color="gray"
            size="compact-sm"
            rightSection={<IconChevronDown size={14} />}
            onClick={() => setLimit((l) => l + PAGE)}
          >
            Show {num(Math.min(PAGE, releases.length - limit))} more
          </Button>
        </Group>
      )}
    </>
  );
}

/** The releases people download the most, as ranking rows with their share of all downloads. */
function TopDownloads({ releases, total }: { releases: ReleaseItem[]; total: number }) {
  const top = [...releases]
    .filter((r) => r.downloads > 0)
    .sort((a, b) => b.downloads - a.downloads)
    .slice(0, 8);
  if (!top.length) return <NoData>No downloads yet.</NoData>;
  const max = top[0]!.downloads;
  return (
    <div className="rank-list">
      {top.map((r, i) => (
        <Anchor
          key={r.id}
          href={r.url}
          target="_blank"
          underline="never"
          c="inherit"
          className="rank-row release-rank-row"
        >
          <Text size="xs" c="dimmed" className="tabular rank-pos">
            {String(i + 1).padStart(2, '0')}
          </Text>
          <Text size="sm" fw={500} ff="monospace" truncate>
            {r.tag}
          </Text>
          <div className="rank-track">
            <div
              className="rank-fill"
              style={{ width: `${(r.downloads / max) * 100}%`, background: 'var(--mantine-color-teal-5)' }}
            />
          </div>
          <Text size="sm" fw={600} ta="right" className="tabular">
            {compact(r.downloads)}
          </Text>
          <Text size="xs" c="dimmed" ta="right" className="tabular">
            {percent(r.downloads / Math.max(total, 1))}
          </Text>
        </Anchor>
      ))}
    </div>
  );
}

export function Releases() {
  const query = useSection<ReleasesResponse>('releases');
  const { fullName } = useRepoParams();

  return (
    <>
      <PageHeader
        title="Releases"
        icon={<IconTag size={26} stroke={1.6} />}
        description="How often you ship and how many people download what you ship."
        stats={query.data?.total ? <ReleaseStats data={query.data} /> : undefined}
        onRefresh={query.refresh}
        refreshing={query.refreshing}
      />
      <QueryView query={query}>
        {(data) => {
          if (!data.total) {
            return (
              <EmptyState
                icon={<IconTag size={28} stroke={1.5} />}
                title="No releases yet"
                description="Publish a release on GitHub and its history and downloads will appear here."
              />
            );
          }
          const sample = data.sampleSize ?? data.releases.length;
          const limited = sample < data.total;
          const hasDownloads = data.totalDownloads > 0;
          return (
            <>
              <History monthly={data.monthly} />

              {limited && (
                <Group gap={8} wrap="nowrap" mt={36} c="dimmed" align="flex-start">
                  <IconInfoCircle size={16} stroke={1.7} style={{ flex: 'none', marginTop: 2 }} />
                  <Text size="sm">
                    This repository has {num(data.total)} releases. The chart and the sections below cover the
                    latest {num(sample)}.
                  </Text>
                </Group>
              )}

              <Grid gap={48} mt={limited ? 28 : 44}>
                <Grid.Col span={{ base: 12, lg: hasDownloads ? 7 : 12 }}>
                  <SectionHeader title="Release history" caption="Every release, newest first" />
                  <ReleaseList releases={data.releases} />
                </Grid.Col>
                {hasDownloads && (
                  <Grid.Col span={{ base: 12, lg: 5 }}>
                    <SectionHeader title="Most downloaded" caption="Releases by downloads of their assets" />
                    <TopDownloads releases={data.releases} total={data.totalDownloads} />
                  </Grid.Col>
                )}
              </Grid>

              <Group justify="center" mt="xl">
                <Button
                  component="a"
                  href={`https://github.com/${fullName}/releases`}
                  target="_blank"
                  variant="subtle"
                  color="gray"
                  size="compact-sm"
                  leftSection={<MarkGithubIcon size={14} />}
                  rightSection={<IconArrowUpRight size={14} />}
                >
                  See all releases on GitHub
                </Button>
              </Group>
            </>
          );
        }}
      </QueryView>
    </>
  );
}
