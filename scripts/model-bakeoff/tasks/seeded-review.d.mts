import type { Arm } from "../lib/arms.mjs";
export const id: string;
export const title: string;
export const row: number;
export const sources: { from: string; match: RegExp; to: string }[];
export const collections: never[];
export const schema: Record<string, unknown>;
export const goldAddendum: string;
export const arms: Arm[];
export const gold: Arm;
export const NEAR_LINES: number;
export interface Tolerance {
  comparator: string;
  foundSlackPerRun: number;
  falsePositiveSlackPerRun: number;
  criticalMisses: number;
}
export const TOLERANCE: Readonly<Tolerance>;
export interface Defect {
  id: string;
  case: string;
  file: string;
  ranges: [number, number][];
  critical: boolean;
  description: string;
}
export interface Reference {
  cases?: string[];
  excluded?: { id: string; reason: string }[];
  defects: Defect[];
  controls: { case: string; file: string }[];
}
export interface Finding {
  case?: unknown;
  file?: unknown;
  startLine?: unknown;
  endLine?: unknown;
  severity?: unknown;
  summary?: unknown;
}
export interface Check {
  collection: string;
  key: string;
  field: string;
  check: string;
  ok: boolean;
  armKey: string;
  refKey: string;
  armRaw: string;
  refRaw: string;
  mechanical?: boolean;
}
export interface Ruling {
  id: string;
  armCorrect: boolean;
  refCorrect: boolean;
  note?: string;
}
export interface RunSummary {
  found: number;
  of: number;
  missed: string[];
  criticalFound: number;
  criticalOf: number;
  criticalMissed: string[];
  controlFindings: number;
  falsePositives: number;
  realOnControls: number;
  otherFindings: number;
  unruled: number;
  disputedDefects: string[];
  upheldDefects: string[];
  noOutput: boolean;
  split?: number;
}
export interface Group {
  runs: number;
  found: number;
  of: number;
  criticalMissed: number;
  falsePositives: number;
  unruled: number;
  split: number;
  noOutput: number;
  verdict: string;
  reasons?: string[];
}
export function prompt(dir: string): string;
export function truth(dir: string): Reference;
export function sameFile(a: unknown, b: unknown): boolean;
export function span(f: Finding): [number, number] | null;
export function relation(f: Finding, d: Defect): "overlap" | "near" | null;
export function closestDefect(f: Finding, defects: Defect[]): Defect | null;
export function scoreRun(task: unknown, reference: Reference, output: unknown): Check[];
export function referenceFaults(): string[];
export function extraCandidates(): Record<string, never>;
export function runSummary(
  reference: Reference,
  checks: Check[],
  rulings: Record<string, Ruling>,
  output: unknown,
  refuted?: Set<string>,
): RunSummary;
export function groupOf(armId: string): string;
export function decide(
  perRun: Record<string, RunSummary>,
  tolerance?: Tolerance,
): Record<string, Group>;
export function summarize(input: {
  reference: Reference;
  checksByArm: Record<string, Check[]>;
  rulings: Record<string, Ruling>;
  outputs: Record<string, unknown>;
  arms?: (string | { id: string })[];
}): {
  tolerance: Tolerance;
  excluded: { id: string; reason: string }[];
  refutedDefects: string[];
  splitDefects: string[];
  perRun: Record<string, RunSummary>;
  groups: Record<string, Group>;
  gold?: RunSummary;
};
export function formatSummary(s: ReturnType<typeof summarize>): string;
