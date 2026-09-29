import { describe, it, expect, beforeAll } from "vitest";
import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  isScheduled,
  stepRunScript,
  workflowPath,
  workflowSteps,
  type WorkflowStep,
} from "./_helpers/workflow-source.js";

/**
 * WHEN THE ALARM IS ALLOWED TO SPEAK, AND FOR WHICH BRANCH.
 *
 * Two real misses on 2026-09-28, both in the `if:` lines of the tracking-issue
 * steps rather than in their shell:
 *
 * 1. fleet-lighthouse run 36451921171 hung its audit step to its 75-minute
 *    timeout, then hung "Sweep GitHub signals" (`if: always()`, no timeout)
 *    until GitHub's 6-hour job limit. The run ended CANCELLED. The open step was
 *    `if: failure()`, which is false on a cancelled run, so the red night filed
 *    nothing and was invisible. Worse, that `always()` step was still running
 *    inside the 5-minute post-cancel grace window, so even a `cancelled()` open
 *    step behind it would have been force-killed before it ran.
 * 2. A `workflow_dispatch` of time-travel on a PR branch went green and its
 *    `if: success()` close step closed #895 on `main`'s behalf while `main` was
 *    still broken. The open halves had the mirror-image hole: a branch's failure
 *    would file "main is failing".
 *
 * So this file does not grep for `cancelled()`. `failure() && cancelled()`
 * contains it and can never fire. It EVALUATES every open/close step's `if:`
 * under the scenarios that matter — failed on main, cancelled on main, green on
 * main, and each of those on a branch — with a small evaluator of the Actions
 * expression language, including the implicit `success() &&` that Actions adds
 * to any condition naming no status function. The evaluator is itself tested
 * first, against conditions whose Actions semantics are documented.
 *
 * The steps are DERIVED from `.github/workflows/*.yml` (any step whose run
 * calls `gh issue create` or `gh issue close`), and the "finds what it
 * polices" case pins the list, so a parser that matches nothing cannot pass.
 */

// ---------------------------------------------------------------------------
// A small evaluator for the subset of the Actions expression language these
// conditions use: || && ! == != ( ), 'strings', status functions and context
// paths. Anything outside the subset THROWS — an unrecognised context read as
// '' would quietly turn a condition false and make a gate look satisfied.
// ---------------------------------------------------------------------------

type Status = "success" | "failure" | "cancelled";
interface Scenario {
  name: string;
  status: Status;
  ref: string;
  /** What every `steps.<id>.outcome` / `.conclusion` reads as. */
  outcome: string;
  /** What every `steps.<id>.outputs.<x>` reads as. */
  output: string;
}

type Value = string | boolean;
const STATUS_FNS = ["success", "failure", "cancelled", "always"];

function tokenize(src: string): string[] {
  const tokens: string[] = [];
  const re = /\s*(\|\||&&|==|!=|!|\(|\)|'(?:[^']|'')*'|[A-Za-z_][\w.-]*)/y;
  let i = 0;
  while (i < src.length) {
    if (/^\s*$/.test(src.slice(i))) break;
    re.lastIndex = i;
    const m = re.exec(src);
    if (!m) throw new Error(`cannot tokenize ${JSON.stringify(src.slice(i))} in ${src}`);
    tokens.push(m[1]!);
    i = re.lastIndex;
  }
  return tokens;
}

function truthy(v: Value): boolean {
  return v !== false && v !== "";
}

