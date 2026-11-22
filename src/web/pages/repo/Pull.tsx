import { BarChart } from '@mantine/charts';
import {
  ActionIcon,
  Avatar,
  Badge,
  Box,
  Button,
  Code,
  Grid,
  Group,
  SegmentedControl,
  Select,
  Skeleton,
  Text,
  Title,
  Tooltip,
} from '@mantine/core';
import { MarkGithubIcon } from '@primer/octicons-react';
import {
  IconArrowUpRight,
  IconCircleCheck,
  IconCircleDashed,
  IconCircleX,
  IconClockHour4,
  IconEye,
  IconFileDiff,
  IconFiles,
  IconGitCommit,
  IconGitMerge,
  IconGitPullRequest,
  IconGitPullRequestClosed,
  IconGitPullRequestDraft,
  IconHourglass,
  IconMessageCircle,
  IconMessages,
  IconPencil,
  IconUsers,
  type Icon,
} from '@tabler/icons-react';
import { useQueryClient } from '@tanstack/react-query';
import { Fragment, useState, type ReactNode } from 'react';
import { useParams } from 'react-router';
import type { PullCheck, PullDetail, PullPhase, PullReviewMark, PullStage } from '../../../shared/types';
import { Counter, Counters, NoData, QueryView, RefreshButton, SectionHeader } from '../../components/ui';
import { api } from '../../lib/api';
import { date, dateTime, dayLabel, hours, num, percent, relative } from '../../lib/format';
import { reviewerActivity, sharedFolder, span, type ReviewerPoint } from '../../lib/pulls';
import { usePull, usePullChurn } from '../../lib/queries';
import { semantic } from '../../theme';

const STATE: Record<string, { label: string; color: string; icon: ReactNode }> = {
  OPEN: { label: 'Open', color: 'green.7', icon: <IconGitPullRequest size={14} stroke={2.2} /> },
  MERGED: { label: 'Merged', color: 'violet.6', icon: <IconGitMerge size={14} stroke={2.2} /> },
  CLOSED: { label: 'Closed', color: 'red.7', icon: <IconGitPullRequestClosed size={14} stroke={2.2} /> },
  DRAFT: { label: 'Draft', color: 'gray.6', icon: <IconGitPullRequestDraft size={14} stroke={2.2} /> },
};

const STAGE: Record<PullStage['kind'], string> = {
  opened: 'Opened',
  ready: 'Ready for review',
  'first-review': 'First review',
  approved: 'Final approval',
  merged: 'Merged',
  closed: 'Closed',
};

const CHECK_ICON: Record<PullCheck['conclusion'], ReactNode> = {
  success: <IconCircleCheck size={16} stroke={1.8} color="var(--mantine-color-green-6)" />,
  failure: <IconCircleX size={16} stroke={1.8} color="var(--mantine-color-red-6)" />,
  pending: <IconCircleDashed size={16} stroke={1.8} color="var(--mantine-color-yellow-6)" />,
  skipped: <IconCircleDashed size={16} stroke={1.8} color="var(--mantine-color-dimmed)" />,
  cancelled: <IconCircleDashed size={16} stroke={1.8} color="var(--mantine-color-dimmed)" />,
  neutral: <IconCircleDashed size={16} stroke={1.8} color="var(--mantine-color-dimmed)" />,
};

/** The stretches of a pull request's life, each with its color. */
const PHASE: Record<PullPhase['kind'], { label: string; color: string }> = {
  draft: { label: 'Draft', color: 'gray.5' },
  waiting: { label: 'Waiting for a first review', color: 'yellow.6' },
  review: { label: 'In review', color: 'blue.5' },
  approved: { label: 'After the final approval', color: 'green.6' },
};

const cssColor = (color: string) => `var(--mantine-color-${color.replace('.', '-')})`;

const people = (who: string[]) =>
  who.length <= 2 ? who.join(' and ') : `${who.slice(0, -1).join(', ')} and ${who.at(-1)}`;

const minutes = (value: number) => (value < 1 ? '<1 min' : `${Math.round(value)} min`);

