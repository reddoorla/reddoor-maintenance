export function withoutHeredocs(command: string): string;
export function segments(command: string): string[][];
export function commandOf(tokens: string[]): { name: string; args: string[] } | null;
export const ALLOWED_TOOLS: readonly string[];
export function unquoted(command: string): string;
export function forbiddenCommand(command: string, depth?: number): boolean;
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
  otherTools: string[];
  prompt: string;
  forbidden: string[];
}
export function readAgentTranscript(text: string): AgentTranscript;
