import { describe, it, expect, beforeAll } from "vitest";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, writeFile, chmod, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { join } from "node:path";
import { stepRunScript, workflowPath } from "./_helpers/workflow-source.js";

const execFileAsync = promisify(execFile);

/**
 * THE CLOSE THAT COULD FIRE ON NOTHING.
 *
 * `release-health` runs two independent guards, each filing and auto-closing
 * its own tracking issue. Guard 2 reads the release workflow's newest decisive
 * run on main; when the API returns nothing at all it stays deliberately
 * SILENT — "a broken query must not masquerade as a broken pipeline" — and sets
 * `red=no`.
 *
 * `red=no` is also what a genuinely green pipeline sets. And the close step is
 * gated on `steps.relstate.outputs.red != 'yes'`. So an empty query, a `gh api`
 * failure, or a step that died before writing its outputs at all would close
 * "Release workflow is failing on main" with a cheerful "green on main again"
 * — on zero evidence, while the release pipeline may still be red. The filing
 * side's silence is correct; the close side inheriting it is not.
 *
 * The fix is `fleet-security.yml`'s idiom, whose comment already says it: "Step
 * outcome alone is not proof." Each check step now writes a POSITIVE marker
 * only for what it actually observed, and each close step refuses to close
 * without one.
 *
 * A gate that refuses everything is not a gate, so in both guards the case that
 * CLOSES comes first, and it is driven end-to-end — the real check step writes
 * the marker, the real close step reads it back out of the same directory.
 */

const RELSTATE_STEP = "Check the release workflow's own state on main";
const RELSTATE_CLOSE = "Close the release-failing issue once it goes green";
const DRIFT_STEP = "Compare npm latest vs main version";
const DRIFT_CLOSE = "Close the drift issue once npm catches up";

let wf: string;

beforeAll(async () => {
  wf = await readFile(workflowPath("release-health.yml"), "utf-8");
});

/** A `gh` that answers only the two calls these steps make, and SHOUTS about
 *  any other — an unexpected subcommand silently returning "" would let a case
 *  pass for a step that no longer does what its name says. */
const GH_STUB = `#!/bin/sh
if [ "$1" = "api" ]; then printf '%s' "$GH_API_OUT"; exit 0; fi
if [ "$1" = "issue" ] && [ "$2" = "list" ]; then printf '%s\\n' "$GH_ISSUES"; exit 0; fi
if [ "$1" = "issue" ] && [ "$2" = "close" ]; then echo "CLOSED $3"; exit 0; fi
echo "unexpected gh $*" >&2
exit 2
`;

/** `npm view <pkg> version`, canned. */
const NPM_STUB = `#!/bin/sh
printf '%s\\n' "$NPM_VERSION"
`;

type StepEnv = { GH_API_OUT?: string; GH_ISSUES?: string; NPM_VERSION?: string };

/**
 * Do what Actions does to a `run:` block before bash ever sees it: expand `${{
 * … }}`. Not cosmetic — `${{` is a syntax error to bash (an invalid parameter
 * expansion), so a step carrying one cannot be executed at all until it is
 * substituted, and `release-health`'s guard-2 query carries `github.repository`.
 *
 * Unknown expressions THROW rather than expanding to "". A blanket blank would
 * let a future `${{ steps.x.outputs.y }}` quietly turn a real comparison into a
 * comparison against the empty string, and the test would still pass.
 */
function interpolate(script: string): string {
  return script.replace(/\$\{\{([^}]*)\}\}/g, (_m, expr: string) => {
    const name = expr.trim();
    if (name === "github.repository") return "reddoorla/reddoor-maintenance";
    throw new Error(`unhandled Actions expression in this step: \${{ ${name} }}`);
  });
}

/** Run one step's real `run:` block under `bash -e` (the shell Actions gives it)
 *  with `gh` and `npm` stubbed, in a scratch dir that stands in for RUNNER_TEMP.
 *  Pass an existing `dir` to run a second step against the first one's output —
 *  that chaining is what proves the marker a close step demands is a marker
 *  something actually writes. */
