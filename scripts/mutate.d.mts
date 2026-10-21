import type { RunResult } from "./land-prs.mjs";

export const DEFAULT_TIMEOUT_MS: number;
export const TIMEOUT_MARK: string;

export interface Options {
  sidecar: string;
  only: string[] | undefined;
  inPlace: boolean;
  check: boolean;
  timeoutMs: number;
  json: boolean;
}

export interface Edit {
  file: string;
  find: string;
  replace: string;
}

export interface Mutant {
  id: string;
  edits: Edit[];
  test: string[];
  build: boolean;
  syntax: boolean;
  expect: "red" | "survives";
  why: string | undefined;
}

export type Result = "red" | "survived" | "stillborn";

export interface Classified {
  result: Result;
  failed?: number;
  passed?: number;
  skipped?: number;
  timeouts?: number;
  reason: string;
}

export interface MutantResult {
  id: string;
  expect: "red" | "survives";
  result: Result;
  failed: number | undefined;
  passed: number | undefined;
  skipped: number | undefined;
  timeouts: number | undefined;
  reason: string;
  test: string[];
  build: boolean;
  why: string | undefined;
  ok: boolean;
}

export interface Report {
  sha: string;
  mode: "worktree" | "in-place" | "check";
  command: string;
  sidecar: string;
  planned: number;
  unparsed?: string[];
  results: MutantResult[];
}

export type Runner = ((
  cmd: string,
  args: string[],
  opts?: { cwd?: string; timeoutMs?: number; env?: NodeJS.ProcessEnv },
) => Promise<RunResult & { timedOut?: boolean }>) & { active?: Set<unknown> };

export class Refusal extends Error {}

export function parseArgs(argv: string[]): Options;
export function validateSidecar(raw: unknown): Mutant[];
export function countMatches(text: string, find: string): number;
export function applyEdits(
  texts: Map<string, string>,
  mutant: Pick<Mutant, "id" | "edits">,
): Map<string, string>;
export function classifyRun(r: { timedOut?: boolean; report: unknown; code: number }): Classified;
export function syntaxError(a: {
  file: string;
  text: string;
  root: string;
  run: Runner;
}): Promise<string | null>;
export function asExpected(expect: string, result: string): boolean;
export function makeRunner(active?: Set<unknown>): Runner & { active: Set<unknown> };
export function mutate(
  o: Options,
  deps?: {
    run?: Runner;
    cwd?: string;
    log?: (s: string) => void;
    process?: Pick<NodeJS.Process, "on" | "off" | "exit">;
    tmpdir?: string;
    writeOut?: (text: string) => void;
  },
): Promise<Report>;
export function formatReport(rep: Report): string;
