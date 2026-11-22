import { Avatar, Badge, Box, Button, Grid, Group, Paper, Text, ThemeIcon, Tooltip } from '@mantine/core';
import {
  IconAlertTriangle,
  IconArrowUpRight,
  IconCircleCheck,
  IconCircleDashed,
  IconCircleX,
  IconGitMerge,
  IconGitPullRequest,
  IconGitPullRequestDraft,
  IconHourglass,
  IconPencil,
} from '@tabler/icons-react';
import { MarkGithubIcon } from '@primer/octicons-react';
import { useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { useParams } from 'react-router';
import type { PullCheck, PullDetail, PullReviewer, PullStage } from '../../../shared/types';
import { NoData, PageHeader, QueryView, SectionHeader, StatCard, StatGrid } from '../../components/ui';
import { api } from '../../lib/api';
import { date, hours, num, relative } from '../../lib/format';
import { slower, span } from '../../lib/pulls';
import { usePull } from '../../lib/queries';

const STATE: Record<string, { label: string; color: string }> = {
  OPEN: { label: 'Open', color: 'green' },
  MERGED: { label: 'Merged', color: 'violet' },
  CLOSED: { label: 'Closed', color: 'red' },
  DRAFT: { label: 'Draft', color: 'gray' },
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
    <Paper withBorder p="md" mb={36} className={late ? 'waiting-on late' : 'waiting-on'}>
      <Group gap="sm" wrap="nowrap" align="flex-start">
        <ThemeIcon variant="light" color={late ? 'red' : 'gray'} size={32} radius="md">
          {late ? <IconAlertTriangle size={18} /> : icon}
        </ThemeIcon>
        <Box>
          <Text fw={600}>{text}</Text>
          {detail && (
            <Text size="sm" c="dimmed" mt={2}>
              {detail}
            </Text>
          )}
        </Box>
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
                {date(s.at)}
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
                {r.login.slice(0, 1).toUpperCase()}
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
  return (
    <Box>
      <SectionHeader title="Checks" caption={caption} />
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
  const rows: [string, number][] = [
    ['Commits', pull.commits],
    ['Files changed', pull.changedFiles],
    ['Comments', pull.comments],
    ['Review threads', pull.reviewThreads],
    ['People involved', pull.participants],
  ];
  return (
    <Box mt={44}>
      <SectionHeader title="Activity" />
      <div className="rank-list">
        {rows.map(([label, value]) => (
          <Group key={label} justify="space-between" className="pr-fact">
            <Text size="sm">{label}</Text>
            <Text size="sm" fw={600} className="tabular">
              {num(value)}
            </Text>
          </Group>
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
      <PageHeader
        title={pull?.title ?? `Pull request #${number}`}
        icon={<IconGitPullRequest size={26} stroke={1.6} />}
        description={
          pull &&
          state && (
            <Group gap={8} component="span" wrap="wrap">
              <Badge variant="light" color={state.color} tt="none" radius="sm">
                {state.label}
              </Badge>
              <span>
                #{pull.number}
                {pull.author ? ` by ${pull.author}` : ''} · {pull.headRef} → {pull.baseRef} · opened{' '}
                {relative(pull.createdAt)}
              </span>
            </Group>
          )
        }
        actions={
          pull && (
            <Tooltip label="See the code and the conversation on GitHub">
              <Button
                component="a"
                href={pull.url}
                target="_blank"
                variant="default"
                leftSection={<MarkGithubIcon size={16} />}
                rightSection={<IconArrowUpRight size={14} />}
              >
                Open on GitHub
              </Button>
            </Tooltip>
          )
        }
        onRefresh={refresh}
        refreshing={refreshing}
      />
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
