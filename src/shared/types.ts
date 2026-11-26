// Response shapes shared by the local server and the web app.

export type AuthSource = 'device' | 'token' | 'gh';

export interface Viewer {
  login: string;
  name: string | null;
  avatarUrl: string;
  htmlUrl: string;
  followers: number;
  following: number;
  publicRepos: number;
  createdAt: string;
}

export interface AuthStatus {
  authenticated: boolean;
  viewer?: Viewer;
  source?: AuthSource;
  scopes?: string[];
  methods: { device: boolean; gh: boolean };
}

export interface DeviceStart {
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
}

export interface DevicePoll {
  status: 'pending' | 'complete' | 'expired' | 'denied';
  interval?: number;
}

export interface RateLimitInfo {
  limit: number;
  remaining: number;
  resetAt: string;
}

export interface RepoSummary {
  id: number;
  owner: string;
  name: string;
  fullName: string;
  description: string | null;
  private: boolean;
  fork: boolean;
  archived: boolean;
  stars: number;
  forks: number;
  watchers: number;
  openIssues: number;
  language: string | null;
  topics: string[];
  pushedAt: string | null;
  createdAt: string;
  htmlUrl: string;
  ownerAvatarUrl: string;
}

/** A user or an organization, and the repositories it owns. */
export interface AccountResponse {
  kind: 'user' | 'organization';
  login: string;
  name: string | null;
  avatarUrl: string;
  url: string;
  /** A user's bio or an organization's description. */
  bio: string | null;
  company: string | null;
  location: string | null;
  websiteUrl: string | null;
  twitter: string | null;
  createdAt: string;
  /** Organizations only: whether GitHub verified its domain. */
  verified: boolean;
  /** Users only. */
  followers: number | null;
  following: number | null;
  /** Organizations only: the members your account can see. */
  members: number | null;
  /** Users only: the organizations they show publicly. */
  organizations: { login: string; avatarUrl: string }[];
  /** Repositories it owns, by kind; counted by GitHub, so always exact. */
  repositories: { total: number; sources: number; forks: number; archived: number; private: number };
  /** Its repositories in GitHub's own order: pushed to most recently first, forks included. */
  repos: RepoSummary[];
  /** The repositories pushed to most recently. */
  recent: RepoSummary[];
}

/**
 * Added up over every repository an account owns, as on the home page. Read apart from the account,
 * as it takes a request per hundred repositories; null when there are too many to read.
 */
export interface AccountTotals {
  stars: number;
  forks: number;
  /** By main language, over the repositories that aren't forks, most used first. */
  languages: { name: string; count: number }[];
}

/** The public repositories of an account outside your own list. */
export interface AccountReposResponse {
  repos: RepoSummary[];
  /** False when there were more than could be read. */
  complete: boolean;
}

/** An account found by the quick search. */
export interface AccountHit {
  login: string;
  avatarUrl: string;
  kind: 'user' | 'organization';
}

export interface ReposResponse {
  repos: RepoSummary[];
  favorites: string[];
}

/** Whether a newer GitMetrics is published, and how to get it. */
export interface UpdateInfo {
  current: string;
  /** The newest version on npm, or null when it couldn't be checked. */
  latest: string | null;
  available: boolean;
  /** The command that brings the update in, or null when running from a checkout. */
  command: string | null;
}

/** Repositories anywhere on GitHub that match a quick search. */
export interface SearchResponse {
  repos: RepoSummary[];
}

export interface RepoDetails extends RepoSummary {
  defaultBranch: string;
  license: string | null;
  homepage: string | null;
  sizeKb: number;
  subscribers: number;
  visibility: string;
}

export interface OverviewResponse {
  repo: RepoDetails;
  totals: {
    commits: number | null;
    contributors: number | null;
    openPullRequests: number | null;
    openIssues: number | null;
    releases: number | null;
  };
  languages: { name: string; bytes: number; share: number }[];
  health: { percentage: number; files: { name: string; present: boolean }[] } | null;
  latestRelease: { tag: string; name: string; publishedAt: string; url: string } | null;
}

export interface StarPoint {
  date: string;
  stars: number;
}

export interface Stargazer {
  login: string;
  name: string | null;
  avatarUrl: string;
  url: string;
  starredAt: string;
}

export interface StarsResponse {
  total: number;
  sampled: boolean;
  firstStarAt: string | null;
  points: StarPoint[];
  monthly: { month: string; stars: number }[];
  stats: {
    last7Days: number;
    last30Days: number;
    avgPerMonth: number;
    bestMonth: { month: string; stars: number } | null;
  };
  /** The latest people to star the repository, newest first. */
  recent: Stargazer[];
  /**
   * GitHub lists who starred a repository only to people with write access to it, so for
   * anyone else there is no history to draw: only the total is known.
   */
  historyHidden: boolean;
}

