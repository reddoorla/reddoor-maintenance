import type { Arm } from "../lib/arms.mjs";
import type { Collection } from "../lib/score.mjs";
export const id: string;
export const title: string;
export const row: number;
export const sources: { from: string; match: RegExp; to: string }[];
export const collections: Collection[];
export const schema: Record<string, unknown>;
export const goldAddendum: string;
export const arms: Arm[];
export const gold: Arm;
export const UPDATE: string[];
export const INSTALL: string[];
export const CHECKS: string[];
export const LOCKFILE: string;
export interface Dep {
  name: string;
  specifier: string;
  version: string;
}
export interface Facts {
  packages: Dep[];
  disk: { name: string; deps: string[]; packages: string[] }[];
}
export function prompt(dir: string): string;
export function lockfileFacts(text: string): Facts;
export function runChecks(run: (args: string[]) => number): { pass: boolean; failed: string[] };
export interface CheckItem {
  name: string;
  failed: boolean;
  exitFailed: boolean;
}
export function checkItems(failed: string[]): CheckItem[];
export function exitCodes(work: string): Record<string, string>;
export function truth(dir: string, opts?: { into?: string }): Facts & { checks: CheckItem[] };
export function observe(
  work: string,
  structured: unknown,
): (Facts & { checks: CheckItem[] }) | null;
export function snapshot(opts: { repo: string; commit: string; out: string }): {
  takenAt: string;
  commit: string;
};
