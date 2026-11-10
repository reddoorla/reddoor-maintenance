export const LOCKFILE: string;

export interface Options {
  dir: string;
  main: string;
  staging: string;
  branch: string;
  fetch: boolean;
  pnpm: string | undefined;
}

/** A package whose newest version in the merged lockfile is older than the newest on `side`. */
export interface Regression {
  name: string;
  side: string;
  had: string;
  merged: string;
}

export type Result =
  | { status: "up-to-date" }
  | { status: "conflict"; files: string[] }
  | {
      status: "regressed";
      /** what pnpm's merge put back */
      regressions: Regression[];
      /** each side's lockfile tried as the seed, and what it put back */
      seeds: { side: "main" | "staging"; regressions: Regression[] }[];
    }
  | {
      status: "made";
      branch: string;
      sha: string;
      main: string;
      staging: string;
      lockfileConflicted: boolean;
      /** what pnpm's merge put back before the seed; [] when it put back nothing */
      regressions: Regression[];
      /** the side whose lockfile seeded the result, or null when pnpm's merge stood */
      seededFrom: "main" | "staging" | null;
    };

export function parseArgs(argv: string[], now?: Date): Options;
export function pnpmCommand(siteDir: string, override: string | undefined): string[];
export function bringMain(o: Options): Result;
export function compareVersions(a: string, b: string): number;
export function satisfies(version: string, range: string): boolean | undefined;
export function lockfilePackages(text: string): Map<string, string[]>;
export function lockfileRegressions(
  merged: string,
  sides: Record<string, string | undefined>,
): Regression[];
export function describeRegressions(rs: Regression[], limit?: number): string;
