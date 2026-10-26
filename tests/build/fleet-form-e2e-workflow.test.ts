import { describe, it, expect, beforeAll } from "vitest";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, writeFile, chmod, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { join } from "node:path";
import {
  FORM_E2E_TESTMODE_UNDECLARED_SUMMARY,
  formE2eHealthUnreadableSummary,
} from "../../src/audits/form-e2e.js";
import { stepRunScript, workflowPath, workflowSteps } from "./_helpers/workflow-source.js";
import { fleetWriteOutput } from "./_helpers/fleet-write-output.js";

const execFileAsync = promisify(execFile);

/**
 * THE ONE NIGHTLY WITH NO ZERO-WRITE CHECK.
 *
 * `fleet-form-e2e.yml` was the only fleet sweep whose gate had no "did this run
 * measure anything at all?" test and no gate test of its own — the combination
 * that let four nights of unmeasured smoke go green in 2026-08 before
 * `FLEET_SMOKE_UNMEASURED` was invented to kill it.
 *
 * Two DIFFERENT holes, and it matters that they are different:
 *
 *  1. A sweep that attempted NOTHING (`total=0`) exited 0. The pre-existing
 *     mass-flake gate is `failed * 4 > total`, which is `0 > 0` — false — so a
 *     run that swept an empty fleet reported success. fleet-lighthouse.yml:109
 *     has carried `if [ "$wrote" -eq 0 ]` against exactly this for months.
 *  2. COVERAGE. A site whose /health does not declare `forms.testMode`
 *     self-skips, and a self-skip is written back like any other result — so
 *     "13 of 13 probed and green" and "13 of 13 refused to probe" produce a
 *     byte-identical `FLEET_WRITE_SUMMARY`. That is reported, not failed: five
 *     of thirteen maintained sites are uncovered today, and a nightly that reds
 *     every night is a nightly nobody reads.
 *
 * So this file does not grep the YAML for reassuring words. It EXTRACTS the
 * step's shell script and EXECUTES it against a stubbed CLI, once per way the
 * sweep can go wrong, asserting on exit status and the annotations produced.
 *
 * The clean-sweep case is first on purpose. A gate that has only ever been seen
 * to fail is an untested assertion, not an instrument.
 */

const FORM_E2E_STEP = "Fleet form-e2e + write-back";

const POSITIVE_CONTROL_STEP = "Positive control — the probe passes a known-good local form";

const PASSED_REPORT = {
  success: true,
  numPassedTests: 22,
  numPendingTests: 0,
  numTodoTests: 0,
};

let gate: string;
let workflow: string;

beforeAll(async () => {
  workflow = await readFile(workflowPath("fleet-form-e2e.yml"), "utf-8");
  gate = stepRunScript(workflow, FORM_E2E_STEP);
});

/**
 * Run the workflow's own gate script with `node` stubbed out.
 *
 * `bash -e` matches the shell Actions gives a `run:` block (`bash -e {0}`).
 * RUNNER_TEMP points at a scratch dir so the script's `tee`/`grep` target is
 * per-test rather than a shared `/tmp/form-e2e.out` two runs could stomp on.
 */
