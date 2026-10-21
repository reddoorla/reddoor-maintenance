import { describe, it, expect, beforeAll } from "vitest";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, writeFile, chmod, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { join } from "node:path";
import { stepRunScript, workflowPath, workflowSteps } from "./_helpers/workflow-source.js";

const execFileAsync = promisify(execFile);

/**
 * THE CLOSE THAT COULD FIRE ON NOTHING.
 *
 * `release-health` runs two independent guards, each filing and auto-closing
 * its own tracking issue. Guard 2 reads the release workflow's newest decisive
 * run on main; when there is nothing to judge (an empty run list, or an API
 * error) it stays deliberately GREEN — "a broken query must not masquerade as
 * a broken pipeline" — and sets `red=no`.
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
# What real gh does on an HTTP error: --jq is skipped, the error JSON goes to
# STDOUT and only the summary to stderr (checked against gh 2.89, a 404).
if [ "$1" = "api" ] && [ -n "$GH_API_FAIL" ]; then
  printf '%s' '{"message":"Resource not accessible by integration","status":"403"}'
  echo "gh: Resource not accessible by integration (HTTP 403)" >&2; exit 1
fi
if [ "$1" = "api" ] && [ -n "$GH_API_JSON" ]; then
  # Real jq over a real-shaped response, through the step's OWN --jq filter, so
  # the filter is under test and not a canned string standing in for it.
  while [ $# -gt 0 ]; do if [ "$1" = "--jq" ]; then shift; filter="$1"; fi; shift; done
  printf '%s' "$GH_API_JSON" | jq -r "$filter"; exit $?
fi
if [ "$1" = "api" ]; then printf '%s' "$GH_API_OUT"; exit 0; fi
if [ "$1" = "issue" ] && [ "$2" = "list" ]; then printf '%s\\n' "$GH_ISSUES"; exit 0; fi
if [ "$1" = "issue" ] && [ "$2" = "close" ]; then echo "CLOSED $3"; exit 0; fi
if [ "$1" = "issue" ] && [ "$2" = "create" ]; then printf '%s\n' "$6" > "$RUNNER_TEMP/created_body"; echo "CREATED"; exit 0; fi
echo "unexpected gh $*" >&2
exit 2
`;

/** `npm view <pkg> version`, canned. */
const NPM_STUB = `#!/bin/sh
printf '%s\\n' "$NPM_VERSION"
`;

