/** A GitHub login: letters, digits and single hyphens, up to 39 characters (as the server checks). */
export const LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;

/**
 * An account typed or pasted in the quick search. A link to it (github.com/login) or @login asks
 * for that account exactly; a plain word may be one, so it's searched for too.
 */
export function parseAccountQuery(text: string): { login: string; exact: boolean } | null {
  const trimmed = text.trim();
  const link = /^(?:https?:\/\/)?(?:www\.)?github\.com\/([A-Za-z0-9-]+)\/?$/i.exec(trimmed);
  const at = /^@([A-Za-z0-9-]+)$/.exec(trimmed);
  const exact = link?.[1] ?? at?.[1];
  if (exact) return LOGIN.test(exact) ? { login: exact, exact: true } : null;
  return LOGIN.test(trimmed) ? { login: trimmed, exact: false } : null;
}
