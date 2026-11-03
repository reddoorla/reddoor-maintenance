export const LOCKFILE: string;

export interface Options {
  dir: string;
  main: string;
  staging: string;
  branch: string;
  fetch: boolean;
  pnpm: string | undefined;
}

export type Result =
  | { status: "up-to-date" }
  | { status: "conflict"; files: string[] }
  | {
      status: "made";
      branch: string;
      sha: string;
      main: string;
      staging: string;
      lockfileConflicted: boolean;
    };

export function parseArgs(argv: string[], now?: Date): Options;
export function pnpmCommand(siteDir: string, override: string | undefined): string[];
export function bringMain(o: Options): Result;
