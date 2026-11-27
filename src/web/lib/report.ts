import type { ActivityPull, ActivityResponse } from '../../shared/types';
import { hours, num, percent } from './format';

/*
 * A report of what someone did with pull requests, in Markdown: what they opened and what they
 * reviewed, over the period and in the place on screen, to be kept, edited and shared.
 */

export interface ReportOptions {
  /** Their own pull requests, by how each ended up. */
  opened: {
    merged: boolean;
    open: boolean;
    drafts: boolean;
    closed: boolean;
    /** Each one's description, under it. */
    descriptions: boolean;
  };
  /** Other people's pull requests they took part in. */
  reviewed: {
    /** Which of their reviews count: any of them, or only those they approved. */
    reviews: 'any' | 'approved' | 'none';
    /** Only pull requests that were merged in the end. */
    onlyMerged: boolean;
    /** Those they commented on without a review too. */
    commented: boolean;
  };
  /**
   * How the lists are laid out: each list grouped by repository or by month, or everything in one
   * timeline, oldest first.
   */
  groupBy: 'repo' | 'month' | 'timeline';
}

export const DEFAULT_REPORT: ReportOptions = {
  opened: { merged: true, open: true, drafts: false, closed: false, descriptions: true },
  reviewed: { reviews: 'any', onlyMerged: false, commented: false },
  groupBy: 'timeline',
};

const REVIEW_WORDS: Record<NonNullable<ActivityPull['review']>, string> = {
  approved: 'approved',
  changes: 'requested changes',
  commented: 'commented',
  dismissed: 'review dismissed',
};

/** A day as "Mar 3, 2026". */
const day = (iso: string) =>
  new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });

const month = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });

/** Text as Markdown shows it as written: nothing in a title turns into a link or emphasis. */
const plain = (text: string) => text.replace(/([\\`*_[\]<>#|])/g, '\\$1');

/** A number with its noun: "1 approval", "3 approvals". */
const count = (n: number, one: string, many = `${one}s`) => `${num(n)} ${n === 1 ? one : many}`;
/** The same, the number in bold. */
const bold = (n: number, one: string, many = `${one}s`) => `**${num(n)}** ${n === 1 ? one : many}`;

/** Longest description kept whole: past it, cut with a note. */
const MAX_DESCRIPTION = 6000;

/**
 * A description as a quote under its pull request: without the template's hidden notes, with blank
 * lines kept to one, and cut when very long.
 */
function quote(body: string): string | null {
  let text = body
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!text) return null;
  if (text.length > MAX_DESCRIPTION) text = `${text.slice(0, MAX_DESCRIPTION).trimEnd()}…`;
  return text
    .split('\n')
    .map((line) => (line ? `  > ${line}` : '  >'))
    .join('\n');
}

/** How a pull request ended up, labelled, so a reader (or a model) can't take it for anything else. */
function outcome(p: ActivityPull): string {
  if (p.state === 'merged') return `state: merged on ${day(p.mergedAt ?? p.at)}`;
  if (p.state === 'closed') return 'state: closed without merging';
  return p.draft ? 'state: draft' : 'state: open';
}

/** What each choice left in or out, in words, for the report to say how it was made. */
function chosen(options: ReportOptions): string[] {
  const o = options.opened;
  const states = (
    [
      [o.merged, 'merged'],
      [o.open, 'open'],
      [o.drafts, 'draft'],
      [o.closed, 'closed'],
    ] as const
  )
    .filter(([on]) => on)
    .map(([, word]) => word);
  const out = [
    states.length
      ? `Their own pull requests: ${states.join(', ')}${o.descriptions ? ', each with its description' : ''}.`
      : 'Their own pull requests: none.',
  ];
  const r = options.reviewed;
  out.push(
    r.reviews === 'none'
      ? 'Pull requests they reviewed: none.'
      : `Pull requests they reviewed: ${r.reviews === 'approved' ? 'only those they approved' : 'all'}` +
          `${r.onlyMerged ? ', and only those merged' : ''}.`,
  );
  out.push(
    r.commented
      ? `Pull requests they only commented on: included${r.onlyMerged ? ', only those merged' : ''}.`
      : 'Pull requests they only commented on: not included.',
  );
  return out;
}

/** Kept, for their own pull requests, by how each ended up. */
function keepOpened(p: ActivityPull, o: ReportOptions['opened']) {
  if (p.state === 'merged') return o.merged;
  if (p.state === 'closed') return o.closed;
  return p.draft ? o.drafts : o.open;
}

/** Kept, for one they reviewed, by which of their reviews count and how it ended up. */
function keepReviewed(p: ActivityPull, o: ReportOptions['reviewed']) {
  if (o.reviews === 'none') return false;
  if (o.onlyMerged && p.state !== 'merged') return false;
  return o.reviews === 'any' || (p.reviews ?? (p.review ? [p.review] : [])).includes('approved');
}

/** Pull requests under a heading each: by repository (the busiest first) or by month (the latest first). */
function grouped(pulls: ActivityPull[], by: 'repo' | 'month', line: (p: ActivityPull) => string) {
  const groups = new Map<string, ActivityPull[]>();
  for (const p of pulls) {
    const key = by === 'repo' ? p.repo : p.at.slice(0, 7);
    groups.set(key, [...(groups.get(key) ?? []), p]);
  }
  const order = [...groups.entries()].sort(([a, x], [b, y]) =>
    by === 'repo' ? y.length - x.length || a.localeCompare(b) : b.localeCompare(a),
  );
  return order
    .map(([key, list]) => {
      const title = by === 'repo' ? key : month(`${key}-01T00:00:00Z`);
      const items = [...list].sort((a, b) => b.at.localeCompare(a.at)).map(line);
      return `### ${plain(title)} (${num(list.length)})\n\n${items.join('\n')}`;
    })
    .join('\n\n');
}

