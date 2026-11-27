import {
  ActionIcon,
  Anchor,
  Avatar,
  Badge,
  Box,
  Group,
  Paper,
  Stack,
  Text,
  Tooltip,
  UnstyledButton,
} from '@mantine/core';
import { IconGitFork, IconPin, IconPinFilled, IconStar } from '@tabler/icons-react';
import type { CSSProperties, ReactNode } from 'react';
import { Link } from 'react-router';
import type { PersonCount, RepoSummary } from '../../shared/types';
import { cleanText, compact, num, relative } from '../lib/format';
import { languageColor } from '../lib/languages';
import { useFavorites } from '../lib/queries';

export function LanguageDot({ language }: { language: string | null }) {
  if (!language) return null;
  return (
    <Group gap={6} wrap="nowrap">
      <Box w={10} h={10} style={{ borderRadius: 99, background: languageColor(language), flex: 'none' }} />
      <Text size="sm" c="dimmed" truncate>
        {language}
      </Text>
    </Group>
  );
}

export function PinButton({ fullName }: { fullName: string }) {
  const { isFavorite, toggle } = useFavorites();
  const pinned = isFavorite(fullName);
  return (
    <Tooltip label={pinned ? 'Unpin' : 'Pin to home'}>
      <ActionIcon
        variant="subtle"
        color={pinned ? 'brand' : 'gray'}
        aria-label={pinned ? 'Unpin repository' : 'Pin repository'}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          toggle(fullName);
        }}
      >
        {pinned ? <IconPinFilled size={17} /> : <IconPin size={17} stroke={1.6} />}
      </ActionIcon>
    </Tooltip>
  );
}

export const repoPath = (repo: { owner: string; name: string }) => `/r/${repo.owner}/${repo.name}`;

/**
 * A repository at a glance. The thin top edge takes the language color, which is
 * enough to tell repositories apart without repeating the same owner avatar.
 */
export function RepoCard({ repo, showOwner = false }: { repo: RepoSummary; showOwner?: boolean }) {
  return (
    <Paper
      component={Link}
      to={repoPath(repo)}
      className="repo-card"
      style={{ '--lang': languageColor(repo.language) } as CSSProperties}
    >
      <Group justify="space-between" wrap="nowrap" align="flex-start" gap="xs">
        <Box miw={0}>
          <Group gap={8} wrap="nowrap">
            <Text fw={600} fz="md" truncate>
              {repo.name}
            </Text>
            {/* The name gives way when it's long; the badge always shows whole. */}
            {repo.visibility !== 'public' && (
              <Badge size="xs" variant="outline" color="gray" style={{ flex: 'none' }}>
                {repo.visibility === 'internal' ? 'Internal' : 'Private'}
              </Badge>
            )}
          </Group>
          {showOwner && (
            <Text size="xs" c="dimmed" truncate>
              {repo.owner}
            </Text>
          )}
        </Box>
        <PinButton fullName={repo.fullName} />
      </Group>
      <Text size="sm" c="dimmed" lineClamp={2} mt={6} mih={42}>
        {cleanText(repo.description) || 'No description yet.'}
      </Text>
      <Group gap="lg" wrap="nowrap" mt="md" className="repo-card-meta">
        <LanguageDot language={repo.language} />
        <Group gap={5} wrap="nowrap">
          <IconStar size={14} stroke={1.8} />
          <Text size="sm" className="tabular">
            {compact(repo.stars)}
          </Text>
        </Group>
        <Group gap={5} wrap="nowrap">
          <IconGitFork size={14} stroke={1.8} />
          <Text size="sm" className="tabular">
            {compact(repo.forks)}
          </Text>
        </Group>
        <Text size="xs" c="dimmed" ml="auto" truncate>
          {relative(repo.pushedAt)}
        </Text>
      </Group>
    </Paper>
  );
}

export function PeopleList({ people, unit }: { people: PersonCount[]; unit: string }) {
  const max = Math.max(1, ...people.map((p) => p.count));
  return (
    <Stack gap="sm">
      {people.map((p) => (
        <Group key={p.login} gap="sm" wrap="nowrap">
          <Avatar src={p.avatarUrl} size={28} radius="xl" />
          <Box style={{ flex: 1 }} miw={0}>
            <Group justify="space-between" gap="xs" wrap="nowrap">
              <Anchor href={`https://github.com/${p.login}`} target="_blank" size="sm" c="inherit" truncate>
                {p.login}
              </Anchor>
              <Text size="sm" c="dimmed" className="tabular">
                {num(p.count)} {unit}
              </Text>
            </Group>
            <Box mt={4} h={4} bg="var(--mantine-color-default-border)" style={{ borderRadius: 4 }}>
              <Box h={4} w={`${(p.count / max) * 100}%`} bg="indigo.4" style={{ borderRadius: 4 }} />
            </Box>
          </Box>
        </Group>
      ))}
    </Stack>
  );
}

/** A clickable row that links out to GitHub, used by the "lists" on most pages. */
export function LinkRow({
  href,
  title,
  meta,
  right,
  avatar,
}: {
  href: string;
  title: ReactNode;
  meta?: ReactNode;
  right?: ReactNode;
  avatar?: string | null;
}) {
  return (
    <UnstyledButton component="a" href={href} target="_blank" rel="noreferrer" className="link-row">
      <Group gap="sm" wrap="nowrap">
        {avatar !== undefined && <Avatar src={avatar} size={26} radius="xl" />}
        <Box style={{ flex: 1 }} miw={0}>
          <Text size="sm" fw={500} truncate>
            {title}
          </Text>
          {meta && (
            <Text size="xs" c="dimmed" truncate>
              {meta}
            </Text>
          )}
        </Box>
        {right}
      </Group>
    </UnstyledButton>
  );
}

const STATE_COLORS: Record<string, string> = {
  success: 'green',
  completed: 'green',
  failure: 'red',
  error: 'red',
  timed_out: 'red',
  startup_failure: 'red',
  cancelled: 'gray',
  skipped: 'gray',
  inactive: 'gray',
  in_progress: 'yellow',
  queued: 'yellow',
  pending: 'yellow',
  waiting: 'yellow',
};

export function StateBadge({ state }: { state: string | null | undefined }) {
  if (!state) return <Badge color="gray">unknown</Badge>;
  return <Badge color={STATE_COLORS[state] ?? 'gray'}>{state.replace(/_/g, ' ')}</Badge>;
}