export interface TrafficDay {
  date: string;
  count: number;
  uniques: number;
}

export interface TrafficSeries {
  count: number;
  uniques: number;
  daily: TrafficDay[];
}

export interface TrafficResponse {
  available: boolean;
  reason?: string;
  views: TrafficSeries;
  clones: TrafficSeries;
  referrers: { referrer: string; count: number; uniques: number }[];
  paths: { path: string; title: string; count: number; uniques: number }[];
  trackedSince: string | null;
}

export interface CommitItem {
  sha: string;
  message: string;
  author: string;
  avatarUrl: string | null;
  date: string;
  url: string;
}

export interface CommitsResponse {
  pending: boolean;
  weekly: { week: string; commits: number }[];
  daily: Record<string, number>;
  codeFrequency: { week: string; additions: number; deletions: number }[] | null;
  punchCard: { day: number; hour: number; commits: number }[];
  totals: {
    lastYear: number;
    avgPerWeek: number;
    activeWeeks: number;
    busiestDay: string | null;
    busiestHour: number | null;
  };
  recent: CommitItem[];
}

export interface PersonCount {
  login: string;
  avatarUrl: string;
  count: number;
}

export interface PullItem {
  number: number;
  title: string;
  url: string;
  author: string;
  avatarUrl: string | null;
  createdAt: string;
  mergedAt: string | null;
  additions: number;
  deletions: number;
  draft: boolean;
}

export interface PullsResponse {
  counts: { open: number; merged: number; closed: number };
  sampleSize: number;
  monthly: { month: string; opened: number; merged: number; closed: number }[];
  medianTimeToMergeHours: number | null;
  mergeRate: number | null;
  sizes: { size: string; count: number }[];
  topAuthors: PersonCount[];
  openOldest: PullItem[];
  /** The open pull requests opened most recently. */
  openNewest: PullItem[];
  recentMerged: PullItem[];
}

export interface IssueItem {
  number: number;
  title: string;
  url: string;
  author: string;
  avatarUrl: string | null;
  createdAt: string;
  comments: number;
  labels: { name: string; color: string }[];
}

export interface IssuesResponse {
  counts: { open: number; closed: number };
  sampleSize: number;
  monthly: { month: string; opened: number; closed: number }[];
  medianTimeToCloseHours: number | null;
  labels: { name: string; color: string; count: number }[];
  topAuthors: PersonCount[];
  openOldest: IssueItem[];
  /** Open issues with the most comments. */
  mostDiscussed: IssueItem[];
}

export interface Contributor {
  login: string;
  avatarUrl: string;
  url: string;
  commits: number;
  additions: number;
  deletions: number;
  firstWeek: string | null;
  lastWeek: string | null;
  /** Commits in the last 90 days. */
  recentCommits: number;
}

export interface ContributorsResponse {
  pending: boolean;
  /** GitHub is still computing the weekly history; the plain list is shown meanwhile. */
  historyPending: boolean;
  total: number | null;
  contributors: Contributor[];
  activeLast90Days: number;
  newPerMonth: { month: string; count: number }[];
  /** Every month since the first commit: people who committed that month, and first-timers. */
  history: { month: string; active: number; new: number }[];
}

export interface FileStat {
  path: string;
  changes: number;
  additions: number;
  deletions: number;
}

/** A folder or file in the hotspot map; a folder's value is the sum of its files' changes. */
export interface TreeNode {
  name: string;
  /** Full path from the repository root ("" for the root itself). */
  path: string;
  value: number;
  /** Present on folders only, largest first. */
  children?: TreeNode[];
}

export interface FilesResponse {
  commitsAnalyzed: number;
  filesTouched: number;
  /** Lines added and removed across every analyzed commit. */
  lines: { additions: number; deletions: number };
  files: FileStat[];
  folders: FileStat[];
  /** Every changed file nested under its folders, for the drill-down map. */
  tree: TreeNode;
  extensions: { name: string; count: number }[];
}

export interface WorkflowStat {
  id: number;
  name: string;
  path: string;
  state: string;
  runs: number;
  successRate: number | null;
  avgDurationMs: number | null;
  medianDurationMs: number | null;
  lastRun: { status: string; conclusion: string | null; createdAt: string; url: string } | null;
  /** Results of the latest finished runs, newest first (up to 10). */
  recent: { conclusion: string | null; url: string; createdAt: string }[];
}

export interface ActionsResponse {
  available: boolean;
  windowDays: number;
  /** Every run in the window, as GitHub counts them. */
  totalRuns: number;
  /** Runs fetched in full; lower than totalRuns on busy repositories. */
  sampleSize: number;
  /** True when the daily chart and totals come from exact per-day counts instead of the sample. */
  exactDaily: boolean;
  success: number;
  failure: number;
  cancelled: number;
  successRate: number | null;
  avgDurationMs: number | null;
  medianDurationMs: number | null;
  totalDurationMs: number;
  daily: { date: string; success: number; failure: number; other: number }[];
  workflows: WorkflowStat[];
  events: { name: string; count: number }[];
  recentFailures: {
    id: number;
    name: string;
    branch: string | null;
    event: string;
    createdAt: string;
    url: string;
    actor: string | null;
  }[];
}

