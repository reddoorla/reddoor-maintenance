// The 3-strike rule, made countable.
//
//   node matching/strikes.mjs [page]
//
// The matching skill says: "A region that has not improved after 3 fix ->
// re-run cycles: stop. Present the three attempts. Do not widen the threshold,
// mask it, or reclassify it — a stuck region means your model of it is wrong."
//
// That rule was blown twice on this project (services `top`, yfv `top`) purely
// because nobody was counting. This reads every matching/out-*/report.json,
// reconstructs each region's history in chronological order, and prints the
// regions that are OUT OF STRIKES. Exit 1 when any exist, so a round that
// starts by running this cannot quietly attempt a fourth cycle.
//
// WHAT THIS ACTUALLY MEASURES (read before trusting a number): report.json
// cannot record INTENT, so a "cycle" here is any completed gate run in which
// the region was still failing and did not improve by IMPROVE_PP. Runs aimed at
// a different region on the same page therefore count too. That makes this a
// STALL detector, not a literal attempt counter — "this has been failing,
// unchanged, across N gate runs while you were working on this page." That is
// the more useful discipline number anyway, and it is honest about being an
// upper bound. Improvement resets the count: real progress earns a fresh start.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { FLOORS } from "./floors.mjs";
import {
  PAGES,
  THRESHOLD,
  MAX_HEIGHT_DELTA,
  REPORT_SCHEMA,
} from "./harness.mjs";

// PAUSE SWITCH — see matching/next.mjs for why this is an exit code. Round
// protocol step 1 is "run strikes.mjs; the stalled regions are the agenda", so
// this is the second door into the backlog and has to be shut too. Exits 0:
// there are no strikes to spend when no round is being played.
const PAUSED = join(new URL(".", import.meta.url).pathname, "PAUSED");
if (existsSync(PAUSED)) {
  console.log("MATCHING PAUSED — no agenda, and none is to be inferred.\n");
  console.log(readFileSync(PAUSED, "utf8").trimEnd());
  process.exit(0);
}

const IMPROVE_PP = 0.01; // 1 percentage point = the smallest move worth calling progress
const MAX_STRIKES = 3;
const ROOT = new URL(".", import.meta.url).pathname;
const only = process.argv[2] ?? null;

// The gate key for a report, from its ref path. Deriving it by string surgery
// disagreed with the gate on exactly six of the nine rows — yfv, contact, atd,
// svc, qa and team (measured 2026-09-09 against harness.json); the table knows.
// keyOf (below) stays as the fallback for a run whose ref was rewritten.
const pageOf = (ref) => {
  const path = new URL(ref).pathname.replace(/\/$/, "") || "/";
  return PAGES.find((p) => p.ref === path)?.key ?? null;
};

const runs = [];
const unreadable = [];
for (const dir of readdirSync(ROOT).filter((d) => d.startsWith("out-"))) {
  let report;
  try {
    report = JSON.parse(readFileSync(join(ROOT, dir, "report.json"), "utf8"));
  } catch {
    continue; // not a completed run dir
  }
  if (!report.meta?.ref || !Array.isArray(report.regions)) continue;
  // A report from another schema is still usable for a STALL count as long as
  // it carries the two fields this reads. Anything else is counted and named,
  // never silently dropped — an under-counted history reads as "clear".
  const usable = report.regions.every(
    (r) =>
      typeof r.mismatchFraction === "number" && typeof r.pass === "boolean",
  );
  if (!usable) {
    unreadable.push(`${dir} (schema ${report.meta.schemaVersion ?? 0})`);
    continue;
  }
  runs.push({
    dir,
    at: report.meta.generatedAt,
    meta: report.meta,
    regions: report.regions,
  });
}

// The failure mode of a stall detector is always "clear", which is exactly the
// answer that stops nobody. A corpus this could not read is not a clean one.
if (runs.length === 0) {
  console.error(
    `strikes: no parseable gate run under matching/ — refusing to report "clear".` +
      (unreadable.length
        ? `\n         ${unreadable.length} report(s) unreadable at schema ${REPORT_SCHEMA}: ${unreadable.slice(0, 5).join(", ")}`
        : ""),
  );
  process.exit(2);
}
if (unreadable.length) {
  console.error(
    `strikes: ignored ${unreadable.length} unreadable report(s) — the history below is incomplete.` +
      `\n         ${unreadable.slice(0, 5).join(", ")}`,
  );
}

runs.sort((a, b) => a.at.localeCompare(b.at));

// The gate page KEY, recovered from the run dir the way next.mjs does it
// (out-<TAG>-<page>, split on the first hyphen — the tag is hyphen-free by
// gate.sh's own preflight). `pageOf` now returns that same key off the table,
// so the two vocabularies agree and the round protocol in CLAUDE.md — "run
// `strikes.mjs <page>` with the key you just passed to gate.sh", which until
// 2026-08-13 silently matched nothing — works either way. This stays because
// a dir key is not always a gate key: 69 of this corpus's 377 run dirs are
// hand-named probes (out-band3, out-390masked), and FLOORS matches on it.
const keyOf = (dir) => /^out-[^-]+-(.+)$/.exec(dir)?.[1] ?? null;