/** How long it has been open (or took to merge) and how big it is, beside its description. */
function PullStats({ pull }: { pull: PullDetail }) {
  const open = pull.state === 'OPEN';
  return (
    <Counters>
      <Counter
        icon={IconClockHour4}
        value={pull.ageHours !== null ? span(pull.ageHours) : date(pull.closedAt)}
        label={pull.state === 'MERGED' ? 'Merged after' : open ? 'Open for' : 'Closed'}
        hint={
          pull.state === 'CLOSED'
            ? 'Closed without being merged'
            : `${pull.state === 'MERGED' ? 'Merged' : 'Open for'} ${hours(pull.ageHours)}${pull.state === 'MERGED' ? ' after it was opened' : ''}`
        }
      />
      <Counter
        icon={IconFileDiff}
        value={num(pull.additions + pull.deletions)}
        label="Lines changed"
        hint={`+${num(pull.additions)} −${num(pull.deletions)} in ${num(pull.changedFiles)} files`}
      />
    </Counters>
  );
}

/** What went into the pull request, as one compact line under the description. */
function ActivityLine({ pull }: { pull: PullDetail }) {
  const items: [number, string, string, Icon][] = [
    [pull.commits, 'commit', 'commits', IconGitCommit],
    [pull.changedFiles, 'file changed', 'files changed', IconFiles],
    [pull.comments, 'comment', 'comments', IconMessageCircle],
    [pull.reviewThreads, 'review thread', 'review threads', IconMessages],
    [pull.participants, 'person involved', 'people involved', IconUsers],
  ];
  return (
    <Group gap="lg" wrap="wrap" miw={0} style={{ flex: '1 1 420px' }}>
      {items.map(([value, one, many, ItemIcon]) => (
        <Group key={many} gap={6} wrap="nowrap">
          <ItemIcon size={15} stroke={1.7} color="var(--mantine-color-dimmed)" />
          <Text fz={13} c="dimmed">
            <Text component="span" inherit fw={600} c="var(--mantine-color-text)" className="tabular">
              {num(value)}
            </Text>{' '}
            {value === 1 ? one : many}
          </Text>
          {/* The most involved people's faces: who approved first, then most active first. */}
          {many === 'people involved' && pull.involved && pull.involved.length > 0 && (
            <Tooltip.Group openDelay={150} closeDelay={80}>
              <Avatar.Group spacing={6} ml={2}>
                {pull.involved.map((p) => (
                  <Tooltip
                    key={p.login}
                    label={`${p.login}${p.approved ? ' · approved' : ''} · ${num(p.actions)} ${p.actions === 1 ? 'action' : 'actions'}`}
                  >
                    <Avatar src={p.avatarUrl} alt={p.login} size={20} radius="xl" />
                  </Tooltip>
                ))}
              </Avatar.Group>
            </Tooltip.Group>
          )}
        </Group>
      ))}
    </Group>
  );
}

/** What the pull request needs next, as one quiet line under the header. */
function WaitingOn({ pull }: { pull: PullDetail }) {
  const w = pull.waitingOn;
  if (!w) return null;
  const waited = w.since ? (Date.now() - new Date(w.since).getTime()) / 3_600_000 : null;
  const forHow = waited === null ? '' : ` for ${span(waited)}`;
  const reviewed = pull.reviewers.filter((r) => r.state !== 'PENDING').length;

  const [IconFor, color, text, detail]: [Icon, string, string, string | null] =
    w.kind === 'review'
      ? [
          IconHourglass,
          'yellow',
          w.who.length
            ? `Waiting for a review from ${people(w.who)}${forHow}.`
            : `Waiting for a first review${forHow}.`,
          reviewed ? `Already reviewed by ${num(reviewed)} ${reviewed === 1 ? 'person' : 'people'}.` : null,
        ]
      : w.kind === 'author'
        ? [
            IconPencil,
            'orange',
            `Waiting for ${people(w.who) || 'the author'} to address the requested changes${forHow}.`,
            null,
          ]
        : w.kind === 'checks'
          ? [IconCircleX, 'red', 'Checks are failing on the latest commit.', null]
          : w.kind === 'merge'
            ? pull.conflicts
              ? [
                  IconGitMerge,
                  'red',
                  `Approved, but has conflicts with ${pull.baseRef} to resolve before merging.`,
                  null,
                ]
              : [IconGitMerge, 'green', `Approved and waiting to be merged${forHow}.`, null]
            : [IconGitPullRequestDraft, 'gray', 'Still a draft, not ready for review yet.', null];

  // Conflicts rarely hold a review back, so they're said after what the pull request waits on.
  const also =
    pull.conflicts && w.kind !== 'merge' && w.kind !== 'draft' ? `Has conflicts with ${pull.baseRef}.` : null;
  const extra = [detail, also].filter(Boolean).join(' ') || null;

  return (
    <Group gap={8} wrap="nowrap" align="flex-start" mb={36}>
      <IconFor
        size={18}
        stroke={1.8}
        color={`var(--mantine-color-${color}-6)`}
        style={{ flex: 'none', marginTop: 1 }}
      />
      <Text size="sm">
        <Text component="span" inherit fw={600}>
          {text}
        </Text>
        {extra && (
          <Text component="span" inherit c="dimmed">
            {' '}
            {extra}
          </Text>
        )}
      </Text>
    </Group>
  );
}

