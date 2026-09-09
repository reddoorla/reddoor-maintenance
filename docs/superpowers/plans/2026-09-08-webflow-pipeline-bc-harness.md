# Matching Harness: Consolidate in Beachfront, Ship as a Recipe Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse Beachfront's nine-times-duplicated matching harness onto one data file plus one read layer, then cut a versioned, tested `match-harness` maintenance recipe from those consolidated files, so a fresh native clone installs the harness by running a command instead of by reading Beachfront.

**Architecture:** `matching/harness.json` is data (reference, candidate, matrix, thresholds, fingerprints, the page table); `matching/harness.mjs` is recipe-owned code that loads it and exports what every script needs plus a three-mode CLI (`--env`, `--table`, `--check-ref`) so the two bash gates hold no second copy. Every other script imports from it. The recipe is generated from those exact files by `scripts/gen-match-harness-template.mjs`, installs install-if-absent with a byte-compare safe-replace for recipe-owned scripts, and never overwrites a file a site edits.

**Tech Stack:** bash + Node ESM (site side, no dependencies); TypeScript + vitest + `withRecipe` + cac (maintenance side); the `matching-a-page` skill supplies `page-diff.mjs` / `style-census.mjs`, located through `MATCHING_SKILL_DIR`.

**Depends on:**

- **Plan A (skills repo)** should have landed `reddoorla/claude-skills` with `skills/matching-a-page/` in it and `~/.claude/skills/matching-a-page` resolving into that clone. Task 1 edits `lib/report.mjs` and `page-diff.mjs` **through that path**: it resolves `readlink -f` first and commits in whatever git repo contains the real path, so it works either before or after A.
- Nothing else. Plan D (seed + sync) is independent; Plan E consumes this plan's `match-harness` command name and `matching/harness.json` vocabulary but does not block it.

**Repos touched:**

| Repo                                                                 | Branch                                                               | Tasks |
| -------------------------------------------------------------------- | -------------------------------------------------------------------- | ----- |
| the `matching-a-page` skill (via `~/.claude/skills/matching-a-page`) | `feat/report-schema`                                                 | 1     |
| `beachfront-dentistry`                                               | `chore/matching-harness-consolidation` (off `main`)                  | 2–11  |
| `beachfront-dentistry`                                               | `chore/prismic-models-first-run` (off `main`, **not** stacked)       | 16    |
| `reddoor-maintenance`                                                | `feat/match-harness-recipe`, in a **git worktree** (CLAUDE.md:53-55) | 12–15 |

**Assumptions:**

- `beachfront-dentistry` has **no `pnpm verify` script**. Verified — its `package.json` scripts are `dev, vite:dev, build, preview, check, prismic:types, check:watch, lint, format, test, test:unit, test:unit:watch, test:smoke, slicemachine`. Wherever the brief says "pnpm verify green" for Beachfront, this plan runs `pnpm lint && pnpm check && pnpm test:unit && pnpm build`. `pnpm verify` exists in `reddoor-maintenance` and is used as-is.
- Beachfront's `.prettierrc` takes prettier's defaults (printWidth 80); the starter's sets printWidth 100. The recipe therefore ships the recipe-owned harness **code** in `.prettierignore` rather than reformatting it per site — Task 13 explains why byte-stability beats formatting here.
- **Deviation, stated on purpose.** The decided installed set names two marked blocks (`.gitignore`, `CLAUDE.md`); this plan installs a **third**, in `.prettierignore`. It is narrowed to the files that must stay byte-identical to the template — `matching/*.mjs`, `matching/*.sh`, `matching/harness.json` — so `matching/**/*.md` (SPEC.md, LEDGER.md, spec-sections/) stays inside `prettier --check .`. Measured on Beachfront: 215 files leave prettier's scope (212 top-level `*.mjs` — 211 today plus `harness.mjs` — plus `gate.sh`, `census.sh`, `harness.json`); the 15 `.md` files and `matching/states/*.mjs` stay. That narrowing matters because `eslint.config.js:52` already ignores `matching/` wholesale, so prettier is the **only** style check the directory has, and exempting all 247 files would leave none. Consequence the recipe must respect: `toFormat` is `src/` + `CLAUDE.md`, so the three Markdown stubs the recipe installs are never prettier-formatted on install and must be authored prettier-clean — Task 15 case 13 is the check.
- The spec's C2 prose says `site-pages.js` exports `assemblies(img)`, `TITLES`, `META`; the session decisions say `documents(img)` + `lang` (the Plan D `SeedDocument` contract). **The decisions win** — the installed route does `documents(devImg).find((d) => d.uid === params.uid)`.
- `reddoor-maintenance` has **no `docs/workJournal.md`** (verified: `docs/` holds `autonomy-journal.md`). Its journal is `docs/autonomy-journal.md`, one row per merged PR.
- Beachfront's `matching/PAUSED` exists (1281 bytes, 2026-09-02). Any proof that must reach code below the pause switch moves it aside and restores it in the same step.
- Both reference hosts are dead (`beachfront-dentistry.webflow.io` → 404 on every path; `www.beachfrontdentistry.com` → 301 to our own Netlify build). Beachfront's proof is that the preflight **refuses**, never that a run goes green.
- `matching/harness.json` cannot hold comments, so the site-specific rationale currently living in `gate.sh:14-18`, `:32-37` and `:125-134` moves to `matching/LEDGER.md` (Task 8), not into the data file and not into the generic script.

---

## File structure

**skill (`~/.claude/skills/matching-a-page`, real path)**

- Modify: `lib/report.mjs:1-3,67` — `REPORT_SCHEMA`, `meta.schemaVersion`
- Modify: `page-diff.mjs:3,8,190` — a `--version` branch

**beachfront-dentistry**

- Create: `matching/harness.json` · `matching/harness.mjs` · `matching/spec-sections/_header.md`
- Modify: `.gitignore:52` (add `!matching/harness.json` — `matching/*.json` ignores it today) · `.prettierignore` (append the three recipe-owned-code entries — the third marked block, see Assumptions)
- Modify: `matching/gate.sh:1-29,31-39,91,99,105-136` · `matching/census.sh:16-44` · `matching/next.mjs:31-43,61-72,149-150` · `matching/strikes.mjs:23-25,43-46,49-63,156-157` · `matching/build-spec.mjs:10-27,46,54-72` · `matching/summarize.mjs:12-22` · `matching/probe-anchor-parity.mjs:17-113` · `matching/hover-sweep.mjs:22-34,53,114` · `matching/states.mjs:16-20,135` · `matching/states/index.mjs:112-126` · `matching/gate-published.mjs:25-38,88-98,126` · `matching/walk.mjs:13-36` · `matching/LEDGER.md` (append) · `src/routes/dev/match/[uid]/+page.server.ts:1,55`
- Delete: `matching/sweep*.sh` (16 files)
- Modify (Task 16, separate branch): `customtypes/settings/index.json:3`
- Modify (Task 17): `docs/workJournal.md`

**reddoor-maintenance**

- Create: `scripts/gen-match-harness-template.mjs` · `src/recipes/match-harness/template.ts` (generated) · `src/recipes/match-harness/index.ts` · `src/cli/commands/match-harness.ts` · `tests/recipes/match-harness.test.ts` · `.changeset/match-harness-recipe.md`
- Modify: `src/types.ts:31-43` · `src/recipes/index.ts:1-63` · `src/cli/bin.ts:50-68` and after `:386` · `tests/cli/fleet-workdir-forwarding.test.ts:9-31` · `README.md` · `docs/autonomy-journal.md`

---

### Task 1: The report schema version lives in the skill

