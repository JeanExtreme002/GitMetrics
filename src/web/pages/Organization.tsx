import {
  Anchor,
  Avatar,
  Badge,
  Box,
  Button,
  Grid,
  Group,
  Select,
  SimpleGrid,
  Stack,
  Skeleton,
  Text,
  TextInput,
  Tooltip,
} from '@mantine/core';
import {
  IconBook2,
  IconBuilding,
  IconChecklist,
  IconCircleDot,
  IconExternalLink,
  IconFileDescription,
  IconFolders,
  IconHeart,
  IconLicense,
  IconLock,
  IconSearch,
  IconShieldCheck,
  IconTags,
  IconUsers,
  IconUsersGroup,
} from '@tabler/icons-react';
import { MarkGithubIcon } from '@primer/octicons-react';
import { useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { useMemo, useState, type ReactNode } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import {
  SEVERITIES,
  type AccountPerson,
  type AlertDetailsResponse,
  type AlertPackage,
  type QualityResponse,
  type SecurityResponse,
  type QualityMeasure,
  type Severity,
  type SeverityCounts,
} from '../../shared/types';
import { LanguagesDonut, SectionTitle } from '../components/overview';
import { Counter, Counters, EmptyState, ErrorState, PageHeader, PageSkeleton } from '../components/ui';
import { api } from '../lib/api';
import { compact, num, percent, relative } from '../lib/format';
import {
  accountPageKey,
  useAccount,
  useAlertDetails,
  useMemberTeams,
  usePeople,
  useQuality,
  useSecurity,
  useSponsors,
  useTeams,
} from '../lib/queries';
import { repoPath } from '../components/repo';
import { languageColor } from '../lib/languages';
import { Repositories } from './Repositories';

/*
 * An organization's pages beyond its overview, each reached from its own sidebar: its
 * repositories, people, teams, security and quality, and sponsors.
 */

const cssColor = (color: string) => `var(--mantine-color-${color.replace('.', '-')})`;
const PAGE = 60;

/** Reads a page's data again, past the cache. */
function useRefresh(login: string, page: string) {
  const client = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const refresh = async () => {
    setRefreshing(true);
    try {
      client.setQueryData(accountPageKey(login, page), await api(`/accounts/${login}/${page}?refresh=1`));
    } finally {
      setRefreshing(false);
    }
  };
  return { refresh, refreshing };
}

/** Loading, failing, or showing a page's data. */
function Loaded<T>({ query, children }: { query: UseQueryResult<T>; children: (data: T) => ReactNode }) {
  if (query.isLoading) return <PageSkeleton />;
  if (query.error || !query.data) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  return <>{children(query.data)}</>;
}

/** A person or an organization, opening its own page. */
function PersonRow({ person, right }: { person: AccountPerson; right?: ReactNode }) {
  return (
    <Anchor
      component={Link}
      to={`/a/${person.login}`}
      underline="never"
      c="inherit"
      className="account-row account-link"
    >
      <Group gap={12} wrap="nowrap" miw={0}>
        <Avatar src={person.avatarUrl} alt={person.login} size={32} radius="xl" />
        <Box miw={0}>
          <Text size="sm" fw={500} truncate>
            {person.name ?? person.login}
          </Text>
          {person.name && (
            <Text size="xs" c="dimmed" truncate>
              {person.login}
            </Text>
          )}
        </Box>
      </Group>
      {right}
    </Anchor>
  );
}

/** A person as a tile: a round avatar, the name, and the login under it, with a tag if given. */
function PersonTile({ person, tag }: { person: AccountPerson; tag?: string }) {
  return (
    <Anchor component={Link} to={`/a/${person.login}`} underline="never" c="inherit" className="person-tile">
      <Avatar src={person.avatarUrl} alt={person.login} size={40} radius="xl" />
      <Box miw={0}>
        <Text size="sm" fw={500} truncate>
          {person.name ?? person.login}
        </Text>
        <Group gap={6} wrap="nowrap" miw={0}>
          <Text size="xs" c="dimmed" truncate>
            @{person.login}
          </Text>
          {tag && (
            <Badge size="xs" variant="light" color="gray" radius="sm" tt="none" style={{ flex: 'none' }}>
              {tag}
            </Badge>
          )}
        </Group>
      </Box>
    </Anchor>
  );
}

function PeopleGrid({
  people,
  tagOf,
}: {
  people: AccountPerson[];
  tagOf?: (login: string) => string | undefined;
}) {
  if (!people.length) return null;
  return (
    <SimpleGrid cols={{ base: 1, xs: 2, md: 3, xl: 4 }} spacing={4} verticalSpacing={4}>
      {people.map((p) => (
        <PersonTile key={p.login} person={p} tag={tagOf?.(p.login)} />
      ))}
    </SimpleGrid>
  );
}

/** A box to find something in a long list, and the count of what matches. */
function Finder({
  value,
  onChange,
  placeholder,
  shown,
  noun,
  extra,
}: {
  extra?: ReactNode;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  shown: number;
  noun: [string, string];
}) {
  return (
    <Group justify="space-between" align="center" mb="sm" gap="md">
      <TextInput
        placeholder={placeholder}
        leftSection={<IconSearch size={16} stroke={1.6} />}
        value={value}
        onChange={(e) => onChange(e.currentTarget.value)}
        style={{ flex: '1 1 260px' }}
        maw={420}
      />
      {extra}
      <Text size="sm" c="dimmed" ml="auto">
        {num(shown)} {shown === 1 ? noun[0] : noun[1]}
      </Text>
    </Group>
  );
}

function ShowMore({ left, onClick }: { left: number; onClick: () => void }) {
  if (left <= 0) return null;
  return (
    <Group justify="center" mt="md">
      <Button variant="default" onClick={onClick}>
        Show more ({num(left)} left)
      </Button>
    </Group>
  );
}

// Repositories ------------------------------------------------------------------------------------

/** The organization's repositories, in the Repositories page with the account fixed. */
export function AccountRepositories() {
  const { login = '' } = useParams();
  const account = useAccount(login);
  const data = account.data;
  // Until the account is known, its own list can't be asked for: wait rather than show another.
  if (account.isLoading) return <PageSkeleton />;
  if (account.error || !data) return <ErrorState error={account.error} onRetry={() => account.refetch()} />;
  return <Repositories owner={data.login} organization={data.kind === 'organization'} />;
}

// People ------------------------------------------------------------------------------------------

export function People() {
  const { login = '' } = useParams();
  const query = usePeople(login);
  const { refresh, refreshing } = useRefresh(login, 'people');
  const [search, setSearch] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const shown = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (query.data?.people ?? []).filter(
      (p) => !term || p.login.toLowerCase().includes(term) || (p.name ?? '').toLowerCase().includes(term),
    );
  }, [query.data, search]);
  const admins = query.data?.people.filter((p) => p.role === 'admin').length ?? 0;
  const owners = query.data?.enterpriseOwners ?? [];
  const ownerLogins = new Set(owners.map((o) => o.login));
  const memberLogins = new Set(query.data?.people.map((p) => p.login));
  const term = search.trim().toLowerCase();
  // Everyone in their own section, tagged if they own the enterprise too; the enterprise owners apart
  // only when they aren't among its people, so no one shows twice and each count matches its section.
  const shownOwners = owners.filter(
    (p) =>
      !memberLogins.has(p.login) &&
      (!term || p.login.toLowerCase().includes(term) || (p.name ?? '').toLowerCase().includes(term)),
  );
  const shownAdmins = shown.filter((p) => p.role === 'admin');
  const shownMembers = shown.filter((p) => p.role !== 'admin');
  const ownerTag = (login: string) => (ownerLogins.has(login) ? 'Enterprise owner' : undefined);

  return (
    <>
      <PageHeader
        title="People"
        icon={<IconUsers size={26} stroke={1.6} />}
        description={
          query.data && !query.data.member
            ? 'Its public members, the ones who chose to show they belong to it. Its members see everyone.'
            : 'Who belongs to the organization, and the role each one has in it.'
        }
        stats={
          query.data && (
            <Counters>
              <Counter
                icon={IconUsers}
                value={num(query.data.total)}
                label={query.data.member ? 'Members' : 'Public members'}
              />
              {query.data.member && (
                <Counter
                  icon={IconShieldCheck}
                  value={num(admins)}
                  label="Admins"
                  hint="Members who can manage the organization"
                />
              )}
              {owners.length > 0 && (
                <Counter
                  icon={IconBuilding}
                  value={num(owners.length)}
                  label="Enterprise owners"
                  hint="They own the enterprise account the organization belongs to"
                />
              )}
            </Counters>
          )
        }
        onRefresh={refresh}
        refreshing={refreshing}
      />
      <Loaded query={query}>
        {(data) => (
          <>
            <Finder
              value={search}
              onChange={(v) => {
                setSearch(v);
                setLimit(PAGE);
              }}
              placeholder="Find a person"
              shown={shown.length}
              noun={['person', 'people']}
            />
            {!data.complete && (
              <Text size="xs" c="dimmed" mb="sm">
                Showing the first {num(data.people.length)} of its {num(data.total)} members.
              </Text>
            )}
            {shownOwners.length > 0 && (
              <Box mb={36}>
                <SectionTitle
                  title="Enterprise owners"
                  caption={
                    data.member
                      ? "They own the enterprise account the organization belongs to, but aren't members of it"
                      : "They own the enterprise account the organization belongs to, and aren't among its public members"
                  }
                />
                <PeopleGrid people={shownOwners} />
              </Box>
            )}
            {shownAdmins.length > 0 && (
              <Box mb={36}>
                <SectionTitle title="Admins" caption="They manage the organization" />
                <PeopleGrid people={shownAdmins} tagOf={ownerTag} />
              </Box>
            )}
            {(shownMembers.length > 0 || shown.length === 0) && (
              <SectionTitle title={data.member ? 'Members' : 'Public members'} />
            )}
            <PeopleGrid people={shownMembers.slice(0, limit)} tagOf={ownerTag} />
            {shown.length === 0 && shownOwners.length === 0 && (
              <Text size="sm" c="dimmed" py="md">
                No one matches.
              </Text>
            )}
            <ShowMore left={shownMembers.length - limit} onClick={() => setLimit((l) => l + PAGE)} />
          </>
        )}
      </Loaded>
    </>
  );
}

