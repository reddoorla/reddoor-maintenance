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
  },
  inputDir: string,
  arms?: Arm[],
  work?: string,
): Record<string, unknown>;
export type Collected = AgentTranscript & { transcript: string };
export function agentKey(marker: { kind: "arm" | "referee"; id: string }): string;
export interface RunArgs {
  dir: string;
  work: string;
  gold: Arm;
  arms: Arm[];
}
export function expectedWork(
  args: RunArgs,
  marker: { kind: "arm" | "referee"; id: string },
): string;
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
export function nextRound(agents: Record<string, unknown>): number;
export function formatResult(r: Record<string, unknown>): string;
