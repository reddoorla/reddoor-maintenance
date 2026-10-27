export type LedgerRow = Record<string, string | number>;
export interface SessionRef {
  id: string;
  created_at?: string;
  environment?: string;
}
export interface McpCall {
  tool: string;
  input: Record<string, unknown>;
  payload: Record<string, unknown> | null;
  file: string;
}
export interface Transcripts {
  main: string;
  agents: { id: string; meta: { agentType?: string; effort?: string }; text: string }[];
}
export const COLUMNS: readonly string[];
export const SESSION_COLUMNS: readonly string[];
export function lastResult(events: unknown[]): { created_at: string; result: unknown } | null;
export interface Run {
  from: string;
  fromTotal: number | undefined;
  end: { created_at: string; result: unknown };
}
export function cmpTime(a: string | undefined, b: string | undefined): number;
export function sessionUsage(
  events: unknown[],
): { runs: Run[]; segments: number; total: number; as_of: string; last: unknown } | null;
export function modelUsageRows(
  session: SessionRef,
  ev: unknown,
  run?: { from: string; fromTotal?: number },
): LedgerRow[];
export function transcriptRows(session: SessionRef, t: Transcripts, as_of?: string): LedgerRow[];
export function assistantEventRows(session: SessionRef, events: unknown[]): LedgerRow[];
export function transcriptId(
  uuid: string,
  env: Record<string, string | undefined>,
  opts?: { id?: string; all?: boolean },
): string;
export function readSessionTranscripts(dir: string, cliSessionId: string): Transcripts;
export function ccrPayload(text: string): unknown;
export function mcpCalls(root: string): McpCall[];
export function backfill(calls: McpCall[]): { rows: LedgerRow[]; sessions: LedgerRow[] };
export function mergeRows(stored: LedgerRow[], incoming: LedgerRow[]): LedgerRow[];
export function mergeSessions(stored: LedgerRow[], incoming: LedgerRow[]): LedgerRow[];
export function finalize(
  rows: LedgerRow[],
  sessions: LedgerRow[],
): { rows: LedgerRow[]; sessions: LedgerRow[] };
export function reconcile(
  rows: LedgerRow[],
  sessions: LedgerRow[],
): {
  sessions: number;
  mismatches: { session_id: string; run: string; rows: number; total: number }[];
};
export function listedSessions(calls: McpCall[]): Record<string, unknown>[];
export function staleSessions(listed: unknown[], stored: LedgerRow[]): string[];
export function toCsv(rows: LedgerRow[], columns: readonly string[]): string;
export function parseCsv(text: string): LedgerRow[];
