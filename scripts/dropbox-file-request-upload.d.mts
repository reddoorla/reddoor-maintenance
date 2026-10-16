export const BATCH: number;
export const MAX_BATCH_BYTES: number;
export const USAGE: string;
export const VERIFY: string;

export interface Options {
  url: string;
  name: string;
  files: string[];
  dryRun: boolean;
}

export interface Row {
  file: string;
  size: number;
  contentHash: string;
  uploadedAs: string;
  renameTo: string;
}

export function parseArgs(argv: string[], env?: Record<string, string | undefined>): Options;
export function uploadedName(name: string, file: string): string;
export function batches<T>(items: T[], n?: number, max?: number): T[][];
export function timeoutMs(bytes: number): number;
export function plan(files: string[], name: string, max?: number): Row[];
export function table(rows: Row[]): string;
export function commitComplete(status: number, text: string): boolean;
export function commitName(url: string): string | null;

export interface Verdict {
  row: Row;
  ok: boolean;
  why: string;
}

export function verdicts(
  rows: Row[],
  committed: Map<string, { status: number; text: string }>,
): Verdict[];
export function afterError(
  rows: Row[],
  committed: Map<string, { status: number; text: string }>,
  message: string,
): Verdict[];
export function squash(s: string): string;
export function exitCode(results: Verdict[]): number;
