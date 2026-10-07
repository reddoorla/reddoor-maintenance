export const LA: string;
export const PM_PASS: string;
export const SCHEDULE_HEADING: string;
export const FIRST_COVERED: string;
export const KNOWN_GOOD: { at: string; minute: number; hours: number[] };
export const WINDOW_HOURS: number;
export const PASSES: string[];
export const MARKERS: { morning: RegExp; second: RegExp };
export const FROM: string;
export const RESEND_URL: string;

export type Pass = "morning" | "second";

export interface Options {
  ref: string;
  date: string | undefined;
  pass: Pass | "both";
  now: string | undefined;
  dryRun: boolean;
  testSend: boolean;
}

export interface Schedule {
  zone: string;
  minute: number;
  hours: [number, number];
  days: Set<number>;
  cron: string;
}

export interface GitResult {
  code: number;
  stdout: string;
  stderr: string;
}
export type Git = (args: string[]) => GitResult;

export interface Slot {
  date: string;
  pass: Pass;
  schedule: string;
  read: string;
  due: string;
  verdict: "ran" | "missed" | "not-covered" | "not-due" | "blind" | "no-pass";
  reason: string;
  dueSha?: string;
  dueMs?: number;
}

export interface Email {
  key: string;
  subject: string;
  text: string;
}

export interface SentEmail extends Email {
  status: "sent" | "already-sent";
}

export interface FetchLike {
  (
    url: string,
    init: { method: string; headers: Record<string, string>; body: string },
  ): Promise<{
    ok: boolean;
    status: number;
    text(): Promise<string>;
  }>;
}

export interface WatchDeps {
  env?: Record<string, string | undefined>;
  git?: Git;
  cwd?: string;
  now?: number;
  fetch?: FetchLike;
}

export interface WatchResult {
  code: number;
  lines: string[];
  sent: SentEmail[];
  slots: Slot[];
  verified?: boolean;
}

export function parseArgs(argv: string[]): Options;
export function scheduleLine(text: string | null): string | null;
export function parseSchedule(line: string | null): Schedule | null;
export function zonedToUtc(date: string, hour: number, minute: number, zone: string): number;
export function localDate(ms: number, zone?: string): string;
export function weekday(date: string): number;
export function dueAt(date: string, pass: Pass, sched: Schedule): number;
export function realGit(cwd: string): Git;
export function blindCheck(git: Git, ref: string): string | null;
export function evaluateSlot(git: Git, ref: string, date: string, pass: Pass, now: number): Slot;
export function formatSlot(s: Slot): string;
export function planSlots(
  o: Options,
  now: number,
): { dates: string[]; passes: Pass[]; windowed: boolean; earliest?: string };
export function missedEmail(s: Slot): Email;
export function blindEmail(today: string, reasons: string[]): Email;
export function testEmail(today: string, runId?: string): Email;
export function sendEmail(
  email: Email,
  opts: { apiKey: string; to: string; fetchImpl?: FetchLike },
): Promise<"sent" | "already-sent">;
export function watch(o: Options, deps?: WatchDeps): Promise<WatchResult>;
