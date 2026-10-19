export function withoutHeredocs(command: string): string;
export function heredocs(command: string): {
  text: string;
  bodies: { opener: string; body: string }[];
};
export function substitutions(text: string): string[];
export function segments(command: string): string[][];
export function commandOf(tokens: string[]): { name: string; args: string[] } | null;
export const ALLOWED_TOOLS: readonly string[];
export function lex(text: string): string[][];
export function forbiddenCommand(command: string, depth?: number): boolean;
export interface AgentTranscript {
  marker: { kind: "arm" | "referee"; id: string; item?: string } | null;
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
  reads: string[];
  otherTools: string[];
  prompt: string;
  forbidden: string[];
}
export function readAgentTranscript(text: string): AgentTranscript;
