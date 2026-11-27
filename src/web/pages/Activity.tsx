import { BarChart } from '@mantine/charts';
import {
  Anchor,
  Autocomplete,
  Avatar,
  Badge,
  Box,
  Button,
  Grid,
  Group,
  SegmentedControl,
  SimpleGrid,
  Skeleton,
  Stack,
  Text,
} from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import {
  IconAt,
  IconChevronDown,
  IconGitMerge,
  IconGitPullRequest,
  IconGitPullRequestClosed,
  IconGitPullRequestDraft,
  IconInfoCircle,
  IconRadar,
  IconWorld,
} from '@tabler/icons-react';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';
import type { ActivityPerson, ActivityPull, ActivityResponse } from '../../shared/types';
import { LanguagesDonut, SectionTitle } from '../components/overview';
import { EmptyState, ErrorState, PageHeader } from '../components/ui';
import { parseAccountQuery } from '../lib/accounts';
import { ApiError, api } from '../lib/api';
import { dayLabel, hours, num, percent, relative } from '../lib/format';
import { useAccountSearch, useActivity, useActivityCommented, useAuth, useOwners } from '../lib/queries';

/*
 * Someone's activity with pull requests: what they open and review, where, and with whom, over a
 * period and in all of GitHub, one account or one repository. Only what your access lets you see.
 */

const PERIODS = [
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' },
  { value: '365', label: '1 year' },
];
const LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;
const REPO = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}\/[A-Za-z0-9_.-]{1,100}$/;

const cssColor = (color: string) => `var(--mantine-color-${color.replace('.', '-')})`;
const COLORS = { opened: 'blue.5', reviews: 'teal.5' } as const;
const REVIEW_STYLE = [
  { key: 'approved', label: 'Approved', color: 'green.6' },
  { key: 'changes', label: 'Changes requested', color: 'orange.6' },
  { key: 'commented', label: 'Commented', color: 'blue.4' },
  { key: 'dismissed', label: 'Dismissed', color: 'gray.5' },
] as const;
const REVIEW_LABEL: Record<NonNullable<ActivityPull['review']>, { label: string; color: string }> = {
  approved: { label: 'Approved', color: 'green' },
  changes: { label: 'Changes requested', color: 'orange' },
  commented: { label: 'Commented', color: 'blue' },
  dismissed: { label: 'Dismissed', color: 'gray' },
};
const FIRST = 6;
const PAGE = 10;

/** A short period, as "Sep 1 – Nov 27". */
const span = (from: string, to: string) => `${dayLabel(from)} – ${dayLabel(to)}`;

// Choosing who, where and when ------------------------------------------------------------------

/** Who to look into: a login typed, pasted (a GitHub link, @login) or picked from GitHub's users. */
function PersonPicker({ value, onPick }: { value: string; onPick: (login: string) => void }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const [debounced] = useDebouncedValue(text.trim(), 250);
  const parsed = parseAccountQuery(debounced);
  const search = useAccountSearch(
    parsed?.login ?? '',
    Boolean(parsed && !parsed.exact && parsed.login.length > 1),
  );
  const users = (search.data?.accounts ?? []).filter((a) => a.kind === 'user');
  const avatars = new Map(users.map((u) => [u.login, u.avatarUrl]));
  const submit = (raw: string) => {
    const login = parseAccountQuery(raw.trim())?.login;
    if (login) onPick(login);
  };
  return (
    <Autocomplete
      label="Person"
      placeholder="A GitHub login, @login or a link"
      value={text}
      onChange={setText}
      data={users.map((u) => u.login)}
      onOptionSubmit={submit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') submit(e.currentTarget.value);
      }}
      leftSection={<IconAt size={15} stroke={1.7} />}
      renderOption={({ option }) => (
        <Group gap={10} wrap="nowrap">
          <Avatar src={avatars.get(option.value)} size={22} radius="xl" />
          <Text size="sm">{option.value}</Text>
        </Group>
      )}
      style={{ flex: '1 1 260px' }}
      maw={360}
    />
  );
}