/** The whole life of the pull request as one bar, split into the stretches it went through. */
/** Review lanes under the time bar, top to bottom, each with its color. */
const LANES: { state: PullReviewMark['state']; label: string; verb: string; color: string }[] = [
  { state: 'APPROVED', label: 'Approvals', verb: 'approved', color: 'green.6' },
  { state: 'CHANGES_REQUESTED', label: 'Changes requested', verb: 'asked for changes', color: 'orange.6' },
  { state: 'COMMENTED', label: 'Commented reviews', verb: 'reviewed with comments', color: 'gray.5' },
  { state: 'DISMISSED', label: 'Dismissed', verb: 'reviewed (later dismissed)', color: 'gray.7' },
];

/** The comments lane's color, also used for comments in the reviewer chart. */
const COMMENTS_COLOR = 'indigo.4';

/** Reviews this close together on the bar (in % of its width) share one dot, with their count. */
const CLUSTER = 1.5;

/** Marks of one lane grouped into dots, each at the average place of the marks in it. */
function clusters<T extends { hours: number }>(marks: T[], total: number) {
  const groups: T[][] = [];
  for (const m of [...marks].sort((a, b) => a.hours - b.hours)) {
    const last = groups.at(-1);
    const pct = (m.hours / total) * 100;
    if (last && pct - (last[0]!.hours / total) * 100 <= CLUSTER) last.push(m);
    else groups.push([m]);
  }
  return groups.map((g) => ({
    marks: g,
    left: Math.min(100, (g.reduce((sum, m) => sum + m.hours, 0) / g.length / total) * 100),
  }));
}

const clock = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' });

/** Dates (or times, for a pull request shorter than two days) along the bar. */
function axisTicks(createdAt: string, total: number) {
  const start = new Date(createdAt).getTime();
  return [0, 0.25, 0.5, 0.75, 1].map((f) => {
    const at = new Date(start + f * total * 3_600_000);
    return { left: f * 100, label: total < 48 ? clock.format(at) : dayLabel(at.toISOString()) };
  });
}

