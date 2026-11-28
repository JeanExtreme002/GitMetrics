import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import type { DevicePoll, DeviceStart, Viewer } from '../shared/types.js';
import { GITHUB_API, GitHubError, USER_AGENT } from './github.js';

/**
 * Client ID of the GitMetrics OAuth App (Device Flow enabled). Client IDs are public,
 * so shipping it is safe; there is no client secret involved in the Device Flow.
 * Set GITMETRICS_CLIENT_ID to use your own OAuth App instead.
 */
export const DEFAULT_CLIENT_ID = '';

export const OAUTH_SCOPES = 'repo read:user read:org';

export const clientId = () => process.env.GITMETRICS_CLIENT_ID || DEFAULT_CLIENT_ID;

interface GitHubUser {
  login: string;
  name: string | null;
  avatar_url: string;
  html_url: string;
  followers: number;
  following: number;
  public_repos: number;
  created_at: string;
}

export const toViewer = (user: GitHubUser): Viewer => ({
  login: user.login,
  name: user.name,
  avatarUrl: user.avatar_url,
  htmlUrl: user.html_url,
  followers: user.followers,
  following: user.following,
  publicRepos: user.public_repos,
  createdAt: user.created_at,
});

/** Checks a token against GET /user and returns the account plus its granted scopes. */
export async function validateToken(
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ viewer: Viewer; scopes: string[] }> {
  const response = await fetchImpl(`${GITHUB_API}/user`, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'User-Agent': USER_AGENT,
    },
  });
  if (!response.ok) {
    throw new GitHubError(
      response.status === 401 ? 401 : response.status,
      response.status === 401 ? 'This token is invalid or has expired.' : response.statusText,
    );
  }
  const scopes = (response.headers.get('x-oauth-scopes') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return { viewer: toViewer((await response.json()) as GitHubUser), scopes };
}

/**
 * Where the GitHub CLI is installed when it isn't on the PATH: opened from its shortcut, or started
 * with the computer, GitMetrics has the system's short PATH, without Homebrew's folders and the like.
 */
export function ghLocations(platform: NodeJS.Platform = process.platform, home = homedir()): string[] {
  if (platform === 'win32') return [];
  return [
    '/opt/homebrew/bin/gh',
    '/usr/local/bin/gh',
    '/home/linuxbrew/.linuxbrew/bin/gh',
    path.join(home, '.linuxbrew', 'bin', 'gh'),
    '/snap/bin/gh',
    path.join(home, '.local', 'bin', 'gh'),
  ];
}

/** Runs `gh auth token` with one GitHub CLI: its token, or null. */
function ghAuthToken(gh: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(gh, ['auth', 'token'], { timeout: 5000 }, (error, stdout) => {
      const token = stdout?.trim();
      resolve(error || !token ? null : token);
    });
  });
}

/**
 * Reads the token of an existing GitHub CLI session, if there is one: the CLI on the PATH, else the
 * first one found where it's usually installed.
 */
export async function readGhToken(locations = ghLocations()): Promise<string | null> {
  const token = await ghAuthToken('gh');
  if (token) return token;
  for (const gh of locations) {
    if (existsSync(gh)) return ghAuthToken(gh);
  }
  return null;
}

interface DeviceSession {
  deviceCode: string;
  interval: number;
  expiresAt: number;
}

/** OAuth Device Flow: the browser only ever sees the short user code, never the token. */
export class DeviceFlow {
  private session: DeviceSession | null = null;

  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  private async post<T>(url: string, body: Record<string, string>): Promise<T> {
    const response = await this.fetchImpl(url, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'User-Agent': USER_AGENT,
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new GitHubError(response.status, 'GitHub rejected the sign-in request.');
    return (await response.json()) as T;
  }

  async start(): Promise<DeviceStart> {
    const id = clientId();
    if (!id) throw new GitHubError(400, 'No OAuth client ID is configured.');
    const data = await this.post<{
      device_code: string;
      user_code: string;
      verification_uri: string;
      expires_in: number;
      interval: number;
      error?: string;
      error_description?: string;
    }>('https://github.com/login/device/code', { client_id: id, scope: OAUTH_SCOPES });
    if (data.error) throw new GitHubError(400, data.error_description ?? data.error);

    this.session = {
      deviceCode: data.device_code,
      interval: data.interval,
      expiresAt: Date.now() + data.expires_in * 1000,
    };
    return {
      userCode: data.user_code,
      verificationUri: data.verification_uri,
      expiresIn: data.expires_in,
      interval: data.interval,
    };
  }

  /** Returns the access token once the user approves, or the current flow status. */
  async poll(): Promise<DevicePoll & { token?: string }> {
    const session = this.session;
    if (!session || Date.now() > session.expiresAt) {
      this.session = null;
      return { status: 'expired' };
    }
    const data = await this.post<{ access_token?: string; error?: string; interval?: number }>(
      'https://github.com/login/oauth/access_token',
      {
        client_id: clientId(),
        device_code: session.deviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      },
    );

    if (data.access_token) {
      this.session = null;
      return { status: 'complete', token: data.access_token };
    }
    switch (data.error) {
      case 'slow_down':
        session.interval = data.interval ?? session.interval + 5;
        return { status: 'pending', interval: session.interval };
      case 'authorization_pending':
        return { status: 'pending', interval: session.interval };
      case 'access_denied':
        this.session = null;
        return { status: 'denied' };
      default:
        this.session = null;
        return { status: 'expired' };
    }
  }
}
