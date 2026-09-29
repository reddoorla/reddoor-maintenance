import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/**
 * Read the PARTS OF A WORKFLOW THAT ACTUALLY RUN, so a test can assert on
 * behaviour instead of on prose.
 *
 * These are deliberately small, block-scoped extractors rather than a general
 * parser. What they buy is the property that matters: a `#` comment — the single
 * easiest thing to write in a workflow and the single least meaningful — can
 * neither satisfy an assertion nor break one. Source-text greps have both failure
 * modes, and a draft of the very workflow these serve shipped a test that asserted
 * `--apply` was absent from a file whose header comment explained why `--apply` is
 * refused. They also hand back a step's `run:` block line-for-line, which is what
 * lets a test EXECUTE it.
 *
 * They are no longer trusted on their own word. `js-yaml` is a devDependency
 * (devDependencies never reach a consumer of the published package), and
 * tests/build/tracking-issue-conditions.test.ts loads every workflow with it and
 * requires `workflowSteps` to read the same steps, `if:`s and timeouts the parser
 * does. A shape these regexes misread fails there, not silently here.
 *
 * The workflows here are prettier-formatted, two-space-indented and hand-written,
 * so the block shapes below are stable; anything more exotic should get a parser
 * rather than a cleverer regex.
 */

const WORKFLOWS = join(dirname(fileURLToPath(import.meta.url)), "../../../.github/workflows");

/** Absolute path to a workflow in this repo's `.github/workflows`. */
export function workflowPath(file: string): string {
  return join(WORKFLOWS, file);
}

/**
 * The workflow with every whole-line `#` comment removed — what Actions would
 * actually act on.
 *
 * Use this for ANY assertion about a flag, a name or a value being absent. A
 * source-text `not.toContain("--apply")` over the raw file is satisfied or broken
 * by prose: the plan's own draft asserted `--apply` was absent from a workflow
 * whose header explained why `--apply` is refused, and the first version of the
 * reusable-workflow test in this repo failed the same way on a comment reading
 * "`--apply` is not passed in this job". A well-documented workflow is the case
 * where this matters most, which is exactly backwards from what you want.
 *
 * Whole-line comments only — a trailing `# v7` after a pinned digest is left
 * alone, because stripping it correctly means knowing where strings begin and end.
 */
export function withoutComments(workflow: string): string {
  return workflow
    .split("\n")
    .filter((l) => !/^\s*#/.test(l))
    .join("\n");
}

/** Lines of one `- name: <step>` step, up to the next step at the same indent.
 *  Throws when the step is absent: a helper that returned "" would let every
 *  assertion about a step quietly pass for a step that was deleted. */
function stepBlock(workflow: string, stepName: string): string {
  const lines = workflow.split("\n");
  const start = lines.findIndex((l) => l.trimEnd().endsWith(`- name: ${stepName}`));
  if (start === -1) throw new Error(`no step named ${JSON.stringify(stepName)} in this workflow`);
  const indent = (lines[start]!.match(/^\s*/) ?? [""])[0].length;
  const out = [lines[start]!];
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i]!;
    const isNewStep = /^\s*-\s/.test(line) && (line.match(/^\s*/) ?? [""])[0].length <= indent;
    const isNewTopLevel = line.trim() !== "" && !/^\s/.test(line);
    if (isNewStep || isNewTopLevel) break;
    out.push(line);
  }
  return out.join("\n");
}

/**
 * The shell script of a step's `run: |` block, de-indented so it can be EXECUTED.
 *
 * This is what makes a workflow gate testable at all: the script the test runs is
 * byte-for-byte the script Actions runs, so a gate that keys on the wrong number
 * fails here for the same reason it would fail at 05:00.
 */
export function stepRunScript(workflow: string, stepName: string): string {
  const block = stepBlock(workflow, stepName).split("\n");
  const runAt = block.findIndex((l) => /^\s*run: \|\s*$/.test(l));
  if (runAt === -1) throw new Error(`step ${JSON.stringify(stepName)} has no \`run: |\` block`);
  const rest = block.slice(runAt + 1);
  const indent = (rest.find((l) => l.trim() !== "")?.match(/^\s*/) ?? [""])[0].length;
  // A literal block scalar ends at the first NON-EMPTY line indented less than the
  // block. Slicing to the end of the step instead swallows the comment block that
  // documents the NEXT step — those lines are less indented, so de-indenting them
  // chops characters off the front and produces a script that runs fragments of
  // English prose. It failed loudly here (exit 127); in a helper that only ever
  // grepped the result it would have failed silently.
  const end = rest.findIndex(
    (l) => l.trim() !== "" && (l.match(/^\s*/) ?? [""])[0].length < indent,
  );
  const body = end === -1 ? rest : rest.slice(0, end);
  return body.map((l) => l.slice(indent)).join("\n");
}

/** A step's `env:` mapping, as key → raw value (`${{ secrets.X }}` included).
 *  Comment lines inside the block are skipped, so documenting a variable can
 *  never be mistaken for declaring one. */
