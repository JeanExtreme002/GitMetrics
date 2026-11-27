import { ActionIcon, Badge, Box, Group, Paper, Text, Tooltip } from '@mantine/core';
import { IconGitFork, IconPin, IconPinFilled, IconStar } from '@tabler/icons-react';
import type { CSSProperties } from 'react';
import { Link } from 'react-router';
import type { RepoSummary } from '../../shared/types';
import { cleanText, compact, relative } from '../lib/format';
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