// Teams -------------------------------------------------------------------------------------------

export function Teams() {
  const { login = '' } = useParams();
  const query = useTeams(login);
  const { refresh, refreshing } = useRefresh(login, 'teams');
  const [search, setSearch] = useState('');
  const [limit, setLimit] = useState(PAGE);
  // A member picked to see only their teams, kept in the address so it can be shared or linked to.
  const [params, setParams] = useSearchParams();
  const member = params.get('member');
  const people = usePeople(login);
  const memberTeams = useMemberTeams(login, member);
  const shown = useMemo(() => {
    const term = search.trim().toLowerCase();
    const of = member ? new Set(memberTeams.data?.teams ?? []) : null;
    return (query.data?.teams ?? []).filter(
      (t) =>
        (!of || of.has(t.slug)) &&
        (!term ||
          t.name.toLowerCase().includes(term) ||
          (t.description ?? '').toLowerCase().includes(term) ||
          (t.parent ?? '').toLowerCase().includes(term)),
    );
  }, [query.data, search, member, memberTeams.data]);
  const memberOptions = useMemo(
    () =>
      (people.data?.people ?? []).map((p) => ({
        value: p.login,
        label: p.name && p.name !== p.login ? `${p.name} (@${p.login})` : `@${p.login}`,
      })),
    [people.data],
  );
  const avatarOf = useMemo(
    () => new Map((people.data?.people ?? []).map((p) => [p.login, p.avatarUrl])),
    [people.data],
  );
  const secret = query.data?.teams.filter((t) => t.secret).length ?? 0;

  return (
    <>
      <PageHeader
        title="Teams"
        icon={<IconUsersGroup size={26} stroke={1.6} />}
        description="Its teams you can see, biggest first, with their members and repositories."
        stats={
          query.data && (
            <Counters>
              <Counter icon={IconUsersGroup} value={num(query.data.total)} label="Teams" />
              <Counter
                icon={IconLock}
                value={num(secret)}
                label="Secret"
                hint="Visible to their members and the organization's owners only"
              />
            </Counters>
          )
        }
        onRefresh={refresh}
        refreshing={refreshing}
      />
      <Loaded query={query}>
        {(data) =>
          data.total === 0 ? (
            <EmptyState
              icon={<IconUsersGroup size={28} />}
              title="No teams to show"
              description="GitHub shows an organization's teams to its members only."
            />
          ) : (
            <>
              <Finder
                value={search}
                onChange={(v) => {
                  setSearch(v);
                  setLimit(PAGE);
                }}
                placeholder="Find a team"
                shown={shown.length}
                noun={['team', 'teams']}
                extra={
                  <Select
                    placeholder={people.isLoading ? 'Loading members…' : 'Teams of a member'}
                    data={
                      member && !memberOptions.some((o) => o.value === member)
                        ? [{ value: member, label: `@${member}` }, ...memberOptions]
                        : memberOptions
                    }
                    value={member}
                    onChange={(value) => {
                      setParams(value ? { member: value } : {}, { replace: true });
                      setLimit(PAGE);
                    }}
                    searchable
                    clearable
                    limit={50}
                    nothingFoundMessage="No member matches"
                    comboboxProps={{ width: 360, position: 'bottom-start' }}
                    leftSection={
                      member ? (
                        <Avatar
                          src={avatarOf.get(member) ?? `https://github.com/${member}.png`}
                          size={20}
                          radius="xl"
                        />
                      ) : (
                        <IconUsers size={16} stroke={1.6} />
                      )
                    }
                    renderOption={({ option }) => (
                      <Group gap={10} wrap="nowrap">
                        <Avatar src={avatarOf.get(option.value)} size={22} radius="xl" />
                        <Text size="sm" truncate>
                          {option.label}
                        </Text>
                      </Group>
                    )}
                    style={{ flex: '0 1 300px' }}
                    miw={220}
                  />
                }
              />
              {!data.complete && (
                <Text size="xs" c="dimmed" mb="sm">
                  Showing the first {num(data.teams.length)} of its {num(data.total)} teams.
                </Text>
              )}
              {member && memberTeams.isLoading && (
                <Text size="sm" c="dimmed" py="md">
                  Finding the teams of @{member}…
                </Text>
              )}
              {member && memberTeams.error && (
                <Text size="sm" c="red" py="md">
                  Couldn&apos;t read the teams of @{member}.
                </Text>
              )}
              <div className="rank-list lines-between">
                {shown.slice(0, limit).map((t) => (
                  <Anchor
                    key={t.slug}
                    href={t.url}
                    target="_blank"
                    rel="noreferrer"
                    underline="never"
                    c="inherit"
                    className="account-row account-link"
                  >
                    <Box miw={0}>
                      <Group gap={8} wrap="nowrap">
                        <Text size="sm" fw={500} truncate>
                          {t.name}
                        </Text>
                        {t.secret && (
                          <Badge variant="light" color="gray" tt="none" radius="sm" size="sm">
                            Secret
                          </Badge>
                        )}
                      </Group>
                      {(t.description || t.parent) && (
                        <Text size="xs" c="dimmed" truncate>
                          {[t.parent && `In ${t.parent}`, t.description].filter(Boolean).join(' · ')}
                        </Text>
                      )}
                    </Box>
                    <Group gap="lg" wrap="nowrap" style={{ flex: 'none' }}>
                      <Tooltip label="Members">
                        <Group gap={5} wrap="nowrap">
                          <IconUsers size={14} stroke={1.8} color="var(--mantine-color-dimmed)" />
                          <Text size="sm" fw={600} className="tabular" w={40}>
                            {compact(t.members)}
                          </Text>
                        </Group>
                      </Tooltip>
                      <Tooltip label="Repositories it can reach">
                        <Group gap={5} wrap="nowrap">
                          <IconBook2 size={14} stroke={1.8} color="var(--mantine-color-dimmed)" />
                          <Text size="sm" fw={600} className="tabular" w={40}>
                            {compact(t.repositories)}
                          </Text>
                        </Group>
                      </Tooltip>
                    </Group>
                  </Anchor>
                ))}
              </div>
              {shown.length === 0 && (!member || memberTeams.data) && (
                <Text size="sm" c="dimmed" py="md">
                  {member && !search.trim() && memberTeams.data
                    ? `@${member} isn't in any team you can see.`
                    : 'No team matches.'}
                </Text>
              )}
              <ShowMore left={shown.length - limit} onClick={() => setLimit((l) => l + PAGE)} />
            </>
          )
        }
      </Loaded>
    </>
  );
}

