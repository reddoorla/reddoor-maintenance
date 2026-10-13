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
export const ANSWER_MARKERS: RegExp[];

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
  | { n: number; line: number; title: string; name: string; text: string; error?: undefined }
  | { n: number; line: number; title: string; error: string; name?: undefined; text?: undefined };

export interface ConvertResult {
  rev: string;
  revSha: string;
  items: number;
  answered: { n: number; marker: string }[];
  converted: Converted[];
  unparsed: Converted[];
}

export function parseArgs(argv: string[]): Options;
export function parseDecision(name: string, text: string): Decision;
export function readDecisionDir(dir: string): Decision[];
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
export function answerMarker(text: string): string | null;
export function itemTitle(text: string): string;
export function itemAsk(text: string): string | null;
export function itemLead(text: string): string;
export function dedent(text: string): string;
export function slugify(n: number, title: string): string;
export function extractRefs(text: string): string[];
export function originNeedle(head: string): string;
export function convertItem(it: BacklogItem, origin: Origin | null, revSha: string): Converted;
export function convertBacklog(
  o: { rev: string },
  deps?: { run?: Runner; cwd?: string },
): Promise<ConvertResult>;
export function formatConvert(c: ConvertResult): string;