function TimeSpent({ pull }: { pull: PullDetail }) {
  const total = pull.phases.reduce((sum, p) => sum + p.hours, 0);
  if (!total) return null;
  const until = pull.state === 'MERGED' ? 'merged' : pull.state === 'CLOSED' ? 'closed' : 'now';
  const reviewed = pull.firstReviewHours !== null;
  const label = (kind: PullPhase['kind']) =>
    kind === 'approved'
      ? pull.state === 'OPEN'
        ? 'After the final approval, waiting to be merged'
        : `After the final approval, until ${until}`
      : kind === 'waiting' && pull.state !== 'OPEN' && !reviewed
        ? `No review, until ${until}`
        : kind === 'review'
          ? pull.phases.some((p) => p.kind === 'approved')
            ? 'In review, until the final approval'
            : pull.state === 'OPEN'
              ? 'In review'
              : `In review, until ${until}`
          : PHASE[kind].label;
  // The legend adds up each kind: a pull request can go back to draft, for instance.
  const kinds = [...new Set(pull.phases.map((p) => p.kind))].map((kind) => ({
    kind,
    hours: pull.phases.filter((p) => p.kind === kind).reduce((sum, p) => sum + p.hours, 0),
    ongoing: pull.phases.at(-1)!.ongoing && pull.phases.at(-1)!.kind === kind,
  }));
  const lanes: {
    key: string;
    label: string;
    verb: string;
    color: string;
    marks: { hours: number; login: string; at: string }[];
  }[] = [
    // The author's side: every commit, by the date written in it.
    {
      key: 'commits',
      label: 'Commits',
      verb: 'committed',
      color: semantic.commits,
      marks: pull.commitMarks ?? [],
    },
    ...LANES.map((lane) => ({
      key: lane.state,
      label: lane.label,
      verb: lane.verb,
      color: lane.color,
      marks: pull.reviewMarks.filter((m) => m.state === lane.state),
    })),
    // The discussion itself: every comment, in the conversation and on the code.
    {
      key: 'comments',
      label: 'Comments',
      verb: 'commented',
      color: COMMENTS_COLOR,
      marks: pull.commentMarks ?? [],
    },
  ].filter((lane) => lane.marks.length > 0);
  return (
    <Box mb={44}>
      <SectionHeader
        title="Activity over time"
        caption={`Each stretch of its ${hours(total)} from opening to ${until}, and every commit, review and comment on the way. Commits go by the date written in them`}
      />
      {/* One time scale for everything: the stretches on top, a lane per kind of review below. */}
      <div className="pr-time">
        <Text size="xs" c="dimmed">
          Stretches
        </Text>
        <div className="pr-time-bar">
          {pull.phases.map((p, i) => (
            <Tooltip key={i} label={`${label(p.kind)}: ${hours(p.hours)}`}>
              <div
                className="pr-time-segment"
                style={{ flexGrow: p.hours, background: cssColor(PHASE[p.kind].color) }}
              />
            </Tooltip>
          ))}
        </div>
        {lanes.map((lane) => (
          <Fragment key={lane.key}>
            <Text size="xs" c="dimmed" lh={1.3}>
              {lane.label}{' '}
              <Text component="span" inherit fw={600} c="var(--mantine-color-text)" className="tabular">
                {num(lane.marks.length)}
              </Text>
            </Text>
            <div className="pr-lane">
              {clusters(lane.marks, total).map((c, i) => (
                <Tooltip
                  key={i}
                  multiline
                  w={260}
                  label={c.marks
                    .slice(0, 6)
                    .map((m) => `${m.login} ${lane.verb} · ${dateTime(m.at)}`)
                    .concat(c.marks.length > 6 ? [`and ${c.marks.length - 6} more`] : [])
                    .join('\n')}
                  style={{ whiteSpace: 'pre-line' }}
                >
                  <span
                    className={c.marks.length > 1 ? 'pr-dot pr-dot-many' : 'pr-dot'}
                    style={{ left: `${c.left}%`, background: cssColor(lane.color) }}
                  >
                    {c.marks.length > 1 ? c.marks.length : null}
                  </span>
                </Tooltip>
              ))}
            </div>
          </Fragment>
        ))}
        <span />
        <div className="pr-axis">
          {axisTicks(pull.createdAt, total).map((t) => (
            <Text key={t.left} size="xs" c="dimmed" className="pr-axis-tick" style={{ left: `${t.left}%` }}>
              {t.label}
            </Text>
          ))}
        </div>
      </div>
      <Group gap="xl" mt="lg" wrap="wrap" style={{ rowGap: 'var(--mantine-spacing-sm)' }}>
        {kinds.map((k) => (
          <Group key={k.kind} gap={8} wrap="nowrap" align="flex-start">
            <span className="pr-time-dot" style={{ background: cssColor(PHASE[k.kind].color) }} />
            <Box>
              <Text size="sm" fw={500}>
                {label(k.kind)}
                {k.ongoing ? ' (now)' : ''}
              </Text>
              <Text size="xs" c="dimmed" className="tabular">
                {hours(k.hours)} · {percent(k.hours / total)}
              </Text>
            </Box>
          </Group>
        ))}
      </Group>
    </Box>
  );
}

