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

// DERIVED, never hand-typed: page-diff cuts one region before the first anchor
// ("top") plus one per anchor, at every viewport. The old hand-written map went
// stale the moment an anchor list changed, and a wrong denominator makes the
// score a lie in the flattering direction.
export const TOTALS = Object.fromEntries(
  PAGES.map((p) => [p.key, (p.anchors.length + 1) * MATRIX.length]),
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
  } else {
    console.error("usage: harness.mjs --env | --table | --check-ref");
    process.exit(2);
  }
}
