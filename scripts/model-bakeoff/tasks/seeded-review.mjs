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
 * The critical-miss rule is absolute, not relative to the comparator: an arm that misses a
 * seeded critical is outside even when the comparator missed it too.
 *
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
  const scored = KEY.defects.filter((d) => !d.excluded);
  return {
    cases: KEY.cases.map((c) => c.case),
    excluded: KEY.defects.filter((d) => d.excluded).map((d) => ({ id: d.id, reason: d.excluded })),
    defects: scored.map(({ id, case: c, file, ranges, critical, description }) => ({
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
    .replace(/^(?:[ab]\/|\.\/)+/, "")
    // A finding that names the case's after file (`r03.after.draft.ts`) means its source file.
    .replace(/^(?:.*\/)?r\d+\.after\./, "");

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
  const num = (v) =>
    typeof v === "number" || (typeof v === "string" && /^\s*\d+\s*$/.test(v)) ? Number(v) : NaN;
  const a = num(f?.startLine);
  const b = num(f?.endLine);
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

const whereOf = (d) => `${d.case} ${d.file}:${d.ranges.map((r) => r.join("-")).join(",")}`;

const describe = (f) =>
  `${normCase(f.case)} ${normPath(f.file)}:${span(f)?.join("-") ?? "?"} [${f.severity}] ${String(f.summary ?? "").trim()}`;
const hash = (s) => createHash("sha256").update(s).digest("hex").slice(0, 8);

/** Checks in lib/score.mjs's shape, so groupDisagreements and the referee work unchanged. */
export function scoreRun(_task, reference, output) {
  const checks = [];
  const findings = Array.isArray(output?.findings) ? output.findings : [];
  const known = new Set(
    (reference.cases ?? [...reference.defects, ...reference.controls].map((x) => x.case)).map(
      normCase,
    ),
  );
  const usable = findings.filter(
    (f) => f && typeof f === "object" && span(f) && known.has(normCase(f.case)),
  );
  for (const d of reference.defects) {
    const check = {
      collection: "defects",
      key: d.id,
      field: "found",
      check: `defects ${d.id} / found`,
    };
    const candidates = usable.filter((f) => relation(f, d));
    // A finding can sit within NEAR_LINES of two seeded defects (r07's d5 and d6 are 8 lines
    // apart). It may count for both, so each referee item names the other defect and says to
    // credit only the one the finding identifies (Operator decisions 137 (k), answer (b); #1465).
    const others = reference.defects.filter(
      (o) => o !== d && candidates.some((f) => relation(f, o)),
    );
    const warning = others.length
      ? ` One of these findings is also near ${others.map((o) => `${o.id} at ${whereOf(o)} (${o.description})`).join("; ")}: credit it here only if it identifies THIS defect, not only ${others.length > 1 ? "one of those" : "that one"}. A finding that identifies both counts for both.`
      : "";
    const refRaw = `Seeded defect at ${whereOf(d)}: ${d.description} ARM is correct only if one of its findings identifies this same defect.${warning}`;
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
    // A finding listed twice, however reworded, or restated with another path form
    // (src/x.ts, r02.after.x.ts, ./x.ts) or an overlapping range, is one false positive, not
    // several (#1462). Findings are grouped by file, and a group holds only findings that all
    // share a line, so a chain of ranges (1-3, 3-5, 5-7) or a wide range does not swallow
    // findings that never meet.
    const byFile = new Map();
    for (const f of usable.filter((x) => normCase(x.case) === normCase(c.case))) {
      const file = sameFile(f.file, c.file) ? c.file : normPath(f.file);
      if (!byFile.has(file)) byFile.set(file, []);
      byFile.get(file).push({ f, s: span(f) });
    }
    for (const [file, found] of byFile) {
      // Sorted by last line, each group holds every finding that reaches its first one's.
      const groups = [];
      for (const x of found.sort((a, b) => a.s[1] - b.s[1] || a.s[0] - b.s[0])) {
        const g = groups.at(-1);
        if (g && x.s[0] <= g.at) {
          g.from = Math.min(g.from, x.s[0]);
          g.to = x.s[1];
          g.findings.push(x.f);
        } else groups.push({ at: x.s[1], from: x.s[0], to: x.s[1], findings: [x.f] });
      }
      for (const g of groups) {
        // Sorted, so the same findings in another order make the same check for the referee.
        const said = [...new Set(g.findings.map(describe))].sort();
        const armRaw = said.join(" || ");
        checks.push({
          collection: "controls",
          key: c.case,
          field: "finding",
          check: `controls ${c.case} / finding ${file}:${g.from}-${g.to} #${hash(armRaw)}`,
          ok: false,
          armKey: "defect",
          refKey: "clean",
          armRaw,
          refRaw: `No defect: ${c.case} is a clean control. ARM is correct only if ${said.length > 1 ? "every finding listed (all on overlapping lines) is" : "its finding is"} a real defect in the lines this change adds or modifies.`,
        });
      }
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
    armKey: answered ? `${malformed} without a line range or a known case` : "no output",
    refKey: "0 without a line range or a known case",
    armRaw: answered ? `${malformed} without a line range or a known case` : "no output",
    refRaw: "0 without a line range or a known case",
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

/**
 * One arm's run: defects found, criticals missed, and false positives on the controls.
 * A defect in `refuted` (the referee ruled it not a defect, on any run) counts for no arm.
 */
export function runSummary(reference, checks, rulings, output, refuted = new Set()) {
  const ruled = (c) => (c.ok ? undefined : rulings[disagreementId(c)]);
  const found = [];
  const missed = [];
  const disputed = [];
  const upheld = [];
  let unruled = 0;
  // Defects whose candidates the referee ruled are about something else.
  const ruledOff = new Set();
  for (const c of checks.filter((x) => x.collection === "defects")) {
    const r = ruled(c);
    if (r) (r.refCorrect === false ? disputed : upheld).push(c.key);
    if (r?.armCorrect === false) ruledOff.add(c.key);
    if (refuted.has(c.key)) continue;
    if (!c.ok && c.armRaw !== MISSING && !r) unruled++;
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
  const criticals = reference.defects
    .filter((d) => d.critical && !refuted.has(d.id))
    .map((d) => d.id);
  // Every case but a control, including one whose defect the key excludes.
  const controlCases = new Set(reference.controls.map((c) => normCase(c.case)));
  const seededCases = new Set(
    (reference.cases ?? reference.defects.map((d) => d.case))
      .map(normCase)
      .filter((c) => !controlCases.has(c)),
  );
  const findings = (Array.isArray(output?.findings) ? output.findings : []).filter(
    (f) => f && span(f),
  );
  // A finding next to a seeded defect counts here too once the referee has ruled it a
  // different defect, such as the r09 rounding finding beside the seeded "#0".
  const other = findings.filter(
    (f) =>
      seededCases.has(normCase(f.case)) &&
      !reference.defects.some((d) => relation(f, d) && !ruledOff.has(d.id)),
  ).length;
  return {
    found: found.length,
    of: found.length + missed.length,
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
    upheldDefects: upheld,
    noOutput: !Array.isArray(output?.findings),
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
      unruled: 0,
      split: 0,
      noOutput: 0,
    });
    g.runs++;
    g.found += s.found;
    g.of += s.of;
    g.criticalMissed += s.criticalMissed.length;
    g.falsePositives += s.falsePositives;
    g.unruled += s.unruled;
    g.split += s.split ?? 0;
    g.noOutput += s.noOutput ? 1 : 0;
  }
  const base = groups[tolerance.comparator];
  for (const [name, g] of Object.entries(groups)) {
    if (!base) {
      g.verdict = "no comparator";
      continue;
    }
    if (g.unruled || base.unruled) {
      g.verdict = "pending: the referee has not ruled on everything";
      continue;
    }
    if (g.split || base.split) {
      g.verdict = "pending: the referee's rulings split on whether a seeded defect is real";
      continue;
    }
    if (g.noOutput || base.noOutput) {
      g.verdict = "pending: a run returned no output";
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

/**
 * Called by bakeoff.mjs `score`: the task's own metric, beside the generic per-check score.
 * `arms` lists every run the bake-off asked for, as ids or arm objects. `score` leaves a run
 * with no transcript out of checksByArm, so each one listed here but missing from it is scored
 * as a run that returned no output, and its group stays pending instead of being judged on
 * the runs that came back.
 */
export function summarize({ reference, checksByArm: scored, rulings, outputs, arms = [] }) {
  const checksByArm = { ...scored };
  for (const arm of arms) {
    const armId = typeof arm === "string" ? arm : arm.id;
    checksByArm[armId] ??= scoreRun(null, reference, undefined);
  }
  // A defect is refuted only when every ruling on it says it is not a defect; a split
  // between rulings refutes nothing and leaves every verdict pending.
  const disputed = new Set();
  const upheld = new Set();
  for (const [armId, checks] of Object.entries(checksByArm)) {
    const r = runSummary(reference, checks, rulings, outputs[armId]);
    r.disputedDefects.forEach((id) => disputed.add(id));
    r.upheldDefects.forEach((id) => upheld.add(id));
  }
  const refuted = new Set([...disputed].filter((id) => !upheld.has(id)));
  const split = [...disputed].filter((id) => upheld.has(id));
  const perRun = {};
  for (const [armId, checks] of Object.entries(checksByArm)) {
    perRun[armId] = {
      ...runSummary(reference, checks, rulings, outputs[armId], refuted),
      split: split.length,
    };
  }
  const { gold: goldRun, ...armRuns } = perRun;
  return {
    tolerance: TOLERANCE,
    excluded: reference.excluded ?? [],
    refutedDefects: [...refuted],
    splitDefects: split,
    perRun,
    groups: decide(armRuns),
    gold: goldRun,
  };
}

export function formatSummary(s) {
  const lines = [
    "",
    ...(s.excluded ?? []).map((e) => `Excluded from the key: ${e.id}: ${e.reason}`),
    ...(s.refutedDefects ?? []).map((id) => `Refuted by the referee, counted for no arm: ${id}`),
    "",
    "| Run | Found | Criticals found | Criticals missed | Control false positives | Real defects on controls | Other findings | Unruled |",
    "|---|---|---|---|---|---|---|---|",
  ];
  for (const [armId, r] of Object.entries(s.perRun)) {
    lines.push(
      `| ${armId} | ${r.found}/${r.of} | ${r.criticalFound}/${r.criticalOf} | ${r.criticalMissed.join(", ") || "none"} | ${r.falsePositives} | ${r.realOnControls} | ${r.otherFindings} | ${r.unruled} |`,
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
