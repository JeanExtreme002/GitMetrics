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
import {
  IconBook2,
  IconBuilding,
  IconCode,
  IconEye,
  IconLock,
  IconSearch,
  IconSortAscending,
  IconSortDescending,
  IconWorld,
} from '@tabler/icons-react';
import { useMemo, useState, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import type { RepoSummary } from '../../shared/types';
import { LanguageDot, PinButton, repoPath } from '../components/repo';
import { ErrorState, PageHeader, PageSkeleton } from '../components/ui';
import { cleanText, num, relative } from '../lib/format';
import { languageColor } from '../lib/languages';
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

/** An option of the filters: its mark, its name, and how many repositories it holds on the right. */
function OptionRow({ mark, label, count }: { mark: ReactNode; label: string; count: number }) {
  return (
    <Group gap={10} wrap="nowrap" justify="space-between" w="100%">
      <Group gap={10} wrap="nowrap" miw={0}>
        <Box w={22} style={{ display: 'flex', justifyContent: 'center', flex: 'none' }}>
          {mark}
        </Box>
        <Text size="sm" truncate>
          {label}
        </Text>
      </Group>
      <Text size="xs" c="dimmed" className="tabular" style={{ flex: 'none' }}>
        {num(count)} repos
      </Text>
    </Group>
  );
}

/** A language's color, as a dot; a hollow one for repositories with none. */
function LanguageMark({ language }: { language: string }) {
  const none = language === NO_LANGUAGE;
  return (
    <Box
      w={10}
      h={10}
      style={{
        borderRadius: 99,
        flex: 'none',
        background: none ? 'transparent' : languageColor(language),
        border: none ? '1.5px solid var(--mantine-color-dimmed)' : undefined,
      }}
    />
  );
}

/** Each visibility's icon, and one for all of them. */
const VISIBILITY_ICON: Record<Visibility | 'all', typeof IconWorld> = {
  all: IconEye,
  public: IconWorld,
  private: IconLock,
  internal: IconBuilding,
};

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
  const avatarOf = (login: string) =>
    owners.find((o) => o.login === login)?.avatarUrl ?? `https://github.com/${login}.png`;
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
  // How many each choice holds, as the list showed beside each name.
  const countOf = (value: string) =>
    value === 'all'
      ? (repos.data?.repos.length ?? 0)
      : (owners.find((o) => o.login === value)?.count ?? (value === owner ? source.length : 0));

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
      { value: 'public', label: 'Public', count: count('public') },
      { value: 'private', label: 'Private', count: count('private') },
      // Only organizations in an enterprise have internal repositories.
      ...(internal ? [{ value: 'internal', label: 'Internal', count: internal }] : []),
    ];
  }, [byKind]);
  // A choice the list no longer offers (Internal, after picking forks where there are none) no
  // longer narrows it: otherwise the field reads "All" while the list stays empty.
  const shownVisibility = visibility && visibilities.some((v) => v.value === visibility) ? visibility : null;
  const scoped = useMemo(
    () => byKind.filter((r) => !shownVisibility || r.visibility === shownVisibility),
    [byKind, shownVisibility],
  );

  const languages = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of scoped)
      counts.set(r.language ?? NO_LANGUAGE, (counts.get(r.language ?? NO_LANGUAGE) ?? 0) + 1);
    return [...counts.entries()]
      .sort((a, b) => Number(a[0] === NO_LANGUAGE) - Number(b[0] === NO_LANGUAGE) || b[1] - a[1])
      .map(([value, count]) => ({ value, label: value === NO_LANGUAGE ? 'No language' : value, count }));
  }, [scoped]);

  // The same for a language none of these repositories has.
  const shownLanguage = language && languages.some((l) => l.value === language) ? language : null;
  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    const compare = (a: RepoSummary, b: RepoSummary) =>
      sort === 'stars'
        ? b.stars - a.stars || a.name.localeCompare(b.name)
        : sort === 'name'
          ? a.name.localeCompare(b.name)
          : (b.pushedAt ?? '').localeCompare(a.pushedAt ?? '');
    return scoped
      .filter((r) => !shownLanguage || (r.language ?? NO_LANGUAGE) === shownLanguage)
      .filter(
        (r) =>
          !term ||
          [r.fullName, r.description ?? '', r.language ?? '', ...r.topics].some((v) =>
            v.toLowerCase().includes(term),
          ),
      )
      .sort((a, b) => (reversed ? -compare(a, b) : compare(a, b)));
  }, [scoped, shownLanguage, search, sort, reversed]);

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
          // As Radar's Where: the account's face in the field, and each one's count on its right.
          <Select
            value={owner}
            onChange={setOwner}
            allowDeselect={false}
            w={210}
            data={[
              { value: 'all', label: 'All accounts' },
              ...owners.map((o) => ({ value: o.login, label: o.login })),
              ...(external ? [{ value: owner, label: owner }] : []),
            ]}
            leftSection={
              owner === 'all' ? (
                <IconWorld size={15} stroke={1.7} />
              ) : (
                <Avatar src={avatarOf(owner)} size={18} radius="sm" />
              )
            }
            renderOption={({ option }) => (
              <Group gap={10} wrap="nowrap" justify="space-between" w="100%">
                <Group gap={10} wrap="nowrap" miw={0}>
                  {option.value === 'all' ? (
                    <IconWorld
                      size={16}
                      stroke={1.6}
                      color="var(--mantine-color-dimmed)"
                      style={{ flex: 'none', margin: '0 3px' }}
                    />
                  ) : (
                    <Avatar src={avatarOf(option.value)} size={22} radius="sm" />
                  )}
                  <Text size="sm" truncate>
                    {option.label}
                  </Text>
                </Group>
                <Text size="xs" c="dimmed" className="tabular" style={{ flex: 'none' }}>
                  {num(countOf(option.value))} repos
                </Text>
              </Group>
            )}
            comboboxProps={{ width: 300, position: 'bottom-start' }}
            maxDropdownHeight={360}
          />
        )}
        <Select
          value={shownLanguage}
          onChange={(v) => {
            setLanguage(v);
            setLimit(PAGE);
          }}
          placeholder="All languages"
          data={languages.map(({ value, label }) => ({ value, label }))}
          clearable
          searchable
          nothingFoundMessage="No language matches"
          w={190}
          // As the accounts: the language's color in the field, and each one's count on its right.
          leftSection={
            shownLanguage ? <LanguageMark language={shownLanguage} /> : <IconCode size={15} stroke={1.7} />
          }
          renderOption={({ option }) => (
            <OptionRow
              mark={<LanguageMark language={option.value} />}
              label={option.label}
              count={languages.find((l) => l.value === option.value)?.count ?? 0}
            />
          )}
          comboboxProps={{ width: 260, position: 'bottom-start' }}
          maxDropdownHeight={360}
        />
        <Select
          value={shownVisibility}
          onChange={(v) => {
            setVisibility(v as Visibility | null);
            setLimit(PAGE);
          }}
          placeholder="All visibility"
          data={visibilities.map(({ value, label }) => ({ value, label }))}
          clearable
          w={170}
          aria-label="Visibility"
          leftSection={(() => {
            const Mark = VISIBILITY_ICON[shownVisibility ?? 'all'];
            return <Mark size={15} stroke={1.7} />;
          })()}
          renderOption={({ option }) => {
            const Mark = VISIBILITY_ICON[option.value as Visibility];
            return (
              <OptionRow
                mark={<Mark size={16} stroke={1.6} color="var(--mantine-color-dimmed)" />}
                label={option.label}
                count={visibilities.find((v) => v.value === option.value)?.count ?? 0}
              />
            );
          }}
          comboboxProps={{ width: 240, position: 'bottom-start' }}
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
