import type { RunResult, Runner } from "./land-prs.mjs";

export type { RunResult, Runner };

export const DECISIONS_HEADING: string;
export const ASK_PATTERN: RegExp;

export interface Options {
  repo: string | undefined;
  base: string;
  minAgeHours: number;
  freshHours: number;
  sinceDays: number;
  mainSince: string | undefined;
  fetch: boolean;
  json: boolean;
}

export interface AddedLine {
  line: number;
  text: string;
}

export interface Decisions {
  onlyOnBranch: AddedLine[];
  alreadyOnMain: AddedLine[];
}

export interface PrLike {
  number: number;
  state: string;
  draft?: boolean;
  merged_at?: string | null;
  head?: { sha?: string };
}

export type Coverage =
  | { kind: "open"; pr: number; draft: boolean }
  | { kind: "merged" | "after-merge" | "closed"; pr: number }
  | { kind: "none" };

export interface BranchInput {
  tipTime: number;
  ahead: number;
  coverage: Coverage;
  decisions: Decisions;
}

export interface Classification {
  ageHours: number;
  fresh: boolean;
  stale: boolean;
  question: boolean;
  ask: boolean;
}

export interface BranchResult extends BranchInput, Classification {
  namedOnMain: boolean;
  ref: string;
  branch: string;
  sha: string;
  subject: string;
}

export interface Report {
  repo: string | undefined;
  base: string;
  now: string;
  minAgeHours: number;
  freshHours: number;
  sinceDays: number;
  scanned: number;
  olderSkipped: number;
  branches: BranchResult[];
  mainDecisions: { since: string; rev: string; lines: AddedLine[] } | null;
}

export function parseArgs(argv: string[]): Options;
export function sectionRange(text: string, heading?: string): { start: number; end: number } | null;
export function addedLines(diffU0: string): AddedLine[];
export function decisionLines(branchText: string, diffU0: string, mainText: string): Decisions;
export function namedInSection(text: string, branch: string): boolean;
export function prCoverage(prs: PrLike[], tipSha: string): Coverage;
export function classify(
  b: BranchInput,
  opts: { now: number; minAgeHours: number; freshHours: number },
): Classification;
export function eveningBranches(
  o: Options,
  deps?: { run?: Runner; cwd?: string; now?: number },
): Promise<Report>;
export function formatReport(rep: Report): string;
