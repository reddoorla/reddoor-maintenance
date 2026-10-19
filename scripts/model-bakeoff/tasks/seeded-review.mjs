import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { MISSING, WELL_FORMED, disagreementId } from "../lib/score.mjs";
import { caseFiles } from "./seeded-review/build.mjs";

export const id = "seeded-review";
export const title = "T4 review: recall of real fixed defects in their original diffs";
export const row = 3;

const HERE = dirname(fileURLToPath(import.meta.url));
const KEY = JSON.parse(readFileSync(join(HERE, "seeded-review", "key.json"), "utf8"));

export const sources = [
  { from: "scripts/model-bakeoff/tasks/seeded-review/cases", match: /^r\d+\./, to: "cases" },
];

/**
 * A finding in the right case and file that overlaps a seeded range, or comes within this many
 * lines of it, is a candidate. The referee rules on every candidate, because the first run
 * showed overlap alone crediting a different defect on the same line: every run that flagged
 * r09 line 118 described a rounding mismatch, not the seeded "#0".
 */
export const NEAR_LINES = 10;

/**
 * Written on 2026-10-19, before any arm ran. The comparator is Opus at the session
 * effort (xhigh on the operator's laptop), which is what review runs on today. An arm
 * group (its runs pooled) is within tolerance only when every rule holds.
 */
export const TOLERANCE = Object.freeze({
  comparator: "opus-xhigh",
  foundSlackPerRun: 1,
  falsePositiveSlackPerRun: 1,
  criticalMisses: 0,
});

const SEVERITIES = ["blocker", "critical", "major", "minor"];

export const schema = {
  type: "object",
  properties: {
    findings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          case: { type: "string" },
          file: { type: "string" },
          startLine: { type: "number" },
          endLine: { type: "number" },
          severity: { type: "string", enum: SEVERITIES },
          summary: { type: "string" },
        },
        required: ["case", "file", "startLine", "endLine", "severity", "summary"],
      },
    },
    unverified: { type: "array", items: { type: "string" } },
  },
  required: ["findings", "unverified"],
};

// Unused by this task's scorer, kept so code that lists a task's collections finds an array.
export const collections = [];

export function prompt(dir) {
  return [
    `Code review of ${KEY.cases.length} independent changes to a TypeScript repository, frozen in ${dir}/cases.`,
    "Each change has an id (r01, r02, ...) and two files:",
    "  - <id>.diff: the change as a unified diff of one file. The diff header names the file's path.",
    "  - <id>.after.<name>: that whole file as the change leaves it.",
    "",
    "Review each change as you would a pull request, and report every defect the change introduces or",
    "leaves in the lines it adds or modifies: wrong output, a crash, a missed case, a wrong condition,",
    "data loss, a security hole. Do not report style, naming, formatting, missing tests or comments.",
    "Some changes may have no defect; report nothing for those. Judge from these files alone: do not",
    "read the repository, its history, or anything outside the input folder.",
    "",
    "For each defect, one entry in findings:",
    '  - case: the change id, e.g. "r03"',
    '  - file: the file\'s path as the diff header names it, e.g. "src/x/y.ts"',
    "  - startLine, endLine: the 1-based line range of the defect in the <id>.after.<name> file (use",
    "    `grep -n` or `cat -n` on that file; one line is startLine = endLine). Point at the lines that are wrong.",
    `  - severity: one of ${SEVERITIES.join(", ")}. critical = security, data loss or corruption, or wrong`,
    "    output shipped to users; blocker = must not merge for another reason.",
    "  - summary: one or two sentences: what goes wrong, for what input.",
    "unverified: anything you could not establish (empty if none).",
  ].join("\n");
}

export const goldAddendum =
  "\n\nYou are the reference reviewer. For every defect you report, confirm the line numbers with `grep -n` against the after file, and reason through a concrete input that goes wrong.";

