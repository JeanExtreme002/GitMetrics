import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CollectionStore,
  TrafficCollector,
  collectTraffic,
  collectionTargets,
  RETRY_AFTER_FAILURE_MS,
  KEEP_FOR_PAGES,
} from '../src/server/collect';
import { type GitHubClient, GitHubError } from '../src/server/github';
import { TrafficStore } from '../src/server/store';
import type { RepoSummary } from '../src/shared/types';

const now = new Date('2026-11-22T12:00:00Z');
const day = (daysAgo: number) => new Date(now.getTime() - daysAgo * 86_400_000).toISOString().slice(0, 10);
const repo = (fullName: string) => ({ fullName, owner: fullName.split('/')[0]! }) as RepoSummary;

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'gitmetrics-collect-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('which repositories are collected', () => {
  it('every one you own, and any other opened in the last 12 months, unless refused lately', () => {
    const saved = {
      visits: {
        'acme/api': { name: 'Acme/API', on: day(10) }, // an organization's, opened lately
        'acme/old': { name: 'acme/old', on: day(400) }, // opened more than a year ago
        'friend/tool': { name: 'friend/tool', on: day(200) }, // someone else's, within the year
        'me/app': { name: 'me/app', on: day(1) }, // yours anyway: listed once
      },
      refused: {
        'friend/tool': day(5), // refused lately: left alone
        'me/legacy': day(45), // refused over a month ago: tried again
      },
    };
    expect(
      collectionTargets('Me', [repo('me/app'), repo('me/legacy'), repo('acme/web')], saved, now),
      // Each under the name its page was opened with, the one the Traffic page saves under.
    ).toEqual(['Acme/API', 'me/app', 'me/legacy']);
  });
});

describe('the visits and progress on disk', () => {
  it('keeps each account apart, and notes a visit once a day', () => {
    const store = new CollectionStore(dir);
    store.visit('Me', 'Acme/API', now);
    store.visit('me', 'acme/api', now);
    store.visit('other', 'x/y', now);
    expect(store.get('ME').visits).toEqual({ 'acme/api': { name: 'acme/api', on: day(0) } });
    expect(store.get('other').visits).toEqual({ 'x/y': { name: 'x/y', on: day(0) } });
    store.finish('me', day(0), ['Acme/Secret'], now);
    expect(store.get('me')).toMatchObject({ collectedOn: day(0), refused: { 'acme/secret': day(0) } });
    // Only its owner can read it (Windows has no such modes).
    if (process.platform !== 'win32') {
      expect(statSync(path.join(dir, 'collection.json')).mode & 0o777).toBe(0o600);
    }
  });
});

/** A GitHub that answers traffic for some repositories and refuses or fails others. */
function github(answers: Record<string, 'ok' | 403 | 404 | 'rate' | 'offline'>) {
  const asked: string[] = [];
  const gh = {
    rateLimit: null,
    get: async (url: string) => {
      asked.push(url);
      const name = url.split('/').slice(2, 4).join('/');
      const kind = url.endsWith('/views') ? 'views' : 'clones';
      const answer = answers[name] ?? 'ok';
      if (answer === 403) throw new GitHubError(403, 'Must have push access to repository');
      if (answer === 404) throw new GitHubError(404, 'Not Found');
      if (answer === 'rate') throw new GitHubError(403, 'API rate limit exceeded');
      if (answer === 'offline') throw new TypeError('fetch failed');
      return { count: 3, uniques: 2, [kind]: [{ timestamp: `${day(1)}T00:00:00Z`, count: 3, uniques: 2 }] };
    },
  } as unknown as GitHubClient;
  return { gh, asked };
}

