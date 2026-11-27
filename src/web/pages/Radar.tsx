import { BarChart } from '@mantine/charts';
import {
  ActionIcon,
  Anchor,
  Autocomplete,
  Avatar,
  Badge,
  Box,
  Button,
  CloseButton,
  Grid,
  Group,
  SegmentedControl,
  SimpleGrid,
  Skeleton,
  Stack,
  Popover,
  Text,
  TextInput,
  Tooltip,
  UnstyledButton,
} from '@mantine/core';
import { useDebouncedValue, useLocalStorage } from '@mantine/hooks';
import { MarkGithubIcon } from '@primer/octicons-react';
import {
  IconAt,
  IconBook2,
  IconCalendarTime,
  IconCheck,
  IconChevronDown,
  IconClockHour4,
  IconEye,
  IconGitMerge,
  IconGitPullRequest,
  IconGitPullRequestClosed,
  IconGitPullRequestDraft,
  IconInfoCircle,
  IconRadar,
  IconTarget,
  IconThumbUp,
  IconUserCheck,
  IconWorld,
  type Icon,
} from '@tabler/icons-react';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';
import type { ActivityPerson, ActivityPull, ActivityResponse } from '../../shared/types';
import { LanguagesDonut, SectionTitle } from '../components/overview';
import { PunchCard } from '../components/punch';
import { EmptyState, ErrorState, PageHeader } from '../components/ui';
import { parseAccountQuery } from '../lib/accounts';
import { ApiError, api } from '../lib/api';
import { dayLabel, hourLabel, hours, num, percent, relative } from '../lib/format';
import {
  activityKey,
  activityPath,
  useAccountSearch,
  useActivity,
  useActivityCommented,
  useAuth,
  useOwners,
  useRepos,
} from '../lib/queries';

/*
 * Radar: point it at anyone on GitHub and see what they do with pull requests: what they open and
 * review, where, when and with whom, over a period, in all of GitHub, one account or one repository.
 * Only what your access lets you see.
 */

