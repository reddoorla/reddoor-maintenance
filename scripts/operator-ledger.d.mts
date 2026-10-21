import type { RunResult, Runner } from "./land-prs.mjs";

export type { RunResult, Runner };

export const TZ: string;
export const FIX_WINDOW_MS: number;
export const RELEASE_TITLE: RegExp;
export const FIX_TITLE: RegExp;
export const REVERT_TITLE: RegExp;
export const REVIEW_STOP_SLUG: RegExp;
export const FIXES_PHRASE: RegExp;

export interface Options {
  home: string;
  week: string | undefined;
  rev: string;
  repo: string;
  json: boolean;
}

export interface Window {
  start: number;
  end: number;
  startDate: string;
  endDate: string;
}

export interface AskEvent {
  at: number;
  status: string;
}

export interface AskTimeline {
  file: string;
  slug: string | undefined;
  asked: number | undefined;
  refs: string[];
  errors?: string[];
  historyErrors?: { at: number; error: string }[];
  events: AskEvent[];
}

export interface AskLedger {
  open: { file: string; asked: number; refs: string[]; ageMs: number }[];
  answered: { file: string; latencyMs: number }[];
  atBirth: string[];
  born: { file: string; kind: string }[];
  unparsed: string[];
  unreadable: string[];
  backfilled: string[];
  medianMs: number | null;
  p90Ms: number | null;
  bornByKind: Record<string, number>;
}

export interface PrLike {
  number: number;
  title?: string;
  body?: string | null;
  created_at: string;
  updated_at?: string;
  closed_at?: string | null;
  merged_at?: string | null;
  user?: { type?: string };
}

export interface PrLedger {
  releaseOpen: { number: number; waitMs: number }[];
  releaseMerged: { number: number; waitMs: number }[];
  fixOfFix: { number: number; of: number[] }[];
  reverts: number[];
}

export interface Ledger extends Window {
  week: string;
  rev: string;
  sha: string;
  revAt: number;
  firstAskAt: number | null;
  repo: string;
  asks: AskLedger;
  stale: { stale: string[]; unchecked: string[] };
  prs: PrLedger;
}

export function parseArgs(argv: string[]): Options;
export function ptParts(ms: number): {
  y: number;
  m: number;
  d: number;
  h: number;
  mi: number;
  weekday: string;
};
export function ptMidnight(y: number, m: number, d: number): number;
export function weekWindow(week: string): Window;
export function defaultWeek(now: number): string;
export function askKind(slug: string | undefined): string;
export function askTimelines(
  home: string,
  rev: string,
  run?: Runner,
): Promise<{ sha: string; revAt: number; asks: AskTimeline[] }>;
export function median(sorted: number[]): number | null;
export function p90(sorted: number[]): number | null;
export function askLedger(asks: AskTimeline[], win: { start: number; end: number }): AskLedger;
export function staleAsks(
  open: { file: string; asked: number; refs: string[] }[],
  end: number,
  run?: Runner,
): Promise<{ stale: string[]; unchecked: string[] }>;
export function fetchPrs(
  repo: string,
  since: number,
  run?: Runner,
  perPage?: number,
): Promise<PrLike[]>;
export function namedPrs(pr: PrLike, repo: string): number[];
export function prLedger(
  prs: PrLike[],
  win: { start: number; end: number },
  repo: string,
): PrLedger;
export function ledger(
  o: Options,
  deps?: { run?: Runner; now?: number; perPage?: number },
): Promise<Ledger>;
export function formatLedger(l: Ledger): string;
