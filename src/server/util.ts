const DAY_MS = 24 * 60 * 60 * 1000;

export const toDay = (value: string | number | Date): string => new Date(value).toISOString().slice(0, 10);

export const toMonth = (value: string | number | Date): string => new Date(value).toISOString().slice(0, 7);

/** Returns the last `count` months (YYYY-MM), oldest first, ending at `now`. */
export function lastMonths(count: number, now: Date = new Date()): string[] {
  const months: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    months.push(toMonth(d));
  }
  return months;
}

/** Every month between two YYYY-MM values, inclusive. */
export function monthsBetween(start: string, end: string): string[] {
  const [sy, sm] = start.split('-').map(Number);
  const [ey, em] = end.split('-').map(Number);
  const months: string[] = [];
  let y = sy!;
  let m = sm!;
  while (y < ey! || (y === ey && m <= em!)) {
    months.push(`${y}-${String(m).padStart(2, '0')}`);
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return months;
}

/** Every day (YYYY-MM-DD) in the last `count` days, oldest first. */
export function lastDays(count: number, now: Date = new Date()): string[] {
  const days: string[] = [];
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  for (let i = count - 1; i >= 0; i--) days.push(toDay(today - i * DAY_MS));
  return days;
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

export const average = (values: number[]): number | null =>
  values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : null;

export const hoursBetween = (from: string, to: string): number =>
  (new Date(to).getTime() - new Date(from).getTime()) / 3_600_000;

export const daysAgo = (days: number, now: Date = new Date()): Date =>
  new Date(now.getTime() - days * DAY_MS);

/** Runs `fn` over `items` with at most `limit` calls in flight. */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]!, index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

export function countBy<T>(items: T[], key: (item: T) => string | null | undefined) {
  const counts = new Map<string, number>();
  for (const item of items) {
    const k = key(item);
    if (k) counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return counts;
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
