// What is still broken, ranked. Exits 1 while work remains.
//
//   node matching/next.mjs
//
// Round protocol step 0 (repo CLAUDE.md rule 5). A commit is a CHECKPOINT, not
// a stopping point: after committing, run this. If it exits 1 there is a named
// next action and the round continues without handing control back.
//
// Reads the most recent gate log per page rather than the whole corpus, so it
// reflects HEAD rather than history (that is strikes.mjs's job).
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const DIR = new URL(".", import.meta.url).pathname;

// PAUSE SWITCH. While matching/PAUSED exists this hands out no agenda and
// exits 0. It is deliberately the FIRST thing that runs: no report is read, no
// score is printed, nothing tempting is put on screen to argue with.
//
// Why an exit code and not a note somewhere: rule 5 is a LOOP — "after
// committing, run next.mjs; while it exits 1 there is a named next action and
// the round continues". A pause written as prose loses to that loop, because
// the loop is mechanical and the prose is not. Exiting 0 satisfies rule 5
// truthfully rather than suspending it: there is no next action.
const PAUSE = join(DIR, "PAUSED");
if (existsSync(PAUSE)) {
  console.log("MATCHING PAUSED — no agenda, and none is to be inferred.\n");
  console.log(readFileSync(PAUSE, "utf8").trimEnd());
  process.exit(0);
}

import { FLOORS, ACCEPTED } from "./floors.mjs";
import {
  TOTALS,
  THRESHOLD,
  MAX_HEIGHT_DELTA,
  REPORT_SCHEMA,
  uncountable,
  scorable,
  unscorableWhy,
  byKey,
} from "./harness.mjs";

// Reports written by a different page-diff, by page key. Kept rather than
// dropped: silently ignoring them is how a page vanishes from the score.
const schemaMismatch = new Set();

const latest = new Map();
for (const d of readdirSync(DIR).filter((d) => d.startsWith("out-"))) {
  const m = /^out-[^-]+-(.+)$/.exec(d);
  // Membership in the page table is asked of the TABLE. `!TOTALS[m[1]]` was a
  // NUMBER standing in for a fact: it is null for an unanchored page and 0 for
  // an empty matrix, and either dropped the page out of `latest` while
  // `Object.keys(TOTALS)` still listed it — so a gate run that had just
  // SUCCEEDED came back as "no countable gate run".
  if (!m || !byKey[m[1]]) continue;
  let report, mtime;
  try {
    const p = join(DIR, d, "report.json");
    report = JSON.parse(readFileSync(p, "utf8"));
    mtime = statSync(p).mtimeMs;
  } catch {
    continue;
  }
  // A masked / media-neutralised run is a DIAGNOSTIC, never the state of the
  // page. Picking one up as "latest" silently reports scores nobody can ship —
  // it happened immediately: an --mask-photos probe of yfv made `top` @834 read
  // 43.9% here while the real gate had it passing at 1.3%. Missing
  // schemaVersion means "written before the field existed" = 0; it is not an
  // error on its own, only when it would blank a page.
  //
  // The predicate itself lives in harness.mjs now, because gate.sh asks the
  // same question per run and two copies of one question drift — a gate that
  // greens a run this file then drops is the same false green one step along.
  const why = uncountable(report.meta ?? {});
  if (why === "schema") {
    schemaMismatch.add(m[1]);
    continue;
  }
  if (why) continue;
  const prev = latest.get(m[1]);
  if (!prev || mtime > prev.mtime) latest.set(m[1], { dir: d, mtime, report });
}

const blanked = [...schemaMismatch].filter((p) => !latest.has(p));
if (blanked.length) {
  console.error(
    `next: ${blanked.length} page(s) have no run at report schema ${REPORT_SCHEMA} — ` +
      `their newest reports came from a different page-diff (${blanked.sort().join(", ")}).\n` +
      `      Re-run: bash matching/gate.sh <tag> ${blanked.sort().join(" ")}`,
  );
  process.exit(2);
}
if (latest.size === 0) {
  console.error(
    "next: no parseable gate run under matching/ — refusing to report a score.\n" +
      "      Run bash matching/gate.sh <tag> first.",
  );
  process.exit(2);
}