async function runStep(
  stepName: string,
  env: StepEnv = {},
  dir?: string,
): Promise<{ code: number; out: string; dir: string }> {
  const d = dir ?? (await mkdtemp(join(tmpdir(), "release-health-")));
  const bin = join(d, "bin");
  await mkdir(bin, { recursive: true });
  await writeFile(join(bin, "gh"), GH_STUB, "utf-8");
  await chmod(join(bin, "gh"), 0o755);
  await writeFile(join(bin, "npm"), NPM_STUB, "utf-8");
  await chmod(join(bin, "npm"), 0o755);
  // The drift step reads the checkout's own package.json via `node -p`.
  await writeFile(
    join(d, "package.json"),
    JSON.stringify({ name: "@reddoorla/maintenance", version: "1.2.3" }),
    "utf-8",
  );

  const script = interpolate(stepRunScript(wf, stepName));
  try {
    const { stdout, stderr } = await execFileAsync("bash", ["-e", "-c", script], {
      cwd: d,
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH ?? ""}`,
        RUNNER_TEMP: d,
        GITHUB_OUTPUT: join(d, "github_output"),
        GH_API_OUT: env.GH_API_OUT ?? "",
        GH_ISSUES: env.GH_ISSUES ?? "",
        NPM_VERSION: env.NPM_VERSION ?? "",
      },
    });
    return { code: 0, out: stdout + stderr, dir: d };
  } catch (e) {
    const err = e as { code?: number; stdout?: string; stderr?: string };
    return { code: err.code ?? 1, out: (err.stdout ?? "") + (err.stderr ?? ""), dir: d };
  }
}

/** What the step's own `--jq` produces: conclusion, url, head_sha, tab-separated. */
const decisiveRun = (conclusion: string): string =>
  `${conclusion}\thttps://github.com/reddoorla/reddoor-maintenance/actions/runs/1\tdeadbee`;

describe("release-health — a close needs positive evidence, not the absence of an alarm", () => {
  // THE PASS CONTROL, end to end: a real green decisive run, through the real
  // check step, into the real close step. Until this closes something, every
  // refusal below is a gate that refuses everything.
  it("closes the release-failing issue when the check step saw a green run", async () => {
    const check = await runStep(RELSTATE_STEP, { GH_API_OUT: decisiveRun("success") });
    expect(check.code).toBe(0);
    expect(check.out).not.toContain("::error::");

    const close = await runStep(RELSTATE_CLOSE, { GH_ISSUES: "42" }, check.dir);
    expect(close.code).toBe(0);
    expect(close.out).toContain("CLOSED 42");
    expect(close.out).toContain("closed #42");
  });

  // THE DEFECT. An empty query is the documented silent path on the FILING side
  // — and that silence stays. What must not survive is the same `red=no` arming
  // a "green again" close on an alarm that may still be true.
  it("REFUSES to close when the query came back empty", async () => {
    const check = await runStep(RELSTATE_STEP, { GH_API_OUT: "" });
    expect(check.code).toBe(0);
    expect(check.out).toContain("no decisive release run on main");
    expect(check.out).not.toContain("::error::"); // filing side unchanged: still silent

    const close = await runStep(RELSTATE_CLOSE, { GH_ISSUES: "42" }, check.dir);
    expect(close.code).toBe(0);
    expect(close.out).not.toContain("CLOSED");
    expect(close.out).toContain("not closing anything");
  });

  // The worst shape of all: the check step never ran, so its outputs are unset
  // and `red != 'yes'` is true by absence. No marker file exists at all.
  it("REFUSES to close when the check step never ran", async () => {
    const close = await runStep(RELSTATE_CLOSE, { GH_ISSUES: "42" });
    expect(close.code).toBe(0);
    expect(close.out).not.toContain("CLOSED");
    expect(close.out).toContain("not closing anything");
  });

  // A red pipeline must not leave a stale marker lying around for a later close.
  it("writes no healthy marker when the latest decisive run FAILED", async () => {
    const check = await runStep(RELSTATE_STEP, { GH_API_OUT: decisiveRun("failure") });
    expect(check.out).toContain("::error::");

    const close = await runStep(RELSTATE_CLOSE, { GH_ISSUES: "42" }, check.dir);
    expect(close.out).not.toContain("CLOSED");
  });

  // Guard 1 carries the same shape: its close is gated on `behind != 'yes'`,
  // which is also what an unset output reads as. PASS CONTROL first.
  it("closes the drift issue when npm was actually read and matches main", async () => {
    const check = await runStep(DRIFT_STEP, { NPM_VERSION: "1.2.3" });
    expect(check.code).toBe(0);
    expect(check.out).toContain("main=1.2.3 npm=1.2.3");

    const close = await runStep(DRIFT_CLOSE, { GH_ISSUES: "7" }, check.dir);
    expect(close.out).toContain("CLOSED 7");
  });

  it("REFUSES to close the drift issue when the drift check never ran", async () => {
    const close = await runStep(DRIFT_CLOSE, { GH_ISSUES: "7" });
    expect(close.code).toBe(0);
    expect(close.out).not.toContain("CLOSED");
    expect(close.out).toContain("not closing anything");
  });

  // npm behind main is guard 1's actual alarm — the marker must not be written.
  it("writes no drift marker while npm is behind main", async () => {
    const check = await runStep(DRIFT_STEP, { NPM_VERSION: "1.2.2" });
    expect(check.out).toContain("::error::");

    const close = await runStep(DRIFT_CLOSE, { GH_ISSUES: "7" }, check.dir);
    expect(close.out).not.toContain("CLOSED");
  });
});