**Files:** Modify: `<SKILL>/lib/report.mjs:1-3,67` · `<SKILL>/page-diff.mjs:3,8,190` · Test: the `--version` probe below (the skill's suite is `node --test`, no vitest)

Resolve once and reuse: `SKILL="$(readlink -f ~/.claude/skills/matching-a-page 2>/dev/null || echo "$HOME/.claude/skills/matching-a-page")"`. Writes under `~/.claude/skills` are denied by the sandbox — run this task's steps **unsandboxed**.

- [ ] **Step 1: Write the failing test** — the positive artefact is a line that names the schema. Probe for it:

```bash
cd "$SKILL" && node page-diff.mjs --version; echo "exit=$?"
```

- [ ] **Step 2: Run it and watch it fail** — expect the usage string beginning `usage: page-diff --ref <url> --cand <url> [--viewports 1440,390]` and `exit=2`. (`lib/args.mjs` parses `--version` as a bare flag, then `!a.ref` refuses at `page-diff.mjs:191`.)

- [ ] **Step 3: Implement** — three edits.

`lib/report.mjs`, insert after the imports (currently lines 1-3):

```js
/** Report format version. Bump ONLY when a consumer of report.json would read
 *  an older file wrongly. It is written into every report's meta and printed by
 *  `page-diff --version`; a site's matching/harness.mjs pins the value it
 *  expects and gate.sh refuses to spend a run on a mismatch. Without this, a
 *  skill upgrade can blank a page from a site's score with no error anywhere. */
export const REPORT_SCHEMA = 1;
```

`lib/report.mjs:67-68`, change:

```js
  const json = {
    meta,
```

to:

```js
  const json = {
    meta: { schemaVersion: REPORT_SCHEMA, ...meta },
```

`page-diff.mjs`: add `import { readFileSync } from "node:fs";` beside the `node:url` import at line 3; change line 8 to `import { summarise, writeArtifacts, REPORT_SCHEMA } from "./lib/report.mjs";`; and insert immediately after `const a = parseArgs(process.argv.slice(2));` (line 190), **before** the `!a.ref` check at 191:

```js
if (a.version === true) {
  const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));
  console.log(`page-diff ${pkg.version} report-schema ${REPORT_SCHEMA}`);
  process.exit(0);
}
```

- [ ] **Step 4: Run it and watch it pass**

```bash
cd "$SKILL" && node page-diff.mjs --version && node --test
```

Expect exactly `page-diff 0.1.0 report-schema 1` (exit 0) and the existing `node --test` suite still green.

- [ ] **Step 5: Commit**

```bash
cd "$SKILL" && git checkout -b feat/report-schema && git add lib/report.mjs page-diff.mjs
git commit -m "feat: every report carries a schema version, and page-diff can say it

A site's gate scripts read report.json, and until now nothing in the file said
which page-diff wrote it — so a format change could blank a page from a site's
score with no error anywhere. meta.schemaVersion is the artefact; --version is
how a gate checks it before spending a run.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Freeze the old page table, then write `matching/harness.json`

**Files:** Create: `beachfront-dentistry/matching/harness.json` · Test: the frozen TSV below (the diff in Task 3 is the test)

The nine `run` lines in `gate.sh:106-136` are the only canonical copy. They must be captured **before** anything deletes them, or the byte-identity proof is unfalsifiable.

- [ ] **Step 1: Write the failing test** — freeze the current table into a scratch artefact (`$TMPDIR` is outside the repo, so nothing is committed):

```bash
cd ~/Documents/GitHub/beachfront-dentistry && git checkout -b chore/matching-harness-consolidation
perl -0777 -pe 's/\\\n\s*/ /g' matching/gate.sh | grep -E '^run ' \
  | perl -pe 's/^run (\S+) +"([^"]*)" +"([^"]*)" +"([^"]*)"\s*$/$1\t$2\t$3\t$4\n/' \
  > "$TMPDIR/gate-rows.tsv"
wc -l < "$TMPDIR/gate-rows.tsv"
```

- [ ] **Step 2: Run it and watch it fail** — `wc -l` must print `9`. Then confirm the comparison target does not exist yet:
      `node matching/harness.mjs --table` → `Error: Cannot find module '.../matching/harness.mjs'`.

- [ ] **Step 3: Implement** — three edits: the data file, and the two ignore files that decide whether it survives a clone.

(a) `matching/harness.json`. Key order is `gate.sh` order (detail templates, then nav), because `--table` must emit rows in that order to diff line-for-line against the frozen file. `published` is the real route on CAND; `uid` is the Prismic uid, `null` where the page has no `/dev/match` twin. `anchors` are verbatim from the frozen rows. One line per page on purpose — see (c).

```json
{
  "ref": "https://beachfront-dentistry.webflow.io",
  "cand": "http://localhost:5173",
  "matrix": [1440, 834, 390],
  "threshold": 0.1,
  "maxHeightDelta": 0.05,
  "refMark": "data-wf-site=\"64af3f93339537d6b661b556\"",
  "candMark": "_app/immutable",
  "selfHosts": ["beachfrontdentistry.com", "www.beachfrontdentistry.com"],
  "pages": {
    "team": {
      "uid": null,
      "ref": "/team-members/dr-robert-quan",
      "cand": "/team-members/dr-robert-quan",
      "published": "/team-members/dr-robert-quan",
      "anchors": ["Dentist", "Back to Team", "Ready for great", "Want to learn more"],
      "spec": "team",
      "group": "detail"
    },
    "svc": {
      "uid": null,
      "ref": "/services/dental-exams",
      "cand": "/services/dental-exams",
      "published": "/services/dental-exams",
      "anchors": [
        "What to expect",
        "Back to All Services",
        "Ready for great",
        "Want to learn more"
      ],
      "spec": "svc",
      "group": "detail"
    },
    "qa": {
      "uid": null,
      "ref": "/questions/regular-dental-cleanings-support-your-whole-body-health",
      "cand": "/questions/regular-dental-cleanings-support-your-whole-body-health",
      "published": "/questions/regular-dental-cleanings-support-your-whole-body-health",
      "anchors": [
        "At Beachfront Dentistry",
        "Have another question",
        "Ready for great",
        "Want to learn more"
      ],
      "spec": "qa",
      "group": "detail"
    },
    "home": {
      "uid": "home",
      "ref": "/",
      "cand": "/dev/match/home",
      "published": "/",
      "anchors": [
        "Finally have a dentist",
        "MEET YOUR TEAM",
        "Serving the South Bay",
        "Your Path to Oral Health",
        "Our dental team in Redondo",
        "Beyond the Smile",
        "Ready for great dental health",
        "Want to learn more"
      ],
      "spec": "home",
      "group": "nav"
    },
    "yfv": {
      "uid": "your-first-visit",
      "ref": "/your-first-visit",
      "cand": "/dev/match/your-first-visit",
      "published": "/your-first-visit",
      "anchors": [
        "We want you to feel comfortable",
        "Office Tour",
        "Dr. Robert Quan",
        "To be a long term health partner",
        "Serving the South Bay for over 40 years",
        "Ready for great dental health",
        "Want to learn more"
      ],
      "spec": "yfv",
      "group": "nav"
    },
    "our-team": {
      "uid": "our-team",
      "ref": "/our-team",
      "cand": "/dev/match/our-team",
      "published": "/our-team",
      "anchors": ["Our", "Dr. Robert Quan", "Ready for great dental health", "Want to learn more"],
      "spec": "our-team",
      "group": "nav"
    },
    "services": {
      "uid": "services",
      "ref": "/services",
      "cand": "/dev/match/services",
      "published": "/services",
      "anchors": [
        "Cosmetic Dentistry",
        "General Dentistry",
        "Ready for great dental health",
        "Want to learn more"
      ],
      "spec": "services",
      "group": "nav"
    },
    "atd": {
      "uid": "ask-the-doctor",
      "ref": "/ask-the-doctor",
      "cand": "/dev/match/ask-the-doctor",
      "published": "/ask-the-doctor",
      "anchors": [
        "Beyond the Smile",
        "Back to Top",
        "Ready for great dental health",
        "Want to learn more"
      ],
      "spec": "atd",
      "group": "nav"
    },
    "contact": {
      "uid": null,
      "ref": "/contact-us",
      "cand": "/contact-us",
      "published": "/contact-us",
      "anchors": ["OFFICE HOURS", "Ready for great dental health", "Want to learn more"],
      "spec": "contact",
      "group": "nav"
    }
  }
}
```

(b) **`.gitignore`** — without this the file is invisible. `.gitignore:52` is `matching/*.json`, so `git check-ignore -v matching/harness.json` reports `matching/*.json` today: the whole point of moving the table into a file would be lost on the next clone. Insert after line 52, so the negation wins:

```gitignore
# ...except the page table itself, which is the harness's configuration and the
# one thing a fresh clone cannot reconstruct.
!matching/harness.json
```

(c) **`.prettierignore`** — append under the existing "kept verbatim, so they aren't style-linted" convention (the repo already exempts `src/lib/blux/products.json` and the frozen-page artefacts for the same reason). Three entries, **not** `matching/`: `eslint.config.js:52` already ignores the whole directory, so prettier is the only style check these 247 files have, and exempting all of them would leave none.

```gitignore
# Matching harness — recipe-owned CODE only. These files are the source the
# `match-harness` recipe is cut from and are re-installed byte-for-byte across
# sites whose printWidth differs from this repo's; formatting them per site
# would make every future upgrade read as a hand edit. harness.json is one line
# per page for the same reason — it is a table, not prose. Everything else under
# matching/ (SPEC.md, LEDGER.md, spec-sections/, states/*.mjs) stays inside
# `prettier --check .`; eslint already ignores this whole directory
# (eslint.config.js:52), so that is the only style check the records have.
matching/*.mjs
matching/*.sh
matching/harness.json
```

- [ ] **Step 4: Run it and watch it pass** — the file parses and the nine keys are in `gate.sh` order:

```bash
node -e 'const c=require("./matching/harness.json");console.log(Object.keys(c.pages).join(" "));console.log(Object.values(c.pages).map(p=>p.anchors.length).join(","))'
```

Expect `team svc qa home yfv our-team services atd contact` and `4,4,4,8,7,4,4,4,3`. Then the check that matters most:

```bash
git check-ignore -v matching/harness.json || echo "TRACKED"
pnpm exec prettier --check matching/harness.json 2>&1 | tail -1
```

Expect `TRACKED` and prettier reporting the file as ignored, not as unformatted.

- [ ] **Step 5: Commit**

```bash
git add matching/harness.json .gitignore .prettierignore && git commit -m "chore(matching): the page table becomes data, once

Nine scripts each carried their own copy of this table and they had already
drifted: probe-anchor-parity still cut contact on \"Book Appointment\" seven
weeks after the gate moved to \"OFFICE HOURS\". A JSON file cannot drift from
itself.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: `matching/harness.mjs` — the read layer and its CLI

**Files:** Create: `beachfront-dentistry/matching/harness.mjs` · Test: the `--table` diff against `$TMPDIR/gate-rows.tsv` and the TOTALS deep-equal

- [ ] **Step 1: Write the failing test** — two mechanical checks that only a correct read layer passes:

```bash
cd ~/Documents/GitHub/beachfront-dentistry
node matching/harness.mjs --table | diff - "$TMPDIR/gate-rows.tsv" && echo "TABLE IDENTICAL"
node --input-type=module -e '
import { TOTALS } from "./matching/harness.mjs";
const OLD = {home:27,yfv:24,"our-team":15,services:15,atd:15,contact:12,team:15,svc:15,qa:15};
const same = Object.keys(OLD).every(k => TOTALS[k] === OLD[k]) &&
             Object.keys(TOTALS).length === Object.keys(OLD).length;
console.log(same ? "TOTALS MATCH" : "TOTALS DIFFER " + JSON.stringify(TOTALS));
process.exit(same ? 0 : 1);'
```

- [ ] **Step 2: Run it and watch it fail** — both commands fail with `Cannot find module '.../matching/harness.mjs'`.

- [ ] **Step 3: Implement** — whole file:

```js
// The single source for everything the matching gates need to know about this
// site. DATA lives in matching/harness.json (site-edited); this file is the
// READ LAYER (installed by `reddoor-maint match-harness` — edit harness.json,
// not this). It exists because the page table, the two hosts, the matrix, the
// threshold and the skill path used to be hand-copied into nine scripts, and
// six of them were still gating against a host that serves OUR OWN build.
//
//   node matching/harness.mjs --env        shell-safe KEY='value' lines
//   node matching/harness.mjs --table      key<TAB>ref<TAB>cand<TAB>anchors
//   node matching/harness.mjs --check-ref  the D11 preflight; exit 2 on failure
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const DIR = new URL(".", import.meta.url).pathname;
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

/** The report format this site's scripts can read. gate.sh compares it with
 *  `page-diff --version` before spending a run; next.mjs refuses rather than
 *  quietly dropping a page whose newest report came from another schema. */
export const REPORT_SCHEMA = 1;

/**
 * Fail-closed reference preflight. A 200 is NOT evidence — `www` 301s to our
 * own Netlify build and the webflow.io staging host 404s with a 906-byte page,
 * and three tools spent weeks comparing the candidate with itself. A pass here
 * requires an artefact only the reference produces.
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

// CLI. pathToFileURL rather than a string compare: a path needing percent-
// encoding makes the naive form silently no-op (page-diff.mjs:184-189).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
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
```

- [ ] **Step 4: Run it and watch it pass** — re-run Step 1's two commands: expect `TABLE IDENTICAL` and `TOTALS MATCH`. Then check `--env` and that the preflight refuses the dead reference:

```bash
node matching/harness.mjs --env
node matching/harness.mjs --check-ref; echo "exit=$?"
```

`--env` prints nine `KEY='value'` lines. `--check-ref` prints `REF REFUSED — GET https://beachfront-dentistry.webflow.io/ → HTTP 404, expected 200` and `exit=2`.

- [ ] **Step 5: Commit**

```bash
git add matching/harness.mjs && git commit -m "feat(matching): one read layer over the page table, with a fail-closed preflight

TOTALS are now derived (anchors + 1, times the matrix) instead of hand-typed —
a wrong denominator flatters the score, which is the direction that does not get
noticed. checkRef requires an artefact only the reference produces: 200, no
redirect, its own fingerprint present, ours absent. Both of this site's
reference hosts fail it today, which is the point.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: `gate.sh` consumes the read layer

**Files:** Modify: `beachfront-dentistry/matching/gate.sh:1-29,31-39,91,99,105-136` · Test: the four checks below

- [ ] **Step 1: Write the failing test** — four behaviours, two of which are currently impossible:

```bash
bash matching/gate.sh x-y; echo "hyphen exit=$?"          # must stay 2, hyphen message
SPEC_OPTIONAL=1 bash matching/gate.sh smoke home; echo "smoke exit=$?"
grep -c 'gate-chrome' matching/gate.sh
grep -ci beachfront matching/gate.sh
```

- [ ] **Step 2: Run it and watch it fail** — today: `hyphen exit=2` with the hyphen message (already correct, keep it that way); `smoke exit=…` runs `page-diff` against a dead 404 host and reports a meaningless number instead of refusing; `grep -c gate-chrome` prints `1` (a script that does not exist); `grep -ci beachfront` prints `5` — and this file is copied verbatim into the recipe template in Task 12, so every one of those five ships to every future site.

- [ ] **Step 3: Implement** — six edits. Every line number below is against the file **as it stands now**, so apply them in the order **(e), (c), (f), (d), (a), (b)** — descending by first line — and no edit shifts another's numbers.

(a) Replace lines 31-39 (the `PD=` line, the eight-line 2026-08-10 REF comment, `REF=`, `CAND=`) with:

```bash
# Everything configurable lives in matching/harness.json; harness.mjs is the one
# reader. --env emits shell-safe assignments (REF, CAND, MATRIX, VIEWPORTS_SP,
# THRESHOLD, MAX_HEIGHT_DELTA, PD, SC, REPORT_SCHEMA).
eval "$(node "$(dirname "$0")/harness.mjs" --env)"

# The skill must be able to write reports this site's scripts can read. Cheap,
# local, and it fails before any browser starts.
PD_SCHEMA="$(node "$PD" --version 2>/dev/null | awk '{print $4}')"
if [ "$PD_SCHEMA" != "$REPORT_SCHEMA" ]; then
  echo "gate.sh: page-diff writes report schema '${PD_SCHEMA:-none}', this harness reads $REPORT_SCHEMA." >&2
  echo "         Update matching/harness.mjs REPORT_SCHEMA or the matching-a-page skill." >&2
  exit 2
fi
```

(b) Replace lines **1-29** — the whole header comment — with a generic one. What goes: the site's name (`:2`), the matrix rationale and the anchor contract (`:9-18`), the dangling `gate-chrome.sh` (`:21-22` — it has never existed in this repo), and the site's own Phase-1 examples (`:26-27`, live's root-font ladder / `.content-width` / `.hero.group-photo`). None of it is lost: Task 8 (d) writes the matrix, anchor and REF rationale into `matching/LEDGER.md`, dated. This edit is what makes the file safe to copy into a recipe template — Task 12 copies `gate.sh` verbatim, so anything left here ships to every future site.

```bash
#!/usr/bin/env bash
# The matching gate. Installed by `reddoor-maint match-harness`; this file is
# generic — everything specific to a site lives in matching/harness.json (the
# data) and matching/LEDGER.md (the why).
#
#   bash matching/gate.sh <round-tag> [page ...]
#
# Runs page-diff for every page in the table (or just the named ones) at the
# full breakpoint matrix and writes matching/out-<round-tag>-<page>/.
#
# The matrix, the anchor lists, the reference and the candidate are DATA. Why a
# site chose them — which live breakpoint band hid what, why an anchor is a
# heading and not a button label — belongs in matching/LEDGER.md, which is dated
# and append-only, because JSON holds no comments.
#
# NO MASKS and the threshold from harness.json everywhere: the numbers stay
# honest and a known floor stays visible as its own region. A media-neutralised
# secondary read is `node "$PD" ... --neutralize-media`; next.mjs ignores such
# runs on purpose.
#
# PREFLIGHT (see the matching rules in CLAUDE.md): a page with no section in
# matching/SPEC.md has not had Phase 1 done, and its geometry must not be
# touched. Skipping the spec is how a reference's root-font ladder and its
# per-component height ladders get found reactively, after the region has
# already failed several rounds. This refuses the run instead of trusting anyone
# to remember.
```

(c) Line 99: `    --viewports 1440,834,390 --threshold 0.10 \` becomes
`    --viewports "$MATRIX" --threshold "$THRESHOLD" \`.

(f) Line 91 — the refusal message names _this_ site's stylesheet, and a fresh site has no `beachfront.css`. `      echo "         matching/spec/beachfront.css) comes before geometry."` becomes:

```bash
      echo "         matching/spec/) comes before geometry."
```

(d) Insert the reference preflight after the tag `case` block and `shift` (i.e. after line 59, `WANT=("$@")`), **not** before it — a hyphenated tag must still fail with its own cheap message rather than after a network round trip:

```bash
# Fail closed on the reference before spending a single run. 200 alone is not
# evidence: www 301s to our own Netlify build and the webflow.io staging host
# 404s, and three tools spent weeks comparing the candidate with itself.
if ! node "$(dirname "$0")/harness.mjs" --check-ref; then
  echo "gate.sh: refusing to gate against an unverified reference." >&2
  exit 2
fi
```

(e) Replace lines 105-136 (the nine `run` calls and their comments) with:

```bash
# The page table is matching/harness.json. Process substitution, NOT a pipe:
# a pipe would run this loop in a subshell and FAILED_PREFLIGHT would not
# survive to the check below, so a refused page would exit 0.
while IFS=$'\t' read -r key refpath candpath anchors; do
  run "$key" "$refpath" "$candpath" "$anchors"
done < <(node "$(dirname "$0")/harness.mjs" --table)
```

- [ ] **Step 4: Run it and watch it pass**

```bash
bash matching/gate.sh x-y; echo "hyphen exit=$?"
SPEC_OPTIONAL=1 bash matching/gate.sh smoke home; echo "smoke exit=$?"
grep -c 'gate-chrome' matching/gate.sh; ls matching/out-smoke-* 2>&1 | head -1
grep -ci beachfront matching/gate.sh
```

Expect: the hyphen message and `hyphen exit=2`; then `REF REFUSED — GET https://beachfront-dentistry.webflow.io/ → HTTP 404, expected 200`, `gate.sh: refusing to gate against an unverified reference.`, `smoke exit=2`; `grep -c gate-chrome` prints `0`; `ls` prints `No such file or directory` — **no run directory was created**, which is what "refused at the preflight" means; and `grep -ci beachfront` prints `0`. That last one is the check that matters for Task 12: the five hits today are `:2` (the title), `:32`/`:38` (the REF comment and value), `:91` (the refusal message) and `:112` (the `qa` anchor "At Beachfront Dentistry", which leaves with the `run` lines). A non-zero count here means the recipe template would name this site.

- [ ] **Step 5: Commit**

```bash
git add matching/gate.sh && git commit -m "fix(gate): refuse an unverified reference, and read the table instead of holding it

gate.sh has been the only script pointed at the staging host since 2026-08-10;
as of today that host 404s on every path, so every run it produced would have
been arithmetic on a not-found page. The preflight refuses instead. Also drops
the reference to gate-chrome.sh, which has never existed in this repo.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: `census.sh` consumes the read layer

**Files:** Modify: `beachfront-dentistry/matching/census.sh:16-44` · Test: the table + header check below

- [ ] **Step 1: Write the failing test**

```bash
grep -c 'www\.beachfrontdentistry\.com' matching/census.sh
```

- [ ] **Step 2: Run it and watch it fail** — prints `1`. Line 19 is `REF="https://www.beachfrontdentistry.com"`, i.e. the style gate has been censusing our own build against itself since the 2026-08-10 cutover. (Count the hits, never `$?`: grep exits **0** when it finds something, so `echo "hits=$?"` reads `hits=0` in exactly the case that should fail.)

- [ ] **Step 3: Implement** — resolve the harness path **before** the `cd`, then replace the constants and the heredoc.

Replace lines 16-22 with:

```bash
HARNESS="$(cd "$(dirname "$0")" && pwd)/harness.mjs"
cd "$(dirname "$0")/.."

eval "$(node "$HARNESS" --env)"
NODE="${NODE:-node}"
VIEWPORTS="${VIEWPORTS:-$VIEWPORTS_SP}"
```

Replace lines 26-39 (the `pages()` heredoc) with:

```bash
# page -> "refpath candpath"; the same table gate.sh drives, from the same file.
# cut drops the anchors column, which the style census does not use.
pages() { node "$HARNESS" --table | cut -f1-3; }
```

Replace line 44 (`printf '%-10s %8s %8s %8s\n' page 1440 834 390`) with:

```bash
printf '%-10s' page
for vw in $VIEWPORTS; do printf '%8s' "$vw"; done
printf '\n'
```

- [ ] **Step 4: Run it and watch it pass** — the config comes from one place and the header follows the matrix:

```bash
grep -c 'beachfrontdentistry.com' matching/census.sh
bash -c 'set -e; eval "$(node matching/harness.mjs --env)"; echo "$REF | $VIEWPORTS_SP"'
node matching/harness.mjs --table | cut -f1-3 | wc -l
```

Expect `0`; `https://beachfront-dentistry.webflow.io | 1440 834 390`; `9`.

- [ ] **Step 5: Commit**

```bash
git add matching/census.sh && git commit -m "fix(census): the style gate was diffing our own build against itself

census.sh kept www.beachfrontdentistry.com for four weeks after that host began
301ing to our Netlify deploy, so every 'clean' type census since 2026-08-10 was
a page compared with itself. It now reads the same harness.json gate.sh does.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: `next.mjs` — derived totals, shared thresholds, schema refusal

**Files:** Modify: `beachfront-dentistry/matching/next.mjs:31-43,61-72,149-150` · Test: PAUSED honoured, then schema refusal under a fixture

- [ ] **Step 1: Write the failing test** — build a synthetic run dir (everything under `matching/out-*` is git-ignored) and prove `next.mjs` currently cannot tell a foreign schema from a native one:

The corpus has to move first. `ls -d matching/out-*` is **726** entries and `grep -l schemaVersion matching/out-*/report.json` finds **zero**, so with it in place every one of the nine keys lands in `schemaMismatch` and the fixture is invisible. Move it aside for the duration; Step 4 restores it and then measures it deliberately.

```bash
mkdir -p "$TMPDIR/out.bak" && mv matching/out-* "$TMPDIR/out.bak/"
mkdir -p matching/out-schemafix-home
node -e '
const r={meta:{schemaVersion:99,ref:"https://x.test/",generatedAt:"2026-09-08T00:00:00.000Z",threshold:0.1,mask:[]},
overallPass:false,regions:[{viewport:1440,label:"top",mismatchFraction:0.5,meanDeltaE:9,heightDeltaFraction:0,pass:false}]};
require("fs").writeFileSync("matching/out-schemafix-home/report.json",JSON.stringify(r,null,2));'
mv matching/PAUSED "$TMPDIR/PAUSED.bak"
node matching/next.mjs; echo "exit=$?"
mv "$TMPDIR/PAUSED.bak" matching/PAUSED
```

- [ ] **Step 2: Run it and watch it fail** — today `next.mjs` prints `SCORE 0/27 regions passing` and exits 1: it counted the schema-99 report, because it filters only on masks and threshold (`next.mjs:61-69`). It must exit 2 and name the page instead.

- [ ] **Step 3: Implement** — three edits.

(a) Replace lines 31-41 (the hand-typed `TOTALS` object) with nothing, and change line 43 from
`import { FLOORS, ACCEPTED } from "./floors.mjs";` to:

```js
import { FLOORS, ACCEPTED } from "./floors.mjs";
import { TOTALS, THRESHOLD, MAX_HEIGHT_DELTA, REPORT_SCHEMA } from "./harness.mjs";

// Reports written by a different page-diff, by page key. Kept rather than
// dropped: silently ignoring them is how a page vanishes from the score.
const schemaMismatch = new Set();
```

(b) In the readdir loop, replace lines 61-69 with:

```js
  const meta = report.meta ?? {};
  // Missing schemaVersion means "written before the field existed" = 0. It is
  // not an error on its own; it is only fatal when it would blank a page.
  if ((meta.schemaVersion ?? 0) !== REPORT_SCHEMA) {
    schemaMismatch.add(m[1]);
    continue;
  }
  if (
    (meta.mask?.length ?? 0) > 0 ||
    meta.neutralizeMedia ||
    meta.maskPhotos ||
    meta.truncated
  )
    continue;
  if (meta.threshold !== THRESHOLD) continue;
```

and insert immediately after the loop closes (after line 72's `}`):

```js
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
```

(c) Lines 149-150: `if (r.mm > 0.1)` becomes `if (r.mm > THRESHOLD)` and `if (Math.abs(r.dh) > 0.05)` becomes `if (Math.abs(r.dh) > MAX_HEIGHT_DELTA)`.

- [ ] **Step 4: Run it and watch it pass** — four runs: paused, schema-mismatched, schema-correct, and then the real corpus restored.

```bash
node matching/next.mjs; echo "paused exit=$?"
mv matching/PAUSED "$TMPDIR/PAUSED.bak"
node matching/next.mjs; echo "mismatch exit=$?"
node -e 'const f="matching/out-schemafix-home/report.json";const r=JSON.parse(require("fs").readFileSync(f));r.meta.schemaVersion=1;require("fs").writeFileSync(f,JSON.stringify(r,null,2));'
node matching/next.mjs > "$TMPDIR/next.out"; echo "counted exit=$?"; head -1 "$TMPDIR/next.out"
rm -rf matching/out-schemafix-home && mv "$TMPDIR/out.bak"/* matching/
node matching/next.mjs 2>&1 | head -1; echo "corpus exit=${PIPESTATUS[0]}"
mv "$TMPDIR/PAUSED.bak" matching/PAUSED
```

Expect, in order:

1. `MATCHING PAUSED — no agenda…` and `paused exit=0`.
2. `next: 1 page(s) have no run at report schema 1 — their newest reports came from a different page-diff (home).` and `mismatch exit=2`.
3. With the fixture flipped to schema 1: `counted exit=1` and a first line of `SCORE 0/27 regions passing`. **This is the artefact that proves the guard.** One field changed, and the verdict changed with it — which is why the corpus had to be out of the way: with 726 schema-0 runs present, `blanked` is the other eight pages and `next.mjs` exits 2 before printing anything.
4. With the corpus restored: `next: 9 page(s) have no run at report schema 1 …` and `corpus exit=2`. Every historical Beachfront report predates the field, so all nine blank — that is the honest state of a campaign whose reference is gone, and it is why the message names pages rather than counting reports.

- [ ] **Step 5: Commit**

```bash
git add matching/next.mjs && git commit -m "feat(next): refuse a score built on reports it cannot read

TOTALS were hand-typed per page; they are now derived from the anchor lists, so
an anchor change cannot leave a stale denominator flattering the score. A report
from another page-diff schema is counted as missing rather than skipped, and if
that would blank a page next.mjs exits 2 with the re-run command.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: `strikes.mjs` — page keys from the table, no silent unreadable runs

**Files:** Modify: `beachfront-dentistry/matching/strikes.mjs:23-25,43-46,49-63,156-157` · Test: PAUSED honoured; a corpus of unreadable reports exits 2

- [ ] **Step 1: Write the failing test**

```bash
mv matching/PAUSED "$TMPDIR/PAUSED.bak"
node matching/strikes.mjs yfv; echo "yfv exit=$?"
mv "$TMPDIR/PAUSED.bak" matching/PAUSED
node matching/strikes.mjs yfv; echo "paused exit=$?"
```

- [ ] **Step 2: Run it and watch it fail** — with PAUSED present it exits 0 (correct, keep). With PAUSED moved aside it reads the corpus but derives page names from `meta.ref`'s pathname, which disagrees with the gate key on six of nine pages, and it reports `clear` for a corpus in which zero reports could be parsed rather than refusing.

- [ ] **Step 3: Implement** — three edits.

(a) After the `FLOORS` import (line 25) add:

```js
import { PAGES, THRESHOLD, MAX_HEIGHT_DELTA, REPORT_SCHEMA } from "./harness.mjs";
```

(b) Replace `pageOf` at lines 43-46 with a lookup against the table, so the two vocabularies are one:

```js
// The gate key for a report, from its ref path. Deriving it by string surgery
// disagreed with the gate on yfv, contact, atd, svc, qa and team; the table
// knows. keyOf (below) stays as the fallback for a run whose ref was rewritten.
const pageOf = (ref) => {
  const path = new URL(ref).pathname.replace(/\/$/, "") || "/";
  return PAGES.find((p) => p.ref === path)?.key ?? null;
};
```

Then at line 79 (`const page = pageOf(run.meta.ref);`) make the fallback explicit:
`const page = pageOf(run.meta.ref) ?? keyOf(run.dir) ?? "unknown";`

(c) In the corpus loop, replace line 56 (`if (!report.meta?.ref || !Array.isArray(report.regions)) continue;`) with:

```js
  if (!report.meta?.ref || !Array.isArray(report.regions)) continue;
  // A report from another schema is still usable for a STALL count as long as
  // it carries the two fields this reads. Anything else is counted and named,
  // never silently dropped — an under-counted history reads as "clear".
  const usable = report.regions.every(
    (r) => typeof r.mismatchFraction === "number" && typeof r.pass === "boolean",
  );
  if (!usable) {
    unreadable.push(`${dir} (schema ${report.meta.schemaVersion ?? 0})`);
    continue;
  }
```

Declare `const unreadable = [];` beside `const runs = [];` (line 48), and insert after the corpus loop closes (after line 63):

```js
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
    `strikes: ignored ${unreadable.length} unreadable report(s) — the history below is incomplete.`,
  );
}
```

(d) Lines 156-157: `if (e.mm > 0.1)` becomes `if (e.mm > THRESHOLD)` and `if (Math.abs(e.dh ?? 0) > 0.05)` becomes `if (Math.abs(e.dh ?? 0) > MAX_HEIGHT_DELTA)`.

- [ ] **Step 4: Run it and watch it pass**

```bash
node matching/strikes.mjs yfv; echo "paused exit=$?"
mv matching/PAUSED "$TMPDIR/PAUSED.bak"
node matching/strikes.mjs yfv | head -5; echo "yfv exit=$?"
node matching/strikes.mjs nosuchpage; echo "unknown exit=$?"
mv "$TMPDIR/PAUSED.bak" matching/PAUSED
```

Expect `MATCHING PAUSED …` / `paused exit=0`; then a real stall listing for `yfv` (Beachfront's corpus is schema 0 but every report carries `mismatchFraction` and `pass`, so the history stays readable — that is the point of treating missing as 0 rather than refusing); and `strikes: "nosuchpage" matches no gate run — refusing to report "clear".` with `unknown exit=2`.

- [ ] **Step 5: Commit**

```bash
git add matching/strikes.mjs && git commit -m "fix(strikes): one page vocabulary, and no 'clear' from an unread corpus

pageOf derived a name from the ref URL and disagreed with the gate key on six of
nine pages; it now asks the table. A report whose regions this cannot read is
named and counted rather than skipped — the failure mode of a stall detector is
always 'clear', which is exactly the answer that stops nobody.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: `build-spec.mjs`, `summarize.mjs`, and the site prose that leaves the scripts

**Files:** Modify: `matching/build-spec.mjs:10-27,46,54-72` · `matching/summarize.mjs:12-22` · Create: `matching/spec-sections/_header.md` · Modify: `matching/LEDGER.md` (append) · Test: `SPEC.md` rebuilds byte-identical

- [ ] **Step 1: Write the failing test** — the rebuild must not change a single byte of the generated spec:

```bash
cp matching/SPEC.md "$TMPDIR/SPEC.before.md"
node matching/build-spec.mjs && diff "$TMPDIR/SPEC.before.md" matching/SPEC.md && echo "SPEC UNCHANGED"
```

- [ ] **Step 2: Run it and watch it fail** — it passes today (nothing has changed yet). Re-run it as the _check_ after Step 3; it is the test that the refactor is behaviour-preserving. Record the baseline now.

- [ ] **Step 3: Implement**

(a) `matching/spec-sections/_header.md` — the **whole** header, lifted verbatim out of `build-spec.mjs:54-70` (title line through `1440 / 834 / 390.`), with the template literal's `\`` unescaped to plain backticks.

`_header.md` owns the title too, not just the site-specific tail. Splitting it was the trap: the generated paragraphs sit _between_ the title and the citation rule, so a template that prints its own `# Reference spec` and then appends the section file reorders `SPEC.md` rather than reproducing it — and the diff in Step 4 would never go empty. Nor can the template build the title itself: `harness.json`'s shape (`ref`, `cand`, `matrix`, `threshold`, `maxHeightDelta`, `refMark`, `candMark`, `selfHosts`, `pages`) carries no site name.

```markdown
# Reference spec — beachfrontdentistry.com

GENERATED by `node matching/build-spec.mjs` from `matching/spec-sections/`.
Edit the section files, not this one.

This is the Phase 1 deliverable of the `matching-a-page` skill and the
precondition `matching/gate.sh` enforces: a page with no section here does not
get a geometry round (repo CLAUDE.md rule 2).

Every value should carry a `beachfront.css:<line>` citation or an explicit
`[probed-only]` mark. Uncited numbers are how wrong values shipped on this
project — see CLAUDE.md rule 1.

**The root-font ladder applies to every rem value on every page:** live steps
`html{font-size}` to 40px ≥993 / 32px 769–992 / 24px ≤768 while its class
rules break at 991/767/479, so each rem has THREE resolved sizes. Values below
are keyed to the gate matrix 1440 / 834 / 390.
```

(b) `build-spec.mjs`: replace lines 17-27 (the `PAGES` array) with

```js
import { PAGES, specHeadingRe } from "./harness.mjs";

// Order = live's nav order, then the detail templates. Both fall out of the
// table's own order within each group, so this is not a second list to keep.
const KEYS = [
  ...PAGES.filter((p) => p.group === "nav"),
  ...PAGES.filter((p) => p.group !== "nav"),
].map((p) => p.spec ?? p.key);
```

Replace every later `PAGES` reference with `KEYS` (line 36's `for (const page of PAGES)`, line 76's `PAGES.length` twice, line 78's `PAGES.length`). Replace line 46's inline regex with `if (!specHeadingRe(page).test(body)) {` so `build-spec` and `gate.sh` share one predicate. Replace the header template at lines 54-72 with:

```js
// The header is a spec-section like any other, so a site can say what a
// citation looks like there and what its own ladders are. DEFAULT_HEADER is
// what a site gets before it writes one: the two paragraphs that are true of
// every project, and nothing that is not.
const DEFAULT_HEADER = `# Reference spec

GENERATED by \`node matching/build-spec.mjs\` from \`matching/spec-sections/\`.
Edit the section files, not this one.

This is the Phase 1 deliverable of the \`matching-a-page\` skill and the
precondition \`matching/gate.sh\` enforces: a page with no section here does not
get a geometry round (see the matching rules in CLAUDE.md).

`;
const headerFile = join(SECTIONS, "_header.md");
const header = existsSync(headerFile)
  ? readFileSync(headerFile, "utf8").trimEnd() + "\n\n"
  : DEFAULT_HEADER;
```

`trimEnd() + "\n\n"` is what reproduces the old literal exactly: lines 54-70 end at `1440 / 834 / 390.` and line 71 is blank, so the template string ended in `\n\n`. `DEFAULT_HEADER`'s text is what Task 12 ships as `HEADER_STUB`.

(c) `summarize.mjs`: replace lines 12-22 with

```js
import { PAGES } from "./harness.mjs";
const KEYS = PAGES.map((p) => p.key);
```

and change the loop at line 36 to `for (const p of KEYS) {`.

(d) `matching/LEDGER.md`: append the rationale that used to live in `gate.sh`'s comments, so nothing is lost when the script becomes generic:

```markdown
- [record 2026-09-08] Rationale moved out of gate.sh when the page table became
  matching/harness.json (JSON holds no comments, and the script is now generic).
  **Matrix 1440/834/390:** live's real breakpoints are 480/768/992, and the
  768–991 band hid the worst structural defect of the 2026-08-04 round (the
  footer renders 2-column there on live and was 1-column here), so tablet is
  gated on every page, never sampled. **Anchors:** one per census section,
  derived from live in matching/census-live-1440.txt (git-ignored); every list
  ends with "Want to learn more" so the FOOTER is its own region — without it
  the closing-CTA region swallows the footer plus its map embed, pinning "Ready
  for great" at ~22% on all six nav pages. **contact's first anchor** is
  "OFFICE HOURS", not a button label: MarkUp pin 5980c9d7 #3 renamed the button
  to "Request Appointment" while the reference still says "Book", and an anchor
  must resolve as a text PREFIX on both pages. The ref band's adjacent
  `.footer-contact-*` divs concatenate without whitespace
  ("CONTACT(310) 378-9241…"), so a CONTACT-phone anchor dies on the missing
  space; the OFFICE-HOURS header div is a clean prefix on both. **REF:**
  www.beachfrontdentistry.com cut over to our own Netlify build after the
  2026-08-07 qafix0807 run, and as of 2026-09-08 the webflow.io staging host
  404s on every path — so there is no live reference at all. gate.sh now
  refuses rather than comparing the candidate with itself.
```

- [ ] **Step 4: Run it and watch it pass**

```bash
node matching/build-spec.mjs && diff "$TMPDIR/SPEC.before.md" matching/SPEC.md && echo "SPEC UNCHANGED"
node matching/summarize.mjs nosuchtag | head -3
```

Expect `SPEC.md built — 9/9 pages` then `SPEC UNCHANGED` — empty on the first run, because `_header.md` holds the old header's exact bytes and `trimEnd() + "\n\n"` restores its exact tail. A non-empty diff here means `_header.md` was transcribed wrong, not that the design needs adjusting. `summarize.mjs` prints `=== home      (no report)` style rows for all nine keys.

- [ ] **Step 5: Commit**

```bash
git add matching/build-spec.mjs matching/summarize.mjs matching/spec-sections/_header.md matching/LEDGER.md matching/SPEC.md
git commit -m "chore(matching): spec assembly reads the table; site prose moves to records

build-spec and gate.sh now share one heading predicate, so a section can no
longer build fine and then re-block its own page. The beachfront-specific
header prose is a spec-section; the matrix/anchor/REF rationale that lived in
gate.sh comments is a dated LEDGER entry, because harness.json cannot hold it.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: The six remaining scripts, and the sixteen dead sweeps

**Files:** Modify: `matching/probe-anchor-parity.mjs:17-113` · `matching/hover-sweep.mjs:22-34,53,114` · `matching/states.mjs:16-20,135` · `matching/states/index.mjs:112-126` · `matching/gate-published.mjs:25-38,88-98,126` · `matching/walk.mjs:13-36` · Delete: `matching/sweep*.sh` · Test: the drift grep below

These stay in Beachfront as records; none is installed by the recipe. The point of touching them is that six of them still point at a host that serves our own build, and one regex-parses `gate.sh`, which Task 4 just restructured.

- [ ] **Step 1: Write the failing test** — one command that must find nothing when the task is done:

```bash
grep -rn 'www\.beachfrontdentistry\.com\|file:///Users/tuckerlemos\|localhost:5173' \
  matching/probe-anchor-parity.mjs matching/hover-sweep.mjs matching/states.mjs \
  matching/states/index.mjs matching/gate-published.mjs matching/walk.mjs | wc -l
node matching/walk.mjs home 2>&1 | head -2
```

- [ ] **Step 2: Run it and watch it fail** — the grep counts 11+ hits, and `walk.mjs` now prints `no "run home" line in matching/gate.sh` and exits 2, because Task 4 replaced the `run` lines it was parsing.

- [ ] **Step 3: Implement** — per file. Every one drops its own `REF`/`CAND`/table/skill path.

`probe-anchor-parity.mjs`: replace lines 17-111 with

```js
import { REF, CAND, PAGES, MATRIX, PLAYWRIGHT } from "./harness.mjs";
const { chromium } = await import(PLAYWRIGHT);

// key -> [refPath, candPath, anchors]. Built from the table, so the "must
// mirror gate.sh exactly" comment this replaces stops being a promise.
const TABLE = Object.fromEntries(PAGES.map((p) => [p.key, [p.ref, p.cand, p.anchors]]));
```

then line 113 becomes `const VW = Number(process.env.VW ?? MATRIX[0]);`, and the two later `PAGES` uses (line 115 `Object.keys(PAGES)`, line 167 `PAGES[page]`) become `TABLE`.

`hover-sweep.mjs`: replace lines 22-34 with

```js
import { readFileSync, writeFileSync } from "node:fs";
import { REF, CAND, PAGES, PLAYWRIGHT } from "./harness.mjs";
const { chromium } = await import(PLAYWRIGHT);

// Nav pages only: the detail templates have no .form-modal on live, so a hover
// sweep there measures live's own broken buttons (see states/index.mjs).
const SITE = Object.fromEntries(
  PAGES.filter((p) => p.group === "nav").map((p) => [p.key, [p.ref, p.cand]]),
);
```

Line 53 becomes a loud failure rather than a throw from deep inside, because `matching/spec/` is git-ignored and absent on a fresh clone:

```js
const CSS_PATH = "matching/spec/beachfront.css";
let css;
try {
  css = readFileSync(CSS_PATH, "utf8");
} catch {
  console.error(
    `hover-sweep: ${CSS_PATH} is missing (matching/spec/ is git-ignored — re-capture the reference).`,
  );
  process.exit(2);
}
```

Line 114's `{ width: 1440, height: 900 }` becomes `{ width: MATRIX[0], height: 900 }` (add `MATRIX` to the import).

`states.mjs`: replace lines 16-20 with

```js
import { mkdirSync, writeFileSync } from "node:fs";
import { REF, CAND, MATRIX, PLAYWRIGHT } from "./harness.mjs";
const { chromium } = await import(PLAYWRIGHT);
```

and line 135 becomes `const vw = def.viewport ?? { width: MATRIX[0], height: 900 };`.

`states/index.mjs`: replace lines 112-126 (the `SITE` object) with

```js
import { PAGES } from "../harness.mjs";

/** The gated pages, ref -> cand — the same table gate.sh and census.sh drive. */
const SITE = Object.fromEntries(PAGES.map((p) => [p.key, [p.ref, p.cand]]));
```

(`CHROME_STATES` at lines 21-110 and the `SWEEP` filter at 138-140 stay: they are Webflow-class-specific site records.)

`gate-published.mjs`: replace lines 25-38 with

```js
import { CAND, MATRIX, PAGES, PLAYWRIGHT } from "./harness.mjs";
const { chromium } = await import(PLAYWRIGHT);

