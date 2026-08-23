import { describe, it, expect, beforeAll } from "vitest";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, writeFile, chmod, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { join } from "node:path";
import { formatUnmeasuredSmokeSummary, SMOKE_UNMEASURED_PREFIX } from "../../src/audits/smoke.js";
import { stepRunScript, workflowPath } from "./_helpers/workflow-source.js";

const execFileAsync = promisify(execFile);

/**
 * THE GATE THAT COULD NOT FIRE.
 *
 * `fleet-smoke.yml` gated exclusively on `FLEET_WRITE_SUMMARY`, which counts rows
 * WRITTEN, not rows passing. A site whose suite fails is still written, so the
 * workflow reported success — the failure mode already called out by name in
 * fleet-prismic-drift-workflow.test.ts's header.
 *
 * It got worse than "a failing suite goes unnoticed". When a suite exceeds its
 * budget it produces no verdict at all, and the Airtable writer then deliberately
 * PRESERVES THE PRIOR VALUE rather than record a false fail. So the row kept
 * serving its last green tick. reddoor and beachfront-dentistry sat that way for
 * four consecutive nights — Airtable green, workflow green, nothing measured.
 *
 * So this file does not grep the YAML for reassuring words. It EXTRACTS the step's
 * shell script and EXECUTES it against a stubbed CLI, once per way the sweep can
 * go wrong, asserting on exit status and the annotations actually produced.
 *
 * The clean-sweep case is first on purpose. A gate that has only ever been seen to
 * fail is an untested assertion, not an instrument.
 */

const SMOKE_STEP = "Fleet smoke suite + Airtable write-back";

let gate: string;

beforeAll(async () => {
  const wf = await readFile(workflowPath("fleet-smoke.yml"), "utf-8");
  gate = stepRunScript(wf, SMOKE_STEP);
});

/**
 * Run the workflow's own gate script with `node` stubbed out.
 *
 * `bash -e` matches the shell Actions gives a `run:` block (`bash -e {0}`). RUNNER_TEMP
 * points at a scratch dir so the script's `tee`/`grep` target is per-test rather than a
 * shared `/tmp/smoke.out` two runs could stomp on each other.
 */
async function runGate(opts: {
  stdout: string;
  exit: number;
}): Promise<{ code: number; out: string }> {
  const dir = await mkdtemp(join(tmpdir(), "fleet-smoke-gate-"));
  const bin = join(dir, "bin");
  await mkdir(bin, { recursive: true });
  await writeFile(join(dir, "canned.txt"), opts.stdout, "utf-8");
  await writeFile(
    join(bin, "node"),
    `#!/bin/sh\ncat "${join(dir, "canned.txt")}"\nexit ${opts.exit}\n`,
    "utf-8",
  );
  await chmod(join(bin, "node"), 0o755);

  try {
    const { stdout, stderr } = await execFileAsync("bash", ["-e", "-c", gate], {
      cwd: dir,
      env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ""}`, RUNNER_TEMP: dir },
    });
    return { code: 0, out: stdout + stderr };
  } catch (e) {
    const err = e as { code?: number; stdout?: string; stderr?: string };
    return { code: err.code ?? 1, out: (err.stdout ?? "") + (err.stderr ?? "") };
  }
}

/** Summary lines built by the REAL formatters, not hand-typed. A change to either
 *  contract breaks this file instead of silently un-arming the gate. */
const writeSummary = (wrote: number, failed: number): string =>
  `FLEET_WRITE_SUMMARY wrote=${wrote} failed=${failed} total=${wrote + failed}`;

const unmeasuredSummary = (sites: string[]): string =>
  formatUnmeasuredSmokeSummary([
    { audit: "smoke", site: "caltex", summary: "smoke: suite green" },
    ...sites.map((s) => ({ audit: "smoke", site: s, summary: `${SMOKE_UNMEASURED_PREFIX} — x` })),
  ]);

describe("fleet-smoke — the gate cannot go green having measured nothing", () => {
  it("passes a sweep where every site was measured", async () => {
    const r = await runGate({
      stdout: `${writeSummary(13, 0)}\n${unmeasuredSummary([])}\n`,
      exit: 0,
    });
    expect(r.code).toBe(0);
    expect(r.out).not.toContain("::error::");
    expect(r.out).toContain("all 13 site(s) measured");
  });

  // A failing suite is a finding ABOUT THE SITE, recorded on its Airtable row. Reddening
  // the nightly for it would make the alarm meaningless the first time a spec broke — and
  // the CLI exits non-zero for it BY DESIGN, which is why the gate cannot key on $?.
  it("stays green when suites FAIL but every site was measured", async () => {
    const r = await runGate({
      stdout:
        `✖ sonder: 1 failed [FAILED: sonder: 1 audit(s) failed]\n` +
        `${writeSummary(13, 0)}\n${unmeasuredSummary([])}\n`,
      exit: 1,
    });
    expect(r.code).toBe(0);
    expect(r.out).not.toContain("::error::");
  });

  // THE REGRESSION THIS CHANGE EXISTS FOR. Identical write-back to the green case —
  // 13 of 13 rows written, zero write failures — because an unmeasured site still
  // writes (it writes nothing new). Only the unmeasured line separates them.
  it("FAILS when a site's suite exceeded its budget and was never measured", async () => {
    const r = await runGate({
      stdout:
        `${writeSummary(13, 0)}\n` + `${unmeasuredSummary(["reddoor", "beachfront-dentistry"])}\n`,
      exit: 1,
    });
    expect(r.code).not.toBe(0);
    expect(r.out).toContain("::error::");
    expect(r.out).toContain("2 site(s) never measured");
    expect(r.out).toContain("reddoor");
    expect(r.out).toContain("beachfront-dentistry");
  });

  // An absent line means the CLI crashed before the summary, or predates the gate.
  // "I could not read X" must never produce the same result as "X is fine".
  it("FAILS when the unmeasured line is missing entirely", async () => {
    const r = await runGate({ stdout: `${writeSummary(13, 0)}\n`, exit: 0 });
    expect(r.code).not.toBe(0);
    expect(r.out).toContain("::error::");
    expect(r.out).toContain("no FLEET_SMOKE_UNMEASURED line");
  });

  // Pre-existing gates must survive the new one being bolted on.
  it("still FAILS when the run crashed before any write summary", async () => {
    const r = await runGate({ stdout: `boom\n`, exit: 1 });
    expect(r.code).not.toBe(0);
    expect(r.out).toContain("printed no write summary");
  });

  it("still FAILS when nothing was written at all", async () => {
    const r = await runGate({
      stdout: `${writeSummary(0, 13)}\n${unmeasuredSummary([])}\n`,
      exit: 1,
    });
    expect(r.code).not.toBe(0);
    expect(r.out).toContain("wrote 0 of 13");
  });
});