/** Where to look: all of GitHub, an account (one of yours offered first) or owner/repository. */
function ScopePicker({ value, onPick }: { value: string; onPick: (where: string) => void }) {
  const owners = useOwners();
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const submit = (raw: string) => {
    const where = raw
      .trim()
      .replace(/^https?:\/\/github\.com\//i, '')
      .replace(/\/$/, '');
    if (!where || LOGIN.test(where) || REPO.test(where)) onPick(where);
  };
  const invalid = Boolean(text.trim()) && !LOGIN.test(text.trim()) && !REPO.test(text.trim());
  return (
    <Autocomplete
      label="Where"
      placeholder="All of GitHub"
      value={text}
      onChange={(v) => {
        setText(v);
        // Cleared: back to all of GitHub at once.
        if (!v.trim() && value) onPick('');
      }}
      data={owners.map((o) => o.login)}
      onOptionSubmit={submit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') submit(e.currentTarget.value);
      }}
      onBlur={(e) => {
        if (e.currentTarget.value.trim() !== value) submit(e.currentTarget.value);
      }}
      error={invalid ? 'An account, or owner/repository' : undefined}
      leftSection={<IconWorld size={15} stroke={1.7} />}
      style={{ flex: '1 1 220px' }}
      maw={300}
    />
  );
}

// Pieces of the results ---------------------------------------------------------------------------

/** One of the numbers across the top: large, with what it counts and a note under it. */
function Stat({ label, value, note }: { label: string; value: ReactNode; note?: ReactNode }) {
  return (
    <Box className="quality-stat">
      <Text size="sm" c="dimmed">
        {label}
      </Text>
      <Text fw={650} lh={1.1} mt={8} className="tabular alert-value">
        {value}
      </Text>
      {note && (
        <Text size="xs" c="dimmed" mt={6}>
          {note}
        </Text>
      )}
    </Box>
  );
}

function ShowMore({ shown, total, onMore }: { shown: number; total: number; onMore: () => void }) {
  if (shown >= total) return null;
  return (
    <Button variant="subtle" color="gray" size="xs" mt="xs" onClick={onMore}>
      Show more ({num(total - shown)} left)
    </Button>
  );
}

/** The repositories they work in the most: opened and reviewed, over one bar. */
function Repositories({ repos }: { repos: ActivityResponse['repos'] }) {
  const [limit, setLimit] = useState(FIRST);
  if (!repos.length) return null;
  const max = Math.max(1, ...repos.map((r) => r.opened + r.reviews));
  return (
    <>
      <SectionTitle
        title="Where they work"
        caption="The repositories with the most of their pull requests and reviews"
      />
      <Stack gap={2}>
        {repos.slice(0, limit).map((r) => {
          const [owner, name] = r.name.split('/') as [string, string];
          return (
            <Anchor
              key={r.name}
              component={Link}
              to={`/r/${owner}/${name}`}
              underline="never"
              c="inherit"
              className="bar-link"
            >
              <Group justify="space-between" wrap="nowrap" gap="sm">
                <Group gap={8} wrap="nowrap" miw={0} align="baseline">
                  <Text size="sm" fw={500} truncate>
                    {name}
                  </Text>
                  <Text size="xs" c="dimmed" truncate>
                    {owner}
                  </Text>
                </Group>
                <Group gap={12} wrap="nowrap" className="tabular" style={{ flex: 'none' }}>
                  <Text size="xs" c="dimmed">
                    {num(r.opened)} opened
                  </Text>
                  <Text size="xs" c="dimmed">
                    {num(r.reviews)} reviews
                  </Text>
                </Group>
              </Group>
              <div className="rank-track">
                <div
                  className="activity-split-fill"
                  style={{ width: `${((r.opened + r.reviews) / max) * 100}%` }}
                >
                  {r.opened > 0 && (
                    <span style={{ flexGrow: r.opened, background: cssColor(COLORS.opened) }} />
                  )}
                  {r.reviews > 0 && (
                    <span style={{ flexGrow: r.reviews, background: cssColor(COLORS.reviews) }} />
                  )}
                </div>
              </div>
            </Anchor>
          );
        })}
      </Stack>
      <ShowMore shown={limit} total={repos.length} onMore={() => setLimit((l) => l + PAGE)} />
    </>
  );
}

