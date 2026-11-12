import { describe, it, expect, beforeAll } from "vitest";
import { readFile } from "node:fs/promises";
import { workflowPath, workflowSteps, type WorkflowStep } from "./_helpers/workflow-source.js";

/**
 * #2034. The 8:07am PT send run of 2026-11-11 (run 43055102047) died in
 * `pnpm exec playwright install --with-deps chromium` on
 * `Temporary failure resolving 'security.ubuntu.com'`, before it sent anything.
 * A send run needs no browser: `report --send-ready` reads each report's header
 * from Turso and only stamps a stored PNG headline over it with sharp
 * (src/reports/send/render-from-row.ts). The browser screenshots homepages at
 * DRAFT time, and the URW fonts serve the domain line drawn at draft time too.
 *
 * So in a send run, no step that goes to Ubuntu's apt mirrors may run before
 * the send. This evaluates each step's real `if:` for the inputs each trigger
 * gives, rather than matching the expression's text, so any condition that
 * behaves right passes and any that does not fails.
 */

const SEND_STEP = "Send approved reports";
const DRAFT_STEP = "Draft due reports";

/** A step that reaches Ubuntu's package mirrors: apt itself, Playwright's
 *  `--with-deps` / `install-deps` (both run apt-get), or an apt repository add. */
const reachesAptMirrors = (s: WorkflowStep): boolean =>
  /\bapt(-get)?\b|install-deps|--with-deps|add-apt-repository/.test(s.source);
const installsBrowser = (s: WorkflowStep): boolean => /playwright install(?!-deps)/.test(s.source);

// ── A small model of the Actions expression language: enough for the `if:`s
// this workflow puts ahead of its send. Anything it does not know throws.

type Value = string | number | boolean | null;
interface Scenario {
  event: string;
  /** Workflow inputs. A scheduled run has none, so every `inputs.*` is null. */
  inputs: Record<string, string>;
}

function tokenize(src: string): string[] {
  const re = /\s*(\|\||&&|==|!=|!|\(|\)|'(?:[^']|'')*'|[A-Za-z_][\w.-]*)/y;
  const out: string[] = [];
  let at = 0;
  while (at < src.length) {
    if (/^\s*$/.test(src.slice(at))) break;
    re.lastIndex = at;
    const m = re.exec(src);
    if (!m) throw new Error(`cannot tokenize at ${at}: ${src.slice(at)}`);
    out.push(m[1]!);
    at = re.lastIndex;
  }
  return out;
}

function truthy(v: Value): boolean {
  return !(v === null || v === false || v === "" || v === 0 || Number.isNaN(v));
}

/** Actions' loose equality: strings compare case-insensitively; mixed types
 *  compare as numbers (null and "" are 0, a non-numeric string is NaN). */
function looseEqual(a: Value, b: Value): boolean {
  if (typeof a === "string" && typeof b === "string") return a.toLowerCase() === b.toLowerCase();
  if (typeof a === typeof b) return a === b;
  const num = (v: Value): number =>
    v === null ? 0 : typeof v === "boolean" ? Number(v) : v === "" ? 0 : Number(v);
  return num(a) === num(b);
}

function evaluate(expr: string, s: Scenario): Value {
  const t = tokenize(expr);
  let i = 0;
  const peek = () => t[i];
  const take = (want?: string) => {
    const tok = t[i++];
    if (want !== undefined && tok !== want) throw new Error(`expected ${want}, got ${tok}`);
    return tok!;
  };
  function primary(): Value {
    const tok = take();
    if (tok === "(") {
      const v = or();
      take(")");
      return v;
    }
    if (tok === "!") return !truthy(primary());
    if (tok.startsWith("'")) return tok.slice(1, -1).replace(/''/g, "'");
    if (tok === "true" || tok === "false") return tok === "true";
    if (tok === "null") return null;
    if (tok === "always" || tok === "success") {
      take("(");
      take(")");
      return true; // nothing has failed ahead of the send in these scenarios
    }
    if (tok.startsWith("inputs.")) return s.inputs[tok.slice("inputs.".length)] ?? null;
    if (tok === "github.event_name") return s.event;
    throw new Error(`${tok} is not modelled`);
  }
  function cmp(): Value {
    let v = primary();
    while (peek() === "==" || peek() === "!=") {
      const op = take();
      const r = primary();
      v = op === "==" ? looseEqual(v, r) : !looseEqual(v, r);
    }
    return v;
  }
  function and(): Value {
    let v = cmp();
    while (peek() === "&&") {
      take();
      const r = cmp();
      v = truthy(v) ? r : v;
    }
    return v;
  }
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
  if (i !== t.length) throw new Error(`trailing tokens in ${expr}`);
  return v;
}

