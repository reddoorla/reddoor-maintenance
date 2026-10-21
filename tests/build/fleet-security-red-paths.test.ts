import { describe, it, expect } from "vitest";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { join } from "node:path";
import {
  runProtectionAuditCommand,
  type ProtectionAuditDeps,
} from "../../src/cli/commands/protection-audit.js";
import { desiredRuleset, FLEET_RULESET_NAME } from "../../src/github/rulesets.js";
import { stepRunScript, workflowPath } from "./_helpers/workflow-source.js";

const execFileAsync = promisify(execFile);

/**
 * #1612, from the P1-33 negative-control sweep: two fleet-security steps had no
 * red path.
 *
 * - `renovate-dispatch`: a CLI that crashed before its summary printed
 *   `<no summary — see output above>` and exited 0, and `failed=2` raised only a
 *   warning. Either way the sites flagged with critical or high vulns got no
 *   Renovate run, and nothing said so but a log line.
 * - `protection-audit`: an org listing of `200 []` printed `gaps=0 … total=0`
 *   and exited 0.
 *
 * Each step's own shell runs here, extracted byte for byte, with the CLI it
 * calls replaced by a stub that prints a given output and exits with a given
 * code. The protection-audit outputs come from the real command.
 */

const WF = "fleet-security.yml";
const DISPATCH_STEP = "Trigger Renovate for sites with actionable vulnerabilities";
const PROTECTION_STEP = "Protection coverage audit (org-wide)";
const CLOSE_STEP = "Close the protection-gap issue on a clean sweep";
const OPEN_STEP = "Open/update the protection-gap tracking issue";
const UNMEASURED_STEP = "Fail the run when the protection sweep verified no repo";

async function runStep(opts: {
  step: string;
  cliOutput: string;
  cliCode: number;
  env?: Record<string, string>;
  files?: Record<string, string>;
}): Promise<{ code: number; out: string }> {
  const wf = await readFile(workflowPath(WF), "utf-8");
  const script = stepRunScript(wf, opts.step).replace(/\$\{\{[^}]*\}\}/g, "STUB_EXPR");
  const dir = await mkdtemp(join(tmpdir(), "fleet-security-red-"));
  await mkdir(join(dir, "dist", "cli"), { recursive: true });
  await writeFile(join(dir, "cli-output.txt"), opts.cliOutput, "utf-8");
  // The step runs `node dist/cli/bin.js …` from the checkout root.
  await writeFile(
    join(dir, "dist", "cli", "bin.js"),
    `process.stdout.write(require("node:fs").readFileSync(${JSON.stringify(
      join(dir, "cli-output.txt"),
    )}, "utf-8") + "\\n");\nprocess.exit(${opts.cliCode});\n`,
    "utf-8",
  );
  for (const [name, body] of Object.entries(opts.files ?? {})) {
    await writeFile(join(dir, name), body, "utf-8");
  }
  // A gh that fails loudly: none of these steps may reach it.
  await mkdir(join(dir, "bin"), { recursive: true });
  await writeFile(join(dir, "bin", "gh"), "#!/bin/sh\necho gh-called >&2\nexit 1\n", {
    mode: 0o755,
  });
  const env = {
    ...process.env,
    PATH: `${join(dir, "bin")}:${process.env.PATH ?? ""}`,
    RUNNER_TEMP: dir,
    ...opts.env,
  };
  try {
    const r = await execFileAsync("bash", ["-e", "-c", script], { cwd: dir, env });
    return { code: 0, out: r.stdout + r.stderr };
  } catch (e) {
    const err = e as { code?: number; stdout?: string; stderr?: string };
    return { code: err.code ?? 1, out: (err.stdout ?? "") + (err.stderr ?? "") };
  }
}

describe("fleet-security: renovate-dispatch has a red path (#1612)", () => {
  // The tail of last night's real output (run 39554147850, 2026-10-20 11:13pm PT), verbatim:
  // the known-good input.
  const LAST_NIGHT = [
    "skipped (open Renovate PR)    reddoorla/williamson-homes (critical=0 high=2) — Williamson Homes",
    "RENOVATE_DISPATCH_SUMMARY dispatched=0 skipped=15 failed=0",
    "AUTO_FIX_ATTEMPTS_SUMMARY written=0 failed=0",
  ].join("\n");

  it("stays green on last night's real summary", async () => {
    const r = await runStep({ step: DISPATCH_STEP, cliOutput: LAST_NIGHT, cliCode: 0 });
    expect(r.code).toBe(0);
    expect(r.out).toContain(
      "renovate-dispatch: RENOVATE_DISPATCH_SUMMARY dispatched=0 skipped=15 failed=0",
    );
    expect(r.out).not.toContain("::error::");
  });

  it("goes red when the CLI crashes before its summary", async () => {
    const r = await runStep({
      step: DISPATCH_STEP,
      cliOutput:
        "Error: SERVER_ERROR: HTTP 503\n    at readFleetRoster (dist/fleet/roster.js:41:11)",
      cliCode: 1,
    });
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/^::error::renovate-dispatch printed no summary/m);
  });

  it("goes red when the CLI skips for want of a token, which prints no summary either", async () => {
    const r = await runStep({
      step: DISPATCH_STEP,
      cliOutput: "renovate-dispatch skipped: no GH_TOKEN (fleet dispatch) configured.",
      cliCode: 0,
    });
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/^::error::renovate-dispatch printed no summary/m);
  });

  it("goes red when a repo failed to dispatch", async () => {
    const r = await runStep({
      step: DISPATCH_STEP,
      cliOutput: [
        "FAILED                       reddoorla/espada (critical=0 high=8) — Espada",
        "  ↳ reddoorla/espada: HTTP 403",
        "RENOVATE_DISPATCH_SUMMARY dispatched=3 skipped=11 failed=1",
      ].join("\n"),
      cliCode: 0,
    });
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/^::error::renovate-dispatch: 1 repo\(s\) failed to dispatch/m);
  });
});

