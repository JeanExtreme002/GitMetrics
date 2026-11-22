import {
  ActionIcon,
  Avatar,
  Badge,
  Box,
  Button,
  Code,
  Grid,
  Group,
  Paper,
  Progress,
  SimpleGrid,
  Text,
  ThemeIcon,
  Title,
  Tooltip,
} from '@mantine/core';
import {
  IconAlertTriangle,
  IconArrowUpRight,
  IconCircleCheck,
  IconCircleDashed,
  IconCircleX,
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
} from '@tabler/icons-react';
import { MarkGithubIcon } from '@primer/octicons-react';
import { useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { useParams } from 'react-router';
import type { PullCheck, PullDetail, PullReviewer, PullStage } from '../../../shared/types';
import { NoData, QueryView, RefreshButton, SectionHeader, StatCard, StatGrid } from '../../components/ui';
import { api } from '../../lib/api';
import { date, dateTime, hours, num, relative } from '../../lib/format';
import { slower, span } from '../../lib/pulls';
import { usePull } from '../../lib/queries';

const STATE: Record<string, { label: string; color: string; icon: ReactNode }> = {
  OPEN: { label: 'Open', color: 'green', icon: <IconGitPullRequest size={14} stroke={2} /> },
  MERGED: { label: 'Merged', color: 'violet', icon: <IconGitMerge size={14} stroke={2} /> },
  CLOSED: { label: 'Closed', color: 'red', icon: <IconGitPullRequestClosed size={14} stroke={2} /> },
  DRAFT: { label: 'Draft', color: 'gray', icon: <IconGitPullRequestDraft size={14} stroke={2} /> },
};

const STAGE: Record<PullStage['kind'], string> = {
  opened: 'Opened',
  ready: 'Ready for review',
  'first-review': 'First review',
  approved: 'Approved',
  merged: 'Merged',
  closed: 'Closed',
};

const REVIEW: Record<PullReviewer['state'], { label: string; color: string }> = {
  APPROVED: { label: 'Approved', color: 'green' },
  CHANGES_REQUESTED: { label: 'Changes requested', color: 'orange' },
  COMMENTED: { label: 'Commented', color: 'gray' },
  DISMISSED: { label: 'Dismissed', color: 'gray' },
  PENDING: { label: 'Pending', color: 'yellow' },
};

const CHECK_ICON: Record<PullCheck['conclusion'], ReactNode> = {
  success: <IconCircleCheck size={16} stroke={1.8} color="var(--mantine-color-green-6)" />,
  failure: <IconCircleX size={16} stroke={1.8} color="var(--mantine-color-red-6)" />,
  pending: <IconCircleDashed size={16} stroke={1.8} color="var(--mantine-color-yellow-6)" />,
  skipped: <IconCircleDashed size={16} stroke={1.8} color="var(--mantine-color-dimmed)" />,
  cancelled: <IconCircleDashed size={16} stroke={1.8} color="var(--mantine-color-dimmed)" />,
  neutral: <IconCircleDashed size={16} stroke={1.8} color="var(--mantine-color-dimmed)" />,
};

const people = (who: string[]) =>
  who.length <= 2 ? who.join(' and ') : `${who.slice(0, -1).join(', ')} and ${who.at(-1)}`;

/** "Usually 4h here", and whether this one is far slower than that. */
function compared(value: number | null, usual: number | null): { hint: string; slow: boolean } {
  if (usual === null) return { hint: 'Not enough merged pull requests here to compare', slow: false };
  return { hint: `Usually ${span(usual)} in this repository`, slow: value !== null && slower(value, usual) };
}

/** What the pull request needs next, in one sentence, with how long it has been waiting. */
function WaitingOn({ pull }: { pull: PullDetail }) {
  const w = pull.waitingOn;
  if (!w) return null;
  const waited = w.since ? (Date.now() - new Date(w.since).getTime()) / 3_600_000 : null;
  const forHow = waited === null ? '' : ` for ${span(waited)}`;
  // The repository's usual pace only applies while nobody has reviewed it yet.
  const firstWait = w.kind === 'review' && pull.firstReviewHours === null;
  const usual = pull.baseline.firstReviewHours;
  const late = firstWait && waited !== null && slower(waited, usual);
  const reviewed = pull.reviewers.filter((r) => r.state !== 'PENDING').length;

  const color = late
    ? 'red'
    : { review: 'yellow', author: 'orange', checks: 'red', merge: 'green', draft: 'gray' }[w.kind];
  const faces = pull.reviewers.filter((r) => w.who.includes(r.login));

  const [icon, text, detail]: [ReactNode, string, string | null] =
    w.kind === 'review'
      ? [
          <IconHourglass key="i" size={18} />,
          w.who.length
            ? `Waiting for a review from ${people(w.who)}${forHow}.`
            : `Waiting for a first review${forHow}.`,
          firstWait
            ? usual === null
              ? null
              : `A first review here usually comes within ${span(usual)}.`
            : `Already reviewed by ${num(reviewed)} ${reviewed === 1 ? 'person' : 'people'}.`,
        ]
      : w.kind === 'author'
        ? [
            <IconPencil key="i" size={18} />,
            `Waiting for ${people(w.who) || 'the author'} to address the requested changes${forHow}.`,
            null,
          ]
        : w.kind === 'checks'
          ? [<IconCircleX key="i" size={18} />, 'Checks are failing on the latest commit.', null]
          : w.kind === 'merge'
            ? [<IconGitMerge key="i" size={18} />, `Approved and waiting to be merged${forHow}.`, null]
            : [
                <IconGitPullRequestDraft key="i" size={18} />,
                'Still a draft, not ready for review yet.',
                null,
              ];

  return (
    <Paper
      withBorder
      p="md"
      mb={32}
      className="waiting-on"
      style={{ borderLeft: `3px solid var(--mantine-color-${color}-6)` }}
    >
      <Group gap="sm" wrap="nowrap" align="center" justify="space-between">
        <Group gap="sm" wrap="nowrap" align="center" miw={0}>
          <ThemeIcon variant="light" color={color} size={36} radius="md">
            {late ? <IconAlertTriangle size={19} /> : icon}
          </ThemeIcon>
          <Box miw={0}>
            <Text fw={600}>{text}</Text>
            {detail && (
              <Text size="sm" c="dimmed" mt={2}>
                {detail}
              </Text>
            )}
          </Box>
        </Group>
        {faces.length > 0 && (
          <Avatar.Group spacing="sm" visibleFrom="sm">
            {faces.slice(0, 4).map((r) => (
              <Tooltip key={r.login} label={r.login}>
                <Avatar src={r.avatarUrl} size={30} radius="xl">
                  <IconUsers size={16} />
                </Avatar>
              </Tooltip>
            ))}
          </Avatar.Group>
        )}
      </Group>
    </Paper>
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
              <Badge variant="default" tt="none" radius="sm" className="tabular">
                +{span(s.hours)}
              </Badge>
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
            <Badge variant="light" color="yellow" tt="none" radius="sm" className="tabular">
              +{span((Date.now() - new Date(last.at).getTime()) / 3_600_000)}
            </Badge>
          </div>
        )}
      </div>
    </Box>
  );
}