const runs = (s: WorkflowStep, sc: Scenario): boolean =>
  s.if === undefined || truthy(evaluate(s.if, sc));

/** The steps that run, in order, up to and including `until`. */
function runningUpTo(steps: WorkflowStep[], sc: Scenario, until: string): WorkflowStep[] {
  const end = steps.findIndex((s) => s.label === until);
  if (end === -1) throw new Error(`no step named "${until}"`);
  return steps.slice(0, end + 1).filter((s) => runs(s, sc));
}

// The 13:23Z cron fallback (no inputs at all) and the nightly-send-clock's
// `mode=send` dispatch are the two send runs.
const SEND_RUNS: Record<string, Scenario> = {
  "the scheduled fallback": { event: "schedule", inputs: {} },
  "a mode=send dispatch": {
    event: "workflow_dispatch",
    inputs: { mode: "send", preview_site: "" },
  },
};
const DRAFTING_RUNS: Record<string, Scenario> = {
  "a mode=draft dispatch": {
    event: "workflow_dispatch",
    inputs: { mode: "draft", preview_site: "" },
  },
  "a mode=all dispatch": { event: "workflow_dispatch", inputs: { mode: "all", preview_site: "" } },
  "a preview dispatch": {
    event: "workflow_dispatch",
    inputs: { mode: "all", preview_site: "Sonder" },
  },
  "a preview dispatch left on mode=send": {
    event: "workflow_dispatch",
    inputs: { mode: "send", preview_site: "Sonder" },
  },
};

let steps: WorkflowStep[];

beforeAll(async () => {
  steps = workflowSteps(await readFile(workflowPath("daily-reports.yml"), "utf-8")).filter(
    (s) => s.job === "daily",
  );
});

describe("the expression model", () => {
  it("reads a scheduled run's missing input as null, which is != 'send'", () => {
    // The trap a plain `inputs.mode != 'send'` falls into on the cron fallback.
    const cron = SEND_RUNS["the scheduled fallback"]!;
    expect(evaluate("inputs.mode != 'send'", cron)).toBe(true);
    expect(evaluate("(inputs.mode || 'send') != 'send'", cron)).toBe(false);
  });

  it("follows Actions' || and && (they return an operand) and string equality", () => {
    const sc: Scenario = {
      event: "workflow_dispatch",
      inputs: { mode: "Draft", preview_site: "" },
    };
    expect(evaluate("inputs.preview_site || inputs.mode", sc)).toBe("Draft");
    expect(evaluate("inputs.mode && inputs.preview_site", sc)).toBe("");
    expect(evaluate("inputs.mode == 'draft'", sc)).toBe(true);
    expect(evaluate("!inputs.preview_site && inputs.mode != 'send'", sc)).toBe(true);
    expect(() => evaluate("steps.draft.outcome == 'failure'", sc)).toThrow(/not modelled/);
  });
});

describe("daily-reports: a send run does not wait on Ubuntu's mirrors", () => {
  for (const [name, sc] of Object.entries(SEND_RUNS)) {
    it(`${name} reaches the send (positive control)`, () => {
      const ran = runningUpTo(steps, sc, SEND_STEP).map((s) => s.label);
      expect(ran).toContain(SEND_STEP);
      expect(ran).toContain("run: pnpm build");
    });

    it(`${name} runs no apt-get or --with-deps install before the send`, () => {
      const offenders = runningUpTo(steps, sc, SEND_STEP)
        .filter(reachesAptMirrors)
        .map((s) => s.label);
      expect(offenders).toEqual([]);
    });
  }

  it("has an install step to gate at all (positive control)", () => {
    expect(steps.filter(installsBrowser)).toHaveLength(1);
    expect(steps.filter(reachesAptMirrors).length).toBeGreaterThanOrEqual(2);
  });

  for (const [name, sc] of Object.entries(DRAFTING_RUNS)) {
    it(`${name} still installs the browser and the fonts before drafting`, () => {
      const before = runningUpTo(steps, sc, DRAFT_STEP);
      expect(before.filter(installsBrowser)).toHaveLength(1);
      expect(before.filter(reachesAptMirrors)).toHaveLength(steps.filter(reachesAptMirrors).length);
    });
  }
});