function evaluate(expr: string, s: Scenario): boolean {
  const toks = tokenize(expr);
  let p = 0;
  const peek = () => toks[p];
  const take = (t?: string) => {
    const got = toks[p++];
    if (t !== undefined && got !== t) throw new Error(`expected ${t}, got ${got} in ${expr}`);
    return got!;
  };

  const resolve = (path: string): Value => {
    if (path === "github.ref") return s.ref;
    if (/^inputs\.[\w-]+$/.test(path)) return ""; // scheduled runs carry no inputs
    if (/^steps\.[\w-]+\.(outcome|conclusion)$/.test(path)) return s.outcome;
    if (/^steps\.[\w-]+\.outputs\.[\w-]+$/.test(path)) return s.output;
    throw new Error(`context ${path} is not modelled — extend the evaluator, do not guess`);
  };

  const primary = (): Value => {
    const t = take();
    if (t === "(") {
      const v = or();
      take(")");
      return v;
    }
    if (t.startsWith("'")) return t.slice(1, -1).replace(/''/g, "'");
    if (peek() === "(") {
      take("(");
      take(")");
      if (t === "success") return s.status === "success";
      if (t === "failure") return s.status === "failure";
      if (t === "cancelled") return s.status === "cancelled";
      if (t === "always") return true;
      throw new Error(`function ${t}() is not modelled`);
    }
    if (t === "true") return true;
    if (t === "false") return false;
    return resolve(t);
  };
  const unary = (): Value => (peek() === "!" ? (take(), !truthy(unary())) : primary());
  const cmp = (): Value => {
    const l = unary();
    if (peek() === "==" || peek() === "!=") {
      const op = take();
      const r = unary();
      // Actions compares strings case-insensitively.
      const eq =
        typeof l === "string" && typeof r === "string"
          ? l.toLowerCase() === r.toLowerCase()
          : l === r;
      return op === "==" ? eq : !eq;
    }
    return l;
  };
  const and = (): Value => {
    let v = cmp();
    while (peek() === "&&") {
      take();
      const r = cmp();
      v = truthy(v) ? r : v;
    }
    return v;
  };
  function or(): Value {
    let v = and();
    while (peek() === "||") {
      take();
      const r = and();
      v = truthy(v) ? v : r;
    }
    return v;
  }

  const v = or();
  if (p !== toks.length) throw new Error(`trailing tokens in ${expr}: ${toks.slice(p).join(" ")}`);
  // "A default status check of success() is applied unless you include one of
  // these functions." — Actions docs, Expressions › Status check functions.
  const namesStatus = toks.some((t, i) => STATUS_FNS.includes(t) && toks[i + 1] === "(");
  return namesStatus ? truthy(v) : s.status === "success" && truthy(v);
}

const MAIN = "refs/heads/main"; // `github.ref` of a `schedule` run: the default branch
const BRANCH = "refs/heads/fix/some-pr-branch";
const sc = (status: Status, ref: string, outcome: string, output: string): Scenario => ({
  name: `${status} on ${ref === MAIN ? "main" : "a branch"}`,
  status,
  ref,
  outcome,
  output,
});
const MAIN_FAILED = sc("failure", MAIN, "failure", "yes");
const MAIN_CANCELLED = sc("cancelled", MAIN, "cancelled", "yes");
const MAIN_GREEN = sc("success", MAIN, "success", "no");
const BRANCH_FAILED = sc("failure", BRANCH, "failure", "yes");
const BRANCH_CANCELLED = sc("cancelled", BRANCH, "cancelled", "yes");
const BRANCH_GREEN = sc("success", BRANCH, "success", "no");
/** A finding-keyed step (continue-on-error audit, step output) fires on a run
 *  that is otherwise green. */
const MAIN_FINDING = sc("success", MAIN, "failure", "yes");
const BRANCH_FINDING = sc("success", BRANCH, "failure", "yes");