/** One reviewer at a time: what they did each day (or week), in the review lanes' colors. */
function ReviewerChart({ pull }: { pull: PullDetail }) {
  const activity = reviewerActivity(pull);
  const [picked, setPicked] = useState<string | null>(null);
  if (!activity || activity.people.length === 0) return null;
  const person = activity.people.find((p) => p.login === picked) ?? activity.people[0]!;
  const used = (key: keyof Omit<ReviewerPoint, 'day'>) => person.points.some((p) => p[key] > 0);
  const sum = (...keys: (keyof Omit<ReviewerPoint, 'day'>)[]) =>
    person.points.reduce((total, p) => total + keys.reduce((n, k) => n + p[k], 0), 0);
  const series = [
    ...LANES.filter((l) => used(l.state)).map((l) => ({ name: l.state, label: l.label, color: l.color })),
    ...(used('comments') ? [{ name: 'comments', label: 'Comments', color: COMMENTS_COLOR }] : []),
  ];
  const until = pull.state === 'MERGED' ? 'merge' : pull.state === 'CLOSED' ? 'closing' : 'today';
  return (
    <Box mb={44}>
      <SectionHeader
        title="Reviewer activity"
        caption={`What each reviewer did per ${pull.activity!.unit}, from opening to ${until}${
          activity.comments ? '' : '. Reviews only: GitHub could not list every comment'
        }`}
        right={
          <Select
            size="xs"
            w={200}
            allowDeselect={false}
            value={person.login}
            onChange={setPicked}
            data={activity.people.map((p) => ({ value: p.login, label: p.login }))}
            leftSection={<Avatar src={person.avatarUrl} name={person.login} size={18} />}
            renderOption={({ option }) => {
              const p = activity.people.find((x) => x.login === option.value)!;
              return (
                <Group gap={8} wrap="nowrap" w="100%">
                  <Avatar src={p.avatarUrl} name={p.login} size={18} />
                  <Text size="sm" truncate style={{ flex: 1 }}>
                    {p.login}
                  </Text>
                  <Text size="xs" c="dimmed" className="tabular">
                    {num(p.total)}
                  </Text>
                </Group>
              );
            }}
          />
        }
      />
      {/* What the picked reviewer did over the whole pull request, before the chart spreads it out. */}
      <Box mb="lg">
        <Counters>
          <Counter icon={IconCircleCheck} value={num(sum('APPROVED'))} label="Approvals" />
          <Counter icon={IconPencil} value={num(sum('CHANGES_REQUESTED'))} label="Changes requested" />
          <Counter
            icon={IconEye}
            value={num(sum('APPROVED', 'CHANGES_REQUESTED', 'COMMENTED', 'DISMISSED'))}
            label="Reviews"
            hint="Every review: approvals, requests for changes, with comments, and dismissed"
          />
          {activity.comments && (
            <Counter icon={IconMessageCircle} value={num(sum('comments'))} label="Comments" />
          )}
        </Counters>
      </Box>
      <BarChart
        h={220}
        data={person.points}
        dataKey="day"
        type="stacked"
        series={series}
        gridAxis="y"
        withLegend
        legendProps={{ verticalAlign: 'top', height: 40 }}
        xAxisProps={{ tickFormatter: dayLabel, minTickGap: 24 }}
        yAxisProps={{ allowDecimals: false }}
        barProps={{ radius: [3, 3, 0, 0], maxBarSize: 22 }}
      />
    </Box>
  );
}