const PERIODS = [
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' },
  { value: '180', label: '6 months' },
  { value: '365', label: '1 year' },
  // As far back as can be asked for.
  { value: '730', label: '2 years' },
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
/** As on a repository's pull requests, so a size means the same everywhere. */
const SIZES: Record<string, { label: string; color: string }> = {
  XS: { label: 'XS · < 10 lines', color: 'var(--mantine-color-cyan-4)' },
  S: { label: 'S · 10–49 lines', color: 'var(--mantine-color-blue-4)' },
  M: { label: 'M · 50–249 lines', color: 'var(--mantine-color-indigo-5)' },
  L: { label: 'L · 250–999 lines', color: 'var(--mantine-color-violet-5)' },
  XL: { label: 'XL · 1,000+ lines', color: 'var(--mantine-color-grape-6)' },
};
const FULL_DAYS = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'];
const FIRST = 6;
const PAGE = 10;
const RECENT = 8;
/** Repositories shown at first: as many as keep the column beside the review donut. */
const REPOS_FIRST = 4;

/** A short period, as "Sep 1 – Nov 27". */
const span = (from: string, to: string) => `${dayLabel(from)} – ${dayLabel(to)}`;
/** The address of a look: who, where and how far back. */
const radarPath = (login: string, where: string, range: string) =>
  `/radar?user=${login}&${range}${where ? `&in=${encodeURIComponent(where)}` : ''}`;

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

/** Repositories offered once something is typed, at most. */
const REPO_SUGGESTIONS = 8;

/**
 * Where to look: all of GitHub, an account or owner/repository. Your accounts come first, with
 * their faces; typing offers your repositories that match. Its icon says what's picked.
 */
function ScopePicker({ value, onPick }: { value: string; onPick: (where: string) => void }) {
  const owners = useOwners();
  const repos = useRepos();
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const term = text.trim().toLowerCase();
  const avatarOf = new Map(owners.map((o) => [o.login, o.avatarUrl]));
  const countOf = new Map(owners.map((o) => [o.login, o.count]));
  const repoNames = term.length > 1 ? (repos.data?.repos ?? []).map((r) => r.fullName) : [];
  const matching = repoNames.filter((name) => name.toLowerCase().includes(term)).slice(0, REPO_SUGGESTIONS);
  const data = [
    { group: 'Your accounts', items: owners.map((o) => o.login) },
    ...(matching.length ? [{ group: 'Your repositories', items: matching }] : []),
  ];

  const submit = (raw: string) => {
    const where = raw
      .trim()
      .replace(/^https?:\/\/github\.com\//i, '')
      .replace(/\/$/, '');
    if (!where || LOGIN.test(where) || REPO.test(where)) onPick(where);
  };
  const current = value.trim();
  const icon = !current ? (
    <IconWorld size={15} stroke={1.7} />
  ) : current.includes('/') ? (
    <IconBook2 size={15} stroke={1.7} />
  ) : (
    <Avatar src={avatarOf.get(current) ?? `https://github.com/${current}.png`} size={18} radius="sm" />
  );
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
      data={data}
      limit={owners.length + REPO_SUGGESTIONS}
      onOptionSubmit={submit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') submit(e.currentTarget.value);
      }}
      onBlur={(e) => {
        if (e.currentTarget.value.trim() !== value) submit(e.currentTarget.value);
      }}
      error={invalid ? 'An account, or owner/repository' : undefined}
      leftSection={icon}
      rightSection={
        value ? (
          <Tooltip label="All of GitHub">
            <CloseButton
              size="sm"
              aria-label="Look in all of GitHub"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setText('');
                onPick('');
              }}
            />
          </Tooltip>
        ) : undefined
      }
      renderOption={({ option }) =>
        option.value.includes('/') ? (
          <Group gap={10} wrap="nowrap" miw={0}>
            <IconBook2 size={16} stroke={1.6} color="var(--mantine-color-dimmed)" style={{ flex: 'none' }} />
            <Text size="sm" truncate>
              <Text span c="dimmed">
                {option.value.split('/')[0]}/
              </Text>
              {option.value.split('/')[1]}
            </Text>
          </Group>
        ) : (
          <Group gap={10} wrap="nowrap" justify="space-between" w="100%">
            <Group gap={10} wrap="nowrap" miw={0}>
              <Avatar src={avatarOf.get(option.value)} size={22} radius="sm" />
              <Text size="sm" truncate>
                {option.value}
              </Text>
            </Group>
            <Text size="xs" c="dimmed" className="tabular" style={{ flex: 'none' }}>
              {num(countOf.get(option.value) ?? 0)} repos
            </Text>
          </Group>
        )
      }
      comboboxProps={{ width: 340, position: 'bottom-start' }}
      maxDropdownHeight={360}
      style={{ flex: '1 1 220px' }}
      maw={300}
    />
  );
}

/** Today, as the server counts days: in UTC. */
const today = () => new Date().toISOString().slice(0, 10);
/** The day `n` days before today, in UTC. */
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
/** Days from one day to another, both included. */
const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1;
/** The longest period that can be asked for, as the server allows: two years. */
const MAX_DAYS = 731;

/** A day as "Mar 1, 2026". */
const longDay = (day: string) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });

/** Why a period picked by hand can't be asked for, or null when it can. */
function rangeProblem(from: string, to: string) {
  if (!from || !to) return 'Pick both days';
  if (from > to) return 'The first day comes after the last';
  if (to > today()) return "The last day can't be after today";
  if (daysBetween(from, to) > MAX_DAYS) return 'At most two years';
  return null;
}

