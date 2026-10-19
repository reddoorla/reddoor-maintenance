import type { Arm } from "../lib/arms.mjs";
import type { Collection } from "../lib/score.mjs";
export interface RepoClaim {
  id: string;
  claim: string;
  kind?: "behavior";
  evidence: string[];
  label: "confirmed" | "refuted" | "untested";
  shape: string;
  decides: { at: string; text: string }[];
  why: string;
}
export interface RepoData {
  note: string;
  pin: string;
  files: Record<string, { from: string; sha256: string }>;
  claims: RepoClaim[];
}
export interface Verdicts {
  verdicts: { id: string; verdict: string; raw?: string; downgraded?: boolean }[];
}
export interface Tally {
  misses: string[];
  wrongKills: string[];
  unconfirmed: string[];
  behaviour: string[];
  errors: string[];
}
export interface Tolerance {
  misses: number;
  wrongKills: number;
  unconfirmed: number;
  errorsOverProduction: number;
  missesOverProduction: number;
  minSpread: number;
}
export interface Config {
  config: string;
  runs: string[];
  errors: number;
  misses: number;
  cost: number | null;
  allPass: boolean;
  qualifies: boolean;
}
export interface Decision {
  perRun: (Tally & { id: string; config: string; cost: number | null; pass: boolean })[];
  ranked: Config[];
  spread: number;
  canRank: boolean;
  reasons: string[];
  lines?: string[];
}
export const id: string;
export const title: string;
export const row: number;
export const DATA_FILE: string;
export const DATA: RepoData;
export const sources: { from: string; match: RegExp; to: string }[];
export const secrets: string[];
export const collections: Collection[];
export const schema: Record<string, unknown>;
export const goldAddendum: string;
export const TOLERANCE: Readonly<Tolerance>;
export const PRODUCTION: Readonly<{ model: string; effort: string }>;
export const arms: Arm[];
export const gold: Arm;
export function claims(data?: RepoData): {
  id: string;
  claim: string;
  kind: "docs" | "behavior";
  evidence: string[];
}[];
export function items(
  dir: string,
): { id: string; prompt: string; schema: Record<string, unknown> }[];
export function prompt(dir: string): string;
export function assemble(outputs: Record<string, Record<string, unknown>>, dir: string): Verdicts;
export function verifyFiles(dir: string, files?: RepoData["files"]): void;
export function labels(data?: RepoData): Verdicts;
export function truth(dir: string): Verdicts;
export function tally(output: Verdicts | null, data?: RepoData): Tally;
export function passes(t: Tally, tol?: Tolerance): boolean;
export function decide(
  runs: {
    id: string;
    model: string;
    effort: string;
    output: Verdicts | null;
    cost: number | null;
  }[],
  referenceErrors?: { check: string }[],
  tol?: Tolerance,
  data?: RepoData,
): Decision;
export function decision(
  records: Record<string, { structured: unknown; cost: number | null }>,
  dir: string,
  referenceErrors?: { check: string }[],
): Decision;
