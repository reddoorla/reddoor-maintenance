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
  noChecksRetries: number;
  noChecksIntervalMs: number;
  freshHeadMaxAgeMs: number;
  noChecksFreshRetries: number;
  settleRetries: number;
  settleIntervalMs: number;
  mergeVerifyRetries: number;
  mergeVerifyIntervalMs: number;
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

export const VIEW_FIELDS: string;
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
export function isWorktreeNoise(text: string): boolean;
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

export function landPrs(opts: LandOptions): Promise<{ code: number; results: LandResult[] }>;
