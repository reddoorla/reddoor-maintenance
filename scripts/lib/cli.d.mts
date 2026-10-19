// Hand-written types for cli.mjs. The helpers stay plain JS so the scripts that import them
// run with bare `node` and no build step; this file is only so `tsc --noEmit` can type the
// imports from tests and from the .mts scripts.

export function realOrSelf(p: string): string;
export function isMain(importMetaUrl: string, argv1?: string | undefined): boolean;
export function flagValue(v: string | undefined, flag: string): string;
export function sleep(ms: number): Promise<void>;
export function proxyReexecEnv(
  env: Record<string, string | undefined>,
): Record<string, string | undefined> | null;
