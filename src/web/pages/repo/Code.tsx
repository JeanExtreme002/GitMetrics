import { DonutChart, Treemap } from '@mantine/charts';
import { Anchor, Box, Button, Grid, Group, Select, Text } from '@mantine/core';
import {
  IconChevronDown,
  IconFile,
  IconFlame,
  IconFolder,
  IconGitCommit,
  IconPlusMinus,
} from '@tabler/icons-react';
import { useState } from 'react';
import type { FileStat, FilesResponse, TreeNode } from '../../../shared/types';
import { Counter, Counters, NoData, PageHeader, QueryView, SectionHeader } from '../../components/ui';
import { compact, num, percent } from '../../lib/format';
import { useRepoParams, useSection } from '../../lib/queries';

const PALETTE = [
  'var(--mantine-color-orange-5)',
  'var(--mantine-color-yellow-5)',
  'var(--mantine-color-teal-5)',
  'var(--mantine-color-cyan-5)',
  'var(--mantine-color-blue-5)',
  'var(--mantine-color-indigo-5)',
  'var(--mantine-color-violet-5)',
  'var(--mantine-color-pink-5)',
];

function HotspotStats({ data }: { data: FilesResponse }) {
  const lines = data.lines ?? { additions: 0, deletions: 0 };
  return (
    <Counters>
      <Counter
        icon={IconGitCommit}
        value={num(data.commitsAnalyzed)}
        label="Commits"
        hint="Commits analyzed; merge commits are skipped"
      />
      <Counter
        icon={IconFile}
        value={num(data.filesTouched)}
        label="Files"
        hint="Files changed at least once"
      />
      <Counter
        icon={IconPlusMinus}
        value={compact(lines.additions + lines.deletions)}
        label="Lines"
        hint={`${num(lines.additions)} added and ${num(lines.deletions)} removed`}
      />
    </Counters>
  );
}

/** "src/app/main.ts" → name "main.ts" and folder "src/app/". */
function splitPath(path: string) {
  const i = path.lastIndexOf('/');
  return i < 0 ? { folder: '', name: path } : { folder: path.slice(0, i + 1), name: path.slice(i + 1) };
}

/** Darker shades for the map, so white labels stay readable on every block. */
const MAP_PALETTE = [
  'var(--mantine-color-orange-7)',
  'var(--mantine-color-teal-7)',
  'var(--mantine-color-blue-7)',
  'var(--mantine-color-violet-7)',
  'var(--mantine-color-pink-7)',
  'var(--mantine-color-cyan-8)',
  'var(--mantine-color-indigo-7)',
  'var(--mantine-color-grape-7)',
];
const FILE_COLOR = 'var(--mantine-color-gray-7)';
const OTHER_COLOR = 'var(--mantine-color-gray-5)';
const MAX_BLOCKS = 24;

interface Block {
  [key: string]: unknown;
  name: string;
  value: number;
  path: string;
  kind: 'folder' | 'file' | 'other';
  color: string;
}

/** Cuts a label to roughly fit a block of the given width. */
function fit(label: string, width: number) {
  const chars = Math.floor(width / 7);
  return label.length <= chars ? label : `${label.slice(0, Math.max(chars - 1, 1))}…`;
}

/** One block of the map: rounded, with the name and, when there is room, the number of changes. */
function MapBlock(props: Record<string, unknown>) {
  const { x, y, width, height, depth, name, value, color, kind } = props as {
    x: number;
    y: number;
    width: number;
    height: number;
    depth: number;
    name: string;
    value: number;
    color: string;
    kind: Block['kind'];
  };
  if (depth !== 1) return <g />;
  const label = kind === 'folder' ? `${name}/` : name;
  return (
    <g className={kind === 'other' ? 'map-block map-block-static' : 'map-block'}>
      <rect
        x={x + 1}
        y={y + 1}
        width={Math.max(width - 2, 0)}
        height={Math.max(height - 2, 0)}
        rx={6}
        fill={color}
      />
      {width > 44 && height > 26 && (
        <text
          x={x + 10}
          y={y + 20}
          fill="#fff"
          fontSize={12}
          fontWeight={600}
          fontFamily="var(--mantine-font-family)"
        >
          {fit(label, width - 20)}
        </text>
      )}
      {width > 44 && height > 46 && (
        <text
          x={x + 10}
          y={y + 36}
          fill="rgba(255,255,255,0.72)"
          fontSize={11}
          fontFamily="var(--mantine-font-family)"
        >
          {fit(`${num(value)} ${value === 1 ? 'change' : 'changes'}`, width - 20)}
        </text>
      )}
    </g>
  );
}

/**
 * A treemap you can walk through: blocks are the folders and files inside the current folder,
 * sized by changes. Clicking a folder opens it, clicking a file opens it on GitHub, and the
 * trail above the map goes back up.
 */
