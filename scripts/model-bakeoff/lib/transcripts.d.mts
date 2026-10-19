export const FORBIDDEN: readonly RegExp[];
export function unquoted(command: string): string;
export function forbiddenCommand(command: string): boolean;
export interface AgentTranscript {
  marker: { kind: "arm" | "referee"; id: string } | null;
  markerError: string | null;
  structured: unknown;
  models: string[];
  efforts: string[];
  requests: number;
  repeats: number;
  cost: number | null;
  longPrompt: number;
  bash: string[];
  writes: string[];
  mcp: string[];
  forbidden: string[];
}
export function readAgentTranscript(text: string): AgentTranscript;
