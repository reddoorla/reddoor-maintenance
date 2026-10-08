export const CONDUCTOR: string;
export const NIGHTLIES: { file: string; waitMinutes: number; inputs?: Record<string, string> }[];
export const GUARD_HOURS: number;
export const POLL_SECONDS: number;
export const FETCH_TIMEOUT_MS: number;
export const DISPATCHER: string;
export const CLOCK_UTC: string;

export interface Options {
  only: string[];
  ref: string;
  force: boolean;
}

export type FetchLike = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body?: string | undefined;
    signal?: AbortSignal;
  },
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

export type Api = (method: string, path: string, body?: unknown) => Promise<unknown>;

export interface Result {
  file: string;
  outcome: "completed" | "wait-exceeded" | "dispatch-failed" | "skipped";
  conclusion?: string;
  id?: number;
}

export function clockDeadline(ms: number): number;
export function parseOnly(raw: string | undefined): string[];
export function parseArgs(argv: string[]): Options;
export function alreadyConducted(
  api: Api,
  file: string,
  o: { now: number },
): Promise<{ id: number; created_at: string } | null>;
export function conduct(o: {
  fetch: FetchLike;
  token: string;
  repo: string;
  only: string[];
  ref: string;
  force: boolean;
  event: string;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  log?: (line: string) => void;
}): Promise<{ skipped: boolean; results: Result[]; code: number }>;
