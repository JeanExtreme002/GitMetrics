import { Avatar, Badge, Box, Group, SegmentedControl, Select, Text, Tooltip } from '@mantine/core';
import { useLocalStorage } from '@mantine/hooks';
import {
  IconClockHour4,
  IconEye,
  IconFilter,
  IconGitMerge,
  IconGitPullRequest,
  IconUserCheck,
  IconUsers,
} from '@tabler/icons-react';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import type { MyPull, MyPullsResponse, MyPullsSummary, PullFilter } from '../../shared/types';
import { Counter, Counters, EmptyState, PageHeader, QueryView } from '../components/ui';
import { api } from '../lib/api';
import { hours, num, relative } from '../lib/format';
import { hasStatus, pullSignals, span, STATUSES, type PullStatus } from '../lib/pulls';
import { myPullsPath, useBaseline, useMyPulls, useMySummary, useOwners } from '../lib/queries';

const FILTERS: { value: PullFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'authored', label: 'Authored' },
  { value: 'assigned', label: 'Assigned' },
  { value: 'involved', label: 'Involved' },
  { value: 'review', label: 'Review requested' },
];

const EMPTY: Record<PullFilter, string> = {
  all: 'Nothing here.',
  authored: 'You have no pull requests here.',
  assigned: 'No pull requests are assigned to you.',
  involved: 'You are not involved in any pull request here.',
  review: 'Nobody is waiting for your review. Nice.',
};

const inFilter = (p: MyPull, filter: PullFilter) =>
  filter === 'all' || filter === 'involved' || p.roles.includes(filter);

/** One pull request: where it lives, who opened it, and what it needs, in context. */
function PullRow({ pull }: { pull: MyPull }) {
  const baseline = useBaseline(pull.repo);
  const signals = pullSignals(pull, baseline.data);
  return (
    <Link to={`/r/${pull.owner}/${pull.name}/pull/${pull.number}`} className="my-pull-row">
      <Avatar src={pull.ownerAvatarUrl} size={26} radius="md" />
      <Box miw={0}>
        <Group gap={6} wrap="nowrap">
          <Text size="sm" fw={500} truncate>
            {pull.title}
          </Text>
          {pull.isDraft && (
            <Badge size="xs" variant="default" tt="none" style={{ flex: 'none' }}>
              Draft
            </Badge>
          )}
        </Group>
        <Text size="xs" c="dimmed" truncate>
          {pull.repo}#{pull.number}
          {pull.author ? ` by ${pull.author}` : ''} · updated {relative(pull.updatedAt)}
        </Text>
      </Box>
      <Group gap={6} wrap="nowrap" justify="flex-end" className="my-pull-signals">
        {signals.map((s) => (
          <Tooltip key={s.label} label={s.hint} multiline w={260}>
            <Badge variant="light" color={s.color} tt="none" radius="sm">
              {s.label}
            </Badge>
          </Tooltip>
        ))}
      </Group>
      <Group gap={6} wrap="nowrap" className="tabular my-pull-size" justify="flex-end">
        <Text size="xs" c="green">
          +{num(pull.additions)}
        </Text>
        <Text size="xs" c="red">
          −{num(pull.deletions)}
        </Text>
      </Group>
    </Link>
  );
}

interface Account {
  login: string;
  avatarUrl: string;
}

/**
 * Accounts to filter by: yours and your organizations first, then the owners of any repository
 * you have pull requests in (someone else's project you contributed to, for instance).
 */
function useAccounts(state: 'open' | 'closed', owner: string, data?: MyPullsResponse): Account[] {
  const owners = useOwners();
  const client = useQueryClient();
  const everyone = client.getQueryData<MyPullsResponse>(['my-pulls', state, '']);
  const list = new Map<string, Account>();
  for (const o of owners) list.set(o.login.toLowerCase(), { login: o.login, avatarUrl: o.avatarUrl });
  for (const p of [...(everyone?.pulls ?? []), ...(data?.pulls ?? [])]) {
    if (!list.has(p.owner.toLowerCase()))
      list.set(p.owner.toLowerCase(), { login: p.owner, avatarUrl: p.ownerAvatarUrl });
  }
  // The chosen account stays in the list even before its pull requests load.
  if (owner && !list.has(owner.toLowerCase())) {
    list.set(owner.toLowerCase(), { login: owner, avatarUrl: `https://github.com/${owner}.png?size=40` });
  }
  return [...list.values()];
}

function AccountSelect({
  accounts,
  value,
  onChange,
}: {
  accounts: Account[];
  value: string;
  onChange: (login: string) => void;
}) {
  const avatar = (login: string) =>
    accounts.find((a) => a.login.toLowerCase() === login.toLowerCase())?.avatarUrl;
  return (
    <Select
      size="xs"
      w={190}
      placeholder="All accounts"
      aria-label="Account"
      clearable
      value={value || null}
      onChange={(v) => onChange(v ?? '')}
      data={accounts.map((a) => ({ value: a.login, label: a.login }))}
      leftSection={value ? <Avatar src={avatar(value)} size={16} radius="sm" /> : <IconUsers size={14} />}
      renderOption={({ option }) => (
        <Group gap={8} wrap="nowrap">
          <Avatar src={avatar(option.value)} size={18} radius="sm" />
          <Text size="xs">{option.label}</Text>
        </Group>
      )}
      comboboxProps={{ withinPortal: true }}
    />
  );
}