/** The period as one field, like the others: the last days, or two days picked by hand. */
function PeriodPicker({
  days,
  custom,
  onPick,
}: {
  days: number;
  /** The days picked by hand, when they're what's shown. */
  custom: { from: string; to: string } | null;
  onPick: (period: { days: number } | { from: string; to: string }) => void;
}) {
  const [opened, setOpened] = useState(false);
  const [draft, setDraft] = useState({ from: '', to: '' });
  // Opening starts the days from what's shown, to be moved from there. By the days themselves, not
  // the object holding them, made anew on every render: the page re-rendering while they're being
  // picked (a look finishing loading) would put them back.
  const customFrom = custom?.from;
  const customTo = custom?.to;
  useEffect(() => {
    if (opened) {
      setDraft(
        customFrom && customTo
          ? { from: customFrom, to: customTo }
          : { from: daysAgo(days - 1), to: today() },
      );
    }
  }, [opened, customFrom, customTo, days]);
  const problem = rangeProblem(draft.from, draft.to);
  const label = custom
    ? `${longDay(custom.from)} – ${longDay(custom.to)}`
    : `Last ${PERIODS.find((p) => Number(p.value) === days)?.label ?? `${days} days`}`;
  const pick = (period: { days: number } | { from: string; to: string }) => {
    onPick(period);
    setOpened(false);
  };

  return (
    <Popover opened={opened} onChange={setOpened} position="bottom-start" shadow="md" radius="md" width={340}>
      <Popover.Target>
        <Box>
          {/* Labelled as the fields beside it are, so the three line up. */}
          <Text size="sm" fw={500} lh={1.55} mb={5}>
            Period
          </Text>
          <UnstyledButton
            className="radar-period"
            onClick={() => setOpened((o) => !o)}
            aria-haspopup="dialog"
            aria-expanded={opened}
          >
            <IconCalendarTime size={15} stroke={1.7} color="var(--mantine-color-dimmed)" />
            <Text size="sm" truncate style={{ flex: 1 }}>
              {label}
            </Text>
            <IconChevronDown size={14} stroke={1.7} color="var(--mantine-color-dimmed)" />
          </UnstyledButton>
        </Box>
      </Popover.Target>
      <Popover.Dropdown p={6}>
        <Text size="xs" c="dimmed" fw={600} px={10} pt={6} pb={4}>
          The last
        </Text>
        {PERIODS.map((p) => {
          const n = Number(p.value);
          const active = !custom && n === days;
          return (
            <UnstyledButton
              key={p.value}
              className={active ? 'radar-period-option active' : 'radar-period-option'}
              onClick={() => pick({ days: n })}
            >
              <Text size="sm" fw={active ? 600 : 400}>
                {p.label}
              </Text>
              <Group gap={8} wrap="nowrap">
                <Text size="xs" c="dimmed" className="tabular">
                  {dayLabel(daysAgo(n - 1))} – {dayLabel(today())}
                </Text>
                <Box w={14} c="teal.5" style={{ display: 'flex' }}>
                  {active && <IconCheck size={14} stroke={2.2} />}
                </Box>
              </Group>
            </UnstyledButton>
          );
        })}
        <Box className="radar-period-custom">
          <Text size="xs" c="dimmed" fw={600} mb={8}>
            Your own days
          </Text>
          <Group gap={8} wrap="nowrap" align="flex-start" className="radar-dates">
            <TextInput
              aria-label="From"
              type="date"
              size="xs"
              value={draft.from}
              max={draft.to || today()}
              onChange={(e) => setDraft({ ...draft, from: e.currentTarget.value })}
              style={{ flex: 1 }}
            />
            <Text size="xs" c="dimmed" mt={6}>
              to
            </Text>
            <TextInput
              aria-label="To"
              type="date"
              size="xs"
              value={draft.to}
              min={draft.from}
              max={today()}
              onChange={(e) => setDraft({ ...draft, to: e.currentTarget.value })}
              style={{ flex: 1 }}
            />
          </Group>
          <Group justify="space-between" align="center" mt={10} wrap="nowrap">
            <Text size="xs" c={problem && problem !== 'Pick both days' ? 'red.6' : 'dimmed'}>
              {problem ?? `${num(daysBetween(draft.from, draft.to))} days`}
            </Text>
            <Button size="xs" disabled={Boolean(problem)} onClick={() => pick(draft)}>
              Apply
            </Button>
          </Group>
        </Box>
      </Popover.Dropdown>
    </Popover>
  );
}

interface Recent {
  login: string;
  avatarUrl: string;
}

/** The people looked at lately, a click from looking again, each removable. */
function RecentLooks({
  recent,
  current,
  onPick,
  onRemove,
}: {
  recent: Recent[];
  current: string;
  onPick: (login: string) => void;
  onRemove: (login: string) => void;
}) {
  const others = recent.filter((r) => r.login.toLowerCase() !== current.toLowerCase());
  if (!others.length) return null;
  return (
    <Group gap={8} wrap="wrap" mt={-20} mb={32}>
      <Text size="xs" c="dimmed" mr={2}>
        Recent
      </Text>
      {others.map((r) => (
        <Group key={r.login} gap={0} wrap="nowrap" className="radar-chip">
          <UnstyledButton onClick={() => onPick(r.login)} className="radar-chip-pick">
            <Avatar src={r.avatarUrl} size={18} radius="xl" />
            <Text size="xs" fw={500}>
              {r.login}
            </Text>
          </UnstyledButton>
          <CloseButton size="xs" aria-label={`Forget ${r.login}`} onClick={() => onRemove(r.login)} />
        </Group>
      ))}
    </Group>
  );
}

