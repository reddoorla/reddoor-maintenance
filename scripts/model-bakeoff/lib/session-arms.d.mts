export interface SessionArm {
  id: string;
  model: string;
}
export interface Check {
  check: string;
  ok: boolean;
  got: unknown;
  want: unknown;
}
export interface SessionTask {
  id: string;
  title: string;
  arms: SessionArm[];
  checkCount: number;
  prompt(): string;
  truth(): unknown;
  check(out: unknown, truth: unknown): Check[];
}
export interface Call {
  tool: string;
  input: Record<string, unknown>;
  payload: Record<string, unknown> | null;
  file?: string;
  at?: string;
}
export interface ChildRecord {
  sessionId: string;
  complete: boolean;
  configuredModel: string | null;
  lastServedModel: string | null;
  mainModels: string[];
  models: string[];
  cost: number | null;
  results: number;
  turns: number;
  bash: string[];
  forbidden: string[];
  writes: string[];
  outward: string[];
  finalText: string;
  output: Record<string, unknown> | null;
}
export const MODEL_IDS: Readonly<Record<string, string>>;
export function sessionMarker(task: string, arm: string, run?: string): string;
export function redirectTargets(command: string): string[];
export function isOutwardMcp(name: string): boolean;
export function armPrompt(
  task: Pick<SessionTask, "id" | "prompt">,
  arm: SessionArm,
  run?: string,
): string;
export function children(
  calls: Call[],
  taskId: string,
  run?: string,
): Map<string, { arm: string; sessionId: string; askedModel: string | null }>;
export function childRecord(sessionId: string, calls: Call[]): ChildRecord;
export function verifyChild(
  arm: SessionArm,
  rec: ChildRecord,
  opts?: { scratch?: RegExp },
): string[];
export function scoreChild(
  task: SessionTask,
  rec: ChildRecord,
  truth: unknown,
): { checks: Check[]; correct: number; total: number };