function HotspotMap({ tree, scope }: { tree: FilesResponse['tree']; scope: string }) {
  const { fullName } = useRepoParams();
  const [path, setPath] = useState<string[]>([]);
  // Walk down the saved path; a different commit window may no longer have every folder.
  const trail: TreeNode[] = [tree];
  for (const name of path) {
    const next = trail.at(-1)!.children?.find((c) => c.children && c.name === name);
    if (!next) break;
    trail.push(next);
  }
  const current = trail.at(-1)!;
  const children = current.children ?? [];
  const rest = children.slice(MAX_BLOCKS);
  const blocks: Block[] = [
    ...children.slice(0, MAX_BLOCKS).map((c, i) => ({
      name: c.name,
      value: c.value,
      path: c.path,
      kind: (c.children ? 'folder' : 'file') as Block['kind'],
      color: c.children ? MAP_PALETTE[i % MAP_PALETTE.length]! : FILE_COLOR,
    })),
    ...(rest.length
      ? [
          {
            name: `${num(rest.length)} more`,
            value: rest.reduce((s, c) => s + c.value, 0),
            path: '',
            kind: 'other' as const,
            color: OTHER_COLOR,
          },
        ]
      : []),
  ];
  const open = (node: unknown) => {
    const block = node as Partial<Block>;
    if (block.kind === 'folder' && block.name)
      setPath(
        trail
          .slice(1)
          .map((n) => n.name)
          .concat(block.name),
      );
    if (block.kind === 'file' && block.path) {
      window.open(`https://github.com/${fullName}/blob/HEAD/${block.path}`, '_blank', 'noopener');
    }
  };
  const repoName = fullName.split('/')[1] ?? fullName;

  return (
    <Box>
      <SectionHeader
        title="Where changes happen"
        caption={`Folders and files sized by how many times they changed ${scope}. Click a folder to look inside.`}
      />
      <Group gap={6} mb="sm" wrap="wrap">
        <IconFolder size={15} stroke={1.6} style={{ color: 'var(--mantine-color-dimmed)' }} />
        {trail.map((node, i) => {
          const label = i === 0 ? repoName : node.name;
          const last = i === trail.length - 1;
          return (
            <Group key={node.path || '.'} gap={6} wrap="nowrap">
              {i > 0 && (
                <Text size="sm" c="dimmed">
                  /
                </Text>
              )}
              {last ? (
                <Text size="sm" fw={600} ff="monospace">
                  {label}
                </Text>
              ) : (
                <Anchor
                  component="button"
                  size="sm"
                  ff="monospace"
                  c="dimmed"
                  onClick={() => setPath(path.slice(0, i))}
                >
                  {label}
                </Anchor>
              )}
            </Group>
          );
        })}
      </Group>
      {blocks.length ? (
        <Treemap
          h={340}
          data={blocks}
          valueFormatter={(v) => `${num(v)} changes`}
          treemapProps={{
            content: (p: Record<string, unknown>) => <MapBlock {...p} />,
            onClick: open,
          }}
        />
      ) : (
        <NoData />
      )}
    </Box>
  );
}

/** Rows shown at first, and how many each "Show more" adds. */
const FIRST = 6;
const PAGE = 10;

/**
 * Files or folders ranked by how many commits touched them: name with its folder dimmed before it,
 * a heat bar, the number of commits and the lines changed.
 */
function HotList({ rows, kind }: { rows: FileStat[]; kind: 'blob' | 'tree' }) {
  const { fullName } = useRepoParams();
  const [limit, setLimit] = useState(FIRST);
  if (!rows.length) return <NoData>Nothing changed in these commits.</NoData>;
  const top = Math.max(1, rows[0]!.changes);
  const Icon = kind === 'blob' ? IconFile : IconFolder;
  return (
    <>
      <div className="rank-list lines-between">
        <div className="hot-row rank-head">
          <span />
          <div className="rank-head-label">{kind === 'blob' ? 'File' : 'Folder'}</div>
          <span />
          <div className="rank-head-label rank-head-right">Commits</div>
          <div className="rank-head-label rank-head-right">Lines</div>
        </div>
        {rows.slice(0, limit).map((r, i) => {
          const { folder, name } = kind === 'blob' ? splitPath(r.path) : { folder: '', name: r.path };
          const href =
            r.path === '(root)'
              ? `https://github.com/${fullName}`
              : `https://github.com/${fullName}/${kind}/HEAD/${r.path}`;
          return (
            <Anchor
              key={r.path}
              href={href}
              target="_blank"
              underline="never"
              c="inherit"
              className="hot-row"
              title={r.path}
            >
              <Text size="xs" c="dimmed" className="tabular rank-pos">
                {String(i + 1).padStart(2, '0')}
              </Text>
              <Group gap={8} wrap="nowrap" miw={0}>
                <Icon size={15} stroke={1.6} style={{ flex: 'none', color: 'var(--mantine-color-dimmed)' }} />
                {/* The folder shrinks first, so the file name itself stays readable. */}
                <div className="hot-path">
                  {folder && <span className="hot-folder">{folder}</span>}
                  <span className="hot-name">{name}</span>
                </div>
              </Group>
              <div className="rank-track">
                <div
                  className="rank-fill"
                  style={{
                    width: `${(r.changes / top) * 100}%`,
                    background: 'var(--mantine-color-orange-5)',
                    opacity: 0.45 + 0.55 * (r.changes / top),
                  }}
                />
              </div>
              <Text size="sm" fw={600} ta="right" className="tabular">
                {num(r.changes)}
              </Text>
              <Group gap={6} wrap="nowrap" justify="flex-end" className="tabular">
                <Text size="xs" c="green">
                  +{compact(r.additions)}
                </Text>
                <Text size="xs" c="red">
                  −{compact(r.deletions)}
                </Text>
              </Group>
            </Anchor>
          );
        })}
      </div>
      {rows.length > limit && (
        <Group justify="center" mt="sm">
          <Button
            variant="subtle"
            color="gray"
            size="compact-sm"
            rightSection={<IconChevronDown size={14} />}
            onClick={() => setLimit((l) => l + PAGE)}
          >
            Show {num(Math.min(PAGE, rows.length - limit))} more
          </Button>
        </Group>
      )}
    </>
  );
}

