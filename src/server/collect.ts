import path from 'node:path';
import { type GitHubClient, GitHubError } from './github.js';
import { toDays } from './metrics/traffic.js';
import type { RepoSummary } from '../shared/types.js';
import { type TrafficStore, readJson, writePrivate } from './store.js';
import { mapLimit, toDay } from './util.js';

/*
 * GitHub keeps a repository's traffic for 14 days only. Each time GitMetrics starts (and once a
 * day while it stays open), it reads the traffic of the repositories that matter to you and adds
 * it to the history on disk, so the history keeps growing even for the ones you don't open.
 *
 * Which ones: every repository you own, and any other you opened in GitMetrics in the last 12
 * months (an organization's or someone else's). GitHub shows traffic only to people with push
 * access; a repository that says no is left alone for a month before it is tried again.
 */

/** Repositories opened this recently are kept collected. */
export const VISITED_WITHIN_DAYS = 365;
/** A repository whose traffic GitHub refused is tried again after this long. */
export const RETRY_AFTER_DAYS = 30;
/** After a failed try (offline, rate limited), the next one waits this long. */
export const RETRY_AFTER_FAILURE_MS = 15 * 60_000;
/** Repositories read side by side: a few, so the app stays quick while it runs. */
const AT_ONCE = 4;

const DAY_MS = 86_400_000;
const daysBefore = (now: Date, days: number) => toDay(now.getTime() - days * DAY_MS);
/** Requests left this hour below which the collection stops, so the pages always have enough. */
export const KEEP_FOR_PAGES = 1000;

/** Per account: the day of each repository's last visit, and how the collection went. */
interface Saved {
  /** Keyed in lowercase; each keeps the name as the page was opened with. */
  visits: Record<string, { name: string; on: string }>;
  /** The UTC day the last collection finished. */
  collectedOn?: string;
  /** Repositories GitHub refused the traffic of, and on which day. */
  refused: Record<string, string>;
}

type File = Record<string, Saved>;

const empty = (): Saved => ({ visits: {}, refused: {} });

/** Visits and the collection's progress, kept per account in the data folder. */
export class CollectionStore {
  private readonly file: string;

  constructor(dir: string) {
    this.file = path.join(dir, 'collection.json');
  }

  private read(login: string): Saved {
    const saved = readJson<File>(this.file, {})[login.toLowerCase()];
    return { ...empty(), ...saved, visits: { ...saved?.visits }, refused: { ...saved?.refused } };
  }

  private write(login: string, update: (saved: Saved) => void) {
    const all = readJson<File>(this.file, {});
    const saved = this.read(login);
    update(saved);
    all[login.toLowerCase()] = saved;
    writePrivate(this.file, all);
  }

  /** Notes that a repository was opened today; written at most once a day per repository. */
  visit(login: string, fullName: string, now = new Date()) {
    const key = fullName.toLowerCase();
    const today = toDay(now);
    const known = this.read(login).visits[key];
    if (known?.on === today && known.name === fullName) return;
    this.write(login, (saved) => {
      saved.visits[key] = { name: fullName, on: today };
    });
  }

  get(login: string): Saved {
    return this.read(login);
  }

  finish(login: string, day: string, refused: string[], now = new Date()) {
    this.write(login, (saved) => {
      saved.collectedOn = day;
      for (const name of refused) saved.refused[name.toLowerCase()] = toDay(now);
      // What no longer counts is let go, so the file stays small.
      const visitedSince = daysBefore(now, VISITED_WITHIN_DAYS);
      const refusedSince = daysBefore(now, RETRY_AFTER_DAYS);
      for (const [key, v] of Object.entries(saved.visits)) if (v.on < visitedSince) delete saved.visits[key];
      for (const [key, on] of Object.entries(saved.refused))
        if (on <= refusedSince) delete saved.refused[key];
    });
  }
}

/**
 * The repositories to collect: every one you own, and every other one opened in the last
 * 12 months, but not those GitHub refused less than a month ago.
 */