// Only the pages that HAVE a /dev/match twin: the four whose cand path equals
// their real route have nothing to diff.
const TWINS = PAGES.filter((p) => p.cand !== p.published);
```

Line 88-89 become

```js
const want = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const pages = want.length
  ? TWINS.filter((p) => want.includes(p.key) || want.includes(p.uid))
  : TWINS;
```

Line 94's `for (const uid of pages)` becomes `for (const p of pages)`; `${BASE}${realPath(uid)}` at 97 and 126 becomes `${CAND}${p.published}`; `${BASE}/dev/match/${uid}` at 98 becomes `${CAND}${p.cand}`; the log at 95 uses `p.key`; and `VIEWPORTS` at 96 becomes `MATRIX`.

`walk.mjs`: replace lines 13-36 with

```js
import { mkdirSync } from "node:fs";
import { byKey, REF, CAND, MATRIX, PLAYWRIGHT } from "./harness.mjs";
const { chromium } = await import(PLAYWRIGHT);

const [page, vwArg] = process.argv.slice(2);
const VW = Number(vwArg || MATRIX[0]);
if (!page) {
  console.error("usage: walk.mjs <page> [viewport]");
  process.exit(2);
}
// The table, not gate.sh's text. Regex-parsing the gate coupled this script to
// the shell layout of another file, and it broke the moment that file was
// restructured. The coupling was invisible until then.
const rec = byKey[page];
if (!rec) {
  console.error(
    `no page "${page}" in matching/harness.json (have: ${Object.keys(byKey).join(", ")})`,
  );
  process.exit(2);
}
const refPath = rec.ref;
const candPath = rec.cand;
const SECTIONS = rec.anchors;
```

Then delete the superseded sweeps:

```bash
git rm matching/sweep*.sh
```

- [ ] **Step 4: Run it and watch it pass**

```bash
grep -rn 'www\.beachfrontdentistry\.com\|file:///Users/tuckerlemos\|localhost:5173' \
  matching/probe-anchor-parity.mjs matching/hover-sweep.mjs matching/states.mjs \
  matching/states/index.mjs matching/gate-published.mjs matching/walk.mjs | wc -l