export interface ReleaseItem {
  id: number;
  tag: string;
  name: string;
  publishedAt: string | null;
  prerelease: boolean;
  url: string;
  downloads: number;
  assets: number;
  author: string | null;
  avatarUrl: string | null;
}

export interface ReleasesResponse {
  /** Every published release, as GitHub counts them. */
  total: number;
  /** Releases fetched in full (the latest 300 at most). */
  sampleSize: number;
  totalDownloads: number;
  medianDaysBetween: number | null;
  releases: ReleaseItem[];
  /** Every month from the first release (or the last 12 months, if longer), stable and pre-releases apart. */
  monthly: { month: string; releases: number; prereleases: number }[];
}

export interface DeploymentItem {
  id: number;
  environment: string;
  ref: string;
  sha: string;
  createdAt: string;
  /** Latest status; only the most recent deployments have one. */
  state: string | null;
  creator: string | null;
  avatarUrl: string | null;
  /** The deployment's log or details page, when its status links one. */
  logUrl: string | null;
}

export interface DeploymentsResponse {
  /** Every deployment, as GitHub counts them. */
  total: number;
  /** Deployments fetched in full (the latest 300 at most). */
  sampleSize: number;
  environments: {
    name: string;
    deployments: number;
    lastDeployedAt: string | null;
    lastState: string | null;
    /** Where the environment is live, from its latest status. */
    url: string | null;
    /** Every deployment to this environment, as GitHub counts them; null if unknown. */
    total: number | null;
  }[];
  /** Every month the sample covers (at least the last 12), per environment. */
  monthly: { month: string; deployments: number; byEnvironment: Record<string, number> }[];
  /**
   * When the sample covers only a short stretch (busy repositories), deployments per hour (up to
   * 3 days) or per day (up to about 2 months) over the time it fully covers, so the chart shows the
   * recent rhythm instead of one lonely month. Hours are "YYYY-MM-DDTHH" in UTC.
   */
  timeline: {
    unit: 'hour' | 'day';
    points: { date: string; deployments: number; byEnvironment: Record<string, number> }[];
  } | null;
  stateCounts: { state: string; count: number }[];
  recent: DeploymentItem[];
}

export interface ApiError {
  error: string;
  status: number;
}

export type RankingMode = 'activity' | 'traffic';

export interface RankingEntry {
  fullName: string;
  name: string;
  value: number;
  secondary: number | null;
}

export interface RankingResponse {
  mode: RankingMode;
  windowDays: number;
  entries: RankingEntry[];
}

// Your pull requests ------------------------------------------------------

/** How you are related to a pull request. "involved" covers all of them. */
/** How you are related to a pull request; "owned" is one someone else opened in your repositories. */
export type PullFilter = 'all' | 'authored' | 'assigned' | 'involved' | 'review' | 'owned';

/** What a repository's merged pull requests usually look like, to put one in context. */
export interface RepoBaseline {
  /** Median hours from opening to the first review by someone other than the author. */
  firstReviewHours: number | null;
  /** Median hours from opening to merge. */
  mergeHours: number | null;
  /** Median lines changed (additions + deletions). */
  size: number | null;
  /** How many merged pull requests the medians come from. */
  sample: number;
}

export type ChecksState = 'success' | 'failure' | 'pending';

export interface MyPull {
  repo: string;
  owner: string;
  name: string;
  ownerAvatarUrl: string;
  number: number;
  title: string;
  url: string;
  author: string | null;
  authorAvatarUrl: string | null;
  state: 'OPEN' | 'MERGED' | 'CLOSED';
  isDraft: boolean;
  createdAt: string;
  updatedAt: string;
  mergedAt: string | null;
  closedAt: string | null;
  additions: number;
  deletions: number;
  reviewDecision: 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED' | null;
  /** Open and in conflict with its base branch, so it can't be merged as it is. */
  conflicts: boolean;
  /** Comments in the conversation and on the code, plus reviews with a written summary. */
  comments: number;
  checks: ChecksState | null;
  /** When your review was requested, while it is still pending. */
  reviewRequestedAt: string | null;
  /** When someone other than the author first reviewed it. */
  firstReviewAt: string | null;
  /** Which of GitHub's searches found it; "all" holds every one. */
  roles: ('authored' | 'assigned' | 'involved' | 'review' | 'owned')[];
}

export interface MyPullsResponse {
  state: 'open' | 'closed';
  pulls: MyPull[];
  counts: Record<PullFilter, number>;
}