export function collectionTargets(
  login: string,
  owned: RepoSummary[],
  saved: Saved,
  now = new Date(),
): string[] {
  const since = (days: number) => daysBefore(now, days);
  const names = new Map<string, string>();
  for (const r of owned) {
    if (r.owner.toLowerCase() === login.toLowerCase()) names.set(r.fullName.toLowerCase(), r.fullName);
  }
  for (const [key, visit] of Object.entries(saved.visits)) {
    if (visit.on >= since(VISITED_WITHIN_DAYS) && !names.has(key)) names.set(key, visit.name);
  }
  for (const [name, day] of Object.entries(saved.refused)) {
    if (day > since(RETRY_AFTER_DAYS)) names.delete(name);
  }
  return [...names.values()].sort((a, b) => a.localeCompare(b));
}

interface RawTraffic {
  count: number;
  uniques: number;
  views?: { timestamp: string; count: number; uniques: number }[];
  clones?: { timestamp: string; count: number; uniques: number }[];
}

export interface CollectionResult {
  collected: number;
  refused: number;
  /** Whether it stopped early (offline, rate limit); then it runs again next time. */
  incomplete: boolean;
}

/**
 * Reads views and clones of each repository and adds them to the history. A day GitHub already
 * counted is replaced by its newest count: a day's count only grows until the day is over.
 */
export async function collectTraffic(
  gh: GitHubClient,
  traffic: TrafficStore,
  store: CollectionStore,
  login: string,
  owned: RepoSummary[],
  now = new Date(),
): Promise<CollectionResult> {
  const targets = collectionTargets(login, owned, store.get(login), now);
  const refused: string[] = [];
  let collected = 0;
  let incomplete = false;

  await mapLimit(targets, AT_ONCE, async (fullName) => {
    if (incomplete) return;
    // Running low on this hour's requests: leave them to the pages, and finish later.
    if (gh.rateLimit && gh.rateLimit.remaining < KEEP_FOR_PAGES) {
      incomplete = true;
      return;
    }
    try {
      const base = `/repos/${fullName}/traffic`;
      const [views, clones] = await Promise.all([
        gh.get<RawTraffic>(`${base}/views`),
        gh.get<RawTraffic>(`${base}/clones`),
      ]);
      traffic.merge(fullName, 'views', toDays(views));
      traffic.merge(fullName, 'clones', toDays(clones));
      collected++;
    } catch (error) {
      // No push access, or gone: not this repository's traffic to read.
      if (
        error instanceof GitHubError &&
        (error.status === 404 || (error.status === 403 && !/rate limit/i.test(error.message)))
      ) {
        refused.push(fullName);
        return;
      }
      // Offline, rate limited, or GitHub having a bad moment: try the whole day again next time.
      incomplete = true;
    }
  });

  if (!incomplete) store.finish(login, toDay(now), refused, now);
  return { collected, refused: refused.length, incomplete };
}

/**
 * Runs the collection at most once a day, in the background, never twice at the same time.
 * Started on the app's first request and on later ones, so a GitMetrics left open for days still
 * collects once a day.
 */
export class TrafficCollector {
  private running: Promise<unknown> | null = null;
  /** The account and day already collected, so most requests don't even read the disk. */
  private doneFor: string | null = null;
  /** When the last try failed (offline, rate limited); tried again a while after. */
  private failedAt = 0;

  constructor(
    private readonly traffic: TrafficStore,
    private readonly store: CollectionStore,
    private readonly listOwned: (gh: GitHubClient) => Promise<RepoSummary[]>,
  ) {}

  /** Starts today's collection if it hasn't run yet; returns right away. */
  poke(gh: GitHubClient, login: string, now = new Date()): Promise<unknown> | null {
    const today = toDay(now);
    const key = `${login.toLowerCase()}:${today}`;
    if (this.running) return this.running;
    if (this.doneFor === key || now.getTime() - this.failedAt < RETRY_AFTER_FAILURE_MS) return null;
    if (this.store.get(login).collectedOn === today) {
      this.doneFor = key;
      return null;
    }
    this.running = this.listOwned(gh)
      .then((owned) => collectTraffic(gh, this.traffic, this.store, login, owned, now))
      .then((result) => {
        if (result.incomplete) this.failedAt = now.getTime();
        else this.doneFor = key;
      })
      // Never in the way: a failed collection is tried again a while later.
      .catch(() => {
        this.failedAt = now.getTime();
      })
      .finally(() => {
        this.running = null;
      });
    return this.running;
  }
}