// Security and quality ----------------------------------------------------------------------------

const QUALITY: Record<QualityMeasure['key'], { label: string; hint: string; icon: typeof IconLicense }> = {
  license: { label: 'Licensed', hint: 'People know how they may use it', icon: IconLicense },
  description: {
    label: 'Described',
    hint: 'Its purpose, shown in lists and search',
    icon: IconFileDescription,
  },
  topics: { label: 'With topics', hint: 'Found when people browse a subject', icon: IconTags },
  issues: {
    label: 'Issues open',
    hint: 'People can report problems and ask for things',
    icon: IconCircleDot,
  },
};

const ACTIVITY: { key: keyof QualityResponse['activity']; label: string; color: string }[] = [
  { key: 'month', label: 'Past month', color: 'teal.5' },
  { key: 'quarter', label: '1–3 months', color: 'teal.3' },
  { key: 'year', label: '3–12 months', color: 'yellow.5' },
  { key: 'older', label: 'Over a year', color: 'orange.5' },
  { key: 'never', label: 'Never pushed', color: 'gray.5' },
];

/** How well a share reads: most of them, about half, or few. */
const levelColor = (ratio: number) => (ratio >= 0.75 ? 'teal.5' : ratio >= 0.4 ? 'yellow.5' : 'orange.5');

