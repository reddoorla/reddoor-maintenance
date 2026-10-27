import type { Check, SessionArm } from "../lib/session-arms.mjs";
export const id: string;
export const title: string;
export const arms: SessionArm[];
export const checkCount: number;
export function prompt(): string;
export function check(out: unknown, truth: ReturnType<typeof truth>): Check[];
export const COCKPIT: string;
export function truth(): {
  topOfStack: string[];
  attention: string[];
  watch: string[];
  setup: Record<string, number>;
};