/** File changes grouped by extension, as a donut like the other breakdowns. */
function FileTypes({ types }: { types: FilesResponse['extensions'] }) {
  const [active, setActive] = useState<string | null>(null);
  if (!types.length) return <NoData>No file changes.</NoData>;
  const total = types.reduce((s, t) => s + t.count, 0);
  const color = (i: number) => PALETTE[i % PALETTE.length]!;
  const max = Math.max(1, ...types.map((t) => t.count));
  return (
    <Group gap="xl" wrap="nowrap" align="center">
      <Box className="donut">
        <DonutChart
          data={types.map((t, i) => ({
            name: t.name,
            value: t.count,
            color: active && active !== t.name ? 'var(--mantine-color-default-border)' : color(i),
          }))}
          size={176}
          thickness={14}
          paddingAngle={2}
          startAngle={90}
          endAngle={-270}
          pieProps={{ cornerRadius: 2, isAnimationActive: false }}
          strokeWidth={0}
          tooltipDataSource="segment"
          valueFormatter={(v) => `${num(v)} file changes`}
        />
        <div className="donut-label">
          <Text fz={30} fw={600} lh={1} className="tabular">
            {compact(total)}
          </Text>
          <Text size="xs" c="dimmed" mt={4}>
            file changes
          </Text>
        </div>
      </Box>
      <div className="rank-list no-lines" style={{ flex: 1, minWidth: 0 }}>
        {types.map((t, i) => (
          <div
            key={t.name}
            className="legend-row label-legend-row"
            onMouseEnter={() => setActive(t.name)}
            onMouseLeave={() => setActive(null)}
          >
            <span className="lang-dot" style={{ background: color(i), margin: 0 }} />
            <Text size="sm" ff="monospace" truncate>
              {t.name}
            </Text>
            <Text size="sm" c="dimmed" ta="right" className="tabular">
              {percent(t.count / total)}
            </Text>
            {/* How many changes next to the most changed type, in its color. */}
            <div className="rank-track legend-bar">
              <div
                className="rank-fill"
                style={{ width: `${(t.count / max) * 100}%`, background: color(i) }}
              />
            </div>
          </div>
        ))}
      </div>
    </Group>
  );
}

export function Code() {
  const [commits, setCommits] = useState('100');
  const query = useSection<FilesResponse>('files', { commits });

  return (
    <>
      <PageHeader
        title="Hotspots"
        icon={<IconFlame size={26} stroke={1.6} />}
        description="The files and folders that change the most: often the heart of a project, or code that needs care."
        stats={query.data ? <HotspotStats data={query.data} /> : undefined}
        onRefresh={query.refresh}
        refreshing={query.refreshing}
        actions={
          <Select
            value={commits}
            onChange={(v) => setCommits(v ?? '100')}
            allowDeselect={false}
            w={170}
            aria-label="Commits to analyze"
            data={['50', '100', '200', '300'].map((v) => ({ value: v, label: `Last ${v} commits` }))}
          />
        }
      />
      <QueryView query={query}>
        {(data) => {
          const scope = `in the last ${num(data.commitsAnalyzed)} commits`;
          return (
            <>
              <HotspotMap tree={data.tree} scope={scope} />

              {/* Two independent columns, so a longer list never leaves a gap on the other side. */}
              <Grid gap={48} mt={44}>
                <Grid.Col span={{ base: 12, lg: 6 }}>
                  <SectionHeader
                    title="Most changed files"
                    caption={`How many commits touched each file ${scope}`}
                  />
                  <HotList rows={data.files} kind="blob" />
                </Grid.Col>
                <Grid.Col span={{ base: 12, lg: 6 }}>
                  <SectionHeader
                    title="Most changed folders"
                    caption="A folder counts once per commit, however many of its files changed"
                  />
                  <HotList rows={data.folders} kind="tree" />
                  <Box mt={44}>
                    <SectionHeader title="File types" caption={`File changes by extension ${scope}`} />
                    <FileTypes types={data.extensions} />
                  </Box>
                </Grid.Col>
              </Grid>
            </>
          );
        }}
      </QueryView>
    </>
  );
}
