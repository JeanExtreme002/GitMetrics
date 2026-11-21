import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import type { AuthSource } from '../shared/types.js';

export const defaultDataDir = () => process.env.GITMETRICS_HOME ?? path.join(homedir(), '.gitmetrics');

export interface StoredAuth {
  token: string;
  source: AuthSource;
  login: string;
  scopes: string[];
  createdAt: string;
}

interface StoredConfig {
  auth?: StoredAuth;
  favorites: string[];
}

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

function writePrivate(file: string, value: unknown) {
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  writeFileSync(file, JSON.stringify(value, null, 2), { mode: 0o600 });
}

/** Persists the token and preferences in ~/.gitmetrics/config.json (owner-only permissions). */
export class ConfigStore {
  private readonly file: string;

  constructor(readonly dir: string = defaultDataDir()) {
    this.file = path.join(dir, 'config.json');
  }

  private read(): StoredConfig {
    return { favorites: [], ...readJson<Partial<StoredConfig>>(this.file, {}) };
  }

  private update(patch: Partial<StoredConfig>) {
    writePrivate(this.file, { ...this.read(), ...patch });
  }

  get auth(): StoredAuth | undefined {
    return this.read().auth;
  }

  setAuth(auth: StoredAuth) {
    this.update({ auth });
  }

  clearAuth() {
    this.update({ auth: undefined });
  }

  get favorites(): string[] {
    return this.read().favorites;
  }

  setFavorites(favorites: string[]) {
    this.update({ favorites: [...new Set(favorites)] });
  }
}

/** Write-once JSON cache on disk, used for immutable data such as commit details. */
export class DiskCache {
  constructor(private readonly dir: string) {}

  private fileFor(key: string) {
    const hash = createHash('sha1').update(key).digest('hex');
    return path.join(this.dir, hash.slice(0, 2), `${hash}.json`);
  }

  get<T>(key: string): T | undefined {
    const file = this.fileFor(key);
    return existsSync(file) ? readJson<T | undefined>(file, undefined) : undefined;
  }

  set(key: string, value: unknown) {
    writePrivate(this.fileFor(key), value);
  }

  clear() {
    rmSync(this.dir, { recursive: true, force: true });
  }
}

/** In-memory TTL cache that also de-duplicates concurrent requests for the same key. */
export class MemoryCache {
  private readonly entries = new Map<string, { expires: number; value: Promise<unknown> }>();

  async wrap<T>(key: string, ttlMs: number, load: () => Promise<T>, force = false): Promise<T> {
    const hit = this.entries.get(key);
    if (!force && hit && hit.expires > Date.now()) return hit.value as Promise<T>;

    const value = load();
    this.entries.set(key, { expires: Date.now() + ttlMs, value });
    value.catch(() => this.entries.delete(key));
    return value;
  }

  delete(key: string) {
    this.entries.delete(key);
  }

  clear() {
    this.entries.clear();
  }
}

/** Accumulates the 14-day traffic windows GitHub returns so history grows over time. */
export class TrafficStore {
  constructor(private readonly dir: string) {}

  private fileFor(fullName: string) {
    return path.join(this.dir, `${fullName.replace('/', '__')}.json`);
  }

  merge(fullName: string, kind: 'views' | 'clones', days: Record<string, [number, number]>) {
    const file = this.fileFor(fullName);
    const stored = readJson<Record<string, Record<string, [number, number]>>>(file, {});
    stored[kind] = { ...stored[kind], ...days };
    writePrivate(file, stored);
    return stored[kind];
  }
}