/** Draft, approved, failing, unreviewed or idle, with how many of the listed ones are in each. */
function StatusSelect({
  value,
  onChange,
  pulls,
}: {
  value: PullStatus | '';
  onChange: (status: PullStatus | '') => void;
  pulls: MyPull[];
}) {
  return (
    <Select
      size="xs"
      w={170}
      placeholder="Any status"
      aria-label="Status"
      clearable
      value={value || null}
      onChange={(v) => onChange((v as PullStatus | null) ?? '')}
      data={STATUSES.map((s) => ({
        value: s.value,
        label: `${s.label} (${num(pulls.filter((p) => hasStatus(p, s.value)).length)})`,
      }))}
      leftSection={<IconFilter size={14} />}
      comboboxProps={{ withinPortal: true }}
    />
  );
}

function Summary() {
  const { data } = useMySummary();
  if (!data) return null;
  return (
    <Counters>
      <Counter
        icon={IconEye}
        value={num(data.waitingForReview)}
        label="Waiting for you"
        hint={
          data.oldestWaitSince
            ? `Pull requests waiting for your review. The oldest was asked for ${relative(data.oldestWaitSince)}.`
            : 'Pull requests waiting for your review'
        }
      />
      <Counter
        icon={IconGitPullRequest}
        value={num(data.openAuthored)}
        label="Yours open"
        hint="Your open pull requests"
      />
      <Counter
        icon={IconUserCheck}
        value={data.reviewTurnaroundHours === null ? '—' : span(data.reviewTurnaroundHours)}
        label="You review in"
        hint={`Median time between being asked for a review and giving it, over your last ${num(data.reviewsSampled)} requested reviews (${hours(data.reviewTurnaroundHours)})`}
      />
      <Counter
        icon={IconGitMerge}
        value={data.timeToMergeHours === null ? '—' : span(data.timeToMergeHours)}
        label="Yours merge in"
        hint={`Median time from opening to merge of your last ${num(data.mergesSampled)} merged pull requests (${hours(data.timeToMergeHours)})`}
      />
    </Counters>
  );
}

export function MyPulls() {
  const [state, setState] = useState<'open' | 'closed'>('open');
  const [filter, setFilter] = useLocalStorage<PullFilter>({
    key: 'gitmetrics:my-pulls-filter',
    defaultValue: 'all',
    getInitialValueInEffect: false,
  });
  const [owner, setOwner] = useLocalStorage<string>({
    key: 'gitmetrics:my-pulls-owner',
    defaultValue: '',
    getInitialValueInEffect: false,
  });
  const [status, setStatus] = useLocalStorage<PullStatus | ''>({
    key: 'gitmetrics:my-pulls-status',
    defaultValue: '',
    getInitialValueInEffect: false,
  });
  const query = useMyPulls(state, owner);
  const accounts = useAccounts(state, owner, query.data);
  const client = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);

  const refresh = async () => {
    setRefreshing(true);
    try {
      const [fresh, summary] = await Promise.all([
        api<MyPullsResponse>(`${myPullsPath(state, owner)}&refresh=1`),
        api<MyPullsSummary>('/pulls/summary?refresh=1'),
      ]);
      client.setQueryData(['my-pulls', state, owner.toLowerCase()], fresh);
      client.setQueryData(['my-pulls', 'summary'], summary);
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Pull requests"
        icon={<IconGitPullRequest size={26} stroke={1.6} />}
        description="What waits on you across every repository, and how each pull request compares with that repository's usual pace."
        stats={<Summary />}
        statsFrom="xl"
        onRefresh={refresh}
        refreshing={refreshing}
      />

      <Group justify="space-between" mb="md" gap="sm">
        <Box className="filter-scroll">
          <SegmentedControl
            size="xs"
            value={filter}
            onChange={(v) => setFilter(v as PullFilter)}
            data={FILTERS.map((f) => ({
              value: f.value,
              // GitHub's totals for open ones. Closed ones only list the latest, so no totals there,
              // and "All" can't be added up exactly from the others.
              label:
                query.data && state === 'open' && f.value !== 'all'
                  ? `${f.label} ${num(query.data.counts[f.value])}`
                  : f.label,
            }))}
          />
        </Box>
        <Group gap="sm" wrap="nowrap">
          {state === 'open' && (
            <StatusSelect
              value={status}
              onChange={setStatus}
              pulls={query.data?.pulls.filter((p) => inFilter(p, filter)) ?? []}
            />
          )}
          <AccountSelect accounts={accounts} value={owner} onChange={setOwner} />
          <SegmentedControl
            size="xs"
            value={state}
            onChange={(v) => setState(v as 'open' | 'closed')}
            data={[
              { value: 'open', label: 'Open' },
              { value: 'closed', label: 'Closed' },
            ]}
          />
        </Group>
      </Group>

      <QueryView query={query}>
        {(data) => {
          // Statuses only apply to open pull requests.
          const pulls = data.pulls.filter(
            (p) => inFilter(p, filter) && (state !== 'open' || !status || hasStatus(p, status)),
          );
          const note =
            state === 'closed' ? (
              <Text size="xs" c="dimmed" mt="md" ta="center">
                The most recently updated ones, up to 30 for each filter.
              </Text>
            ) : null;
          if (!pulls.length) {
            return (
              <EmptyState
                icon={<IconClockHour4 size={28} stroke={1.5} />}
                title={state === 'open' && status ? 'No pull request in this state.' : EMPTY[filter]}
                description={state === 'open' ? undefined : 'Recently closed pull requests show up here.'}
              />
            );
          }
          return (
            <>
              <div className="rank-list">
                {pulls.map((p) => (
                  <PullRow key={`${p.repo}#${p.number}`} pull={p} />
                ))}
              </div>
              {note}
            </>
          );
        }}
      </QueryView>
    </>
  );
}
