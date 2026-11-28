import { useSyncExternalStore } from 'react';

/*
 * Whether GitMetrics has stopped, for this page: quit from Settings, or found not answering. Then
 * the whole app gives way to one plain page that says so, as nothing in it can work any more.
 */

let stopped = false;
const listeners = new Set<() => void>();

export function markStopped() {
  if (stopped) return;
  stopped = true;
  listeners.forEach((listener) => listener());
}

export const useStopped = () =>
  useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => stopped,
  );

const answers = () =>
  fetch('/api/update', { cache: 'no-store' }).then(
    () => true,
    () => false,
  );

let checking = false;

/**
 * A request couldn't reach GitMetrics: it has stopped, as when quit from another tab, unless it
 * answers again in a moment. In development the server restarts on each edit, so it never counts.
 */
export async function noticeUnreachable() {
  if (stopped || checking || import.meta.env.DEV) return;
  checking = true;
  for (let attempt = 0; attempt < 2; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    if (await answers()) {
      checking = false;
      return;
    }
  }
  markStopped();
}