node matching/walk.mjs nosuchpage; echo "walk exit=$?"
for f in probe-anchor-parity hover-sweep states walk gate-published summarize; do node --check "matching/$f.mjs" || echo "SYNTAX FAIL $f"; done
node --check matching/states/index.mjs
ls matching/sweep*.sh 2>&1 | head -1
git ls-files matching | grep -c '^matching/sweep'
git ls-files matching/harness.json matching/harness.mjs matching/spec-sections/_header.md | wc -l
```

Expect `0`; `no page "nosuchpage" in matching/harness.json (have: team, svc, qa, home, yfv, our-team, services, atd, contact)` with `walk exit=2`; no `SYNTAX FAIL` lines; `ls` printing `No such file or directory`; then `0` (no sweep is still tracked) and `3` (the three new files are). Two positive checks rather than a total: the arithmetic is 247 − 16 + 3 = **234**, and a wrong total reads as a failed gate and sends the executor hunting a file that was never missing.

- [ ] **Step 5: Commit**

```bash
git add -A matching && git commit -m "fix(matching): the six probes stop comparing the candidate with itself

probe-anchor-parity, hover-sweep, states, walk and gate-published were all still
pointed at www.beachfrontdentistry.com, which has served OUR Netlify build since
2026-08-10 — and probe-anchor-parity still cut contact on 'Book Appointment',
seven weeks after the gate moved to 'OFFICE HOURS'. All five now read the table.
walk.mjs stops regex-parsing gate.sh. The 16 sweep*.sh are deleted: superseded
by gate.sh, all on the dead host and a two-viewport matrix.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: The dev guard on `/dev/match/[uid]`

**Files:** Modify: `beachfront-dentistry/src/routes/dev/match/[uid]/+page.server.ts:1,55` · Test: `pnpm build && pnpm preview` + `curl -i`

- [ ] **Step 1: Write the failing test** — a production build must not serve the gate surface:

```bash
pnpm build
pnpm preview --port 4173 >"$TMPDIR/preview.log" 2>&1 & PREVIEW=$!
# Readiness probe, not a timer: `sleep` is blocked in this environment, and a
# fixed wait either burns time or measures a server that is not listening yet.
curl -sf --retry 30 --retry-delay 1 --retry-connrefused -o /dev/null http://localhost:4173/health || echo "preview never came up — see $TMPDIR/preview.log"
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:4173/dev/match/home
kill "$PREVIEW"
```

Keep the PID. `(pnpm preview &)` in a subshell is not a job of the invoking shell, so `kill %1` fails with "no such job", the server survives holding port 4173, and the _next_ run of this step measures the previous build — a 200 or a 404 produced by a stale server is exactly the false positive this task exists to remove.

- [ ] **Step 2: Run it and watch it fail** — prints `200`. The route is `prerender = false` and SSR-on-demand, so today it ships with the site.

- [ ] **Step 3: Implement** — two edits to `+page.server.ts`.

Line 1 becomes:

```ts
import { error } from "@sveltejs/kit";
import { dev } from "$app/environment";
```

and the guard is the **first statement** of `load` (currently line 56 is `const asm = assemblies(devImg) …`):

```ts
export async function load({ params, fetch, cookies }) {
  // Dev aid only. This must be the first statement in load: everything below it
  // reads fixtures and hits Prismic, and none of that should be reachable from
  // a production build. `pnpm build && pnpm preview` + a 404 here is the proof;
  // the launch recipe asserts the same thing against the deployed URL.
  if (!dev) error(404, { message: "Not found" });

  const asm = assemblies(devImg) as Record<string, unknown[]>;
```

- [ ] **Step 4: Run it and watch it pass**

```bash
pnpm build
pnpm preview --port 4173 >"$TMPDIR/preview.log" 2>&1 & PREVIEW=$!
curl -sf --retry 30 --retry-delay 1 --retry-connrefused -o /dev/null http://localhost:4173/health || echo "preview never came up — see $TMPDIR/preview.log"
curl -s -o /dev/null -w 'prod=%{http_code}\n' http://localhost:4173/dev/match/home
curl -s -o /dev/null -w 'control=%{http_code}\n' http://localhost:4173/health
kill "$PREVIEW"
```

Expect `prod=404` and `control=200` — the control matters twice over: it is the readiness probe (nothing is measured before the server answers it) and it is the proof that a 404 from a broken build is not what was measured.

- [ ] **Step 5: Commit**

```bash
git add src/routes/dev/match && git commit -m "fix: the matching gate surface 404s in production

/dev/match renders fixture assemblies and queries Prismic; it shipped with every
build. \`if (!dev) error(404)\` is the first statement of load, so nothing below
it is reachable. Verified on a real build, with /health as the 200 control —
a 404 from a broken build is not evidence.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: Part 1 acceptance and PR

**Files:** none · Test: the full gate

- [ ] **Step 1: Run the repo's own gate** — Beachfront has no `verify` script (see Assumptions):

```bash
cd ~/Documents/GitHub/beachfront-dentistry
pnpm lint && pnpm check && pnpm test:unit && pnpm build
```

- [ ] **Step 2: Re-run every acceptance check in one block** — this is the C3 gate:

```bash
node matching/harness.mjs --table | diff - "$TMPDIR/gate-rows.tsv" && echo "1 TABLE IDENTICAL"
node --input-type=module -e 'import{TOTALS}from"./matching/harness.mjs";const O={home:27,yfv:24,"our-team":15,services:15,atd:15,contact:12,team:15,svc:15,qa:15};process.exit(Object.keys(O).every(k=>TOTALS[k]===O[k])&&Object.keys(TOTALS).length===9?0:1)' && echo "2 TOTALS MATCH"
bash matching/gate.sh x-y 2>&1 | tail -1; echo "3 hyphen exit=${PIPESTATUS[0]}"
SPEC_OPTIONAL=1 bash matching/gate.sh smoke home 2>&1 | tail -2; echo "4 preflight exit=$?"
node matching/next.mjs | head -1; echo "5 paused exit=$?"
grep -c 'gate-chrome' matching/gate.sh; ls matching/sweep*.sh 2>&1 | head -1
git check-ignore -v matching/harness.json || echo "6 TABLE TRACKED"
```

Expected artefacts: `1 TABLE IDENTICAL`; `2 TOTALS MATCH`; the hyphen refusal with exit 2; `REF REFUSED — GET https://beachfront-dentistry.webflow.io/ → HTTP 404, expected 200` + `gate.sh: refusing to gate against an unverified reference.` with exit 2 and **no** `matching/out-smoke-home/` created; `MATCHING PAUSED — no agenda, and none is to be inferred.` with exit 0; `0`; `No such file or directory`; `6 TABLE TRACKED`.

- [ ] **Step 3: Push and open the PR**

```bash
git push -u origin chore/matching-harness-consolidation
gh pr create --repo reddoorla/beachfront-dentistry --base main --head chore/matching-harness-consolidation \
  --title "matching: one page table, one read layer, a preflight that refuses a dead reference" \
  --body "$(cat <<'EOF'
The page table, the two hosts, the matrix, the threshold and the skill path were
hand-copied into nine scripts. They had drifted: only `gate.sh` was ever
repointed at the staging host, so `census.sh`, `hover-sweep`, `states`,
`probe-anchor-parity`, `walk` and every `sweep*.sh` were gating against
`www.beachfrontdentistry.com` — which has served OUR Netlify build since
2026-08-10. `probe-anchor-parity` was also still cutting `contact` on "Book
Appointment", seven weeks after the gate moved to "OFFICE HOURS".

`matching/harness.json` is now the data and `matching/harness.mjs` the only
reader. TOTALS are derived from the anchor lists rather than hand-typed. Both
gates get a fail-closed reference preflight (200, no redirect, reference
fingerprint present, candidate fingerprint absent) and a report-schema check.

The reference is dead in both directions as of 2026-09-08 — webflow.io 404s on
every path — so the proof here is mechanical: `--table` prints the nine deleted
`run` lines byte-identically, the derived totals equal the old map, a hyphenated
tag still refuses, and `gate.sh smoke home` exits 2 **at the preflight** without
creating a run directory. Also: the 16 superseded `sweep*.sh` are gone, the
dangling `gate-chrome.sh` reference is gone, and `/dev/match/[uid]` now 404s on
a production build.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 4: Verify the PR** — `gh pr checks --watch` green, and `gh pr view --json files -q '.files[].path' | wc -l` shows only `matching/*`, `src/routes/dev/match/[uid]/+page.server.ts` (the fleet rule: check the real changed-file list before merging).

- [ ] **Step 5: Merge (GREEN tier)** — `gh pr merge --squash --delete-branch` once CI is green and the review is clean.

---

### Task 12: Generate `template.ts` from the consolidated files

**Files:** Create: `reddoor-maintenance/scripts/gen-match-harness-template.mjs` · Create (generated): `src/recipes/match-harness/template.ts` · Test: the round-trip assertion inside the generator

Work in a worktree from here on: `git -C ~/Documents/GitHub/reddoor-maintenance worktree add ../rm-match-harness -b feat/match-harness-recipe main`.

- [ ] **Step 1: Write the failing test** — the generator's own round-trip check is the test. Add it first and run the generator against a source that does not exist yet:

```bash
cd ~/Documents/GitHub/rm-match-harness && node scripts/gen-match-harness-template.mjs; echo "exit=$?"
```

- [ ] **Step 2: Run it and watch it fail** — `Cannot find module '.../scripts/gen-match-harness-template.mjs'`.

- [ ] **Step 3: Implement** — the generator. It copies six files verbatim from the Task 2–9 branch and authors the eleven generic stubs inline.

```js
#!/usr/bin/env node
// Regenerates src/recipes/match-harness/template.ts.
//
//   node scripts/gen-match-harness-template.mjs [source-repo]
//
// Six files are copied VERBATIM from a site that has the consolidated harness
// (default: beachfront-dentistry, the PR this recipe was cut from). The rest are
// authored here because they are stubs, not code with a source of truth.
//
// Do NOT hand-edit template.ts: escaping backticks and ${ by hand is exactly the
// kind of silent corruption a round-trip check exists to catch, and it is checked
// below for every constant before anything is written.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = process.argv[2] ?? join(homedir(), "Documents/GitHub/beachfront-dentistry");
const OUT = join(HERE, "../src/recipes/match-harness/template.ts");

/** Verbatim from the source repo: these have a single source of truth. */
const COPIED = [
  ["HARNESS_MJS", "matching/harness.mjs"],
  ["GATE_SH", "matching/gate.sh"],
  ["CENSUS_SH", "matching/census.sh"],
  ["NEXT_MJS", "matching/next.mjs"],
  ["STRIKES_MJS", "matching/strikes.mjs"],
  ["BUILD_SPEC_MJS", "matching/build-spec.mjs"],
  ["CENSUS_COUNT_MJS", "matching/census-count.mjs"],
];