/** One quality measure: its share of the active repositories, large, and how many that is. */
function QualityStat({ measure, of }: { measure: QualityMeasure; of: number }) {
  const { label, hint, icon: Icon } = QUALITY[measure.key];
  const ratio = of ? measure.count / of : 0;
  return (
    <Tooltip label={hint} position="top-start">
      <Box className="quality-stat">
        <Group gap={6} wrap="nowrap">
          <Icon size={15} stroke={1.7} color="var(--mantine-color-dimmed)" />
          <Text size="sm" c="dimmed">
            {label}
          </Text>
        </Group>
        <Text fz={34} fw={650} lh={1.1} mt={8} className="tabular">
          {percent(ratio)}
        </Text>
        <div className="rank-track" style={{ marginTop: 12 }}>
          <div
            className="rank-fill"
            style={{ width: `${ratio * 100}%`, background: cssColor(levelColor(ratio)) }}
          />
        </div>
        <Text size="xs" c="dimmed" mt={8}>
          {num(measure.count)} of {num(of)} repositories
        </Text>
      </Box>
    </Tooltip>
  );
}

const LICENSE_COLORS = ['blue.5', 'teal.5', 'grape.4', 'yellow.5', 'orange.5'];

/** Its active repositories by their last push, in time order. */
function Activity({ activity, of }: { activity: QualityResponse['activity']; of: number }) {
  const shown = ACTIVITY.filter((a) => a.key !== 'never' || activity.never > 0);
  return (
    <Box>
      <SectionTitle title="Activity" caption={`Its ${num(of)} active repositories by their last push`} />
      <Columns
        label="Active repositories by their last push"
        items={shown.map((a) => ({ key: a.key, label: a.label, value: activity[a.key], color: a.color }))}
      />
    </Box>
  );
}

/** The licenses its licensed repositories use, the most used first. */
function Licenses({ licenses, of }: { licenses: QualityResponse['licenses']; of: number }) {
  const used = licenses.filter((l) => l.name !== 'None');
  const licensed = used.reduce((sum, l) => sum + l.count, 0);
  if (!licensed) {
    return (
      <Box>
        <SectionTitle title="Licenses" caption={`Of its ${num(of)} active repositories`} />
        <Text size="sm" c="dimmed">
          None of them has a license GitHub can find.
        </Text>
      </Box>
    );
  }
  return (
    <LanguagesDonut
      title="Licenses"
      caption={`The ${num(licensed)} of its ${num(of)} active repositories that have one`}
      counts={used.map((l) => [l.name, l.count])}
      colorOf={(name) =>
        cssColor(LICENSE_COLORS[used.findIndex((l) => l.name === name) % LICENSE_COLORS.length]!)
      }
    />
  );
}

const SEVERITY: Record<Severity, { label: string; color: string }> = {
  critical: { label: 'Critical', color: 'red.8' },
  high: { label: 'High', color: 'orange.6' },
  moderate: { label: 'Moderate', color: 'yellow.5' },
  low: { label: 'Low', color: 'gray.5' },
};

/** A bar split by severity, each part as long as its share. */
function SeverityBar({ severity, className }: { severity: SeverityCounts; className: string }) {
  return (
    <div className={className}>
      {SEVERITIES.filter((key) => severity[key] > 0).map((key) => (
        <span key={key} style={{ flexGrow: severity[key], background: cssColor(SEVERITY[key].color) }} />
      ))}
    </div>
  );
}

/** The open alerts by severity: one bar, and each severity's count and share. */
function Severities({ query, open }: { query: UseQueryResult<AlertDetailsResponse>; open: number }) {
  const severity = query.data?.severity;
  if (!severity) {
    return (
      <Text size="xs" c="dimmed" mt={36}>
        {query.error
          ? "Couldn't read the alerts' severities."
          : 'The alerts changed while their severities were read, so they are left out. Refresh to read them again.'}
      </Text>
    );
  }
  return (
    <Box mt={36}>
      <Text fw={600} size="sm" mb="xs">
        By severity
      </Text>
      <SeverityBar severity={severity} className="severity-split" />
      <SimpleGrid cols={4} spacing="md" mt="md">
        {SEVERITIES.map((key) => (
          <Box key={key}>
            <Group gap={7} wrap="nowrap">
              <span className="lang-dot" style={{ background: cssColor(SEVERITY[key].color), margin: 0 }} />
              <Text size="xs" c="dimmed" truncate>
                {SEVERITY[key].label}
              </Text>
            </Group>
            <Group gap={8} align="baseline" mt={6} wrap="nowrap">
              <Text fz={22} fw={650} lh={1} className="tabular">
                {num(severity[key])}
              </Text>
              <Text size="xs" c="dimmed" className="tabular" visibleFrom="xs">
                {percent(open ? severity[key] / open : 0)}
              </Text>
            </Group>
          </Box>
        ))}
      </SimpleGrid>
    </Box>
  );
}

