import { describe, it, expect, beforeAll } from "vitest";
import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import yaml from "js-yaml";
import {
  isScheduled,
  stepEnv,
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
  /** Per-step overrides of `outcome`, by step id — a red run where one step
   *  failed and the one an `if:` names was skipped or green. */
  outcomes?: Record<string, string>;
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
    const step = /^steps\.([\w-]+)\.(outcome|conclusion)$/.exec(path);
    if (step) return s.outcomes?.[step[1]!] ?? s.outcome;
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

  it("reads a per-step outcome where the scenario names one", () => {
    const setupBroke = { ...MAIN_FAILED, outcomes: { suite: "skipped" } };
    // `failure() &&` because the run is red: without a status function the
    // implicit success() would make all three false.
    expect(evaluate("failure() && steps.suite.outcome == 'skipped'", setupBroke)).toBe(true);
    expect(evaluate("failure() && steps.suite.outcome == 'failure'", setupBroke)).toBe(false);
    expect(evaluate("failure() && steps.other.outcome == 'failure'", setupBroke)).toBe(true);
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
 * made. The workflow's own run-failure issue covers the hang (fleet-security's
 * nightly-failure issue; release-health's run-failing issue since P1-15, which
 * is what fires when its 5-minute job timeout cancels the run). Named here, not
 * inferred, so a new run-failure step cannot opt out of the cancellation rule by
 * accident.
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
      "release-health.yml › Open/update the release-health-run-failing tracking issue",
      "time-travel.yml › Open/update the outside-the-suite tracking issue",
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
      "release-health.yml › Close the release-health-run-failing issue on recovery",
      "time-travel.yml › Close the time-travel issue on recovery",
      "time-travel.yml › Close the outside-the-suite issue on recovery",
    ]);
    for (const name of FINDING_KEYED) expect(opens(all).map(id)).toContain(name);
  });

  it("finds the scheduled steps that run past an earlier failure", () => {
    expect(runsPastFailure(all).map(id)).toEqual([
      "daily-reports.yml › Upload the rendered preview",
      "fleet-lighthouse.yml › id: app-token",
      "fleet-lighthouse.yml › Sweep GitHub signals to Turso",
      "fleet-lighthouse.yml › Probe roster urls to Turso",
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
  // Judged over every outcome of the steps a condition names: time-travel's two
  // run-failure steps split on the suite step's outcome, so each alone fires on
  // only some red runs. That each red run files SOMETHING is the per-job rule
  // below; this one keeps each step cancel-aware and silent off main.
  it("every run-failure open step can fire on a failed AND a cancelled run on main, and never on a green run or a branch", () => {
    const wrong: string[] = [];
    for (const s of opens(all).filter((o) => !FINDING_KEYED.has(id(o)))) {
      const combos = outcomeCombos(stepIds(s));
      for (const [base, want] of [
        [MAIN_FAILED, true],
        [MAIN_CANCELLED, true],
        [MAIN_GREEN, false],
        [BRANCH_FAILED, false],
        [BRANCH_CANCELLED, false],
      ] as const) {
        const fires = combos.some((outcomes) =>
          evaluate(s.if ?? "success()", { ...base, outcomes }),
        );
        if (fires !== want) {
          wrong.push(
            `${id(s)}: \`if: ${s.if ?? "(none)"}\` ${fires ? "can fire" : "never fires"} when the run is ${base.name}`,
          );
        }
      }
    }
    expect(wrong).toEqual([]);
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

/** The `title="…"` a tracking-issue step files or closes under. */
const titleOf = (s: Found): string | undefined => /\btitle="([^"]+)"/.exec(s.source)?.[1];

/** The step ids whose `outcome`/`conclusion` a step's `if:` reads. */
function stepIds(s: Found): string[] {
  const ids = [...(s.if ?? "").matchAll(/\bsteps\.([\w-]+)\.(?:outcome|conclusion)\b/g)];
  return [...new Set(ids.map((m) => m[1]!))].sort();
}

/** Every assignment of `outcomes` to the listed step ids. */
function outcomeCombos(ids: string[]): Array<Record<string, string>> {
  const values = ["success", "failure", "cancelled", "skipped"];
  let combos: Array<Record<string, string>> = [{}];
  for (const i of ids) combos = combos.flatMap((c) => values.map((v) => ({ ...c, [i]: v })));
  return combos;
}

/**
 * Scheduled workflows that file ONLY finding-keyed issues and deliberately
 * file nothing when the run itself fails or hangs. Each entry must be written
 * into its workflow as an accepted gap. Empty since release-health gained a
 * run-failure issue (P1-15).
 */
const ACCEPTED_NO_RUN_FAILURE_ISSUE = new Set<string>([]);

describe("tracking-issue conditions — every way a run on main goes red files something", () => {
  // The rules above judge each open step on its own, under a scenario where
  // every step's outcome matches the run's. Two alarms passed them and still
  // could not fire (P1-15): release-health has only finding-keyed issues, so a
  // hang to its 5-minute job timeout filed nothing, and time-travel files only
  // when its SUITE step failed or was cancelled, so a hang in install or the
  // browser install filed nothing. These rules ask per workflow and per job.

  it("every scheduled workflow that files an issue has a run-failure open step", () => {
    const filing = [
      ...new Set(
        opens(all)
          .filter((s) => s.scheduled)
          .map((s) => s.file),
      ),
    ];
    const missing = filing.filter(
      (f) =>
        !ACCEPTED_NO_RUN_FAILURE_ISSUE.has(f) &&
        !opens(all).some((s) => s.file === f && !FINDING_KEYED.has(id(s))),
    );
    expect(missing).toEqual([]);
  });

  it("a failed or cancelled run on main files, whichever step went red", () => {
    const runFailure = opens(all).filter((s) => !FINDING_KEYED.has(id(s)));
    const jobs = [...new Set(runFailure.map((s) => `${s.file} › ${s.job}`))];
    expect(jobs.length).toBeGreaterThan(0);
    const silent: string[] = [];
    for (const job of jobs) {
      const steps = runFailure.filter((s) => `${s.file} › ${s.job}` === job);
      const ids = [...new Set(steps.flatMap(stepIds))].sort();
      for (const base of [MAIN_FAILED, MAIN_CANCELLED]) {
        for (const outcomes of outcomeCombos(ids)) {
          const scenario = { ...base, outcomes };
          if (!steps.some((s) => evaluate(s.if ?? "success()", scenario))) {
            silent.push(
              `${job}: nothing files when the run is ${base.name}, ${JSON.stringify(outcomes)}`,
            );
          }
        }
      }
    }
    expect(silent).toEqual([]);
  });

  it("every open step's title has a close step with the same title in the same workflow", () => {
    const unclosed: string[] = [];
    for (const o of opens(all)) {
      const title = titleOf(o);
      if (title === undefined) {
        unclosed.push(`${id(o)}: no title="…" found`);
        continue;
      }
      if (!closes(all).some((c) => c.file === o.file && titleOf(c) === title)) {
        unclosed.push(`${id(o)}: nothing closes "${title}"`);
      }
    }
    expect(unclosed).toEqual([]);
  });
});

describe("time-travel — a red run files exactly one issue, and only the suite names a clock", () => {
  // The suite-scoped condition exists so a lockfile break or a failed browser
  // install never files an issue asserting a wall-clock diagnosis. That stays:
  // a run that goes red OUTSIDE the suite files its own, differently titled
  // issue, and never the wall-clock one.
  const tt = () => opens(all).filter((s) => s.file === "time-travel.yml");
  const SUITE = "Time-travel suite failing";

  it("files the wall-clock issue only when the suite step failed or was cancelled", () => {
    const wrong: string[] = [];
    for (const base of [MAIN_FAILED, MAIN_CANCELLED]) {
      for (const suite of ["failure", "cancelled", "skipped", "success"]) {
        const scenario = { ...base, outcomes: { suite } };
        const firing = tt().filter((s) => evaluate(s.if ?? "success()", scenario));
        const titles = firing.map(titleOf);
        const suiteRed = suite === "failure" || suite === "cancelled";
        if (firing.length !== 1 || titles.includes(SUITE) !== suiteRed) {
          wrong.push(
            `${base.name}, suite ${suite}: files ${JSON.stringify(titles)} (want exactly one, ${suiteRed ? "" : "not "}"${SUITE}")`,
          );
        }
      }
    }
    expect(wrong).toEqual([]);
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

/**
 * Non-issue steps that may carry `continue-on-error` ahead of a run-failure
 * open step, each with the reason its failure is still accounted for. Every
 * other one is refused: the evaluator above models `failure()` as "some step
 * failed", and a continue-on-error step failing leaves `failure()` false.
 */
const CONTINUE_ON_ERROR_ALLOWED = new Map<string, string>([
  [
    "daily-reports.yml › Draft due reports",
    'a draft failure must not block sending approved reports; "Fail the run if drafting failed" re-fails the run on its outcome before the open step',
  ],
  [
    "daily-reports.yml › Keep the scheduled workflow alive",
    "hygiene only (resets the 60-day auto-disable timer); its failure is not the run's",
  ],
  [
    "fleet-lighthouse.yml › Sweep GitHub signals to Turso",
    "a sweep-only hang deliberately ends green so the run keeps the AUDIT's verdict (see the step's comment)",
  ],
  [
    "fleet-lighthouse.yml › Probe roster urls to Turso",
    "#912: a url that does not resolve is a stored finding, not the run's failure; a misread control writes nothing, and its ::error:: plus the stale url_checked_at are the trace, so the run keeps the AUDIT's verdict",
  ],
  [
    "fleet-security.yml › Protection coverage audit (org-wide)",
    "a gap files its own finding-keyed issue; a red job would misdirect triage at the vuln sweep",
  ],
]);

describe("nothing ahead of a run-failure open step can fail without failing the run", () => {
  // Every `if:` verdict above assumes a step that breaks turns `failure()`
  // true. `continue-on-error` breaks that, and nothing modelled it: the review's
  // mutation M3b, `continue-on-error: true` on time-travel's
  // `pnpm install --frozen-lockfile`, passed every rule. A lockfile break then
  // lets the suite run and fail on a missing module, and files the WALL-CLOCK
  // issue — exactly what the suite scoping and P1-15's outside-the-suite issue
  // exist to prevent.
  it("no non-issue step ahead of one carries continue-on-error, unless allow-listed with a reason", () => {
    const found = new Set<string>();
    for (const open of opens(all).filter((s) => !FINDING_KEYED.has(id(s)))) {
      const jobSteps = all.filter((s) => s.file === open.file && s.job === open.job);
      for (const s of jobSteps.slice(0, jobSteps.indexOf(open))) {
        const isIssueStep = /\bgh issue (create|close)\b/.test(s.source);
        if (!isIssueStep && s.continueOnError !== undefined && s.continueOnError !== "false") {
          found.add(id(s));
        }
      }
    }
    expect([...found].filter((f) => !CONTINUE_ON_ERROR_ALLOWED.has(f))).toEqual([]);
    // Pinned both ways: an allow-list entry whose step no longer exists or no
    // longer carries the flag is stale and must go.
    expect([...CONTINUE_ON_ERROR_ALLOWED.keys()].filter((k) => !found.has(k))).toEqual([]);
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

describe("an existing tracking issue's body is rewritten to the current run's, and still commented on", () => {
  // P1-11. On an existing issue every open step used to `gh issue comment` and
  // nothing else, so the BODY kept the first failure's run URL for the issue's
  // whole life: #895 closed on 09-29 with a body naming 09-21's run
  // (35627658119) while the real cause sat in later comments. Anyone reading
  // the issue head — an agent, the cockpit — read stale evidence.
  //
  // EXECUTE each open step's shell against a stub `gh` that records every call.
  // First with no existing issue, to capture the body a new issue would get;
  // then with an existing one, which must receive `issue edit <n> --body` with
  // exactly that body AND `issue comment <n>`, so the history survives. Then
  // with each of the two failing, which must not stop the other.
  const EXISTING = "4242";
  const GH = `#!/bin/bash
{ printf '%s\\037' "$@"; printf '\\036'; } >> "$GH_LOG"
case "$1 $2" in
  "issue list") [ -n "\${GH_EXISTING:-}" ] && echo "$GH_EXISTING"; exit 0 ;;
  "issue edit") [ -n "\${GH_FAIL_EDIT:-}" ] && exit 1; exit 0 ;;
  "issue comment") [ -n "\${GH_FAIL_COMMENT:-}" ] && exit 1; exit 0 ;;
  "issue create") exit 0 ;;
esac
exit 1
`;
  /** A protection-audit output carrying one GAP line, so fleet-security's
   *  protection-gap step builds a body its close step can gate on. */
  const PROTECTION_OUT = "GAP     reddoorla/example — no branch ruleset\nPROTECTION_AUDIT gaps=1\n";

  async function ghCalls(
    step: Found,
    env: Record<string, string>,
    opts: { protectionOut?: string } = {},
  ): Promise<string[][]> {
    const wf = await readFile(workflowPath(step.file), "utf-8");
    const script = stepRunScript(wf, step.label).replace(/\$\{\{[^}]*\}\}/g, "STUB_EXPR");
    const dir = await mkdtemp(join(tmpdir(), "tracking-body-"));
    await mkdir(join(dir, "bin"));
    await writeFile(join(dir, "bin", "gh"), GH, "utf-8");
    await chmod(join(dir, "bin", "gh"), 0o755);
    const protectionOut = opts.protectionOut ?? PROTECTION_OUT;
    if (protectionOut !== "") await writeFile(join(dir, "protection.out"), protectionOut, "utf-8");
    const log = join(dir, "gh.log");
    await writeFile(log, "", "utf-8");
    // `bash -e`: Actions' default `run:` shell. A step that exits non-zero is
    // allowed here (continue-on-error keeps it off the run's status); what is
    // judged is which `gh` calls it made.
    await promisify(execFile)("bash", ["-e", "-c", script], {
      cwd: dir,
      env: {
        ...process.env,
        PATH: `${join(dir, "bin")}:${process.env.PATH ?? ""}`,
        RUNNER_TEMP: dir,
        JOB_STATUS: "failure",
        DAYS: "90",
        GH_LOG: log,
        ...env,
      },
    }).catch(() => undefined);
    return (await readFile(log, "utf-8"))
      .split("\x1e")
      .filter((r) => r !== "")
      .map((r) => r.split("\x1f").slice(0, -1));
  }
  const bodyArg = (call: string[]) => call[call.indexOf("--body") + 1];
  const calls = (log: string[][], verb: string) =>
    log.filter((c) => c[0] === "issue" && c[1] === verb);

  // The population this block judges. The list above pins the names; this pins
  // that the block itself saw all of them, so a filter here cannot shrink it.
  it("finds all 15 open steps", () => {
    expect(opens(all)).toHaveLength(15);
  });

  // POSITIVE CONTROL first: with no existing issue each step creates one with a
  // body and never edits or comments — the harness sees the calls it must see.
  it("with no existing issue, each open step creates one and edits nothing", async () => {
    const wrong: string[] = [];
    for (const s of opens(all)) {
      const got = await ghCalls(s, {});
      const created = calls(got, "create");
      if (created.length !== 1 || !bodyArg(created[0]!)?.includes("Run: ")) {
        wrong.push(`${id(s)}: create calls ${JSON.stringify(created)}`);
      }
      if (calls(got, "edit").length + calls(got, "comment").length !== 0) {
        wrong.push(`${id(s)}: edited or commented with no existing issue`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it("with an existing issue, each open step rewrites ITS body to the new-issue body and comments on it", async () => {
    const wrong: string[] = [];
    for (const s of opens(all)) {
      const fresh = bodyArg(calls(await ghCalls(s, {}), "create")[0] ?? []);
      const got = await ghCalls(s, { GH_EXISTING: EXISTING });
      const edits = calls(got, "edit");
      const comments = calls(got, "comment");
      if (edits.length !== 1) {
        wrong.push(`${id(s)}: ${edits.length} \`gh issue edit\` calls (want 1)`);
      } else if (edits[0]![2] !== EXISTING || !edits[0]!.includes("--body")) {
        wrong.push(`${id(s)}: edited ${JSON.stringify(edits[0])} (want issue ${EXISTING} --body)`);
      } else if (bodyArg(edits[0]!) !== fresh) {
        wrong.push(`${id(s)}: the edited body is not the body a new issue gets`);
      }
      if (comments.length !== 1 || comments[0]![2] !== EXISTING) {
        wrong.push(
          `${id(s)}: comment calls ${JSON.stringify(comments)} (want one on #${EXISTING})`,
        );
      }
      if (calls(got, "create").length !== 0) wrong.push(`${id(s)}: created a duplicate issue`);
    }
    expect(wrong).toEqual([]);
  });

  it("a failed body edit never stops the comment, and a failed comment never stops the edit", async () => {
    const wrong: string[] = [];
    for (const s of opens(all)) {
      const editFails = await ghCalls(s, { GH_EXISTING: EXISTING, GH_FAIL_EDIT: "1" });
      if (!calls(editFails, "comment").some((c) => c[2] === EXISTING)) {
        wrong.push(`${id(s)}: a failed edit stopped the comment`);
      }
      const commentFails = await ghCalls(s, { GH_EXISTING: EXISTING, GH_FAIL_COMMENT: "1" });
      if (!calls(commentFails, "edit").some((c) => c[2] === EXISTING)) {
        wrong.push(`${id(s)}: a failed comment stopped the edit`);
      }
    }
    expect(wrong).toEqual([]);
  });

  // The one deliberate exception. fleet-security's protection-gap close step
  // gates each issue on the GAP lines in ITS OWN body, and refuses one with
  // none. A run where the audit broke before printing a GAP line (an empty
  // minted token exits before `tee`) builds a body reading "see run output";
  // rewriting onto it would leave the issue unclosable by any later clean
  // sweep. So that run comments, and the body keeps the last GAP-bearing one.
  it("protection-gap keeps a GAP-bearing body when this run printed no GAP line, and still comments", async () => {
    const s = opens(all).find(
      (o) => id(o) === "fleet-security.yml › Open/update the protection-gap tracking issue",
    )!;
    const got = await ghCalls(s, { GH_EXISTING: EXISTING }, { protectionOut: "" });
    expect(calls(got, "edit")).toEqual([]);
    expect(calls(got, "comment").map((c) => c[2])).toEqual([EXISTING]);
    expect(bodyArg(calls(got, "comment")[0]!)).toContain("see run output");
  });
});

describe("fleet-lighthouse — the GitHub-signals sweep runs every night that is not cancelled", () => {
  // Moving mint + sweep off `always()` is only safe if they still run on a
  // green night AND after a failed audit. Nothing else notices if they stop:
  // the digest's CI/Renovate collectors silently skip a site whose
  // githubSignalsAt is >3 days old (src/alerts/digest-collectors.ts), so
  // `if: failure()` on the sweep would drop those alerts without a word, and a
  // mint that skips after a failed audit hands the sweep an empty token.
  const lh = () => all.filter((s) => s.file === "fleet-lighthouse.yml");
  const mint = () => lh().find((s) => s.label === "id: app-token");
  const sweep = () => lh().find((s) => s.label === "Sweep GitHub signals to Turso");

  it("finds both steps (a missing step must not pass as a correct one)", () => {
    expect(mint()?.if).toBeDefined();
    expect(sweep()?.if).toBeDefined();
  });

  it("runs both on a green night and after a failed audit, and neither on a cancelled run", () => {
    const wrong: string[] = [];
    for (const s of [mint()!, sweep()!]) {
      for (const [scenario, want] of [
        [MAIN_GREEN, true],
        [MAIN_FAILED, true],
        [MAIN_CANCELLED, false],
      ] as const) {
        const got = evaluate(s.if!, scenario);
        if (got !== want)
          wrong.push(`${id(s)}: \`if: ${s.if}\` is ${got} when ${scenario.name} (want ${want})`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it("gives the mint exactly the sweep's condition, so the sweep never runs untokened", () => {
    expect(mint()!.if).toBe(sweep()!.if);
  });
});

describe("the run-failure open steps read the job's real status", () => {
  // The body test above sets JOB_STATUS itself, so a typo in the workflow's
  // mapping (`${{ job.state }}` renders empty) would leave every cancelled
  // issue unprefixed with that test still green. Pin the mapping.
  it("maps JOB_STATUS to exactly ${{ job.status }} in every run-failure open step", async () => {
    const wrong: string[] = [];
    for (const s of opens(all).filter((o) => !FINDING_KEYED.has(id(o)))) {
      const env = stepEnv(await readFile(workflowPath(s.file), "utf-8"), s.label);
      if (env["JOB_STATUS"] !== "${{ job.status }}") {
        wrong.push(`${id(s)}: JOB_STATUS is ${JSON.stringify(env["JOB_STATUS"])}`);
      }
    }
    expect(wrong).toEqual([]);
  });
});

describe("every workflow is YAML that GitHub will load, and the extractor reads what YAML reads", () => {
  // Everything above trusts `workflowSteps`, a block-scoped regex reader. This
  // block proves it against a real parser, and proves each workflow parses at
  // all. The review's mutation M3 was an unwrapped `if: !cancelled()`: in YAML a
  // plain scalar starting with `!` is a TAG, js-yaml refuses it ("unknown tag
  // !<!cancelled()>"), GitHub refuses the whole file, and the nightly never runs.
  // The regex reader, meanwhile, read it happily as the condition `!cancelled()`
  // and every rule above passed.
  //
  // This replaces #956's stopgap, which scanned `if:` lines for a plain scalar
  // starting with a YAML indicator (`! & * % @ \` { [`). The parse subsumes it:
  // `! % @ \`` and an undefined `*alias` make the load throw, and `&anchor`,
  // `{…}` and `[…]` load as a different string or as a non-string, which the
  // cross-check below reports as a disagreement. It also covers every line of
  // every file, not only `if:` lines — a stray tab or a bad indent anywhere
  // stops a workflow just as dead.

  interface Row {
    job: string;
    name?: string | undefined;
    if?: unknown;
    timeoutMinutes?: unknown;
    jobTimeoutMinutes?: unknown;
    continueOnError?: string | undefined;
  }

  /** What Actions evaluates from an `if:` value: the string with any `${{ }}`
   *  wrapper removed. A non-string is passed through untouched so a flow
   *  mapping or a boolean shows up as the disagreement it is. */
  const unwrap = (v: unknown): unknown => {
    if (typeof v !== "string") return v;
    const m = /^\$\{\{([\s\S]*)\}\}$/.exec(v.trim());
    return m ? m[1]!.trim() : v.trim();
  };

  /** The rows the PARSER sees: one per step, in order. */
  function parsedRows(text: string): Row[] {
    const doc = yaml.load(text) as { jobs?: Record<string, Record<string, unknown>> };
    const rows: Row[] = [];
    for (const [job, body] of Object.entries(doc.jobs ?? {})) {
      const steps = (body["steps"] ?? []) as Array<Record<string, unknown>>;
      for (const s of steps) {
        const name =
          typeof s["name"] === "string"
            ? s["name"]
            : s["id"] !== undefined
              ? `id: ${String(s["id"])}`
              : s["uses"] !== undefined
                ? `uses: ${String(s["uses"])}`
                : undefined;
        rows.push({
          job,
          name,
          if: unwrap(s["if"]),
          timeoutMinutes: s["timeout-minutes"],
          jobTimeoutMinutes: body["timeout-minutes"],
          continueOnError:
            s["continue-on-error"] === undefined ? undefined : String(s["continue-on-error"]),
        });
      }
    }
    return rows;
  }

  /** The same rows as `workflowSteps` reads them. A `run:`-only step has no
   *  name to compare (its extractor label is the first line of the script). */
  const extractedRows = (text: string): Row[] =>
    workflowSteps(text).map((s) => ({
      job: s.job,
      name: s.label.startsWith("run: ") ? undefined : s.label,
      if: s.if,
      timeoutMinutes: s.timeoutMinutes,
      jobTimeoutMinutes: s.jobTimeoutMinutes,
      continueOnError: s.continueOnError,
    }));

  const fixture = (stepKeys: string) =>
    `on: push\njobs:\n  a:\n    runs-on: x\n    timeout-minutes: 5\n    steps:\n      - name: s\n${stepKeys}        run: echo\n`;

  // POSITIVE CONTROLS, first: the parser refuses M3 and accepts its fixes, and
  // the cross-check both agrees on a clean file and catches a real misread.
  it("the parser refuses an unwrapped `if: !cancelled()` and loads the wrapped and quoted forms", () => {
    expect(() => yaml.load(fixture("        if: !cancelled()\n"))).toThrow(
      /unknown tag !<!cancelled\(\)>/,
    );
    expect(parsedRows(fixture("        if: ${{ !cancelled() }}\n"))[0]!.if).toBe("!cancelled()");
    expect(parsedRows(fixture('        if: "!cancelled()"\n'))[0]!.if).toBe("!cancelled()");
  });

  it("the cross-check agrees on a clean step and reports a step the extractor misreads", () => {
    const clean = fixture('        if: "!cancelled()"\n        timeout-minutes: 3\n');
    expect(extractedRows(clean)).toEqual(parsedRows(clean));
    expect(parsedRows(clean)).toEqual([
      { job: "a", name: "s", if: "!cancelled()", timeoutMinutes: 3, jobTimeoutMinutes: 5 },
    ]);
    // A trailing comment is YAML's, not the condition's.
    const commented = fixture(
      "        if: failure() # file on red\n        timeout-minutes: 2 # s\n",
    );
    expect(extractedRows(commented)).toEqual(parsedRows(commented));
    expect(parsedRows(commented)[0]!.if).toBe("failure()");
    // A plain scalar continued onto the next line: YAML folds it into one
    // condition, the line-based extractor reads only its first line.
    const misread = fixture(
      "        if: (failure() || cancelled()) &&\n          github.ref == 'refs/heads/main'\n",
    );
    expect(parsedRows(misread)[0]!.if).toBe(
      "(failure() || cancelled()) && github.ref == 'refs/heads/main'",
    );
    expect(extractedRows(misread)[0]!.if).toBe("(failure() || cancelled()) &&");
    expect(extractedRows(misread)).not.toEqual(parsedRows(misread));
  });

  it("finds all fourteen workflows", async () => {
    expect((await readdir(workflowPath("."))).filter((f) => f.endsWith(".yml")).sort()).toEqual([
      "ci.yml",
      "daily-reports.yml",
      "fleet-db-backup.yml",
      "fleet-form-e2e.yml",
      "fleet-lighthouse.yml",
      "fleet-prismic-drift.yml",
      "fleet-security.yml",
      "fleet-smoke.yml",
      "forms-deadletter-replay.yml",
      "release-health.yml",
      "release.yml",
      "renovate.yml",
      "report-rerender.yml",
      "time-travel.yml",
    ]);
  });

  it("every workflow parses, and workflowSteps reads the same steps, `if:`s and timeouts", async () => {
    const dir = workflowPath(".");
    const problems: string[] = [];
    for (const f of (await readdir(dir)).filter((x) => x.endsWith(".yml")).sort()) {
      const text = await readFile(join(dir, f), "utf-8");
      let parsed: Row[];
      try {
        parsed = parsedRows(text);
      } catch (e) {
        problems.push(`${f}: does not parse — ${(e as Error).message.split("\n")[0]}`);
        continue;
      }
      if (parsed.length === 0) problems.push(`${f}: the parser found no steps`);
      const extracted = extractedRows(text);
      const n = Math.max(parsed.length, extracted.length);
      for (let i = 0; i < n; i++) {
        const [p, x] = [parsed[i], extracted[i]];
        if (JSON.stringify(p) !== JSON.stringify(x)) {
          problems.push(
            `${f} step ${i}: parser ${JSON.stringify(p)} ≠ extractor ${JSON.stringify(x)}`,
          );
        }
      }
    }
    expect(problems).toEqual([]);
  });
});
