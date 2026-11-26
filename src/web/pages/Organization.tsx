import {
  Anchor,
  Avatar,
  Badge,
  Box,
  Button,
  Grid,
  Group,
  SimpleGrid,
  Text,
  TextInput,
  Tooltip,
} from '@mantine/core';
import {
  IconBook2,
  IconFolders,
  IconHeart,
  IconLock,
  IconSearch,
  IconShieldCheck,
  IconShieldExclamation,
  IconUsers,
  IconUsersGroup,
} from '@tabler/icons-react';
import { useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { useMemo, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import type { AccountPerson, HealthResponse, QualityMeasure } from '../../shared/types';
import { LanguagesDonut, SectionTitle } from '../components/overview';
import { Counter, Counters, EmptyState, ErrorState, PageHeader, PageSkeleton } from '../components/ui';
import { api } from '../lib/api';
import { compact, num, percent } from '../lib/format';
import { accountPageKey, useAccount, useHealth, usePeople, useSponsors, useTeams } from '../lib/queries';
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

/** A box to find something in a long list, and the count of what matches. */
function Finder({
  value,
  onChange,
  placeholder,
  shown,
  noun,
}: {
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
      <Text size="sm" c="dimmed">
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
  const { data } = useAccount(login);
  return <Repositories owner={data?.login ?? login} />;
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

  return (
    <>
      <PageHeader
        title="People"
        icon={<IconUsers size={26} stroke={1.6} />}
        description={
          query.data && !query.data.member
            ? 'Its public members. Members of the organization also see everyone else.'
            : 'Everyone in the organization, admins first.'
        }
        stats={
          query.data && (
            <Counters>
              <Counter icon={IconUsers} value={num(query.data.total)} label="Members" />
              {query.data.member && (
                <Counter
                  icon={IconShieldCheck}
                  value={num(admins)}
                  label="Admins"
                  hint="Members who can manage the organization"
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
            <SimpleGrid
              cols={{ base: 1, sm: 2, lg: 3 }}
              spacing={0}
              verticalSpacing={0}
              className="people-grid"
            >
              {shown.slice(0, limit).map((p) => (
                <PersonRow
                  key={p.login}
                  person={p}
                  right={
                    p.role === 'admin' && (
                      <Badge variant="light" color="gray" tt="none" radius="sm" style={{ flex: 'none' }}>
                        Admin
                      </Badge>
                    )
                  }
                />
              ))}
            </SimpleGrid>
            {shown.length === 0 && (
              <Text size="sm" c="dimmed" py="md">
                No member matches.
              </Text>
            )}
            <ShowMore left={shown.length - limit} onClick={() => setLimit((l) => l + PAGE)} />
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
  const shown = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (query.data?.teams ?? []).filter(
      (t) =>
        !term ||
        t.name.toLowerCase().includes(term) ||
        (t.description ?? '').toLowerCase().includes(term) ||
        (t.parent ?? '').toLowerCase().includes(term),
    );
  }, [query.data, search]);
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
              />
              <div className="rank-list">
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
              {shown.length === 0 && (
                <Text size="sm" c="dimmed" py="md">
                  No team matches.
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

const QUALITY: Record<QualityMeasure['key'], { label: string; hint: string }> = {
  license: { label: 'A license', hint: 'People know how they may use it' },
  description: { label: 'A description', hint: 'Its purpose, shown in lists and search' },
  topics: { label: 'Topics', hint: 'Found when people browse a subject' },
  issues: { label: 'Issues open', hint: 'People can report problems and ask for things' },
};

const ACTIVITY: { key: keyof HealthResponse['activity']; label: string; color: string }[] = [
  { key: 'month', label: 'Last 30 days', color: 'teal.5' },
  { key: 'quarter', label: '1 to 3 months ago', color: 'teal.3' },
  { key: 'year', label: '3 to 12 months ago', color: 'yellow.5' },
  { key: 'older', label: 'Over a year ago', color: 'orange.5' },
  { key: 'never', label: 'Never pushed to', color: 'gray.5' },
];

const LICENSE_COLORS = ['blue.5', 'teal.5', 'grape.4', 'yellow.5', 'orange.5'];

/** A share of the active repositories, as a label, its count and share, and a bar. */
function Share({
  label,
  hint,
  value,
  of,
  color,
}: {
  label: string;
  hint: string;
  value: number;
  of: number;
  color: string;
}) {
  const ratio = of ? value / of : 0;
  return (
    <Tooltip label={hint} position="top-start">
      <Box className="owns-bar">
        <Group justify="space-between" wrap="nowrap">
          <Text size="sm">{label}</Text>
          <Group gap={10} wrap="nowrap" className="tabular">
            <Text size="sm" fw={600}>
              {num(value)}
            </Text>
            <Text size="sm" c="dimmed" w={38} ta="right">
              {percent(ratio)}
            </Text>
          </Group>
        </Group>
        <div className="rank-track">
          <div className="rank-fill" style={{ width: `${ratio * 100}%`, background: cssColor(color) }} />
        </div>
      </Box>
    </Tooltip>
  );
}

function Alerts({ alerts }: { alerts: HealthResponse['alerts'] }) {
  if (!alerts) {
    return (
      <Box>
        <SectionTitle title="Dependabot alerts" />
        <Text size="sm" c="dimmed">
          GitHub shows a repository&apos;s Dependabot alerts only to people who can write to it, and you
          can&apos;t write to any of its active repositories.
        </Text>
      </Box>
    );
  }
  const max = Math.max(1, alerts.repositories[0]?.open ?? 1);
  return (
    <Box>
      <SectionTitle
        title="Dependabot alerts"
        caption={`Open on the ${num(alerts.readable)} active repositories you can write to, the only ones GitHub shows alerts for`}
      />
      <Group gap={10} align="baseline" mb="md">
        <Text fz={32} fw={650} lh={1} className="tabular" c={alerts.open ? 'red.5' : undefined}>
          {num(alerts.open)}
        </Text>
        <Text size="sm" c="dimmed">
          open {alerts.open === 1 ? 'alert' : 'alerts'} in {num(alerts.repositories.length)}{' '}
          {alerts.repositories.length === 1 ? 'repository' : 'repositories'}
        </Text>
      </Group>
      {alerts.repositories.length > 0 && (
        <div className="rank-list">
          {alerts.repositories.slice(0, 10).map((r) => (
            <Anchor
              key={r.fullName}
              href={`https://github.com/${r.fullName}/security/dependabot`}
              target="_blank"
              rel="noreferrer"
              underline="never"
              c="inherit"
              className="alert-row account-link"
            >
              <Text size="sm" fw={500} truncate>
                {r.fullName.split('/')[1]}
              </Text>
              <div className="rank-track">
                <div
                  className="rank-fill"
                  style={{ width: `${(r.open / max) * 100}%`, background: cssColor('red.5') }}
                />
              </div>
              <Text size="sm" fw={600} ta="right" className="tabular">
                {num(r.open)}
              </Text>
            </Anchor>
          ))}
        </div>
      )}
      {alerts.repositories.length > 10 && (
        <Text size="xs" c="dimmed" mt="xs">
          And {num(alerts.repositories.length - 10)} more repositories with open alerts.
        </Text>
      )}
    </Box>
  );
}

export function Health() {
  const { login = '' } = useParams();
  const query = useHealth(login);
  const { refresh, refreshing } = useRefresh(login, 'health');
  const health = query.data?.health;

  return (
    <>
      <PageHeader
        title="Security & quality"
        icon={<IconShieldCheck size={26} stroke={1.6} />}
        description="How well kept its repositories are, how alive, and what Dependabot found in them."
        stats={
          health && (
            <Counters>
              <Counter
                icon={IconFolders}
                value={num(health.active)}
                label="Active"
                hint="Its own repositories, not forks, not archived: what this page measures"
              />
              <Counter icon={IconBook2} value={num(health.archived)} label="Archived" />
              {health.alerts && (
                <Counter
                  icon={IconShieldExclamation}
                  value={compact(health.alerts.open)}
                  label="Open alerts"
                  hint="Dependabot alerts on the repositories you can write to"
                />
              )}
            </Counters>
          )
        }
        onRefresh={refresh}
        refreshing={refreshing}
      />
      <Loaded query={query}>
        {({ health: h }) =>
          !h ? (
            <EmptyState
              icon={<IconShieldCheck size={28} />}
              title="Too many repositories to measure"
              description="It owns more than 1,000 repositories, more than can be read exactly, so this page is left out."
            />
          ) : h.active === 0 ? (
            <EmptyState icon={<IconShieldCheck size={28} />} title="No active repositories to measure" />
          ) : (
            <>
              <Grid gap="md">
                <Grid.Col span={{ base: 12, md: 6 }} pr={{ md: 'xl' }}>
                  <SectionTitle
                    title="Quality"
                    caption={`How many of its ${num(h.active)} active repositories have…`}
                  />
                  <Box className="no-lines">
                    {h.quality.map((q) => (
                      <Share
                        key={q.key}
                        label={QUALITY[q.key].label}
                        hint={QUALITY[q.key].hint}
                        value={q.count}
                        of={h.active}
                        color="blue.5"
                      />
                    ))}
                  </Box>
                </Grid.Col>
                <Grid.Col span={{ base: 12, md: 6 }} pl={{ md: 'xl' }} className="split-col">
                  <SectionTitle title="Activity" caption="Its active repositories by their last push" />
                  {/* One bar for all of them, split by how long ago they were pushed to. */}
                  <div className="activity-split" role="img" aria-label="Active repositories by last push">
                    {ACTIVITY.filter((a) => h.activity[a.key] > 0).map((a) => (
                      <Tooltip key={a.key} label={`${a.label}: ${num(h.activity[a.key])}`}>
                        <span style={{ flexGrow: h.activity[a.key], background: cssColor(a.color) }} />
                      </Tooltip>
                    ))}
                  </div>
                  <Box mt="md" className="lines-between">
                    <div className="rank-list">
                      {ACTIVITY.filter((a) => a.key !== 'never' || h.activity.never > 0).map((a) => (
                        <div key={a.key} className="legend-row">
                          <span className="lang-dot" style={{ background: cssColor(a.color), margin: 0 }} />
                          <Text size="sm">{a.label}</Text>
                          <Group gap={10} wrap="nowrap" className="tabular">
                            <Text size="sm" fw={600}>
                              {num(h.activity[a.key])}
                            </Text>
                            <Text size="sm" c="dimmed" w={38} ta="right">
                              {percent(h.activity[a.key] / h.active)}
                            </Text>
                          </Group>
                        </div>
                      ))}
                    </div>
                  </Box>
                </Grid.Col>
              </Grid>

              <Grid gap="md" mt={44}>
                <Grid.Col span={{ base: 12, md: 6 }} pr={{ md: 'xl' }}>
                  <Box className="lines-between">
                    <LanguagesDonut
                      title="Licenses"
                      caption={`Of its ${num(h.active)} active repositories`}
                      counts={h.licenses.map((l) => [l.name, l.count])}
                      colorOf={(name) =>
                        name === 'None'
                          ? cssColor('dark.3')
                          : cssColor(
                              LICENSE_COLORS[
                                h.licenses.findIndex((l) => l.name === name) % LICENSE_COLORS.length
                              ]!,
                            )
                      }
                    />
                  </Box>
                </Grid.Col>
                <Grid.Col span={{ base: 12, md: 6 }} pl={{ md: 'xl' }} className="split-col">
                  <Alerts alerts={h.alerts} />
                </Grid.Col>
              </Grid>
            </>
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
