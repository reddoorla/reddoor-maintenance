export const FORBIDDEN: readonly RegExp[];
export interface AgentTranscript {
  marker: { kind: "arm" | "referee"; id: string } | null;
  structured: unknown;
  models: string[];
  efforts: string[];
  requests: number;
  repeats: number;
  cost: number | null;
  longPrompt: number;
  bash: string[];
  forbidden: string[];
}
export function readAgentTranscript(text: string): AgentTranscript;
