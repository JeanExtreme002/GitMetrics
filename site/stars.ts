/** 1234 → "1.2k" and 15400 → "15k", like GitHub's own star counter. */
export function compactStars(count: number): string {
  if (count < 1000) return String(count);
  const k = count / 1000;
  return `${k >= 10 ? Math.round(k) : Math.round(k * 10) / 10}k`;
}