describe('collecting', () => {
  it('lets go of visits over a year old and refusals over a month old', () => {
    const store = new CollectionStore(dir);
    store.visit('me', 'old/one', new Date(now.getTime() - 400 * 86_400_000));
    store.visit('me', 'new/one', now);
    store.finish('me', day(40), ['was/refused'], new Date(now.getTime() - 40 * 86_400_000));
    store.finish('me', day(0), ['now/refused'], now);
    expect(Object.keys(store.get('me').visits)).toEqual(['new/one']);
    expect(store.get('me').refused).toEqual({ 'now/refused': day(0) });
  });

  it('adds views and clones to the history, and notes who refused', async () => {
    const store = new CollectionStore(dir);
    store.visit('me', 'acme/secret', now);
    const traffic = new TrafficStore(path.join(dir, 'traffic'));
    const { gh } = github({ 'acme/secret': 403 });
    const result = await collectTraffic(gh, traffic, store, 'me', [repo('me/app')], now);
    expect(result).toEqual({ collected: 1, refused: 1, incomplete: false });
    const saved = JSON.parse(readFileSync(path.join(dir, 'traffic', 'me__app.json'), 'utf8'));
    expect(saved).toEqual({ views: { [day(1)]: [3, 2] }, clones: { [day(1)]: [3, 2] } });
    expect(store.get('me')).toMatchObject({ collectedOn: day(0), refused: { 'acme/secret': day(0) } });
  });

  it("keeps the history it had: a day's newest count replaces the older one", async () => {
    const traffic = new TrafficStore(path.join(dir, 'traffic'));
    traffic.merge('me/app', 'views', { [day(30)]: [9, 9], [day(1)]: [1, 1] });
    await collectTraffic(github({}).gh, traffic, new CollectionStore(dir), 'me', [repo('me/app')], now);
    expect(traffic.merge('me/app', 'views', {})).toEqual({ [day(30)]: [9, 9], [day(1)]: [3, 2] });
  });

  it('leaves the requests to the pages when few are left this hour', async () => {
    const store = new CollectionStore(dir);
    const { gh, asked } = github({});
    gh.rateLimit = { limit: 5000, remaining: KEEP_FOR_PAGES - 1, resetAt: now.toISOString() };
    const result = await collectTraffic(
      gh,
      new TrafficStore(path.join(dir, 'traffic')),
      store,
      'me',
      [repo('me/app')],
      now,
    );
    expect(result.incomplete).toBe(true);
    expect(asked).toEqual([]);
    expect(store.get('me').collectedOn).toBeUndefined();
  });

  it('stops without finishing the day when offline or rate limited, so it runs again', async () => {
    for (const trouble of ['offline', 'rate'] as const) {
      const store = new CollectionStore(dir);
      const traffic = new TrafficStore(path.join(dir, 'traffic'));
      const result = await collectTraffic(
        github({ 'me/app': trouble }).gh,
        traffic,
        store,
        'me',
        [repo('me/app')],
        now,
      );
      expect(result.incomplete).toBe(true);
      expect(store.get('me').collectedOn).toBeUndefined();
      // A rate limit isn't a refusal: the repository isn't set aside.
      expect(store.get('me').refused).toEqual({});
    }
  });
});

describe('when it runs', () => {
  it('once a day, in the background, never twice at the same time', async () => {
    const store = new CollectionStore(dir);
    const traffic = new TrafficStore(path.join(dir, 'traffic'));
    const { gh, asked } = github({});
    let listed = 0;
    const collector = new TrafficCollector(traffic, store, async () => {
      listed++;
      return [repo('me/app')];
    });
    const first = collector.poke(gh, 'me', now);
    // Asked again while running, or later the same day: nothing new.
    expect(collector.poke(gh, 'me', now)).toBe(first);
    await first;
    expect(collector.poke(gh, 'me', now)).toBeNull();
    expect(listed).toBe(1);
    expect(asked).toHaveLength(2);

    // The next day it runs again; a fresh start the same day finds it already done.
    const tomorrow = new Date(now.getTime() + 86_400_000);
    expect(new TrafficCollector(traffic, store, async () => []).poke(gh, 'me', now)).toBeNull();
    await collector.poke(gh, 'me', tomorrow);
    expect(listed).toBe(2);
  });

  it('a failure never reaches the app, and is tried again a while later', async () => {
    const store = new CollectionStore(dir);
    let down = true;
    const collector = new TrafficCollector(new TrafficStore(path.join(dir, 'traffic')), store, async () => {
      if (down) throw new Error('GitHub is down');
      return [repo('me/app')];
    });
    const { gh } = github({});
    await expect(collector.poke(gh, 'me', now)).resolves.toBeUndefined();
    expect(store.get('me').collectedOn).toBeUndefined();
    // Not right away, but some minutes later, the same day.
    down = false;
    expect(collector.poke(gh, 'me', new Date(now.getTime() + 60_000))).toBeNull();
    await collector.poke(gh, 'me', new Date(now.getTime() + RETRY_AFTER_FAILURE_MS + 60_000));
    expect(store.get('me').collectedOn).toBe(day(0));
  });
});
