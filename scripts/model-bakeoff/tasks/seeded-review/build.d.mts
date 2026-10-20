export function caseFiles(c: { case: string; path: string }): { diff: string; after: string };
export function cleanDiff(text: string): string;
export const DIFF_ARGS: readonly string[];
export function buildCases(
  dir: string,
  key?: unknown,
  repo?: string,
): { case: string; kind: string; commit: string; path: string }[];
export function haveHistory(key?: unknown): boolean;
