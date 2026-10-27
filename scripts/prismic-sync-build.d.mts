export const MAX_FILE_BYTES: number;

export function safeRelative(path: unknown): boolean;

export interface BuildSteps {
  extract: (tarFile: string, work: string) => Promise<void>;
  install: (work: string) => Promise<void>;
  format: (work: string, paths: string[]) => Promise<boolean>;
  codegen: (work: string) => Promise<void>;
}

export const realSteps: BuildSteps;

export interface BuildResult {
  ok: boolean;
  formatted: boolean;
  error: string | null;
}

export function buildSite(args: {
  inDir: string;
  outDir: string;
  work: string;
  steps?: BuildSteps;
}): Promise<BuildResult>;