export function stepEnv(workflow: string, stepName: string): Record<string, string> {
  const block = stepBlock(workflow, stepName).split("\n");
  const envAt = block.findIndex((l) => /^\s*env:\s*$/.test(l));
  if (envAt === -1) throw new Error(`step ${JSON.stringify(stepName)} has no \`env:\` block`);
  const indent = (block[envAt]!.match(/^\s*/) ?? [""])[0].length;
  const out: Record<string, string> = {};
  for (const line of block.slice(envAt + 1)) {
    if (line.trim() === "" || /^\s*#/.test(line)) continue;
    const depth = (line.match(/^\s*/) ?? [""])[0].length;
    if (depth <= indent) break;
    const m = /^\s*([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/.exec(line);
    if (m) out[m[1]!] = m[2]!.trim();
  }
  return out;
}

/** Every action reference the workflow actually uses. Comment lines are dropped
 *  first, so a `# uses: …` note in prose cannot masquerade as an unpinned action
 *  (or, worse, hide one). */
export function workflowUses(workflow: string): string[] {
  return workflow
    .split("\n")
    .filter((l) => !/^\s*#/.test(l))
    .flatMap((l) => {
      const m = /^\s*-?\s*uses:\s*(\S+)/.exec(l);
      return m ? [m[1]!] : [];
    });
}

/** One step of one job, as far as a structural gate needs it. */
export interface WorkflowStep {
  job: string;
  /** `name:`, else `id:`, else `uses:`, else the first line of `run:` — what a
   *  failure message should call the step. */
  label: string;
  /** The raw `if:` value with any `${{ … }}` wrapper removed; undefined when absent. */
  if?: string | undefined;
  timeoutMinutes?: number | undefined;
  jobTimeoutMinutes?: number | undefined;
  /** The step's comment-stripped source, for "does it run X" questions. */
  source: string;
}

/**
 * Every step of every job, read from the comment-stripped workflow.
 *
 * Same contract as the extractors above: prettier-formatted, two-space indents —
 * jobs at 2, job keys at 4, step items at 6, step keys at 8. A step key written
 * on the dash line (`- if: …`) is read too. A block-scalar `if:` (`|` / `>`)
 * throws rather than being read as a one-line condition it is not.
 */
export function workflowSteps(workflow: string): WorkflowStep[] {
  const lines = withoutComments(workflow).split("\n");
  const jobsAt = lines.findIndex((l) => /^jobs:\s*$/.test(l));
  if (jobsAt === -1) throw new Error("workflow has no top-level `jobs:`");

  const steps: WorkflowStep[] = [];
  let job = "";
  let jobTimeout: number | undefined;
  let current: string[] | undefined;
  const pending: Array<{ job: string; lines: string[] }> = [];
  const flush = () => {
    if (current) pending.push({ job, lines: current });
    current = undefined;
  };

  for (const line of lines.slice(jobsAt + 1)) {
    if (line.trim() !== "" && !/^\s/.test(line)) break; // next top-level key
    const jobHead = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(line);
    if (jobHead) {
      flush();
      // Resolve the previous job's steps with its timeout before switching.
      for (const p of pending.splice(0)) steps.push(parseStep(p.job, p.lines, jobTimeout));
      job = jobHead[1]!;
      jobTimeout = undefined;
      continue;
    }
    const jobKey = /^ {4}timeout-minutes:\s*(\d+)\s*(?:#.*)?$/.exec(line);
    if (jobKey) jobTimeout = Number(jobKey[1]);
    if (/^ {6}- /.test(line)) {
      flush();
      current = [line];
      continue;
    }
    if (/^ {0,5}\S/.test(line)) {
      flush(); // a job-level key ends the step list
      continue;
    }
    if (current) current.push(line);
  }
  flush();
  for (const p of pending) steps.push(parseStep(p.job, p.lines, jobTimeout));
  return steps;
}

/**
 * A one-line YAML scalar as YAML reads it: a quoted scalar is the text inside
 * its quotes (the way a condition may legally start with `!`), and a plain
 * scalar ends at ` #` — `uses: actions/checkout@<sha> # v7` is the digest, not
 * the digest and a version note. Both were misread here until the js-yaml
 * cross-check in tracking-issue-conditions.test.ts compared them.
 */
function scalar(raw: string): string {
  const v = raw.trim();
  const single = /^'((?:[^']|'')*)'/.exec(v);
  if (single) return single[1]!.replace(/''/g, "'");
  const double = /^"((?:[^"\\]|\\.)*)"/.exec(v);
  if (double) return JSON.parse(`"${double[1]!}"`) as string;
  return v.replace(/\s+#.*$/, "");
}

function parseStep(job: string, lines: string[], jobTimeoutMinutes?: number): WorkflowStep {
  const keys: Record<string, string> = {};
  lines.forEach((l, i) => {
    const m = (
      i === 0 ? /^ {6}- ([A-Za-z][\w-]*):\s*(.*)$/ : /^ {8}([A-Za-z][\w-]*):\s*(.*)$/
    ).exec(l);
    if (m) keys[m[1]!] = scalar(m[2]!);
  });
  let cond = keys["if"];
  if (cond !== undefined) {
    if (/^[|>]/.test(cond)) throw new Error(`job ${job}: block-scalar \`if:\` is not supported`);
    const wrapped = /^\$\{\{([\s\S]*)\}\}$/.exec(cond);
    if (wrapped) cond = wrapped[1]!.trim();
  }
  const label =
    keys["name"] ??
    (keys["id"] ? `id: ${keys["id"]}` : undefined) ??
    (keys["uses"] ? `uses: ${keys["uses"]}` : undefined) ??
    `run: ${keys["run"] ?? "?"}`;
  const timeout = keys["timeout-minutes"];
  return {
    job,
    label,
    if: cond,
    timeoutMinutes: timeout === undefined ? undefined : Number(timeout),
    jobTimeoutMinutes,
    source: lines.join("\n"),
  };
}

/** True when the workflow's `on:` block has a `schedule:` trigger. */
export function isScheduled(workflow: string): boolean {
  const lines = withoutComments(workflow).split("\n");
  const onAt = lines.findIndex((l) => /^(on|"on"):\s*$/.test(l));
  if (onAt === -1) return false;
  for (const l of lines.slice(onAt + 1)) {
    if (l.trim() !== "" && !/^\s/.test(l)) return false;
    if (/^ {2}schedule:/.test(l)) return true;
  }
  return false;
}