describe("the expression evaluator reads conditions the way Actions does", () => {
  // POSITIVE CONTROLS, first on purpose: every verdict below is only as good as
  // these. Each line is a documented Actions semantic.
  it("status functions track the run's status", () => {
    expect(evaluate("failure()", MAIN_FAILED)).toBe(true);
    expect(evaluate("failure()", MAIN_CANCELLED)).toBe(false); // the 36451921171 miss
    expect(evaluate("cancelled()", MAIN_CANCELLED)).toBe(true);
    expect(evaluate("success()", MAIN_GREEN)).toBe(true);
    expect(evaluate("always()", MAIN_CANCELLED)).toBe(true);
    expect(evaluate("!cancelled()", MAIN_FAILED)).toBe(true);
    expect(evaluate("!cancelled()", MAIN_CANCELLED)).toBe(false);
  });

  it("an OR covers both states and an AND of the two covers neither", () => {
    expect(evaluate("failure() || cancelled()", MAIN_FAILED)).toBe(true);
    expect(evaluate("failure() || cancelled()", MAIN_CANCELLED)).toBe(true);
    expect(evaluate("failure() && cancelled()", MAIN_FAILED)).toBe(false);
    expect(evaluate("failure() && cancelled()", MAIN_CANCELLED)).toBe(false);
  });

  it("applies the implicit success() when no status function is named", () => {
    expect(evaluate("steps.x.outcome == 'failure'", MAIN_FINDING)).toBe(true);
    expect(evaluate("steps.x.outcome == 'failure'", MAIN_FAILED)).toBe(false);
    expect(evaluate("github.ref == 'refs/heads/main'", MAIN_CANCELLED)).toBe(false);
  });

  it("binds && tighter than || and honours parentheses", () => {
    expect(
      evaluate("failure() || cancelled() && github.ref == 'refs/heads/main'", BRANCH_FAILED),
    ).toBe(true);
    expect(
      evaluate("(failure() || cancelled()) && github.ref == 'refs/heads/main'", BRANCH_FAILED),
    ).toBe(false);
  });

  it("refuses a context it does not model rather than reading it as empty", () => {
    expect(() => evaluate("github.event_name == 'schedule'", MAIN_GREEN)).toThrow(/not modelled/);
  });
});

// ---------------------------------------------------------------------------
// The workflows.
// ---------------------------------------------------------------------------

interface Found extends WorkflowStep {
  file: string;
  scheduled: boolean;
}
const id = (s: Found) => `${s.file} › ${s.label}`;
const opens = (all: Found[]) => all.filter((s) => /\bgh issue create\b/.test(s.source));
const closes = (all: Found[]) => all.filter((s) => /\bgh issue close\b/.test(s.source));

/**
 * Open steps keyed on a FINDING, not on the run going red. Their `if:` reads a
 * step output or a continue-on-error step's outcome, so the job's status is
 * irrelevant to them and a cancelled run is not a finding — filing "protection
 * gap" or "npm is behind" because a step hung would assert a diagnosis nobody
 * made. The workflow's run-failure issue (fleet-security) or the job timeout
 * (release-health, 5 min) covers the hang. Named here, not inferred, so a new
 * run-failure step cannot opt out of the cancellation rule by accident.
 */
const FINDING_KEYED = new Set([
  "fleet-security.yml › Open/update the protection-gap tracking issue",
  "release-health.yml › Open/update the npm-drift tracking issue",
  "release-health.yml › Open/update the release-failing tracking issue",
]);

let all: Found[];

beforeAll(async () => {
  const dir = workflowPath(".");
  const files = (await readdir(dir)).filter((f) => f.endsWith(".yml")).sort();
  all = [];
  for (const file of files) {
    const wf = await readFile(join(dir, file), "utf-8");
    const scheduled = isScheduled(wf);
    for (const s of workflowSteps(wf)) all.push({ ...s, file, scheduled });
  }
});

