const integer = new Intl.NumberFormat('en-US');
const compactFormat = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });
const relativeFormat = new Intl.RelativeTimeFormat('en-US', { numeric: 'auto' });
const dateFormat = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const dayFormat = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const monthShort = new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' });
const monthLong = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });

export const num = (value: number | null | undefined) => (value == null ? '—' : integer.format(value));

const axisFormat = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });

/** Chart axis labels: always compact (4K, 12K, 1.2M) so every tick reads the same way. */
export const axisNumber = (value: number) => axisFormat.format(value);

export const compact = (value: number | null | undefined) =>
  value == null ? '—' : value < 10_000 ? integer.format(value) : compactFormat.format(value);

export const percent = (ratio: number | null | undefined, digits = 0) =>
  ratio == null ? '—' : `${(ratio * 100).toFixed(digits)}%`;

export function duration(ms: number | null | undefined): string {
  if (ms == null || Number.isNaN(ms)) return '—';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return s % 60 ? `${m}m ${s % 60}s` : `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return m % 60 ? `${h}h ${m % 60}m` : `${h}h`;
  const d = Math.floor(h / 24);
  return h % 24 ? `${d}d ${h % 24}h` : `${d}d`;
}

export const hours = (value: number | null | undefined) =>
  value == null ? '—' : duration(value * 3_600_000);

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 31_536_000],
  ['month', 2_592_000],
  ['week', 604_800],
  ['day', 86_400],
  ['hour', 3_600],
  ['minute', 60],
];

export function relative(iso: string | null | undefined): string {
  if (!iso) return '—';
  const seconds = (new Date(iso).getTime() - Date.now()) / 1000;
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) return relativeFormat.format(Math.round(seconds / size), unit);
  }
  return 'just now';
}

const dateTimeFormat = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});
const dateTimeYearFormat = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

/** "Nov 21, 2:14 PM", with the year only when it isn't this one: for steps hours apart. */
export function dateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return (d.getFullYear() === new Date().getFullYear() ? dateTimeFormat : dateTimeYearFormat).format(d);
}

/** Dates without a time ("2025-03-04") are calendar days and must not shift with the time zone. */
export const date = (iso: string | null | undefined) =>
  iso ? dateFormat.format(new Date(iso.length === 10 ? `${iso}T12:00:00` : iso)) : '—';

/** "2025-03-04" → "Mar 4" */
export const dayLabel = (day: string) => dayFormat.format(new Date(`${day.slice(0, 10)}T00:00:00Z`));

/** "2025-03" → "Mar '25" (short, for chart axes) */
export function monthLabel(month: string) {
  const d = new Date(`${month.slice(0, 7)}-01T00:00:00Z`);
  return `${monthShort.format(d)} '${String(d.getUTCFullYear()).slice(2)}`;
}

/** "2025-03" → "March 2025" */
export const monthName = (month: string) => monthLong.format(new Date(`${month.slice(0, 7)}-01T00:00:00Z`));

/**
 * Turns a cumulative series with irregular dates into `count` evenly spaced points,
 * so the x axis of a chart is proportional to time.
 */
export function resampleCumulative<T extends { date: string }>(
  points: T[],
  key: keyof T & string,
  from?: string,
  count = 180,
): { date: string; value: number }[] {
  if (!points.length) return [];
  const start = new Date(from && from > points[0]!.date ? from : points[0]!.date).getTime();
  const end = Date.now();
  const step = Math.max((end - start) / (count - 1), 1);
  const out: { date: string; value: number }[] = [];
  let i = 0;
  let current = 0;
  for (let n = 0; n < count; n++) {
    const t = start + n * step;
    while (i < points.length && new Date(points[i]!.date).getTime() <= t) {
      current = Number(points[i]![key]);
      i++;
    }
    out.push({ date: new Date(t).toISOString().slice(0, 10), value: current });
  }
  out[out.length - 1]!.value = Number(points[points.length - 1]![key]);
  return out;
}

/** Picks a readable tick label for a date axis depending on how long it spans. */
export const timeTick = (spanDays: number) => (day: string) =>
  spanDays > 400 ? monthLabel(day) : dayLabel(day);

export const hourLabel = (hour: number) => `${hour % 12 === 0 ? 12 : hour % 12}${hour < 12 ? 'am' : 'pm'}`;

/** GitHub renders ":snake:" style shortcodes as emoji; the API returns them raw, so drop them. */
export const cleanText = (text: string | null | undefined) =>
  (text ?? '')
    .replace(/:[a-z0-9_+-]+:/gi, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([.,!?])/g, '$1')
    .trim();

/**
 * Describes which items an analysis covers: "across all 63 pull requests" when every item was
 * fetched, "among the latest 300 pull requests" when only the most recent ones were.
 */
export const sampleScope = (sample: number, total: number, noun: string) =>
  sample >= total ? `across all ${num(total)} ${noun}` : `among the latest ${num(sample)} ${noun}`;
