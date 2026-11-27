import { DonutChart } from '@mantine/charts';
import { Anchor, Box, Group, Text, Timeline } from '@mantine/core';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import type { RepoSummary } from '../../shared/types';
import { num, percent, relative } from '../lib/format';
import { languageColor } from '../lib/languages';
import { repoPath } from './repo';

/*
 * Pieces shared by the home page and the account pages, so both read the same way.
 */

export function SectionTitle({
  title,
  action,
  caption,
}: {
  title: string;
  action?: ReactNode;
  caption?: string;
}) {
  return (
    <Group justify="space-between" mb="sm" mih={28} align="flex-end">
      <Box>
        <Text fw={600} size="lg">
          {title}
        </Text>
        {caption && (
          <Text size="xs" c="dimmed" mt={2}>
            {caption}
          </Text>
        )}
      </Box>
      {action}
    </Group>
  );
}

/**
 * A donut of repositories by primary language, with a legend in the same hairline rows: the five
 * most used, and the rest as Other.
 */
export function LanguagesDonut({
  title,
  caption,
  counts,
  colorOf = languageColor,
  unit = 'repositories',
}: {
  title: string;
  caption: string;
  counts: [string, number][];
  /** Each name's color: the languages' own colors unless given. */
  colorOf?: (name: string) => string;
  /** What's counted, under the total and in the tooltip. */
  unit?: string;
}) {
  const sorted = [...counts].sort((a, b) => b[1] - a[1]);
  const other = sorted.slice(5).reduce((s, [, c]) => s + c, 0);
  const items: [string, number][] = [
    ...sorted.slice(0, 5),
    ...(other ? [['Other', other] as [string, number]] : []),
  ];
  const total = items.reduce((s, [, c]) => s + c, 0) || 1;
  const max = Math.max(1, ...items.map(([, c]) => c));
  const color = (name: string) => (name === 'Other' ? '#8c959f' : colorOf(name));
  const [active, setActive] = useState<string | null>(null);

  return (
    <Box>
      <SectionTitle title={title} caption={caption} />
      <Group gap="xl" wrap="nowrap" align="center">
        <Box className="donut">
          <DonutChart
            data={items.map(([name, value]) => ({
              name,
              value,
              color: active && active !== name ? 'var(--mantine-color-default-border)' : color(name),
            }))}
            size={176}
            thickness={14}
            paddingAngle={2}
            startAngle={90}
            endAngle={-270}
            pieProps={{ cornerRadius: 2, isAnimationActive: false }}
            strokeWidth={0}
            tooltipDataSource="segment"
            valueFormatter={(v) => `${num(v)} ${unit}`}
          />{' '}
          <div className="donut-label">
            <Text fz={30} fw={600} lh={1} className="tabular">
              {num(total)}
            </Text>
            <Text size="xs" c="dimmed" mt={4}>
              {unit}
            </Text>
          </div>
        </Box>{' '}
        <div className="rank-list no-lines" style={{ flex: 1, minWidth: 0 }}>
          {items.map(([name, count]) => (
            <div
              key={name}
              className="legend-row label-legend-row"
              onMouseEnter={() => setActive(name)}
              onMouseLeave={() => setActive(null)}
            >
              <span className="lang-dot" style={{ background: color(name), margin: 0 }} />
              <Text size="sm" truncate>
                {name}
              </Text>
              <Group gap={10} wrap="nowrap" className="tabular">
                <Text size="sm" fw={600}>
                  {num(count)}
                </Text>
                <Text size="sm" c="dimmed" w={38} ta="right">
                  {count > 0 && count / total < 0.005 ? '<1%' : percent(count / total)}
                </Text>
              </Group>
              {/* Its size next to the largest, in its color. */}
              <div className="rank-track legend-bar">
                <div
                  className="rank-fill"
                  style={{ width: `${(count / max) * 100}%`, background: color(name) }}
                />
              </div>
            </div>
          ))}
        </div>
      </Group>
    </Box>
  );
}

/** The repositories pushed to most recently, as a short timeline. */
export function RecentActivity({ repos }: { repos: RepoSummary[] }) {
  const recent = repos
    .filter((r) => r.pushedAt)
    .sort((a, b) => b.pushedAt!.localeCompare(a.pushedAt!))
    .slice(0, 5);
  return (
    <Box pl={6} pt={18} pb={14} className="activity-card">
      <Timeline bulletSize={9} lineWidth={2} className="activity">
        {recent.map((r) => (
          <Timeline.Item key={r.id}>
            <Anchor
              component={Link}
              to={repoPath(r)}
              c="inherit"
              fw={500}
              size="sm"
              underline="hover"
              truncate
            >
              {r.name}
            </Anchor>
            <Text size="xs" c="dimmed" mt={2}>
              Pushed {relative(r.pushedAt)}
            </Text>
          </Timeline.Item>
        ))}
      </Timeline>
    </Box>
  );
}
