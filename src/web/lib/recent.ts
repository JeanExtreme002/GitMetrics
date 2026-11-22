import { useLocalStorage } from '@mantine/hooks';
import { useCallback } from 'react';
import { useAuth } from './queries';

export interface RecentRepo {
  fullName: string;
  ownerAvatarUrl: string;
}

/** How many recently viewed repositories are remembered. */
const KEEP = 10;

/** Puts a repository at the top of the list, once, keeping the newest {@link KEEP}. */
export function addRecent(list: RecentRepo[], repo: RecentRepo): RecentRepo[] {
  const key = repo.fullName.toLowerCase();
  return [repo, ...list.filter((r) => r.fullName.toLowerCase() !== key)].slice(0, KEEP);
}

/**
 * Repositories opened lately, newest first, kept in this browser per GitHub account, so one
 * account's private repositories never show up for another.
 */
export function useRecentRepos() {
  const { data } = useAuth();
  const [recent, setRecent] = useLocalStorage<RecentRepo[]>({
    key: `gitmetrics:recent:${data?.viewer?.login ?? ''}`,
    defaultValue: [],
    getInitialValueInEffect: false,
  });
  const visit = useCallback((repo: RecentRepo) => setRecent((list) => addRecent(list, repo)), [setRecent]);
  const clear = useCallback(() => setRecent([]), [setRecent]);
  return { recent, visit, clear };
}
