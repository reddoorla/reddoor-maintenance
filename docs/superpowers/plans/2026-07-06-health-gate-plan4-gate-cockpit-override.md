# Health Gate Plan 4 — Evidence-for-every-item, flip the gate, cockpit reframe, logged override — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to execute this plan. Dispatch each Task to a fresh subagent, review between tasks, and keep the working tree clean. Steps use checkbox (- [ ]) syntax.

**Goal:** Flip the report checklist from a manually-ticked to-do list into an automated **site-CI health gate**. Cover spec Phases 7–10: (7) widen `EvidenceResult` with `"n/a"` and emit a stored evidence status for **every** gating checklist item on every draft (the semantic inversion: an absent gating signal → `unknown` → **blocks**); (8) add the pure gate predicates (`gatingFields`/`isHealthGateClear`/`gatingHealth`), fold health blockers into the existing `approveBlockers`, and swap all three enforcement sites off `isChecklistComplete`; (9) reframe the per-site dashboard's `checklistBlock` into Tier-colored per-check health; (10) add a **logged send-anyway override** (`sendOverride`/`overrideReason`/`overrideBy`/`overrideAt`) with its own `"overridden"` `ApproveResult` branch, a distinct endpoint param, a `report_sent_with_override` fleet event, honored in both the approve front door and the `sendOne` backstop.

**Architecture:** Pure evidence functions in `auto-tick.ts` (`(site, now) => EvidenceRecord | null`, freshness-gated by the existing `isFresh`/`STALE_DAYS = 3`) produce a `pass|fail|unknown|n/a` per checklist item; `autoTickChecklist` dispatches one per gating item and coerces a `null` (omit) on a **gating** field to `unknown` so a status exists for every gating item; `draftReportForSite` already persists the full evidence map into the `autoEvidence` JSON, so the gate reads evidence, not booleans. Three pure predicates in `checklist.ts` (`gatingFields`/`isHealthGateClear`/`gatingHealth`) + `isSendOverridden` express the partition and the effective send gate. Health failures ride the existing second gate (`approveBlockers` → `formatBlockers` → 409 → dashboard chip) via a new `healthBlockers(report)`. The cockpit reuses the existing site-Tier bands (`healthy|watch|attention` = green|amber|red). The override is a distinct deliberate action with its own `ApproveResult` branch, raw writer, endpoint param, and fleet event.

**Tech Stack:** TypeScript (NodeNext — relative imports carry `.js`), Vitest (node env, tests in `tests/**/*.test.ts`, write only to tmpdir), tsup build, ESLint (`no-explicit-any`) + Prettier, dual typecheck (`tsc --noEmit` **and** `-p tsconfig.netlify.json`), `test:dist` (`smoke-dist.mjs` — the audit import graph must never reach central-only packages; `import type` for airtable, dynamic `import()` only in CLI write-back), coverage floors (statements 78 / branches 67 / functions 76 / lines 80, `include` = `src/**/*.ts`).

