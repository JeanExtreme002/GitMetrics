import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';
import type { LaunchStatus } from '../../shared/types';
import { api, post, put } from './api';

/** What this computer has set up to open GitMetrics like an app. */
export const useLaunch = () =>
  useQuery({ queryKey: ['launch'], queryFn: () => api<LaunchStatus>('/launch'), staleTime: 60_000 });

export function useLaunchActions() {
  const client = useQueryClient();
  const done = (status: LaunchStatus) => client.setQueryData(['launch'], status);
  return {
    set: useMutation({
      mutationFn: (choice: { shortcut?: boolean; autostart?: boolean }) =>
        put<LaunchStatus>('/launch', choice),
      onSuccess: done,
    }),
    offered: useMutation({ mutationFn: () => post<LaunchStatus>('/launch/offered'), onSuccess: done }),
    quit: useMutation({ mutationFn: () => post<{ ok: boolean }>('/quit') }),
    /** Shows the app in the Finder, on macOS, to drag it to the Dock. */
    reveal: useMutation({ mutationFn: () => post<{ ok: boolean }>('/launch/reveal') }),
  };
}

/** Each system's name for where its apps are. */
export const SHORTCUT_PLACE: Record<NonNullable<LaunchStatus['platform']>, string> = {
  darwin: 'Applications',
  win32: 'the Start menu',
  linux: 'the apps menu',
};

/** How to keep it at hand once it's among the apps: the Dock or a taskbar is the person's own. */
export const KEEP_IT_HINT: Record<NonNullable<LaunchStatus['platform']>, string> = {
  darwin: "It's in Applications, in your home folder: drag it to the Dock to keep it there.",
  win32: 'To keep it in the taskbar, right-click it in the Start menu, then Pin to taskbar.',
  linux: 'To keep it at hand, right-click it in the apps menu, then Add to favorites.',
};

// Installing from the browser ----------------------------------------------------------------------

interface InstallPrompt extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let offer: InstallPrompt | null = null;
let installed = typeof window !== 'undefined' && window.matchMedia('(display-mode: standalone)').matches;
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((listener) => listener());

/** Keeps the browser's offer to install, which comes once, early. Chrome and Edge make it. */
export function listenForInstall() {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    offer = event as InstallPrompt;
    changed();
  });
  window.addEventListener('appinstalled', () => {
    offer = null;
    installed = true;
    changed();
  });
}

/** Whether the browser can install GitMetrics now, whether it runs installed, and the way to. */
export function useInstall() {
  const state = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => (installed ? 'installed' : offer ? 'available' : 'unavailable'),
  );
  const install = async () => {
    if (!offer) return;
    await offer.prompt();
    const { outcome } = await offer.userChoice;
    if (outcome === 'accepted') {
      offer = null;
      changed();
    }
  };
  return { state, install };
}