/** People, the most first, each with how many and a bar, opening their activity. */
function People({
  title,
  caption,
  people,
  days,
  where,
  empty,
}: {
  title: string;
  caption: string;
  people: ActivityPerson[];
  days: number;
  where: string;
  empty: string;
}) {
  const [limit, setLimit] = useState(FIRST);
  const max = Math.max(1, ...people.map((p) => p.count));
  return (
    <>
      <SectionTitle title={title} caption={caption} />
      {people.length === 0 ? (
        <Text size="sm" c="dimmed">
          {empty}
        </Text>
      ) : (
        <Stack gap={2}>
          {people.slice(0, limit).map((p) => (
            <Anchor
              key={p.login}
              component={Link}
              to={`/activity?user=${p.login}&days=${days}${where ? `&in=${encodeURIComponent(where)}` : ''}`}
              underline="never"
              c="inherit"
              className="bar-link"
              title={`See the activity of ${p.login}`}
            >
              <Group justify="space-between" wrap="nowrap" gap="sm">
                <Group gap={8} wrap="nowrap" miw={0}>
                  <Avatar src={p.avatarUrl} size={20} radius="xl" />
                  <Text size="sm" fw={500} truncate>
                    {p.login}
                  </Text>
                </Group>
                <Text size="sm" fw={600} className="tabular" style={{ flex: 'none' }}>
                  {num(p.count)}
                </Text>
              </Group>
              <div className="rank-track">
                <div
                  className="rank-fill"
                  style={{ width: `${(p.count / max) * 100}%`, background: cssColor(COLORS.reviews) }}
                />
              </div>
            </Anchor>
          ))}
        </Stack>
      )}
      <ShowMore shown={limit} total={people.length} onMore={() => setLimit((l) => l + PAGE)} />
    </>
  );
}

const STATE_ICON: Record<ActivityPull['state'] | 'draft', { icon: ReactNode; color: string; label: string }> =
  {
    open: { icon: <IconGitPullRequest size={16} stroke={1.8} />, color: 'green.6', label: 'Open' },
    draft: { icon: <IconGitPullRequestDraft size={16} stroke={1.8} />, color: 'gray.6', label: 'Draft' },
    merged: { icon: <IconGitMerge size={16} stroke={1.8} />, color: 'grape.5', label: 'Merged' },
    closed: { icon: <IconGitPullRequestClosed size={16} stroke={1.8} />, color: 'red.6', label: 'Closed' },
  };

/** A pull request in their activity: its state, title and where, and what they did on it. */
function PullRow({ pull, what }: { pull: ActivityPull; what: 'opened' | 'reviewed' | 'commented' }) {
  const [owner, name] = pull.repo.split('/') as [string, string];
  const state = STATE_ICON[pull.state === 'open' && pull.draft ? 'draft' : pull.state];
  const when =
    what === 'opened'
      ? `opened ${relative(pull.at)}`
      : what === 'reviewed'
        ? `reviewed ${relative(pull.at)}`
        : `active ${relative(pull.at)}`;
  return (
    <Anchor
      component={Link}
      to={`/r/${owner}/${name}/pull/${pull.number}`}
      underline="never"
      c="inherit"
      className="pull-row"
    >
      <Box c={state.color} title={state.label} style={{ display: 'flex' }}>
        {state.icon}
      </Box>
      <Box miw={0}>
        <Text size="sm" fw={500} truncate>
          {pull.title}
        </Text>
        <Text size="xs" c="dimmed" truncate>
          {pull.repo}#{pull.number}
          {what !== 'opened' && pull.author ? ` by ${pull.author.login}` : ''} · {when}
        </Text>
      </Box>
      {pull.review ? (
        <Badge
          size="sm"
          variant="light"
          color={REVIEW_LABEL[pull.review].color}
          tt="none"
          radius="sm"
          style={{ flex: 'none' }}
        >
          {REVIEW_LABEL[pull.review].label}
        </Badge>
      ) : (
        <Text size="xs" className="tabular" style={{ whiteSpace: 'nowrap' }}>
          <Text span c="green.6">
            +{num(pull.additions)}
          </Text>{' '}
          <Text span c="red.6">
            −{num(pull.deletions)}
          </Text>
        </Text>
      )}
    </Anchor>
  );
}

