import type { Arm } from "../lib/arms.mjs";
import type { Collection } from "../lib/score.mjs";
export const id: string;
export const title: string;
export const row: number;
export const KEY_FILE: string;
export const SEEDED_FILE: string;
export const CLAIMS: [string, string[]][];
export const PAGES: Record<string, string>;
export const sources: { from: string; match: RegExp; to: string }[];
export const collections: Collection[];
export const schema: Record<string, unknown>;
export const goldAddendum: string;
export const arms: Arm[];
export const gold: Arm;
export const SHIP_LINE: number;
export interface Claim {
  id: string;
  claim: string;
  kind: "docs" | "behavior";
  evidence: string[];
}
export interface Key {
  expected: Record<string, { verdict: string }>;
}
export interface Tally {
  falseClaims: number;
  catches: number;
  missed: string[];
  trueClaims: number;
  wrongRefutations: number;
  wrong: string[];
  unconfirmed: string[];
  behavior: string | null;
  noVerdict: string[];
  downgraded: string[];
}
export function claims(seeded?: unknown[]): Claim[];
export function prompt(dir: string): string;
export function verifyPages(dir: string, pages?: Record<string, string>): void;
export function labels(key?: Key): { verdicts: { id: string; verdict: string }[] };
export function truth(dir: string): { verdicts: { id: string; verdict: string }[] };
export function tally(output: unknown, dir: string, key?: Key): Tally;
export function passes(t: Tally): boolean;
