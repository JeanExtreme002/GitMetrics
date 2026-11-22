import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installKind, isNewer, latestVersion, updateInfo } from '../src/server/update';

describe('how GitMetrics was started', () => {
  it('tells npx, an npm install and a checkout apart', () => {
    expect(installKind('/home/me/.npm/_npx/9a1b/node_modules/@gitmetrics/app/dist/cli.js', {})).toBe('npx');
    expect(
      installKind(
        'C:\\Users\\me\\AppData\\Local\\npm-cache\\_npx\\9a1b\\node_modules\\@gitmetrics\\app\\dist\\cli.js',
      ),
    ).toBe('npx');
    expect(installKind('/usr/local/lib/node_modules/@gitmetrics/app/dist/cli.js', {})).toBe('installed');
    expect(installKind('/home/me/code/GitMetrics/dist/cli.js', {})).toBe('source');
  });

  it('knows npx ran a global install, which npx prefers to its own cache', () => {
    const global = '/usr/local/lib/node_modules/@gitmetrics/app/dist/cli.js';
    // npm marks what npx (npm exec) starts.
    expect(installKind(global, { npm_command: 'exec' })).toBe('npx');
    // Started as `gitmetrics`, or from an npm script: still an install.
    expect(installKind(global, { npm_command: 'run-script' })).toBe('installed');
    // A checkout stays a checkout, even through npx.
    expect(installKind('/home/me/code/GitMetrics/dist/cli.js', { npm_command: 'exec' })).toBe('source');
  });
});

describe('comparing versions', () => {
  it('compares each part as a number', () => {
    expect(isNewer('1.10.0', '1.9.3')).toBe(true);
    expect(isNewer('2.0.0', '1.99.99')).toBe(true);
    expect(isNewer('1.2.0', '1.2.0')).toBe(false);
    expect(isNewer('1.1.9', '1.2.0')).toBe(false);
  });

  it('never offers a prerelease or an unreadable version', () => {
    expect(isNewer('2.0.0-beta.1', '1.2.0')).toBe(false);
    expect(isNewer('1.3.0', 'unknown')).toBe(false);
  });
});

describe('the newest version on npm', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'gitmetrics-update-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const registry = (latest: string, calls: string[]) =>
    (async (url: string | URL | Request) => {
      calls.push(String(url));
      return new Response(JSON.stringify({ latest, next: '9.0.0-rc.1' }));
    }) as typeof fetch;

  it('asks the registry at most once an hour', async () => {
    const calls: string[] = [];
    const now = Date.UTC(2026, 10, 21);
    expect(await latestVersion(dir, registry('1.3.0', calls), now)).toBe('1.3.0');
    expect(calls).toEqual(['https://registry.npmjs.org/-/package/@gitmetrics%2fapp/dist-tags']);

    expect(await latestVersion(dir, registry('1.4.0', calls), now + 59 * 60_000)).toBe('1.3.0');
    expect(calls).toHaveLength(1);

    expect(await latestVersion(dir, registry('1.4.0', calls), now + 61 * 60_000)).toBe('1.4.0');
    expect(calls).toHaveLength(2);
  });

  it('trusts only a plain version number from the registry or the saved answer', async () => {
    const calls: string[] = [];
    expect(await latestVersion(dir, registry('1.3.0"; rm -rf /', calls))).toBeNull();
    expect(await latestVersion(dir, registry('2.0.0-rc.1', calls))).toBeNull();
    writeFileSync(
      path.join(dir, 'update-check.json'),
      JSON.stringify({ checkedAt: Date.now(), latest: '../x' }),
    );
    expect(await latestVersion(dir, registry('1.3.0', calls))).toBe('1.3.0');
  });

  it('gives up quietly offline or when the registry fails', async () => {
    const offline = (async () => {
      throw new TypeError('fetch failed');
    }) as typeof fetch;
    const down = (async () => new Response('busy', { status: 503 })) as typeof fetch;
    expect(await latestVersion(dir, offline)).toBeNull();
    expect(await latestVersion(dir, down)).toBeNull();
  });
});

describe('what the app says about an update', () => {
  it('suggests the command that fits how GitMetrics was started', () => {
    expect(updateInfo('1.2.0', '1.3.0', 'installed')).toEqual({
      current: '1.2.0',
      latest: '1.3.0',
      available: true,
      command: 'npm install -g @gitmetrics/app@latest',
    });
    expect(updateInfo('1.2.0', '1.3.0', 'npx').command).toBe('npx @gitmetrics/app@latest');
    expect(updateInfo('1.2.0', null, 'installed').available).toBe(false);
  });
});