// Pieces of the results ---------------------------------------------------------------------------

/** One of the numbers across the top: large, with what it counts and a note under it. */
function Stat({
  icon: StatIcon,
  label,
  value,
  note,
}: {
  icon: Icon;
  label: string;
  value: ReactNode;
  note?: ReactNode;
}) {
  return (
    <Box className="quality-stat">
      <Group gap={6} wrap="nowrap" c="dimmed">
        <StatIcon size={15} stroke={1.7} style={{ flex: 'none' }} />
        <Text size="sm" c="dimmed" truncate>
          {label}
        </Text>
      </Group>
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

/** When things happened, by day of the week and hour, in the viewer's own time. */
function useWhen(data: ActivityResponse) {
  return useMemo(() => {
    const counts = new Map<string, number>();
    const add = (iso: string) => {
      const d = new Date(iso);
      const key = `${d.getDay()}-${d.getHours()}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    };
    for (const p of data.pulls.opened) add(p.createdAt);
    for (const t of data.reviews.times) add(t);
    const cells = [...counts.entries()].map(([key, count]) => {
      const [day, hour] = key.split('-').map(Number) as [number, number];
      return { day, hour, count };
    });
    const byDay = Array.from({ length: 7 }, (_, d) =>
      cells.filter((c) => c.day === d).reduce((s, c) => s + c.count, 0),
    );
    const top = (values: number[]) => values.indexOf(Math.max(...values));
    const busiestDay = top(byDay);
    // The busiest hour of that day, so the sentence points at a dot in that day's row: the busiest
    // hour of the whole week can be another day's, and be small on this one.
    const busiestHour = top(
      Array.from(
        { length: 24 },
        (_, h) => cells.find((c) => c.day === busiestDay && c.hour === h)?.count ?? 0,
      ),
    );
    const total = byDay.reduce((s, n) => s + n, 0);
    return { cells, total, busiestDay, busiestHour };
  }, [data]);
}

/** A line of what stands out, with the number that says it. */
interface Insight {
  icon: Icon;
  text: ReactNode;
}

/** What stands out about them, in a few plain sentences, each only when there's enough to say it. */
function insights(data: ActivityResponse, when: ReturnType<typeof useWhen>): Insight[] {
  const o = data.opened;
  const r = data.reviews;
  const out: Insight[] = [];
  const strong = (value: ReactNode) => (
    <Text span fw={600} c="var(--mantine-color-text)">
      {value}
    </Text>
  );
  const work = data.repos.reduce((s, x) => s + x.opened + x.reviews, 0);
  const top = data.repos[0];
  if (top && work >= 5) {
    out.push({
      icon: IconTarget,
      text: (
        <>
          {strong(percent((top.opened + top.reviews) / work))} of their work is in{' '}
          {strong(top.name.split('/')[1])}
          {data.repos.length > 1 ? `, across ${num(data.repos.length)} repositories in all` : ''}.
        </>
      ),
    });
  }
  if (when.total >= 10) {
    out.push({
      icon: IconCalendarTime,
      text: (
        <>
          Busiest on {strong(FULL_DAYS[when.busiestDay])}, around {strong(hourLabel(when.busiestHour))} your
          time.
        </>
      ),
    });
  }
  if (o.total >= 3 && o.medianMergeHours !== null) {
    out.push({
      icon: IconGitMerge,
      text: (
        <>
          Gets {strong(percent(o.merged / o.total))} of what they open merged, in{' '}
          {strong(hours(o.medianMergeHours))} at the median.
        </>
      ),
    });
  }
  if (r.total >= 5) {
    out.push({
      icon: IconThumbUp,
      text: (
        <>
          Approves in {strong(percent(r.approved / r.total))} of their reviews, and asks for changes in{' '}
          {strong(percent(r.changes / r.total))}.
        </>
      ),
    });
  }
  if (r.medianFirstReviewHours !== null) {
    out.push({
      icon: IconUserCheck,
      text: (
        <>Reviews a pull request {strong(hours(r.medianFirstReviewHours))} after it opens, at the median.</>
      ),
    });
  }
  const given = data.reviewsGiven[0];
  if (given && r.total >= 5) {
    out.push({
      icon: IconRadar,
      text: (
        <>
          Reviews {strong(given.login)} the most: {strong(percent(given.count / r.total))} of their reviews.
        </>
      ),
    });
  }
  return out;
}

function AtAGlance({ items }: { items: Insight[] }) {
  if (!items.length) return null;
  return (
    <Box mt={44}>
      <SectionTitle title="At a glance" caption="What stands out in this period" />
      <SimpleGrid cols={{ base: 1, md: 2 }} spacing={40} verticalSpacing={0}>
        {items.map(({ icon: ItemIcon, text }, i) => (
          <Group key={i} gap={12} wrap="nowrap" align="flex-start" py={9} className="radar-insight">
            <span className="radar-insight-icon">
              <ItemIcon size={16} stroke={1.8} />
            </span>
            <Text size="sm" c="dimmed" lh={1.5}>
              {text}
            </Text>
          </Group>
        ))}
      </SimpleGrid>
    </Box>
  );
}

/** The repositories they work in the most: opened and reviewed over one bar; a click narrows the list. */
function Repositories({
  repos,
  selected,
  onSelect,
}: {
  repos: ActivityResponse['repos'];
  selected: string | null;
  onSelect: (repo: string | null) => void;
}) {
  const [limit, setLimit] = useState(REPOS_FIRST);
  if (!repos.length) return null;
  const max = Math.max(1, ...repos.map((r) => r.opened + r.reviews));
  return (
    <>
      <SectionTitle
        title="Where they work"
        caption="The repositories with the most of their work: pick one to see its pull requests below"
      />
      <Stack gap={2}>
        {repos.slice(0, limit).map((r) => {
          const [owner, name] = r.name.split('/') as [string, string];
          const active = selected === r.name;
          return (
            <UnstyledButton
              key={r.name}
              onClick={() => onSelect(active ? null : r.name)}
              className={active ? 'bar-link radar-repo active' : 'bar-link radar-repo'}
              aria-pressed={active}
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
            </UnstyledButton>
          );
        })}
      </Stack>
      <ShowMore shown={limit} total={repos.length} onMore={() => setLimit((l) => l + PAGE)} />
    </>
  );
}

/** People, the most first, each with how many and a bar, opening their own radar. */
function People({
  title,
  caption,
  people,
  range,
  where,
  empty,
}: {
  title: string;
  caption: string;
  people: ActivityPerson[];
  range: string;
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
              to={radarPath(p.login, where, range)}
              underline="never"
              c="inherit"
              className="bar-link"
              title={`Point the radar at ${p.login}`}
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

/** Their pull requests: opened, reviewed, or commented on (read when opened), in one repo if picked. */
function Pulls({
  data,
  where,
  range,
  repo,
  onClearRepo,
}: {
  data: ActivityResponse;
  where: string;
  range: string;
  repo: string | null;
  onClearRepo: () => void;
}) {
  const [list, setList] = useState<'opened' | 'reviewed' | 'commented'>('opened');
  const [limit, setLimit] = useState(10);
  useEffect(() => setLimit(10), [repo]);
  const commented = useActivityCommented(data.user.login, where, range, list === 'commented');
  const only = (pulls: ActivityPull[]) => (repo ? pulls.filter((p) => p.repo === repo) : pulls);
  const opened = only(data.pulls.opened);
  const reviewed = only(data.pulls.reviewed);
  const commentedPulls = only(commented.data?.pulls ?? []);
  const pulls = list === 'opened' ? opened : list === 'reviewed' ? reviewed : commentedPulls;
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
            { value: 'opened', label: `Opened (${num(opened.length)})` },
            { value: 'reviewed', label: `Reviewed (${num(reviewed.length)})` },
            {
              value: 'commented',
              label: commented.data ? `Commented (${num(commentedPulls.length)})` : 'Commented',
            },
          ]}
        />
      </Group>
      {repo && (
        <Group gap={6} mb="sm">
          <Badge
            variant="light"
            color="gray"
            tt="none"
            radius="sm"
            size="lg"
            rightSection={<CloseButton size="xs" aria-label="Show every repository" onClick={onClearRepo} />}
          >
            In {repo}
          </Badge>
        </Group>
      )}
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
          None in this period{repo ? ' in this repository' : ''}, as far as you can see.
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

/** Who was looked at, where and over what, with their page and GitHub a click away. */
function Who({ data }: { data: ActivityResponse }) {
  return (
    <Group justify="space-between" wrap="wrap" gap="md" mb={28}>
      <Group gap="md" wrap="nowrap" miw={0}>
        <Avatar src={data.user.avatarUrl} size={56} radius="xl" />
        <Box miw={0}>
          <Text fw={650} fz={20} lh={1.2} truncate>
            {data.user.name ?? data.user.login}
          </Text>
          <Group gap={6} wrap="nowrap" mt={4}>
            <Anchor component={Link} to={`/a/${data.user.login}`} size="sm" c="dimmed">
              @{data.user.login}
            </Anchor>
            <Tooltip label="Open on GitHub">
              <ActionIcon
                component="a"
                href={`https://github.com/${data.user.login}`}
                target="_blank"
                rel="noreferrer"
                variant="subtle"
                color="gray"
                size="sm"
                aria-label="Open on GitHub"
              >
                <MarkGithubIcon size={14} />
              </ActionIcon>
            </Tooltip>
          </Group>
        </Box>
      </Group>
      {/* Where and over what, as two quiet facts, like the numbers below them. */}
      <Group gap={0} wrap="nowrap" className="radar-facts">
        <Box className="radar-fact">
          <Text size="xs" c="dimmed">
            Where
          </Text>
          <Group gap={7} wrap="nowrap" mt={4} miw={0}>
            {data.scope.kind === 'all' ? (
              <IconWorld
                size={16}
                stroke={1.6}
                color="var(--mantine-color-dimmed)"
                style={{ flex: 'none' }}
              />
            ) : (
              <Avatar
                src={`https://github.com/${data.scope.name.split('/')[0]}.png?size=40`}
                size={18}
                radius="sm"
              />
            )}
            {data.scope.kind === 'all' ? (
              <Text size="sm" fw={500}>
                All of GitHub
              </Text>
            ) : (
              <Anchor
                component={Link}
                to={data.scope.kind === 'repo' ? `/r/${data.scope.name}` : `/a/${data.scope.name}`}
                size="sm"
                fw={500}
                c="inherit"
                truncate
              >
                {data.scope.name}
              </Anchor>
            )}
          </Group>
        </Box>
        <Box className="radar-fact">
          <Text size="xs" c="dimmed">
            Period
          </Text>
          <Group gap={8} wrap="nowrap" mt={4} align="baseline">
            <Text size="sm" fw={500} className="tabular" style={{ whiteSpace: 'nowrap' }}>
              {span(data.from, data.to)}
            </Text>
            <Text size="xs" c="dimmed" className="tabular" style={{ whiteSpace: 'nowrap' }}>
              {num(data.days)} days
            </Text>
          </Group>
        </Box>
      </Group>
    </Group>
  );
}

/** Everything about one person, once read. */
function Results({ data, where, range }: { data: ActivityResponse; where: string; range: string }) {
  const o = data.opened;
  const r = data.reviews;
  const when = useWhen(data);
  const [repo, setRepo] = useState<string | null>(null);
  const nothing = o.total === 0 && r.total === 0;
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone.replace(/_/g, ' ');
  const pullsAt = () => document.getElementById('radar-pulls')?.scrollIntoView({ behavior: 'smooth' });

  return (
    <>
      <Who data={data} />

      {(!o.complete || !r.complete) && (
        <Group gap={8} wrap="nowrap" c="dimmed" align="flex-start" mb="md">
          <IconInfoCircle size={16} stroke={1.7} style={{ flex: 'none', marginTop: 2 }} />
          <Text size="sm">
            There was more than GitHub&apos;s search could give in this period, so some of it is left out: the
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
          <SimpleGrid
            cols={{ base: 2, md: 5 }}
            spacing={0}
            verticalSpacing="lg"
            className="quality-strip radar-strip"
          >
            <Stat
              icon={IconGitPullRequest}
              label="Opened"
              value={num(o.total)}
              note={`${num(o.open)} still open`}
            />
            <Stat
              icon={IconGitMerge}
              label="Merged"
              value={num(o.merged)}
              note={o.total ? `${percent(o.merged / o.total)} of those opened` : 'None opened'}
            />
            <Stat
              icon={IconEye}
              label="Reviews"
              value={num(r.total)}
              note={`On ${num(r.pulls)} pull requests`}
            />
            <Stat
              icon={IconClockHour4}
              label="Time to merge"
              value={o.medianMergeHours === null ? '—' : hours(o.medianMergeHours)}
              note={
                o.merged && o.selfMerged / o.merged >= 0.5
                  ? `Median · ${percent(o.selfMerged / o.merged)} merged by them`
                  : 'Median, from opening to merge'
              }
            />
            <Stat
              icon={IconUserCheck}
              label="First review"
              value={r.medianFirstReviewHours === null ? '—' : hours(r.medianFirstReviewHours)}
              note={
                r.medianFirstReviewHours === null && r.pulls > 0
                  ? 'Too few opened in the period'
                  : 'Median, opening to their first'
              }
            />
          </SimpleGrid>

          <AtAGlance items={insights(data, when)} />

          <Box mt={44}>
            <SectionTitle
              title="Over time"
              caption={
                data.days <= 31
                  ? 'Pull requests opened and reviews submitted, by day'
                  : 'Pull requests opened and reviews submitted, by week'
              }
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
            <Grid.Col span={{ base: 12, md: 7 }} pr={{ md: 'xl' }}>
              <SectionTitle
                title="When they work"
                caption={`Pull requests opened and reviews submitted, by day and hour in your time (${zone})`}
              />
              <PunchCard data={when.cells} unit={['thing done', 'things done']} zone="your time" />
            </Grid.Col>
            <Grid.Col span={{ base: 12, md: 5 }} pl={{ md: 'xl' }} className="split-col">
              {o.total > 0 ? (
                <Box className="lines-between">
                  <LanguagesDonut
                    title="What they open"
                    caption="Their pull requests by lines changed"
                    counts={o.sizes.filter((s) => s.count > 0).map((s) => [SIZES[s.size]!.label, s.count])}
                    colorOf={(name) =>
                      Object.values(SIZES).find((s) => s.label === name)?.color ??
                      'var(--mantine-color-gray-5)'
                    }
                    unit="pull requests"
                  />
                </Box>
              ) : (
                <>
                  <SectionTitle title="What they open" />
                  <Text size="sm" c="dimmed">
                    No pull requests opened in this period.
                  </Text>
                </>
              )}
            </Grid.Col>
          </Grid>

          {/* Their own work on the left, their reviews on the right, each with its people under it. */}
          <Grid gap="md" mt={44}>
            <Grid.Col span={{ base: 12, md: 6 }} pr={{ md: 'xl' }}>
              <Repositories
                repos={data.repos}
                selected={repo}
                onSelect={(next) => {
                  setRepo(next);
                  if (next) pullsAt();
                }}
              />
              <Box mt={44}>
                <People
                  title="Who reviews theirs"
                  caption="Reviews on the pull requests they opened in the period"
                  people={data.reviewsReceived}
                  range={range}
                  where={where}
                  empty="No one reviewed the ones they opened."
                />
              </Box>
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
              <Box mt={44}>
                <People
                  title="Whose pull requests they review"
                  caption="By how many of their reviews each got: a click points the radar at them"
                  people={data.reviewsGiven}
                  range={range}
                  where={where}
                  empty="No reviews in this period."
                />
              </Box>
            </Grid.Col>
          </Grid>

          <Box mt={44} id="radar-pulls" style={{ scrollMarginTop: 80 }}>
            <Pulls data={data} where={where} range={range} repo={repo} onClearRepo={() => setRepo(null)} />
          </Box>
        </>
      )}
    </>
  );
}

/** While a person is read: the page's shape, empty, and what's taking the time. */
function Loading({ days }: { days: number }) {
  const long = days > 90;
  return (
    <Box aria-busy="true">
      <Group gap="md" mb={28}>
        <Skeleton height={56} width={56} circle />
        <Box>
          <Skeleton height={14} width={180} radius="xl" />
          <Skeleton height={10} width={120} radius="xl" mt={10} />
        </Box>
      </Group>
      <SimpleGrid cols={{ base: 2, md: 5 }} spacing="lg">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} height={74} radius="md" />
        ))}
      </SimpleGrid>
      <Skeleton height={240} radius="md" mt={44} />
      <Group gap={8} mt="sm" c="dimmed">
        <IconRadar size={15} stroke={1.7} className="radar-sweep" />
        <Text size="xs">
          Reading every pull request they opened and reviewed
          {long ? ': a long period, for a busy person, can take a minute or two' : ''}…
        </Text>
      </Group>
    </Box>
  );
}

