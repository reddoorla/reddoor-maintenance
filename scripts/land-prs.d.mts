// Hand-written types for land-prs.mjs. The script stays plain JS so it runs with bare
// `node` and no build step; this file is only so `tsc --noEmit` can type the test's import.

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
  timedOut?: boolean;
}

export interface RunOptions {
  cwd?: string | undefined;
  timeoutMs?: number | undefined;
}

export type Runner = (cmd: string, args: string[], opts?: RunOptions) => Promise<RunResult>;

export interface Timing {
  afterUpdateSleepMs: number;
  headPollIntervalMs: number;
  headPollMaxMs: number;
  maxCheckRounds: number;
  checksPollIntervalMs: number;
  noChecksRetries: number;
  noChecksIntervalMs: number;
  freshHeadMaxAgeMs: number;
  noChecksFreshRetries: number;
  settleRetries: number;
  settleIntervalMs: number;
  mergeVerifyRetries: number;
  mergeVerifyIntervalMs: number;
  branchGoneRetries: number;
  branchGoneIntervalMs: number;
}

export interface LandOptions {
  prs: number[];
  repo: string;
  dryRun?: boolean;
  cleanup?: boolean;
  checksTimeoutMin?: number;
  base?: string;
  run?: Runner;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  log?: (line: string) => void;
  cwd?: string;
  timing?: Partial<Timing>;
}

export interface LandResult {
  pr: number;
  status: "merged" | "skipped" | "stopped" | "dry-run";
  reason?: string;
  mergeCommit?: string;
  head?: string;
}

export const DEFAULT_TIMING: Timing;

export function parseArgs(argv: string[]): {
  prs: number[];
  repo: string | undefined;
  dryRun: boolean;
  cleanup: boolean;
  checksTimeoutMin: number;
  base: string;
};
export const realRunner: Runner;
export function realSleep(ms: number): Promise<void>;
export function isReleasePr(pr: { title?: string; headRefName?: string }): boolean;
export function parseWorktreeList(porcelain: string): Array<{
  path: string;
  head: string;
  branch: string;
  detached: boolean;
  bare: boolean;
}>;
/** Why a `gh` call failed, in a form that is never the empty string. */
export function ghFailureDetail(r: {
  code: number;
  stdout: string;
  stderr: string;
  timedOut?: boolean;
}): string;

/** How many "no checks reported" rounds to tolerate, from the head's age. */
export function noChecksRetriesFor(
  committedAtMs: number,
  nowMs: number,
  t: Pick<Timing, "noChecksRetries" | "noChecksFreshRetries" | "freshHeadMaxAgeMs">,
): number;

/** Empty string when the PR may be landed; otherwise why it may not. */
export function refusal(
  pr: {
    state?: string;
    isDraft?: boolean;
    baseRefName?: string;
    headRefName?: string;
    title?: string;
    mergeStateStatus?: string;
  },
  allowedBase?: string,
): string;

export interface Pr {
  number: number;
  title: string;
  state: string;
  isDraft: boolean;
  baseRefName: string;
  headRefName: string;
  headRefOid: string;
  mergeStateStatus: string;
  mergeCommit: { oid: string } | null;
  sameRepo: boolean;
}

/** A REST pull request (`GET repos/{o}/{r}/pulls/{n}`) in the shape the gates read. */
export function prFromRest(p: Record<string, unknown>): Pr;

export type CheckBucket = "pass" | "fail" | "pending" | "skipping" | "cancel";

/** The bucket `gh pr checks` puts a check run's conclusion/status or a commit status in. */
export function checkBucket(state: string | null | undefined): CheckBucket;

export function checksFromRest(
  checkRuns: Array<{ name: string; status: string; conclusion: string | null }>,
  statuses: Array<{ context: string; state: string }>,
): Array<{ name: string; bucket: CheckBucket }>;

/** `owner/repo` from a git remote URL, or "" when it names none. */
export function repoFromRemoteUrl(url: string): string;

export function resolveRepo(opts?: {
  run?: Runner;
  cwd?: string;
}): Promise<{ repo: string; error?: undefined } | { repo?: undefined; error: string }>;

export function landPrs(opts: LandOptions): Promise<{ code: number; results: LandResult[] }>;
