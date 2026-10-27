import type { Arm } from "../lib/arms.mjs";
import type { Collection } from "../lib/score.mjs";
export const id: string;
export const title: string;
export const row: number;
export const PIN: string;
export const IMPL: string;
export const HELD_OUT_FILE: string;
export const ALLOWED: string[];
export const HELD_OUT: string[];
export const PLAN: string;
export const sources: { from: string; match: RegExp; to: string }[];
export const collections: Collection[];
export const kinds: Record<string, (value: unknown) => string>;
export const schema: Record<string, unknown>;
export const goldAddendum: string;
export const arms: Arm[];
export const gold: Arm;
export function prompt(dir: string): string;
export function scopeCheck(
  changed: string[],
  allowed?: string[],
): { pass: boolean; outside: string[] };
export function heldOutResults(
  report: unknown,
  names?: string[],
): { name: string; pass: boolean; result: string; mechanical?: boolean }[];
export function refereeEvidence(result: string, repo: string, testFile: string): string;
export function truth(): {
  gates: { gate: string; pass: boolean }[];
  tests: { name: string; pass: boolean; result: string }[];
};
export function setup(o: { input: string; work: string; ids: string[]; root?: string }): void;
export function changedFiles(base: string, tree: string): string[];
export function evaluate(o: { run: string; work: string; id: string }): Record<string, unknown>;
export const GATES: string[];
export function ownTestsPass(report: unknown): boolean;
export function run(
  cwd: string,
  cmd: string,
  args: string[],
  timeout?: number,
): { status: number | null; error?: string; stdout: string; stderr: string };
export function install(
  cwd: string,
  store?: string,
): { status: number | null; error?: string; stdout: string; stderr: string };
export function pnpmConfigEnv(dir: string): Record<string, string>;
export function snapshot(root: string, sha: string, to: string): void;
export function observe(
  work: string,
  structured?: unknown,
  agent?: unknown,
): Record<string, unknown>;
export function evaluationKey(
  structured: unknown,
  agent?: { transcript?: string },
  moduleSha?: string,
): string | null;
export function cachedEvaluation(
  runDir: string,
  id: string,
  key: string | null,
  compute: () => unknown,
): unknown;
export function ownTestsGate(
  ownRun: { status: number | null; error?: string } | null,
  report: unknown,
): boolean;
export function readReport(file: string): unknown;
export function changedOrFlood(
  base: string,
  tree: string,
  list?: (base: string, tree: string) => string[],
): string[];
export function copyPlanFiles(repo: string, to: string, files?: string[]): void;
export function scoreRuns(o: {
  changed: string[];
  scope: { pass: boolean; outside: string[] };
  check: { status: number | null; error?: string; stdout: string; stderr: string };
  lint: { status: number | null; error?: string; stdout: string; stderr: string };
  suite: { status: number | null; error?: string; stdout: string; stderr: string };
  ownRun: { status: number | null; error?: string } | null;
  ownReport: unknown;
  heldRun: { status: number | null; error?: string };
  report: unknown;
  held: string;
}): {
  gates: { gate: string; pass: boolean }[];
  tests: { name: string; pass: boolean; result: string; mechanical?: boolean }[];
  detail: Record<string, unknown>;
};
