export const CONDUCTOR: string;
export const NIGHTLIES: { file: string; waitMinutes: number }[];
export const GUARD_HOURS: number;
export const POLL_SECONDS: number;

export interface Options {
  only: string[];
  ref: string;
  force: boolean;
}

export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

export type Api = (method: string, path: string, body?: unknown) => Promise<unknown>;

export interface Result {
  file: string;
  outcome: "completed" | "wait-exceeded" | "dispatch-failed";
  conclusion?: string;
  id?: number;
}

export function parseOnly(raw: string | undefined): string[];
export function parseArgs(argv: string[]): Options;
export function priorSuccess(
  api: Api,
  o: { now: number; runId: string },
): Promise<{ id: number; event: string; created_at: string } | null>;
export function conduct(o: {
  fetch: FetchLike;
  token: string;
  repo: string;
  runId: string;
  only: string[];
  ref: string;
  force: boolean;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  log?: (line: string) => void;
}): Promise<{ skipped: boolean; results: Result[]; code: number }>;
