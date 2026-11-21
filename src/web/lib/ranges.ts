/** Time windows shared by the history charts (stars, code frequency…). */
export const RANGES = [
  { label: '3M', value: '3', months: 3 },
  { label: '6M', value: '6', months: 6 },
  { label: '1Y', value: '12', months: 12 },
  { label: '2Y', value: '24', months: 24 },
  { label: '5Y', value: '60', months: 60 },
  { label: '10Y', value: '120', months: 120 },
  { label: 'All', value: 'all', months: Infinity },
] as const;

export type RangeValue = (typeof RANGES)[number]['value'];

/** First day (YYYY-MM-DD) inside the window, or '' for "All". */
export function cutoff(value: RangeValue): string {
  const months = RANGES.find((r) => r.value === value)!.months;
  if (!Number.isFinite(months)) return '';
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() - months);
  return d.toISOString().slice(0, 10);
}

/** SegmentedControl options; windows longer than the history would just repeat "All". */
export function rangeOptions(firstDate: string | null | undefined) {
  return RANGES.map((r) => ({
    label: r.label,
    value: r.value,
    disabled: r.value !== 'all' && !!firstDate && cutoff(r.value) < firstDate.slice(0, 10),
  }));
}