/** Authored here: stubs and site scaffolds with no upstream. */
const AUTHORED = [
  ["HARNESS_JSON", "matching/harness.json", HARNESS_JSON_SEED],
  ["FLOORS_MJS", "matching/floors.mjs", FLOORS_STUB],
  ["CENSUS_DEVIATIONS_MJS", "matching/census-deviations.mjs", CENSUS_DEVIATIONS_STUB],
  ["SPEC_CHROME_MD", "matching/spec-sections/_chrome.md", CHROME_STUB],
  ["SPEC_HEADER_MD", "matching/spec-sections/_header.md", HEADER_STUB],
  ["LEDGER_MD", "matching/LEDGER.md", LEDGER_STUB],
  ["MATCH_ROUTE_SERVER", "src/routes/dev/match/[uid]/+page.server.ts", ROUTE_SERVER],
  ["MATCH_ROUTE_PAGE", "src/routes/dev/match/[uid]/+page.svelte", ROUTE_PAGE],
  ["SITE_PAGES_JS", "src/lib/site-pages.js", SITE_PAGES],
  ["SITE_PAGES_TEST", "src/lib/site-pages.test.ts", SITE_PAGES_TEST],
];

/** Escape a file body for embedding in a TS template literal, then prove the
 *  escape round-trips. A corrupted template is silent: it installs and only
 *  fails when someone runs the script months later. */
function embed(name, body) {
  const esc = body.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
  const back = new Function(`return \`${esc}\`;`)();
  if (back !== body)
    throw new Error(`round-trip FAILED for ${name} — refusing to write template.ts`);
  return esc;
}

const parts = [
  `// GENERATED by scripts/gen-match-harness-template.mjs. Do NOT hand-edit the`,
  `// string bodies — regenerate. Six constants are byte-copies of a site with the`,
  `// consolidated harness; the rest are stubs authored in the generator.`,
  ``,
  `export type OwnedBy = "recipe" | "site";`,
  `export type HarnessFile = { rel: string; template: string; owner: OwnedBy };`,
  ``,
];
const files = [];
for (const [name, rel] of COPIED) {
  const body = readFileSync(join(SRC, rel), "utf8");
  parts.push(`export const ${name}_RELATIVE = ${JSON.stringify(rel)};`);
  parts.push(`export const ${name}_TEMPLATE = \`${embed(name, body)}\`;`, ``);
  files.push([name, "recipe"]);
}
for (const [name, rel, body] of AUTHORED) {
  parts.push(`export const ${name}_RELATIVE = ${JSON.stringify(rel)};`);
  parts.push(`export const ${name}_TEMPLATE = \`${embed(name, body)}\`;`, ``);
  // harness.json, floors, census-deviations, the spec sections, LEDGER and
  // site-pages.js are records a site edits; the rest are recipe-owned.
  const siteOwned = /HARNESS_JSON|FLOORS|CENSUS_DEVIATIONS|SPEC_|LEDGER|SITE_PAGES_JS/.test(name);
  files.push([name, siteOwned ? "site" : "recipe"]);
}
parts.push(
  `export const MATCH_HARNESS_FILES: readonly HarnessFile[] = [`,
  ...files.map(
    ([n, o]) => `  { rel: ${n}_RELATIVE, template: ${n}_TEMPLATE, owner: ${JSON.stringify(o)} },`,
  ),
  `];`,
  ``,
  `/** Renders previously shipped by this recipe, per relative path. A file that`,
  ` *  byte-matches one of these is SAFE-REPLACED on re-run; anything else that`,
  ` *  differs is flagged, never overwritten. Empty at v1 — nothing has shipped. */`,
  `export const MATCH_HARNESS_PREVIOUS: Readonly<Record<string, readonly string[]>> = {};`,
  ``,
  `export const GITIGNORE_MARKER =`,
  `  "# reddoor-maint match-harness: scripts + records tracked, workspace ignored";`,
  `export const GITIGNORE_BLOCK = \`${embed("GITIGNORE_BLOCK", GITIGNORE_BLOCK)}\`;`,
  ``,
  `export const PRETTIERIGNORE_MARKER = "# reddoor-maint match-harness";`,
  `export const PRETTIERIGNORE_BLOCK = \`${embed("PRETTIERIGNORE_BLOCK", PRETTIERIGNORE_BLOCK)}\`;`,
  ``,
  `export const CLAUDE_MD_MARKER = "## Matching rules (installed by reddoor-maint match-harness)";`,
  `export const CLAUDE_MD_BLOCK = \`${embed("CLAUDE_MD_BLOCK", CLAUDE_MD_BLOCK)}\`;`,
  ``,
);
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, parts.join("\n"), "utf8");
console.log(`wrote ${OUT} — ${files.length} files, all round-trip verified`);
```

The stub bodies are `const` declarations above the arrays (hoisting: declare them before use — put them directly after the imports). Every one of them is a generator **input**, so all of them are written here; nothing in this task forward-references a later one. Their contents:

- `HARNESS_JSON_SEED` — the same shape as Task 2 with one page and empty fingerprints, and `"__REF__"` where the recipe substitutes `--ref`:
  `{"ref":"__REF__","cand":"http://localhost:5173","matrix":[1440,834,390],"threshold":0.1,"maxHeightDelta":0.05,"refMark":"","candMark":"_app/immutable","selfHosts":[],"pages":{"home":{"uid":"home","ref":"/","cand":"/dev/match/home","published":"/","anchors":[],"spec":"home","group":"nav"}}}` — pretty-printed with two spaces and a trailing newline (`JSON.stringify(seed, null, 2) + "\n"`). The recipe does **not** string-replace into this: `JSON.stringify(…, null, 2)` explodes `matrix` onto four lines, so the literal `[1440, 834, 390]` never occurs in the rendered file and a `.replace()` on it would be a silent no-op. Task 13 parses, sets the three fields, and re-serialises.
- `FLOORS_STUB` — `export const FLOORS = [];` and `export const ACCEPTED = [];` under the matcher-signature comment copied from `beachfront/matching/floors.mjs:1-5` and `:38-43` (region records carry `label` and `viewport` but not the page, so every matcher takes `(r, page)`).
- `CENSUS_DEVIATIONS_STUB` — `export const DECLARED = [];` under the contract comment from `beachfront/matching/census-deviations.mjs:1-9,16-17`.
- `CHROME_STUB` — `## shared chrome` plus one paragraph saying Phase 1 fills it.
- `HEADER_STUB` — the `DEFAULT_HEADER` text written in Task 8 (b), verbatim: `# Reference spec`, the GENERATED notice, the Phase-1 paragraph, and a trailing blank line. Nothing site-specific — the site replaces the file wholesale in Phase 1, and `build-spec.mjs` falls back to the same text if it is missing.
- `LEDGER_STUB` — `# Deviations / masks / floors ledger` plus the append-only rule.
- `GITIGNORE_BLOCK` — Beachfront's `.gitignore:36-53` verbatim, plus `!matching/harness.json` **after** `matching/*.json` so the negation wins.
- `PRETTIERIGNORE_BLOCK` — the three narrowed entries from Task 2 (c), with their comment: `matching/*.mjs`, `matching/*.sh`, `matching/harness.json`. Not `matching/`: eslint already ignores the directory, so a blanket entry would leave `SPEC.md`, `LEDGER.md` and `spec-sections/` with no style check at all.

The four site files and the CLAUDE.md block have no upstream to copy, so they are written out in full here.

`ROUTE_SERVER` (`src/routes/dev/match/[uid]/+page.server.ts`):

```ts
import { error } from "@sveltejs/kit";
import { dev } from "$app/environment";
import { documents } from "$lib/site-pages.js";

// Local matching surface: renders the EXACT assembly `reddoor-maint
// prismic-seed` publishes, from the same module, so a fix made to pass a gate
// is a fix to what ships. Not prerendered, SSR-on-demand, dev-only.
export const prerender = false;

// The seed resolves images to asset ids; here they only need a URL. Dimensions
// are nominal — slices size their own image boxes in CSS.
const devImg = (u: string) => ({
  url: u,
  alt: null,
  copyright: null,
  dimensions: { width: 1600, height: 1067 },
  edit: { x: 0, y: 0, zoom: 1, background: "transparent" },
  id: u,
});

export async function load({ params }) {
  // FIRST statement: everything below reads fixtures that must not be reachable
  // from a production build. The launch recipe asserts this route 404s on the
  // deployed URL, with /health as the 200 control — never a dev route, which
  // the dev-layout guard this comment exists to encourage would delete.
  if (!dev) error(404, { message: "Not found" });

  const docs = documents(devImg) as Array<{ uid: string; data: { slices?: unknown[] } }>;
  const doc = docs.find((d) => d.uid === params.uid);
  // LOAD-BEARING PHRASE, and not only here. `launch`'s dev-guard denies on
  // /no (matching )?assembly for/i (`src/recipes/launch.ts` UNGUARDED_TWIN_MARKER)
  // against the DEPLOYED twin's body, because an unguarded twin asked for a uid
  // it does not have returns a 404 rendered through the site's own +error.svelte
  // — which is byte-for-byte the gate's PASS condition. This message is the only
  // thing separating "the guard fired" from "this site has no such uid", so
  // rewording it ("no document for", "unknown uid", dropping the phrase, or
  // moving the 404 to an +error boundary that discards error.message) makes the
  // gate FAIL OPEN and launch a site whose fixtures are public. The regex accepts
  // two wordings today only because Beachfront's existing twin says "no matching
  // assembly for" and this template says "no assembly for"; a THIRD wording is
  // the failure case, not a fourth. Change this string and UNGUARDED_TWIN_MARKER
  // in the same PR, or replace both with a machine-readable tell (issue #719).
  if (!doc)
    error(404, {
      message: `no assembly for "${params.uid}" (have: ${docs.map((d) => d.uid).join(", ") || "none"})`,
    });

  return { uid: params.uid, slices: doc.data.slices ?? [] };
}
```

`ROUTE_PAGE` (`src/routes/dev/match/[uid]/+page.svelte`) — no context object; lists are content relationships resolved in the page query (D3), so the gate surface needs nothing extra:

```svelte
<script lang="ts">
  import { SliceZone } from "@prismicio/svelte";
  import { components } from "$lib/slices";

  let { data } = $props();
</script>

<SliceZone slices={data.slices as never} {components} />
```

`SITE_PAGES` (`src/lib/site-pages.js`):

```js
// The page assemblies for this site — the SINGLE source of truth for both
// consumers: `reddoor-maint prismic-seed`, which publishes them through the
// Migration API, and src/routes/dev/match/[uid], the local matching surface.
// Because both read from here, any fix made to pass a gate is a fix to what
// ships.
//
// THE MIGRATION API DROPS SILENTLY. It validates against the slice models
// registered in Prismic and discards every field the model does not declare —
// HTTP 200, no warning. A fixture field with no model behind it renders here and
// vanishes on the published route. src/lib/site-pages.test.ts is the mechanical
// check; run it before every seed.
//
// PURE by contract: no node:*, no fetch, no token, no side effects at import,
// so Vite can bundle it into the dev route and node can import it into the seed.

export const lang = "en-us";

/**
 * @param {(url: string) => unknown} img resolves an image URL to whatever the
 *   caller needs — an asset `{id}` for the seed, a `{url}` for the dev route.
 * @returns {Array<{type: string, uid: string, title: string, data: Record<string, unknown>}>}
 */
export function documents(img) {
  void img;
  return [];
}
```

`SITE_PAGES_TEST` (`src/lib/site-pages.test.ts`) — the generic form of Beachfront's `beachfront-pages.test.ts:1-106`, reading `documents(stubImg)` and each doc's `data.slices` instead of an `assemblies` map, and dropping that file's four site-specific cases below line 106. On a fresh install `documents()` returns `[]` and all three assertions pass vacuously; that is intended — the gate arms itself as the site fills the module in.

```ts
// The page assemblies in src/lib/site-pages.js are the SINGLE source of truth
// shared by two consumers: the local matching route (src/routes/dev/match/[uid])
// and `reddoor-maint prismic-seed`, which publishes them to Prismic.
//
// Those two consumers do NOT validate the same way. The dev route hands the
// object straight to the slice components, so any field a fixture sets is
// simply there. The Migration API validates against the slice models registered
// in Prismic and SILENTLY DROPS every field the model does not declare — no
// error, no warning, a 200. A page can gate green locally and publish wrong.
//
// This test is the mechanical check. It fails the moment a fixture carries a
// field its slice model does not declare — before the seed runs, not after the
// content is published. Run it before every seed.
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { documents } from "./site-pages.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const SLICES = join(HERE, "slices");

type Variation = { primary: string[]; items: string[] };
type Slice = {
  slice_type: string;
  variation: string;
  primary?: Record<string, unknown>;
  items?: Array<Record<string, unknown>>;
};

/** Every slice model in src/lib/slices, indexed by its Prismic slice id. */
function loadModels(): Record<string, Record<string, Variation>> {
  const out: Record<string, Record<string, Variation>> = {};
  if (!existsSync(SLICES)) return out;
  for (const dir of readdirSync(SLICES)) {
    const file = join(SLICES, dir, "model.json");
    if (!existsSync(file)) continue;
    const model = JSON.parse(readFileSync(file, "utf8"));
    out[model.id] = Object.fromEntries(
      (model.variations ?? []).map((v: Record<string, unknown>) => [
        v.id,
        {
          primary: Object.keys((v.primary as object) ?? {}),
          items: Object.keys((v.items as object) ?? {}),
        },
      ]),
    );
  }
  return out;
}

/** Image resolver stub — shape only; this test never reads image values. */
const stubImg = () => ({ url: "https://example.test/x.jpg" });

