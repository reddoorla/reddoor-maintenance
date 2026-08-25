import { describe, it, expect, beforeAll } from "vitest";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, writeFile, chmod, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { join } from "node:path";
import {
  stepRunScript,
  workflowPath,
  stepEnv,
  withoutComments,
} from "./_helpers/workflow-source.js";
import { formatRerenderResult } from "../../src/reports/send/rerender.js";

const execFileAsync = promisify(execFile);

/**
 * The re-render gate, EXTRACTED FROM THE YAML AND EXECUTED — same discipline as
 * fleet-db-sync's and fleet-db-backup's.
 *
 * Includes a case that runs the REAL `formatRerenderResult` output through the
 * REAL grep, not a hand-written copy of it. Every fixture-only gate test in this
 * repo was shown to be vacuous for exactly the drift it was meant to catch
 * (2026-08-25, #584/#586), so a new gate ships with that case from the start.
 */
const STEP = "Re-render the report body";

let gate: string;
let workflow: string;

beforeAll(async () => {
  workflow = await readFile(workflowPath("report-rerender.yml"), "utf-8");
  gate = stepRunScript(workflow, STEP);
});

async function runGate(opts: {
  out: string;
  exit?: number;
}): Promise<{ code: number; out: string }> {
  const dir = await mkdtemp(join(tmpdir(), "rerender-gate-"));
  const bin = join(dir, "bin");
  await mkdir(bin, { recursive: true });
  await writeFile(join(dir, "cli.txt"), opts.out, "utf-8");
  await writeFile(
    join(bin, "node"),
    `#!/bin/sh\ncase "$*" in\n  *"report --rerender"*) cat "${join(dir, "cli.txt")}"; exit ${opts.exit ?? 0};;\nesac\nexit 0\n`,
    "utf-8",
  );
  await chmod(join(bin, "node"), 0o755);
  try {
    const { stdout, stderr } = await execFileAsync("bash", ["-e", "-c", gate], {
      cwd: dir,
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH ?? ""}`,
        RUNNER_TEMP: dir,
        REPORT_ID: "recREP",
      },
    });
    return { code: 0, out: `${stdout}${stderr}` };
  } catch (err) {
    const e = err as { code?: number; stdout?: string; stderr?: string };
    return { code: e.code ?? 1, out: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
}

describe("report-rerender workflow gate", () => {
  // PROVE THE INSTRUMENT FIRST: a real render must pass.
  it("PASSES on the REAL formatRerenderResult output of a render", async () => {
    const real = formatRerenderResult({
      status: "rendered",
      reportId: "recREP",
      bytes: 95138,
      headerSource: "turso",
    });
    expect((await runGate({ out: `${real}\n` })).code).toBe(0);
  });

  it("FAILS on a refusal, which the CLI also exits nonzero for", async () => {
    const refused = formatRerenderResult({ status: "already-sent", reportId: "recREP" });
    expect((await runGate({ out: `${refused}\n`, exit: 1 })).code).not.toBe(0);
  });

  it("FAILS when the run exits 0 WITHOUT a rendered line (absent line = never ran)", async () => {
    const r = await runGate({ out: "some unrelated chatter\n" });
    expect(r.code).not.toBe(0);
    expect(r.out).toContain("no rendered body");
  });

  it("FAILS on a zero-exit refusal too — the grep does not trust the exit code", async () => {
    // Belt and braces: if the CLI's exit mapping ever regresses, the gate still
    // refuses a run that rendered nothing.
    const refused = formatRerenderResult({ status: "no-header", reportId: "recREP" });
    expect((await runGate({ out: `${refused}\n`, exit: 0 })).code).not.toBe(0);
  });

  it("is dispatch-only and carries the credentials the render needs", () => {
    // withoutComments, per that helper's own warning: this file's header
    // explains that there is deliberately no `schedule:`, so a raw-text check
    // is satisfied by the prose rather than by the YAML. I wrote it the naive
    // way first and it failed on my own comment.
    expect(withoutComments(workflow)).not.toContain("schedule:");
    expect(withoutComments(workflow)).toContain("workflow_dispatch:");
    const env = stepEnv(workflow, STEP);
    expect(Object.keys(env)).toEqual(
      expect.arrayContaining([
        "AIRTABLE_PAT",
        "AIRTABLE_BASE_ID",
        "TURSO_DATABASE_URL",
        "TURSO_AUTH_TOKEN",
      ]),
    );
  });
});