describe("fleet-security: protection-audit refuses an empty org listing (#1612)", () => {
  const FRESH = new Date().toISOString();
  const deps = (names: string[]): ProtectionAuditDeps => ({
    listOrgRepos: async () =>
      names.map((name) => ({
        name,
        visibility: "public",
        archived: false,
        secretScanning: "enabled",
        pushProtection: "enabled",
      })),
    listRepoRulesets: async () => [{ id: 1, name: FLEET_RULESET_NAME }],
    getRuleset: async () => ({ ...desiredRuleset("ci / ci"), id: 1 }),
    workflowHealth: async () => ({ present: true, state: "active", lastSuccessAt: FRESH }),
    dependencyDashboard: async () => ({ present: true, blockedBranches: [], unknownSections: [] }),
    branchTip: async () => null,
    openSecretAlerts: async () => 0,
    renovateMergeWindow: async () => ({ merges: [], truncated: false }),
    repoTextFile: async () => null,
    listWorkflowPaths: async () => [],
    defaultBranch: async () => "main",
    branchRequiredChecks: async () => null,
  });

  it("the step fails on the real command's output for a 200 [] listing", async () => {
    const real = await runProtectionAuditCommand({ org: "reddoorla" }, deps([]));
    const r = await runStep({
      step: PROTECTION_STEP,
      cliOutput: real.output,
      cliCode: real.code,
      env: { GH_TOKEN: "ghs_stub" },
    });
    expect(r.code).not.toBe(0);
  });

  it("and the close step, fed that output, closes nothing", async () => {
    const real = await runProtectionAuditCommand({ org: "reddoorla" }, deps([]));
    const r = await runStep({
      step: CLOSE_STEP,
      cliOutput: "",
      cliCode: 0,
      files: { "protection.out": real.output },
    });
    expect(r.code).toBe(0);
    expect(r.out).toContain("no verified clean sweep in the output — not closing anything");
  });

  // Review round 1: before this, the open step filed "Fleet protection coverage gap" on an
  // UNMEASURED sweep with "see run output" and no GAP line, which the close step never closes.
  it("the open step files no posture issue on that output (its gh would fail if called)", async () => {
    const real = await runProtectionAuditCommand({ org: "reddoorla" }, deps([]));
    const r = await runStep({
      step: OPEN_STEP,
      cliOutput: "",
      cliCode: 0,
      files: { "protection.out": real.output },
    });
    expect(r.code).toBe(0);
    expect(r.out).not.toContain("gh-called");
    expect(r.out).toContain("protection-audit verified no repo; not filing a coverage gap.");
  });

  it("instead the run goes red, so the nightly-failure issue carries it", async () => {
    const real = await runProtectionAuditCommand({ org: "reddoorla" }, deps([]));
    const r = await runStep({
      step: UNMEASURED_STEP,
      cliOutput: "",
      cliCode: 0,
      files: { "protection.out": real.output },
    });
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/^::error::protection-audit verified no repo/m);
  });

  it("a sweep with real gaps leaves that step green: the gap issue speaks for it", async () => {
    const gappy: ProtectionAuditDeps = { ...deps(["espada"]), listRepoRulesets: async () => [] };
    const real = await runProtectionAuditCommand({ org: "reddoorla" }, gappy);
    expect(real.code).toBe(1);
    expect(real.output).toContain("PROTECTION_AUDIT gaps=1 covered=0 skipped=0 total=1");
    expect(real.output).not.toContain("PROTECTION_AUDIT_UNMEASURED");
    const r = await runStep({
      step: UNMEASURED_STEP,
      cliOutput: "",
      cliCode: 0,
      files: { "protection.out": real.output },
    });
    expect(r.code).toBe(0);
  });

  it("a clean one-repo sweep still passes the step (control)", async () => {
    const real = await runProtectionAuditCommand({ org: "reddoorla" }, deps(["espada"]));
    const r = await runStep({
      step: PROTECTION_STEP,
      cliOutput: real.output,
      cliCode: real.code,
      env: { GH_TOKEN: "ghs_stub" },
    });
    expect(r.code).toBe(0);
  });
});
