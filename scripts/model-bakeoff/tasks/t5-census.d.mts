import type { Arm } from "../lib/arms.mjs";
import type { Collection } from "../lib/score.mjs";
export const id: string;
export const title: string;
export const row: number;
export const sources: { from: string; match: RegExp; to: string }[];
export const collections: Collection[];
export const schema: Record<string, unknown>;
export const goldAddendum: string;
export const arms: Arm[];
export const gold: Arm;
export function prompt(dir: string): string;
export function workflowFacts(file: string, text: string): Record<string, unknown>;
export function scriptFacts(file: string, text: string): Record<string, unknown>;
export function truth(dir: string): {
  workflows: Record<string, unknown>[];
  scripts: Record<string, unknown>[];
};
