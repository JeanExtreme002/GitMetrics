import {
  ActionIcon,
  Avatar,
  Badge,
  Box,
  Button,
  Code,
  Grid,
  Group,
  Text,
  Title,
  Tooltip,
} from '@mantine/core';
import { MarkGithubIcon } from '@primer/octicons-react';
import {
  IconAlertTriangle,
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
import { useState, type ReactNode } from 'react';
import { useParams } from 'react-router';
import type { PullCheck, PullDetail, PullReviewer, PullStage } from '../../../shared/types';
import { Counter, Counters, NoData, QueryView, RefreshButton, SectionHeader } from '../../components/ui';
import { api } from '../../lib/api';
import { date, dateTime, hours, num, relative } from '../../lib/format';
import { slower, span } from '../../lib/pulls';
import { usePull } from '../../lib/queries';

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

/** A value in red when it is far slower than the repository usually is. */
const paced = (text: string, slow: boolean) =>
  slow ? (
    <Text component="span" inherit c="red">
      {text}
    </Text>
  ) : (
    text
  );

/** The pull request's numbers, as counters like every page's header, each with its context. */
function PullStats({ pull }: { pull: PullDetail }) {
  const open = pull.state === 'OPEN';
  const usual = (value: number | null) =>
    value === null ? '' : ` Usually ${span(value)} in this repository.`;
  const size = pull.additions + pull.deletions;
  const pct = pull.sizePercentile;
  return (
    <Counters>
      <Counter
        icon={IconEye}
        value={paced(
          pull.firstReviewHours !== null ? span(pull.firstReviewHours) : open ? 'Not yet' : 'None',
          pull.firstReviewHours !== null && slower(pull.firstReviewHours, pull.baseline.firstReviewHours),
        )}
        label="First review"
        hint={
          pull.firstReviewHours !== null
            ? `First reviewed ${hours(pull.firstReviewHours)} after it was ready.${usual(pull.baseline.firstReviewHours)}`
            : open
              ? `Nobody has reviewed it yet.${usual(pull.baseline.firstReviewHours)}`
              : `${pull.state === 'MERGED' ? 'Merged' : 'Closed'} without a review.`
        }
      />
      <Counter
        icon={IconClockHour4}
        value={paced(
          pull.ageHours !== null ? span(pull.ageHours) : date(pull.closedAt),
          pull.ageHours !== null && slower(pull.ageHours, pull.baseline.mergeHours),
        )}
        label={pull.state === 'MERGED' ? 'Merged after' : open ? 'Open for' : 'Closed'}
        hint={
          pull.state === 'CLOSED'
            ? 'Closed without being merged.'
            : `${pull.state === 'MERGED' ? 'Merged' : 'Open for'} ${hours(pull.ageHours)}${pull.state === 'MERGED' ? ' after it was opened' : ''}.${usual(pull.baseline.mergeHours)}`
        }
      />
      <Counter
        icon={IconFileDiff}
        value={num(size)}
        label="Lines changed"
        hint={`+${num(pull.additions)} −${num(pull.deletions)} in ${num(pull.changedFiles)} files.${
          pct === null
            ? ''
            : pct >= 0.5
              ? ` Bigger than ${Math.round(pct * 100)}% of the recent merged ones here.`
              : ` Smaller than ${Math.round((1 - pct) * 100)}% of the recent merged ones here.`
        }`}
      />
      <Counter
        icon={IconPencil}
        value={num(pull.rounds.changesRequested)}
        label="Changes requested"
        hint={`${num(pull.rounds.commitsAfterFirstReview)} commits after the first review, ${num(pull.rounds.forcePushes)} force pushes.`}
      />
    </Counters>
  );
}

/** What the pull request needs next, as one quiet line under the header. */
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

  const [IconFor, color, text, detail]: [Icon, string, string, string | null] =
    w.kind === 'review'
      ? [
          late ? IconAlertTriangle : IconHourglass,
          late ? 'red' : 'yellow',
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
            IconPencil,
            'orange',
            `Waiting for ${people(w.who) || 'the author'} to address the requested changes${forHow}.`,
            null,
          ]
        : w.kind === 'checks'
          ? [IconCircleX, 'red', 'Checks are failing on the latest commit.', null]
          : w.kind === 'merge'
            ? [IconGitMerge, 'green', `Approved and waiting to be merged${forHow}.`, null]
            : [IconGitPullRequestDraft, 'gray', 'Still a draft, not ready for review yet.', null];

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
        {detail && (
          <Text component="span" inherit c="dimmed">
            {' '}
            {detail}
          </Text>
        )}
      </Text>
    </Group>
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
  const count = (...kinds: PullCheck['conclusion'][]) =>
    c.list.filter((x) => kinds.includes(x.conclusion)).length;
  const caption = [
    `${num(count('success'))} passed`,
    count('failure') ? `${num(count('failure'))} failing` : null,
    count('pending') ? `${num(count('pending'))} running` : null,
    count('skipped', 'cancelled', 'neutral')
      ? `${num(count('skipped', 'cancelled', 'neutral'))} skipped`
      : null,
    c.minutes !== null ? `longest took ${Math.max(1, Math.round(c.minutes))} min` : null,
    c.pushesWithChecks > 1 ? `failed on ${num(c.failedPushes)} of ${num(c.pushesWithChecks)} commits` : null,
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
              {x.minutes === null ? '' : x.minutes < 1 ? '<1 min' : `${Math.round(x.minutes)} min`}
            </Text>
          </div>
        ))}
      </div>
    </Box>
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
    <Group gap="lg" mt={12} wrap="wrap">
      {items.map(([value, one, many, ItemIcon]) => (
        <Group key={many} gap={6} wrap="nowrap">
          <ItemIcon size={15} stroke={1.7} color="var(--mantine-color-dimmed)" />
          <Text fz={13} c="dimmed">
            <Text component="span" inherit fw={600} c="var(--mantine-color-text)" className="tabular">
              {num(value)}
            </Text>{' '}
            {value === 1 ? one : many}
          </Text>
        </Group>
      ))}
    </Group>
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
          <Group gap={10} mt={10} wrap="wrap" align="center">
            <Badge
              variant="filled"
              color={state.color}
              radius="xl"
              size="lg"
              tt="none"
              fw={600}
              leftSection={state.icon}
              className="pr-state"
            >
              {state.label}
            </Badge>
            <Group gap={6} wrap="wrap" fz={13} c="dimmed" align="center">
              <Avatar src={pull.authorAvatarUrl} size={18} radius="xl" />
              <Text component="span" inherit fw={600} c="var(--mantine-color-text)">
                {pull.author ?? 'ghost'}
              </Text>
              <span>{pull.state === 'MERGED' ? 'merged into' : 'wants to merge into'}</span>
              <Code className="pr-branch">{pull.baseRef}</Code>
              <span>from</span>
              <Code className="pr-branch">{pull.headRef}</Code>
              <span>· opened {relative(pull.createdAt)}</span>
            </Group>
          </Group>
        )}
        {pull && <ActivityLine pull={pull} />}
        {pull && (
          <Box mt="lg">
            <PullStats pull={pull} />
          </Box>
        )}
      </Box>

      <QueryView query={query}>
        {(data) => (
          <>
            <WaitingOn pull={data} />
            {/* Two independent columns, so a longer list never leaves a gap on the other side. */}
            <Grid gap={48}>
              <Grid.Col span={{ base: 12, lg: 6 }}>
                <Timeline pull={data} />
                <Box mt={44}>
                  <Reviewers pull={data} />
                </Box>
              </Grid.Col>
              {/* Checks are usually the longest list, so they get a column of their own. */}
              <Grid.Col span={{ base: 12, lg: 6 }}>
                <Checks pull={data} />
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
                See the code and the conversation on GitHub
              </Button>
            </Group>
            {data.baseline.sample > 0 && (
              <Text size="xs" c="dimmed" mt="xs" ta="center">
                Compared with the last {num(data.baseline.sample)} merged pull requests in this repository.
              </Text>
            )}
          </>
        )}
      </QueryView>
    </>
  );
}
