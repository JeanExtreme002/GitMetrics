import {
  Avatar,
  Badge,
  Box,
  Button,
  CloseButton,
  Group,
  Loader,
  SegmentedControl,
  Select,
  Stack,
  Switch,
  Text,
  TextInput,
  Tooltip,
} from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { MarkGithubIcon } from '@primer/octicons-react';
import {
  IconArrowUpRight,
  IconClockHour4,
  IconEye,
  IconFilter,
  IconGitPullRequest,
  IconMessageCircle,
  IconSearch,
  IconUserCheck,
  IconUsers,
} from '@tabler/icons-react';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import type { MyPull, MyPullsResponse, PullFilter } from '../../shared/types';
import { Counter, Counters, EmptyState, PageHeader, QueryView } from '../components/ui';
import { api } from '../lib/api';
import { num, relative } from '../lib/format';
import {
  cutShort,
  githubPullsUrl,
  hasStatus,
  inFilter,
  pullSignals,
  searchText,
  STATUSES,
  type PullStatus,
} from '../lib/pulls';
import { myPullsPath, useBaseline, useMyPulls, useOwners } from '../lib/queries';

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
      <Tooltip label="Comments in the conversation and on the code, plus written reviews">
        <Group gap={4} wrap="nowrap" className="tabular my-pull-comments" justify="flex-end">
          <IconMessageCircle size={14} stroke={1.7} color="var(--mantine-color-dimmed)" />
          <Text size="xs" c={pull.comments ? undefined : 'dimmed'}>
            {num(pull.comments)}
          </Text>
        </Group>
      </Tooltip>
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

/** Approved, failing or unreviewed. */
function StatusSelect({
  value,
  onChange,
}: {
  value: PullStatus | '';
  onChange: (status: PullStatus | '') => void;
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
      data={STATUSES}
      leftSection={<IconFilter size={14} />}
      comboboxProps={{ withinPortal: true }}
    />
  );
}

/** GitHub's totals of open pull requests, for the chosen account. */
function Totals({ owner }: { owner: string }) {
  const { data } = useMyPulls('open', owner);
  if (!data) return null;
  return (
    <Counters>
      <Counter
        icon={IconGitPullRequest}
        value={num(data.counts.authored)}
        label="Authored"
        hint="Open pull requests you opened"
      />
      <Counter
        icon={IconUserCheck}
        value={num(data.counts.assigned)}
        label="Assigned"
        hint="Open pull requests assigned to you"
      />
      <Counter
        icon={IconUsers}
        value={num(data.counts.involved)}
        label="Involved"
        hint="Open pull requests you opened, were assigned, mentioned in or commented on"
      />
      <Counter
        icon={IconEye}
        value={num(data.counts.review)}
        label="Waiting for you"
        hint="Open pull requests waiting for your review, including requests to your teams"
      />
    </Counters>
  );
}

export function MyPulls() {
  const [state, setState] = useState<'open' | 'closed'>('open');
  // Every visit starts from the defaults: the filters only last while you are on the page.
  const [filter, setFilter] = useState<PullFilter>('all');
  const [owner, setOwner] = useState('');
  const [status, setStatus] = useState<PullStatus | ''>('');
  const [drafts, setDrafts] = useState(true);
  const [input, setInput] = useState('');
  const [typed] = useDebouncedValue(input, 400);
  const parsed = searchText(typed);
  const search = parsed && 'text' in parsed ? { text: parsed.text, tab: filter } : undefined;
  const now = searchText(input);
  const invalid = now !== null && 'invalid' in now;
  const query = useMyPulls(state, owner, search);
  /** The draft switch and the status picker, as one check, or null when neither narrows the list. */
  const narrowed =
    state === 'open' && (!drafts || status)
      ? (p: MyPull) => (drafts || !p.isDraft) && (!status || hasStatus(p, status))
      : null;
  const accounts = useAccounts(state, owner, query.data);
  const client = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);

  const refresh = async () => {
    setRefreshing(true);
    try {
      const fresh = await api<MyPullsResponse>(`${myPullsPath(state, owner, search)}&refresh=1`);
      client.setQueryData(
        ['my-pulls', state, owner.toLowerCase(), search?.tab ?? '', search?.text.toLowerCase() ?? ''],
        fresh,
      );
      // The totals on top always come from the open ones.
      if (state === 'closed') await client.invalidateQueries({ queryKey: ['my-pulls', 'open'] });
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
        stats={<Totals owner={owner} />}
        statsFrom="xl"
        onRefresh={refresh}
        refreshing={refreshing}
      />

      <TextInput
        mb="md"
        value={input}
        onChange={(e) => setInput(e.currentTarget.value)}
        placeholder="Search titles, descriptions and comments on GitHub…"
        aria-label="Search pull requests"
        leftSection={<IconSearch size={16} stroke={1.6} />}
        rightSection={
          search && query.isFetching ? (
            <Loader size={14} />
          ) : input ? (
            <CloseButton size="sm" aria-label="Clear the search" onClick={() => setInput('')} />
          ) : null
        }
        error={invalid ? 'Only words: letters, digits, dots and hyphens.' : undefined}
      />

      <Group justify="space-between" mb="md" gap="sm">
        <Box className="filter-scroll">
          <SegmentedControl
            size="xs"
            value={filter}
            onChange={(v) => setFilter(v as PullFilter)}
            data={FILTERS}
          />
        </Box>
        {/* On narrow screens the controls wrap onto more lines instead of running off the screen. */}
        <Group gap="sm" wrap="wrap">
          {state === 'open' && (
            <Switch
              size="xs"
              label="Drafts"
              checked={drafts}
              onChange={(e) => setDrafts(e.currentTarget.checked)}
            />
          )}
          {state === 'open' && <StatusSelect value={status} onChange={setStatus} />}
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
          const pulls = data.pulls.filter((p) => inFilter(p, filter) && (!narrowed || narrowed(p)));
          const matching = search ? ` matching “${search.text}”` : '';
          // Only when GitHub has more than the list brought: otherwise the list is already complete.
          const note = cutShort(data, filter) ? (
            <Stack align="center" gap={8} mt="md">
              <Text size="xs" c="dimmed" ta="center">
                {search
                  ? 'The most recently updated matches, up to 30 for each filter.'
                  : 'The most recently updated ones, up to 30 for each filter.'}
              </Text>
              <Button
                component="a"
                href={githubPullsUrl(state, filter, owner, search?.text)}
                target="_blank"
                variant="subtle"
                color="gray"
                size="compact-sm"
                leftSection={<MarkGithubIcon size={14} />}
                rightSection={<IconArrowUpRight size={14} />}
              >
                See all on GitHub
              </Button>
            </Stack>
          ) : null;
          if (!pulls.length) {
            return (
              <>
                <EmptyState
                  icon={<IconClockHour4 size={28} stroke={1.5} />}
                  title={
                    search
                      ? `No pull request${matching}.`
                      : state === 'open' && status
                        ? 'No pull request in this state.'
                        : EMPTY[filter]
                  }
                  description={
                    search
                      ? 'GitHub looks for every word in titles, descriptions and comments.'
                      : state === 'open'
                        ? undefined
                        : 'Recently closed pull requests show up here.'
                  }
                />
                {search && note}
              </>
            );
          }
          return (
            <>
              <Text size="xs" c="dimmed" mb={8}>
                Showing {num(pulls.length)} {pulls.length === 1 ? 'pull request' : 'pull requests'}
                {matching}
              </Text>
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