/** Their pull requests: the ones they opened, reviewed, or commented on (read when opened). */
function Pulls({ data, where }: { data: ActivityResponse; where: string }) {
  const [list, setList] = useState<'opened' | 'reviewed' | 'commented'>('opened');
  const [limit, setLimit] = useState(10);
  const commented = useActivityCommented(data.user.login, where, data.days, list === 'commented');
  const pulls =
    list === 'opened'
      ? data.pulls.opened
      : list === 'reviewed'
        ? data.pulls.reviewed
        : (commented.data?.pulls ?? []);
  const caption =
    list === 'opened'
      ? 'Opened in the period, newest first'
      : list === 'reviewed'
        ? 'Reviewed in the period, by their latest review'
        : 'By others, with their comments, active in the period: GitHub says who commented, not when';
  return (
    <Box>
      <Group justify="space-between" align="flex-end" wrap="wrap" gap="sm" mb="sm">
        <SectionTitle title="Pull requests" caption={caption} />
        <SegmentedControl
          size="xs"
          value={list}
          onChange={(v) => {
            setList(v as typeof list);
            setLimit(10);
          }}
          data={[
            { value: 'opened', label: `Opened (${num(data.pulls.opened.length)})` },
            { value: 'reviewed', label: `Reviewed (${num(data.pulls.reviewed.length)})` },
            {
              value: 'commented',
              label: commented.data ? `Commented (${num(commented.data.total)})` : 'Commented',
            },
          ]}
        />
      </Group>
      {list === 'commented' && commented.isLoading ? (
        <Stack gap={8} aria-busy="true">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} height={42} radius="md" />
          ))}
          <Text size="xs" c="dimmed">
            Searching the pull requests they commented on…
          </Text>
        </Stack>
      ) : list === 'commented' && commented.error ? (
        <ErrorState error={commented.error} onRetry={() => commented.refetch()} />
      ) : pulls.length === 0 ? (
        <Text size="sm" c="dimmed" py="md">
          None in this period, as far as you can see.
        </Text>
      ) : (
        <>
          <div className="rank-list lines-between">
            {pulls.slice(0, limit).map((p) => (
              <PullRow key={`${p.repo}#${p.number}`} pull={p} what={list} />
            ))}
          </div>
          {pulls.length > limit && (
            <Group justify="center" mt="sm">
              <Button
                variant="subtle"
                color="gray"
                size="compact-sm"
                rightSection={<IconChevronDown size={14} />}
                onClick={() => setLimit((l) => l + 20)}
              >
                Show {num(Math.min(20, pulls.length - limit))} more
              </Button>
            </Group>
          )}
          {list === 'commented' && commented.data && !commented.data.complete && (
            <Text size="xs" c="dimmed" mt="xs">
              There were more than could be read: these are the ones found.
            </Text>
          )}
        </>
      )}
    </Box>
  );
}