describe("tracking-issue conditions — the instrument finds what it polices", () => {
  // If the step parser silently matched nothing, every rule below would pass on
  // an empty list. Pin the population so it cannot.
  it("finds every tracking-issue open and close step in .github/workflows", () => {
    expect(opens(all).map(id)).toEqual([
      "daily-reports.yml › Open/update the daily-reports-failing tracking issue",
      "fleet-db-backup.yml › Open/update the backup-failure tracking issue",
      "fleet-db-backup.yml › Open/update the quota tracking issue",
      "fleet-form-e2e.yml › Open/update the nightly-form-e2e-failure tracking issue",
      "fleet-lighthouse.yml › Open/update the nightly-failure tracking issue",
      "fleet-prismic-drift.yml › Open/update the nightly-failure tracking issue",
      "fleet-security.yml › Open/update the protection-gap tracking issue",
      "fleet-security.yml › Open/update the nightly-failure tracking issue",
      "fleet-smoke.yml › Open/update the nightly-smoke-failure tracking issue",
      "forms-deadletter-replay.yml › Open/update the replay-failure tracking issue",
      "release-health.yml › Open/update the npm-drift tracking issue",
      "release-health.yml › Open/update the release-failing tracking issue",
      "time-travel.yml › Open/update the time-travel tracking issue",
    ]);
    expect(closes(all).map(id)).toEqual([
      "daily-reports.yml › Close the daily-reports-failing issue on recovery",
      "fleet-db-backup.yml › Close the backup-failure issue on recovery",
      "fleet-db-backup.yml › Close the quota issue on recovery",
      "fleet-form-e2e.yml › Close the nightly-form-e2e-failure issue on recovery",
      "fleet-lighthouse.yml › Close the nightly-failure issue on recovery",
      "fleet-prismic-drift.yml › Close the nightly-failure issue on recovery",
      "fleet-security.yml › Close the protection-gap issue on a clean sweep",
      "fleet-security.yml › Close the nightly-failure issue on recovery",
      "fleet-smoke.yml › Close the nightly-smoke-failure issue on recovery",
      "forms-deadletter-replay.yml › Close the replay-failure issue on recovery",
      "release-health.yml › Close the drift issue once npm catches up",
      "release-health.yml › Close the release-failing issue once it goes green",
      "time-travel.yml › Close the time-travel issue on recovery",
    ]);
    for (const name of FINDING_KEYED) expect(opens(all).map(id)).toContain(name);
  });

  it("finds the scheduled steps that run past an earlier failure", () => {
    expect(runsPastFailure(all).map(id)).toEqual([
      "daily-reports.yml › Upload the rendered preview",
      "fleet-lighthouse.yml › id: app-token",
      "fleet-lighthouse.yml › Sweep GitHub signals to Turso",
    ]);
  });
});

/** Every scheduled, non-tracking-issue step whose `if:` lets it run after an
 *  earlier step failed — or, for `always()`, after the run was cancelled. */
function runsPastFailure(steps: Found[]): Found[] {
  return steps.filter(
    (s) =>
      s.scheduled &&
      s.if !== undefined &&
      /\b(always|failure|cancelled)\(\)/.test(s.if) &&
      !/\bgh issue (create|close)\b/.test(s.source),
  );
}

function offenders(steps: Found[], checks: Array<{ scenario: Scenario; want: boolean }>): string[] {
  const out: string[] = [];
  for (const s of steps) {
    for (const { scenario, want } of checks) {
      const got = evaluate(s.if ?? "success()", scenario);
      if (got !== want) {
        out.push(
          `${id(s)}: \`if: ${s.if ?? "(none)"}\` is ${got} when the run is ${scenario.name} (want ${want})`,
        );
      }
    }
  }
  return out;
}

describe("tracking-issue conditions — a red run on main always files, and only main's runs speak", () => {
  it("every run-failure open step fires on a failed OR cancelled run on main, and never on a branch", () => {
    const steps = opens(all).filter((s) => !FINDING_KEYED.has(id(s)));
    expect(
      offenders(steps, [
        { scenario: MAIN_FAILED, want: true },
        { scenario: MAIN_CANCELLED, want: true },
        { scenario: MAIN_GREEN, want: false },
        { scenario: BRANCH_FAILED, want: false },
        { scenario: BRANCH_CANCELLED, want: false },
      ]),
    ).toEqual([]);
  });

  it("every finding-keyed open step fires on its finding on main, and never on a branch", () => {
    const steps = opens(all).filter((s) => FINDING_KEYED.has(id(s)));
    expect(
      offenders(steps, [
        { scenario: MAIN_FINDING, want: true },
        { scenario: BRANCH_FINDING, want: false },
      ]),
    ).toEqual([]);
  });

  it("every close step closes on a green run on main, and never on a branch or a cancelled run", () => {
    expect(
      offenders(closes(all), [
        { scenario: MAIN_GREEN, want: true },
        { scenario: BRANCH_GREEN, want: false },
        { scenario: MAIN_CANCELLED, want: false },
      ]),
    ).toEqual([]);
  });
});