**Preconditions (hard cross-plan dependency — verify before starting):** Phases 2, 3, 5, 6 of the spec are merged, which add these **`WebsiteRow`** fields **and** their `makeWebsiteRow` factory defaults (this plan's evidence functions read them; without them Phase 7 will not typecheck): `deployCheckedAt: string|null` (Phase 3 read-back), `functionHealth: "pass"|"fail"|null` + `functionHealthCheckedAt: string|null` + `cmsReachable: "pass"|"fail"|null` (Phase 2), `reachableOk: "pass"|"fail"|null` + `titleMetaOk: "pass"|"fail"|null` (Phase 3), `smokeOk: "pass"|"fail"|null` + `lastSmokeAt: string|null` (Phase 5), `formE2eOk: "pass"|"fail"|null` + `formE2eCheckedAt: string|null` (Phase 6). Already present today: `deployStatus`, `browserCheckedAt`, `crossbrowserOk`, `mobileOk`, `linksOk`, `brokenLinks`, `certDaysRemaining`, `domainCheckedAt`, `securityVulnsCritical/High`, `lastSecurityAuditAt`, `defaultBranchCi` (`"passing"|"failing"|"pending"|"none"`), `githubSignalsAt`. If a subagent finds any listed field missing from `WebsiteRow`/`makeWebsiteRow`, STOP and flag — do not add producer columns here (out of scope).

---

## File Structure

**Modified (src):**

- `src/reports/auto-tick.ts` — widen `EvidenceResult` union with `"n/a"`; add 7 evidence fns (`deployEvidence`, `cmsEvidence`, `uptimeEvidence`, `titlesEvidence`, `formsEvidence`, `interactionsEvidence`, `updatesEvidence`); rewrite `autoTickChecklist` to dispatch every checklist item and coerce a `null` on a **gating** field to `unknown`.
- `src/reports/airtable/reports.ts` — `parseAutoEvidence` accepts `"n/a"`; add `sendOverride`/`overrideReason`/`overrideBy`/`overrideAt` to `ReportRow` + `mapRow`; add `overrideReportRow` raw writer.
- `src/reports/checklist.ts` — add `gatingFields`, `isHealthGateClear`, `gatingHealth`, `isSendOverridden` (alongside the untouched `isChecklistComplete`).
- `src/reports/preflight.ts` — add `healthBlockers(report)`; fold it into `approveBlockers`.
- `src/dashboard/approve.ts` — swap the checklist branch for the health-via-blockers path; add the `"overridden"` + `"override-reason-required"` branches, `overrideReport` dep, and the `override?` argument.
- `src/dashboard/checklist.ts` — `setChecklistItem.complete` reads `isHealthGateClear`.
- `src/dashboard/render.ts` — `approveButton` gates on `isHealthGateClear`; `checklistBlock` reframed to Tier-colored per-check health; CSS aligned; dead checklist-checkbox script removed.
- `src/reports/send/orchestrate.ts` — `sendOne` backstop gates on `isHealthGateClear` (by-name message) honoring `isSendOverridden`; `sendApprovedReports` emits `report_sent_with_override`.
- `src/db/fleet-events.ts` — add `"report_sent_with_override"` to `FleetEventType`.
- `src/dashboard/fleet-render.ts` — add the `report_sent_with_override` entry to the exhaustive `RECENT_ICON` map.
- `netlify/functions/approve-report.mts` — read an override intent (`?override=1` + JSON `{reason}`), bind `overrideReport` to `overrideReportRow`, map `"overridden"` → 200 and `"override-reason-required"` → 409.

**Modified (tests):**

- `tests/reports/auto-tick.test.ts`, `tests/reports/checklist.test.ts`, `tests/reports/reports-autoevidence.test.ts`, `tests/dashboard/approve.test.ts`, `tests/dashboard/checklist.test.ts`, `tests/dashboard/render.test.ts`, `tests/reports/preflight.test.ts`, `tests/reports/send/orchestrate.test.ts`, plus the inline `ReportRow` factories in `tests/alerts/digest-collectors.test.ts`, `tests/dashboard/fleet-cockpit.test.ts`, `tests/dashboard/fleet-render.test.ts`, `tests/reports/due.test.ts`, `tests/webhook/resend-webhook.test.ts` (4-field override snippet).

---

## Task 1: Widen `EvidenceResult` with `"n/a"`

**Files:** Modify `src/reports/auto-tick.ts:26` · Modify `src/reports/airtable/reports.ts:130` · Test `tests/reports/reports-autoevidence.test.ts`

- [ ] **Step 1: Write the failing test for `"n/a"` round-tripping through `parseAutoEvidence`.** Append to `tests/reports/reports-autoevidence.test.ts` inside the `describe("parseAutoEvidence", ...)` block:

```ts
it("accepts an 'n/a' result (the widened union — a per-site not-applicable state)", () => {
  const raw = JSON.stringify({
    "Test: Form Functionality": {
      result: "n/a",
      checkedAt: "2026-07-06T12:00:00.000Z",
      note: "No contact form on this site",
    },
  });
  const ev = parseAutoEvidence(raw);
  expect(ev?.["Test: Form Functionality"]?.result).toBe("n/a");
});
```

- [ ] **Step 2: Run the test, confirm it fails.** Run `cd /Users/tuckerlemos/Documents/GitHub/reddoor-maintenance && pnpm exec vitest run tests/reports/reports-autoevidence.test.ts`. Expected failure: the new record is dropped because `parseAutoEvidence` rejects any `result` other than `pass`/`fail`/`unknown`, so `ev?.["Test: Form Functionality"]` is `undefined` and `.result` is `undefined`, not `"n/a"`.

- [ ] **Step 3: Widen the union.** In `src/reports/auto-tick.ts`, replace line 26:

```ts
export type EvidenceResult = "pass" | "fail" | "unknown" | "n/a";
```

- [ ] **Step 4: Accept `"n/a"` in the parser guard.** In `src/reports/airtable/reports.ts`, in `parseAutoEvidence`, replace the result-validation line:

```ts
if (o.result !== "pass" && o.result !== "fail" && o.result !== "unknown" && o.result !== "n/a")
  continue;
```

Also update the doc comment two lines above (the "one of the three literals" phrasing) to "one of the four literals" so the comment stays honest.

- [ ] **Step 5: Run the test, confirm it passes.** Run `cd /Users/tuckerlemos/Documents/GitHub/reddoor-maintenance && pnpm exec vitest run tests/reports/reports-autoevidence.test.ts`. Expected: all tests pass (the existing "drops entries with an invalid inner shape" test still passes — `"bogus"` is still rejected).

- [ ] **Step 6: Commit.** Run `cd /Users/tuckerlemos/Documents/GitHub/reddoor-maintenance && git add -A && git commit -m "feat(reports): widen EvidenceResult with n/a (health-gate phase 7)"`.

---

## Task 2: Add the 7 evidence functions to `auto-tick.ts`

**Files:** Modify `src/reports/auto-tick.ts` · Test `tests/reports/auto-tick.test.ts`

- [ ] **Step 1: Write failing tests for all 7 evidence fns via `autoTickChecklist`.** These fns are module-private, so exercise them through `autoTickChecklist` (dispatched in Task 3). To test them in isolation NOW, add a temporary `describe` that will pass once Task 3 wires dispatch — instead, test them here by asserting the values `autoTickChecklist` will emit. Append to `tests/reports/auto-tick.test.ts`:

```ts
const DEPLOY = "Maint: Deploy & Function Health";
const CMS = "Maint: CMS Checked";
const UPTIME = "Maint: Uptime Checked";
const TITLES = "Test: Page Titles & Meta";
const FORMS = "Test: Form Functionality";
const INTERACTIONS = "Test: Interactions & Animations";
const UPDATES = "Test: Verified After Updates";

describe("autoTickChecklist — Deploy & Function Health evidence", () => {
  it("passes when the build is ready AND function-health is pass, both fresh", () => {
    const site = makeWebsiteRow({
      deployStatus: "ready",
      deployCheckedAt: FRESH,
      functionHealth: "pass",
      functionHealthCheckedAt: FRESH,
    });
    const e = autoTickChecklist(site, "Maintenance", NOW, signals()).get(DEPLOY)!;
    expect(e.result).toBe("pass");
    expect(e.note).toMatch(/build ready/i);
  });
  it("fails when the build is not ready", () => {
    const site = makeWebsiteRow({
      deployStatus: "error",
      deployCheckedAt: FRESH,
      functionHealth: "pass",
      functionHealthCheckedAt: FRESH,
    });
    expect(autoTickChecklist(site, "Maintenance", NOW, signals()).get(DEPLOY)!.result).toBe("fail");
  });
  it("is unknown when either freshness stamp is stale", () => {
    const site = makeWebsiteRow({
      deployStatus: "ready",
      deployCheckedAt: FRESH,
      functionHealth: "pass",
      functionHealthCheckedAt: "2026-06-01T00:00:00.000Z",
    });
    expect(autoTickChecklist(site, "Maintenance", NOW, signals()).get(DEPLOY)!.result).toBe(
      "unknown",
    );
  });
});

describe("autoTickChecklist — CMS Checked evidence", () => {
  it("passes when cmsReachable is pass and fresh", () => {
    const site = makeWebsiteRow({ cmsReachable: "pass", functionHealthCheckedAt: FRESH });
    expect(autoTickChecklist(site, "Maintenance", NOW, signals()).get(CMS)!.result).toBe("pass");
  });
  it("fails when cmsReachable is fail", () => {
    const site = makeWebsiteRow({ cmsReachable: "fail", functionHealthCheckedAt: FRESH });
    expect(autoTickChecklist(site, "Maintenance", NOW, signals()).get(CMS)!.result).toBe("fail");
  });
});

describe("autoTickChecklist — Uptime evidence", () => {
  it("passes when reachableOk is pass and the browser check is fresh", () => {
    const site = makeWebsiteRow({ reachableOk: "pass", browserCheckedAt: FRESH });
    expect(autoTickChecklist(site, "Maintenance", NOW, signals()).get(UPTIME)!.result).toBe("pass");
  });
  it("fails when reachableOk is fail", () => {
    const site = makeWebsiteRow({ reachableOk: "fail", browserCheckedAt: FRESH });
    expect(autoTickChecklist(site, "Maintenance", NOW, signals()).get(UPTIME)!.result).toBe("fail");
  });
});

describe("autoTickChecklist — Titles & Meta evidence (Testing)", () => {
  it("passes when titleMetaOk is pass and fresh", () => {
    const site = makeWebsiteRow({ titleMetaOk: "pass", browserCheckedAt: FRESH });
    expect(autoTickChecklist(site, "Testing", NOW, signals()).get(TITLES)!.result).toBe("pass");
  });
});

describe("autoTickChecklist — Form Functionality evidence (Testing)", () => {
  it("passes when formE2eOk is pass and fresh", () => {
    const site = makeWebsiteRow({ formE2eOk: "pass", formE2eCheckedAt: FRESH });
    expect(autoTickChecklist(site, "Testing", NOW, signals()).get(FORMS)!.result).toBe("pass");
  });
  it("is n/a when the audit ran but the site has no contact form (verdict cleared, stamp set)", () => {
    const site = makeWebsiteRow({ formE2eOk: null, formE2eCheckedAt: FRESH });
    expect(autoTickChecklist(site, "Testing", NOW, signals()).get(FORMS)!.result).toBe("n/a");
  });
});

describe("autoTickChecklist — Interactions evidence (Testing)", () => {
  it("passes when smokeOk is pass and fresh", () => {
    const site = makeWebsiteRow({ smokeOk: "pass", lastSmokeAt: FRESH });
    expect(autoTickChecklist(site, "Testing", NOW, signals()).get(INTERACTIONS)!.result).toBe(
      "pass",
    );
  });
});

describe("autoTickChecklist — Tested After Updates evidence (Testing)", () => {
  it("passes when defaultBranchCi is passing and fresh", () => {
    const site = makeWebsiteRow({ defaultBranchCi: "passing", githubSignalsAt: FRESH });
    expect(autoTickChecklist(site, "Testing", NOW, signals()).get(UPDATES)!.result).toBe("pass");
  });
  it("is n/a when the repo has no CI (defaultBranchCi === 'none')", () => {
    const site = makeWebsiteRow({ defaultBranchCi: "none", githubSignalsAt: FRESH });
    expect(autoTickChecklist(site, "Testing", NOW, signals()).get(UPDATES)!.result).toBe("n/a");
  });
  it("fails when defaultBranchCi is failing", () => {
    const site = makeWebsiteRow({ defaultBranchCi: "failing", githubSignalsAt: FRESH });
    expect(autoTickChecklist(site, "Testing", NOW, signals()).get(UPDATES)!.result).toBe("fail");
  });
});
```

- [ ] **Step 2: Run, confirm failure.** Run `cd /Users/tuckerlemos/Documents/GitHub/reddoor-maintenance && pnpm exec vitest run tests/reports/auto-tick.test.ts`. Expected failure: these fields aren't dispatched yet (Task 3 wires them), so `.get(DEPLOY)` etc. return `undefined` and `.result` throws on the non-null assertion / is `undefined`. (This task adds the fns; Task 3 adds the dispatch that makes these pass. If you prefer strict per-task green, run this file at the end of Task 3.)

- [ ] **Step 3: Add the 7 evidence functions.** In `src/reports/auto-tick.ts`, add these functions after the existing `domainEvidence` (end of file, before the final line). Complete code:

```ts
/**
 * Deploy & Function Health: the Netlify build is `ready` AND the deployed function responds
 * healthy. Two freshness stamps must both be fresh (deploy check + function-health check). Never
 * measured → null (omit → the gating dispatch coerces to unknown); either stale → unknown; both
 * fresh + ready + fn pass → pass; otherwise fail.
 */
function deployEvidence(site: WebsiteRow, now: Date): EvidenceRecord | null {
  if (!site.deployCheckedAt && !site.functionHealthCheckedAt) return null;
  if (!isFresh(site.deployCheckedAt, now) || !isFresh(site.functionHealthCheckedAt, now)) {
    return {
      result: "unknown",
      checkedAt: site.functionHealthCheckedAt ?? site.deployCheckedAt,
      note: "Deploy/function-health check is stale (>3d)",
    };
  }
  const ready = site.deployStatus === "ready";
  const fnOk = site.functionHealth === "pass";
  if (ready && fnOk) {
    return {
      result: "pass",
      checkedAt: site.functionHealthCheckedAt,
      note: "Netlify build ready + functions respond",
    };
  }
  const why =
    !ready && !fnOk
      ? "build not ready + functions unhealthy"
      : !ready
        ? "build not ready"
        : "functions unhealthy";
  return {
    result: "fail",
    checkedAt: site.functionHealthCheckedAt,
    note: `Deploy/function-health failing — ${why}`,
  };
}

/**
 * CMS Checked: the server-side `/health` Prismic probe reported reachable. Freshness rides the
 * function-health check stamp (one `/health` fetch feeds both Deploy and CMS). Never measured →
 * null; stale → unknown; pass/fail mirror the stored verdict; a fresh stamp with no verdict →
 * unknown.
 */
function cmsEvidence(site: WebsiteRow, now: Date): EvidenceRecord | null {
  if (!site.functionHealthCheckedAt) return null;
  const at = site.functionHealthCheckedAt;
  if (!isFresh(at, now)) {
    return { result: "unknown", checkedAt: at, note: "CMS check is stale (>3d)" };
  }
  if (site.cmsReachable === "pass") {
    return { result: "pass", checkedAt: at, note: "Prismic reachable (server-side)" };
  }
  if (site.cmsReachable === "fail") {
    return { result: "fail", checkedAt: at, note: "Prismic unreachable (server-side)" };
  }
  return { result: "unknown", checkedAt: at, note: "CMS reachability not reported" };
}

/**
 * Uptime Checked: every sampled route returned 2xx/3xx on the browser audit (point-in-time).
 * Freshness rides the shared `browserCheckedAt`. Never ran → null; stale → unknown.
 */
function uptimeEvidence(site: WebsiteRow, now: Date): EvidenceRecord | null {
  if (site.reachableOk === null || !site.browserCheckedAt) return null;
  const at = site.browserCheckedAt;
  if (!isFresh(at, now)) {
    return { result: "unknown", checkedAt: at, note: "Uptime check is stale (>3d)" };
  }
  return site.reachableOk === "pass"
    ? { result: "pass", checkedAt: at, note: "All sampled routes reachable (point-in-time)" }
    : { result: "fail", checkedAt: at, note: "One or more sampled routes did not respond 2xx/3xx" };
}

/**
 * Page Titles & Meta: every sampled route had a non-empty title + meta description with no
 * duplicate titles (browser audit, chromium). Freshness rides `browserCheckedAt`.
 */
function titlesEvidence(site: WebsiteRow, now: Date): EvidenceRecord | null {
  if (site.titleMetaOk === null || !site.browserCheckedAt) return null;
  const at = site.browserCheckedAt;
  if (!isFresh(at, now)) {
    return { result: "unknown", checkedAt: at, note: "Titles/meta check is stale (>3d)" };
  }
  return site.titleMetaOk === "pass"
    ? { result: "pass", checkedAt: at, note: "Titles + meta present" }
    : {
        result: "fail",
        checkedAt: at,
        note: "Missing/duplicate title or missing meta description",
      };
}

/**
 * Form Functionality: a synthetic prod submission succeeded (form-e2e audit). `n/a` when the audit
 * ran (checked-at stamp set) but the site has no contact form (verdict cleared to null). Never ran
 * (no stamp) → null; stale → unknown.
 */
function formsEvidence(site: WebsiteRow, now: Date): EvidenceRecord | null {
  if (!site.formE2eCheckedAt) return null;
  const at = site.formE2eCheckedAt;
  if (!isFresh(at, now)) {
    return { result: "unknown", checkedAt: at, note: "Form E2E check is stale (>3d)" };
  }
  if (site.formE2eOk === "pass") {
    return { result: "pass", checkedAt: at, note: "Synthetic submission succeeded" };
  }
  if (site.formE2eOk === "fail") {
    return { result: "fail", checkedAt: at, note: "Synthetic submission failed" };
  }
  return { result: "n/a", checkedAt: at, note: "No contact form on this site" };
}

/**
 * Interactions & Animations: the per-site smoke suite is green. Freshness rides `lastSmokeAt`.
 * Never ran → null; stale → unknown.
 */
function interactionsEvidence(site: WebsiteRow, now: Date): EvidenceRecord | null {
  if (site.smokeOk === null || !site.lastSmokeAt) return null;
  const at = site.lastSmokeAt;
  if (!isFresh(at, now)) {
    return { result: "unknown", checkedAt: at, note: "Smoke suite is stale (>3d)" };
  }
  return site.smokeOk === "pass"
    ? { result: "pass", checkedAt: at, note: "Smoke suite green" }
    : { result: "fail", checkedAt: at, note: "Smoke suite red" };
}

/**
 * Tested After Updates: default-branch CI is green on the latest commit (github-signals). A repo
 * with no CI (`defaultBranchCi === "none"`) is `n/a`. Never swept (null / no stamp) → null; stale
 * → unknown; passing → pass; failing → fail; pending → unknown.
 */
function updatesEvidence(site: WebsiteRow, now: Date): EvidenceRecord | null {
  if (site.defaultBranchCi === null || !site.githubSignalsAt) return null;
  const at = site.githubSignalsAt;
  if (site.defaultBranchCi === "none") {
    return { result: "n/a", checkedAt: at, note: "Repository has no CI" };
  }
  if (!isFresh(at, now)) {
    return { result: "unknown", checkedAt: at, note: "CI signal is stale (>3d)" };
  }
  if (site.defaultBranchCi === "passing") {
    return { result: "pass", checkedAt: at, note: "Default-branch CI green on latest commit" };
  }
  if (site.defaultBranchCi === "failing") {
    return { result: "fail", checkedAt: at, note: "Default-branch CI is failing" };
  }
  return { result: "unknown", checkedAt: at, note: "Default-branch CI is pending" };
}
```

- [ ] **Step 4: Confirm no lint/typecheck regressions yet (the fns are unused until Task 3, which triggers `no-unused-vars`).** Because ESLint flags unused functions, do NOT run lint in isolation here — proceed directly to Task 3 which references all 7. (They will be used by `autoTickChecklist` in the next task.) Verify they compile by running `cd /Users/tuckerlemos/Documents/GitHub/reddoor-maintenance && pnpm exec tsc --noEmit`. Expected: clean (unused module-private functions are not a `tsc` error, only an eslint warning — resolved in Task 3).

- [ ] **Step 5: Commit.** Run `cd /Users/tuckerlemos/Documents/GitHub/reddoor-maintenance && git add -A && git commit -m "feat(reports): add 7 health evidence fns to auto-tick (health-gate phase 7)"`.

---

## Task 3: Dispatch every gating item in `autoTickChecklist` (the semantic inversion)

**Files:** Modify `src/reports/auto-tick.ts:44-102` · Test `tests/reports/auto-tick.test.ts`

- [ ] **Step 1: Write the failing "status for every gating item" tests + fix the pre-inversion omit assertions.** In `tests/reports/auto-tick.test.ts`:

  (a) Add a new describe block:

```ts
import { gatingFields } from "../../src/reports/checklist.js";

describe("autoTickChecklist — the semantic inversion (a status for every gating item)", () => {
  it("emits 'unknown' for every gating Maintenance field when nothing has been measured", () => {
    const ev = autoTickChecklist(makeWebsiteRow(), "Maintenance", NOW, signals());
    for (const field of gatingFields("Maintenance")) {
      expect(ev.get(field)?.result).toBe("unknown");
    }
    // Google Indexed is ADVISORY for Maintenance → still omitted when unconfigured.
    expect(ev.has("Maint: Google Indexed")).toBe(false);
  });
  it("emits 'unknown' for every one of the 13 gating Testing fields when nothing has been measured", () => {
    const ev = autoTickChecklist(makeWebsiteRow(), "Testing", NOW, signals());
    for (const field of gatingFields("Testing")) {
      expect(ev.get(field)?.result).toBe("unknown");
    }
  });
  it("emits nothing for Launch/Announcement (no gating fields)", () => {
    expect(autoTickChecklist(makeWebsiteRow(), "Launch", NOW, signals()).size).toBe(0);
  });
});
```

(b) Replace the pre-inversion "omit" assertions on **gating** fields with "unknown" assertions. Specifically:

- In `describe("autoTickChecklist — Domain, DNS & SSL", ...)`, the test `"omits domain evidence for a *.netlify.app site ..."` — change its expectation to `.get(DOMAIN)!.result).toBe("unknown")` (Domain is gating for Maintenance → a `null` from `domainEvidence` is coerced to `unknown`). Do the same for `"omits domain evidence when the domain was never checked"` → `.get(DOMAIN)!.result).toBe("unknown")`.
- In `describe("autoTickChecklist — Security Updates", ...)`, the test `"omits when the security audit never ran ..."` — change to `.get(SECURITY)!.result).toBe("unknown")`.
- In `describe("autoTickChecklist — browser checks ...", ...)`, the test `"omits browser evidence entirely when the audit never ran ..."` — change the three `expect(ev.has(...)).toBe(false)` to `expect(ev.get(DESKTOP)!.result).toBe("unknown")` / `MOBILE` / `LINKS` (these are gating for Testing).

- [ ] **Step 2: Run, confirm failure.** Run `cd /Users/tuckerlemos/Documents/GitHub/reddoor-maintenance && pnpm exec vitest run tests/reports/auto-tick.test.ts`. Expected failure: the current `autoTickChecklist` omits absent gating items, so the new "unknown for every gating field" assertions fail (`ev.get(field)` is `undefined`), and the Task 2 evidence-value assertions still fail (not dispatched).

- [ ] **Step 3: Rewrite `autoTickChecklist` to dispatch every item + coerce gating `null` → `unknown`.** In `src/reports/auto-tick.ts`, first extend the import on line 4 to pull in `gatingFields`:

```ts
import { checklistFor, gatingFields } from "./checklist.js";
```

Then replace the entire body of `autoTickChecklist` (lines 44–102) with:

```ts
export function autoTickChecklist(
  site: WebsiteRow,
  reportType: ReportType,
  now: Date,
  signals: AutoTickSignals,
): Map<string, EvidenceRecord> {
  const out = new Map<string, EvidenceRecord>();
  const gating = new Set(gatingFields(reportType));

  for (const item of checklistFor(reportType)) {
    let ev: EvidenceRecord | null;
    switch (item.field) {
      case "Maint: Google Indexed":
        ev = googleEvidence(now, signals.search);
        break;
      case "Maint: Deploy & Function Health":
        ev = deployEvidence(site, now);
        break;
      case "Maint: CMS Checked":
        ev = cmsEvidence(site, now);
        break;
      case "Maint: Domain, DNS & SSL":
        ev = domainEvidence(site, now);
        break;
      case "Maint: Security Updates":
        ev = securityEvidence(site, now);
        break;
      case "Maint: Uptime Checked":
        ev = uptimeEvidence(site, now);
        break;
      case "Test: Desktop Browsers":
        ev = browserEvidence(
          site.crossbrowserOk,
          site,
          now,
          "Desktop renders cleanly",
          "render errors",
        );
        break;
      case "Test: Mobile Browsers":
        ev = browserEvidence(site.mobileOk, site, now, "Mobile renders cleanly", "overflow/errors");
        break;
      case "Test: Page Titles & Meta":
        ev = titlesEvidence(site, now);
        break;
      case "Test: Links & Navigation": {
        const broken = site.brokenLinks;
        const failNote = broken && broken > 0 ? `${broken} broken link(s)` : "broken links / nav";
        ev = browserEvidence(site.linksOk, site, now, "All internal links resolve", failNote);
        break;
      }
      case "Test: Form Functionality":
        ev = formsEvidence(site, now);
        break;
      case "Test: Interactions & Animations":
        ev = interactionsEvidence(site, now);
        break;
      case "Test: Verified After Updates":
        ev = updatesEvidence(site, now);
        break;
      default:
        ev = null;
    }
    // The semantic inversion: a GATING item with no fresh signal must still carry a status —
    // `unknown` (blocks) — so an unwired/absent signal can never leave the gate silently
    // passable. Advisory items (e.g. Google Indexed on a Maintenance report) keep the old
    // omit-when-absent behavior.
    if (ev === null && gating.has(item.field)) {
      ev = { result: "unknown", checkedAt: null, note: "Not yet measured" };
    }
    if (ev !== null) out.set(item.field, ev);
  }

  return out;
}
```

- [ ] **Step 4: Run the auto-tick suite, confirm pass.** Run `cd /Users/tuckerlemos/Documents/GitHub/reddoor-maintenance && pnpm exec vitest run tests/reports/auto-tick.test.ts`. Expected: all pass (Task 2 value assertions + Task 3 inversion assertions + the fixed omit→unknown assertions). The existing Google/Domain/Security/browser pass/fail/stale tests still pass unchanged.

- [ ] **Step 5: Add a draft-persistence regression test (no `draft.ts` change needed — verify the wider map flows through).** `draftReportForSite` already does `autoEvidence = Object.fromEntries(evidence)` (draft.ts:206) and `createDraft` writes it when non-empty (reports.ts:235), so the wider evidence persists with no code change. Prove it in `tests/reports/reports-autoevidence.test.ts` by adding to the `describe("createDraft writes checklist booleans + auto-evidence", ...)` block:

```ts
it("persists an 'unknown' evidence record for an unmeasured gating item (the inversion)", async () => {
  const base = makeFakeBase({ Reports: [] });
  await createDraft(base, {
    reportId: "Acme Co — Maintenance — 2026-07-06",
    siteId: "rec_site",
    reportType: "Maintenance",
    periodStart: new Date("2026-07-01T00:00:00Z"),
    periodEnd: new Date("2026-07-06T00:00:00Z"),
    completedOn: new Date("2026-07-06T00:00:00Z"),
    lighthouse: { performance: 90, accessibility: 100, bestPractices: 82, seo: 100 },
    lastTestedDate: null,
    autoEvidence: {
      "Maint: Uptime Checked": { result: "unknown", checkedAt: null, note: "Not yet measured" },
    },
  });
  const create = base.__calls.find((c) => c.kind === "create")!;
  if (create.kind !== "create") throw new Error("expected create");
  const ev = JSON.parse(create.records[0]!.fields["Checklist auto-evidence"] as string);
  expect(ev["Maint: Uptime Checked"].result).toBe("unknown");
});
```

- [ ] **Step 6: Run the persistence test + full typecheck + lint.** Run `cd /Users/tuckerlemos/Documents/GitHub/reddoor-maintenance && pnpm exec vitest run tests/reports/reports-autoevidence.test.ts && pnpm typecheck && pnpm lint`. Expected: green (the 7 fns are now referenced, clearing the eslint unused warning).

- [ ] **Step 7: Commit.** Run `cd /Users/tuckerlemos/Documents/GitHub/reddoor-maintenance && git add -A && git commit -m "feat(reports): emit a status for every gating item in autoTickChecklist (health-gate phase 7)"`.

---

## Task 4: Add the gate predicates to `checklist.ts`

**Files:** Modify `src/reports/checklist.ts` · Test `tests/reports/checklist.test.ts`

- [ ] **Step 1: Write failing tests for `gatingFields`, `isHealthGateClear`, `gatingHealth`, `isSendOverridden`.** Append to `tests/reports/checklist.test.ts`. First extend the import on lines 3–9 to add the four new names, then add:

```ts
import {
  MAINTENANCE_CHECKLIST,
  TESTING_CHECKLIST,
  ALL_CHECKLIST_FIELDS,
  checklistFor,
  isChecklistComplete,
  gatingFields,
  isHealthGateClear,
  gatingHealth,
  isSendOverridden,
} from "../../src/reports/checklist.js";
import type { EvidenceRecord } from "../../src/reports/auto-tick.js";

const rec = (result: EvidenceRecord["result"]): EvidenceRecord => ({
  result,
  checkedAt: "2026-07-06T00:00:00.000Z",
  note: "",
});
/** Build an all-pass autoEvidence map for a report type's gating fields. */
const allPass = (type: "Maintenance" | "Testing"): Record<string, EvidenceRecord> =>
  Object.fromEntries(gatingFields(type).map((f) => [f, rec("pass")]));

describe("gatingFields", () => {
  it("gates Maintenance on the 5 availability items, EXCLUDING advisory Google Indexed", () => {
    expect(gatingFields("Maintenance")).toEqual([
      "Maint: Deploy & Function Health",
      "Maint: CMS Checked",
      "Maint: Domain, DNS & SSL",
      "Maint: Security Updates",
      "Maint: Uptime Checked",
    ]);
    expect(gatingFields("Maintenance")).not.toContain("Maint: Google Indexed");
  });
  it("gates Testing on all 13 fields (maintenance incl. Google Indexed + testing)", () => {
    expect(gatingFields("Testing")).toEqual(checklistFor("Testing").map((i) => i.field));
    expect(gatingFields("Testing")).toHaveLength(13);
    expect(gatingFields("Testing")).toContain("Maint: Google Indexed");
  });
  it("returns [] for Launch and Announcement (ungated)", () => {
    expect(gatingFields("Launch")).toEqual([]);
    expect(gatingFields("Announcement")).toEqual([]);
  });
});

describe("isHealthGateClear", () => {
  it("is vacuously true for Launch/Announcement", () => {
    expect(isHealthGateClear({ reportType: "Launch", autoEvidence: {} })).toBe(true);
    expect(isHealthGateClear({ reportType: "Announcement", autoEvidence: {} })).toBe(true);
  });
  it("is true for Maintenance when every gating field is pass", () => {
    expect(
      isHealthGateClear({ reportType: "Maintenance", autoEvidence: allPass("Maintenance") }),
    ).toBe(true);
  });
  it("treats n/a as clearing (a per-site not-applicable item never blocks)", () => {
    const ev = { ...allPass("Testing"), "Test: Form Functionality": rec("n/a") };
    expect(isHealthGateClear({ reportType: "Testing", autoEvidence: ev })).toBe(true);
  });
  it("blocks on a single 'fail' gating field", () => {
    const ev = { ...allPass("Maintenance"), "Maint: CMS Checked": rec("fail") };
    expect(isHealthGateClear({ reportType: "Maintenance", autoEvidence: ev })).toBe(false);
  });
  it("blocks on a single 'unknown' gating field", () => {
    const ev = { ...allPass("Maintenance"), "Maint: Uptime Checked": rec("unknown") };
    expect(isHealthGateClear({ reportType: "Maintenance", autoEvidence: ev })).toBe(false);
  });
  it("blocks on an ABSENT gating field (the inversion — no signal cannot clear)", () => {
    const ev = allPass("Maintenance");
    delete ev["Maint: Domain, DNS & SSL"];
    expect(isHealthGateClear({ reportType: "Maintenance", autoEvidence: ev })).toBe(false);
  });
  it("ignores a failing ADVISORY item on Maintenance (Google Indexed never blocks)", () => {
    const ev = { ...allPass("Maintenance"), "Maint: Google Indexed": rec("fail") };
    expect(isHealthGateClear({ reportType: "Maintenance", autoEvidence: ev })).toBe(true);
  });
});

describe("gatingHealth", () => {
  it("reports each gating field's status, defaulting an absent record to unknown", () => {
    const ev = { ...allPass("Maintenance"), "Maint: CMS Checked": rec("fail") };
    delete ev["Maint: Uptime Checked"];
    const health = gatingHealth({ reportType: "Maintenance", autoEvidence: ev });
    expect(health).toContainEqual({ field: "Maint: CMS Checked", status: "fail" });
    expect(health).toContainEqual({ field: "Maint: Uptime Checked", status: "unknown" });
  });
});

describe("isSendOverridden", () => {
  it("is true only when the flag is set AND the reason is non-empty", () => {
    expect(isSendOverridden({ sendOverride: true, overrideReason: "client asked" })).toBe(true);
    expect(isSendOverridden({ sendOverride: true, overrideReason: "   " })).toBe(false);
    expect(isSendOverridden({ sendOverride: true, overrideReason: null })).toBe(false);
    expect(isSendOverridden({ sendOverride: false, overrideReason: "x" })).toBe(false);
  });
});
```

- [ ] **Step 2: Run, confirm failure.** Run `cd /Users/tuckerlemos/Documents/GitHub/reddoor-maintenance && pnpm exec vitest run tests/reports/checklist.test.ts`. Expected failure: the four functions don't exist (import error / `TypeError: gatingFields is not a function`).

- [ ] **Step 3: Add the predicates to `checklist.ts`.** At the top of `src/reports/checklist.ts`, extend the imports:

```ts
import type { ReportType } from "./types.js";
import type { EvidenceResult, EvidenceRecord } from "./auto-tick.js";
```

Then append at the end of the file (after `isChecklistComplete`, which stays untouched):

```ts
/** The maintenance items whose HEALTH gates a Maintenance send. Google Indexed is advisory
 *  (reported, never blocks) so it is excluded. */
const MAINTENANCE_GATING_FIELDS: string[] = [
  "Maint: Deploy & Function Health",
  "Maint: CMS Checked",
  "Maint: Domain, DNS & SSL",
  "Maint: Security Updates",
  "Maint: Uptime Checked",
];

/**
 * The checklist fields whose health gates a send of this report type. Maintenance gates
 * availability/integrity only (Google Indexed is advisory); Testing holds the full bar (all 13,
 * including Google Indexed); Launch/Announcement are ungated. PURE.
 */
export function gatingFields(type: ReportType): string[] {
  if (type === "Maintenance") return MAINTENANCE_GATING_FIELDS;
  if (type === "Testing") return checklistFor("Testing").map((i) => i.field);
  return [];
}

/**
 * The health gate: clear iff EVERY gating field's evidence result is `pass` or `n/a`. A `fail`,
 * an `unknown`, or an ABSENT record all block — the semantic inversion (no fresh signal → cannot
 * confirm health → don't send). Launch/Announcement have no gating fields → vacuously clear. PURE.
 */
export function isHealthGateClear(report: {
  reportType: ReportType;
  autoEvidence: Record<string, EvidenceRecord>;
}): boolean {
  return gatingFields(report.reportType).every((field) => {
    const r = report.autoEvidence[field]?.result;
    return r === "pass" || r === "n/a";
  });
}

/** Per-gating-field status for by-name blocker messaging (send log, dashboard). An absent record
 *  surfaces as `unknown`. PURE. */
export function gatingHealth(report: {
  reportType: ReportType;
  autoEvidence: Record<string, EvidenceRecord>;
}): { field: string; status: EvidenceResult }[] {
  return gatingFields(report.reportType).map((field) => ({
    field,
    status: report.autoEvidence[field]?.result ?? "unknown",
  }));
}

/**
 * True when a logged send-anyway override is active AND carries a non-empty reason. The effective
 * send gate is `isHealthGateClear(report) || isSendOverridden(report)`. PURE — takes the minimal
 * structural shape so it can be evaluated over a ReportRow or a synthetic "about to override" copy.
 */
export function isSendOverridden(report: {
  sendOverride: boolean;
  overrideReason: string | null;
}): boolean {
  return report.sendOverride && (report.overrideReason ?? "").trim() !== "";
}
```

- [ ] **Step 4: Run the checklist suite, confirm pass.** Run `cd /Users/tuckerlemos/Documents/GitHub/reddoor-maintenance && pnpm exec vitest run tests/reports/checklist.test.ts`. Expected: all pass, including the untouched `isChecklistComplete` and the label-mirror guardrails (which must stay green — they are the client-email tripwire).

- [ ] **Step 5: Verify no import cycle at runtime + typecheck.** Run `cd /Users/tuckerlemos/Documents/GitHub/reddoor-maintenance && pnpm typecheck && pnpm exec vitest run tests/reports/auto-tick.test.ts`. Expected: clean (the `checklist.ts ↔ auto-tick.ts` relationship is value-import one way + `import type` the other, so there is no runtime cycle).

- [ ] **Step 6: Commit.** Run `cd /Users/tuckerlemos/Documents/GitHub/reddoor-maintenance && git add -A && git commit -m "feat(reports): add gatingFields/isHealthGateClear/gatingHealth/isSendOverridden (health-gate phase 8)"`.

---

## Task 5: Fold health blockers into `approveBlockers`

**Files:** Modify `src/reports/preflight.ts:399-465` · Test `tests/reports/preflight.test.ts`

- [ ] **Step 1: Write failing tests for `healthBlockers` + the `approveBlockers` fold.** Append to `tests/reports/preflight.test.ts` (it already has a `makeReportRow` factory at line 13 and imports `approveBlockers`). Add `healthBlockers` to the preflight import and add:

```ts
import { healthBlockers } from "../../src/reports/preflight.js";

const passEv = { result: "pass" as const, checkedAt: "2026-07-06T00:00:00.000Z", note: "" };
const failEv = { result: "fail" as const, checkedAt: "2026-07-06T00:00:00.000Z", note: "down" };

describe("healthBlockers", () => {
  it("returns [] when every gating field is pass (Maintenance)", () => {
    const autoEvidence = Object.fromEntries(
      [
        "Maint: Deploy & Function Health",
        "Maint: CMS Checked",
        "Maint: Domain, DNS & SSL",
        "Maint: Security Updates",
        "Maint: Uptime Checked",
      ].map((f) => [f, passEv]),
    );
    expect(healthBlockers(makeReportRow({ reportType: "Maintenance", autoEvidence }))).toEqual([]);
  });
  it("emits a fail finding for a failing gating field and for an absent one", () => {
    const autoEvidence = { "Maint: CMS Checked": failEv };
    const findings = healthBlockers(makeReportRow({ reportType: "Maintenance", autoEvidence }));
    expect(findings.every((f) => f.level === "fail" && f.check === "health-gate")).toBe(true);
    expect(findings.some((f) => f.message.includes("Maint: CMS Checked"))).toBe(true);
    // Uptime is absent → unknown → blocks too.
    expect(findings.some((f) => f.message.includes("Maint: Uptime Checked"))).toBe(true);
  });
});

describe("approveBlockers folds in health-gate findings", () => {
  it("adds a health-gate fail when a gating item is not green (recipients/header/scores clean)", () => {
    const site = makeWebsiteRow({
      reportRecipientsTo: "client@acme.com",
      headerImage: { url: "u", filename: "h.png", type: "image/png" },
    });
    const report = makeReportRow({
      reportType: "Maintenance",
      lighthouse: { performance: 90, accessibility: 90, bestPractices: 90, seo: 90 },
      autoEvidence: { "Maint: CMS Checked": failEv },
    });
    const findings = approveBlockers(site, report);
    expect(findings.some((f) => f.check === "health-gate")).toBe(true);
  });
});
```

(Confirm `makeReportRow` in this file already accepts `autoEvidence`/`reportType` overrides; it builds a full `ReportRow`, so those fields are present.)

- [ ] **Step 2: Run, confirm failure.** Run `cd /Users/tuckerlemos/Documents/GitHub/reddoor-maintenance && pnpm exec vitest run tests/reports/preflight.test.ts`. Expected failure: `healthBlockers` is not exported (import error).

- [ ] **Step 3: Add `healthBlockers` and fold it into `approveBlockers`.** In `src/reports/preflight.ts`, add to the imports near the top:

```ts
import { gatingHealth } from "./checklist.js";
```

Add this exported function immediately before `approveBlockers`:

```ts
/**
 * Health-gate blockers for one report: every GATING field whose evidence is not `pass`/`n/a`
 * (i.e. `fail`, `unknown`, or absent) becomes a fail-level finding, keyed `health-gate`. PURE.
 * Folded into {@link approveBlockers} so health failures ride the existing send-blocked reason +
 * 409 + dashboard chip (the second gate — no third gate is added).
 *
 * NOTE: override suppression is added in Phase 10 (a guard at the top of this function). Until
 * then a health-red report always blocks approve/send.
 */
export function healthBlockers(report: ReportRow): PreflightFinding[] {
  const findings: PreflightFinding[] = [];
  for (const { field, status } of gatingHealth({
    reportType: report.reportType,
    autoEvidence: report.autoEvidence ?? {},
  })) {
    if (status === "pass" || status === "n/a") continue;
    const note = report.autoEvidence?.[field]?.note ?? "no signal yet";
    findings.push({
      level: "fail",
      check: "health-gate",
      message:
        status === "fail"
          ? `${field}: failing — ${note}`
          : `${field}: not yet green (${status}) — ${note}`,
    });
  }
  return findings;
}
```

Then, inside `approveBlockers`, immediately before its final `return findings;`, append:

```ts
findings.push(...healthBlockers(report));
```

- [ ] **Step 4: Run, confirm pass.** Run `cd /Users/tuckerlemos/Documents/GitHub/reddoor-maintenance && pnpm exec vitest run tests/reports/preflight.test.ts`. Expected: all pass. Confirm `pnpm exec node scripts/smoke-dist.mjs` is NOT needed here (preflight is not in the audit graph); typecheck instead: `pnpm typecheck`.

- [ ] **Step 5: Commit.** Run `cd /Users/tuckerlemos/Documents/GitHub/reddoor-maintenance && git add -A && git commit -m "feat(reports): fold healthBlockers into approveBlockers (health-gate phase 8)"`.

---

## Task 6: Swap the three enforcement sites off `isChecklistComplete`

**Files:** Modify `src/dashboard/approve.ts:57-58` · Modify `src/dashboard/checklist.ts:42` · Modify `src/dashboard/render.ts:129` · Modify `src/reports/send/orchestrate.ts:117-123` · Tests `tests/dashboard/approve.test.ts`, `tests/dashboard/checklist.test.ts`, `tests/reports/send/orchestrate.test.ts`

- [ ] **Step 1: Update the approve-front-door tests (checklist branch retired).** In `tests/dashboard/approve.test.ts`, the two tests asserting `reason: "checklist-incomplete"` (≈ lines 114 and 192) must change: the checklist branch is gone; health failures now arrive as send-blockers. Replace those tests with:

```ts
it("blocks (send-blocked) when the injected sendBlockers reports a health-gate failure", async () => {
  const d = deps({
    sendBlockers: vi.fn().mockResolvedValue(["health-gate: Maint: CMS Checked: failing — down"]),
  });
  const res = await approveReport(d, "recREP1");
  expect(res).toMatchObject({ status: "blocked", reason: "send-blocked" });
  expect((res as { blockers: string[] }).blockers[0]).toContain("Maint: CMS Checked");
  expect(d.approveReportRow).not.toHaveBeenCalled();
});

it("approves a report whose sendBlockers is empty (health gate clear)", async () => {
  const d = deps();
  const res = await approveReport(d, "recREP1");
  expect(res).toEqual({ status: "approved", reportId: "recREP1" });
});
```

- [ ] **Step 2: Update the dashboard live-re-gate tests to drive `complete` off `autoEvidence`.** In `tests/dashboard/checklist.test.ts`, the `complete` field now reflects `isHealthGateClear`, not the boolean checklist. Add an `autoEvidence` helper and rewrite the completeness assertions. Add near the top:

```ts
import type { EvidenceRecord } from "../../src/reports/auto-tick.js";
const pass = (): EvidenceRecord => ({
  result: "pass",
  checkedAt: "2026-07-06T00:00:00.000Z",
  note: "",
});
const maintAllPass = (): Record<string, EvidenceRecord> =>
  Object.fromEntries(
    [
      "Maint: Deploy & Function Health",
      "Maint: CMS Checked",
      "Maint: Domain, DNS & SSL",
      "Maint: Security Updates",
      "Maint: Uptime Checked",
    ].map((f) => [f, pass()]),
  );
```

Replace the two `complete`-value tests ("writes a known field and reports complete=false while other items are still unchecked" and "reports complete=true when the flip completes the set") with health-driven versions:

```ts
it("reports complete=false when the health gate is not clear (a gating item is unmeasured)", async () => {
  const d = deps({
    getReportById: vi
      .fn()
      .mockResolvedValue(reportRow({ reportType: "Maintenance", autoEvidence: {} })),
  });
  const r = await setChecklistItem(d, "recREP1", "Maint: Deploy & Function Health", true);
  expect(r).toMatchObject({ status: "ok", complete: false });
  // The box is still written (advisory record) even though it no longer drives the gate.
  expect(d.setReportChecklistItem).toHaveBeenCalledWith(
    "recREP1",
    "Maint: Deploy & Function Health",
    true,
  );
});

it("reports complete=true when every gating item's evidence is pass", async () => {
  const d = deps({
    getReportById: vi
      .fn()
      .mockResolvedValue(reportRow({ reportType: "Maintenance", autoEvidence: maintAllPass() })),
  });
  const r = await setChecklistItem(d, "recREP1", "Maint: Security Updates", true);
  expect(r).toMatchObject({ status: "ok", complete: true });
});
```

Delete (or similarly convert) the three remaining boolean-completeness tests ("reports complete=false after un-checking …", "completes a Testing report only when all 13 …", "a Testing report is NOT complete on the testing items alone …") — they assert the retired boolean semantics. Convert the two Testing ones to `autoEvidence`-driven: all-13-pass → `complete: true`; missing-one → `complete: false`. Keep the `bad-field` and `not-found` tests unchanged.

- [ ] **Step 3: Update the orchestrate send-gate fixture + tests.** In `tests/reports/send/orchestrate.test.ts`, the default Maintenance `reportRow` fixture (lines 43–70) sets the 6 boolean cells but no evidence; the gate now reads `autoEvidence`. Add a `Checklist auto-evidence` field to the default fixture so the many non-gate send tests keep passing. Insert into the fixture `fields` object (after the 6 `"Maint: …": true` lines):

```ts
      "Checklist auto-evidence": JSON.stringify({
        "Maint: Deploy & Function Health": { result: "pass", checkedAt: "2026-05-26T00:00:00.000Z", note: "" },
        "Maint: CMS Checked": { result: "pass", checkedAt: "2026-05-26T00:00:00.000Z", note: "" },
        "Maint: Domain, DNS & SSL": { result: "pass", checkedAt: "2026-05-26T00:00:00.000Z", note: "" },
        "Maint: Security Updates": { result: "pass", checkedAt: "2026-05-26T00:00:00.000Z", note: "" },
        "Maint: Uptime Checked": { result: "pass", checkedAt: "2026-05-26T00:00:00.000Z", note: "" },
      }),
```

Then add a new gate test near the existing Launch test (≈ line 369):

```ts
it("does NOT send a Maintenance report whose health gate is not clear, with a by-name message", async () => {
  const base = makeFakeBase({
    Reports: [
      reportRow({
        "Checklist auto-evidence": JSON.stringify({
          "Maint: Deploy & Function Health": {
            result: "pass",
            checkedAt: "2026-05-26T00:00:00.000Z",
            note: "",
          },
          "Maint: CMS Checked": {
            result: "fail",
            checkedAt: "2026-05-26T00:00:00.000Z",
            note: "Prismic unreachable",
          },
          "Maint: Domain, DNS & SSL": {
            result: "pass",
            checkedAt: "2026-05-26T00:00:00.000Z",
            note: "",
          },
          "Maint: Security Updates": {
            result: "pass",
            checkedAt: "2026-05-26T00:00:00.000Z",
            note: "",
          },
          "Maint: Uptime Checked": {
            result: "pass",
            checkedAt: "2026-05-26T00:00:00.000Z",
            note: "",
          },
        }),
      }),
    ],
    Websites: [siteRow()],
  });
  vi.mocked(openBase).mockReturnValue(base);
  const { client, captured } = captureClient();
  const res = await sendApprovedReports({ resend: client });
  expect(res.code).toBe(1);
  expect(captured).toHaveLength(0);
  expect(res.output).toContain("Maint: CMS Checked");
});
```

Update the comment on the existing Launch test (≈ line 370–371) from "isChecklistComplete is vacuously true" to "gatingFields(Launch) is [] so isHealthGateClear is vacuously true".

- [ ] **Step 4: Run all three suites, confirm they FAIL against the current source.** Run `cd /Users/tuckerlemos/Documents/GitHub/reddoor-maintenance && pnpm exec vitest run tests/dashboard/approve.test.ts tests/dashboard/checklist.test.ts tests/reports/send/orchestrate.test.ts`. Expected failure: the enforcement sites still call `isChecklistComplete` (approve returns the wrong result, orchestrate sends the health-red report, `complete` reflects booleans).

- [ ] **Step 5: Swap `approve.ts`.** In `src/dashboard/approve.ts`: remove the `import { isChecklistComplete } ...` line. Narrow the blocked reason union to drop `"checklist-incomplete"`:

```ts
  | {
      status: "blocked";
      reportId: string;
      reason: "send-blocked";
      /** Human-readable blockers ("check: message"). */
      blockers?: string[];
    }
```

Delete the checklist branch (the two lines at 57–58: the `if (!isChecklistComplete(report)) return ...`). The `sendBlockers` gate (now including `healthBlockers`) at lines 62–63 is the enforcement; leave it. (The `overridden`/`override-reason-required` branches come in Task 10.)

- [ ] **Step 6: Swap `dashboard/checklist.ts`.** In `src/dashboard/checklist.ts`: change the import to `import { ALL_CHECKLIST_FIELDS, isHealthGateClear } from "../reports/checklist.js";` and replace the `complete` computation (lines 42–45) with:

```ts
// The gate now reads HEALTH evidence, not the manual booleans — ticking a box is retired from
// the gating path (the box is still written for the operator's record). `complete` mirrors the
// send/approve gate so the Approve button re-enables exactly when the site is green.
const complete = isHealthGateClear({
  reportType: report.reportType,
  autoEvidence: report.autoEvidence ?? {},
});
```

- [ ] **Step 7: Swap `render.ts` `approveButton`.** In `src/dashboard/render.ts`, change the import on line 11 to `import { checklistFor, isHealthGateClear, gatingFields } from "../reports/checklist.js";` (drop `isChecklistComplete`; `gatingFields` is used by Task 7's `checklistBlock`). Replace `approveButton`'s disabled computation (line 129):

```ts
const gateClear = isHealthGateClear({
  reportType: r.reportType,
  autoEvidence: r.autoEvidence ?? {},
});
const disabled = gateClear && !blocked ? "" : " disabled";
```

- [ ] **Step 8: Swap the `sendOne` backstop in `orchestrate.ts`.** In `src/reports/send/orchestrate.ts`, change the checklist import on line 14 to `import { gatingHealth, isHealthGateClear } from "../checklist.js";` (drop `checklistFor`/`isChecklistComplete`). Replace the checklist gate block (lines 117–123) with:

```ts
// Hard health gate: a Maintenance/Testing report whose gating evidence isn't all pass/n/a must
// never go out — even if "Approved to send" was set directly in Airtable. Throw so the row is
// skipped and `Sent at` stays null (at-least-once retry preserved). Launch/Announcement have no
// gating fields → vacuously clear. (Override honoring is added in Phase 10.)
const gateReport = { reportType: report.reportType, autoEvidence: report.autoEvidence ?? {} };
if (!isHealthGateClear(gateReport)) {
  const failing = gatingHealth(gateReport)
    .filter((h) => h.status !== "pass" && h.status !== "n/a")
    .map((h) => {
      const note = report.autoEvidence?.[h.field]?.note;
      return `${h.field} (${h.status}${note ? `: ${note}` : ""})`;
    })
    .join("; ");
  throw new Error(`Report ${report.reportId} health gate not clear — ${failing}`);
}
```

- [ ] **Step 9: Run all three suites + typecheck + dist-smoke, confirm pass.** Run `cd /Users/tuckerlemos/Documents/GitHub/reddoor-maintenance && pnpm exec vitest run tests/dashboard/approve.test.ts tests/dashboard/checklist.test.ts tests/reports/send/orchestrate.test.ts && pnpm typecheck && pnpm build && pnpm test:dist`. Expected: all pass; `test:dist` stays green (no new central-only import reached the audit graph — `checklist.ts` is pure).

- [ ] **Step 10: Commit.** Run `cd /Users/tuckerlemos/Documents/GitHub/reddoor-maintenance && git add -A && git commit -m "feat(reports): flip approve/send/dashboard gates to the health predicate (health-gate phase 8)"`.

---

## Task 7: Reframe `checklistBlock` into Tier-colored per-check health (cockpit)

**Files:** Modify `src/dashboard/render.ts:100-121` (+ CSS + dead script) · Test `tests/dashboard/render.test.ts`

- [ ] **Step 1: Update the render tests that asserted checkboxes to assert health pills.** In `tests/dashboard/render.test.ts`, the checklist tests (≈ lines 810–842) assert `<input type="checkbox" class="checklist-checkbox">` and the disabled Approve. Rewrite them for the reframed block. Replace with:

```ts
it("renders a Tier-colored health pill per check for a pending Maintenance report", () => {
  const autoEvidence = {
    "Maint: Deploy & Function Health": {
      result: "pass",
      checkedAt: "2026-05-01T00:00:00Z",
      note: "ok",
    },
    "Maint: CMS Checked": {
      result: "fail",
      checkedAt: "2026-05-01T00:00:00Z",
      note: "Prismic unreachable",
    },
    "Maint: Uptime Checked": { result: "unknown", checkedAt: null, note: "Not yet measured" },
  };
  const html = renderSiteDashboardHtml(site(), [
    reportRow({ id: "recREP1", approvedToSend: false, sentAt: null, autoEvidence }),
  ]);
  expect(html).toContain('data-checklist-for="recREP1"');
  expect(html).toMatch(/pill healthy/); // pass → green
  expect(html).toMatch(/pill attention/); // fail → red
  expect(html).toMatch(/pill watch/); // unknown → amber
  // A health-red report keeps its Approve button disabled (server gate).
  expect(html).toMatch(/<button class="approve"[^>]*data-report-id="recREP1"[^>]*disabled/);
});

it("annotates an advisory item (Google Indexed on Maintenance) as never-blocking", () => {
  const autoEvidence = {
    "Maint: Google Indexed": {
      result: "fail",
      checkedAt: "2026-05-01T00:00:00Z",
      note: "Not on page 1",
    },
  };
  const html = renderSiteDashboardHtml(site(), [
    reportRow({ id: "recREP1", approvedToSend: false, sentAt: null, autoEvidence }),
  ]);
  expect(html).toContain("advisory — never blocks");
});
```

(Adjust the fixture accessor names — `site()`/`reportRow()` — to whatever this file already defines; it has a `reportRow` factory at line 33 that already accepts `autoEvidence`.) Remove any remaining assertion referencing `checklist-checkbox` or `/api/reports/recREP1/checklist`.

- [ ] **Step 2: Run, confirm failure.** Run `cd /Users/tuckerlemos/Documents/GitHub/reddoor-maintenance && pnpm exec vitest run tests/dashboard/render.test.ts`. Expected failure: the current `checklistBlock` renders checkboxes + `auto-badge`, so `pill healthy/attention/watch` and `advisory — never blocks` are absent.

- [ ] **Step 3: Reframe `checklistBlock` + add `healthPresentation`.** In `src/dashboard/render.ts`, replace `checklistBlock` (lines 100–121) with:

```ts
/** Map an evidence result onto the existing site-Tier bands (green/amber/red) — pass→healthy,
 *  fail→attention, unknown/absent→watch; `n/a` is a muted, non-blocking annotation. No 4th scale. */
function healthPresentation(status: EvidenceResult): { cls: string; word: string } {
  switch (status) {
    case "pass":
      return { cls: "healthy", word: "clear" };
    case "fail":
      return { cls: "attention", word: "blocks" };
    case "n/a":
      return { cls: "na", word: "n/a" };
    default:
      return { cls: "watch", word: "needs you" }; // unknown / absent
  }
}

/** The per-report health panel: one Tier-colored pill per `checklistFor(reportType)` item, driven
 *  by `report.autoEvidence` (absent → unknown/amber). Advisory items (in the checklist but not
 *  `gatingFields`) render their color but are annotated "advisory — never blocks". Launch/
 *  Announcement (empty checklist) render NOTHING — never gated. No manual checkboxes: ticking is
 *  retired from the gating path. */
function checklistBlock(r: ReportRow): string {
  const items = checklistFor(r.reportType);
  if (items.length === 0) return "";
  const gating = new Set(gatingFields(r.reportType));
  const rid = escapeHtml(r.id);
  const rows = items
    .map((item) => {
      const ev = r.autoEvidence?.[item.field];
      const status: EvidenceResult = ev?.result ?? "unknown";
      const { cls, word } = healthPresentation(status);
      const advisory = gating.has(item.field)
        ? ""
        : ` <span class="advisory">advisory — never blocks</span>`;
      const note = ev?.note ? ` <span class="check-note">${escapeHtml(ev.note)}</span>` : "";
      return `<li class="check-item"><span class="pill ${cls}" title="${escapeHtml(ev?.note ?? "not yet measured")}">${word}</span> ${escapeHtml(item.label)}${advisory}${note}</li>`;
    })
    .join("");
  return `<ul class="checklist" data-checklist-for="${rid}">${rows}</ul>`;
}
```

Add the `EvidenceResult` type import at the top of `render.ts` (with the other imports):

```ts
import type { EvidenceResult } from "../reports/auto-tick.js";
```

- [ ] **Step 4: Align the CSS (reuse the existing Tier hexes — no new tokens).** In `render.ts`'s `STYLES` string, replace the `.checklist`/`.check-item`/`.auto-badge`/`.auto-pass`/`.auto-amber` block (≈ lines 431–436) with:

```css
.checklist {
  list-style: none;
  padding: 0;
  margin: 0.5rem 0 0.25rem 0.25rem;
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}
.check-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.9rem;
}
.pill.healthy {
  background: #e8f5e9;
  color: #1b7a2f;
}
.pill.watch {
  background: #fff4e5;
  color: #a65a00;
}
.pill.attention {
  background: #fdecea;
  color: #b00;
}
.pill.na {
  background: #f0f0f0;
  color: #666;
}
.advisory {
  font-size: 0.72rem;
  color: #999;
  font-style: italic;
}
.check-note {
  font-size: 0.75rem;
  color: #999;
}
@media (prefers-color-scheme: dark) {
  .pill.healthy {
    background: #10240f;
    color: #7fce85;
  }
  .pill.watch {
    background: #2a2410;
    color: #ffd454;
  }
  .pill.attention {
    background: #2a0f0d;
    color: #ff8a80;
  }
  .pill.na {
    background: #222;
    color: #999;
  }
}
```

(The `.pill` base rule at ≈ line 437 already sets padding/border-radius/weight; these add the Tier backgrounds mirroring `fleet-render.ts:65-67`.)

- [ ] **Step 5: Remove the now-dead checklist-checkbox script.** In `render.ts`'s inline `<script>` (the block starting `document.querySelectorAll("input.checklist-checkbox")`, ≈ lines 625–648), delete that whole `forEach` — there are no checkboxes to bind. Leave the approve-button, trigger-renovate, and site-details scripts intact.

- [ ] **Step 6: Run render tests + full typecheck, confirm pass.** Run `cd /Users/tuckerlemos/Documents/GitHub/reddoor-maintenance && pnpm exec vitest run tests/dashboard/render.test.ts && pnpm typecheck`. Expected: all pass. If any other render test referenced `auto-badge`/`checklist-checkbox`, update it to the pill markup.

- [ ] **Step 7: Commit.** Run `cd /Users/tuckerlemos/Documents/GitHub/reddoor-maintenance && git add -A && git commit -m "feat(dashboard): reframe checklistBlock into Tier-colored per-check health (health-gate phase 9)"`.

---

## Task 8: Add the override fields to `ReportRow` + `mapRow` + raw writer

**Files:** Modify `src/reports/airtable/reports.ts` · Tests `tests/reports/reports-autoevidence.test.ts` (mapRow) + the inline `ReportRow` factories across the suite

- [ ] **Step 1: Write a failing `mapRow` test for the 4 override fields.** In `tests/reports/reports-autoevidence.test.ts` add (using the existing `getReportById` path, or add a focused test hitting `mapRow` via `createDraft`'s return). Simplest: assert defaults through `createDraft`'s returned `ReportRow`:

```ts
describe("ReportRow carries the override audit fields", () => {
  it("defaults sendOverride=false and the reason/by/at to null on a fresh draft", async () => {
    const base = makeFakeBase({ Reports: [] });
    const row = await createDraft(base, {
      reportId: "Acme Co — Maintenance — 2026-07-06",
      siteId: "rec_site",
      reportType: "Maintenance",
      periodStart: new Date("2026-07-01T00:00:00Z"),
      periodEnd: new Date("2026-07-06T00:00:00Z"),
      completedOn: new Date("2026-07-06T00:00:00Z"),
      lighthouse: { performance: 90, accessibility: 100, bestPractices: 82, seo: 100 },
      lastTestedDate: null,
    });
    expect(row.sendOverride).toBe(false);
    expect(row.overrideReason).toBeNull();
    expect(row.overrideBy).toBeNull();
    expect(row.overrideAt).toBeNull();
  });
});
```

- [ ] **Step 2: Run, confirm failure.** Run `cd /Users/tuckerlemos/Documents/GitHub/reddoor-maintenance && pnpm exec vitest run tests/reports/reports-autoevidence.test.ts`. Expected failure: `row.sendOverride` is `undefined` (property doesn't exist) — and `tsc` would reject the access, so this fails at compile/run.

- [ ] **Step 3: Add the fields to the `ReportRow` type.** In `src/reports/airtable/reports.ts`, in the `ReportRow` type (after `autoEvidence`, before the closing `}` at line 61), add:

```ts
/** Logged send-anyway override (Phase 10). When `sendOverride` is true AND `overrideReason` is
 *  non-empty, the health gate is bypassed for THIS report; `overrideBy`/`overrideAt` are the
 *  audit trail (parallel to approvedBy/approvedAt). Missing cells read false/null. */
sendOverride: boolean;
overrideReason: string | null;
overrideBy: string | null;
overrideAt: string | null;
```

- [ ] **Step 4: Read them in `mapRow`.** In `mapRow` (after the `autoEvidence:` line at 105), add:

```ts
    sendOverride: Boolean(f["Send override"]),
    overrideReason: (f["Override reason"] as string | undefined) ?? null,
    overrideBy: (f["Override by"] as string | undefined) ?? null,
    overrideAt: (f["Override at"] as string | undefined) ?? null,
```

- [ ] **Step 5: Add the `overrideReportRow` raw writer.** In `src/reports/airtable/reports.ts`, after `approveReportRow` (line 383), add:

```ts
/**
 * Stamp a logged send-anyway override on a Reports row: sets `Send override` TRUE, the reason, and
 * who/when — AND flips `Approved to send` TRUE (with the same Approved At/By stamp) so the daily
 * cron delivers the overridden report. Mirrors {@link approveReportRow}; never touches `Sent at`.
 */
export async function overrideReportRow(
  base: AirtableBase,
  recordId: string,
  overrideAt: Date,
  overrideBy: string,
  reason: string,
): Promise<void> {
  const at = overrideAt.toISOString();
  await base(REPORTS_TABLE).update([
    {
      id: recordId,
      fields: {
        "Send override": true,
        "Override reason": reason,
        "Override by": overrideBy,
        "Override at": at,
        "Approved to send": true,
        "Approved At": at,
        "Approved By": overrideBy,
      },
    },
  ]);
}
```

- [ ] **Step 6: Update every inline `ReportRow` factory across the suite (typecheck will otherwise fail).** Adding 4 required fields breaks each test that builds a full `ReportRow` literal. In each of these files, find the `function reportRow`/`function report`/`function makeReportRow`/`const draft` factory that returns a full `ReportRow` and add these 4 lines to the returned object (before `...over`):

```ts
    sendOverride: false,
    overrideReason: null,
    overrideBy: null,
    overrideAt: null,
```

Files: `tests/dashboard/approve.test.ts`, `tests/dashboard/checklist.test.ts`, `tests/dashboard/render.test.ts`, `tests/dashboard/fleet-cockpit.test.ts`, `tests/dashboard/fleet-render.test.ts`, `tests/reports/preflight.test.ts`, `tests/reports/due.test.ts`, `tests/alerts/digest-collectors.test.ts`. (The `orchestrate.test.ts` and `resend-webhook.test.ts` fixtures build **Airtable `FakeRecord` fields** that flow through `mapRow`, so they need NO literal change — `mapRow` supplies the defaults.) Verify by grepping: `cd /Users/tuckerlemos/Documents/GitHub/reddoor-maintenance && grep -rln "autoEvidence: null\|autoEvidence:null" tests/`.

- [ ] **Step 7: Run the mapRow test + full typecheck, confirm pass.** Run `cd /Users/tuckerlemos/Documents/GitHub/reddoor-maintenance && pnpm exec vitest run tests/reports/reports-autoevidence.test.ts && pnpm typecheck`. Expected: green (every `ReportRow` literal now type-checks).

- [ ] **Step 8: Commit.** Run `cd /Users/tuckerlemos/Documents/GitHub/reddoor-maintenance && git add -A && git commit -m "feat(reports): add sendOverride/overrideReason/overrideBy/overrideAt to ReportRow + overrideReportRow (health-gate phase 10)"`.

---

## Task 9: Register the `report_sent_with_override` fleet event type

**Files:** Modify `src/db/fleet-events.ts:5-11` · Modify `src/dashboard/fleet-render.ts:211-218` · Tests `tests/dashboard/fleet-render.test.ts` (or a focused fleet-events test)

- [ ] **Step 1: Write a failing test asserting the event type renders a "Recently" icon.** In `tests/dashboard/fleet-render.test.ts`, add (adapt to the file's existing model builder):

```ts
it("renders a Recently row for a report_sent_with_override event", () => {
  const model = baseModel({
    recent: [
      {
        type: "report_sent_with_override",
        summary: "sent with override — client asked",
        siteName: "Acme Co",
        slug: "acme-co",
        url: null,
        ts: "2026-07-06T09:30:00.000Z",
      },
    ],
  });
  const html = renderCockpitHtml(model);
  expect(html).toContain("sent with override");
});
```

(If `fleet-render.test.ts` has no `baseModel` helper, add the event to whatever `CockpitModel` fixture it already renders. The point is to force `RECENT_ICON` to have the key.)

- [ ] **Step 2: Run, confirm failure.** Run `cd /Users/tuckerlemos/Documents/GitHub/reddoor-maintenance && pnpm exec vitest run tests/dashboard/fleet-render.test.ts` and `pnpm typecheck`. Expected failure: `"report_sent_with_override"` is not assignable to `FleetEventType`, and `RECENT_ICON` (an exhaustive `Record<FleetEventType, string>`) both reject it — typecheck fails.

- [ ] **Step 3: Add the union member.** In `src/db/fleet-events.ts`, extend `FleetEventType`:

```ts
export type FleetEventType =
  | "pr_automerged"
  | "vuln_cleared"
  | "ci_recovered"
  | "site_launched"
  | "fleet_swept"
  | "cert_renewed"
  | "report_sent_with_override";
```

- [ ] **Step 4: Add the `RECENT_ICON` entry (the exhaustive map now demands it).** In `src/dashboard/fleet-render.ts`, add to `RECENT_ICON`:

```ts
  report_sent_with_override: "✳️",
```

- [ ] **Step 5: Run the test + typecheck, confirm pass.** Run `cd /Users/tuckerlemos/Documents/GitHub/reddoor-maintenance && pnpm exec vitest run tests/dashboard/fleet-render.test.ts && pnpm typecheck`. Expected: green.

- [ ] **Step 6: Commit.** Run `cd /Users/tuckerlemos/Documents/GitHub/reddoor-maintenance && git add -A && git commit -m "feat(fleet): register report_sent_with_override event type + icon (health-gate phase 10)"`.

---

## Task 10: The `"overridden"` approve branch + endpoint param

**Files:** Modify `src/dashboard/approve.ts` · Modify `src/reports/preflight.ts` (override suppression) · Modify `netlify/functions/approve-report.mts` · Test `tests/dashboard/approve.test.ts`

- [ ] **Step 1: Write failing tests for the override branch.** In `tests/dashboard/approve.test.ts`, extend the `deps` helper to include `overrideReport` and add tests:

```ts
// In the deps() factory add:
//   overrideReport: vi.fn().mockResolvedValue(undefined),

describe("approveReport — logged override", () => {
  it("rejects an empty reason as override-reason-required (no write)", async () => {
    const d = deps();
    const res = await approveReport(d, "recREP1", { reason: "   " });
    expect(res).toEqual({
      status: "blocked",
      reportId: "recREP1",
      reason: "override-reason-required",
    });
    expect(d.overrideReport).not.toHaveBeenCalled();
    expect(d.approveReportRow).not.toHaveBeenCalled();
  });

  it("overrides a health-blocked report with a reason: stamps who/when/reason and returns overridden", async () => {
    // sendBlockers returns health blockers for the plain report but NONE for the synthetic
    // overridden copy (healthBlockers self-suppress on isSendOverridden).
    const d = deps({
      sendBlockers: vi.fn(async (r) =>
        r.sendOverride ? [] : ["health-gate: Maint: CMS Checked: failing — down"],
      ),
    });
    const res = await approveReport(d, "recREP1", { reason: "client verbally signed off" });
    expect(res).toEqual({
      status: "overridden",
      reportId: "recREP1",
      reason: "client verbally signed off",
    });
    expect(d.overrideReport).toHaveBeenCalledWith(
      "recREP1",
      new Date("2026-06-11T15:30:00.000Z"),
      "dashboard",
      "client verbally signed off",
    );
  });

  it("still blocks an override when a REAL send blocker (missing header) remains", async () => {
    const d = deps({
      sendBlockers: vi.fn().mockResolvedValue(["header-image-missing: no Header image"]),
    });
    const res = await approveReport(d, "recREP1", { reason: "ship it" });
    expect(res).toMatchObject({ status: "blocked", reason: "send-blocked" });
    expect(d.overrideReport).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run, confirm failure.** Run `cd /Users/tuckerlemos/Documents/GitHub/reddoor-maintenance && pnpm exec vitest run tests/dashboard/approve.test.ts`. Expected failure: `approveReport` takes no `override` arg and `ApproveDeps` has no `overrideReport` (typecheck + runtime failure).

- [ ] **Step 3: Add override suppression to `healthBlockers` (preflight.ts).** In `src/reports/preflight.ts`, add the guard at the very top of `healthBlockers` and import `isSendOverridden`:

```ts
import { gatingHealth, isSendOverridden } from "./checklist.js";
```

```ts
export function healthBlockers(report: ReportRow): PreflightFinding[] {
  // A logged send-anyway override suppresses the health-gate findings (but never the real send
  // blockers — recipients/header/scores — which are computed outside this function).
  if (isSendOverridden(report)) return [];
  const findings: PreflightFinding[] = [];
  // ...unchanged...
```

- [ ] **Step 4: Add the `"overridden"` + `"override-reason-required"` branches to `approve.ts`.** In `src/dashboard/approve.ts`: extend `ApproveResult` and `ApproveDeps`, and add the `override?` argument. Full new union + deps + the override branch:

```ts
export type ApproveResult =
  | { status: "approved"; reportId: string }
  | { status: "overridden"; reportId: string; reason: string }
  | {
      status: "noop";
      reportId: string;
      reason: "already-approved" | "already-sent" | "not-draft-ready";
    }
  | {
      status: "blocked";
      reportId: string;
      reason: "send-blocked" | "override-reason-required";
      blockers?: string[];
    }
  | { status: "not-found"; reportId: string };

export type ApproveDeps = {
  getReportById: (id: string) => Promise<ReportRow | null>;
  approveReportRow: (id: string, approvedAt: Date, approvedBy: string) => Promise<void>;
  /** Raw writer for the logged override: stamps Send override + reason/by/at + Approved to send. */
  overrideReport: (id: string, at: Date, by: string, reason: string) => Promise<void>;
  now: () => Date;
  sendBlockers: (report: ReportRow) => Promise<string[]>;
};
```

Replace the tail of `approveReport` (from the `not-draft-ready` guard onward) with:

```ts
  if (!report.draftReady) return { status: "noop", reportId, reason: "not-draft-ready" };

  // Logged send-anyway override: a distinct, deliberate action. An empty reason is refused. The
  // override bypasses the HEALTH gate but NOT the real send blockers (missing recipients / header
  // image / report scores) — so evaluate blockers against a synthetic report already carrying the
  // override, which makes healthBlockers self-suppress while the infra blockers remain.
  if (override) {
    const reason = override.reason.trim();
    if (reason === "") return { status: "blocked", reportId, reason: "override-reason-required" };
    const overridden: ReportRow = { ...report, sendOverride: true, overrideReason: reason };
    const blockers = await deps.sendBlockers(overridden);
    if (blockers.length > 0) return { status: "blocked", reportId, reason: "send-blocked", blockers };
    await deps.overrideReport(reportId, deps.now(), APPROVED_BY, reason);
    return { status: "overridden", reportId, reason };
  }

  const blockers = await deps.sendBlockers(report);
  if (blockers.length > 0) return { status: "blocked", reportId, reason: "send-blocked", blockers };
  await deps.approveReportRow(reportId, deps.now(), APPROVED_BY);
  return { status: "approved", reportId };
}
```

And the signature:

```ts
export async function approveReport(
  deps: ApproveDeps,
  reportId: string,
  override?: { reason: string },
): Promise<ApproveResult> {
```

- [ ] **Step 5: Thread the override param through `approve-report.mts`.** In `netlify/functions/approve-report.mts`: import `overrideReportRow`, read an override intent, bind the dep, and map the new statuses. Add to the reports import:

```ts
import {
  getReportById as getReportByIdAirtable,
  approveReportRow,
  overrideReportRow,
} from "../../src/reports/airtable/reports.js";
```

Just before building the `approveReport` call, parse the intent (query flag + JSON body reason):

```ts
const url = new URL(req.url);
let override: { reason: string } | undefined;
if (url.searchParams.get("override") === "1") {
  const body = (await req.json().catch(() => ({}))) as { reason?: unknown };
  override = { reason: typeof body.reason === "string" ? body.reason : "" };
}
```

Pass `override` as the third arg and bind `overrideReport`:

```ts
const result = await approveReport(
  {
    getReportById: (rid) => getReportByIdAirtable(base, rid),
    approveReportRow: (rid, at, by) => approveReportRow(base, rid, at, by),
    overrideReport: (rid, at, by, reason) => overrideReportRow(base, rid, at, by, reason),
    now: () => new Date(),
    sendBlockers: async (report) => {
      const site = (await listWebsites(base)).find((w) => w.id === report.siteId);
      if (!site) return ["site-not-found: this report's Site link points at no Websites row"];
      return formatBlockers(approveBlockers(site, report));
    },
  },
  id,
  override,
);
```

Extend the response mapping (after the `not-found` 404 / `blocked` 409 handling): an `"overridden"` result is a success → 200 (it falls through the existing `return Response.json(result, { status: 200 })`); a `blocked` with `reason: "override-reason-required"` already returns 409 via the existing `if (result.status === "blocked")` branch — no extra code needed, but confirm the 409 branch does not special-case the reason.

- [ ] **Step 6: Run approve tests + both typechecks, confirm pass.** Run `cd /Users/tuckerlemos/Documents/GitHub/reddoor-maintenance && pnpm exec vitest run tests/dashboard/approve.test.ts tests/reports/preflight.test.ts && pnpm typecheck`. Expected: green. (`tsconfig.netlify.json` covers the `.mts` change.)

- [ ] **Step 7: Commit.** Run `cd /Users/tuckerlemos/Documents/GitHub/reddoor-maintenance && git add -A && git commit -m "feat(dashboard): logged send-anyway override branch + endpoint param (health-gate phase 10)"`.

---

## Task 11: Honor the override in `sendOne` + emit the `report_sent_with_override` event

**Files:** Modify `src/reports/send/orchestrate.ts` · Test `tests/reports/send/orchestrate.test.ts`

- [ ] **Step 1: Write failing tests: an overridden health-red report sends and emits the event.** In `tests/reports/send/orchestrate.test.ts`, `recordFleetEventsBestEffort` is imported by `orchestrate.ts` and opens libSQL — under test with no `TURSO_*` it self-skips (best-effort), so the send still succeeds. To assert the event, mock the writer. Add at the top of the file (with the other `vi.mock`s):

```ts
vi.mock("../../../src/audits/fleet-events-writer.js", () => ({
  recordFleetEventsBestEffort: vi.fn().mockResolvedValue(undefined),
}));
import { recordFleetEventsBestEffort } from "../../../src/audits/fleet-events-writer.js";
```

Then add:

```ts
it("sends an overridden Maintenance report even though its health gate is red, and logs the override event", async () => {
  const overriddenReport = reportRow({
    "Checklist auto-evidence": JSON.stringify({
      "Maint: Deploy & Function Health": {
        result: "pass",
        checkedAt: "2026-05-26T00:00:00.000Z",
        note: "",
      },
      "Maint: CMS Checked": {
        result: "fail",
        checkedAt: "2026-05-26T00:00:00.000Z",
        note: "Prismic unreachable",
      },
      "Maint: Domain, DNS & SSL": {
        result: "pass",
        checkedAt: "2026-05-26T00:00:00.000Z",
        note: "",
      },
      "Maint: Security Updates": {
        result: "pass",
        checkedAt: "2026-05-26T00:00:00.000Z",
        note: "",
      },
      "Maint: Uptime Checked": { result: "pass", checkedAt: "2026-05-26T00:00:00.000Z", note: "" },
    }),
    "Send override": true,
    "Override reason": "client verbally signed off",
    "Override by": "dashboard",
  });
  const base = makeFakeBase({ Reports: [overriddenReport], Websites: [siteRow()] });
  vi.mocked(openBase).mockReturnValue(base);
  const { client, captured } = captureClient();
  const res = await sendApprovedReports({ resend: client });
  expect(res.code).toBe(0);
  expect(captured).toHaveLength(1);
  expect(vi.mocked(recordFleetEventsBestEffort)).toHaveBeenCalled();
  const [events] = vi.mocked(recordFleetEventsBestEffort).mock.calls.at(-1)!;
  expect(events[0]!.type).toBe("report_sent_with_override");
  expect(events[0]!.summary).toContain("client verbally signed off");
});
```

- [ ] **Step 2: Run, confirm failure.** Run `cd /Users/tuckerlemos/Documents/GitHub/reddoor-maintenance && pnpm exec vitest run tests/reports/send/orchestrate.test.ts`. Expected failure: `sendOne` throws on the red gate (the override is not yet honored), so `captured` is empty and `res.code` is 1; the event is never emitted.

- [ ] **Step 3: Honor the override in the `sendOne` gate.** In `src/reports/send/orchestrate.ts`, change the checklist import to add `isSendOverridden`:

```ts
import { gatingHealth, isHealthGateClear, isSendOverridden } from "../checklist.js";
```

Update the gate condition (from Task 6) to bypass on an active override:

```ts
const gateReport = { reportType: report.reportType, autoEvidence: report.autoEvidence ?? {} };
if (!isHealthGateClear(gateReport) && !isSendOverridden(report)) {
  const failing = gatingHealth(gateReport)
    .filter((h) => h.status !== "pass" && h.status !== "n/a")
    .map((h) => {
      const note = report.autoEvidence?.[h.field]?.note;
      return `${h.field} (${h.status}${note ? `: ${note}` : ""})`;
    })
    .join("; ");
  throw new Error(`Report ${report.reportId} health gate not clear — ${failing}`);
}
```

- [ ] **Step 4: Emit the `report_sent_with_override` event after a successful overridden send.** In `sendApprovedReports`, inside the `for (const report of sendable)` loop, right after the successful `const messageId = await sendOne(...)` + its `lines.push("✓ sent: ...")` (and before/after the Launch flip block is fine), add:

```ts
if (report.sendOverride) {
  const failing = gatingHealth({
    reportType: report.reportType,
    autoEvidence: report.autoEvidence ?? {},
  })
    .filter((h) => h.status !== "pass" && h.status !== "n/a")
    .map((h) => h.field);
  await recordFleetEventsBestEffort(
    [
      {
        id: `report_sent_with_override:${report.id}`,
        ts: new Date().toISOString(),
        type: "report_sent_with_override",
        siteId: site.id,
        siteName: site.name,
        summary: `sent with override — ${report.overrideReason ?? ""}`,
        data: { reportId: report.reportId, reason: report.overrideReason, failing },
      },
    ],
    new Date(),
  );
}
```

(`recordFleetEventsBestEffort` is already imported at orchestrate.ts:15 and is itself best-effort — a missing `TURSO_*` swallows quietly, so this can never fail a send.)

- [ ] **Step 5: Run the orchestrate suite + typecheck + build + dist-smoke, confirm pass.** Run `cd /Users/tuckerlemos/Documents/GitHub/reddoor-maintenance && pnpm exec vitest run tests/reports/send/orchestrate.test.ts && pnpm typecheck && pnpm build && pnpm test:dist`. Expected: green; `test:dist` stays green (orchestrate is not in the audit graph, and no new central-only import was added there).

- [ ] **Step 6: Commit.** Run `cd /Users/tuckerlemos/Documents/GitHub/reddoor-maintenance && git add -A && git commit -m "feat(reports): honor send override in sendOne + emit report_sent_with_override (health-gate phase 10)"`.

---

## Task 12: Full-suite green gate

**Files:** (verification only)

- [ ] **Step 1: Run the full test suite with coverage.** Run `cd /Users/tuckerlemos/Documents/GitHub/reddoor-maintenance && pnpm test:coverage`. Expected: all tests pass and coverage stays at/above the floors (statements 78 / branches 67 / functions 76 / lines 80). If a new `src` function dipped a floor, add a focused unit test (e.g. `healthPresentation` edge cases, `updatesEvidence` pending → unknown, `deployEvidence` both-fresh-both-fail).

- [ ] **Step 2: Run lint + both typechecks + dist smoke.** Run `cd /Users/tuckerlemos/Documents/GitHub/reddoor-maintenance && pnpm lint && pnpm typecheck && pnpm build && pnpm test:dist`. Expected: clean. Fix any Prettier diffs with `pnpm format` and re-run.

- [ ] **Step 3: Confirm the client-email tripwires are still green.** Run `cd /Users/tuckerlemos/Documents/GitHub/reddoor-maintenance && pnpm exec vitest run tests/reports/checklist.test.ts`. Expected: the label-mirror (`MAINTENANCE_CHECKLIST`/`TESTING_CHECKLIST` labels === `DEFAULT_COPY`) and `ALL_CHECKLIST_FIELDS` order tests pass — the reframe never touched the 13 label strings or their order, so the email is provably unchanged.

- [ ] **Step 4: Verify the working tree is clean (the tripwire).** Run `cd /Users/tuckerlemos/Documents/GitHub/reddoor-maintenance && git status --porcelain`. Expected: empty (all tests wrote only to tmpdir; no fixture or snapshot leaked into the tree).