const ECOSYSTEMS: Record<string, string> = {
  NPM: 'npm',
  PIP: 'pip',
  MAVEN: 'Maven',
  NUGET: 'NuGet',
  RUBYGEMS: 'RubyGems',
  COMPOSER: 'Composer',
  GO: 'Go',
  RUST: 'Rust',
  ERLANG: 'Erlang',
  ACTIONS: 'Actions',
  PUB: 'Pub',
  SWIFT: 'Swift',
};
const ecosystem = (name: string) => ECOSYSTEMS[name] ?? name.charAt(0) + name.slice(1).toLowerCase();

const ALERT_AGE: {
  key: keyof NonNullable<AlertDetailsResponse['details']>['age'];
  label: string;
  color: string;
}[] = [
  { key: 'month', label: 'Under a month', color: 'teal.5' },
  { key: 'quarter', label: '1–3 months', color: 'yellow.5' },
  { key: 'year', label: '3–12 months', color: 'orange.5' },
  { key: 'older', label: 'Over a year', color: 'red.6' },
];

/** Counts over time spans, in time order: a column each, its count just above it. */
function Columns({
  items,
  label,
}: {
  items: { key: string; label: string; value: number; color: string }[];
  label: string;
}) {
  const total = items.reduce((sum, c) => sum + c.value, 0);
  const max = Math.max(1, ...items.map((c) => c.value));
  return (
    <div
      className="age-columns"
      style={{ gridTemplateColumns: `repeat(${items.length}, 1fr)` }}
      role="img"
      aria-label={label}
    >
      {items.map((c) => (
        <div key={c.key} className="age-column">
          <div className="age-track">
            <Text size="sm" fw={600} className="tabular" mb={6}>
              {num(c.value)}
            </Text>
            <div
              className="age-fill"
              style={{ height: `${(c.value / max) * 130}px`, background: cssColor(c.color) }}
            />
          </div>
          <Text size="xs" c="dimmed" mt={8} ta="center" lh={1.3}>
            {c.label}
            <br />
            {total ? percent(c.value / total) : '0%'}
          </Text>
        </div>
      ))}
    </div>
  );
}

const ECOSYSTEM_COLORS = ['red.5', 'blue.5', 'teal.5', 'grape.4', 'yellow.5'];

/** How long the alerts have been open, in time order, and where they come from. */
function AlertAgeAndEcosystems({ details }: { details: NonNullable<AlertDetailsResponse['details']> }) {
  const names = details.ecosystems.map((e) => ecosystem(e.name));
  return (
    <Grid gap="md" mt={36}>
      <Grid.Col span={{ base: 12, md: 6 }} pr={{ md: 'xl' }}>
        <Box className="lines-between">
          <SectionTitle
            title="How long they've been open"
            caption={
              details.oldestCritical
                ? `The oldest critical one, in ${details.oldestCritical.package} on ${details.oldestCritical.fullName.split('/')[1]}, was opened ${relative(details.oldestCritical.createdAt)}`
                : 'Since each alert was opened'
            }
          />
          <Columns
            label="Open alerts by how long they've been open"
            items={ALERT_AGE.map((a) => ({
              key: a.key,
              label: a.label,
              value: details.age[a.key],
              color: a.color,
            }))}
          />
        </Box>
      </Grid.Col>
      <Grid.Col span={{ base: 12, md: 6 }} pl={{ md: 'xl' }} className="split-col">
        <Box className="lines-between">
          <LanguagesDonut
            title="By ecosystem"
            caption="Where the vulnerable packages come from"
            counts={details.ecosystems.map((e) => [ecosystem(e.name), e.alerts])}
            colorOf={(name) => cssColor(ECOSYSTEM_COLORS[names.indexOf(name) % ECOSYSTEM_COLORS.length]!)}
            unit="alerts"
          />
        </Box>
      </Grid.Col>
    </Grid>
  );
}

/** A row of the alert lists: a name and its count over a bar, no lines between rows. */
function BarLink({
  label,
  detail,
  value,
  width,
  bar,
  href,
  title,
}: {
  label: string;
  detail?: string;
  value: number;
  /** The bar's length, from 0 to 1. */
  width: number;
  /** What fills the bar; plain red unless given. */
  bar?: ReactNode;
  href?: string;
  title?: string;
}) {
  const body = (
    <>
      <Group justify="space-between" wrap="nowrap" gap="sm">
        <Group gap={8} wrap="nowrap" miw={0} align="baseline">
          <Text size="sm" fw={500} truncate>
            {label}
          </Text>
          {detail && (
            <Text size="xs" c="dimmed" truncate>
              {detail}
            </Text>
          )}
        </Group>
        <Text size="sm" fw={600} className="tabular" style={{ flex: 'none' }}>
          {num(value)}
        </Text>
      </Group>
      <div className="rank-track">
        <div style={{ width: `${width * 100}%`, height: '100%' }}>
          {bar ?? <div className="rank-fill" style={{ width: '100%', background: cssColor('red.5') }} />}
        </div>
      </div>
    </>
  );
  return href ? (
    <Anchor
      href={href}
      target="_blank"
      rel="noreferrer"
      underline="never"
      c="inherit"
      className="bar-link"
      title={title}
    >
      {body}
    </Anchor>
  ) : (
    <Box className="bar-link bar-static">{body}</Box>
  );
}

/** Lists start this long, and grow by as much with each "Show more". */
const LIST_STEP = 6;

function ListMore({ shown, total, onMore }: { shown: number; total: number; onMore: () => void }) {
  if (shown >= total) return null;
  return (
    <Button variant="subtle" color="gray" size="xs" mt="xs" onClick={onMore}>
      Show more ({num(total - shown)} left)
    </Button>
  );
}

