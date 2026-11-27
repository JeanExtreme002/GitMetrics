import {
  ActionIcon,
  Avatar,
  Badge,
  Box,
  Button,
  Group,
  Paper,
  SegmentedControl,
  Select,
  Table,
  Text,
  TextInput,
  Tooltip,
} from '@mantine/core';
import { IconBook2, IconSearch, IconSortAscending, IconSortDescending } from '@tabler/icons-react';
import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import type { RepoSummary } from '../../shared/types';
import { LanguageDot, PinButton, repoPath } from '../components/repo';
import { ErrorState, PageHeader, PageSkeleton } from '../components/ui';
import { cleanText, num, relative } from '../lib/format';
import { useAccountRepos, useOwners, useRepos } from '../lib/queries';

type Kind = 'sources' | 'forks' | 'archived' | 'all';
type Sort = 'stars' | 'pushed' | 'name';

type Visibility = RepoSummary['visibility'];

const PAGE = 30;
const NO_LANGUAGE = '__none__';

/** How each sort reads in its default order and when reversed. */
const ORDER_LABELS: Record<Sort, [string, string]> = {
  pushed: ['Most recent first', 'Oldest first'],
  stars: ['Most stars first', 'Fewest stars first'],
  name: ['A to Z', 'Z to A'],
};

