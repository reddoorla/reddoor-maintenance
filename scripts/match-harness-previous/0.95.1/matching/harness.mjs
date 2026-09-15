// The single source for everything the matching gates need to know about this
// site. DATA lives in matching/harness.json (site-edited); this file is the
// READ LAYER — edit harness.json, not this. (It is installed and upgraded by
// the `reddoor-maint match-harness` recipe, which owns these bytes: a hand
// edit here is flagged on the next run and never silently overwritten.)
//
// It exists because the page table, the two hosts, the matrix, the threshold
// and the skill path were hand-copied all over matching/. Re-measured
// 2026-09-09 AFTER the six-probe conversion, over the 216 tracked scripts under
// matching/ (214 top-level — 212 .mjs + 2 .sh — plus 2 in states/):
//
//   • a hand-typed copy of the page table (three or more gate keys sitting next
//     to their route): 8 files. Exactly ONE of them, probe-chrome-count.mjs,
//     still carries all nine rows; probe-anchors.mjs carries five; the other
//     six are three-row detail triples (team/svc/qa).
//   • the skill path (~/.claude/skills/matching-a-page): 193 copies
//   • the viewport matrix (1440/834/390): 51 copies
//   • REF pointed at a host listed in selfHosts — i.e. comparing the candidate
//     with itself: 12 scripts, one of which (probe-chrome-count.mjs) is also
//     the last nine-row table carrier
//
// The first bullet read "the nine-row page table: 5 copies — gate.sh,
// probe-anchor-parity.mjs, sweep-all10.sh, sweep-all16.sh, sweep-final.sh" when
// it was written here at 922dde3. It was wrong within the hour and wrong on two
// counts: 4e2cd7b took the table out of gate.sh, and the list never named
// states/index.mjs or probe-chrome-count.mjs, which were both carrying nine-row
// copies at the time. A census is a claim about code; it has to be measured
// against the tree, not recalled.
//
//   node matching/harness.mjs --env        shell-safe KEY='value' lines
//   node matching/harness.mjs --table      key<TAB>ref<TAB>cand<TAB>anchors
//   node matching/harness.mjs --check-ref  the D11 preflight; exit 2 on failure
//   node matching/harness.mjs --check-run <page> <out-dir> <startedAt-iso>
//                                         did THIS run leave a countable report?
//                                         exit 2 when it did not
import { readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// fileURLToPath, not URL#pathname: pathname is percent-encoded, so a checkout
// under a directory with a space in it would resolve to a path that does not
// exist.
const DIR = fileURLToPath(new URL(".", import.meta.url));
const CFG = JSON.parse(readFileSync(join(DIR, "harness.json"), "utf8"));

// Env overrides exist for one-off probes only. They are NOT how a site is
// configured — harness.json is, so that what a gate ran against is committed.
export const REF = process.env.MATCH_REF ?? CFG.ref;
export const CAND = process.env.MATCH_CAND ?? process.env.CAND_BASE ?? CFG.cand;
export const MATRIX = CFG.matrix;
export const THRESHOLD = CFG.threshold;
export const MAX_HEIGHT_DELTA = CFG.maxHeightDelta;
export const REF_MARK = CFG.refMark;
export const CAND_MARK = CFG.candMark;
export const SELF_HOSTS = CFG.selfHosts ?? [];

/** One record per gated page, in harness.json order. `key` is the gate key
 *  (out-<TAG>-<key>, the SPEC heading, spec-sections/<key>.md); `uid` is the
 *  Prismic uid or null where the page has no /dev/match twin. */
export const PAGES = Object.entries(CFG.pages).map(([key, p]) => ({ key, ...p }));
export const byKey = Object.fromEntries(PAGES.map((p) => [p.key, p]));

/** Can this page's region count be PREDICTED at all? It needs anchors — see
 *  TOTALS below — AND a matrix to measure them at. Exported beside TOTALS
 *  rather than left for each consumer to re-derive, because "remember to ask
 *  first" is exactly what failed: checkRun remembered, next.mjs did not, for
 *  two releases.
 *
 *  `MATRIX.length > 0` is not defensive padding. TOTALS is
 *  `(anchors + 1) * MATRIX.length`, so an ANCHORED page with `matrix: []`
 *  yields 0 — truthy-adjacent, arithmetically fatal. Measured on a page with 3
 *  anchors, an empty matrix and 8 passing regions: without this clause the
 *  scorer printed `SCORE 8/0 regions passing` and `Backlog is empty — Phases 5
 *  and 6 are what is left`, exit 0. The absurd fraction would be questioned;
 *  the sentence would not. `pass/0` is also Infinity, so such a page sorts
 *  BEST and can never be named `worst` — the same ranking bug this change set
 *  removed for unanchored pages, one input along. */
export const scorable = (key) =>
  (byKey[key]?.anchors?.length ?? 0) > 0 && MATRIX.length > 0;

/** WHY a page is not scorable, in the words of the thing that is actually
 *  missing. A refusal that states a cause it did not check is the shape
 *  CLAUDE.md names: a field must never be named after something it cannot
 *  observe. "no anchors" printed for a page carrying three of them sends the
 *  operator to edit the one part of harness.json that was already right. */
export const unscorableWhy = (key) =>
  (byKey[key]?.anchors?.length ?? 0) === 0
    ? "no anchors"
    : MATRIX.length === 0
      ? "matrix is empty"
      : null;

// DERIVED, never hand-typed: page-diff cuts one region before the first anchor
// ("top") plus one per anchor, at every viewport. The old hand-written map went
// stale the moment an anchor list changed, and a wrong denominator makes the
// score a lie in the flattering direction.
//
// THAT IDENTITY HOLDS ONLY WITH ANCHORS. `splitRegions` (page-diff.mjs:103-110)
// only cuts by anchor when there are anchors to cut by; with none it falls back
// to the page's own <section> boxes, and with none of those to an even four-row
// grid (lib/regions.mjs:27-35, gridRows = 4, labels `grid-<r>-<c>`). So the
// count is DATA-DEPENDENT, the two pages need not even agree, and no formula
// over anchors can predict it.
//
// `checkRun` below already reaches this conclusion — its `if (secs.length)`
// guard declines to assert a region count without anchors, and says why. That
// fix was applied to the VALIDATOR and never carried to the DENOMINATOR, so
// next.mjs went on dividing a real pass count by an imaginary total. Measured
// 2026-09-09 on a seed harness (anchors: [], matrix of 3): page-diff produced
// 12 grid regions, all passing, and next.mjs printed `SCORE 12/3 regions
// passing` followed by "Backlog is empty — Phases 5 and 6 are what is left",
// exit 0. On a matrix of 4 the same seed prints `SCORE 16/4`. The absurd
// fraction would have been questioned; the sentence would not.
//
// So an unpredictable page gets NO NUMBER — `null`, not a plausible-looking
// integer. That is a SIGNAL, not a barrier: `a + null` is `a`, so a consumer
// that sums TOTALS without asking `scorable()` still gets a too-small
// denominator. The barrier is `scorable()` plus next.mjs's exit-2 refusal.
export const TOTALS = Object.fromEntries(
  PAGES.map((p) => [p.key, scorable(p.key) ? (p.anchors.length + 1) * MATRIX.length : null]),
);

/** The SPEC.md heading predicate, shared by gate.sh's preflight and
 *  build-spec.mjs so a section can never build fine and then refuse at the
 *  gate. Matches the key followed by any non-key character (`## team` matches,
 *  `## teamfoo` does not, `## our-team` cannot match `team`). */
export const specHeadingRe = (key) => new RegExp(`^##+ +${key}([^A-Za-z0-9_-]|$)`, "m");

export const SKILL_DIR =
  process.env.MATCHING_SKILL_DIR ?? join(homedir(), ".claude/skills/matching-a-page");
export const PD = join(SKILL_DIR, "page-diff.mjs");
export const SC = join(SKILL_DIR, "style-census.mjs");
export const PLAYWRIGHT = pathToFileURL(join(SKILL_DIR, "node_modules/playwright/index.mjs")).href;

/** The report format this site's scripts can read, so gate.sh can compare it
 *  with `page-diff --version` before spending a run and next.mjs can refuse
 *  rather than quietly drop a page whose newest report came from another
 *  schema. Both do that now — gate.sh preflights `page-diff --version` against
 *  this value before spending a run, and next.mjs counts a foreign-schema
 *  report as MISSING rather than skipping it. (This said "neither does that
 *  yet" — true at 922dde3 where it was written, false from 4e2cd7b, which
 *  gave gate.sh the preflight and did not come back here.) Checked 2026-09-09
 *  against the installed skill: `page-diff --version` → `page-diff 0.1.0
 *  report-schema 1`. */
export const REPORT_SCHEMA = 1;

/**
 * Fail-closed reference preflight. A 200 is NOT evidence: a host that has been
 * repointed at our own build answers 200, and so does a staging host serving a
 * 404 page. Both have happened on a real site — see the dated measurement in
 * LEDGER.md. A pass here requires an artefact only the reference produces.
 */
export async function checkRef() {
  if (!REF_MARK) {
    return {
      ok: false,
      why: "harness.json refMark is empty — set it to a string only the reference serves (a Webflow site id, a build hash). A 200 is not evidence.",
    };
  }
  const host = new URL(REF).host;
  if (SELF_HOSTS.includes(host)) return { ok: false, why: `REF host ${host} is in selfHosts` };
  if (host === new URL(CAND).host) return { ok: false, why: `REF host ${host} equals CAND's host` };
  let res;
  try {
    res = await fetch(`${REF}/`, { redirect: "manual" });
  } catch (e) {
    return { ok: false, why: `GET ${REF}/ failed: ${e.message}` };
  }
  if (res.status !== 200)
    return { ok: false, why: `GET ${REF}/ → HTTP ${res.status}, expected 200` };
  const loc = res.headers.get("location");
  if (loc) return { ok: false, why: `GET ${REF}/ → ${res.status} redirect to ${loc}` };
  const body = await res.text();
  if (!body.includes(REF_MARK))
    return {
      ok: false,
      why: `${REF}/ served 200 but WITHOUT refMark ${JSON.stringify(REF_MARK)} — that is not the reference`,
    };
  if (CAND_MARK && body.includes(CAND_MARK))
    return {
      ok: false,
      why: `${REF}/ contains candMark ${JSON.stringify(CAND_MARK)} — REF is serving OUR build`,
    };
  return { ok: true, why: `${REF}/ → 200, no redirect, refMark present, candMark absent` };
}

/**
 * Would next.mjs COUNT a run with this meta? Returns the reason it would not,
 * as a string, or null when it would.
 *
 * A reason string and not a boolean, because the two callers must tell the
 * cases apart: next.mjs treats "schema" as a page BLANKED (it has its own
 * message and its own exit) and merely skips the rest of the diagnostics,
 * while gate.sh prints whatever this says.
 *
 * It lives HERE rather than inside next.mjs because gate.sh now asks the same
 * question, and a question asked twice drifts: a gate that greens a run
 * next.mjs then drops is the same false green one step along. census.sh's
 * GUARD 2c (census.sh:153-168) records exactly that drift between
 * style-census's printer and census-count.mjs's parser — a COMPLETE census
 * reported as 0 mismatches because the two had versioned apart.
 */
export function uncountable(m) {
  // Missing schemaVersion means "written before the field existed" = 0. It is
  // not an error on its own; it is only fatal when it would blank a page,
  // which is next.mjs's call to make, not this predicate's.
  if ((m.schemaVersion ?? 0) !== REPORT_SCHEMA) return "schema";
  // A masked / media-neutralised run is a DIAGNOSTIC, never the state of the
  // page. An --mask-photos probe of yfv made `top` @834 read 43.9% while the
  // real gate had it passing at 1.3%.
  if ((m.mask?.length ?? 0) > 0) return `mask=[${m.mask.join(", ")}]`;
  if (m.neutralizeMedia) return "neutralize-media";
  if (m.maskPhotos) return "mask-photos";
  if (m.truncated) return "truncated";
  if (m.threshold !== THRESHOLD) return `threshold ${m.threshold} != ${THRESHOLD}`;
  return null;
}

/**
 * Did THIS run of page-diff leave a report the scorer will actually count?
 *
 * gate.sh cannot use page-diff's exit status for this. page-diff exits 1 for a
 * region that legitimately FAILED (page-diff.mjs:227) and node exits 1 for the
 * bare `throw e` one line below it, so the status cannot tell a finding from a
 * crash-before-looking — census.sh:17-32 records the same shape for
 * style-census. Measured on 29 Navy with the reference alive and no dev
 * server: every page-diff died in `page.goto`, the gate printed `home exit=1`
 * and `ALL DONE`, exited 0, and wrote no report at all.
 *
 * So the evidence is the artefact only a completed run leaves: the report
 * next.mjs will read, fresh, over the matrix and anchors the table declares.
 * Cheapest and most specific arm first.
 */
export function checkRun(page, dir, startedAt) {
  const path = join(dir, "report.json");
  let report;
  try {
    report = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    if (e.code === "ENOENT")
      return { ok: false, why: `${path}: no report.json — the run wrote nothing` };
    return { ok: false, why: `${path}: ${e.message}` };
  }
  const meta = report.meta ?? {};

  const uncount = uncountable(meta);
  if (uncount)
    return { ok: false, why: `${path}: next.mjs would not count this run (${uncount})` };

  // FRESHNESS. lib/report.mjs:45 is `mkdirSync(outDir, {recursive:true})` and
  // nothing ever clears the directory, so a crashed re-run under a tag used
  // before leaves the PREVIOUS round's report exactly where it was — measured
  // 2026-09-09, sha unchanged across the crash. Requiring report.json without
  // this arm reproduces the green one step along. meta.generatedAt is built
  // after `finally { await browser.close() }` (page-diff.mjs:163-176), so it
  // is an artefact of the run that wrote it and not of the file's mtime.
  const since = Date.parse(startedAt);
  // NOT skipped when startedAt is unusable: a fail-open default is the exact
  // shape this guard exists to stop.
  if (!Number.isFinite(since))
    return {
      ok: false,
      why: `startedAt ${JSON.stringify(startedAt)} is not a timestamp — cannot tell this run's report from a previous round's`,
    };
  const at = Date.parse(meta.generatedAt ?? "");
  if (!Number.isFinite(at))
    return {
      ok: false,
      why: `${path}: no usable meta.generatedAt — cannot tell this run's report from a previous round's`,
    };
  if (at < since)
    return {
      ok: false,
      why: `${path}: STALE — written ${meta.generatedAt}, this run started ${startedAt}. page-diff never cleared the directory.`,
    };

  // COVERAGE — what the run was ASKED for, against the table.
  const vws = meta.viewports ?? [];
  if (vws.join(",") !== MATRIX.join(","))
    return {
      ok: false,
      why: `${path}: ran viewports [${vws.join(",")}], harness.json matrix is [${MATRIX.join(",")}]`,
    };
  const secs = meta.sections ?? [];
  const want = byKey[page]?.anchors ?? [];
  if (secs.join("\0") !== want.join("\0"))
    return {
      ok: false,
      why: `${path}: ran sections [${secs.join(" | ")}], harness.json anchors are [${want.join(" | ")}]`,
    };

  // ...and what it actually PRODUCED. Every viewport the run says it covered
  // has to appear in the regions. Deliberately compared against the run's own
  // meta.viewports and not against MATRIX: the arm above owns "the run used the
  // wrong matrix", and folding the two together would make either one
  // unfalsifiable on its own.
  if (!Array.isArray(report.regions) || report.regions.length === 0)
    return { ok: false, why: `${path}: no regions — nothing was compared` };
  const seen = new Set(report.regions.map((r) => r.viewport));
  const missing = vws.filter((v) => !seen.has(v));
  if (missing.length)
    return {
      ok: false,
      why: `${path}: no region at viewport(s) [${missing.join(",")}] — the run covered [${[...seen].join(",")}]`,
    };

  // With anchors the region count is an exact identity: page-diff cuts one
  // region before the first anchor plus one per anchor, at every viewport
  // (regionsFromAnchors, page-diff.mjs:105-109). Measured over the 298 clean
  // gate-shaped runs in the corpus this harness was cut from, all of them
  // anchored: regions.length === (sections + 1) * viewports holds 298/298,
  // while regions.length === TOTALS[page] holds only 260/298 — the 38 are
  // legitimately narrower HAND rounds. So the identity is checked against the
  // run's OWN meta and the matrix/anchors are checked against the table above.
  //
  // WITHOUT anchors there is no such identity, and asserting one is a FALSE
  // REFUSAL of the shape every new site starts in. page-diff falls back to each
  // page's own <section> boxes and, with none, an even four-row grid
  // (splitRegions, page-diff.mjs:103-110), so the count is data-dependent and
  // the two pages need not even agree. Measured 2026-09-09 against the real
  // page-diff on a seed harness (anchors: [], matrix of 4): 16 regions labelled
  // grid-0-0 … grid-3-0, not the 4 this identity predicted. The 298/298 above
  // was measured over anchored runs only and never covered this case.
  if (secs.length) {
    const expected = (secs.length + 1) * vws.length;
    if (report.regions.length !== expected)
      return {
        ok: false,
        why: `${path}: ${report.regions.length} region(s), expected ${expected} = (${secs.length} anchors + 1) x ${vws.length} viewport(s)`,
      };
  }

  // A green that STATES what it is made of, so a green over nothing reads
  // differently from a green over the matrix (census.sh:219's habit).
  return {
    ok: true,
    why: `${report.regions.length} region(s) over ${vws.length} viewport(s), written ${meta.generatedAt}`,
  };
}

// CLI. Both sides go through realpathSync. `import.meta.url` is ALREADY the
// resolved real path (node resolves symlinks unless --preserve-symlinks) while
// process.argv[1] is the path as typed, so a plain pathToFileURL compare goes
// false the moment any component of the invoked path is a symlink — and then
// the CLI prints nothing and exits 0, which every caller reads as success.
// page-diff.mjs:184-189 records exactly that defect and the same fix: "The
// pathToFileURL compare that replaced the old template string is still false
// whenever ANY component of the invoked path is a symlink — which is how this
// skill is installed now (~/.claude/skills/matching-a-page -> the claude-skills
// checkout). isMain() resolves the real path on both sides."
const isMain = () => {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
};

if (isMain()) {
  const mode = process.argv[2];
  const q = (v) => `'${String(v).replace(/'/g, `'\\''`)}'`;
  if (mode === "--env") {
    const pairs = [
      ["REF", REF],
      ["CAND", CAND],
      ["MATRIX", MATRIX.join(",")],
      ["VIEWPORTS_SP", MATRIX.join(" ")],
      ["THRESHOLD", THRESHOLD],
      ["MAX_HEIGHT_DELTA", MAX_HEIGHT_DELTA],
      ["PD", PD],
      ["SC", SC],
      ["REPORT_SCHEMA", REPORT_SCHEMA],
    ];
    for (const [k, v] of pairs) console.log(`${k}=${q(v)}`);
  } else if (mode === "--table") {
    for (const p of PAGES) console.log([p.key, p.ref, p.cand, p.anchors.join(",")].join("\t"));
  } else if (mode === "--check-ref") {
    const r = await checkRef();
    console.log(`${r.ok ? "REF OK" : "REF REFUSED"} — ${r.why}`);
    process.exit(r.ok ? 0 : 2);
  } else if (mode === "--check-run") {
    // startedAt is REQUIRED, never defaulted: an optional one is a fail-open
    // door in the one guard that decides whether a page was measured at all.
    const [page, dir, startedAt] = process.argv.slice(3);
    if (!page || !dir || !startedAt) {
      console.error("usage: harness.mjs --check-run <page> <out-dir> <startedAt-iso>");
      process.exit(2);
    }
    const r = checkRun(page, dir, startedAt);
    console.log(`${r.ok ? "RUN OK" : "NO RUN"} — ${r.why}`);
    process.exit(r.ok ? 0 : 2);
  } else {
    console.error("usage: harness.mjs --env | --table | --check-ref | --check-run");
    process.exit(2);
  }
}