function Timeline({ pull }: { pull: PullDetail }) {
  const last = pull.stages.at(-1)!;
  const open = pull.state === 'OPEN';
  return (
    <Box>
      <SectionHeader title="Timeline" caption="Each step, and how long it took after the one before" />
      <div className="pr-timeline">
        {pull.stages.map((s) => (
          <div key={s.kind} className="pr-stage">
            <span className="pr-stage-dot" />
            <Box miw={0}>
              <Text size="sm" fw={500}>
                {STAGE[s.kind]}
              </Text>
              <Text size="xs" c="dimmed">
                {dateTime(s.at)}
              </Text>
            </Box>
            {s.hours !== null && (
              <Text size="xs" c="dimmed" className="tabular">
                +{span(s.hours)}
              </Text>
            )}
          </div>
        ))}
        {open && (
          <div className="pr-stage pending">
            <span className="pr-stage-dot" />
            <Box>
              <Text size="sm" fw={500}>
                Now
              </Text>
              <Text size="xs" c="dimmed">
                Still open
              </Text>
            </Box>
            <Text size="xs" c="yellow" className="tabular">
              +{span((Date.now() - new Date(last.at).getTime()) / 3_600_000)}
            </Text>
          </div>
        )}
      </div>
    </Box>
  );
}

/** Lines changed per folder, with a bar split into additions and deletions. */
function Changes({ pull }: { pull: PullDetail }) {
  if (!pull.folders?.length) return null;
  // A long path every folder starts with is said once, in the caption, instead of on every row.
  const paths = pull.folders.map((f) => f.path).filter((p) => p !== 'Other' && p !== '(root)');
  const shared = sharedFolder(paths);
  const folders = pull.folders.map((f) => ({
    ...f,
    name: shared && f.path.startsWith(shared) ? f.path.slice(shared.length + 1) || '(this folder)' : f.path,
  }));
  const max = Math.max(...folders.map((f) => f.additions + f.deletions), 1);
  return (
    <Box mb={44}>
      <SectionHeader
        title="Where the change is"
        caption={`Lines changed per folder${shared ? ` under ${shared}` : ''}, across all ${num(pull.changedFiles)} ${pull.changedFiles === 1 ? 'file' : 'files'}`}
      />
      <div className="rank-list">
        {folders.map((f) => {
          const lines = f.additions + f.deletions;
          return (
            <div key={f.path} className="pr-folder">
              <Tooltip label={`${f.path} · ${num(f.files)} ${f.files === 1 ? 'file' : 'files'}`}>
                <Text size="sm" fw={500} truncate>
                  {f.name}
                </Text>
              </Tooltip>
              <div className="rank-track pr-folder-track">
                <div
                  style={{ width: `${(f.additions / max) * 100}%`, background: cssColor(semantic.additions) }}
                />
                <div
                  style={{ width: `${(f.deletions / max) * 100}%`, background: cssColor(semantic.deletions) }}
                />
              </div>
              <Group gap={6} wrap="nowrap" justify="flex-end" className="tabular">
                <Text size="xs" c="green">
                  +{num(f.additions)}
                </Text>
                <Text size="xs" c="red">
                  −{num(f.deletions)}
                </Text>
              </Group>
              <Text size="xs" c="dimmed" ta="right" className="tabular">
                {percent(lines / Math.max(pull.additions + pull.deletions, 1))}
              </Text>
            </div>
          );
        })}
      </div>
    </Box>
  );
}

/**
 * The files (or folders) the pull request's commits keep coming back to: how many of its commits
 * touched each one. Merge commits are left out, since they bring the base branch in.
 */