export const arms = [
  { id: "sonnet-medium-1", model: "sonnet", effort: "medium" },
  { id: "sonnet-medium-2", model: "sonnet", effort: "medium" },
  { id: "sonnet-high-1", model: "sonnet", effort: "high" },
  { id: "sonnet-high-2", model: "sonnet", effort: "high" },
  { id: "opus-low-1", model: "opus", effort: "low" },
  { id: "opus-low-2", model: "opus", effort: "low" },
  { id: "opus-medium-1", model: "opus", effort: "medium" },
  { id: "opus-medium-2", model: "opus", effort: "medium" },
  { id: "opus-xhigh-1", model: "opus", effort: "xhigh" },
  { id: "opus-xhigh-2", model: "opus", effort: "xhigh" },
];

export const gold = { id: "gold", model: "opus", effort: "high" };

/** The answer key, checked against the frozen files: every case's files exist and every anchor sits in its range. */
export function truth(dir) {
  const problems = [];
  const lines = {};
  for (const c of KEY.cases) {
    const f = caseFiles(c);
    for (const name of [f.diff, f.after]) {
      if (!existsSync(join(dir, "cases", name))) problems.push(`${c.case}: ${name} is missing`);
    }
    if (existsSync(join(dir, "cases", f.after))) {
      lines[c.case] = readFileSync(join(dir, "cases", f.after), "utf8").split("\n");
    }
  }
  for (const d of KEY.defects) {
    const c = KEY.cases.find((x) => x.case === d.case);
    if (!c || c.kind !== "seeded") problems.push(`${d.id}: case ${d.case} is not a seeded case`);
    else if (c.path !== d.file)
      problems.push(`${d.id}: file ${d.file} is not case ${d.case}'s ${c.path}`);
    const text = lines[d.case];
    if (!text) continue;
    d.anchors.forEach((anchor, i) => {
      const [lo, hi] = d.ranges[Math.min(i, d.ranges.length - 1)];
      const inRange = text.slice(lo - 1, hi).join("\n");
      if (!inRange.includes(anchor))
        problems.push(`${d.id}: "${anchor}" is not in lines ${lo}-${hi}`);
    });
  }
  if (problems.length)
    throw new Error(`the seeded-review key does not fit its cases:\n  ${problems.join("\n  ")}`);
  return {
    defects: KEY.defects.map(({ id, case: c, file, ranges, critical, description }) => ({
      id,
      case: c,
      file,
      ranges,
      critical,
      description,
    })),
    controls: KEY.cases
      .filter((c) => c.kind === "control")
      .map((c) => ({ case: c.case, file: c.path })),
  };
}

