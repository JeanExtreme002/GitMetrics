import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DeviceFlow, ghLocations, readGhToken, validateToken } from '../src/server/auth';
import { GitHubError } from '../src/server/github';

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), { status: 200, ...init });

/** A fetch that answers the Device Flow endpoints from a queue of poll responses. */
function deviceGitHub(polls: object[]) {
  const requests: { url: string; body: Record<string, string> }[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    requests.push({ url, body: JSON.parse(String(init?.body)) });
    if (url.endsWith('/login/device/code')) {
      return json({
        device_code: 'device-123',
        user_code: 'ABCD-1234',
        verification_uri: 'https://github.com/login/device',
        expires_in: 900,
        interval: 5,
      });
    }
    return json(polls.shift() ?? { error: 'authorization_pending' });
  }) as typeof fetch;
  return { fetchImpl, requests };
}

describe('validateToken', () => {
  it('returns the account and the scopes GitHub granted', async () => {
    const fetchImpl = (async () =>
      json(
        {
          login: 'octocat',
          name: null,
          avatar_url: '',
          html_url: '',
          followers: 0,
          following: 0,
          public_repos: 0,
          created_at: '',
        },
        { headers: { 'x-oauth-scopes': 'repo, read:user ,  read:org' } },
      )) as typeof fetch;
    const { viewer, scopes } = await validateToken('gho_x', fetchImpl);
    expect(viewer.login).toBe('octocat');
    expect(scopes).toEqual(['repo', 'read:user', 'read:org']);
  });

  it('explains an invalid or expired token', async () => {
    const fetchImpl = (async () => json({ message: 'Bad credentials' }, { status: 401 })) as typeof fetch;
    await expect(validateToken('nope', fetchImpl)).rejects.toMatchObject({
      status: 401,
      message: 'This token is invalid or has expired.',
    });
  });
});

describe('DeviceFlow', () => {
  beforeEach(() => vi.stubEnv('GITMETRICS_CLIENT_ID', 'client-1'));
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it('refuses to start without an OAuth client ID', async () => {
    vi.stubEnv('GITMETRICS_CLIENT_ID', '');
    await expect(new DeviceFlow(deviceGitHub([]).fetchImpl).start()).rejects.toBeInstanceOf(GitHubError);
  });

  it('shows the user code, never the device code, and waits for approval', async () => {
    const { fetchImpl, requests } = deviceGitHub([{ error: 'authorization_pending' }]);
    const flow = new DeviceFlow(fetchImpl);
    const started = await flow.start();
    expect(started).toEqual({
      userCode: 'ABCD-1234',
      verificationUri: 'https://github.com/login/device',
      expiresIn: 900,
      interval: 5,
    });
    expect(JSON.stringify(started)).not.toContain('device-123');
    expect(await flow.poll()).toEqual({ status: 'pending', interval: 5 });
    expect(requests[1]!.body).toMatchObject({ client_id: 'client-1', device_code: 'device-123' });
  });

  it('slows down when GitHub asks, then hands over the token once', async () => {
    const { fetchImpl } = deviceGitHub([
      { error: 'slow_down' },
      { error: 'slow_down', interval: 20 },
      { access_token: 'gho_new' },
    ]);
    const flow = new DeviceFlow(fetchImpl);
    await flow.start();
    // Without a new interval, wait five seconds longer than before, as the OAuth spec asks.
    expect(await flow.poll()).toEqual({ status: 'pending', interval: 10 });
    expect(await flow.poll()).toEqual({ status: 'pending', interval: 20 });
    expect(await flow.poll()).toEqual({ status: 'complete', token: 'gho_new' });
    // The session is spent: polling again cannot return the token a second time.
    expect(await flow.poll()).toEqual({ status: 'expired' });
  });

  it('stops when the user denies access', async () => {
    const flow = new DeviceFlow(deviceGitHub([{ error: 'access_denied' }]).fetchImpl);
    await flow.start();
    expect(await flow.poll()).toEqual({ status: 'denied' });
    expect(await flow.poll()).toEqual({ status: 'expired' });
  });

  it('expires without asking GitHub once the code is too old', async () => {
    vi.useFakeTimers();
    const { fetchImpl, requests } = deviceGitHub([]);
    const flow = new DeviceFlow(fetchImpl);
    await flow.start();
    vi.advanceTimersByTime(901_000);
    expect(await flow.poll()).toEqual({ status: 'expired' });
    expect(requests).toHaveLength(1);
  });
});

describe('the GitHub CLI session', () => {
  // A shell script standing in for the CLI: Windows, running these tests, can't run one.
  it.skipIf(process.platform === 'win32')(
    "is found where it's usually installed, when the PATH doesn't have it, as from a shortcut",
    async () => {
      const dir = mkdtempSync(path.join(tmpdir(), 'gitmetrics-gh-'));
      try {
        const gh = path.join(dir, 'gh');
        writeFileSync(gh, '#!/bin/sh\necho gho_found\n');
        chmodSync(gh, 0o755);
        // A PATH with no CLI on it.
        vi.stubEnv('PATH', path.join(dir, 'empty'));
        expect(await readGhToken([path.join(dir, 'missing', 'gh'), gh])).toBe('gho_found');
        expect(await readGhToken([path.join(dir, 'missing', 'gh')])).toBeNull();
      } finally {
        vi.unstubAllEnvs();
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );

  it('looks in the usual folders on macOS and Linux, and leaves Windows to its PATH', () => {
    expect(ghLocations('darwin', '/Users/a')).toContain('/opt/homebrew/bin/gh');
    expect(ghLocations('linux', '/home/a')).toContain('/home/linuxbrew/.linuxbrew/bin/gh');
    expect(ghLocations('win32', 'C:\\Users\\a')).toEqual([]);
  });
});