type StepEnv = {
  outputs?: Record<string, string>;
  GH_API_OUT?: string;
  GH_API_JSON?: string;
  GH_API_FAIL?: string;
  GH_ISSUES?: string;
  NPM_VERSION?: string;
};

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
function interpolate(script: string, outputs: Record<string, string> = {}): string {
  return script.replace(/\$\{\{([^}]*)\}\}/g, (_m, expr: string) => {
    const name = expr.trim();
    if (name === "github.repository") return "reddoorla/reddoor-maintenance";
    if (name === "github.server_url") return "https://github.com";
    if (name === "github.run_id") return "9";
    if (name in outputs) return outputs[name]!;
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

  const script = interpolate(stepRunScript(wf, stepName), env.outputs);
  try {
    const { stdout, stderr } = await execFileAsync("bash", ["-e", "-c", script], {
      cwd: d,
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH ?? ""}`,
        RUNNER_TEMP: d,
        GITHUB_OUTPUT: join(d, "github_output"),
        GH_API_OUT: env.GH_API_OUT ?? "",
        GH_API_JSON: env.GH_API_JSON ?? "",
        GH_API_FAIL: env.GH_API_FAIL ?? "",
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
    // A FINDING, not a crash: the step exits 0 and hands `red=yes` on. The
    // run-failure pair keys on `failure()` ahead of "Fail when unhealthy", which
    // is only "the checker broke" while a finding exits 0. An `exit 1` here
    // would skip the release-failing issue and file "check failing" instead.
    expect(check.code).toBe(0);
    expect(await readFile(join(check.dir, "github_output"), "utf-8")).toContain("red=yes\n");

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
    // Same invariant as guard 2 above: a finding exits 0 and sets `behind=yes`,
    // so the npm-drift issue files and the run-failure issue does not.
    expect(check.code).toBe(0);
    expect(await readFile(join(check.dir, "github_output"), "utf-8")).toContain("behind=yes\n");

    const close = await runStep(DRIFT_CLOSE, { GH_ISSUES: "7" }, check.dir);
    expect(close.out).not.toContain("CLOSED");
  });
});

describe("release-health — its own run failing files an issue, and a finding does not", () => {
  // A hang to the 5-minute job timeout used to file nothing: every open step
  // keyed on a finding, and a cancelled run is not a finding (P1-15). The
  // run-failure pair now fires on the checker itself going red or being
  // cancelled. It must sit AHEAD of "Fail when unhealthy": that step is what
  // turns a finding into a red run, and a run-failure step behind it would file
  // "the check is failing" on top of every npm-drift or release-failing issue.
  const OPEN = "Open/update the release-health-run-failing tracking issue";
  const CLOSE = "Close the release-health-run-failing issue on recovery";
  const FAIL = "Fail when unhealthy";

  it("has the pair, ahead of the step that reds the run on a finding", () => {
    const labels = workflowSteps(wf).map((s) => s.label);
    expect(labels).toContain(OPEN);
    expect(labels).toContain(CLOSE);
    expect(labels).toContain(FAIL);
    expect(labels.indexOf(OPEN)).toBeLessThan(labels.indexOf(FAIL));
    expect(labels.indexOf(CLOSE)).toBeLessThan(labels.indexOf(FAIL));
  });

  it("files under its own title, distinct from both finding issues", () => {
    const script = stepRunScript(wf, OPEN);
    expect(script).toContain('title="Daily release-health check failing"');
    expect(stepRunScript(wf, CLOSE)).toContain('title="Daily release-health check failing"');
  });
});

describe("release-health — guard 2 reads the runs a broken pipeline actually leaves (#1614)", () => {
  // The release workflow's run list, newest first, in the shape
  // `/actions/workflows/release.yml/runs` returns. Fed through the step's own
  // `--jq` by the stub, so the conclusion filter is what is being tested.
  const runs = (...conclusions: (string | null)[]): string =>
    JSON.stringify({
      workflow_runs: conclusions.map((c, i) => ({
        status: c === null ? "in_progress" : "completed",
        conclusion: c,
        html_url: `https://github.com/reddoorla/reddoor-maintenance/actions/runs/${100 - i}`,
        head_sha: `sha${i}`,
      })),
    });
  const output = (dir: string) => readFile(join(dir, "github_output"), "utf-8");

  // PASS CONTROL first, through the new path: the shape of the real history on
  // 2026-10-21 (one run in flight, then green, with an older failure and some
  // cancellations behind it) must stay green and still arm the close.
  it("a green newest completed run stays green and still closes", async () => {
    const check = await runStep(RELSTATE_STEP, {
      GH_API_JSON: runs(null, "success", "cancelled", "failure", "success"),
    });
    expect(check.code).toBe(0);
    expect(check.out).not.toContain("::error::");
    expect(await output(check.dir)).toContain("red=no\n");
    const close = await runStep(RELSTATE_CLOSE, { GH_ISSUES: "42" }, check.dir);
    expect(close.out).toContain("CLOSED 42");
  });

  it("an older failure behind a newer success is superseded", async () => {
    const check = await runStep(RELSTATE_STEP, { GH_API_JSON: runs("success", "failure") });
    expect(await output(check.dir)).toContain("red=no\n");
  });

  // Input 1. GitHub reports a workflow file it cannot even start (invalid YAML,
  // a blocked action) as `startup_failure`. That run published nothing; it is
  // a verdict, and the newest one.
  it("a startup_failure newest run is red, not skipped past to an older success", async () => {
    const check = await runStep(RELSTATE_STEP, { GH_API_JSON: runs("startup_failure", "success") });
    expect(check.code).toBe(0); // a finding, not a crash — see the guard-2 case above
    expect(check.out).toContain("::error::");
    const out = await output(check.dir);
    expect(out).toContain("red=yes\n");
    expect(out).toContain("concl=startup_failure\n");
    const close = await runStep(RELSTATE_CLOSE, { GH_ISSUES: "42" }, check.dir);
    expect(close.out).not.toContain("CLOSED");
  });

  // Input 2. Thirty completed runs and not one reached a verdict. That is not
  // "nothing to judge" — the API answered, and the answer is that no release
  // has finished in thirty pushes.
  it("a window of completed runs that are all cancelled is red", async () => {
    const check = await runStep(RELSTATE_STEP, {
      GH_API_JSON: runs(...Array<string>(30).fill("cancelled")),
    });
    expect(check.code).toBe(0);
    expect(check.out).toContain("::error::");
    expect(check.out).toContain("none of the 30 completed release runs");
    expect(await output(check.dir)).toContain("red=yes\n");
    const close = await runStep(RELSTATE_CLOSE, { GH_ISSUES: "42" }, check.dir);
    expect(close.out).not.toContain("CLOSED");
  });

  it("skipped and action_required count as no verdict too, not as green", async () => {
    const check = await runStep(RELSTATE_STEP, {
      GH_API_JSON: runs(null, "skipped", "action_required", "cancelled"),
    });
    expect(await output(check.dir)).toContain("red=yes\n");
  });

  // The silent path that stays: the API answered with no runs at all (a fresh
  // repo, or the workflow renamed). Nothing to judge, and no alarm.
  it("an empty run list still stays silent and arms no close", async () => {
    const check = await runStep(RELSTATE_STEP, { GH_API_JSON: runs() });
    expect(check.code).toBe(0);
    expect(check.out).toContain("no decisive release run on main");
    expect(check.out).not.toContain("::error::");
    expect(await output(check.dir)).toContain("red=no\n");
    const close = await runStep(RELSTATE_CLOSE, { GH_ISSUES: "42" }, check.dir);
    expect(close.out).not.toContain("CLOSED");
  });

  // Input 3, decided: an API error stays green (a broken query must not
  // masquerade as a broken pipeline) but is no longer silent — it leaves a
  // warning on the run naming that guard 2 was not judged.
  it("an API error stays green, arms no close, and says guard 2 was not judged", async () => {
    const check = await runStep(RELSTATE_STEP, { GH_API_FAIL: "1" });
    expect(check.code).toBe(0);
    expect(check.out).not.toContain("::error::");
    // The error JSON gh printed must not become a conclusion.
    expect(await output(check.dir)).toContain("concl=none\n");
    expect(check.out).toContain("::warning::");
    expect(check.out).toContain("guard 2 was not judged");
    expect(await output(check.dir)).toContain("red=no\n");
    const close = await runStep(RELSTATE_CLOSE, { GH_ISSUES: "42" }, check.dir);
    expect(close.out).not.toContain("CLOSED");
  });

  // The issue the finding files must describe THIS finding: a startup_failure
  // run has no steps to read, and a window of cancellations has no failing run.
  const OPEN_RELEASE = "Open/update the release-failing tracking issue";
  const filedBody = async (concl: string): Promise<string> => {
    const r = await runStep(OPEN_RELEASE, {
      GH_ISSUES: "",
      outputs: {
        "steps.relstate.outputs.concl": concl,
        "steps.relstate.outputs.url": "https://github.com/x/runs/1",
        "steps.relstate.outputs.sha": "deadbee",
      },
    });
    expect(r.out).toContain("CREATED");
    return readFile(join(r.dir, "created_body"), "utf-8");
  };

  it("files a body that names a startup_failure for what it is", async () => {
    const body = await filedBody("startup_failure");
    expect(body).toContain("could not start the workflow");
    expect(body).not.toContain("Create release PR or publish");
  });

  it("files a body that says no run reached a verdict, not that one failed", async () => {
    const body = await filedBody("no_verdict_in_30");
    expect(body).toContain("none of the last 30 completed runs reached a verdict");
    expect(body).not.toContain("Create release PR or publish");
  });

  it("still points a real failure at the publish step", async () => {
    const body = await filedBody("failure");
    expect(body).toContain("**failure**");
    expect(body).toContain("Create release PR or publish");
    expect(body).toContain("https://github.com/x/runs/1");
  });
});