const link = (p: ActivityPull) => `[${plain(p.title)}](${p.url})`;

export interface ReportInput {
  activity: ActivityResponse;
  options: ReportOptions;
  /** Descriptions by pull request id, when they were asked for. */
  descriptions?: Record<string, string>;
  /** The pull requests they commented on, when asked for. */
  commented?: ActivityPull[];
  now?: Date;
}

/** What goes in, and how many of each: for the report's file and what the page says about it. */
export function reportContents({ activity, options, commented }: ReportInput) {
  const opened = activity.pulls.opened.filter((p) => keepOpened(p, options.opened));
  const reviewed = activity.pulls.reviewed.filter((p) => keepReviewed(p, options.reviewed));
  // Commented on only: none they reviewed in the period (that's a review, listed or not), and as
  // merged as asked for.
  const reviewedKeys = new Set(activity.pulls.reviewed.map((p) => `${p.repo}#${p.number}`));
  const onlyCommented = options.reviewed.commented
    ? (commented ?? []).filter(
        (p) =>
          !reviewedKeys.has(`${p.repo}#${p.number}`) &&
          (!options.reviewed.onlyMerged || p.state === 'merged'),
      )
    : [];
  return { opened, reviewed, commented: onlyCommented };
}

/** The report, as Markdown. */
export function buildReport(input: ReportInput): string {
  const { activity, options, descriptions = {}, now = new Date() } = input;
  const { user, scope, from, to, opened: o, reviews: r } = activity;
  const parts = reportContents(input);
  const who = user.name ? `${user.name} (@${user.login})` : `@${user.login}`;
  const where = scope.kind === 'all' ? 'across GitHub' : `in ${scope.name}`;
  const out: string[] = [];

  out.push(`# Pull requests: ${plain(who)}`);
  out.push(
    `What @${user.login} opened and reviewed ${where}, from ${day(from)} to ${day(to)}.\n` +
      `Made with [GitMetrics](https://github.com/JeanExtreme002/GitMetrics) on ${day(now.toISOString())}.`,
  );

  // The period at a glance, whatever is listed below.
  const summary = [
    `- ${bold(o.total, 'pull request')} opened, **${num(o.merged)}** merged` +
      (o.total ? ` (${percent(o.merged / o.total)})` : '') +
      (o.merged ? `, ${num(o.selfMerged)} of those merged by @${user.login} themselves` : ''),
    ...(o.medianMergeHours !== null
      ? [`- Time from opening to merge: ${hours(o.medianMergeHours)} (median)`]
      : []),
    `- ${bold(r.total, 'review')} on ${bold(r.pulls, 'pull request')}: ${count(r.approved, 'approval')}, ` +
      `${count(r.changes, 'change request')}, ${count(r.commented, 'comment')}`,
  ];
  if (activity.repos.length) {
    const top = activity.repos
      .slice(0, 5)
      .map((x) => `${plain(x.name)} (${num(x.opened + x.reviews)})`)
      .join(', ');
    summary.push(
      `- Across ${bold(activity.repos.length, 'repository', 'repositories')}: ${top}` +
        (activity.repos.length > 5 ? ', and more' : ''),
    );
  }
  if (activity.reviewsGiven.length) {
    summary.push(
      `- Reviewed the work of ${bold(activity.reviewsGiven.length, 'person', 'people')}: ` +
        activity.reviewsGiven
          .slice(0, 5)
          .map((p) => `@${p.login} (${num(p.count)})`)
          .join(', ') +
        (activity.reviewsGiven.length > 5 ? ', and more' : ''),
    );
  }
  out.push(`## Summary\n\n${summary.join('\n')}`);
  if (!o.complete || !r.complete) {
    out.push(
      '> **Note:** there was more than GitHub’s search could give in this period, so some is left out.',
    );
  }

  // How to read what follows: what each word means, where each date comes from, what was chosen.
  const about = [
    `- **Opened:** a pull request @${user.login} opened in the period, dated by when it was opened.`,
    `- **Reviewed:** a pull request by someone else that @${user.login} reviewed in the period, dated by ` +
      'their latest review in it. "Their reviews" lists every kind of review they gave it in the period.',
  ];
  if (parts.commented.length) {
    about.push(
      `- **Commented on:** a pull request by someone else that @${user.login} commented on without ` +
        'reviewing. GitHub doesn’t say when a comment was made, so it’s dated by the pull request’s ' +
        'last activity: the comments may be older.',
    );
  }
  about.push(
    '- **State** is how the pull request stands today. **Size** is the lines it adds and removes.',
    '- The summary counts the whole period. The lists hold what was chosen for this report:',
    ...chosen(options).map((line) => `  - ${line}`),
    `- Only what was visible on GitHub to the account that made the report is included, private repositories it can see too.`,
  );
  out.push(`## About this report\n\n${about.join('\n')}`);

  // A line for each, the same in every layout; the repository named where no heading names it.
  const byRepo = options.groupBy === 'repo';
  const withRepo = (meta: string[], p: ActivityPull) => (byRepo ? meta : [plain(p.repo), ...meta]);
  const openedLine = (p: ActivityPull, lead = '') => {
    const meta = withRepo(
      [`#${p.number}`, outcome(p), `size: +${num(p.additions)} −${num(p.deletions)} lines`],
      p,
    );
    const line = `- ${lead}**${link(p)}** · ${meta.join(' · ')}`;
    const description = options.opened.descriptions ? quote(descriptions[p.id] ?? '') : null;
    return description ? `${line}\n\n${description}\n` : line;
  };
  const by = (p: ActivityPull) => `#${p.number}${p.author ? ` by @${p.author.login}` : ''}`;
  const reviewedLine = (p: ActivityPull, lead = '') => {
    const kinds = (p.reviews ?? (p.review ? [p.review] : [])).map((k) => REVIEW_WORDS[k]);
    const meta = withRepo(
      [by(p), kinds.length ? `their reviews: ${kinds.join(', ')}` : '', outcome(p)].filter(Boolean),
      p,
    );
    return `- ${lead}${link(p)} · ${meta.join(' · ')}`;
  };
  // Dated by the pull request's last activity, said as such: GitHub doesn't date the comments.
  const commentedLine = (p: ActivityPull, lead = '') =>
    `- ${lead}${link(p)} · ${withRepo([by(p), outcome(p), ...(lead ? [] : [`last active ${day(p.at)}`])], p).join(' · ')}`;

  if (options.groupBy === 'timeline') {
    // Everything as it happened, oldest first, under each month: what they did, then what it was.
    const events = [
      ...parts.opened.map((p) => ({ at: p.createdAt, line: openedLine(p, `${day(p.createdAt)} · Opened `) })),
      ...parts.reviewed.map((p) => ({ at: p.at, line: reviewedLine(p, `${day(p.at)} · Reviewed `) })),
      ...parts.commented.map((p) => ({
        at: p.at,
        line: commentedLine(p, `${day(p.at)} (last activity) · Commented on `),
      })),
    ].sort((a, b) => a.at.localeCompare(b.at));
    if (events.length) {
      const months = new Map<string, string[]>();
      for (const e of events) months.set(e.at.slice(0, 7), [...(months.get(e.at.slice(0, 7)) ?? []), e.line]);
      out.push(
        `## Timeline (${num(events.length)})\n\n` +
          [...months.entries()]
            .map(([key, lines]) => `### ${month(`${key}-01T00:00:00Z`)}\n\n${lines.join('\n')}`)
            .join('\n\n'),
      );
    }
  } else {
    const layout = options.groupBy;
    if (parts.opened.length) {
      out.push(
        `## Pull requests opened (${num(parts.opened.length)})\n\n` +
          grouped(parts.opened, layout, (p) => openedLine(p)),
      );
    }
    if (parts.reviewed.length) {
      out.push(
        `## Pull requests reviewed (${num(parts.reviewed.length)})\n\n` +
          grouped(parts.reviewed, layout, (p) => reviewedLine(p)),
      );
    }
    if (parts.commented.length) {
      out.push(
        `## Pull requests commented on (${num(parts.commented.length)})\n\n` +
          grouped(parts.commented, layout, (p) => commentedLine(p)),
      );
    }
  }

  if (!parts.opened.length && !parts.reviewed.length && !parts.commented.length) {
    out.push('_No pull requests match what was chosen for this report._');
  }

  return `${out.join('\n\n')}\n`;
}

/** The report's file name: short, by whose it is. The period is written inside it. */
export const reportFileName = (activity: ActivityResponse) => `${activity.user.login}-report.md`;