/** The repositories with the most alerts, each bar split by severity once those are read. */
function MostAlerts({
  repositories,
  severityOf,
}: {
  repositories: NonNullable<SecurityResponse['alerts']>['repositories'];
  severityOf: Map<string, SeverityCounts | null>;
}) {
  const [limit, setLimit] = useState(LIST_STEP);
  const max = Math.max(1, repositories[0]?.open ?? 1);
  return (
    <>
      <Text fw={600} size="sm">
        Most alerts
      </Text>
      <Text size="xs" c="dimmed" mt={2} mb="sm">
        The repositories with the most; each opens its alerts on GitHub
      </Text>
      <Stack gap={2}>
        {repositories.slice(0, limit).map((r) => (
          <BarLink
            key={r.fullName}
            href={`https://github.com/${r.fullName}/security/dependabot`}
            title={`Open the Dependabot alerts of ${r.fullName} on GitHub`}
            label={r.fullName.split('/')[1]!}
            value={r.open}
            width={r.open / max}
            bar={
              severityOf.get(r.fullName) ? (
                <SeverityBar severity={severityOf.get(r.fullName)!} className="severity-fill" />
              ) : undefined
            }
          />
        ))}
      </Stack>
      <ListMore shown={limit} total={repositories.length} onMore={() => setLimit((l) => l + LIST_STEP)} />
    </>
  );
}

/** The packages behind the most alerts: where an update does the most good. */
function VulnerablePackages({ packages }: { packages: AlertPackage[] }) {
  const [limit, setLimit] = useState(LIST_STEP);
  const max = packages[0]?.alerts ?? 1;
  return (
    <>
      <Text fw={600} size="sm">
        Most vulnerable packages
      </Text>
      <Text size="xs" c="dimmed" mt={2} mb="sm">
        The packages behind the most alerts: where an update does the most good
      </Text>
      <Stack gap={2}>
        {packages.slice(0, limit).map((p) => (
          <BarLink
            key={`${p.ecosystem}:${p.name}`}
            label={p.name}
            detail={`${ecosystem(p.ecosystem)} · ${num(p.repositories)} ${p.repositories === 1 ? 'repository' : 'repositories'}`}
            value={p.alerts}
            width={p.alerts / max}
          />
        ))}
      </Stack>
      <ListMore shown={limit} total={packages.length} onMore={() => setLimit((l) => l + LIST_STEP)} />
    </>
  );
}

const YEAR_MS = 365 * 86_400_000;

/** A date as its month and year, as "Feb 2022": exact where "2 years ago" rounds. */
const monthYear = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });

/** How long untouched, by whole years: the three groups the section is split in. */
const STALE_GROUPS = [
  { key: 'one', label: '1–2 years', color: 'yellow.5', test: (years: number) => years < 2 },
  { key: 'two', label: '2–3 years', color: 'orange.5', test: (years: number) => years >= 2 && years < 3 },
  { key: 'more', label: 'Over 3 years', color: 'red.6', test: (years: number) => years >= 3 },
] as const;

const yearsSince = (iso: string | null) =>
  iso ? (Date.now() - new Date(iso).getTime()) / YEAR_MS : Infinity;
const staleColor = (iso: string | null) =>
  STALE_GROUPS.find((g) => g.test(yearsSince(iso)))?.color ?? 'red.6';

/** Active repositories nobody has pushed to in over a year: candidates for archiving. */
function Stale({ stale, active }: { stale: QualityResponse['stale']; active: number }) {
  const [all, setAll] = useState(false);
  if (!stale.length) return null;
  const shown = all ? stale : stale.slice(0, 12);
  const counts = STALE_GROUPS.map((g) => ({
    ...g,
    count: stale.filter((r) => g.test(yearsSince(r.pushedAt))).length,
  }));
  return (
    <Box mt={48}>
      <SectionTitle
        title="Not pushed to in over a year"
        caption={`${num(stale.length)} of its ${num(active)} active repositories, ${percent(stale.length / active)}: candidates for archiving`}
      />
      <SimpleGrid cols={3} spacing={0} className="quality-strip alert-strip">
        {counts.map((g) => (
          <Box key={g.key} className="quality-stat">
            <Group gap={7} wrap="nowrap">
              <span className="lang-dot" style={{ background: cssColor(g.color), margin: 0 }} />
              <Text size="sm" c="dimmed" truncate>
                {g.label}
              </Text>
            </Group>
            <Text fw={650} lh={1.1} mt={8} className="tabular alert-value">
              {num(g.count)}
            </Text>
          </Box>
        ))}
      </SimpleGrid>
      <div
        className="severity-split"
        style={{ marginTop: 18 }}
        role="img"
        aria-label="Untouched repositories by years"
      >
        {counts
          .filter((g) => g.count > 0)
          .map((g) => (
            <Tooltip key={g.key} label={`${g.label}: ${num(g.count)}`}>
              <span style={{ flexGrow: g.count, background: cssColor(g.color) }} />
            </Tooltip>
          ))}
      </div>

      <Text fw={600} size="sm" mt={36} mb="sm">
        Longest untouched
      </Text>
      <SimpleGrid cols={{ base: 1, xs: 2, md: 3, xl: 4 }} spacing={4} verticalSpacing={4}>
        {shown.map((r) => {
          const [owner, name] = r.fullName.split('/') as [string, string];
          return (
            <Tooltip
              key={r.fullName}
              label={r.description ?? 'No description'}
              multiline
              maw={320}
              openDelay={300}
            >
              <Anchor
                component={Link}
                to={repoPath({ owner, name })}
                underline="never"
                c="inherit"
                className="stale-tile"
              >
                <span className="stale-mark" style={{ background: cssColor(staleColor(r.pushedAt)) }} />
                <Box miw={0}>
                  <Text size="sm" fw={500} truncate>
                    {name}
                  </Text>
                  <Group gap={6} wrap="nowrap" mt={2}>
                    <Text size="xs" c="dimmed" style={{ flex: 'none' }}>
                      {r.pushedAt ? monthYear(r.pushedAt) : 'Never pushed'}
                    </Text>
                    {r.language && (
                      <>
                        <span
                          className="lang-dot"
                          style={{ background: languageColor(r.language), margin: 0 }}
                        />
                        <Text size="xs" c="dimmed" truncate>
                          {r.language}
                        </Text>
                      </>
                    )}
                  </Group>
                </Box>
              </Anchor>
            </Tooltip>
          );
        })}
      </SimpleGrid>
      {stale.length > 12 && (
        <Group justify="center" mt="md">
          <Button variant="default" onClick={() => setAll((v) => !v)}>
            {all ? 'Show fewer' : `Show all ${num(stale.length)}`}
          </Button>
        </Group>
      )}
    </Box>
  );
}

