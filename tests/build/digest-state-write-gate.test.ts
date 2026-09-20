import { describe, it, expect, beforeAll } from "vitest";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, writeFile, chmod, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { join } from "node:path";
import { stepRunScript, withoutComments, workflowPath } from "./_helpers/workflow-source.js";

const execFileAsync = promisify(execFile);

/**
 * MED-13(a) — a marker built to catch a silent stop, that nothing read.
 *
 * `DIGEST_STATE_WRITE turso=… airtable=… rollup=…` exists because of #585: "a
 * dual-write that silently stopped running looked identical to a healthy one
 * for weeks". And `grep -rn DIGEST_STATE_WRITE .github/` returned NOTHING.
 * Rotate the token for the digest step and the email still sends, the workflow
 * stays green, and the cockpit renders last month's rollup with a stale date
 * nobody reads as an error. Every other machine marker in this repo is gated in
 * its workflow.
 *
 * The gate is EXTRACTED FROM THE YAML AND EXECUTED here, clean case first. A
 * workflow-level grep gate is trivially easy to write so that it can never
 * pass, and this repo has shipped exactly that (the `--preview` ANALYTICS gate,
 * fixed in #523). If the pass cannot be demonstrated, that is a finding.
 */

const STEP = "Email the operator digest";

let gate: string;

beforeAll(async () => {
  gate = stepRunScript(await readFile(workflowPath("daily-reports.yml"), "utf-8"), STEP);
});

/** Run the extracted step with a stubbed `node` that prints `out`, exits `code`. */
async function runStep(out: string, code = 0): Promise<{ code: number; log: string }> {
  const dir = await mkdtemp(join(tmpdir(), "digest-gate-"));
  const bin = join(dir, "bin");
  await mkdir(bin, { recursive: true });
  await writeFile(join(dir, "cli.txt"), out, "utf-8");
  await writeFile(
    join(bin, "node"),
    `#!/bin/sh\ncat "${join(dir, "cli.txt")}"\nexit ${code}\n`,
    "utf-8",
  );
  await chmod(join(bin, "node"), 0o755);
  try {
    const { stdout, stderr } = await execFileAsync("bash", ["-e", "-c", gate], {
      cwd: dir,
      env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ""}`, RUNNER_TEMP: dir },
    });
    return { code: 0, log: stdout + stderr };
  } catch (e) {
    const err = e as { code?: number; stdout?: string; stderr?: string };
    return { code: err.code ?? 1, log: (err.stdout ?? "") + (err.stderr ?? "") };
  }
}

/** A real, verbatim-shaped healthy run: the CLI's own success line, then the marker. */
const HEALTHY = [
  "Digest sent to tucker@reddoorla.com (msg_0193f1)",
  "DIGEST_STATE_WRITE turso=1 airtable=1 rollup=1",
].join("\n");

describe("daily-reports digest gate — PASSES on a known-good line (prove the instrument)", () => {
  it("a healthy dual-write is green", async () => {
    const r = await runStep(HEALTHY);
    expect(r.code).toBe(0);
    expect(r.log).toContain("PASS");
    expect(r.log).toContain("DIGEST_STATE_WRITE turso=1 airtable=1 rollup=1");
  });

  it("is green on a QUIET day, where the digest skips itself but still snapshots", async () => {
    const r = await runStep(
      [
        "Digest skipped (nothing ready, nothing needs attention).",
        "DIGEST_STATE_WRITE turso=1 airtable=1 rollup=1",
      ].join("\n"),
    );
    expect(r.code).toBe(0);
  });

  it("is green when AIRTABLE fails — Phase 6 is about to delete that half", async () => {
    // The gate must never assert anything about the Airtable counter, or Phase 6
    // removing the dual-write turns this into a false red on a deliberate change.
    const r = await runStep("DIGEST_STATE_WRITE turso=1 airtable=0 rollup=1");
    expect(r.code).toBe(0);
  });

  it("is green with NO airtable counter at all — the post-Phase-6 line", async () => {
    const r = await runStep("DIGEST_STATE_WRITE turso=1 rollup=1");
    expect(r.code).toBe(0);
  });

  it("is green, with a warning, on rollup=absent — the code calls that a THIRD state", async () => {
    // `writeCockpitRollupToDb`: "No Turso configured is a THIRD state, not a
    // failure ... reporting it as `rollup=0` would train the eye to ignore the
    // number that is supposed to catch a dead writer." Reddening it here would
    // contradict the code's own description.
    const r = await runStep("DIGEST_STATE_WRITE turso=1 airtable=1 rollup=absent");
    expect(r.code).toBe(0);
    expect(r.log).toContain("::warning::");
  });

  it("is green on the same-day duplicate no-op, which deliberately writes nothing", async () => {
    // `isIdempotencyConflict`: the first send already persisted the snapshot, and
    // writing this run's `next` would diff against the wrong baseline. It returns
    // BEFORE persistDigestState, so there is no marker — legitimately.
    const r = await runStep(
      "Digest already sent today (content changed since the first send) — skipped to avoid a duplicate.",
    );
    expect(r.code).toBe(0);
    expect(r.log).toContain("wrote no snapshot");
  });
});

describe("daily-reports digest gate — FAILS on the silent stop it exists to catch", () => {
  it("reds when the marker is absent entirely — the #585 shape", async () => {
    // Exactly the rotated-token scenario: the email sends, the CLI exits 0, and
    // under the old workflow the run stayed green.
    const r = await runStep("Digest sent to tucker@reddoorla.com (msg_0193f1)");
    expect(r.code).toBe(1);
    expect(r.log).toContain("DIGEST_STATE_WRITE");
  });

  it("reds on turso=0 — the read side did not get the snapshot", async () => {
    const r = await runStep("DIGEST_STATE_WRITE turso=0 airtable=1 rollup=1");
    expect(r.code).toBe(1);
    expect(r.log).toContain("turso=0");
  });

  it("reds on turso=0 even when everything else succeeded", async () => {
    const r = await runStep(
      ["Digest sent to tucker@reddoorla.com (msg_x)", "DIGEST_STATE_WRITE turso=0 rollup=1"].join(
        "\n",
      ),
    );
    expect(r.code).toBe(1);
  });

  it("reds on rollup=0 — the write was attempted and threw", async () => {
    const r = await runStep("DIGEST_STATE_WRITE turso=1 airtable=1 rollup=0");
    expect(r.code).toBe(1);
    expect(r.log).toContain("rollup");
  });

  it("reds when the turso counter is missing — a reworded marker cannot pass by omission", async () => {
    const r = await runStep("DIGEST_STATE_WRITE airtable=1 rollup=1");
    expect(r.code).toBe(1);
  });

  it("reds when the CLI itself failed", async () => {
    const r = await runStep("digest failed: Resend 401", 1);
    expect(r.code).toBe(1);
  });

  it("the marker is read by a workflow at all — the finding's own check", async () => {
    // MED-13(a) is literally `grep -rn DIGEST_STATE_WRITE .github/` returning
    // nothing. Comment lines are stripped first: documenting a marker must never
    // be mistaken for gating on one.
    const dir = workflowPath(".");
    const hits: string[] = [];
    for (const f of (await readdir(dir)).filter((n) => n.endsWith(".yml"))) {
      const src = withoutComments(await readFile(join(dir, f), "utf-8"));
      if (src.includes("DIGEST_STATE_WRITE")) hits.push(f);
    }
    expect(hits).toContain("daily-reports.yml");
  });
});