export function Radar() {
  const [params, setParams] = useSearchParams();
  const user = params.get('user') ?? '';
  const where = params.get('in') ?? '';
  // The period: the last ?days= days, or ?from= to ?to=, picked by hand.
  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';
  const custom = Boolean(from && to);
  const asked = Number(params.get('days'));
  const days = PERIODS.some((p) => Number(p.value) === asked) ? asked : 90;
  const range = custom ? `from=${from}&to=${to}` : `days=${days}`;
  const spanDays = custom ? daysBetween(from, to) : days;
  const { data: auth } = useAuth();
  const query = useActivity(user, where, range);
  const client = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const [recent, setRecent] = useLocalStorage<Recent[]>({
    key: 'gitmetrics:radar-recent',
    defaultValue: [],
    getInitialValueInEffect: false,
  });

  // Remember whoever was looked at, the latest first, under GitHub's spelling of their login.
  const looked = query.data?.user;
  useEffect(() => {
    if (!looked) return;
    setRecent((list) =>
      [
        { login: looked.login, avatarUrl: looked.avatarUrl },
        ...list.filter((r) => r.login.toLowerCase() !== looked.login.toLowerCase()),
      ].slice(0, RECENT),
    );
  }, [looked, setRecent]);

  /** Who, where and when live in the address, so a look can be shared, bookmarked or gone back to. */
  const set = (next: {
    user?: string;
    in?: string;
    period?: { days: number } | { from: string; to: string };
  }) => {
    const period = next.period ?? (custom ? { from, to } : { days });
    const value: Record<string, string> = {
      user: next.user ?? user,
      ...('days' in period ? { days: String(period.days) } : { from: period.from, to: period.to }),
      in: next.in ?? where,
    };
    setParams(Object.fromEntries(Object.entries(value).filter(([, v]) => v !== '')));
  };
  const refresh = async () => {
    setRefreshing(true);
    try {
      client.setQueryData(
        activityKey(user, where, range),
        await api(`${activityPath(user, where, range)}&refresh=1`),
      );
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Radar"
        icon={<IconRadar size={26} stroke={1.6} />}
        description="What anyone on GitHub opens and reviews: where, when and with whom. Only what your access lets you see."
        onRefresh={user && query.data ? refresh : undefined}
        refreshing={refreshing}
      />
      <Group gap="md" align="flex-start" wrap="wrap" mb={36}>
        <PersonPicker value={user} onPick={(login) => set({ user: login })} />
        <ScopePicker value={where} onPick={(scope) => set({ in: scope })} />
        <PeriodPicker
          days={days}
          custom={custom ? { from, to } : null}
          onPick={(period) => set({ period })}
        />
      </Group>
      <RecentLooks
        recent={recent}
        current={user}
        onPick={(login) => set({ user: login })}
        onRemove={(login) => setRecent((list) => list.filter((r) => r.login !== login))}
      />

      {!user ? (
        <EmptyState
          icon={<IconRadar size={28} />}
          title="Point the radar at someone"
          description="Pick a person: you'll see the pull requests they open and review, where and when they work, and with whom, in all of GitHub or just one organization or repository."
          action={
            auth?.viewer ? (
              <Button variant="default" onClick={() => set({ user: auth.viewer!.login })}>
                Start with yourself
              </Button>
            ) : undefined
          }
        />
      ) : query.isLoading ? (
        <Loading days={spanDays} />
      ) : query.error instanceof ApiError && query.error.status === 404 ? (
        // No such user, or no such place: said plainly, nothing to try again.
        <EmptyState
          icon={<IconRadar size={28} />}
          title={
            /user/i.test(query.error.message) ? 'No user with this name' : 'No such account or repository'
          }
          description={
            /user/i.test(query.error.message)
              ? `GitHub has no user called ${user}. Organizations have no pull requests of their own: pick one of its people.`
              : `There's no account or repository called ${where} that you can see.`
          }
        />
      ) : query.error || !query.data ? (
        <ErrorState error={query.error} onRetry={() => query.refetch()} />
      ) : (
        // Keyed by the look, so another person's lists start from their top.
        <Results key={`${user}:${where}:${range}`} data={query.data} where={where} range={range} />
      )}
    </>
  );
}