function Recurring({ owner, repo, number }: { owner: string; repo: string; number: string }) {
  const query = usePullChurn(owner, repo, number);
  const [by, setBy] = useState<'files' | 'folders'>('files');
  const churn = query.data?.churn;
  // Nothing recurs with a single commit, and past GitHub's limits there is no exact answer.
  if (query.isError || (query.data && (!churn || churn.commits < 2))) return null;
  const rows = churn ? churn[by] : [];
  // A long path every row starts with is said once, in the caption.
  const dirs = rows.map((r) =>
    by === 'files' ? r.path.slice(0, Math.max(0, r.path.lastIndexOf('/'))) : r.path,
  );
  const shared = rows.length > 1 && dirs.every((d) => d && d !== '(root)') ? sharedFolder(dirs) : '';
  const within = (dir: string) => (shared && dir.startsWith(shared) ? dir.slice(shared.length + 1) : dir);
  return (
    <Box mb={44}>
      <SectionHeader
        title="Changed again and again"
        caption={
          churn
            ? `How many of its ${num(churn.commits)} commits touched each ${by === 'files' ? 'file' : 'folder'}${shared ? ` under ${shared}` : ''}${churn.merges ? `, merge commits left out` : ''}`
            : 'Reading every commit…'
        }
        right={
          <SegmentedControl
            size="xs"
            value={by}
            onChange={(v) => setBy(v as 'files' | 'folders')}
            data={[
              { value: 'files', label: 'Files' },
              { value: 'folders', label: 'Folders' },
            ]}
          />
        }
      />
      <div className="rank-list">
        {!churn &&
          Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="pr-recurring">
              <Skeleton h={12} w={`${70 - i * 10}%`} />
              <Skeleton h={4} />
              <Skeleton h={12} />
            </div>
          ))}
        {churn &&
          rows.map((r) => {
            const slash = r.path.lastIndexOf('/');
            const name = by === 'files' ? r.path.slice(slash + 1) : within(r.path) || '(this folder)';
            const folder = by === 'files' && slash > 0 ? within(r.path.slice(0, slash)) : '';
            return (
              <div key={r.path} className="pr-recurring">
                <Tooltip label={`${r.path} · +${num(r.additions)} −${num(r.deletions)} over these commits`}>
                  <Box miw={0}>
                    <Text size="sm" fw={500} truncate>
                      {name}
                    </Text>
                    {folder && (
                      <Text size="xs" c="dimmed" truncate>
                        {folder}
                      </Text>
                    )}
                  </Box>
                </Tooltip>
                <div className="rank-track">
                  <div
                    className="rank-fill"
                    style={{ width: `${(r.commits / churn.commits) * 100}%`, background: cssColor('teal.5') }}
                  />
                </div>
                <Text size="xs" c="dimmed" ta="right" className="tabular">
                  <Text component="span" inherit fw={600} c="var(--mantine-color-text)">
                    {num(r.commits)}
                  </Text>{' '}
                  of {num(churn.commits)}
                </Text>
              </div>
            );
          })}
      </div>
    </Box>
  );
}

