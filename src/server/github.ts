import type { RateLimitInfo } from '../shared/types.js';
import { sleep } from './util.js';

export const GITHUB_API = 'https://api.github.com';
export const USER_AGENT = 'GitMetrics';

export class GitHubError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'GitHubError';
  }
}

type Query = Record<string, string | number | boolean | undefined>;

interface RequestOptions {
  query?: Query;
  accept?: string;
  method?: string;
  body?: unknown;
}

export interface Page<T> {
  data: T;
  lastPage: number;
  status: number;
}

export function parseLastPage(link: string | null): number {
  if (!link) return 1;
  const match = /[?&]page=(\d+)[^>]*>;\s*rel="last"/.exec(link);
  return match ? Number(match[1]) : 1;
}

export class GitHubClient {
  rateLimit: RateLimitInfo | null = null;

  constructor(
    private readonly token: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly baseUrl: string = GITHUB_API,
    private readonly statsRetryDelayMs = 1500,
  ) {}

  private buildUrl(path: string, query?: Query): string {
    const url = new URL(path.startsWith('http') ? path : `${this.baseUrl}${path}`);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    return url.toString();
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<Page<T>> {
    const response = await this.fetchImpl(this.buildUrl(path, options.query), {
      method: options.method ?? 'GET',
      headers: {
        Accept: options.accept ?? 'application/vnd.github+json',
        Authorization: `Bearer ${this.token}`,
        'User-Agent': USER_AGENT,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });

    this.trackRateLimit(response.headers);

    if (!response.ok) {
      let message = response.statusText;
      try {
        const body = (await response.json()) as { message?: string };
        if (body.message) message = body.message;
      } catch {
        // Body was not JSON; keep the status text.
      }
      throw new GitHubError(response.status, message);
    }

    const text = response.status === 204 ? '' : await response.text();
    return {
      data: (text ? JSON.parse(text) : null) as T,
      lastPage: parseLastPage(response.headers.get('link')),
      status: response.status,
    };
  }

  async get<T>(path: string, query?: Query, accept?: string): Promise<T> {
    return (await this.request<T>(path, { query, accept })).data;
  }

  /** Fetches up to `maxPages` raw pages of an endpoint, in parallel after the first. */
  async pages<T>(
    path: string,
    query: Query = {},
    { maxPages = 10, accept }: { maxPages?: number; accept?: string } = {},
  ): Promise<T[]> {
    const first = await this.request<T>(path, { query: { per_page: 100, ...query }, accept });
    const count = Math.min(first.lastPage, maxPages);
    const rest = await Promise.all(
      Array.from({ length: count - 1 }, (_, i) =>
        this.get<T>(path, { per_page: 100, ...query, page: i + 2 }, accept),
      ),
    );
    return [first.data, ...rest];
  }

  /** Fetches up to `maxPages` pages of a list endpoint and concatenates them. */
  async paginate<T>(
    path: string,
    query: Query = {},
    options: { maxPages?: number; accept?: string } = {},
  ): Promise<T[]> {
    return (await this.pages<T[]>(path, query, options)).flat();
  }

  /** Returns how many items a list endpoint has, using a single request. */
  async count(path: string, query: Query = {}): Promise<number> {
    const page = await this.request<unknown[]>(path, { query: { ...query, per_page: 1 } });
    return page.lastPage > 1 ? page.lastPage : (page.data?.length ?? 0);
  }

  async graphql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    const { data } = await this.request<{ data?: T; errors?: { message: string }[] }>('/graphql', {
      method: 'POST',
      body: { query, variables },
    });
    if (data.errors?.length && !data.data) {
      throw new GitHubError(502, data.errors.map((e) => e.message).join('; '));
    }
    return data.data as T;
  }

  /**
   * The /stats endpoints answer 202 while GitHub computes them in the background.
   * Retries a few times and returns null when the numbers are still not ready.
   */
  async stats<T>(path: string, attempts = 4): Promise<T | null> {
    for (let attempt = 0; attempt < attempts; attempt++) {
      const page = await this.request<T>(path);
      if (page.status === 200) return page.data;
      if (page.status === 204) return [] as T;
      if (attempt < attempts - 1) await sleep(this.statsRetryDelayMs);
    }
    return null;
  }

  private trackRateLimit(headers: Headers) {
    const limit = headers.get('x-ratelimit-limit');
    const remaining = headers.get('x-ratelimit-remaining');
    const reset = headers.get('x-ratelimit-reset');
    const resource = headers.get('x-ratelimit-resource');
    if (!limit || !remaining || !reset || (resource && resource !== 'core')) return;
    this.rateLimit = {
      limit: Number(limit),
      remaining: Number(remaining),
      resetAt: new Date(Number(reset) * 1000).toISOString(),
    };
  }
}

/** Swallows "not found / not allowed" so optional sections can degrade gracefully. */
export async function optional<T>(promise: Promise<T>, fallback: T): Promise<T> {
  try {
    return await promise;
  } catch (error) {
    if (error instanceof GitHubError && [403, 404, 409, 410, 422].includes(error.status)) {
      return fallback;
    }
    throw error;
  }
}
