import { describe, it, expect, beforeAll } from "vitest";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, writeFile, chmod, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { join } from "node:path";
import { stepRunScript, workflowPath } from "./_helpers/workflow-source.js";

const execFileAsync = promisify(execFile);

/**
 * The hourly sync gate, EXTRACTED FROM THE YAML AND EXECUTED against a stubbed
 * CLI (same discipline as fleet-db-backup's gate): clean case first, then the
 * two failure shapes — an honest nonzero exit, and the sneakier zero-exit run
 * that never printed its FLEET_SYNC line (a crash mid-sync must read as red,
 * never as clean).
 */

const SYNC_STEP = "Sync Airtable → Turso and check parity";

let gate: string;
let workflow: string;

beforeAll(async () => {
  workflow = await readFile(workflowPath("fleet-db-sync.yml"), "utf-8");
  gate = stepRunScript(workflow, SYNC_STEP);
});

async function runGate(opts: {
  syncOut: string;
  syncExit?: number;
}): Promise<{ code: number; out: string }> {
  const dir = await mkdtemp(join(tmpdir(), "db-sync-gate-"));
  const bin = join(dir, "bin");
  await mkdir(bin, { recursive: true });
  await writeFile(join(dir, "sync.txt"), opts.syncOut, "utf-8");
  await writeFile(
    join(bin, "node"),
    `#!/bin/sh\ncase "$*" in\n  *"db sync"*) cat "${join(dir, "sync.txt")}"; exit ${opts.syncExit ?? 0};;\nesac\nexit 0\n`,
    "utf-8",
  );
  await chmod(join(bin, "node"), 0o755);
  try {
    const { stdout, stderr } = await execFileAsync("bash", ["-e", "-c", gate], {
      cwd: dir,
      env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ""}`, RUNNER_TEMP: dir },
    });
    return { code: 0, out: `${stdout}${stderr}` };
  } catch (err) {
    const e = err as { code?: number; stdout?: string; stderr?: string };
    return { code: e.code ?? 1, out: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
}

describe("fleet-db-sync workflow gate", () => {
  // PROVE THE INSTRUMENT FIRST: a clean sync must pass.
  it("PASSES on a clean sync (mismatches=0)", async () => {
    const r = await runGate({
      syncOut:
        "FLEET_SYNC sites=44 reports=13 html_fetched=0 html_skipped=13 retried=0 mismatches=0\n",
    });
    expect(r.code).toBe(0);
  });

  it("FAILS when the sync exits nonzero (persistent parity mismatch)", async () => {
    const r = await runGate({
      syncOut:
        "✗ sites recX status: airtable=legacy turso=maintenance\nFLEET_SYNC sites=44 reports=13 html_fetched=0 html_skipped=13 retried=1 mismatches=1\n",
      syncExit: 1,
    });
    expect(r.code).not.toBe(0);
  });

  it("FAILS when the run exits 0 WITHOUT the FLEET_SYNC line (absent line = crash, never clean)", async () => {
    const r = await runGate({ syncOut: "something unrelated\n" });
    expect(r.code).not.toBe(0);
    expect(r.out).toContain("FLEET_SYNC line missing");
  });

  it("FAILS when the line reports mismatches>0 even on a zero exit", async () => {
    // Belt-and-braces: if the CLI's exit-code mapping ever regresses, the grep
    // still refuses a drifted sync.
    const r = await runGate({
      syncOut:
        "FLEET_SYNC sites=44 reports=13 html_fetched=0 html_skipped=13 retried=1 mismatches=3\n",
    });
    expect(r.code).not.toBe(0);
  });

  it("runs hourly with a concurrency group (no overlapping syncs)", () => {
    expect(workflow).toContain('cron: "20 * * * *"');
    expect(workflow).toMatch(
      /concurrency:\s*\n\s*group: fleet-db-sync\s*\n\s*cancel-in-progress: false/,
    );
  });
});