// A single pull request ---------------------------------------------------

export interface PullStage {
  kind: 'opened' | 'ready' | 'first-review' | 'changes' | 'approved' | 'merged' | 'closed';
  at: string;
  /** For a request for changes or an approval: who gave it. */
  login?: string;
  /** Hours since the previous stage. */
  hours: number | null;
}

export interface PullReviewer {
  login: string;
  avatarUrl: string | null;
  /** The latest state of this person's review, or PENDING if requested and not reviewed yet. */
  state: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'DISMISSED' | 'PENDING';
  reviews: number;
  requestedAt: string | null;
  firstReviewAt: string | null;
  /** Hours from the request (or opening) to this person's first review. */
  responseHours: number | null;
}

export interface PullCheck {
  name: string;
  conclusion: 'success' | 'failure' | 'pending' | 'skipped' | 'cancelled' | 'neutral';
  minutes: number | null;
  /** The run (or the status) on GitHub or the service that set it, when there is one. */
  url: string | null;
}

/** One stretch of a pull request's life, for "where the time went". */
export interface PullPhase {
  kind: 'draft' | 'waiting' | 'review' | 'approved';
  hours: number;
  /** Still going on: the pull request is open and in this stretch now. */
  ongoing: boolean;
}

/** One review by a person, placed on the pull request's life. */
export interface PullReviewMark {
  /** Hours after the pull request was opened. */
  hours: number;
  state: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'DISMISSED';
  login: string;
  at: string;
}

/** Lines changed under one folder. */
export interface PullFolder {
  path: string;
  additions: number;
  deletions: number;
  files: number;
}

/** A file or folder, and how many of a pull request's commits touched it. */
export interface ChurnEntry {
  path: string;
  /** For a file: where it is in the pull request's "Files changed" tab. */
  url?: string;
  commits: number;
  additions: number;
  deletions: number;
}

/** The files and folders a pull request's commits keep coming back to. */
export interface PullChurn {
  /** Commits looked at: every commit of the pull request but merge commits. */
  commits: number;
  merges: number;
  files: ChurnEntry[];
  folders: ChurnEntry[];
}

/** What happened on one day (or week) of the pull request's life. */
export interface PullActivityPoint {
  day: string;
  commits: number;
  reviews: number;
  comments: number;
}

export interface PullDetail {
  repo: string;
  number: number;
  title: string;
  url: string;
  author: string | null;
  authorAvatarUrl: string | null;
  state: 'OPEN' | 'MERGED' | 'CLOSED';
  isDraft: boolean;
  createdAt: string;
  mergedAt: string | null;
  closedAt: string | null;
  baseRef: string;
  headRef: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  commits: number;
  /** Comments in the conversation and on the code, plus reviews with a written summary. */
  comments: number;
  reviewThreads: number;
  participants: number;
  /**
   * The most involved people, those who approved first, then most active first, or null when not
   * everything could be counted.
   */
  involved: { login: string; avatarUrl: string; actions: number; approved: boolean }[] | null;
  stages: PullStage[];
  /** Hours from ready for review to the first review by a person, if any. */
  firstReviewHours: number | null;
  /** Open: hours so far. Merged: hours to merge. Closed: null. */
  ageHours: number | null;
  /** The whole life of the pull request, in order, split into stretches (a kind can come back). */
  phases: PullPhase[];
  reviewMarks: PullReviewMark[];
  /** Every time a person (not a team) was asked for a review, in order. */
  requestMarks: { hours: number; login: string; at: string }[];
  /** Every commit by the date written in it, or null when GitHub can't list them all. */
  commitMarks: { hours: number; login: string; at: string }[] | null;
  /**
   * Every comment in the conversation and on the code, in order, or null when some couldn't be
   * read; `bot` marks the ones written by apps.
   */
  commentMarks: { hours: number; login: string; at: string; bot?: true }[] | null;
  rounds: {
    changesRequested: number;
    forcePushes: number;
  };
  reviewers: PullReviewer[];
  checks: {
    state: ChecksState | null;
    list: PullCheck[];
    /** Longest check run on the latest commit, in minutes. */
    minutes: number | null;
    /** All check runs on the latest commit added up, in minutes. */
    totalMinutes: number | null;
  };
  /** Lines changed per folder, or null when GitHub can't list every file. */
  folders: PullFolder[] | null;
  /** Commits, reviews and comments over time, or null when any of them can't be listed in full. */
  activity: { unit: 'day' | 'week'; points: PullActivityPoint[] } | null;
  /** Open and in conflict with its base branch, so it can't be merged as it is. */
  conflicts: boolean;
  /** Who or what the pull request is waiting on, while it is open. */
  waitingOn: {
    kind: 'review' | 'author' | 'checks' | 'merge' | 'draft';
    who: string[];
    since: string | null;
  } | null;
}
