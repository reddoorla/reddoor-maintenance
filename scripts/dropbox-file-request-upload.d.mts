export const BLOCK: number;
export const BATCH: number;
export const USAGE: string;
export const VERIFY: string;

export interface Options {
  url: string;
  name: string;
  files: string[];
  dryRun: boolean;
}

export interface Row {
  file: string;
  size: number;
  contentHash: string;
  uploadedAs: string;
  renameTo: string;
}

export function contentHash(buf: Uint8Array): string;
export function parseArgs(argv: string[], env?: Record<string, string | undefined>): Options;
export function uploadedName(name: string, file: string): string;
export function batches<T>(items: T[], n?: number): T[][];
export function timeoutMs(bytes: number): number;
export function plan(files: string[], name: string): Row[];
export function table(rows: Row[]): string;
export function commitComplete(status: number, text: string): boolean;