function Reviewers({ pull }: { pull: PullDetail }) {
  return (
    <Box>
      <SectionHeader title="Reviewers" caption="Who reviewed, and how fast each one answered" />
      {pull.reviewers.length ? (
        <div className="rank-list">
          {pull.reviewers.map((r) => (
            <div key={r.login} className="pr-person">
              <Avatar src={r.avatarUrl} size={24} radius="xl">
                {/* Teams have no picture. */}
                <IconUsers size={14} />
              </Avatar>
              <Box miw={0}>
                <Text size="sm" fw={500} truncate>
                  {r.login}
                </Text>
                <Text size="xs" c="dimmed">
                  {r.responseHours !== null
                    ? `Answered in ${span(r.responseHours)}${r.reviews > 1 ? ` · ${r.reviews} reviews` : ''}`
                    : r.requestedAt
                      ? `Asked ${relative(r.requestedAt)}`
                      : 'Asked'}
                </Text>
              </Box>
              <Badge variant="light" color={REVIEW[r.state].color} tt="none" radius="sm">
                {REVIEW[r.state].label}
              </Badge>
            </div>
          ))}
        </div>
      ) : (
        <NoData>No reviews yet.</NoData>
      )}
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
  const failed = c.list.filter((x) => x.conclusion === 'failure').length;
  const caption = [
    `${num(c.list.length)} on the latest commit${failed ? `, ${num(failed)} failing` : ''}`,
    c.minutes !== null ? `longest took ${Math.max(1, Math.round(c.minutes))} min` : null,
    c.pushesWithChecks > 1 ? `failed on ${num(c.failedPushes)} of ${num(c.pushesWithChecks)} commits` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  // Failures first, then whatever still runs, then the rest by name.
  const order: PullCheck['conclusion'][] = [
    'failure',
    'pending',
    'success',
    'neutral',
    'skipped',
    'cancelled',
  ];
  const list = [...c.list].sort((a, b) => order.indexOf(a.conclusion) - order.indexOf(b.conclusion));
  // How the checks on the latest commit ended, at a glance.
  const parts = [
    { key: 'passed', color: 'green', n: c.list.filter((x) => x.conclusion === 'success').length },
    { key: 'failed', color: 'red', n: failed },
    { key: 'running', color: 'yellow', n: c.list.filter((x) => x.conclusion === 'pending').length },
    {
      key: 'skipped',
      color: 'gray',
      n: c.list.filter((x) => ['skipped', 'cancelled', 'neutral'].includes(x.conclusion)).length,
    },
  ].filter((part) => part.n > 0);
  return (
    <Box>
      <SectionHeader title="Checks" caption={caption} />
      <Progress.Root size={8} radius="xl" mb={8}>
        {parts.map((part) => (
          <Tooltip key={part.key} label={`${num(part.n)} ${part.key}`}>
            <Progress.Section value={(part.n / c.list.length) * 100} color={part.color} />
          </Tooltip>
        ))}
      </Progress.Root>
      <Group gap="md" mb="sm">
        {parts.map((part) => (
          <Group key={part.key} gap={6} wrap="nowrap">
            <span className="legend-dot" style={{ background: `var(--mantine-color-${part.color}-6)` }} />
            <Text size="xs" c="dimmed">
              {num(part.n)} {part.key}
            </Text>
          </Group>
        ))}
      </Group>
      <div className="rank-list">
        {list.map((x) => (
          <div key={x.name} className="pr-check">
            {CHECK_ICON[x.conclusion]}
            <Text size="sm" truncate>
              {x.name}
            </Text>
            <Text size="xs" c="dimmed" className="tabular">
              {x.minutes === null ? '' : x.minutes < 1 ? '<1 min' : `${Math.round(x.minutes)} min`}
            </Text>
          </div>
        ))}
      </div>
    </Box>
  );
}

function Numbers({ pull }: { pull: PullDetail }) {
  const open = pull.state === 'OPEN';
  const review = compared(pull.firstReviewHours, pull.baseline.firstReviewHours);
  const age = compared(pull.ageHours, pull.baseline.mergeHours);
  const size = pull.additions + pull.deletions;
  const pct = pull.sizePercentile;
  const sizeHint =
    pct === null
      ? `${num(pull.changedFiles)} files changed`
      : pct >= 0.5
        ? `Bigger than ${Math.round(pct * 100)}% of the recent merged ones here`
        : `Smaller than ${Math.round((1 - pct) * 100)}% of the recent merged ones here`;
  const slow = (text: string, isSlow: boolean) =>
    isSlow ? (
      <Text component="span" inherit c="red">
        {text}
      </Text>
    ) : (
      text
    );
  return (
    <StatGrid>
      <StatCard
        label="First review after"
        value={slow(
          pull.firstReviewHours !== null ? hours(pull.firstReviewHours) : open ? 'Not yet' : '—',
          review.slow,
        )}
        hint={
          pull.firstReviewHours === null && !open
            ? `${pull.state === 'MERGED' ? 'Merged' : 'Closed'} without a review`
            : review.hint
        }
      />
      <StatCard
        label={pull.state === 'MERGED' ? 'Merged after' : open ? 'Open for' : 'Closed'}
        value={slow(pull.ageHours !== null ? hours(pull.ageHours) : date(pull.closedAt), age.slow)}
        hint={pull.state === 'CLOSED' ? 'Closed without being merged' : age.hint}
      />
      <StatCard
        label="Size"
        value={
          <Group component="span" gap={8} wrap="nowrap" className="tabular" display="inline-flex">
            <span>{num(size)}</span>
            <Text component="span" size="sm" c="green">
              +{num(pull.additions)}
            </Text>
            <Text component="span" size="sm" c="red">
              −{num(pull.deletions)}
            </Text>
          </Group>
        }
        hint={sizeHint}
      />
      <StatCard
        label="Changes requested"
        value={num(pull.rounds.changesRequested)}
        hint={`${num(pull.rounds.commitsAfterFirstReview)} commits after the first review · ${num(pull.rounds.forcePushes)} force pushes`}
      />
    </StatGrid>
  );
}

function Activity({ pull }: { pull: PullDetail }) {
  const tiles: [string, number, ReactNode][] = [
    ['Commits', pull.commits, <IconGitCommit key="i" size={16} stroke={1.7} />],
    ['Files changed', pull.changedFiles, <IconFiles key="i" size={16} stroke={1.7} />],
    ['Comments', pull.comments, <IconMessageCircle key="i" size={16} stroke={1.7} />],
    ['Review threads', pull.reviewThreads, <IconMessages key="i" size={16} stroke={1.7} />],
    ['People involved', pull.participants, <IconUsers key="i" size={16} stroke={1.7} />],
  ];
  return (
    <Box mt={44}>
      <SectionHeader title="Activity" />
      <SimpleGrid cols={{ base: 2, sm: 3 }} spacing="sm">
        {tiles.map(([label, value, icon]) => (
          <div key={label} className="pr-tile">
            <Group gap={6} wrap="nowrap" c="dimmed">
              {icon}
              <Text size="xs" c="dimmed" truncate>
                {label}
              </Text>
            </Group>
            <Text fw={650} fz={22} mt={4} className="tabular">
              {num(value)}
            </Text>
          </div>
        ))}
      </SimpleGrid>
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
      <Box mb={32}>
        <Group justify="space-between" wrap="nowrap" mb={10}>
          <Group gap={8} wrap="nowrap" miw={0}>
            {state && (
              <Badge
                size="lg"
                variant="light"
                color={state.color}
                leftSection={state.icon}
                tt="none"
                radius="sm"
              >
                {state.label}
              </Badge>
            )}
            <Text c="dimmed" fw={500} className="tabular">
              #{number}
            </Text>
          </Group>
          <Group gap="xs" wrap="nowrap">
            {pull && (
              <>
                <Button
                  component="a"
                  href={pull.url}
                  target="_blank"
                  variant="default"
                  leftSection={<MarkGithubIcon size={16} />}
                  rightSection={<IconArrowUpRight size={14} />}
                  visibleFrom="sm"
                >
                  Open on GitHub
                </Button>
                <Tooltip label="Open on GitHub">
                  <ActionIcon
                    component="a"
                    href={pull.url}
                    target="_blank"
                    variant="default"
                    size={36}
                    aria-label="Open on GitHub"
                    hiddenFrom="sm"
                  >
                    <MarkGithubIcon size={16} />
                  </ActionIcon>
                </Tooltip>
              </>
            )}
            <RefreshButton onRefresh={refresh} refreshing={refreshing} />
          </Group>
        </Group>
        <Title order={2} fz={{ base: 21, sm: 26 }} lh={1.3} style={{ overflowWrap: 'anywhere' }}>
          {pull?.title ?? `Pull request #${number}`}
        </Title>
        {pull && (
          <Group gap={8} mt={12} wrap="wrap" align="center">
            <Avatar src={pull.authorAvatarUrl} size={22} radius="xl" />
            <Text size="sm" fw={600}>
              {pull.author ?? 'ghost'}
            </Text>
            <Text size="sm" c="dimmed">
              {pull.state === 'MERGED' ? 'merged' : 'wants to merge'} into
            </Text>
            <Code className="pr-branch">{pull.baseRef}</Code>
            <Text size="sm" c="dimmed">
              from
            </Text>
            <Code className="pr-branch">{pull.headRef}</Code>
            <Text size="sm" c="dimmed">
              · opened {relative(pull.createdAt)}
            </Text>
          </Group>
        )}
      </Box>
      <QueryView query={query}>
        {(data) => (
          <>
            <WaitingOn pull={data} />
            <Numbers pull={data} />
            <Grid gap={40} mt={44}>
              <Grid.Col span={{ base: 12, lg: 6 }}>
                <Timeline pull={data} />
                <Activity pull={data} />
              </Grid.Col>
              <Grid.Col span={{ base: 12, lg: 6 }}>
                <Reviewers pull={data} />
                <Box mt={44}>
                  <Checks pull={data} />
                </Box>
              </Grid.Col>
            </Grid>
            {data.baseline.sample > 0 && (
              <Text size="xs" c="dimmed" mt={44} ta="center">
                Compared with the last {num(data.baseline.sample)} merged pull requests in this repository.
              </Text>
            )}
          </>
        )}
      </QueryView>
    </>
  );
}