/** Everything about one person, once read. */
function Results({ data, where }: { data: ActivityResponse; where: string }) {
  const o = data.opened;
  const r = data.reviews;
  const nothing = o.total === 0 && r.total === 0;
  const scope =
    data.scope.kind === 'all'
      ? 'all of GitHub'
      : data.scope.kind === 'account'
        ? data.scope.name
        : data.scope.name;
  return (
    <>
      <Group justify="space-between" wrap="wrap" gap="md" mb="lg">
        <Group gap="sm" wrap="nowrap" miw={0}>
          <Avatar src={data.user.avatarUrl} size={44} radius="xl" />
          <Box miw={0}>
            <Anchor component={Link} to={`/a/${data.user.login}`} c="inherit" fw={600} truncate>
              {data.user.name ?? data.user.login}
            </Anchor>
            <Text size="xs" c="dimmed" truncate>
              @{data.user.login} · in {scope} · {span(data.from, data.to)}
            </Text>
          </Box>
        </Group>
      </Group>

      {(!o.complete || !r.complete) && (
        <Group gap={8} wrap="nowrap" c="dimmed" align="flex-start" mb="md">
          <IconInfoCircle size={16} stroke={1.7} style={{ flex: 'none', marginTop: 2 }} />
          <Text size="sm">
            There was more than GitHub's search could give in this period, so some of it is left out: the
            numbers below count what was read.
          </Text>
        </Group>
      )}

      {nothing ? (
        <EmptyState
          icon={<IconRadar size={28} />}
          title="Nothing in this period"
          description="No pull requests opened or reviewed here, as far as you can see. Try a longer period, or all of GitHub."
        />
      ) : (
        <>
          <SimpleGrid cols={{ base: 2, md: 4 }} spacing={0} verticalSpacing="lg" className="quality-strip">
            <Stat label="Opened" value={num(o.total)} note={`${num(o.open)} still open`} />
            <Stat
              label="Merged"
              value={num(o.merged)}
              note={o.total ? `${percent(o.merged / o.total)} of those opened` : 'None opened'}
            />
            <Stat label="Reviews" value={num(r.total)} note={`On ${num(r.pulls)} pull requests`} />
            <Stat
              label="Time to merge"
              value={o.medianMergeHours === null ? '—' : hours(o.medianMergeHours)}
              note="Median, for theirs merged"
            />
          </SimpleGrid>

          <Box mt={44}>
            <SectionTitle
              title="Over time"
              caption={data.days <= 31 ? 'Pull requests opened and reviews submitted, by day' : 'By week'}
            />
            <BarChart
              h={240}
              data={data.timeline}
              dataKey="start"
              series={[
                { name: 'opened', label: 'Opened', color: COLORS.opened },
                { name: 'reviews', label: 'Reviews', color: COLORS.reviews },
              ]}
              gridAxis="y"
              withLegend
              legendProps={{ verticalAlign: 'top', height: 40 }}
              xAxisProps={{ tickFormatter: dayLabel, minTickGap: 24 }}
              yAxisProps={{ allowDecimals: false }}
              barProps={{ radius: [3, 3, 0, 0], maxBarSize: 18 }}
            />
          </Box>

          <Grid gap="md" mt={44}>
            <Grid.Col span={{ base: 12, md: 6 }} pr={{ md: 'xl' }}>
              <Repositories repos={data.repos} />
            </Grid.Col>
            <Grid.Col span={{ base: 12, md: 6 }} pl={{ md: 'xl' }} className="split-col">
              {r.total > 0 ? (
                <Box className="lines-between">
                  <LanguagesDonut
                    title="How they review"
                    caption={`Their ${num(r.total)} reviews, by what each said`}
                    counts={REVIEW_STYLE.filter((s) => r[s.key] > 0).map((s) => [s.label, r[s.key]])}
                    colorOf={(name) =>
                      cssColor(REVIEW_STYLE.find((s) => s.label === name)?.color ?? 'gray.5')
                    }
                    unit="reviews"
                  />
                </Box>
              ) : (
                <>
                  <SectionTitle title="How they review" />
                  <Text size="sm" c="dimmed">
                    No reviews in this period.
                  </Text>
                </>
              )}
            </Grid.Col>
          </Grid>

          <Grid gap="md" mt={44}>
            <Grid.Col span={{ base: 12, md: 6 }} pr={{ md: 'xl' }}>
              <People
                title="Whose pull requests they review"
                caption="By how many of their reviews each got"
                people={data.reviewsGiven}
                days={data.days}
                where={where}
                empty="No reviews in this period."
              />
            </Grid.Col>
            <Grid.Col span={{ base: 12, md: 6 }} pl={{ md: 'xl' }} className="split-col">
              <People
                title="Who reviews theirs"
                caption="Reviews on the pull requests they opened in the period"
                people={data.reviewsReceived}
                days={data.days}
                where={where}
                empty="No one reviewed the ones they opened."
              />
            </Grid.Col>
          </Grid>

          <Box mt={44}>
            <Pulls data={data} where={where} />
          </Box>
        </>
      )}
    </>
  );
}