describe("site-pages documents vs slice models", () => {
  const models = loadModels();
  const docs = documents(stubImg) as Array<{ uid: string; data: { slices?: Slice[] } }>;
  const pages: Array<[string, Slice[]]> = docs.map((d) => [d.uid, d.data.slices ?? []]);

  it("declares every slice type the documents use", () => {
    const missing = new Set<string>();
    for (const [, slices] of pages)
      for (const s of slices) if (!models[s.slice_type]) missing.add(s.slice_type);
    expect([...missing]).toEqual([]);
  });

  it("declares every variation the documents use", () => {
    const missing: string[] = [];
    for (const [uid, slices] of pages)
      for (const s of slices) {
        const model = models[s.slice_type];
        if (model && !model[s.variation]) missing.push(`${uid}: ${s.slice_type}/${s.variation}`);
      }
    expect(missing).toEqual([]);
  });

  // The one that catches a silent Migration-API drop.
  it("declares every field the documents set, so Prismic strips nothing", () => {
    const stripped: string[] = [];
    for (const [uid, slices] of pages)
      for (const s of slices) {
        const variation = models[s.slice_type]?.[s.variation];
        if (!variation) continue;
        for (const key of Object.keys(s.primary ?? {}))
          if (!variation.primary.includes(key))
            stripped.push(`${uid} ${s.slice_type}/${s.variation} primary.${key}`);
        const itemKeys = new Set((s.items ?? []).flatMap((i) => Object.keys(i)));
        for (const key of itemKeys)
          if (!variation.items.includes(key))
            stripped.push(`${uid} ${s.slice_type}/${s.variation} items.${key}`);
      }
    expect(stripped).toEqual([]);
  });
});
```

`CLAUDE_MD_BLOCK` — Beachfront's `CLAUDE.md:16-83` (the five rules) and `:167-176` (the round protocol), de-Beachfronted: no `beachfront.css`, no page keys, and the paused state becomes a described mechanism rather than a live status. `mergeBlock` emits `marker + "\n" + block`, so the block starts with a blank line and does **not** repeat the `## Matching rules …` heading.

```markdown
The `matching-a-page` skill governs a live-reference rebuild. These five rules
exist because the skill alone did not hold on the project this harness came
from — each one is a drift that actually happened, with the mechanical check
that now catches it. `matching/harness.json` is this site's configuration;
`matching/LEDGER.md` is the dated record of every deviation, floor and mask.

### 1. Source prescribes, rects only verify

Every geometry fix must cite the rule it came from: a line in the captured
reference stylesheet under `matching/spec/`, or the reference's HTML. "The probe
says the gap is 40px" is not a source. If you cannot name the line you are
guessing — go read the stylesheet first.

**Check:** the commit body must name the file:line for each fix.
**Operator's challenge:** _"which line of the reference stylesheet says that?"_

### 2. Phase 1 before Phase 4

A page gets its section census and per-section spec in `matching/SPEC.md` BEFORE
its geometry is touched. No SPEC section, no geometry round. The census is the
coverage denominator; skipping it is how a reference's root-font ladder and its
per-component height ladders get discovered reactively, after the region has
already failed several rounds.

**Check:** `matching/gate.sh` refuses to run a page with no `SPEC.md` section.
**Operator's challenge:** _"show me the SPEC section for that region."_

### 3. Three strikes, then stop

A failing region that has not improved across 3+ gate runs does not get a fourth
attempt. Present the attempts. Never widen the threshold, add a mask, or
reclassify it as a floor to make it go away.

**Check:** `node matching/strikes.mjs <page>` — exits 1 while any region is
stalled, and is the first thing a geometry round runs.
**Operator's challenge:** _"how many runs has that region been flat?"_

### 4. A gate closes an item, nothing else

No fix is "done" because the code changed. Paste the gate header — it is
self-describing, so a nonstandard threshold or an undisclosed mask is visible.
The threshold and the matrix are whatever `matching/harness.json` says, on every
page, never a subset.

**Operator's challenge:** _"paste the gate header."_

### 5. A commit is a checkpoint, not a stopping point

Do not hand control back between rounds. After committing, run
`node matching/next.mjs`: while it exits 1 there is a named next action, and the
round continues. Report when the backlog is empty, when a decision is genuinely
the operator's (three strikes, a novel floor, a threshold change), or when
asked — not because a commit felt like a natural place to summarise.

This exists because the failure was habitual, not deliberate: a turn ends when
user-facing prose gets written, and "I just committed something good" is the
moment that invites writing it. The gate stops incorrect work; this stops
premature stopping.

**Pausing:** create `matching/PAUSED` holding a note that says what the pause
means; `next.mjs` and `strikes.mjs` then exit 0 while it exists. This rule says
"do not stop while work is named"; it never said "find work to name". An empty
agenda and a paused one end the round the same way. Deleting the switch is the
operator's call.

**Check:** `node matching/next.mjs` — exits 1 while any non-floor region fails.
**Operator's challenge:** _"what does next.mjs say?"_

### Round protocol

1. `node matching/strikes.mjs <page>` — if it exits 1, the stalled regions are
   the agenda, and stalled ones get escalated rather than re-attempted.
2. Confirm the page has a `matching/SPEC.md` section; write
   `matching/spec-sections/<page>.md` and run `node matching/build-spec.mjs` if
   not.
3. Fix, each change citing its source line.
4. `bash matching/gate.sh <tag> <page>` — paste the header.
5. Append to `matching/LEDGER.md` at the moment a deviation, floor or mask is
   decided, not reconstructed at the end.
6. `pnpm verify`, then commit and push.
```

- [ ] **Step 4: Run it and watch it pass**

```bash
node scripts/gen-match-harness-template.mjs ~/Documents/GitHub/beachfront-dentistry
node -e 'const t=require("fs").readFileSync("src/recipes/match-harness/template.ts","utf8");console.log("bytes",t.length)'
pnpm exec tsc --noEmit -p tsconfig.json 2>&1 | head -5
grep -ci beachfront src/recipes/match-harness/template.ts
```

Expect `wrote …/template.ts — 17 files, all round-trip verified`, a byte count, no type errors from the generated file, and `0` from the grep. **That last number is the one that keeps the template generic**: `gate.sh`, `census.sh` and `build-spec.mjs` are copied verbatim, so any site prose left in them by Tasks 4, 5 and 8 ships to every future site. A non-zero count means go back to Task 4 (b)/(f), Task 5 or Task 8 (a) before writing the recipe.

Then break it on purpose once: temporarily add a stray backtick to `HEADER_STUB` and confirm the generator throws `round-trip FAILED for SPEC_HEADER_MD — refusing to write template.ts` before restoring it.

- [ ] **Step 5: Commit**

```bash
git add scripts/gen-match-harness-template.mjs src/recipes/match-harness/template.ts
git commit -m "feat(match-harness): generate the templates, with a round-trip check

smoke-suite's templates were 'GENERATED verbatim ... regenerate with
scratchpad/gen-smoke-template.mjs' and that script is not in the repo, so its
strings are hand-maintained now. This generator is checked in, and it refuses to
write a constant whose escaping does not round-trip — a corrupted template
installs silently and only fails months later when someone runs the script.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 13: The `match-harness` recipe

**Files:** Create: `reddoor-maintenance/src/recipes/match-harness/index.ts` · Test: `tests/recipes/match-harness.test.ts` (Task 15)

- [ ] **Step 1: Write the failing test** — the first test of the suite, red before the recipe exists:

```ts
import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve, dirname, join } from "node:path";
import { matchHarness } from "../../src/recipes/match-harness/index.js";
import { MATCH_HARNESS_FILES } from "../../src/recipes/match-harness/template.js";
import type { SpawnFn } from "../../src/audits/util/spawn.js";
import { copyFixtureToTmp } from "./_helpers/site-tmpdir.js";

const here = dirname(fileURLToPath(import.meta.url));
const pristine = resolve(here, "../fixtures/pristine-starter");
const noopSpawn: SpawnFn = async () => ({ code: 0, stdout: "", stderr: "" });

