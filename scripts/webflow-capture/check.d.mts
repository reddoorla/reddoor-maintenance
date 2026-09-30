// Hand-written types for check.mjs (see lib.d.mts for why).

export type CheckResult = {
  ok: boolean;
  failures: string[];
  present: number;
  excluded: Array<{ url: string; reason: string; from: string | undefined }>;
  pages: number;
};

export function checkCapture(dir: string, opts?: { expectPages?: number | undefined }): CheckResult;
