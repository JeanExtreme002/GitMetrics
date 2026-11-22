/** One day of traffic on the chart; null where nothing was saved for it. */
export interface TrafficDay {
  date: string;
  count: number | null;
  uniques: number | null;
}

/** A stretch of days with no traffic saved: GitMetrics wasn't opened within GitHub's 14 days. */
export interface TrafficGap {
  from: string;
  to: string;
  days: number;
}

const DAY_MS = 86_400_000;
const next = (day: string) =>
  new Date(new Date(`${day}T00:00:00Z`).getTime() + DAY_MS).toISOString().slice(0, 10);

/**
 * Every day from the first saved one to the last, with the days never saved left empty. GitHub
 * reports quiet days as zero, so a missing day is one that wasn't collected, not one without
 * traffic: drawn as a break in the chart, never as a zero.
 */
export function withGaps(daily: { date: string; count: number; uniques: number }[]): {
  days: TrafficDay[];
  gaps: TrafficGap[];
} {
  const sorted = [...daily].sort((a, b) => a.date.localeCompare(b.date));
  const days: TrafficDay[] = [];
  const gaps: TrafficGap[] = [];
  for (const d of sorted) {
    const last = days.at(-1);
    if (last) {
      let day = next(last.date);
      if (day < d.date) {
        const from = day;
        let missing = 0;
        let to = day;
        while (day < d.date) {
          days.push({ date: day, count: null, uniques: null });
          to = day;
          missing++;
          day = next(day);
        }
        gaps.push({ from, to, days: missing });
      }
    }
    days.push({ date: d.date, count: d.count, uniques: d.uniques });
  }
  return { days, gaps };
}
