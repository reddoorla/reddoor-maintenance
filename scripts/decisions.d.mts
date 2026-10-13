import type { RunResult, Runner } from "./land-prs.mjs";

export type { RunResult, Runner };

export const STATUSES: string[];
export const FIELDS: string[];
export const NAME_PATTERN: RegExp;
export const ASKED_PATTERN: RegExp;
export const SESSION_URL: RegExp;
export const REF_PATTERN: RegExp;
export const DEFAULT_OWNER: string;
export const HOME_REPO: string;
export const STATUS_MARKERS: RegExp[];
export const HEAD_MARKERS: RegExp[];
export const PROSE_MARKERS: RegExp[];
export const STILL_OPEN: RegExp;
export const FUTURE_SLACK_MS: number;
export const IGNORED_ENTRIES: string[];

export interface Options {
  cmd: "check" | "list" | "new" | "convert";
  dir: string;
  slug: string | undefined;
  open: boolean;
  parked: boolean;
  since: string | undefined;
  offline: boolean;
  json: boolean;
  from: string | undefined;
  rev: string;
}

export type RefState =
  | { ref: string; kind: "ok" | "issue" }
  | { ref: string; kind: "stale"; event: "merged" | "closed"; at: string }
  | { ref: string; kind: "unchecked"; why: string };

export interface Decision {
  file: string;
  slug: string | undefined;
  status: string | undefined;
  asked: string | undefined;
  from: string | undefined;
  refs: string[];
  ask: string | undefined;
  errors: string[];
  ageHours?: number;
  refStates?: RefState[];
}

export interface Counts {
  parsed: number;
  errors: number;
  open: number;
  parked: number;
  unchecked: number;
}

export interface Report {
  dir: string;
  now: string;
  counts: Counts;
  ok: boolean;
  failed: Decision[];
  dirError?: string;
  decisions: Decision[];
}

export interface BacklogItem {
  n: number;
  line: number;
  head: string;
  body: string[];
  text: string;
}

export interface Origin {
  sha: string;
  time: number;
  subject: string;
}

export type Converted =
  | {
      n: number;
      line: number;
      title: string;
      name: string;
      text: string;
      error?: undefined;
      ambiguous?: string;
      originsDisagree?: string[];
      droppedRefs?: string[];
    }
  | {
      n: number;
      line: number;
      title: string;
      error: string;
      name?: undefined;
      text?: undefined;
      ambiguous?: string;
      originsDisagree?: string[];
      droppedRefs?: undefined;
    };

export interface ConvertResult {
  rev: string;
  revSha: string;
  items: number;
  answered: { n: number; marker: string }[];
  converted: Converted[];
  unparsed: Converted[];
  duplicates: { n: number; lines: number[] }[];
}

export function parseArgs(argv: string[]): Options;
export function calendarValid(v: string): boolean;
export function parseDecision(name: string, text: string, now?: number): Decision;
export function readDecisionDir(dir: string, now?: number): Decision[];
export function refState(ref: string, asked: string, run: Runner): Promise<RefState>;
export function decisionsReport(
  o: { dir: string; offline?: boolean },
  deps?: { run?: Runner; now?: number; decisions?: Decision[] },
): Promise<Report>;
export function selectListed(
  rep: Report,
  o: { open?: boolean; parked?: boolean; since?: string },
): Decision[];
export function summaryLine(c: Counts): string;
export function formatCheck(rep: Report): string;
export function formatList(
  rep: Report,
  o: { open?: boolean; parked?: boolean; since?: string },
): string;
export function sessionUrl(id: string | undefined): string | undefined;
export function stamp(ms: number): { asked: string; prefix: string };
export function newDecision(o: { slug: string; from: string; now: number }): {
  name: string;
  text: string;
};
export function backlogItems(text: string): BacklogItem[];
export function classifyItem(text: string): {
  kind: "answered" | "ambiguous" | "open";
  marker: string | null;
};
export function itemTitle(text: string): string;
export function itemAsk(text: string): string | null;
export function itemLead(text: string): string;
export function dedent(text: string): string;
export function slugify(n: number, title: string): string;
export function knownRepos(text: string): Set<string>;
export function extractRefs(
  text: string,
  known?: Set<string>,
): { refs: string[]; dropped: string[] };
export function originNeedles(text: string): string[];
export function convertItem(
  it: BacklogItem,
  origin: Origin | null,
  revSha: string,
  known?: Set<string>,
): Converted;
export function convertBacklog(
  o: { rev: string },
  deps?: { run?: Runner; cwd?: string },
): Promise<ConvertResult>;
export function formatConvert(c: ConvertResult): string;
