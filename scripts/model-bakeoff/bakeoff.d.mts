import type { Arm } from "./lib/arms.mjs";
import type { AgentTranscript } from "./lib/transcripts.mjs";
export const REFEREE: Readonly<Arm>;
export function loadTask(name: string): Promise<Record<string, unknown>>;
export function manifest(dir: string): Record<string, string>;
export function extractArgs(
  task: {
    id: string;
    arms: Arm[];
    gold: Arm;
    prompt: (d: string) => string;
    goldAddendum?: string;
    schema: unknown;
    items?: (d: string) => { id: string; prompt: string; schema: unknown }[];
  },
  inputDir: string,
  arms?: Arm[],
  work?: string,
): Record<string, unknown>;
export function scorerFor(task: Record<string, unknown>): {
  referenceFaults: (...a: unknown[]) => string[];
  extraCandidates: (...a: unknown[]) => Record<string, unknown>;
  scoreRun: (...a: unknown[]) => unknown[];
};
export type Collected = AgentTranscript & { transcript: string };
export type Marker = { kind: "arm" | "referee"; id: string; item?: string };
export function agentKey(marker: Marker): string;
export interface RunArgs {
  dir: string;
  work: string;
  gold: Arm;
  arms: Arm[];
  items?: { id: string }[];
}
export function expectedWork(args: RunArgs, marker: Marker): string;
export function mergeAgents(
  prior: Record<string, Collected>,
  found: Collected[],
  args: RunArgs,
): { agents: Record<string, Collected>; errors: string[] };
export function verifyRan(
  arm: Arm,
  agent: AgentTranscript,
  work?: string,
  opts?: { needOutput?: boolean },
): string[];
export function combineItems(
  task: { assemble: (outputs: Record<string, unknown>, dir: string) => unknown },
  args: RunArgs & { items: { id: string }[] },
  agents: Record<string, AgentTranscript>,
  arm: Arm,
): {
  record: (Omit<AgentTranscript, "marker" | "markerError"> & Record<string, unknown>) | null;
  problems: string[];
};
export function secretReads(
  secrets: string[],
  agents: Record<string, { bash?: string[]; reads?: string[] }>,
): string[];
export function scoreArms(
  task: Record<string, unknown>,
  args: RunArgs & { task: string },
  agents: Record<string, Collected>,
  reference: unknown,
  truth: unknown,
): {
  checksByArm: Record<string, import("./lib/score.mjs").Check[]>;
  problems: string[];
  invalid: string[];
};
export function armOutput(
  task: {
    observe?: (work: string, structured: unknown, agent?: unknown, reference?: unknown) => unknown;
  },
  args: { work: string },
  arm: Arm,
  agent: (Partial<Collected> & { structured?: unknown }) | undefined,
  reference?: unknown,
): unknown;
export function nextRound(agents: Record<string, unknown>): number;
export function byCollection(
  byField: Record<string, { total: number; correct: number }>,
): Record<string, string>;
export function formatResult(r: Record<string, unknown>): string;
export function launchers(
  args: { task: string; gold: Arm; arms: Arm[] } & Record<string, unknown>,
  source: string,
): { id: string; script: string }[];
