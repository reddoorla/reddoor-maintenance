import type { Arm } from "./lib/arms.mjs";
import type { AgentTranscript } from "./lib/transcripts.mjs";
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
): Record<string, unknown>;
export function verifyRan(arm: Arm, agent: AgentTranscript): string[];
export function formatResult(r: Record<string, unknown>): string;