/**
 * Where the details go while every alert is read: the same layout, empty, so the page fills in at
 * once rather than a section at a time.
 */
function AlertsLoading() {
  const block = (title: string, height: number) => (
    <Box>
      <Text fw={600} size="sm" mb="sm">
        {title}
      </Text>
      <Skeleton height={height} radius="md" />
    </Box>
  );
  return (
    <Box aria-busy="true">
      <Box mt={36}>
        <Text fw={600} size="sm" mb="xs">
          By severity
        </Text>
        <Skeleton height={10} radius="xl" />
        <Text size="xs" c="dimmed" mt="sm">
          Reading every alert, to tell how severe and how old they are…
        </Text>
      </Box>
      <SimpleGrid cols={{ base: 1, md: 2 }} spacing={48} mt={36}>
        {block("How long they've been open", 200)}
        {block('By ecosystem', 200)}
        {block('Most alerts', 260)}
        {block('Most vulnerable packages', 260)}
      </SimpleGrid>
    </Box>
  );
}

/** Opens the organization's own Dependabot alerts on GitHub. */
function GitHubButton({ href }: { href: string }) {
  return (
    <Button
      variant="default"
      size="xs"
      component="a"
      href={href}
      target="_blank"
      rel="noreferrer"
      leftSection={<MarkGithubIcon size={14} />}
      rightSection={<IconExternalLink size={13} stroke={1.8} />}
    >
      View on GitHub
    </Button>
  );
}

/** One figure of the alerts summary: a large number and what it counts. */
function AlertStat({
  value,
  label,
  color,
  of,
}: {
  value: number;
  label: string;
  color?: string;
  of?: number;
}) {
  return (
    <Box className="quality-stat">
      <Text size="sm" c="dimmed">
        {label}
      </Text>
      <Group gap={6} align="baseline" mt={8} wrap="nowrap">
        <Text fw={650} lh={1.1} c={color} className="tabular alert-value">
          {num(value)}
        </Text>
        {of != null && (
          <Text size="sm" c="dimmed" className="tabular">
            of {num(of)}
          </Text>
        )}
      </Group>
    </Box>
  );
}

function Alerts({ login, alerts }: { login: string; alerts: SecurityResponse['alerts'] }) {
  const severities = useAlertDetails(login, Boolean(alerts?.open));
  const severityOf = useMemo(
    () => new Map((severities.data?.repositories ?? []).map((r) => [r.fullName, r.severity])),
    [severities.data],
  );
  const action = <GitHubButton href={`https://github.com/orgs/${login}/security/alerts/dependabot`} />;
  if (!alerts) {
    return (
      <Box>
        <SectionTitle title="Dependabot alerts" />
        <Group gap="sm" wrap="nowrap" align="flex-start">
          <IconLock
            size={18}
            stroke={1.6}
            color="var(--mantine-color-dimmed)"
            style={{ flex: 'none', marginTop: 2 }}
          />
          <Text size="sm" c="dimmed">
            GitHub shows a repository&apos;s Dependabot alerts only to people who can write to it, and you
            can&apos;t write to any of its active repositories.
          </Text>
        </Group>
      </Box>
    );
  }
  const affected = alerts.repositories.length;
  const clean = alerts.readable - affected;
  const packages = severities.data?.details?.packages;
  return (
    <Box>
      <SectionTitle
        title="Dependabot alerts"
        caption={`On the ${num(alerts.readable)} active repositories you can write to, the only ones GitHub shows alerts for`}
        action={action}
      />
      <SimpleGrid cols={3} spacing={0} verticalSpacing="lg" className="quality-strip alert-strip">
        <AlertStat value={alerts.open} label="Open alerts" color={alerts.open ? 'red.5' : 'teal.5'} />
        <AlertStat value={affected} of={alerts.readable} label="Repositories with alerts" />
        <AlertStat
          value={clean}
          of={alerts.readable}
          label="Without alerts"
          color={clean ? 'teal.5' : undefined}
        />
      </SimpleGrid>

      {affected === 0 ? (
        <Group gap="sm" wrap="nowrap" mt="xl">
          <IconShieldCheck size={22} stroke={1.6} color={cssColor('teal.5')} />
          <Text size="sm">No open alerts on any of them.</Text>
        </Group>
      ) : severities.isLoading ? (
        <AlertsLoading />
      ) : (
        <>
          <Severities query={severities} open={alerts.open} />
          {severities.data?.details && <AlertAgeAndEcosystems details={severities.data.details} />}
          <Grid gap="md" mt={36}>
            <Grid.Col span={{ base: 12, md: packages?.length ? 6 : 12 }} pr={{ md: 'xl' }}>
              <MostAlerts repositories={alerts.repositories} severityOf={severityOf} />
            </Grid.Col>
            {packages && packages.length > 0 && (
              <Grid.Col span={{ base: 12, md: 6 }} pl={{ md: 'xl' }} className="split-col">
                <VulnerablePackages packages={packages} />
              </Grid.Col>
            )}
          </Grid>
        </>
      )}
    </Box>
  );
}

