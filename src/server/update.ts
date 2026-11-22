import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { UpdateInfo } from '../shared/types.js';

/** How GitMetrics was started, which decides how it can be brought up to date. */
export type InstallKind = 'npx' | 'installed' | 'source';

/** The registry is asked at most this often; between checks the saved answer is used. */
const CHECK_EVERY = 60 * 60 * 1000;
/** Never hold up the start for longer than this: offline, GitMetrics simply runs as it is. */
const TIMEOUT = 1500;

/** Set on the process GitMetrics restarts into, so the newer version never restarts again. */
export const RELAUNCHED = 'GITMETRICS_RELAUNCHED';
/** Turns the whole check off. */
export const NO_UPDATE_CHECK = 'GITMETRICS_NO_UPDATE_CHECK';

/**
 * npx runs packages from its own cache folder (`.../_npx/<hash>/node_modules/...`), and a
 * global or project install lives in a node_modules folder. Anything else is a checkout.
 */
export function installKind(file: string): InstallKind {
  const parts = path.resolve(file).split(/[\\/]/);
  if (parts.includes('_npx')) return 'npx';
  return parts.includes('node_modules') ? 'installed' : 'source';
}

/** Whether version `a` is newer than `b`. Prereleases are never offered as updates. */
export function isNewer(a: string, b: string): boolean {
  const parse = (v: string) => /^(\d+)\.(\d+)\.(\d+)$/.exec(v)?.slice(1).map(Number);
  const x = parse(a);
  const y = parse(b);
  if (!x || !y) return false;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i]! > y[i]!;
  return false;
}

interface Saved {
  checkedAt: number;
  latest: string;
}

/**
 * The newest published version, from the npm registry, saved in the data folder for an hour.
 * Returns null when it can't be known (offline, registry down, timeout).
 */
export async function latestVersion(
  name: string,
  dataDir: string,
  fetchImpl: typeof fetch = fetch,
  now = Date.now(),
): Promise<string | null> {
  const file = path.join(dataDir, 'update-check.json');
  try {
    const saved = JSON.parse(readFileSync(file, 'utf8')) as Saved;
    if (now - saved.checkedAt < CHECK_EVERY && typeof saved.latest === 'string') return saved.latest;
  } catch {
    // No saved answer yet.
  }
  try {
    const url = `https://registry.npmjs.org/-/package/${name.replace('/', '%2f')}/dist-tags`;
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(TIMEOUT) });
    if (!response.ok) return null;
    const latest = ((await response.json()) as { latest?: unknown }).latest;
    if (typeof latest !== 'string') return null;
    mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    writeFileSync(file, JSON.stringify({ checkedAt: now, latest } satisfies Saved));
    return latest;
  } catch {
    return null;
  }
}

/** What the app tells the user about updates, and the command that brings one in. */
export function updateInfo(
  name: string,
  current: string,
  latest: string | null,
  kind: InstallKind,
): UpdateInfo {
  const available = latest !== null && isNewer(latest, current);
  return {
    current,
    latest,
    available,
    command:
      kind === 'npx' ? `npx ${name}@latest` : kind === 'installed' ? `npm install -g ${name}@latest` : null,
  };
}
