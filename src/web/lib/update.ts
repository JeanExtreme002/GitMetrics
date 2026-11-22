/** A closed update popup comes back after a week, or right away for an even newer version. */
export const SNOOZE = 7 * 86_400_000;

/** Which version's popup was closed, and when. */
export interface Dismissed {
  version: string;
  at: number;
}

/** Whether the popup for `latest` stays hidden because it was closed less than a week ago. */
export function snoozed(dismissed: Dismissed | null, latest: string | null, now = Date.now()): boolean {
  // Anything else saved here (such as a plain version string from an earlier build) counts as not closed.
  if (!dismissed || typeof dismissed !== 'object') return false;
  return dismissed.version === latest && now - dismissed.at < SNOOZE;
}