async function runGate(opts: {
  stdout: string;
  exit: number;
}): Promise<{ code: number; out: string }> {
  const dir = await mkdtemp(join(tmpdir(), "fleet-form-e2e-gate-"));
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

/** The summary line in the shape the REAL formatter emits, including its
 *  invariant `total = wrote + failed` (src/audits/write-audits.ts).
 *  Honouring that invariant is load-bearing here: it is precisely because
 *  `wrote=0` forces `failed=total` that the mass-flake gate accidentally covers
 *  every zero-write case EXCEPT `total=0`. */
const writeSummary = (
  wrote: number,
  failed: number,
  kept: Array<{ slug: string; reason: string }> = [],
): string => fleetWriteOutput(wrote, failed, kept);

/** One site's block as `formatTable` in src/cli/commands/audit.ts renders it:
 *  `audit` padded to 12, `status` padded to 5, the site, then the summary on the
 *  next line indented two spaces. */
const resultBlock = (status: string, site: string, summary: string): string =>
  `${"form-e2e".padEnd(12)} ${status.padEnd(5)} ${site}\n  ${summary}`;

/** Self-skips built from the audit's OWN exported summary string, never a
 *  hand-typed copy. Reword the skip in src/audits/form-e2e.ts and the counter's
 *  case below goes red, instead of the nightly quietly reporting `skipped=0`
 *  for a fleet nobody probed. */
const selfSkips = (sites: string[]): string =>
  sites.map((s) => resultBlock("skip", s, FORM_E2E_TESTMODE_UNDECLARED_SUMMARY)).join("\n");

const probed = (sites: string[]): string =>
  sites.map((s) => resultBlock("pass", s, "form submitted; success banner shown")).join("\n");

const SIX_COVERED = [
  "beachfront-dentistry",
  "reddoor-website",
  "medical-solutions-of-texas",
  "espada",
  "vineyard-custom-homes",
  "1836dig",
];
const FIVE_UNCOVERED = [
  "gallerysonder",
  "revogen",
  "erp-industrial",
  "data-dynamiq",
  "la-homelessness-initiative",
];

describe("fleet-form-e2e — the gate cannot go green having probed nothing", () => {
  // (a) THE PASS CONTROL. Until this is green the gate is the suspect, not the
  // workflow, and no FAIL below is evidence of anything.
  it("passes a sweep where every site was probed and written", async () => {
    const r = await runGate({
      stdout: `${probed([...SIX_COVERED])}\n${writeSummary(13, 0)}\n`,
      exit: 0,
    });
    expect(r.code).toBe(0);
    expect(r.out).not.toContain("::error::");
    expect(r.out).toContain("wrote=13 failed=0 total=13");
  });

  // (b) THE REGRESSION THIS CHANGE EXISTS FOR. A sweep that attempted nothing —
  // an empty inventory, a fleet source that returned no rows, a filter that
  // matched none — writes `wrote=0 failed=0 total=0`. The mass-flake gate reads
  // that as `0 > 0`, false, and the run reports success having probed no site at
  // all. fleet-lighthouse.yml reds on the identical input.
  it("FAILS when the sweep wrote nothing because it attempted nothing", async () => {
    const r = await runGate({ stdout: `${writeSummary(0, 0)}\n`, exit: 0 });
    expect(r.code).not.toBe(0);
    expect(r.out).toContain("::error::fleet form-e2e: wrote 0 of 0 site(s)");
  });

  // The other zero-write shape. It is ALREADY red today, but via the mass-flake
  // gate and under the mass-flake message, which sends the reader hunting for a
  // per-site flake when the cause is total write-back failure (creds/API). The
  // zero-write check must fire FIRST so the annotation names the real cause.
  it("FAILS with the zero-write diagnosis, not 'mass flake', when every write failed", async () => {
    const r = await runGate({ stdout: `${writeSummary(0, 13)}\n`, exit: 1 });
    expect(r.code).not.toBe(0);
    // The write gate (#1605) speaks first, and its first reason is the zero write.
    expect(r.out).toContain("::error::fleet form-e2e: wrote 0 of 13 site(s)");
  });

  // (c) The SECOND `exit 1` the original survey of this workflow missed. Adding
  // a zero-write gate must not disarm the one that already exists. Since #1605
  // the write gate carries the same >25% rule and reds first.
  it("still FAILS when more than 25% of attempted sites failed to write", async () => {
    const r = await runGate({ stdout: `${writeSummary(9, 4)}\n`, exit: 1 });
    expect(r.code).not.toBe(0);
    expect(r.out).toContain(
      "::error::fleet form-e2e: 4 of 13 site(s) not written or missing (>25%)",
    );
  });

  // (d) COVERAGE, reported not enforced. These five rows are written and green;
  // nothing in FLEET_WRITE_SUMMARY distinguishes them from five probed sites.
  it("reports self-skipped sites as skipped=N and stays green", async () => {
    const r = await runGate({
      stdout:
        `${probed(SIX_COVERED)}\n${selfSkips(FIVE_UNCOVERED)}\n` +
        `${probed(["caltex-landing", "la-homelessness-youth"])}\n${writeSummary(13, 0)}\n`,
      exit: 0,
    });
    expect(r.code).toBe(0);
    expect(r.out).not.toContain("::error::");
    expect(r.out).toContain("FLEET_FORM_E2E skipped=5");
    expect(r.out).toContain("::warning::");
  });

  // #1610: /health drops forms.testMode on every site (a starter regression). Every
  // site self-skips and is still written, so nothing else reds; this run probed
  // nothing end to end and must.
  it("FAILS when every site self-skipped and none was probed", async () => {
    const all = [...SIX_COVERED, ...FIVE_UNCOVERED];
    const r = await runGate({ stdout: `${selfSkips(all)}\n${writeSummary(11, 0)}\n`, exit: 0 });
    expect(r.code).not.toBe(0);
    expect(r.out).toContain("FLEET_FORM_E2E probed=0");
    expect(r.out).toContain(
      "::error::fleet form-e2e probed no site end to end: 11 of 11 self-skipped",
    );
  });

  it("one probed site among self-skips is the rollout warning, not red", async () => {
    const r = await runGate({
      stdout: `${probed(["espada"])}\n${selfSkips(FIVE_UNCOVERED)}\n${writeSummary(6, 0)}\n`,
      exit: 0,
    });
    expect(r.code).toBe(0);
    expect(r.out).toContain("FLEET_FORM_E2E probed=1");
  });

  it("a probe that ran and failed (warn) counts as probed", async () => {
    const warn = resultBlock("warn", "espada", "form-e2e: synthetic submission failed — POST 500");
    const r = await runGate({
      stdout: `${warn}\n${selfSkips(FIVE_UNCOVERED)}\n${writeSummary(6, 0)}\n`,
      exit: 1,
    });
    expect(r.code).toBe(0);
    expect(r.out).toContain("FLEET_FORM_E2E probed=1");
  });

  // #1669 (W6). `runOneAudit` writes a form-e2e that THREW (Chromium missing, say)
  // as status `fail`, "unexpected error". Such a site was written but never driven,
  // so a sweep where every site threw probed nothing and must red here.
  it("FAILS when every site's form-e2e threw: fail rows are not probes", async () => {
    const thrown = SIX_COVERED.map((s) =>
      resultBlock(
        "fail",
        s,
        "form-e2e: unexpected error — Error: browserType.launch: Executable doesn't exist",
      ),
    ).join("\n");
    const r = await runGate({ stdout: `${thrown}\n${writeSummary(6, 0)}\n`, exit: 1 });
    expect(r.out).toContain("FLEET_FORM_E2E probed=0");
    expect(r.code).not.toBe(0);
    expect(r.out).toContain("::error::fleet form-e2e probed no site end to end");
  });

  // #1669 (W5, W3). Only a form-e2e row at the start of a line is a probe: another
  // audit's pass row, or a form-e2e row quoted indented inside some other output,
  // is not one.
  it("FAILS when the only pass rows are another audit's or an indented quote", async () => {
    const all = [...SIX_COVERED, ...FIVE_UNCOVERED];
    const otherAudit = `${"lighthouse".padEnd(12)} ${"pass".padEnd(5)} x\n  lighthouse: perf 98`;
    const quoted = `  ${"form-e2e".padEnd(12)} ${"pass".padEnd(5)} espada`;
    const r = await runGate({
      stdout: `${selfSkips(all)}\n${otherAudit}\n${quoted}\n${writeSummary(11, 0)}\n`,
      exit: 0,
    });
    expect(r.out).toContain("FLEET_FORM_E2E probed=0");
    expect(r.code).not.toBe(0);
    expect(r.out).toContain(
      "::error::fleet form-e2e probed no site end to end: 11 of 11 self-skipped",
    );
  });

  // Emitted on EVERY run, zero included — for the same reason
  // FLEET_SMOKE_UNMEASURED is. A marker that only prints when non-zero cannot
  // tell "nobody self-skipped" from "the counter stopped matching".
  it("emits skipped=0 on a fully covered sweep rather than staying silent", async () => {
    const r = await runGate({
      stdout: `${probed(SIX_COVERED)}\n${writeSummary(13, 0)}\n`,
      exit: 0,
    });
    expect(r.code).toBe(0);
    expect(r.out).toContain("FLEET_FORM_E2E skipped=0");
  });

  // Pre-existing gate: an absent summary means the run died before write-back.
  it("still FAILS when the run crashed before any write summary", async () => {
    const r = await runGate({ stdout: `boom\n`, exit: 1 });
    expect(r.code).not.toBe(0);
    expect(r.out).toContain("printed no write summary");
  });
});

describe("fleet-form-e2e — an uncovered site is named, not only counted (#779)", () => {
  it("names every self-skipped site on the FLEET_FORM_E2E_UNCOVERED line and in the warning", async () => {
    const r = await runGate({
      stdout: `${probed(SIX_COVERED)}\n${selfSkips(FIVE_UNCOVERED)}\n${writeSummary(11, 0)}\n`,
      exit: 0,
    });
    expect(r.code).toBe(0);
    expect(r.out).toContain(`FLEET_FORM_E2E_UNCOVERED sites=${FIVE_UNCOVERED.join(",")}`);
    const warning = r.out.split("\n").find((l) => l.includes("self-skipped")) ?? "";
    for (const site of FIVE_UNCOVERED) expect(warning).toContain(site);
  });

  it("does not name a probed site as uncovered", async () => {
    const r = await runGate({
      stdout: `${probed(SIX_COVERED)}\n${selfSkips(["revogen"])}\n${writeSummary(7, 0)}\n`,
      exit: 0,
    });
    expect(r.out).toContain("FLEET_FORM_E2E_UNCOVERED sites=revogen\n");
  });

  it("prints sites=none on a fully covered sweep rather than staying silent", async () => {
    const r = await runGate({
      stdout: `${probed(SIX_COVERED)}\n${writeSummary(6, 0)}\n`,
      exit: 0,
    });
    expect(r.out).toContain("FLEET_FORM_E2E_UNCOVERED sites=none");
  });
});

describe("fleet-form-e2e — an unreadable /health is named as unreadable, not undeclared (P1-68)", () => {
  /** A site whose /health could not be read, from the audit's own summary builder. */
  const unreadable = (site: string, reason = "timed out after 10s"): string =>
    resultBlock("skip", site, formE2eHealthUnreadableSummary(reason));
  /** What the writer files such a site under (#1698): kept, with the audit's reason. */
  const keptAs = (site: string, reason = "timed out after 10s") => ({
    slug: site,
    reason: `form-e2e: ${formE2eHealthUnreadableSummary(reason)}`,
  });

  // 2026-10-22: vineyard-custom-homes declares testMode, its /health timed out, and
  // the run listed it beside 29-navy and caltex as "no forms.testMode declaration".
  it("counts it as uncovered, names it with its reason, and keeps it out of the undeclared warning", async () => {
    const r = await runGate({
      stdout:
        `${probed(SIX_COVERED.filter((s) => s !== "vineyard-custom-homes"))}\n` +
        `${selfSkips(["29-navy", "caltex"])}\n${unreadable("vineyard-custom-homes")}\n` +
        `${writeSummary(7, 0, [keptAs("vineyard-custom-homes")])}\n`,
      exit: 0,
    });
    expect(r.code).toBe(0);
    expect(r.out).toContain("FLEET_FORM_E2E skipped=2 unreadable=1 total=8");
    expect(r.out).toContain(
      "FLEET_FORM_E2E_UNCOVERED sites=29-navy,caltex,vineyard-custom-homes\n",
    );
    const undeclared =
      r.out.split("\n").find((l) => l.includes("no forms.testMode declaration")) ?? "";
    expect(undeclared).toContain("2 of 8");
    expect(undeclared).not.toContain("vineyard-custom-homes");
    const health =
      r.out.split("\n").find((l) => l.startsWith("::warning::") && l.includes("/health")) ?? "";
    expect(health).toContain("1 of 8 site(s) not probed because their /health could not be read");
    expect(health).toContain("vineyard-custom-homes (timed out after 10s)");
  });

  it("names each unreadable site with its own reason when they are not adjacent", async () => {
    const r = await runGate({
      stdout:
        `${unreadable("espada", "HTTP 503")}\n${probed(["1836dig"])}\n` +
        `${unreadable("revogen")}\n` +
        `${writeSummary(1, 0, [keptAs("espada", "HTTP 503"), keptAs("revogen")])}\n`,
      exit: 0,
    });
    expect(r.code).toBe(0);
    expect(r.out).toContain("FLEET_FORM_E2E_UNCOVERED sites=espada,revogen\n");
    expect(r.out).toContain(": espada (HTTP 503), revogen (timed out after 10s).");
  });

  it("prints unreadable=0 on a sweep where every /health answered", async () => {
    const r = await runGate({
      stdout: `${probed(SIX_COVERED)}\n${writeSummary(6, 0)}\n`,
      exit: 0,
    });
    expect(r.out).toContain("FLEET_FORM_E2E skipped=0 unreadable=0 total=6");
    expect(r.out).not.toContain("/health could not be read");
  });

  it("still FAILS when no site was probed because every /health was unreadable, naming /health", async () => {
    const r = await runGate({
      stdout:
        `${SIX_COVERED.map((s) => unreadable(s, "HTTP 503")).join("\n")}\n` +
        `${writeSummary(
          0,
          0,
          SIX_COVERED.map((s) => keptAs(s, "HTTP 503")),
        )}\n`,
      exit: 0,
    });
    expect(r.code).not.toBe(0);
    // Counted once each, though the writer's kept line repeats the reason (#1698).
    expect(r.out).toContain("FLEET_FORM_E2E skipped=0 unreadable=6 total=6");
    // The write gate reds first, and its reason names the cause, not "not applicable".
    const error = r.out.split("\n").find((l) => l.startsWith("::error::")) ?? "";
    expect(error).toContain("had nothing new to write and kept its verdicts");
    expect(error).toContain("/health could not be read");
    expect(error).not.toContain("not applicable");
  });

  it("counts each unreadable site once beside the writer's kept line (#1698)", async () => {
    const r = await runGate({
      stdout:
        `${probed(SIX_COVERED.filter((s) => s !== "vineyard-custom-homes"))}\n` +
        `${unreadable("vineyard-custom-homes")}\n` +
        `${writeSummary(5, 0, [keptAs("vineyard-custom-homes")])}\n`,
      exit: 0,
    });
    expect(r.code).toBe(0);
    expect(r.out).toContain("FLEET_FORM_E2E skipped=0 unreadable=1 total=6");
  });
});

describe("fleet-form-e2e — a positive control runs before any client row is written (#779)", () => {
  const step = (label: string) => workflowSteps(workflow).findIndex((s) => s.label === label);

  it("runs the live-runner fixture test before the fleet sweep", () => {
    const control = step(POSITIVE_CONTROL_STEP);
    expect(control).toBeGreaterThan(-1);
    expect(control).toBeLessThan(step(FORM_E2E_STEP));
    expect(stepRunScript(workflow, POSITIVE_CONTROL_STEP)).toContain(
      "tests/audits/form-e2e-live-runner.test.ts",
    );
  });

  it("can stop the sweep: no continue-on-error and no if", () => {
    const s = workflowSteps(workflow)[step(POSITIVE_CONTROL_STEP)];
    expect(s).toBeDefined();
    expect(s?.continueOnError).toBeUndefined();
    expect(s?.if).toBeUndefined();
  });

  it("runs in the same job as the sweep, so a failed control cannot leave a sibling job sweeping", () => {
    const steps = workflowSteps(workflow);
    const control = steps[step(POSITIVE_CONTROL_STEP)];
    const sweep = steps[step(FORM_E2E_STEP)];
    expect(control?.job).toBeTruthy();
    expect(control?.job).toBe(sweep?.job);
  });

  it("nothing between the control and the sweep, nor the sweep itself, runs after a failure", () => {
    const steps = workflowSteps(workflow);
    const between = steps.slice(step(POSITIVE_CONTROL_STEP) + 1, step(FORM_E2E_STEP) + 1);
    expect(between.map((s) => s.label)).toContain(FORM_E2E_STEP);
    for (const s of between) expect(s.if).toBeUndefined();
  });

  it("runs the whole fixture file and cannot swallow its failure", () => {
    const script = stepRunScript(workflow, POSITIVE_CONTROL_STEP);
    expect(script).not.toMatch(/\|\||--passWithNoTests|\s-t\s|--testNamePattern|--bail/);
  });

  const runControl = async (exit: number, report: Record<string, unknown> = PASSED_REPORT) => {
    const dir = await mkdtemp(join(tmpdir(), "fleet-form-e2e-control-"));
    const bin = join(dir, "bin");
    await mkdir(bin, { recursive: true });
    await writeFile(
      join(bin, "pnpm"),
      `#!/bin/sh\ncat > form-e2e-control.json <<'JSON'\n${JSON.stringify(report)}\nJSON\nexit ${exit}\n`,
      "utf-8",
    );
    await chmod(join(bin, "pnpm"), 0o755);
    const script = stepRunScript(workflow, POSITIVE_CONTROL_STEP);
    return execFileAsync("bash", ["-e", "-c", script], {
      cwd: dir,
      env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ""}` },
    }).then(
      () => 0,
      (e: { code?: number }) => e.code ?? 1,
    );
  };

  it("exits 0 when the fixture test passes", async () => {
    expect(await runControl(0)).toBe(0);
  });

  it("exits non-zero when the fixture test fails, which stops the job before the sweep", async () => {
    expect(await runControl(1)).not.toBe(0);
  });

  it("exits non-zero when every fixture test was skipped, because a control that measured nothing is not a pass", async () => {
    expect(
      await runControl(0, { ...PASSED_REPORT, numPassedTests: 0, numPendingTests: 22 }),
    ).not.toBe(0);
  });

  it("exits non-zero when the fixture ran no test at all", async () => {
    expect(await runControl(0, { ...PASSED_REPORT, numPassedTests: 0 })).not.toBe(0);
  });

  it("exits non-zero when the report says the run did not succeed", async () => {
    expect(await runControl(0, { ...PASSED_REPORT, success: false })).not.toBe(0);
  });

  it("exits non-zero when any fixture test was skipped or left todo", async () => {
    expect(await runControl(0, { ...PASSED_REPORT, numPendingTests: 1 })).not.toBe(0);
    expect(await runControl(0, { ...PASSED_REPORT, numTodoTests: 1 })).not.toBe(0);
  });

  it("carries no store credentials and does not arm the live runner", () => {
    const s = workflowSteps(workflow)[step(POSITIVE_CONTROL_STEP)];
    expect(s).toBeDefined();
    expect(s?.source).not.toContain("TURSO_");
    expect(s?.source).not.toContain("REDDOOR_FORM_E2E_LIVE");
  });
});