/** While a person is read: the page's shape, empty, and what's taking the time. */
function Loading({ days }: { days: number }) {
  return (
    <Box aria-busy="true">
      <Group gap="sm" mb="lg">
        <Skeleton height={44} width={44} circle />
        <Box>
          <Skeleton height={12} width={160} radius="xl" />
          <Skeleton height={9} width={240} radius="xl" mt={8} />
        </Box>
      </Group>
      <SimpleGrid cols={{ base: 2, md: 4 }} spacing="lg">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} height={74} radius="md" />
        ))}
      </SimpleGrid>
      <Skeleton height={240} radius="md" mt={44} />
      <Text size="xs" c="dimmed" mt="sm">
        Reading every pull request they opened and reviewed
        {days > 90 ? ': a busy year can take a minute or two' : ''}…
      </Text>
    </Box>
  );
}

export function Activity() {
  const [params, setParams] = useSearchParams();
  const user = params.get('user') ?? '';
  const where = params.get('in') ?? '';
  const days = Number(params.get('days')) || 90;
  const { data: auth } = useAuth();
  const query = useActivity(user, where, PERIODS.some((p) => Number(p.value) === days) ? days : 90);
  const client = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);

  /** Who, where and when live in the address, so a look can be shared, bookmarked or gone back to. */
  const set = (next: { user?: string; in?: string; days?: number }) => {
    const value = {
      user,
      in: where,
      days: String(days),
      ...next,
      ...(next.days ? { days: String(next.days) } : {}),
    };
    const entries = Object.entries(value).filter(([, v]) => v !== '' && v !== undefined) as [
      string,
      string,
    ][];
    setParams(Object.fromEntries(entries));
  };
  const refresh = async () => {
    setRefreshing(true);
    try {
      const path = `/activity/${user}?days=${days}${where ? `&in=${encodeURIComponent(where)}` : ''}&refresh=1`;
      client.setQueryData(['activity', user.toLowerCase(), where.toLowerCase(), days], await api(path));
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Activity"
        icon={<IconRadar size={26} stroke={1.6} />}
        description="What someone does with pull requests: what they open and review, where, and with whom. As far as your access lets you see."
        onRefresh={user && query.data ? refresh : undefined}
        refreshing={refreshing}
      />
      <Group gap="md" align="flex-start" wrap="wrap" mb={36}>
        <PersonPicker value={user} onPick={(login) => set({ user: login })} />
        <ScopePicker value={where} onPick={(scope) => set({ in: scope })} />
        <Box>
          {/* Labelled as the fields beside it are, so the three line up. */}
          <Text size="sm" fw={500} lh={1.55} mb={5}>
            Period
          </Text>
          <SegmentedControl value={String(days)} onChange={(v) => set({ days: Number(v) })} data={PERIODS} />
        </Box>
      </Group>

      {!user ? (
        <EmptyState
          icon={<IconRadar size={28} />}
          title="Look into someone's pull requests"
          description="Pick a person: you'll see the pull requests they open and review, in all of GitHub or just one organization or repository, and with whom they work."
          action={
            auth?.viewer ? (
              <Button variant="default" onClick={() => set({ user: auth.viewer!.login })}>
                Start with yourself
              </Button>
            ) : undefined
          }
        />
      ) : query.isLoading ? (
        <Loading days={days} />
      ) : query.error instanceof ApiError && query.error.status === 404 ? (
        // No such user, or no such place: said plainly, nothing to try again.
        <EmptyState
          icon={<IconRadar size={28} />}
          title={
            /user/i.test(query.error.message) ? 'No user with this name' : 'No such account or repository'
          }
          description={
            /user/i.test(query.error.message)
              ? `GitHub has no user called ${user}. Organizations have no activity of their own: pick one of its people.`
              : `There's no account or repository called ${where} that you can see.`
          }
        />
      ) : query.error || !query.data ? (
        <ErrorState error={query.error} onRetry={() => query.refetch()} />
      ) : (
        // Keyed by the look, so another person's lists start from their top.
        <Results key={`${user}:${where}:${days}`} data={query.data} where={where} />
      )}
    </>
  );
}