function Checks({ pull }: { pull: PullDetail }) {
  const c = pull.checks;
  if (!c.list.length) {
    return (
      <Box>
        <SectionHeader title="Checks" />
        <NoData>No checks ran on this pull request.</NoData>
      </Box>
    );
  }
  const count = (...kinds: PullCheck['conclusion'][]) =>
    c.list.filter((x) => kinds.includes(x.conclusion)).length;
  const caption = [
    `${num(count('success'))} passed`,
    count('failure') ? `${num(count('failure'))} failing` : null,
    count('pending') ? `${num(count('pending'))} running` : null,
    count('skipped', 'cancelled', 'neutral')
      ? `${num(count('skipped', 'cancelled', 'neutral'))} skipped`
      : null,
    c.minutes !== null ? `longest ${minutes(c.minutes)}` : null,
    c.totalMinutes !== null ? `${minutes(c.totalMinutes)} in total` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  // Failures first, then whatever still runs, then the rest.
  const order: PullCheck['conclusion'][] = [
    'failure',
    'pending',
    'success',
    'neutral',
    'skipped',
    'cancelled',
  ];
  const list = [...c.list].sort((a, b) => order.indexOf(a.conclusion) - order.indexOf(b.conclusion));
  return (
    <Box>
      <SectionHeader title="Checks" caption={`On the latest commit: ${caption}`} />
      <div className="rank-list">
        {list.map((x) => (
          <div key={x.name} className="pr-check">
            {CHECK_ICON[x.conclusion]}
            <Text size="sm" truncate>
              {x.name}
            </Text>
            <Text size="xs" c="dimmed" className="tabular">
              {x.minutes === null ? '' : minutes(x.minutes)}
            </Text>
          </div>
        ))}
      </div>
    </Box>
  );
}

export function Pull() {
  const { owner = '', repo = '', number = '' } = useParams();
  const query = usePull(owner, repo, number);
  const client = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const pull = query.data;
  const state = pull ? STATE[pull.isDraft && pull.state === 'OPEN' ? 'DRAFT' : pull.state]! : null;

  const refresh = async () => {
    setRefreshing(true);
    try {
      const fresh = await api<PullDetail>(`/repos/${owner}/${repo}/pull/${number}?refresh=1`);
      client.setQueryData(['pull', owner.toLowerCase(), repo.toLowerCase(), number], fresh);
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <>
      {/* Title and actions, the state and a short description, what went into it, then the numbers. */}
      <Box mb={32}>
        <Group justify="space-between" align="flex-start" wrap="nowrap" gap="md">
          <Title order={2} fz={{ base: 18, sm: 20 }} fw={600} lh={1.4} style={{ overflowWrap: 'anywhere' }}>
            {pull?.title ?? 'Pull request'}{' '}
            <Text component="span" inherit fw={400} c="dimmed">
              #{number}
            </Text>
          </Title>
          <Group gap="xs" wrap="nowrap" style={{ flex: 'none' }}>
            {pull && (
              <Tooltip label="Open on GitHub">
                <ActionIcon
                  component="a"
                  href={pull.url}
                  target="_blank"
                  variant="default"
                  size={36}
                  aria-label="Open on GitHub"
                >
                  <MarkGithubIcon size={18} />
                </ActionIcon>
              </Tooltip>
            )}
            <RefreshButton onRefresh={refresh} refreshing={refreshing} />
          </Group>
        </Group>
        {pull && state && (
          <Group gap={10} wrap="wrap" align="center" mt={10}>
            <Badge
              variant="filled"
              color={state.color}
              // White on every state: the theme would pick dark text on this green.
              autoContrast={false}
              c="white"
              radius="xl"
              size="lg"
              tt="none"
              fw={600}
              leftSection={state.icon}
              className="pr-state"
            >
              {state.label}
            </Badge>
            {pull.conflicts && (
              <Tooltip
                label={`Conflicts with ${pull.baseRef}, so it can't be merged until they are resolved.`}
              >
                <Badge variant="light" color="red" tt="none" radius="sm" size="lg" fw={600}>
                  Conflicts
                </Badge>
              </Tooltip>
            )}
            <Group gap={6} wrap="wrap" fz={13} c="dimmed" align="center">
              <Avatar src={pull.authorAvatarUrl} size={18} radius="xl" />
              <Text component="span" inherit fw={600} c="var(--mantine-color-text)">
                {pull.author ?? 'ghost'}
              </Text>
              <span>
                {pull.state === 'MERGED'
                  ? 'merged into'
                  : pull.state === 'CLOSED'
                    ? 'wanted to merge into'
                    : 'wants to merge into'}
              </span>
              <Code className="pr-branch">{pull.baseRef}</Code>
              <span>from</span>
              <Code className="pr-branch">{pull.headRef}</Code>
              <span>· opened {relative(pull.createdAt)}</span>
            </Group>
          </Group>
        )}
        {/* What went into it, with the two numbers on the same line, centered with it; when they
            no longer fit beside it, they go to the next line. */}
        {pull && (
          <Group justify="space-between" align="center" wrap="wrap" gap="md" mt={12}>
            <ActivityLine pull={pull} />
            <PullStats pull={pull} />
          </Group>
        )}
      </Box>

      <QueryView query={query}>
        {(data) => (
          <>
            <WaitingOn pull={data} />
            <TimeSpent pull={data} />
            <ReviewerChart pull={data} />
            {/* Two independent columns, so a longer list never leaves a gap on the other side. */}
            <Grid gap={48}>
              <Grid.Col span={{ base: 12, lg: 6 }}>
                <Timeline pull={data} />
                <Box mt={44}>
                  <Checks pull={data} />
                </Box>
              </Grid.Col>
              <Grid.Col span={{ base: 12, lg: 6 }}>
                <Changes pull={data} />
                <Recurring owner={owner} repo={repo} number={number} />
              </Grid.Col>
            </Grid>

            <Group justify="center" mt="xl">
              <Button
                component="a"
                href={data.url}
                target="_blank"
                variant="subtle"
                color="gray"
                size="compact-sm"
                leftSection={<MarkGithubIcon size={14} />}
                rightSection={<IconArrowUpRight size={14} />}
              >
                See it on GitHub
              </Button>
            </Group>
          </>
        )}
      </QueryView>
    </>
  );
}
