import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';
import { useParams } from 'react-router';
import type {
  AuthStatus,
  MyPullsResponse,
  PullChurn,
  PullDetail,
  PullFilter,
  RateLimitInfo,
  RepoBaseline,
  ReposResponse,
} from '../../shared/types';
import { api, put } from './api';

export const useAuth = () =>
  useQuery({ queryKey: ['auth'], queryFn: () => api<AuthStatus>('/auth/status'), staleTime: 60_000 });

export const useRepos = () =>
  useQuery({ queryKey: ['repos'], queryFn: () => api<ReposResponse>('/repos'), staleTime: 5 * 60_000 });

export const useRateLimit = () =>
  useQuery({
    queryKey: ['rate-limit'],
    queryFn: () => api<RateLimitInfo | null>('/rate-limit'),
    refetchInterval: 30_000,
  });

export function useRepoParams() {
  const { owner = '', repo = '' } = useParams();
  return { owner, repo, fullName: `${owner}/${repo}` };
}

export type Section =
  | 'overview'
  | 'stars'
  | 'traffic'
  | 'commits'
  | 'pulls'
  | 'issues'
  | 'contributors'
  | 'files'
  | 'actions'
  | 'releases'
  | 'deployments';

const sectionUrl = (owner: string, repo: string, section: Section, params: Record<string, string>) => {
  const query = new URLSearchParams(params).toString();
  return `/repos/${owner}/${repo}/${section}${query ? `?${query}` : ''}`;
};

/** Query options for one section, shared by the pages and the sidebar so they hit the same cache. */
export const sectionQuery = <T>(
  owner: string,
  repo: string,
  section: Section,
  params: Record<string, string> = {},
) => ({
  queryKey: ['section', owner, repo, section, params],
  queryFn: () => api<T>(sectionUrl(owner, repo, section, params)),
});

/**
 * Loads one dashboard section for the repository in the URL. While GitHub is still
 * computing statistics (`pending`, or `historyPending` when a partial answer is on screen),
 * it keeps polling every few seconds.
 */
export function useSection<T>(section: Section, params: Record<string, string> = {}) {
  const { owner, repo } = useRepoParams();
  const client = useQueryClient();
  const queryKey = ['section', owner, repo, section, params];
  const [refreshing, setRefreshing] = useState(false);

  const query = useQuery({
    queryKey,
    queryFn: () => api<T>(sectionUrl(owner, repo, section, params)),
    enabled: Boolean(owner && repo),
    staleTime: 5 * 60_000,
    refetchInterval: (q) => {
      const data = q.state.data as { pending?: boolean; historyPending?: boolean } | undefined;
      // Nothing to show yet: poll fast. Partial data on screen: check back less often.
      return data?.pending ? 5000 : data?.historyPending ? 10_000 : false;
    },
  });

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const fresh = await api<T>(sectionUrl(owner, repo, section, { ...params, refresh: '1' }));
      client.setQueryData(queryKey, fresh);
      void client.invalidateQueries({ queryKey: ['rate-limit'] });
    } finally {
      setRefreshing(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner, repo, section, JSON.stringify(params)]);

  return { ...query, refresh, refreshing };
}

export function useFavorites() {
  const client = useQueryClient();
  const { data } = useRepos();
  const favorites = data?.favorites ?? [];

  const mutation = useMutation({
    mutationFn: (next: string[]) => put<{ favorites: string[] }>('/favorites', { favorites: next }),
    onMutate: (next) => {
      client.setQueryData<ReposResponse>(['repos'], (old) => (old ? { ...old, favorites: next } : old));
    },
    onSuccess: ({ favorites: saved }) => {
      client.setQueryData<ReposResponse>(['repos'], (old) => (old ? { ...old, favorites: saved } : old));
    },
  });

  const toggle = (fullName: string) =>
    mutation.mutate(
      favorites.includes(fullName) ? favorites.filter((f) => f !== fullName) : [...favorites, fullName],
    );

  return { favorites, isFavorite: (fullName: string) => favorites.includes(fullName), toggle };
}

/** Every account that owns at least one of the repositories, the signed-in user first. */
export function useOwners() {
  const { data: auth } = useAuth();
  const { data } = useRepos();
  return useMemo(() => {
    const login = auth?.viewer?.login ?? '';
    const owners = new Map<string, { login: string; avatarUrl: string; count: number }>();
    for (const r of data?.repos ?? []) {
      const entry = owners.get(r.owner) ?? { login: r.owner, avatarUrl: r.ownerAvatarUrl, count: 0 };
      entry.count++;
      owners.set(r.owner, entry);
    }
    return [...owners.values()].sort(
      (a, b) => Number(b.login === login) - Number(a.login === login) || b.count - a.count,
    );
  }, [auth, data]);
}

// Your pull requests ------------------------------------------------------

/** Your pull requests; `owner` keeps only one account's repositories. */
export interface PullSearch {
  text: string;
  tab: PullFilter;
}

export const myPullsPath = (state: 'open' | 'closed', owner = '', search?: PullSearch) => {
  const params = new URLSearchParams({ state });
  if (owner) params.set('owner', owner);
  if (search) {
    params.set('q', search.text);
    params.set('tab', search.tab);
  }
  return `/pulls?${params.toString()}`;
};

export const useMyPulls = (state: 'open' | 'closed', owner = '', search?: PullSearch) =>
  useQuery({
    queryKey: ['my-pulls', state, owner.toLowerCase(), search?.tab ?? '', search?.text.toLowerCase() ?? ''],
    queryFn: () => api<MyPullsResponse>(myPullsPath(state, owner, search)),
    staleTime: 2 * 60_000,
    // While a search runs, keep the results on screen instead of flashing a skeleton.
    placeholderData: search ? keepPreviousData : undefined,
  });

/** A repository's usual review and merge times, shared by every row from that repository. */
export const useBaseline = (repo: string) =>
  useQuery({
    queryKey: ['baseline', repo.toLowerCase()],
    queryFn: () => api<RepoBaseline>(`/repos/${repo}/baseline`),
    staleTime: 60 * 60_000,
  });

export const usePull = (owner: string, repo: string, number: string) =>
  useQuery({
    queryKey: ['pull', owner.toLowerCase(), repo.toLowerCase(), number],
    queryFn: () => api<PullDetail>(`/repos/${owner}/${repo}/pull/${number}`),
    staleTime: 2 * 60_000,
  });

/** Which files and folders a pull request's commits keep coming back to; null past GitHub's limits. */
export const usePullChurn = (owner: string, repo: string, number: string) =>
  useQuery({
    queryKey: ['pull-churn', owner.toLowerCase(), repo.toLowerCase(), number],
    queryFn: () => api<{ churn: PullChurn | null }>(`/repos/${owner}/${repo}/pull/${number}/churn`),
    staleTime: 10 * 60_000,
  });