const rows = [];
const accepted = [];
let openTotal = 0;
let floorTotal = 0;
for (const [page, { dir, report }] of latest) {
  const fails = report.regions.filter((r) => !r.pass);
  for (const f of fails) {
    const floor = FLOORS.find((fl) => fl.match(f, page));
    if (floor) {
      floorTotal++;
      continue;
    }
    const ack = ACCEPTED.find((a) => a.match(f, page));
    if (ack) {
      accepted.push({ page, vw: f.viewport, label: f.label, why: ack.why });
      continue;
    }
    openTotal++;
    rows.push({
      page,
      vw: f.viewport,
      label: f.label,
      mm: f.mismatchFraction,
      dh: f.heightDeltaFraction ?? 0,
      dir,
    });
  }
}

// Pages that REPORTED but cannot be scored: no anchors, so their regions are
// whatever page-diff's fallback cut and there is no model for one to be right
// against. Kept separate from `scored` and never ranked with it.
const unscorable = [...latest.entries()]
  .filter(([p]) => !scorable(p))
  .map(([p, v]) => ({ p, regions: v.report.regions.length }))
  .sort((a, b) => a.p.localeCompare(b.p));

// `.filter(scorable)` before `.map`, because the sort below divides by `total`
// and an unanchored page's ratio is NOT BOUNDED BY 1. A passing one scored
// 16/4 = 4.0 and sorted LAST, i.e. best, so `worst` could never name the one
// page whose Phase 1 was not done; a failing one scored 0/4 = 0.0, sorted
// FIRST, and put `grid-0-0`, `grid-1-0` … on the agenda — an instruction to fix
// geometry against regions page-diff invented.
const scored = [...latest.entries()]
  .filter(([p]) => scorable(p))
  .map(([p, v]) => ({
    p,
    pass: v.report.regions.filter((r) => r.pass).length,
    total: TOTALS[p],
  }))
  .sort((a, b) => a.pass / a.total - b.pass / b.total);

// The denominator is the DECLARED site, not the pages that happened to report.
// Summed over `scored` it shrank to match the numerator: 8 of 9 pages reporting
// read SCORE 160/160 while the ninth, whose page-diff had crashed, was in
// neither the numerator nor the denominator nor the list below. harness.mjs:61-67
// already gives the reason — "a wrong denominator makes the score a lie in the
// flattering direction" — and that fix was applied per REGION (`total:
// TOTALS[p]`) and never per PAGE.
const unmeasured = Object.keys(TOTALS)
  .filter((p) => !latest.has(p))
  .sort();
const sum = scored.reduce((a, s) => a + s.pass, 0);
// Summed EXPLICITLY over the scorable pages rather than over TOTALS' values:
// `a + null` is silently `a`, and a denominator that is right only because of a
// coercion is the same lie one refactor away.
const pagesAll = Object.keys(TOTALS).length;
const pagesScorable = Object.keys(TOTALS).filter((p) => scorable(p)).length;
const max = Object.keys(TOTALS).reduce((a, p) => a + (scorable(p) ? TOTALS[p] : 0), 0);

// A score is printed only if SOMETHING can carry one. `SCORE 0/0` is a third
// lie and the one that reads best of all, so it is never printed: with nothing
// scorable the line says so in words and gives no fraction to quote.
console.log(
  (pagesScorable === 0
    ? `NO SCORE — 0 of ${pagesAll} page(s) can carry one.`
    : `SCORE ${sum}/${max} regions passing over ${pagesScorable} of ${pagesAll} page(s)` +
      (unmeasured.length ? ` — ${unmeasured.length} page(s) NOT MEASURED` : "")) + "\n",
);
console.log(
  [
    ...scored.map((s) => `  ${s.p.padEnd(9)} ${String(s.pass).padStart(2)}/${s.total}`),
    // The run's OWN region count, as EVIDENCE FOR THE REFUSAL — it proves a run
    // happened and explains why it cannot be scored, so a refusal is not
    // mistaken for a crash. The pass FRACTION is deliberately withheld: it is
    // the number with no referent, and the number that gets quoted.
    ...unscorable.map(
      (u) =>
        `  ${u.p.padEnd(9)} ${String(u.regions).padStart(2)} region(s)  NOT SCORABLE — ${unscorableWhy(u.p)}`,
    ),
    // `?/N`, never `0/N`: an unmeasured page is not a page that scored zero,
    // and printing zero would be a different lie. `?/?` when the page is ALSO
    // unanchored — `?/null` would name the denominator "null", which is worse
    // than the number it replaced.
    ...unmeasured.map((p) => `  ${p.padEnd(9)}  ?/${TOTALS[p] ?? "?"}   NOT MEASURED`),
  ].join("\n"),
);