// key -> chronological list of {dir, at, mm, pass, masked}
const history = new Map();
const seenNames = new Set();
for (const run of runs) {
  const page = pageOf(run.meta.ref) ?? keyOf(run.dir) ?? "unknown";
  const gateKey = keyOf(run.dir);
  seenNames.add(page);
  if (gateKey) seenNames.add(gateKey);
  if (only && page !== only && gateKey !== only) continue;
  for (const r of run.regions) {
    // A DECLARED FLOOR is flat by definition — reporting it as stalled is noise
    // that hides a real stall. It stays in the LEDGER; it does not belong here.
    if (FLOORS.some((fl) => fl.match(r, gateKey || page))) continue;
    const key = `${page}|${r.viewport}|${r.label}`;
    if (!history.has(key)) history.set(key, []);
    history.get(key).push({
      dir: run.dir,
      at: run.at,
      mm: r.mismatchFraction,
      dh: r.heightDeltaFraction,
      pass: r.pass,
      // a run with masks/neutralised media is not comparable to a clean one
      dirty:
        (run.meta.mask?.length ?? 0) > 0 ||
        run.meta.neutralizeMedia ||
        run.meta.maskPhotos,
    });
  }
}

// A name that matches no run must NOT report "clear". This check exists to stop
// work on a stalled region, so failing open is the one thing it may never do —
// a typo'd or wrong-vocabulary page silently greened rule 3 for six of the nine
// pages. Fail loud instead, and say what the vocabulary is.
if (only && history.size === 0) {
  console.error(
    `strikes: "${only}" matches no gate run — refusing to report "clear".\n` +
      `         known pages: ${[...seenNames].sort().join(", ")}`,
  );
  process.exit(2);
}

const stuck = [];
for (const [key, all] of history) {
  const h = all.filter((e) => !e.dirty); // compare like with like
  if (h.length === 0) continue;
  const last = h[h.length - 1];
  if (last.pass) continue;

  let best = Infinity;
  let strikes = 0;
  let sinceIdx = 0;
  for (let i = 0; i < h.length; i++) {
    if (h[i].mm < best - IMPROVE_PP) {
      best = Math.min(best, h[i].mm);
      strikes = 0;
      sinceIdx = i;
    } else {
      best = Math.min(best, h[i].mm);
      strikes++;
    }
  }
  if (strikes >= MAX_STRIKES) stuck.push({ key, strikes, h, sinceIdx, last });
}

// Triage order: the worst-matching region that has never moved is the one whose
// model is most wrong. Sorting by strike count instead would put a 0.3% region
// that only fails on height above a 76% region that fails on everything.
stuck.sort((a, b) => b.last.mm - a.last.mm);

if (stuck.length === 0) {
  console.log(
    `strikes: clear — no failing region has stalled for ${MAX_STRIKES}+ gate runs` +
      (only ? ` on ${only}` : "") +
      ".",
  );
  process.exit(0);
}

const why = (e) => {
  const reasons = [];
  if (e.mm > THRESHOLD) reasons.push(`pixels ${(e.mm * 100).toFixed(1)}%`);
  if (Math.abs(e.dh ?? 0) > MAX_HEIGHT_DELTA)
    reasons.push(`height ${((e.dh ?? 0) * 100).toFixed(1)}%`);
  return reasons.join(" + ") || "marginal";
};

console.log(
  `STALLED — ${stuck.length} failing region(s) have not moved in ${MAX_STRIKES}+ gate runs.\n` +
    `These need a new model or the operator, not another attempt. Worst first:\n`,
);
for (const { key, strikes, h, sinceIdx, last } of stuck.slice(0, 20)) {
  const [page, vw, label] = key.split("|");
  console.log(
    `${page} @${vw}  "${label}"  — ${why(last)}, flat across ${strikes} runs`,
  );
  const window = h.slice(Math.max(0, sinceIdx));
  const shown = window.length > 4 ? [window[0], ...window.slice(-3)] : window;
  for (const [i, e] of shown.entries()) {
    const gap =
      window.length > 4 && i === 1
        ? `    ... ${window.length - 4} more ...\n`
        : "";
    console.log(
      gap +
        `    ${(e.mm * 100).toFixed(1).padStart(5)}%  ${e.at.slice(0, 16).replace("T", " ")}  ${e.dir}`,
    );
  }
  console.log();
}
if (stuck.length > 20) console.log(`... and ${stuck.length - 20} more.\n`);
console.log(
  "Per the matching skill: present the attempts to the operator.\n" +
    "Do NOT widen the threshold, add a mask, or reclassify them as a floor.",
);
process.exit(1);
