import type { Check, SessionArm } from "../lib/session-arms.mjs";
export const id: string;
export const title: string;
export const arms: SessionArm[];
export const checkCount: number;
export function prompt(): string;
export function check(out: unknown, truth: ReturnType<typeof truth>): Check[];
export const FACTS: {
  session: string;
  asked: string;
  refs: string[];
  usage: Record<"cost" | "input" | "output" | "cacheRead" | "cacheWrite" | "rateLimit", string>;
  measured: string;
};
export function truth(): typeof FACTS;