if (accepted.length) {
  console.log(`\nOperator-ACCEPTED failures (left failing on purpose):`);
  for (const a of accepted)
    console.log(`  ${a.page} @${a.vw} "${a.label}" — ${a.why.slice(0, 96)}…`);
}

// BEFORE the `!rows.length` branch, and deliberately so: an unmeasured page
// contributes no failing region, so that branch would print "Backlog is empty"
// and exit 0 over a page nobody had looked at. Exit 2 matches the two guards
// above (`blanked`, `latest.size === 0`) — neither "clean" nor "work remains"
// but "this cannot be scored", the one answer rule 5's while-it-exits-1 loop
// cannot swallow. The score print stays above it so the partial state is still
// visible.
// A page with no anchors has not finished Phase 1, so a score has no referent
// and this refuses to invent one — the same answer `refMark: ""` gets from
// checkRef and an absent `## <page>` SPEC section gets from gate.sh. All three
// are seed sentinels, and this was the one that failed OPEN. Repo CLAUDE.md
// rule 1's corollary is the whole argument: a field that can only observe
// configuration must never be named after the thing it cannot observe, and
// "12 of 12 grid rows passed" observes a screenshot cut into quarters, not a
// design anyone specced.
//
// PRINTED here, EXITED below: `unmeasured` and `unscorable` are different pages
// with different remedies, and exiting inside the first block would hide the
// second from an operator who then fixes only what was printed.
if (unscorable.length) {
  console.error(
    `\nnext: ${unscorable.length} page(s) have no anchors, so their regions are page-diff's own\n` +
      `      fallback cut and cannot be scored — ` +
      unscorable.map((u) => `${u.p} (${u.regions} region(s))`).join(", ") +
      `.\n      Set "anchors" for them in matching/harness.json to section texts that exist on\n` +
      `      BOTH the reference and the candidate, then re-run: bash matching/gate.sh <tag> ` +
      unscorable.map((u) => u.p).join(" "),
  );
}

if (unmeasured.length) {
  console.error(
    `\nnext: ${unmeasured.length} page(s) have no countable gate run — ${unmeasured.join(", ")}.\n` +
      `      Re-run: bash matching/gate.sh <tag> ${unmeasured.join(" ")}`,
  );
  process.exit(2);
}

// See above: deliberately a second statement, not an `else`.
if (unscorable.length) process.exit(2);

if (!rows.length) {
  console.log(
    `\nNo open geometry failures. ${floorTotal} declared floor(s) remain.`,
  );
  console.log(
    "Backlog is empty — Phases 5 (states) and 6 (adversarial review) are what is left.",
  );
  process.exit(0);
}

// Worst page first, then worst region inside it: fix where the model is most wrong.
//
// INVARIANT, documented rather than guarded because no test could redden a
// guard here: `scored[0]` is safe because `scored` is empty only when every
// page in `latest` is unanchored — and that means `unscorable.length > 0`, so
// the exit above already fired. (`latest` being empty is caught further up.)
// `rows` likewise still contains unanchored pages' failing regions; they are
// never printed because that same exit fires first. Both facts depend on the
// exit staying ABOVE this line — a second filter here would be a second place
// to keep in sync, which is how checkRun and next.mjs drifted apart to begin
// with. If that exit ever moves, this becomes a TypeError.
const worst = scored[0].p;
rows.sort(
  (a, b) =>
    (a.page === worst ? -1 : 0) - (b.page === worst ? -1 : 0) || b.mm - a.mm,
);

console.log(
  `\n${openTotal} open failure(s) + ${floorTotal} declared floor(s).`,
);
console.log(`\nNEXT: ${worst} — worst page. Its open regions:\n`);
for (const r of rows.filter((r) => r.page === worst)) {
  const why = [];
  if (r.mm > THRESHOLD) why.push(`pixels ${(r.mm * 100).toFixed(1)}%`);
  if (Math.abs(r.dh) > MAX_HEIGHT_DELTA)
    why.push(`height ${(r.dh * 100).toFixed(1)}%`);
  console.log(
    `  @${String(r.vw).padEnd(5)} ${r.label.slice(0, 44).padEnd(45)} ${why.join(" + ")}`,
  );
}
console.log(`\nBefore treating any of these as geometry:`);
console.log(
  `  node matching/probe-anchor-parity.mjs ${worst}   # is the gate cutting comparably?`,
);
console.log(
  `  node matching/strikes.mjs ${worst}               # has it stalled? then change the MODEL`,
);
console.log(
  `\nRound continues. Do not hand back control with work outstanding.`,
);
process.exit(1);
