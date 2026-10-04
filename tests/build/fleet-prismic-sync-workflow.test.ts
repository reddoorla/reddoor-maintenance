import { describe, it, expect, beforeAll } from "vitest";
import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  stepEnv,
  stepRunScript,
  workflowPath,
  withoutComments,
} from "./_helpers/workflow-source.js";

const execFileAsync = promisify(execFile);

const STEP = "Sync each site's models from Prismic";
let wf: string;
let gate: string;

beforeAll(async () => {
  wf = await readFile(workflowPath("fleet-prismic-sync.yml"), "utf-8");
  gate = stepRunScript(wf, STEP);
});

/** The step's own script, run under `bash -e` with `node` stubbed to print
 *  `stdout` and exit `exit`, as the drift workflow's test does. */
async function runGate(opts: {
  stdout: string;
  exit: number;
}): Promise<{ code: number; out: string }> {
  const dir = await mkdtemp(join(tmpdir(), "prismic-sync-gate-"));
  const bin = join(dir, "bin");
  await mkdir(bin, { recursive: true });
  await writeFile(join(dir, "canned.txt"), opts.stdout, "utf-8");
  await writeFile(
    join(bin, "node"),
    `#!/bin/sh\necho "$@" > "${join(dir, "argv.txt")}"\ncat "${join(dir, "canned.txt")}"\nexit ${opts.exit}\n`,
    "utf-8",
  );
  await chmod(join(bin, "node"), 0o755);
  try {
    const { stdout, stderr } = await execFileAsync("bash", ["-e", "-c", gate], {
      cwd: dir,
      env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ""}`, RUNNER_TEMP: dir },
    });
    return { code: 0, out: stdout + stderr + (await readFile(join(dir, "argv.txt"), "utf-8")) };
  } catch (e) {
    const err = e as { code?: number; stdout?: string; stderr?: string };
    return { code: err.code ?? 1, out: (err.stdout ?? "") + (err.stderr ?? "") };
  }
}

const summary = (failed: number): string =>
  `PRISMIC_SYNC_SUMMARY sites=13 opened=1 updated=0 unchanged=0 closed=0 in_sync=${12 - failed} would_open=0 skipped=0 failed=${failed}`;

describe("fleet-prismic-sync — the gate", () => {
  it("passes a run that synced every site, and asks the CLI to open PRs", async () => {
    const r = await runGate({
      stdout: `opened Fixture — opened https://x\n${summary(0)}\n`,
      exit: 0,
    });
    expect(r.code).toBe(0);
    expect(r.out).not.toContain("::error::");
    expect(r.out).toContain("prismic-sync --fleet turso --open-prs --workdir");
  });

  it("fails when a site failed, naming it", async () => {
    const r = await runGate({
      stdout: `failed     Hedloc — 1 model(s) refused\n${summary(1)}\n`,
      exit: 1,
    });
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/::error::.*Hedloc/);
  });

  it("fails a green exit that printed no summary", async () => {
    const r = await runGate({ stdout: "nothing useful\n", exit: 0 });
    expect(r.code).not.toBe(0);
    expect(r.out).toContain("::error::");
  });

  it("names the refusal when the run stopped before any site", async () => {
    const r = await runGate({ stdout: "⛔ the inventory resolved no sites\n", exit: 1 });
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/::error::.*resolved no sites/);
  });
});

describe("fleet-prismic-sync — wiring", () => {
  it("carries exactly the drift sweep's per-repository Prismic tokens, and no generic one", async () => {
    const drift = await readFile(workflowPath("fleet-prismic-drift.yml"), "utf-8");
    const names = (env: Record<string, string>) =>
      Object.keys(env)
        .filter((k) => k.startsWith("PRISMIC_"))
        .sort();
    const mine = names(stepEnv(wf, STEP));
    expect(mine).toEqual(names(stepEnv(drift, "Sweep the fleet for Prismic model drift")));
    expect(mine.length).toBeGreaterThan(10);
    expect(mine).not.toContain("PRISMIC_WRITE_TOKEN");
  });

  it("pushes as the reddoor-renovate App, minted org-wide", () => {
    const env = stepEnv(wf, STEP);
    expect(env.GH_TOKEN).toBe("${{ steps.app-token.outputs.token }}");
    const src = withoutComments(wf);
    expect(src).toContain("app-id: ${{ vars.RENOVATE_APP_ID }}");
    expect(src).toContain("private-key: ${{ secrets.RENOVATE_APP_PRIVATE_KEY }}");
    expect(src).toMatch(/owner: reddoorla/);
  });

  it("runs after the drift sweep, only for main's runs", () => {
    const src = withoutComments(wf);
    expect(src).toMatch(/workflow_run:\n\s+workflows: \[fleet-prismic-drift\]/);
    expect(src).toContain("github.event.workflow_run.head_branch == 'main'");
  });
});