const normPath = (p) =>
  String(p ?? "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/^(?:[ab]\/|\.\/)+/, "");

/** The same file: equal paths, or one a suffix of the other at a `/` boundary. */
export function sameFile(a, b) {
  const x = normPath(a);
  const y = normPath(b);
  if (!x || !y) return false;
  return x === y || x.endsWith(`/${y}`) || y.endsWith(`/${x}`);
}

const normCase = (c) =>
  String(c ?? "")
    .trim()
    .toLowerCase();

/** A finding's line range, or null when it has none a scorer can read. */
export function span(f) {
  const a = Number(f?.startLine);
  const b = Number(f?.endLine);
  if (!Number.isInteger(a) || !Number.isInteger(b) || a < 1 || b < 1) return null;
  return [Math.min(a, b), Math.max(a, b)];
}

const gap = ([a, b], [c, d]) => (b < c ? c - b : d < a ? a - d : 0);

/** How one finding stands to one defect: "overlap", "near" or null (not a candidate). */
export function relation(f, d) {
  if (normCase(f?.case) !== normCase(d.case) || !sameFile(f?.file, d.file)) return null;
  const s = span(f);
  if (!s) return null;
  const g = Math.min(...d.ranges.map((r) => gap(s, r)));
  if (g === 0) return "overlap";
  return g <= NEAR_LINES ? "near" : null;
}

const describe = (f) =>
  `${normCase(f.case)} ${normPath(f.file)}:${span(f)?.join("-") ?? "?"} [${f.severity}] ${String(f.summary ?? "").trim()}`;
const hash = (s) => createHash("sha256").update(s).digest("hex").slice(0, 8);

/** Checks in lib/score.mjs's shape, so groupDisagreements and the referee work unchanged. */
export function scoreRun(_task, reference, output) {
  const checks = [];
  const findings = Array.isArray(output?.findings) ? output.findings : [];
  const usable = findings.filter((f) => f && typeof f === "object" && span(f));
  for (const d of reference.defects) {
    const check = {
      collection: "defects",
      key: d.id,
      field: "found",
      check: `defects ${d.id} / found`,
    };
    const where = `${d.case} ${d.file}:${d.ranges.map((r) => r.join("-")).join(",")}`;
    const refRaw = `Seeded defect at ${where}: ${d.description} ARM is correct only if one of its findings identifies this same defect.`;
    const candidates = usable.filter((f) => relation(f, d));
    if (candidates.length) {
      const armRaw = candidates.map((f) => `(${relation(f, d)}) ${describe(f)}`).join(" || ");
      checks.push({
        ...check,
        ok: false,
        armKey: `candidates ${hash(armRaw)}`,
        refKey: "found",
        armRaw,
        refRaw,
      });
    } else {
      checks.push({
        ...check,
        ok: false,
        armKey: MISSING,
        refKey: "found",
        armRaw: MISSING,
        refRaw,
      });
    }
  }
  for (const c of reference.controls) {
    for (const f of usable.filter((x) => normCase(x.case) === normCase(c.case))) {
      const armRaw = describe(f);
      checks.push({
        collection: "controls",
        key: c.case,
        field: "finding",
        check: `controls ${c.case} / finding ${normPath(f.file)}:${span(f).join("-")} #${hash(armRaw)}`,
        ok: false,
        armKey: "defect",
        refKey: "clean",
        armRaw,
        refRaw: `No defect: ${c.case} is a clean control. ARM is correct only if its finding is a real defect in the lines this change adds or modifies.`,
      });
    }
  }
  const malformed = findings.length - usable.length;
  const answered = Boolean(output) && typeof output === "object" && Array.isArray(output.findings);
  checks.push({
    collection: "findings",
    key: "(set)",
    field: WELL_FORMED,
    check: `findings / ${WELL_FORMED}`,
    ok: answered && malformed === 0,
    armKey: answered ? `${malformed} without a line range` : "no output",
    refKey: "0 without a line range",
    armRaw: answered ? `${malformed} without a line range` : "no output",
    refRaw: "0 without a line range",
    mechanical: true,
  });
  return checks;
}

export function referenceFaults() {
  return [];
}

export function extraCandidates() {
  return {};
}

/** One arm's run: defects found, criticals missed, and false positives on the controls. */
export function runSummary(reference, checks, rulings, output) {
  const ruled = (c) => (c.ok ? undefined : rulings[disagreementId(c)]);
  const found = [];
  const missed = [];
  const disputed = [];
  let unruled = 0;
  for (const c of checks.filter((x) => x.collection === "defects")) {
    const r = ruled(c);
    if (!c.ok && c.armRaw !== MISSING && !r) unruled++;
    if (r?.refCorrect === false) disputed.push(c.key);
    (c.ok || r?.armCorrect === true ? found : missed).push(c.key);
  }
  const controlChecks = checks.filter((x) => x.collection === "controls");
  let falsePositives = 0;
  let realOnControls = 0;
  for (const c of controlChecks) {
    const r = ruled(c);
    if (!r) unruled++;
    if (r?.armCorrect === true) realOnControls++;
    else falsePositives++;
  }
  const criticals = reference.defects.filter((d) => d.critical).map((d) => d.id);
  const seededCases = new Set(reference.defects.map((d) => normCase(d.case)));
  const findings = (Array.isArray(output?.findings) ? output.findings : []).filter(
    (f) => f && span(f),
  );
  const other = findings.filter(
    (f) => seededCases.has(normCase(f.case)) && !reference.defects.some((d) => relation(f, d)),
  ).length;
  return {
    found: found.length,
    of: reference.defects.length,
    missed,
    criticalFound: criticals.filter((id) => found.includes(id)).length,
    criticalOf: criticals.length,
    criticalMissed: criticals.filter((id) => !found.includes(id)),
    controlFindings: controlChecks.length,
    falsePositives,
    realOnControls,
    otherFindings: other,
    unruled,
    disputedDefects: disputed,
  };
}

export const groupOf = (armId) => armId.replace(/-\d+$/, "");

/** Pools each arm group's runs and applies TOLERANCE against the comparator group. */
export function decide(perRun, tolerance = TOLERANCE) {
  const groups = {};
  for (const [armId, s] of Object.entries(perRun)) {
    const g = (groups[groupOf(armId)] ??= {
      runs: 0,
      found: 0,
      of: 0,
      criticalMissed: 0,
      falsePositives: 0,
    });
    g.runs++;
    g.found += s.found;
    g.of += s.of;
    g.criticalMissed += s.criticalMissed.length;
    g.falsePositives += s.falsePositives;
  }
  const base = groups[tolerance.comparator];
  for (const [name, g] of Object.entries(groups)) {
    if (!base) {
      g.verdict = "no comparator";
      continue;
    }
    const reasons = [];
    if (g.criticalMissed > tolerance.criticalMisses)
      reasons.push(`missed ${g.criticalMissed} seeded critical(s)`);
    const minFound = (base.found / base.runs - tolerance.foundSlackPerRun) * g.runs;
    if (g.found < minFound) reasons.push(`found ${g.found}, below ${minFound}`);
    const maxFp = (base.falsePositives / base.runs + tolerance.falsePositiveSlackPerRun) * g.runs;
    if (g.falsePositives > maxFp)
      reasons.push(`${g.falsePositives} false positives, above ${maxFp}`);
    g.verdict =
      name === tolerance.comparator ? "comparator" : reasons.length ? "outside" : "within";
    if (reasons.length) g.reasons = reasons;
  }
  return groups;
}

/** Called by bakeoff.mjs `score`: the task's own metric, beside the generic per-check score. */
export function summarize({ reference, checksByArm, rulings, outputs }) {
  const perRun = {};
  for (const [armId, checks] of Object.entries(checksByArm)) {
    perRun[armId] = runSummary(reference, checks, rulings, outputs[armId]);
  }
  const { gold: goldRun, ...armRuns } = perRun;
  return { tolerance: TOLERANCE, perRun, groups: decide(armRuns), gold: goldRun };
}

export function formatSummary(s) {
  const lines = [
    "",
    "| Run | Found | Criticals found | Criticals missed | Control false positives | Real defects on controls | Other findings |",
    "|---|---|---|---|---|---|---|",
  ];
  for (const [armId, r] of Object.entries(s.perRun)) {
    lines.push(
      `| ${armId} | ${r.found}/${r.of} | ${r.criticalFound}/${r.criticalOf} | ${r.criticalMissed.join(", ") || "none"} | ${r.falsePositives} | ${r.realOnControls} | ${r.otherFindings} |`,
    );
  }
  lines.push(
    "",
    "| Group | Runs | Found | Criticals missed | False positives | Verdict |",
    "|---|---|---|---|---|---|",
  );
  for (const [name, g] of Object.entries(s.groups)) {
    lines.push(
      `| ${name} | ${g.runs} | ${g.found}/${g.of} | ${g.criticalMissed} | ${g.falsePositives} | ${g.verdict}${g.reasons ? `: ${g.reasons.join("; ")}` : ""} |`,
    );
  }
  return lines.join("\n");
}
