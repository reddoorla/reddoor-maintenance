import { spawn } from "node:child_process";

export type SpawnResult = { code: number; stdout: string; stderr: string };

export type SpawnOptions = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  /** When true, the child inherits stdout/stderr so the user sees live
   * progress (useful for long-running `pnpm up` / `npm install`). The
   * returned `stdout` and `stderr` will be empty strings in that case. */
  streaming?: boolean;
};

export type SpawnFn = (
  cmd: string,
  args: readonly string[],
  opts?: SpawnOptions,
) => Promise<SpawnResult>;

export const defaultSpawn: SpawnFn = (cmd, args, opts = {}) =>
  new Promise((resolve, reject) => {
    const streaming = opts.streaming === true;
    const child = spawn(cmd, [...args], {
      cwd: opts.cwd,
      env: opts.env ?? process.env,
      stdio: streaming ? ["ignore", "inherit", "inherit"] : ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    if (!streaming) {
      child.stdout?.on("data", (chunk) => (stdout += String(chunk)));
      child.stderr?.on("data", (chunk) => (stderr += String(chunk)));
    }

    const timer = opts.timeoutMs
      ? setTimeout(() => {
          child.kill("SIGTERM");
          reject(new Error(`spawn timeout after ${opts.timeoutMs}ms: ${cmd}`));
        }, opts.timeoutMs)
      : undefined;

    child.on("error", (err) => {
      if (timer) clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