function RepoTable({
  repos,
  showOwner,
  showAvatar,
}: {
  repos: RepoSummary[];
  showOwner: boolean;
  showAvatar: boolean;
}) {
  const navigate = useNavigate();
  return (
    <Table.ScrollContainer minWidth={680}>
      <Table highlightOnHover verticalSpacing="sm" horizontalSpacing="lg">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Repository</Table.Th>
            <Table.Th w={150}>Language</Table.Th>
            <Table.Th w={90} ta="right">
              Stars
            </Table.Th>
            <Table.Th w={90} ta="right">
              Forks
            </Table.Th>
            <Table.Th w={150} style={{ whiteSpace: 'nowrap' }}>
              Last updated
            </Table.Th>
            <Table.Th w={48} />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {repos.map((repo) => (
            <Table.Tr key={repo.id} className="clickable-row" onClick={() => navigate(repoPath(repo))}>
              <Table.Td>
                <Group gap="sm" wrap="nowrap">
                  {showAvatar && <Avatar src={repo.ownerAvatarUrl} size={24} radius="sm" />}
                  <Box miw={0}>
                    <Group gap={6} wrap="nowrap">
                      <Text size="sm" fw={600} truncate>
                        {showOwner ? repo.fullName : repo.name}
                      </Text>
                      {repo.visibility !== 'public' && (
                        <Badge size="xs" variant="outline" color="gray" style={{ flex: 'none' }}>
                          {repo.visibility === 'internal' ? 'Internal' : 'Private'}
                        </Badge>
                      )}
                      {repo.fork && (
                        <Badge size="xs" variant="outline" color="gray" style={{ flex: 'none' }}>
                          Fork
                        </Badge>
                      )}
                      {repo.archived && (
                        <Badge size="xs" variant="outline" color="yellow" style={{ flex: 'none' }}>
                          Archived
                        </Badge>
                      )}
                    </Group>
                    {repo.description && (
                      <Text size="xs" c="dimmed" truncate maw={560}>
                        {cleanText(repo.description)}
                      </Text>
                    )}
                  </Box>
                </Group>
              </Table.Td>
              <Table.Td>
                <LanguageDot language={repo.language} />
              </Table.Td>
              <Table.Td ta="right" className="tabular">
                {num(repo.stars)}
              </Table.Td>
              <Table.Td ta="right" className="tabular">
                {num(repo.forks)}
              </Table.Td>
              <Table.Td style={{ whiteSpace: 'nowrap' }}>
                <Text size="sm" c="dimmed">
                  {relative(repo.pushedAt)}
                </Text>
              </Table.Td>
              <Table.Td>
                <PinButton fullName={repo.fullName} />
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  );
}

/**
 * Every repository you can reach, or one account's. `owner` fixes the account, as on an
 * organization's own Repositories page, where there's no account to pick; an `organization`'s are
 * read as its own list, every one you can see, rather than the part of your list that it owns.
 */
export function Repositories({
  owner: fixed,
  organization = false,
}: { owner?: string; organization?: boolean } = {}) {
  const repos = useRepos();
  const owners = useOwners();
  const [params, setParams] = useSearchParams();
  const owner = fixed ?? params.get('owner') ?? 'all';
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState<Kind>('all');
  const [sort, setSort] = useState<Sort>('pushed');
  const [reversed, setReversed] = useState(false);
  const [language, setLanguage] = useState<string | null>(null);
  const [visibility, setVisibility] = useState<Visibility | null>(null);
  const [limit, setLimit] = useState(PAGE);

  // An account outside your own list (opened from its page): its own repositories, read apart.
  // An organization's own page reads its own list: yours holds only the repositories you were given
  // access to, not its public and internal ones.
  const external =
    (organization && owner !== 'all') ||
    (Boolean(repos.data) &&
      owner !== 'all' &&
      !owners.some((o) => o.login.toLowerCase() === owner.toLowerCase()));
  const outside = useAccountRepos(owner, external, organization);
  const source = useMemo(
    () => (external ? (outside.data?.repos ?? []) : (repos.data?.repos ?? [])),
    [external, outside.data, repos.data],
  );

  // Account and type narrow the list first, so the other options always match what is on screen.
  const byKind = useMemo(
    () =>
      source
        .filter((r) => external || owner === 'all' || r.owner === owner)
        .filter((r) =>
          kind === 'all'
            ? true
            : kind === 'forks'
              ? r.fork
              : kind === 'archived'
                ? r.archived
                : !r.fork && !r.archived,
        ),
    [source, external, owner, kind],
  );
  const visibilities = useMemo(() => {
    const count = (v: Visibility) => byKind.filter((r) => r.visibility === v).length;
    const internal = count('internal');
    return [
      { value: 'public', label: `Public (${num(count('public'))})` },
      { value: 'private', label: `Private (${num(count('private'))})` },
      // Only organizations in an enterprise have internal repositories.
      ...(internal ? [{ value: 'internal', label: `Internal (${num(internal)})` }] : []),
    ];
  }, [byKind]);
  const scoped = useMemo(
    () => byKind.filter((r) => !visibility || r.visibility === visibility),
    [byKind, visibility],
  );

  const languages = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of scoped)
      counts.set(r.language ?? NO_LANGUAGE, (counts.get(r.language ?? NO_LANGUAGE) ?? 0) + 1);
    return [...counts.entries()]
      .sort((a, b) => Number(a[0] === NO_LANGUAGE) - Number(b[0] === NO_LANGUAGE) || b[1] - a[1])
      .map(([value, count]) => ({
        value,
        label: `${value === NO_LANGUAGE ? 'No language' : value} (${num(count)})`,
      }));
  }, [scoped]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    const compare = (a: RepoSummary, b: RepoSummary) =>
      sort === 'stars'
        ? b.stars - a.stars || a.name.localeCompare(b.name)
        : sort === 'name'
          ? a.name.localeCompare(b.name)
          : (b.pushedAt ?? '').localeCompare(a.pushedAt ?? '');
    return scoped
      .filter((r) => !language || (r.language ?? NO_LANGUAGE) === language)
      .filter(
        (r) =>
          !term ||
          [r.fullName, r.description ?? '', r.language ?? '', ...r.topics].some((v) =>
            v.toLowerCase().includes(term),
          ),
      )
      .sort((a, b) => (reversed ? -compare(a, b) : compare(a, b)));
  }, [scoped, language, search, sort, reversed]);

  // An organization's own page reads its own list alone: no waiting on yours, nor failing with it.
  if ((!organization && repos.isLoading) || (external && outside.isLoading)) return <PageSkeleton />;
  if (!organization && (repos.error || !repos.data)) {
    return <ErrorState error={repos.error} onRetry={() => repos.refetch()} />;
  }
  if (external && (outside.error || !outside.data)) {
    return <ErrorState error={outside.error} onRetry={() => outside.refetch()} />;
  }

  const setOwner = (value: string | null) => {
    setLimit(PAGE);
    // Another account may not have the language or visibility picked: an empty list with a blank
    // filter otherwise. Start its list unfiltered.
    setLanguage(null);
    setVisibility(null);
    setParams(value && value !== 'all' ? { owner: value } : {});
  };

  return (
    <>
      <PageHeader
        title="Repositories"
        icon={<IconBook2 size={26} stroke={1.6} />}
        description={
          organization
            ? `Everything ${owner} owns that you can see${outside.data?.complete === false ? ', the 1,000 pushed to most recently' : ''}.`
            : external
              ? `The public repositories of ${owner}${outside.data?.complete ? '' : ', the 1,000 pushed to most recently'}.`
              : fixed
                ? `Everything ${owner} owns that you can see.`
                : 'Everything you own, plus what you can reach through your organizations.'
        }
      />

      <Group gap="sm" mb="md" wrap="wrap">
        <TextInput
          placeholder="Find a repository"
          leftSection={<IconSearch size={16} stroke={1.6} />}
          value={search}
          onChange={(e) => {
            setSearch(e.currentTarget.value);
            setLimit(PAGE);
          }}
          style={{ flex: 1 }}
          miw={170}
        />
        {!fixed && (
          <Select
            value={owner}
            onChange={setOwner}
            allowDeselect={false}
            w={190}
            data={[
              { value: 'all', label: `All accounts (${num(repos.data?.repos.length ?? 0)})` },
              ...owners.map((o) => ({ value: o.login, label: `${o.login} (${num(o.count)})` })),
              ...(external ? [{ value: owner, label: `${owner} (${num(source.length)})` }] : []),
            ]}
          />
        )}
        <Select
          value={language && languages.some((l) => l.value === language) ? language : null}
          onChange={(v) => {
            setLanguage(v);
            setLimit(PAGE);
          }}
          placeholder="All languages"
          data={languages}
          clearable
          searchable
          nothingFoundMessage="No language matches"
          w={165}
        />
        <Select
          value={visibility}
          onChange={(v) => {
            setVisibility(v as Visibility | null);
            setLimit(PAGE);
          }}
          placeholder="All visibility"
          data={visibilities}
          clearable
          w={150}
          aria-label="Visibility"
        />
        <SegmentedControl
          value={kind}
          onChange={(v) => {
            setKind(v as Kind);
            setLimit(PAGE);
          }}
          data={[
            { label: 'All', value: 'all' },
            { label: 'Sources', value: 'sources' },
            { label: 'Forks', value: 'forks' },
            { label: 'Archived', value: 'archived' },
          ]}
        />
      </Group>

      {/* The result count and the order of the list sit together, right above the table. */}
      <Group justify="space-between" align="center" mb="xs" gap="sm">
        <Text size="sm" c="dimmed">
          {num(filtered.length)} {filtered.length === 1 ? 'repository' : 'repositories'}
        </Text>
        <Group gap={6} wrap="nowrap" aria-label="Order">
          <Select
            value={sort}
            onChange={(v) => {
              setSort((v as Sort) ?? 'pushed');
              setReversed(false);
            }}
            allowDeselect={false}
            w={140}
            data={[
              { label: 'Last updated', value: 'pushed' },
              { label: 'Stars', value: 'stars' },
              { label: 'Name', value: 'name' },
            ]}
          />
          <Tooltip label={`${ORDER_LABELS[sort][reversed ? 1 : 0]} · click to reverse`}>
            <ActionIcon
              variant="default"
              size={36}
              onClick={() => setReversed((r) => !r)}
              aria-label="Reverse the order"
            >
              {(sort === 'name') === reversed ? (
                <IconSortDescending size={18} stroke={1.6} />
              ) : (
                <IconSortAscending size={18} stroke={1.6} />
              )}
            </ActionIcon>
          </Tooltip>
        </Group>
      </Group>
      <Paper p={0} style={{ overflow: 'hidden' }}>
        {filtered.length ? (
          <RepoTable
            repos={filtered.slice(0, limit)}
            showOwner={owner === 'all'}
            // The account's logo even when filtered by it; an organization's own page has it in its sidebar.
            showAvatar={!fixed}
          />
        ) : (
          <Text c="dimmed" ta="center" p="xl" size="sm">
            No repository matches these filters.
          </Text>
        )}
      </Paper>
      {filtered.length > limit && (
        <Group justify="center" mt="md">
          <Button variant="default" onClick={() => setLimit((l) => l + PAGE)}>
            Show more ({num(filtered.length - limit)} left)
          </Button>
        </Group>
      )}
    </>
  );
}