describe("recipes/match-harness", () => {
  it("installs every template file on a clean site, in one commit", async () => {
    const cwd = await copyFixtureToTmp(pristine);
    const result = await matchHarness(
      { path: cwd },
      { ref: "https://ref.test" },
      { spawn: noopSpawn },
    );
    expect(result.status).toBe("applied");
    expect(result.commits).toHaveLength(1);
    expect(result.notes).toMatch(/branch: maint\/match-harness-/);
    for (const f of MATCH_HARNESS_FILES) {
      if (f.rel === "matching/harness.json") continue; // rendered from --ref
      expect(await readFile(join(cwd, f.rel), "utf-8")).toBe(f.template);
    }
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
pnpm exec vitest run tests/recipes/match-harness.test.ts --no-coverage
```

Expect `Failed to resolve import "../../src/recipes/match-harness/index.js"`.

- [ ] **Step 3: Implement** — `src/recipes/match-harness/index.ts`:

```ts
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { RecipeResult, Site } from "../../types.js";
import { withRecipe } from "../_with-recipe.js";
import { defaultSpawn, type SpawnFn } from "../../audits/util/spawn.js";
import { formatWithPrettier, PRETTIER_FLAG_NOTE } from "../_prettier.js";
import {
  MATCH_HARNESS_FILES,
  MATCH_HARNESS_PREVIOUS,
  HARNESS_JSON_RELATIVE,
  GITIGNORE_MARKER,
  GITIGNORE_BLOCK,
  PRETTIERIGNORE_MARKER,
  PRETTIERIGNORE_BLOCK,
  CLAUDE_MD_MARKER,
  CLAUDE_MD_BLOCK,
} from "./template.js";

export type MatchHarnessOptions = {
  /** The live reference URL the harness gates against. Required — a harness
   *  with no reference cannot produce evidence, only an absence of errors. */
  ref: string;
  /** Candidate origin. Defaults to the SvelteKit dev server. */
  cand?: string;
  /** Breakpoint matrix. Defaults to the fleet's 1440 / 834 / 390. */
  matrix?: number[];
};

export type MatchHarnessDeps = {
  spawn: SpawnFn;
  /** Previously shipped renders per relative path; injectable so the
   *  safe-replace path is testable before a second version exists. */
  previous?: Readonly<Record<string, readonly string[]>>;
};

type Plan = { ref: string; cand: string; matrix: number[] };

async function readIfExists(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf-8");
  } catch {
    return null;
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/** CRLF and trailing whitespace are the only differences a site's formatter is
 *  allowed to introduce before a file stops counting as "ours". */
function normalize(s: string): string {
  return s
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+$/gm, "")
    .trim();
}

/**
 * Append `block` under `marker` unless the marker is already present. The only
 * append-to-existing-file idiom in this repo is mergeGitignore, and it cannot
 * express a negated whitelist (`matching/*` then `!matching/*.sh`) as one unit:
 * it compares entries by normalized presence, so the ordering that makes the
 * block work would be lost. This keeps the block whole and idempotent.
 */
export function mergeBlock(existing: string | null, marker: string, block: string): string | null {
  if (existing === null) return `${marker}\n${block}`;
  if (existing.includes(marker)) return null;
  const base = existing.endsWith("\n") ? existing : `${existing}\n`;
  return `${base}\n${marker}\n${block}`;
}

/** What to do with one installed file. `flag` never writes. */
export function planFileWrite(
  existing: string | null,
  template: string,
  owner: "recipe" | "site",
  previous: readonly string[],
): "write" | "replace" | "skip" | "flag" {
  if (existing === null) return "write";
  if (normalize(existing) === normalize(template)) return "skip";
  if (owner === "site") return "skip"; // records are never touched again
  if (previous.some((p) => normalize(existing) === normalize(p))) return "replace";
  return "flag";
}

/**
 * Installs the matching harness into a site: the dev-guarded `/dev/match/[uid]`
 * route, a `site-pages.js` scaffold and its fixture-vs-model test,
 * `matching/harness.json` + the read layer, the round scripts, the site records,
 * and the `.gitignore` / `.prettierignore` / `CLAUDE.md` blocks.
 *
 * Install-if-absent throughout. Files a site edits are never rewritten. A
 * recipe-owned script that matches a previously shipped render is safe-replaced;
 * one that has been hand-edited is FLAGGED in the notes and left alone.
 */
export async function matchHarness(
  site: Site,
  opts: MatchHarnessOptions,
  deps: MatchHarnessDeps = { spawn: defaultSpawn },
): Promise<RecipeResult> {
  return withRecipe<Plan>({
    name: "match-harness",
    site,
    plan: async () => {
      if (!opts.ref || !/^https?:\/\//.test(opts.ref)) {
        return {
          kind: "failed",
          notes:
            "--ref <url> is required: the harness gates against a live reference, and a harness with no reference can only ever report an absence of errors",
        };
      }
      return {
        kind: "apply",
        plan: {
          ref: opts.ref.replace(/\/$/, ""),
          cand: opts.cand ?? "http://localhost:5173",
          matrix: opts.matrix ?? [1440, 834, 390],
        },
      };
    },
    apply: async (planned, { commit, cwd }) => {
      const notes: string[] = [];
      const written: string[] = [];
      const previousAll = deps.previous ?? MATCH_HARNESS_PREVIOUS;

      for (const f of MATCH_HARNESS_FILES) {
        const target = join(cwd, f.rel);
        let template = f.template;
        if (f.rel === HARNESS_JSON_RELATIVE) {
          // Patch the PARSED object, never the text. The seed is pretty-printed
          // two-space JSON, so `matrix` renders as a four-line exploded array
          // and the literal "[1440, 834, 390]" does not occur — a string
          // replace on it is a no-op that drops --matrix with no error.
          const seed = JSON.parse(template) as Record<string, unknown>;
          seed.ref = planned.ref;
          seed.cand = planned.cand;
          seed.matrix = planned.matrix;
          template = JSON.stringify(seed, null, 2) + "\n";
        }
        const existing = await readIfExists(target);
        const action = planFileWrite(existing, template, f.owner, previousAll[f.rel] ?? []);
        if (action === "flag") {
          notes.push(
            `${f.rel} differs from the shipped template and was left alone (hand-edited?)`,
          );
          continue;
        }
        if (action === "skip") continue;
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, template, "utf-8");
        written.push(f.rel);
        if (action === "replace") notes.push(`${f.rel} upgraded from a previous version`);
      }

      // Three appended blocks, each idempotent on its own marker.
      for (const [rel, marker, block] of [
        [".gitignore", GITIGNORE_MARKER, GITIGNORE_BLOCK],
        [".prettierignore", PRETTIERIGNORE_MARKER, PRETTIERIGNORE_BLOCK],
        ["CLAUDE.md", CLAUDE_MD_MARKER, CLAUDE_MD_BLOCK],
      ] as const) {
        const path = join(cwd, rel);
        const merged = mergeBlock(await readIfExists(path), marker, block);
        if (merged !== null) {
          await writeFile(path, merged, "utf-8");
          written.push(rel);
        }
      }

      // Format only what the SITE owns. The harness CODE ships template-verbatim
      // and is in .prettierignore: a site whose printWidth differs would
      // otherwise reformat every recipe-owned script on install, and the
      // byte-compare that makes the next upgrade possible would flag all of them
      // as hand-edited. The Markdown stubs are NOT formatted here either, so
      // they must be authored prettier-clean — they stay in `prettier --check .`
      // (Task 15 case 13 is that check).
      const toFormat = written.filter((p) => p.startsWith("src/") || p === "CLAUDE.md");
      if (toFormat.length > 0 && !(await formatWithPrettier(deps.spawn, cwd, toFormat))) {
        notes.push(PRETTIER_FLAG_NOTE);
      }

      await commit(
        "feat: install the matching harness (/dev/match route + matching/ gate scripts)",
      );
      return notes.length > 0 ? { kind: "ok", notes: notes.join("; ") } : { kind: "ok" };
    },
  });
}
```

`ROUTE_SERVER`, `ROUTE_PAGE`, `SITE_PAGES` and `SITE_PAGES_TEST` are **generator inputs**, so their bodies are written in full in Task 12 Step 3 and are already inside `template.ts` by the time this task runs. Nothing here needs them again; this task is only `index.ts`.

- [ ] **Step 4: Run it and watch it pass**

```bash
pnpm exec vitest run tests/recipes/match-harness.test.ts --no-coverage
```

Expect `1 passed`.

- [ ] **Step 5: Commit**

```bash
git add src/recipes/match-harness tests/recipes/match-harness.test.ts
git commit -m "feat(match-harness): install the harness, never overwrite a record

Install-if-absent for 17 files plus three marked blocks. Recipe-owned scripts
byte-compare against previously shipped renders and safe-replace; a hand-edited
one is flagged and left alone. The harness CODE goes into .prettierignore rather
than through the site's prettier — printWidth varies across the fleet, and
reformatting on install would make every future upgrade read as a hand edit —
but only matching/*.mjs, matching/*.sh and matching/harness.json: eslint already
ignores the whole directory, so a blanket entry would leave SPEC.md, LEDGER.md
and spec-sections/ with no style check at all.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 14: Registration and the CLI command

**Files:** Modify: `src/types.ts:31-43` · `src/recipes/index.ts:1-63` · `src/cli/bin.ts:50-68` and after `:386` · Create: `src/cli/commands/match-harness.ts` · Test: the built binary's help

- [ ] **Step 1: Write the failing test**

```bash
pnpm build && node dist/cli/bin.js match-harness --help; echo "exit=$?"
```

- [ ] **Step 2: Run it and watch it fail** — cac prints the top-level help (no such command) and the `RECIPE_DESCRIPTIONS` Record is not yet exhaustive, so `pnpm typecheck` also fails once `"match-harness"` joins the union.

- [ ] **Step 3: Implement** — four registrations plus the command module.

`src/types.ts:42` — add `| "match-harness"` before `| "init"`.

`src/recipes/index.ts` — add `import { matchHarness } from "./match-harness/index.js";` after line 10, add `matchHarness,` to the value export block (after `smokeSuite,` at line 29), and add `"match-harness",` to `ALL_RECIPE_NAMES` after `"smoke-suite",` (line 55).

`src/cli/bin.ts:62` — add to `RECIPE_DESCRIPTIONS`:

```ts
  "match-harness":
    "Install the matching-a-page gate harness (dev-guarded /dev/match/[uid] route + matching/ scripts) for a live-reference rebuild.",
```

`src/cli/bin.ts`, after the `health-endpoint` block ends at line 386:

```ts
cli
  .command(
    "match-harness [site]",
    "Install the matching-a-page gate harness (dev-guarded /dev/match/[uid] route + matching/ scripts) for a live-reference rebuild.",
  )
  .option("--ref <url>", "Reference (live) site URL the harness gates against — required")
  .option("--cand <url>", "Candidate origin (default http://localhost:5173)")
  .option("--matrix <list>", "Breakpoint matrix, comma-separated (default 1440,834,390)")
  .option(
    "--fleet <inventory>",
    'Inventory file (.json or .mjs/.js), or "airtable" to read from Websites table',
  )
  .option("--workdir <path>", "Clone target for fleet mode (default ~/.reddoor-maint/sites)")
  .action(
    async (
      site,
      opts: {
        ref?: string;
        cand?: string;
        matrix?: string;
        fleet?: string;
        workdir?: string;
        cwd?: string;
        verbose?: boolean;
      },
    ) =>
      runOrExit(
        async () =>
          (await import("./commands/match-harness.js")).runMatchHarnessCommand(site, opts),
        opts,
      ),
  );
```

`src/cli/commands/match-harness.ts` — `health-endpoint.ts:1-47` verbatim with the recipe swapped and the three options parsed:

```ts
import { resolve } from "node:path";
import { matchHarness } from "../../recipes/match-harness/index.js";
import type { RecipeResult } from "../../types.js";
import { resolveSites } from "../fleet/resolve-sites.js";
import { prepareFleetSites, appendSkipNotice, type SkippedSite } from "../fleet/prepare-sites.js";
import { runRecipeOverSites } from "../fleet/run-recipe-over-sites.js";
import { fleetWorkdir } from "../../util/fleet-workdir.js";

export type MatchHarnessCommandOptions = {
  ref?: string;
  cand?: string;
  matrix?: string;
  fleet?: string;
  workdir?: string;
  cwd?: string;
};

function formatResult(r: RecipeResult): string {
  if (r.status === "noop") return `[${r.site}] noop: ${r.notes ?? ""}`;
  if (r.status === "failed") return `[${r.site}] failed: ${r.notes ?? ""}`;
  return `[${r.site}] applied: ${r.commits.length} commit(s)\n${r.notes ?? ""}`;
}

export async function runMatchHarnessCommand(
  site: string | undefined,
  opts: MatchHarnessCommandOptions,
): Promise<{ output: string; code: number }> {
  const cwd = opts.cwd ? resolve(opts.cwd) : process.cwd();

  let sites = await resolveSites({
    ...(site !== undefined ? { site } : {}),
    ...(opts.fleet !== undefined ? { fleet: opts.fleet } : {}),
    ...(opts.workdir !== undefined ? { workdir: opts.workdir } : {}),
    cwd,
  });

  let skipped: SkippedSite[] = [];
  if (opts.fleet) {
    const workdir = opts.workdir ?? fleetWorkdir();
    const prep = await prepareFleetSites(sites, { workdir });
    sites = prep.prepared;
    skipped = prep.skipped;
  }

  // A bad --matrix must not silently become [NaN]: the matrix is the gate's
  // denominator, and a NaN viewport would produce a score nobody could read.
  const matrix = opts.matrix ? opts.matrix.split(",").map((v) => Number(v.trim())) : undefined;
  if (matrix && matrix.some((v) => !Number.isFinite(v) || v <= 0)) {
    return {
      output: `match-harness: --matrix "${opts.matrix}" is not a list of viewports`,
      code: 1,
    };
  }

  const results = await runRecipeOverSites("match-harness", sites, (s) =>
    matchHarness(s, {
      ref: opts.ref ?? "",
      ...(opts.cand !== undefined ? { cand: opts.cand } : {}),
      ...(matrix !== undefined ? { matrix } : {}),
    }),
  );

  const output = results.map(formatResult).join("\n");
  const code = results.some((r) => r.status === "failed") ? 1 : 0;
  return { output: appendSkipNotice(output, skipped), code };
}
```

- [ ] **Step 4: Run it and watch it pass**

```bash
pnpm typecheck && pnpm build
node dist/cli/bin.js match-harness --help
node dist/cli/bin.js list-recipes | grep match-harness
node scripts/smoke-dist.mjs
```

Expect the command's help listing `--ref`, `--cand`, `--matrix`, `--fleet`, `--workdir`; `match-harness` in `list-recipes`; and `smoke-dist` green (the lazy `import()` keeps `bin.js`'s static closure clean).

- [ ] **Step 5: Commit**

```bash
git add src/types.ts src/recipes/index.ts src/cli/bin.ts src/cli/commands/match-harness.ts
git commit -m "feat(cli): reddoor-maint match-harness [site] --ref <url>

Positional site like every other recipe, no verb and no --site flag. --matrix is
validated at the boundary: the matrix is the gate's denominator, and a NaN
viewport produces a score that reads fine and means nothing.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 15: The rest of the suite, the changeset, and the maintenance PR

**Files:** Modify: `tests/recipes/match-harness.test.ts` · `tests/cli/fleet-workdir-forwarding.test.ts:9-31` · `README.md` · Create: `.changeset/match-harness-recipe.md`

- [ ] **Step 1: Write the failing tests** — thirteen more cases, red before Task 13/14's code satisfies them (write them all, run, then fix whatever they catch). Cases 1-9 prove the recipe copied the right bytes; **10-12 prove the copied harness executes**, which nothing else in this plan does:

1. **noop-ish on re-run** — run twice; the second is `noop` (nothing written → `commit` stages nothing → `withRecipe` reports noop).
2. **missing `--ref` fails** — `matchHarness({path}, { ref: "" })` → `status === "failed"`, notes match `/--ref <url> is required/`, and no `matching/` directory exists afterwards.
3. **`harness.json` parses with the passed ref and the default matrix** — `JSON.parse(await readFile(join(cwd,"matching/harness.json")))` gives `{ ref: "https://ref.test", cand: "http://localhost:5173", matrix: [1440,834,390], threshold: 0.1 }` and `pages.home.cand === "/dev/match/home"`.
4. **`--cand` / `--matrix` are honoured** — `matchHarness(site, { ref, cand: "http://localhost:4173", matrix: [1280, 390] })` → those exact values in the JSON.
5. **prettier is invoked on the site-owned files only** — a `recordingSpawn` shows one call, `["exec","prettier","--write", ...]`, with `src/lib/site-pages.js`, `src/lib/site-pages.test.ts`, both route files and `CLAUDE.md` present and **no** `matching/*` path.
6. **prettier failure still commits** — spawn returns `{code:1}` → `applied`, one commit, notes match `/could not prettier-format/`.
7. **previous-template safe-replace** — install, overwrite `matching/next.mjs` with a synthetic "old" body, commit it, re-run with `deps.previous = { "matching/next.mjs": [oldBody] }` → the file equals the current template and notes match `/matching\/next\.mjs upgraded/`.
8. **hand-edited is flagged, never overwritten** — same setup with `deps.previous = {}` → the file is byte-unchanged and notes match `/differs from the shipped template and was left alone/`.
9. **markers appear exactly once** — after two runs, `(await readFile(".gitignore")).split(GITIGNORE_MARKER).length === 2` and the same for `CLAUDE.md`'s marker and `.prettierignore`'s; a pre-existing `.gitignore` keeps its own lines.

Cases 10-12 shell out into the installed site. Spec C2's gate names two of them (`specs/2026-09-08-webflow-rebuild-pipeline-design.md:196-198`) and neither is provable by comparing bytes. They need a stub skill so `gate.sh`'s report-schema preflight passes, and case 12 needs something that answers as a reference:

```ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createServer } from "node:http";
import { mkdtemp, writeFile, chmod, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
const run = promisify(execFile);

/** A skill directory whose page-diff answers --version and nothing else. */
async function stubSkill(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "match-skill-"));
  await writeFile(
    join(dir, "page-diff.mjs"),
    '#!/usr/bin/env node\nconsole.log("page-diff 0.0.0 report-schema 1");\n',
    "utf-8",
  );
  await chmod(join(dir, "page-diff.mjs"), 0o755);
  return dir;
}

/** Rewrite one harness.json field in the installed site. */
async function patchHarness(cwd: string, patch: Record<string, unknown>) {
  const p = join(cwd, "matching/harness.json");
  const j = JSON.parse(await readFile(p, "utf-8"));
  await writeFile(p, JSON.stringify({ ...j, ...patch }, null, 2) + "\n", "utf-8");
}
```

10. **`next.mjs` refuses on an empty corpus** — install, then `run("node", ["matching/next.mjs"], { cwd })` rejects with `code === 2` and stderr matching `/no parseable gate run/`. The recipe installs no `PAUSED` file, so this reaches the guard Task 6 (b) added rather than exiting 0 at the pause switch.
11. **`gate.sh` refuses the seeded reference** — `run("bash", ["matching/gate.sh", "smoke", "home"], { cwd, env: { ...process.env, MATCHING_SKILL_DIR: await stubSkill() } })` rejects with `code === 2` and output matching `/refMark is empty/`. **This is not the no-SPEC refusal** — the seed ships `refMark: ""`, so `--check-ref` refuses first, and that is the correct fail-closed default: a fresh install cannot produce a score until someone names a string only the reference serves.
12. **`gate.sh` reaches the Phase 1 refusal once the reference verifies** — start a `createServer` listening on port 0 that answers every request `200 REFMARK-OK`; read its port off `server.address()`; call `patchHarness` with `ref` set to `"http://127.0.0.1:" + port` and `refMark` set to `"REFMARK-OK"`; then run the same command with the same stub skill. Still `code === 2`, but now the output matches `/REFUSED: no '## home' section in matching\/SPEC\.md/`. That is the sentence spec C2 names — the Phase 1 gate working from the template, on a site that has never had a spec written. Close the server in a `finally`.
13. **the Markdown stubs are prettier-clean** — `const prettier = await import("prettier")`, then for each of `matching/spec-sections/_chrome.md`, `matching/spec-sections/_header.md` and `matching/LEDGER.md`, `expect(await prettier.check(await readFile(join(cwd, rel), "utf-8"), { parser: "markdown" })).toBe(true)`. The recipe does not format `matching/`, and these three files stay inside a site's `prettier --check .` — an unformatted stub would turn a site's first `pnpm verify` red on install.

Plus the CLI row in `tests/cli/fleet-workdir-forwarding.test.ts`: `import { runMatchHarnessCommand } from "../../src/cli/commands/match-harness.js";` and, in the `commands` array (line 22-31), `["match-harness", () => runMatchHarnessCommand(undefined, { ...OPTS, ref: "https://ref.test" })],`.

- [ ] **Step 2: Run them and watch them fail**

```bash
pnpm exec vitest run tests/recipes/match-harness.test.ts tests/cli/fleet-workdir-forwarding.test.ts --no-coverage
```

- [ ] **Step 3: Implement** — fix whatever the nine cases catch, then add the changeset and the README section.

`.changeset/match-harness-recipe.md`:

```markdown
---
"@reddoorla/maintenance": minor
---

`match-harness` installs the matching-a-page gate harness into a site:
`matching/harness.json` (the page table as data), `matching/harness.mjs` (the
read layer with a fail-closed reference preflight), the round scripts, a
dev-guarded `/dev/match/[uid]` route, a `site-pages.js` scaffold and its
fixture-vs-model test, and the `.gitignore` / `.prettierignore` / `CLAUDE.md`
blocks.

It exists because the harness previously existed once, inside Beachfront, with
the page table hand-copied into nine scripts and six of them still gating
against a host that had begun serving our own build. Install-if-absent
throughout; site records are never rewritten; a recipe-owned script that
matches a previously shipped render is safe-replaced, and a hand-edited one is
flagged rather than overwritten.

Three marked blocks are appended, not two: the `.prettierignore` block is
narrowed to `matching/*.mjs`, `matching/*.sh` and `matching/harness.json` — the
files that must stay byte-identical to the template — so `SPEC.md`, `LEDGER.md`
and `spec-sections/` stay inside a site's `prettier --check .`. eslint already
ignores `matching/` wholesale, so a blanket entry would leave the records with
no style check at all.
```

`README.md` — a `### \`match-harness\` _(standalone — not part of \`init\`)_`section after the`upgrade svelte-4-to-5` section (README.md:150), showing the invocation, the installed file list, and the "edit harness.json, never harness.mjs" rule.

- [ ] **Step 4: Run the full gate**

```bash
pnpm verify
```

Expect typecheck, lint, build, coverage (floors: statements 78 / branches 67 / functions 76 / lines 80) and `test:dist` all green, and the working tree clean afterwards (CI's tripwire).

- [ ] **Step 5: Commit, PR, review, merge**

```bash
git add -A && git commit -m "test(match-harness): fourteen cases, incl. the installed harness actually running

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
git push -u origin feat/match-harness-recipe
gh pr create --repo reddoorla/reddoor-maintenance --base main --head feat/match-harness-recipe \
  --title "feat: match-harness recipe — the matching gate as an installable, versioned thing" \
  --body "$(cat <<'EOF'
Cut from beachfront-dentistry's consolidation PR, not from its current files —
the drift that PR fixed would otherwise have been baked into the template.

`reddoor-maint match-harness <site> --ref <url>` installs 17 files plus three
marked blocks. `matching/harness.json` is data; `matching/harness.mjs` is the
only reader, with a fail-closed preflight (200, no redirect, reference
fingerprint present, candidate fingerprint absent) and a report-schema check
against `page-diff --version`. The `/dev/match/[uid]` route 404s outside dev.

Templates are generated by `scripts/gen-match-harness-template.mjs`, which
refuses to write a constant whose escaping does not round-trip.

Three of the fourteen tests shell out into the installed site rather than
comparing bytes: `next.mjs` exits 2 on an empty corpus, `gate.sh` refuses the
seeded empty `refMark`, and — with a local HTTP server standing in as the
reference — `gate.sh` reaches the Phase 1 "no `## home` section" refusal. Every
other acceptance here only proves the recipe copied bytes.

The harness CODE goes into `.prettierignore` deliberately: printWidth differs
across the fleet, so running the site's prettier over recipe-owned scripts on
install would make every future upgrade read as a hand edit. Narrowed to
`matching/*.mjs`, `matching/*.sh`, `matching/harness.json` — `eslint.config.js`
already ignores `matching/` wholesale, so a blanket entry would leave `SPEC.md`,
`LEDGER.md` and `spec-sections/` with nothing checking them.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Then: an adversarial review (feat PRs require one per AUTONOMY.md:113-115), `gh pr checks --watch`, verify the changed-file list, `gh pr merge --squash --delete-branch` (GREEN), and remove the worktree.

**OPERATOR (RED tier):** the resulting `chore(release): version packages` PR is a human merge. Do not merge it; report the PR URL and stop there.

---

### Task 16: Beachfront's first real prismic-models run

**Files:** Modify: `beachfront-dentistry/customtypes/settings/index.json:3` · Test: the two workflow runs

This is a **separate branch cut fresh off `main`**, never stacked on Task 11's — a PR stacked on another PR's branch is auto-closed when that base is deleted, and a closed PR whose base is gone cannot be reopened.

- [ ] **Step 1: Collect the before-evidence** — the workflow is installed with the secret present and zero runs; prove that first:

```bash
cd ~/Documents/GitHub/beachfront-dentistry
gh run list --repo reddoorla/beachfront-dentistry --workflow prismic-models.yml --limit 5
gh secret list --repo reddoorla/beachfront-dentistry | grep PRISMIC_WRITE_TOKEN
```

Expect an empty run list and `PRISMIC_WRITE_TOKEN` present.

- [ ] **Step 2: Watch the absence** — an empty run list is not a pass, it is the reason this task exists: model delivery has never executed anywhere in the fleet.

- [ ] **Step 3: Implement** — one label change, chosen because it is visible in the editor and semantically inert. `customtypes/settings/index.json:3`:

```diff
-  "label": "Site Settings",
+  "label": "Site settings",
```

```bash
git checkout main && git pull && git checkout -b chore/prismic-models-first-run
# make the edit
git add customtypes/settings/index.json
git commit -m "chore(prismic): sentence-case the settings type label

The first real exercise of the prismic-models workflow. One label, no field
changes: model delivery has been installed on this repo with zero runs, and an
installed workflow nobody has ever seen succeed is an assumption, not a gate.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
git push -u origin chore/prismic-models-first-run
gh pr create --repo reddoorla/beachfront-dentistry --base main --head chore/prismic-models-first-run \
  --title "chore(prismic): first real run of the model delivery workflow" \
  --body "One label change in customtypes/settings/index.json, to make the prismic-models workflow run for the first time. The PR job comments the delta and writes nothing; merging runs the apply job. Nothing else in this PR.

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

- [ ] **Step 4: Verify the PR-side evidence**

```bash
gh pr checks --repo reddoorla/beachfront-dentistry <PR> --watch
gh pr view --repo reddoorla/beachfront-dentistry <PR> --comments | grep -A5 'Prismic model delta'
gh run list --repo reddoorla/beachfront-dentistry --workflow prismic-models.yml --limit 2
```

Expect a `### Prismic model delta` comment naming the `settings` label change, and one `pull_request` run recorded as success.

- [ ] **Step 5: OPERATOR (RED tier)** — **merge this PR yourself.** In the GitHub UI: open the PR, confirm the only changed file is `customtypes/settings/index.json`, and click **Squash and merge**. Writing a model to Prismic is a schema write and stays a human action.

  Afterwards the agent verifies and records:

```bash
gh run list --repo reddoorla/beachfront-dentistry --workflow prismic-models.yml --limit 3
gh run view --repo reddoorla/beachfront-dentistry <push-run-id> --json conclusion,url -q '.conclusion + " " + .url'
```

Expect a second run with `event: push`, `conclusion: success`, and its URL recorded in Beachfront's journal entry (Task 17). If the apply job fails, do **not** retry it — capture the log and open an issue; a failing first run is the finding this task was for.

---

### Task 17: Journals

**Files:** Modify: `beachfront-dentistry/docs/workJournal.md` · `<SKILL repo>/docs/workJournal.md` · `reddoor-maintenance/docs/autonomy-journal.md`

- [ ] **Step 1: Beachfront** — append (newest at the bottom):

```markdown
## 2026-09-08 — The page table becomes data, and the gate learns to refuse (#<PR>, `<sha>`)

The harness had nine copies of one table. `gate.sh:106-136` was canonical;
`census.sh`, `probe-anchor-parity.mjs`, `hover-sweep.mjs`, `states/index.mjs`,
`build-spec.mjs`, `next.mjs` (as TOTALS), `summarize.mjs` and
`gate-published.mjs` each held their own, and `walk.mjs` regex-parsed `gate.sh`
at runtime rather than holding one. They had drifted, and the drift was not
cosmetic. On 2026-08-10 only `gate.sh` was repointed at the Webflow staging
host; every other script kept `www.beachfrontdentistry.com`, which by then 301'd
to the apex serving our own Netlify build. So the style census, the hover sweep,
the states gate, the walkthrough and the anchor-parity probe had spent four
weeks comparing the candidate with itself and reporting clean.
`probe-anchor-parity.mjs:84` was also still cutting `contact` on "Book
Appointment", seven weeks after the gate moved to "OFFICE HOURS" — its comment
said "must mirror gate.sh exactly", and that promise is what a comment is worth.

**The belief this corrects.** The 08-10 note in `gate.sh` said the Webflow
original "is still published at its staging domain; that is the reference now."
As of today `beachfront-dentistry.webflow.io` returns a 906-byte 404 on `/`,
`/our-team`, `/your-first-visit`, `/services/dental-exams` and `/contact-us`, and
`www` still 301s to us. There is no live reference. The only surviving capture
is `matching/pages/*.live.html` + `matching/spec/`, both git-ignored, both on one
machine. That is why the preflight is fail-closed and requires a positive
fingerprint (`data-wf-site="64af3f93339537d6b661b556"`) rather than a 200: a 200
is exactly what both dead hosts produce for the wrong reasons.

**What is here now.** `matching/harness.json` holds the nine pages plus the
hosts, matrix, thresholds and fingerprints; `matching/harness.mjs` is the only
reader, exporting `REF`/`CAND`/`MATRIX`/`THRESHOLD`/`PAGES`/`byKey`/`TOTALS`
and a CLI (`--env`, `--table`, `--check-ref`) so the two bash gates hold no
second copy. TOTALS are derived — `(anchors + 1) × 3` — and the derived map
equals the old hand-typed one exactly, which is how we know the derivation is
the right one. `--table` prints the nine deleted `run` lines byte-identically.

**Numbers.** 247 tracked files under `matching/` before, 234 after: 16
`sweep*.sh` deleted (all on the dead host, all on the superseded two-viewport
matrix), three added (`harness.json`, `harness.mjs`, `spec-sections/_header.md`).
`gate.sh` lost 31 lines of site prose — the matrix rationale (`:9-12`), the
anchor contract (`:14-18`), the dangling `gate-chrome.sh` sentence (`:21-22`),
the 2026-08-10 REF note (`:32-37`), the 08-11 contact-anchor note (`:125-134`)
and the title line — to a dated `LEDGER.md` entry, because JSON holds no
comments and the script had to become generic enough to be a recipe template.
`spec-sections/_header.md` is a separate move: it takes `build-spec.mjs`'s
hard-coded SPEC header, so the generator can ship a neutral default and this
site keeps its `beachfront.css` citation rule and root-font ladder as data.
`grep -ci beachfront` over `gate.sh`, `census.sh` and `build-spec.mjs` is now
`0`, which is the check that the template is not about to name us.

**One deliberate loss.** `matching/*.mjs`, `matching/*.sh` and
`harness.json` — 215 files — are now in `.prettierignore`, so the recipe can
byte-compare them on a future upgrade instead of reading every reformat as a
hand edit. `eslint.config.js:52` already ignored `matching/`, so those 215 files
now have no style check at all. The 15 `.md` files and `states/*.mjs` were
deliberately left in scope: the fleet has already been bitten once by
`prettier --check .` silently covering nothing, and exempting the whole
directory would have repeated it with the records instead of the config.

**Report schema.** Every report now carries `meta.schemaVersion`, `page-diff
--version` prints it, and `gate.sh` compares before spending a run. Honest
accounting: this makes `next.mjs` exit 2 on this repo's entire corpus, because
every historical report predates the field. That is correct and it is also
inert — matching has been PAUSED since 09-01 and `next.mjs` exits at the pause
switch first. `strikes.mjs` still reads the legacy history, because it needs
only `mismatchFraction` and `pass` and every report has both.

**Two defects fixed in passing.** `gate.sh:21` had pointed at a `gate-chrome.sh`
that has never existed in this repo. And `/dev/match/[uid]` — which renders
fixture assemblies and queries Prismic — was shipping in production builds; it
now 404s outside dev, verified on `pnpm build && pnpm preview` with
`/health` as the 200 control, because a 404 from a broken build
proves nothing.

**Also today.** `customtypes/settings/index.json` got a one-word label change on
its own branch (#<PR2>) purely to make the `prismic-models` workflow run for the
first time. It has been installed here with the secret present and zero runs
since it landed. Delta comment: <url>. Apply run on merge: <url>.
```

- [ ] **Step 2: The skill repo** — append to `docs/workJournal.md`:

```markdown
## 2026-09-08 — Reports say which page-diff wrote them

`report.json` carried no version, so a change to `lib/report.mjs` could make a
site's `next.mjs` drop a page from its score with no error on either side — the
two repos had no shared release mechanism and no way to notice. `REPORT_SCHEMA`
lives in `lib/report.mjs`, goes into every report's `meta`, and
`page-diff --version` prints `page-diff <version> report-schema <n>` so a gate
can refuse before spending a run. Version 1 is the format as it stands; the
first real consumer is `matching/harness.mjs`, installed by
`reddoor-maint match-harness`.
```

- [ ] **Step 3: reddoor-maintenance** — after the PR merges, add one row at the top of the table in `docs/autonomy-journal.md`:

| Date       | PR                                                                | Class | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Gate                                                                                                                                                                     |
| ---------- | ----------------------------------------------------------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 2026-09-08 | [#NNN](https://github.com/reddoorla/reddoor-maintenance/pull/NNN) | feat  | `match-harness` recipe: installs the matching gate harness into a site (17 files + `.gitignore`/`.prettierignore`/`CLAUDE.md` blocks). `matching/harness.json` is data, `matching/harness.mjs` the only reader, with a fail-closed reference preflight and a report-schema check. Cut from beachfront-dentistry's consolidation PR rather than its current files, so the nine-way table duplication and the four-week self-comparison it fixed are not baked into the template. Templates come from a checked-in generator with a round-trip escaping check; the harness code (`matching/*.mjs`, `*.sh`, `harness.json`) is prettier-ignored so recipe-owned scripts stay byte-stable and future upgrades can byte-compare, while `SPEC.md`/`LEDGER.md`/`spec-sections/` stay checked. | `pnpm verify` + adversarial review + TDD (14 recipe cases; 3 of them shell out into the installed site so the acceptance is the harness RUNNING, not the bytes matching) |

- [ ] **Step 4: Verify** — `git -C ~/Documents/GitHub/beachfront-dentistry log --oneline -1 -- docs/workJournal.md` shows today's commit; the maintenance row renders (the table is prettier-formatted — run `pnpm format` on the file).

- [ ] **Step 5: Commit** each in its own repo with `docs: journal — <one line>` and the `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>` trailer.

---

## Verification

The C3 gate (Beachfront), all from the repo root with the dev server **not** running:

| #   | Command                                                                                                                                                                                                                      | Expected artefact                                                                                                                                             |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `node matching/harness.mjs --table \| diff - "$TMPDIR/gate-rows.tsv"`                                                                                                                                                        | no output, exit 0 — nine rows byte-identical to the deleted `run` lines                                                                                       |
| 2   | `node --input-type=module -e 'import{TOTALS}from"./matching/harness.mjs";console.log(JSON.stringify(TOTALS))'`                                                                                                               | `{"team":15,"svc":15,"qa":15,"home":27,"yfv":24,"our-team":15,"services":15,"atd":15,"contact":12}`                                                           |
| 3   | `bash matching/gate.sh x-y`                                                                                                                                                                                                  | the hyphen refusal, exit 2                                                                                                                                    |
| 4   | `SPEC_OPTIONAL=1 bash matching/gate.sh smoke home`                                                                                                                                                                           | `REF REFUSED — GET https://beachfront-dentistry.webflow.io/ → HTTP 404, expected 200`, exit 2, and **no** `matching/out-smoke-home/`                          |
| 5   | `node matching/next.mjs`                                                                                                                                                                                                     | `MATCHING PAUSED — no agenda, and none is to be inferred.`, exit 0                                                                                            |
| 6   | with `PAUSED` and the 726-entry `out-*` corpus moved aside, a fixture report at `schemaVersion: 99`                                                                                                                          | `next: 1 page(s) have no run at report schema 1 … (home)`, exit 2; flipping the fixture to `1` prints `SCORE 0/27 regions passing` and exits 1                |
| 6b  | the same, corpus restored                                                                                                                                                                                                    | `next: 9 page(s) have no run at report schema 1 …`, exit 2 — no historical report carries the field                                                           |
| 7   | `grep -c gate-chrome matching/gate.sh; ls matching/sweep*.sh`                                                                                                                                                                | `0`; `No such file or directory`                                                                                                                              |
| 7b  | `git check-ignore -v matching/harness.json \|\| echo TRACKED`                                                                                                                                                                | `TRACKED` — the table survives a fresh clone                                                                                                                  |
| 7c  | `grep -ci beachfront matching/gate.sh matching/census.sh matching/build-spec.mjs`                                                                                                                                            | `0` on each — the three files Task 12 copies verbatim name no site                                                                                            |
| 8   | `pnpm lint && pnpm check && pnpm test:unit && pnpm build`                                                                                                                                                                    | all green (Beachfront has no `verify` script)                                                                                                                 |
| 9   | `pnpm preview --port 4173 & PREVIEW=$!`, `curl -sf --retry 30 --retry-delay 1 --retry-connrefused …/health` as the readiness probe, then `curl -w '%{http_code}'` on `/dev/match/home` and `/health`, then `kill "$PREVIEW"` | `404` and `200`. Keep the PID — a backgrounded subshell is not a job, `kill %1` fails, and the surviving server makes the next run measure the previous build |

The C2 gate (maintenance):

| #   | Command                                                                               | Expected artefact                                                                                                                                                                                           |
| --- | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 10  | `node scripts/gen-match-harness-template.mjs ~/Documents/GitHub/beachfront-dentistry` | `wrote …/template.ts — 17 files, all round-trip verified`                                                                                                                                                   |
| 10b | `grep -ci beachfront src/recipes/match-harness/template.ts`                           | `0` — the template names no site                                                                                                                                                                            |
| 11  | `pnpm exec vitest run tests/recipes/match-harness.test.ts --no-coverage`              | 14 passed                                                                                                                                                                                                   |
| 11b | case 10 inside the temp site: `node matching/next.mjs`                                | exit 2, `no parseable gate run under matching/` — the installed harness runs, not just copies (spec C2)                                                                                                     |
| 11c | cases 11-12 inside the temp site: `bash matching/gate.sh smoke home`                  | exit 2 with `refMark is empty` on the seed; exit 2 with `REFUSED: no '## home' section in matching/SPEC.md` once a local HTTP reference satisfies the preflight (spec C2's Phase 1 gate, from the template) |
| 12  | `node dist/cli/bin.js match-harness --help`                                           | help listing `--ref`, `--cand`, `--matrix`, `--fleet`, `--workdir`                                                                                                                                          |
| 13  | `pnpm verify`                                                                         | typecheck + lint + build + coverage (78/67/76/80) + `test:dist`, tree clean after                                                                                                                           |

The C5 half-gate (Beachfront model delivery): one `pull_request` run with a `### Prismic model delta` comment and one `push` run with `conclusion: success`, both URLs in Beachfront's journal.