describe("a step that runs past a failure is bounded", () => {
  // 36451921171: an `if: always()` sweep with no timeout ran from 17:51 to
  // 22:38 — past the 6-hour job limit and through the whole 5-minute post-cancel
  // grace window, which is where the tracking-issue step needed to run.
  it("every such step in a scheduled workflow has a step or job timeout-minutes", () => {
    const unbounded = runsPastFailure(all)
      .filter((s) => s.timeoutMinutes === undefined && s.jobTimeoutMinutes === undefined)
      .map((s) => `${id(s)}: \`if: ${s.if}\` with no timeout-minutes on the step or its job`);
    expect(unbounded).toEqual([]);
  });

  // `always()` keeps a step running INTO a cancellation; the open step behind it
  // then competes for the same 5-minute grace window and loses — which is what
  // happened in 36451921171. So on a cancelled run on main, nothing ahead of a
  // run-failure open step may still be running. Evaluated, not grepped:
  // daily-reports' `inputs.preview_site && always()` upload cannot run on a
  // scheduled run, and is correctly not counted.
  it("no step ahead of a run-failure open step keeps running on a cancelled run", () => {
    const blocking: string[] = [];
    for (const open of opens(all).filter((s) => !FINDING_KEYED.has(id(s)))) {
      const jobSteps = all.filter((s) => s.file === open.file && s.job === open.job);
      for (const s of jobSteps.slice(0, jobSteps.indexOf(open))) {
        if (evaluate(s.if ?? "success()", MAIN_CANCELLED)) {
          blocking.push(
            `${id(s)}: \`if: ${s.if}\` keeps running after a cancel, ahead of "${open.label}"`,
          );
        }
      }
    }
    expect(blocking).toEqual([]);
  });
});

describe("a cancelled run's issue says it was cancelled", () => {
  // The open steps now fire on a cancelled run, but their bodies were written
  // for a failure ("the nightly X run failed", time-travel's wall-clock
  // diagnosis). EXECUTE each step's shell against a stub `gh` that echoes the
  // body it was handed, once per job status.
  const GH = `#!/bin/sh
case "$1 $2" in
  "issue list") exit 0 ;;
  "issue create") shift 2; while [ $# -gt 0 ]; do [ "$1" = "--body" ] && printf 'BODY<<%s>>\\n' "$2"; shift; done; exit 0 ;;
esac
exit 1
`;
  async function bodyFor(step: Found, jobStatus: string): Promise<string> {
    const wf = await readFile(workflowPath(step.file), "utf-8");
    const script = stepRunScript(wf, step.label).replace(/\$\{\{[^}]*\}\}/g, "STUB_EXPR");
    const dir = await mkdtemp(join(tmpdir(), "tracking-cancel-"));
    await mkdir(join(dir, "bin"));
    await writeFile(join(dir, "bin", "gh"), GH, "utf-8");
    await chmod(join(dir, "bin", "gh"), 0o755);
    const { stdout } = await promisify(execFile)("bash", ["-e", "-c", script], {
      cwd: dir,
      env: {
        ...process.env,
        PATH: `${join(dir, "bin")}:${process.env.PATH ?? ""}`,
        RUNNER_TEMP: dir,
        JOB_STATUS: jobStatus,
        DAYS: "90",
      },
    });
    const m = /BODY<<([\s\S]*?)>>/.exec(stdout);
    if (!m) throw new Error(`${id(step)} filed nothing:\n${stdout}`);
    return m[1]!;
  }
  const CANCELLED = "**This run was CANCELLED, not failed**";

  // POSITIVE CONTROL first: a failed run files its original body, unprefixed.
  it("a failed run's body is the failure text, unprefixed", async () => {
    for (const s of opens(all).filter((o) => !FINDING_KEYED.has(id(o)))) {
      const body = await bodyFor(s, "failure");
      expect(body, id(s)).toContain("Run: ");
      expect(body.startsWith(CANCELLED), id(s)).toBe(false);
    }
  });

  it("a cancelled run's body leads with CANCELLED, not failed", async () => {
    for (const s of opens(all).filter((o) => !FINDING_KEYED.has(id(o)))) {
      const body = await bodyFor(s, "cancelled");
      expect(body.startsWith(CANCELLED), id(s)).toBe(true);
      expect(body, id(s)).toContain("Run: ");
    }
  });
});