/** Shown when an organization owns more repositories than can be read exactly. */
const tooMany = (
  <EmptyState
    icon={<IconShieldCheck size={28} />}
    title="Too many repositories to measure"
    description="It owns more than 1,000 repositories, more than can be read exactly, so this page is left out."
  />
);

export function Quality() {
  const { login = '' } = useParams();
  const query = useQuality(login);
  const { refresh, refreshing } = useRefresh(login, 'quality');
  const quality = query.data?.quality;

  return (
    <>
      <PageHeader
        title="Quality"
        icon={<IconChecklist size={26} stroke={1.6} />}
        description="How well kept its repositories are, how alive, and which ones nobody touches anymore."
        stats={
          quality && (
            <Counters>
              <Counter
                icon={IconFolders}
                value={num(quality.active)}
                label="Active"
                hint="Its own repositories, not forks, not archived: what this page measures"
              />
              <Counter icon={IconBook2} value={num(quality.archived)} label="Archived" />
            </Counters>
          )
        }
        onRefresh={refresh}
        refreshing={refreshing}
      />
      <Loaded query={query}>
        {({ quality: h }) =>
          !h ? (
            tooMany
          ) : h.active === 0 ? (
            <EmptyState icon={<IconChecklist size={28} />} title="No active repositories to measure" />
          ) : (
            <>
              <SectionTitle title="Quality" caption={`Across its ${num(h.active)} active repositories`} />
              <SimpleGrid
                cols={{ base: 2, md: 4 }}
                spacing={0}
                verticalSpacing="lg"
                className="quality-strip"
              >
                {h.quality.map((q) => (
                  <QualityStat key={q.key} measure={q} of={h.active} />
                ))}
              </SimpleGrid>

              <Grid gap="md" mt={48}>
                <Grid.Col span={{ base: 12, md: 6 }} pr={{ md: 'xl' }}>
                  <Box className="lines-between">
                    <Activity activity={h.activity} of={h.active} />
                  </Box>
                </Grid.Col>
                <Grid.Col span={{ base: 12, md: 6 }} pl={{ md: 'xl' }} className="split-col">
                  <Box className="lines-between">
                    <Licenses licenses={h.licenses} of={h.active} />
                  </Box>
                </Grid.Col>
              </Grid>

              <Stale stale={h.stale} active={h.active} />
            </>
          )
        }
      </Loaded>
    </>
  );
}

export function Security() {
  const { login = '' } = useParams();
  const query = useSecurity(login);
  const securityRefresh = useRefresh(login, 'security');
  const alertsRefresh = useRefresh(login, 'alerts');
  // The details are read from the repositories the counts found alerts on: after them, then.
  const refresh = async () => {
    await securityRefresh.refresh();
    await alertsRefresh.refresh();
  };
  const refreshing = securityRefresh.refreshing || alertsRefresh.refreshing;

  return (
    <>
      <PageHeader
        title="Security"
        icon={<IconShieldCheck size={26} stroke={1.6} />}
        description="What Dependabot found in its repositories: how many alerts, how severe, how old, and in which packages."
        onRefresh={refresh}
        refreshing={refreshing}
      />
      <Loaded query={query}>
        {({ security }) =>
          !security ? (
            tooMany
          ) : security.active === 0 ? (
            <EmptyState icon={<IconShieldCheck size={28} />} title="No active repositories to measure" />
          ) : (
            <Alerts login={login} alerts={security.alerts} />
          )
        }
      </Loaded>
    </>
  );
}

// Sponsors ----------------------------------------------------------------------------------------

export function Sponsors() {
  const { login = '' } = useParams();
  const query = useSponsors(login);
  const { refresh, refreshing } = useRefresh(login, 'sponsors');

  const list = (people: AccountPerson[], total: number, empty: string) => (
    <>
      {people.length ? (
        <div className="rank-list">
          {people.map((p) => (
            <PersonRow key={p.login} person={p} />
          ))}
        </div>
      ) : (
        total === 0 && (
          <Text size="sm" c="dimmed">
            {empty}
          </Text>
        )
      )}
      {total > people.length && (
        <Text size="xs" c="dimmed" mt="xs">
          {people.length ? 'And ' : ''}
          {num(total - people.length)} more GitHub doesn&apos;t list, private or past the first 100.
        </Text>
      )}
    </>
  );

  return (
    <>
      <PageHeader
        title="Sponsors"
        icon={<IconHeart size={26} stroke={1.6} />}
        description="Who it supports through GitHub Sponsors, and who supports it, as GitHub shows publicly."
        stats={
          query.data && (
            <Counters>
              <Counter icon={IconHeart} value={num(query.data.totals.sponsoring)} label="Sponsoring" />
              <Counter icon={IconUsers} value={num(query.data.totals.sponsors)} label="Sponsors" />
            </Counters>
          )
        }
        onRefresh={refresh}
        refreshing={refreshing}
      />
      <Loaded query={query}>
        {(data) => (
          <Grid gap="md">
            <Grid.Col span={{ base: 12, md: 6 }} pr={{ md: 'xl' }}>
              <SectionTitle title="Sponsoring" caption="The accounts it sponsors" />
              {list(data.sponsoring, data.totals.sponsoring, 'It sponsors no one publicly.')}
            </Grid.Col>
            <Grid.Col span={{ base: 12, md: 6 }} pl={{ md: 'xl' }} className="split-col">
              <SectionTitle title="Sponsored by" caption="The accounts that sponsor it" />
              {list(data.sponsors, data.totals.sponsors, 'No one sponsors it publicly.')}
            </Grid.Col>
          </Grid>
        )}
      </Loaded>
    </>
  );
}
