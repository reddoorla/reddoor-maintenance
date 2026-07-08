# Health Gate Plan 3 — Smoke & Form Audits Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Ship Spec Phases 5 & 6 as two self-contained fleet audits plus the central test-mode plumbing they depend on: (5) a new `smoke` audit that runs each site's own `pnpm test:smoke` in its checkout and persists `Smoke OK` + `Last Smoke At`; (6) a new `form-e2e` audit that submits the real production contact form in test-mode against `site.deployedUrl` and persists `Form E2E OK` + `Form E2E checked at`, backed by a central `testMode` branch in `ingestSubmission` that suppresses ALL routing + skips Turnstile enforcement, and a one-line `reddoor-starter` `buildPayload` change that forwards the marker. **Out of scope (Plan 4):** the auto-tick evidence functions (`formsEvidence`, `interactionsEvidence`) and the gate predicate — this plan only makes the audits WRITE the columns those functions will read.

**Architecture:** Each audit follows the established domain.ts vertical slice — a pure core with injected IO deps and a graceful skip, a sibling `<name>-airtable.ts` extractor (`has<Name>Result` guard + `<name>ResultFromAudit`), a `WebsiteRow` field + `mapRow` read-back + a `<name>Fields()` writer honoring null-clears-cell + an `updateAuditFields` slice, a collect-and-write block in `write-audits-to-airtable.ts` + `WriteSummary.audit` union member, and registration in `REGISTRY`/`AuditName`. `smoke` is clone-based (runs the site's suite in `site.path`, reusing the `cloneIfNeeded`/`prepareFleetSites` harness + a11y.ts's 5-min-timeout/free-port hardening); `form-e2e` is checkout-free (drives `site.deployedUrl` like browser.ts) and joins `CHECKOUT_FREE_AUDITS`. The `form-e2e` submission only reaches a real inbox/DB/webhook if central ingest recognizes a `testMode` marker and short-circuits — so the central `ingestSubmission` branch is a hard prerequisite and lives in this plan.

**Tech Stack:** reddoor-maintenance — TypeScript (NodeNext modules → relative imports carry `.js`), Vitest (node env, `tests/**/*.test.ts`), tsup build, Playwright (lazy-imported in the live runner only). reddoor-starter — SvelteKit + `@reddoorla/maintenance/forms`. Coverage floors (statements 78 / branches 67 / functions 76 / lines 80) with `include: src/**/*.ts` mean **every new `src` file needs a test** or it scores 0% and CI reds. `test:dist` (`smoke-dist.mjs`) forbids the audit static import graph reaching central-only packages (airtable/libSQL/mjml) — new audit + `-airtable` files use `import type` for the airtable/websites types and lazy `import()` for Playwright. Dual typecheck (`tsc --noEmit` **and** `-p tsconfig.netlify.json`), eslint (`no-explicit-any`) + prettier, working-tree-clean tripwire (tests write to tmpdir only).

---

## File Structure

**reddoor-maintenance — created**

- `src/audits/smoke.ts` — `smokeAudit(ctx)`: runs `pnpm test:smoke` in `site.path` (5-min timeout, free-port env), exit 0 → `pass`, non-zero → `fail`, `pnpm` missing → `skip`; details `{ ok, checkedAt }`.
- `src/audits/smoke-airtable.ts` — `hasSmokeResult` / `smokeResultFromAudit`: extract the `SmokeResult` writeback from a `smoke` AuditResult.
- `src/audits/form-e2e.ts` — `formE2eAudit(ctx)` (pure core + injected `FormRunner`) + `defaultFormRunner()` (live Playwright, lazy-imported): submits the prod contact form in test-mode against `site.deployedUrl`; details `{ ok, formPresent, checkedAt }`.
- `src/audits/form-e2e-airtable.ts` — `hasFormE2eResult` / `formE2eResultFromAudit`: extract the `FormE2eResult` writeback from a `form-e2e` AuditResult.
- `tests/audits/smoke.test.ts`, `tests/audits/smoke-airtable.test.ts`, `tests/audits/form-e2e.test.ts`, `tests/audits/form-e2e-airtable.test.ts` — unit tests (fake spawn / fake runner).

**reddoor-maintenance — modified**

- `src/types.ts` — add `"smoke"` and `"form-e2e"` to the `AuditName` union.
- `src/audits/index.ts` — register `smokeAudit` + `formE2eAudit` in `REGISTRY`.
- `src/audits/util/inject.ts` — add `formRunner?: FormRunner` to `AuditContext`.
- `src/reports/airtable/websites.ts` — `SmokeResult` + `FormE2eResult` types; `WebsiteRow` fields `smokeOk`/`lastSmokeAt`/`formE2eOk`/`formE2eCheckedAt`; a `toVerdict` single-select reader + the four `mapRow` read-backs; `smokeFields()` + `formE2eFields()` writers; two new `updateAuditFields` slices.
- `src/audits/write-audits-to-airtable.ts` — collect-and-write blocks for `smoke` + `form-e2e`; `WriteSummary.audit` union + the merged-`audits` input gain `smoke`/`formE2e`.
- `src/cli/commands/audit.ts` — add `"form-e2e"` to `CHECKOUT_FREE_AUDITS` (checkout-free, keyed on `deployedUrl`).
- `src/forms/ingest.ts` — `isTestMode(rawPayload)` + a testMode short-circuit in `ingestSubmission` (suppresses persistence/notify/fan-out, bypasses Turnstile enforcement).
- `tests/_helpers/website-row.ts` — default the four new `WebsiteRow` fields to `null`.
- `tests/audits/write-audits-to-airtable.test.ts` — cover the smoke + form-e2e write blocks.
- `tests/forms/ingest.test.ts` — cover the testMode branch.

**reddoor-starter — modified**

- `src/routes/contact/+page.server.ts` — `buildPayload` forwards `testMode: true` when the submitted form carries `testMode=true` (extraField pass-through; a real visitor never sets it).

---

## Task 1: `smoke` audit — run each site's `pnpm test:smoke`

**Files:** Create `src/audits/smoke.ts`, `tests/audits/smoke.test.ts`. Modify `src/types.ts`, `src/audits/index.ts`.

- [ ] **Step 1: add the AuditName + register a placeholder so the Record type stays total.** Edit `src/types.ts` — extend the union (keep the existing members, add `smoke` last-but-one):

```ts
export type AuditName =
  | "deps"
  | "lighthouse"
  | "a11y"
  | "security"
  | "lint"
  | "domain"
  | "browser"
  | "netlify-deploy"
  | "smoke"
  | "form-e2e";
```

(`"form-e2e"` is added now too so `src/types.ts` is edited once; it is registered in Task 3.)

- [ ] **Step 2: write the failing test** — `tests/audits/smoke.test.ts`. It injects a fake `SpawnFn` (mirrors a11y.test.ts) and asserts the command, cwd, timeout, free-port env, and the pass/fail/skip mapping:

```ts
import { describe, it, expect } from "vitest";
import { smokeAudit } from "../../src/audits/smoke.js";
import type { SpawnFn } from "../../src/audits/util/spawn.js";

const NOW = new Date("2026-07-06T00:00:00.000Z");
const site = { path: "/tmp/acme", name: "acme" };

describe("audits/smoke", () => {
  it("passes when `pnpm test:smoke` exits 0 and writes a fresh checkedAt", async () => {
    let cmd = "";
    let args: readonly string[] = [];
    let cwd: string | undefined;
    let timeoutMs: number | undefined;
    let smokePort: string | undefined;
    const spawn: SpawnFn = async (c, a, opts) => {
      cmd = c;
      args = a;
      cwd = opts?.cwd;
      timeoutMs = opts?.timeoutMs;
      smokePort = opts?.env?.REDDOOR_SMOKE_PORT;
      return { code: 0, stdout: "", stderr: "" };
    };
    const r = await smokeAudit({ site, spawn, now: NOW });
    expect(cmd).toBe("pnpm");
    expect(args).toEqual(["test:smoke"]);
    expect(cwd).toBe("/tmp/acme");
    // 5-min budget — Playwright cold-boots the site's dev server + installs chromium.
    expect(timeoutMs).toBe(5 * 60_000);
    // Free-port hardening (the a11y --strictPort treatment): a numeric port is passed.
    expect(Number(smokePort)).toBeGreaterThan(0);
    expect(r.audit).toBe("smoke");
    expect(r.status).toBe("pass");
    expect(r.details).toEqual({ ok: "pass", checkedAt: NOW.toISOString() });
  });

  it("fails when the smoke suite exits non-zero", async () => {
    const spawn: SpawnFn = async () => ({ code: 1, stdout: "", stderr: "1 test failed" });
    const r = await smokeAudit({ site, spawn, now: NOW });
    expect(r.status).toBe("fail");
    expect(r.details).toEqual({ ok: "fail", checkedAt: NOW.toISOString() });
    expect(r.summary).toMatch(/failed/i);
  });

  it("skips (no details) when pnpm is not available (ENOENT)", async () => {
    const spawn: SpawnFn = async () => {
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    };
    const r = await smokeAudit({ site, spawn, now: NOW });
    expect(r.status).toBe("skip");
    expect(r.details).toBeUndefined();
  });
});
```

- [ ] **Step 3: run → FAIL.** `pnpm exec vitest run tests/audits/smoke.test.ts` — expected: `Cannot find module '../../src/audits/smoke.js'` (the file does not exist yet).

- [ ] **Step 4: implement** — `src/audits/smoke.ts`:

```ts
import type { AuditResult } from "../types.js";
import type { AuditContext } from "./util/inject.js";
import { defaultSpawn } from "./util/spawn.js";
import { siteLabel } from "../util/site.js";
import { findFreePort } from "../util/free-port.js";

/** Persisted smoke verdict: the site's own `test:smoke` suite passed or failed. */
export type SmokeDetails = { ok: "pass" | "fail"; checkedAt: string };

/**
 * Run a site's own `pnpm test:smoke` suite in its checkout and reduce the exit
 * code to a verdict. Clone-based: the CLI (`prepareFleetSites`) has already put a
 * real checkout at `site.path` (smoke is NOT in CHECKOUT_FREE_AUDITS). Reuses the
 * a11y harness treatment: a 5-min timeout (Playwright cold-boots the dev server +
 * installs chromium) and a freshly-allocated free port passed as REDDOOR_SMOKE_PORT
 * so the site's smoke playwright config can bind `--port <n> --strictPort` and stay
 * immune to a zombie-vite squatting 5173 (see free-port.ts).
 *
 * exit 0 → pass; non-zero → fail; a missing `pnpm` binary (ENOENT) → skip (no
 * details ⇒ the Airtable writer preserves the prior verdict).
 */
export async function smokeAudit(ctx: AuditContext): Promise<AuditResult> {
  const spawn = ctx.spawn ?? defaultSpawn;
  const site = ctx.site;
  const label = siteLabel(site);
  const now = ctx.now ?? new Date();
  const checkedAt = now.toISOString();

  const port = await findFreePort();

  let raw;
  try {
    raw = await spawn("pnpm", ["test:smoke"], {
      cwd: site.path,
      env: { ...process.env, REDDOOR_SMOKE_PORT: String(port) },
      // Playwright on a cold tree installs chromium, boots the site's dev server,
      // and runs the smoke specs — the shared 30s default starves it (mirrors a11y).
      timeoutMs: 5 * 60_000,
    });
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === "ENOENT" || /ENOENT/.test(String(err))) {
      return { audit: "smoke", site: label, status: "skip", summary: "pnpm not available" };
    }
    throw err;
  }

  if (raw.code === 0) {
    return {
      audit: "smoke",
      site: label,
      status: "pass",
      summary: "smoke: suite green",
      details: { ok: "pass", checkedAt } satisfies SmokeDetails,
    };
  }
  return {
    audit: "smoke",
    site: label,
    status: "fail",
    summary: `smoke: suite failed (exit ${raw.code})${
      raw.stderr ? ` — ${raw.stderr.slice(0, 200)}` : ""
    }`,
    details: { ok: "fail", checkedAt } satisfies SmokeDetails,
  };
}
```

- [ ] **Step 5: register in the REGISTRY.** Edit `src/audits/index.ts` — add the import and the `REGISTRY` entry:

```ts
import { netlifyDeployAudit } from "./netlify-deploy.js";
import { smokeAudit } from "./smoke.js";
```

```ts
const REGISTRY: Record<AuditName, (ctx: AuditContext) => Promise<AuditResult>> = {
  deps: depsAudit,
  lint: lintAudit,
  security: securityAudit,
  lighthouse: lighthouseAudit,
  a11y: a11yAudit,
  domain: domainAudit,
  browser: browserAudit,
  "netlify-deploy": netlifyDeployAudit,
  smoke: smokeAudit,
  "form-e2e": formE2eAudit,
};
```

Also add `import { formE2eAudit } from "./form-e2e.js";` **now is premature** — `form-e2e.ts` does not exist until Task 3, and `REGISTRY` must satisfy `Record<AuditName, …>` which already lists `"form-e2e"` from Step 1. To keep the tree compiling between tasks, temporarily register `"form-e2e"` with a throwing stub in this task and replace it in Task 3:

```ts
// TEMP (replaced in Task 3 by the real formE2eAudit import): keeps Record<AuditName>
// total so `pnpm typecheck` passes between tasks. Never reached — form-e2e is not
// requested until Task 3 wires the real audit.
"form-e2e": async (ctx) => ({
  audit: "form-e2e",
  site: ctx.site.name || ctx.site.path,
  status: "skip",
  summary: "form-e2e not yet wired",
}),
smoke: smokeAudit,
```

- [ ] **Step 6: run → PASS.** `pnpm exec vitest run tests/audits/smoke.test.ts` — expected: 3 passing. Then `pnpm typecheck` — expected: clean (Record is total, both new AuditName members handled).

- [ ] **Step 7: commit.** `git add -A && git commit -m "feat(audits): smoke audit runs each site's pnpm test:smoke"`

---

## Task 2: `smoke` Airtable slice — `Smoke OK` + `Last Smoke At` writeback + read-back

**Files:** Create `src/audits/smoke-airtable.ts`, `tests/audits/smoke-airtable.test.ts`. Modify `src/reports/airtable/websites.ts`, `src/audits/write-audits-to-airtable.ts`, `tests/_helpers/website-row.ts`, `tests/audits/write-audits-to-airtable.test.ts`.

- [ ] **Step 1: write the failing extractor test** — `tests/audits/smoke-airtable.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { hasSmokeResult, smokeResultFromAudit } from "../../src/audits/smoke-airtable.js";
import type { AuditResult } from "../../src/types.js";

const smoke = (details: unknown): AuditResult =>
  ({ audit: "smoke", site: "acme", status: "pass", summary: "ok", details }) as AuditResult;

describe("smoke-airtable", () => {
  it("hasSmokeResult is true only for a smoke audit carrying a checkedAt", () => {
    expect(hasSmokeResult(smoke({ ok: "pass", checkedAt: "2026-07-06T00:00:00.000Z" }))).toBe(true);
    expect(hasSmokeResult(smoke(undefined))).toBe(false);
    expect(
      hasSmokeResult({ audit: "a11y", site: "x", status: "pass", summary: "" } as AuditResult),
    ).toBe(false);
  });

  it("smokeResultFromAudit lifts the verdict + timestamp", () => {
    const r = smokeResultFromAudit(smoke({ ok: "fail", checkedAt: "2026-07-06T00:00:00.000Z" }));
    expect(r).toEqual({ ok: "fail", checkedAt: "2026-07-06T00:00:00.000Z" });
  });

  it("smokeResultFromAudit throws on a non-smoke result", () => {
    expect(() =>
      smokeResultFromAudit({
        audit: "a11y",
        site: "x",
        status: "pass",
        summary: "",
      } as AuditResult),
    ).toThrow(/Expected a 'smoke'/);
  });
});
```

- [ ] **Step 2: run → FAIL.** `pnpm exec vitest run tests/audits/smoke-airtable.test.ts` — expected: `Cannot find module '../../src/audits/smoke-airtable.js'`.

- [ ] **Step 3: add the `SmokeResult` type + `WebsiteRow` fields + reader + writer to `websites.ts`.** Edit `src/reports/airtable/websites.ts`.

3a. Add the two `WebsiteRow` fields (place immediately after the `githubSignalsAt` field, before `notifyRouting`):

```ts
githubSignalsAt: string | null;
/** Per-site smoke-suite verdict (the `smoke` audit runs `pnpm test:smoke`).
 *  Single-select pass/fail; null = never ran. `lastSmokeAt` gates freshness. */
smokeOk: "pass" | "fail" | null;
lastSmokeAt: string | null;
notifyRouting: NotifyRouting | null;
```

3b. Add the tri-state single-select reader (place near `trimToNull`, above `parseNotifyRouting`):

```ts
/** Read a tri-state single-select verdict cell into the WebsiteRow tri-state:
 *  "pass"/"fail" round-trip as themselves; empty / any other value → null
 *  ("never ran"). Shared by every NEW single-select verdict column (Smoke OK,
 *  Form E2E OK — and, in sibling plans, Function health / reachable / titleMeta). */
function toVerdict(raw: unknown): "pass" | "fail" | null {
  return raw === "pass" || raw === "fail" ? raw : null;
}
```

3c. Add the two `mapRow` read-backs (place immediately after the existing `githubSignalsAt` line in the returned object):

```ts
    githubSignalsAt: (f["GitHub Signals At"] as string | undefined) ?? null,
    smokeOk: toVerdict(f["Smoke OK"]),
    lastSmokeAt: (f["Last Smoke At"] as string | undefined) ?? null,
```

3d. Add the `SmokeResult` type (place with the other audit-field result types, after `BrowserAuditFields`):

```ts
export type SmokeResult = { ok: "pass" | "fail"; checkedAt: string };
```

3e. Add the `smokeFields` writer (place after `browserFields`):

```ts
function smokeFields(r: SmokeResult): FieldSet {
  // The verdict is stored as the literal single-select option ("pass"/"fail"), so
  // no boolean→string coercion is needed. A skip never reaches here (it produces no
  // SmokeResult), so this column is only ever written with a concrete verdict.
  return { "Smoke OK": r.ok, "Last Smoke At": r.checkedAt };
}
```

3f. Extend the `updateAuditFields` `audits` parameter type + its body. Add `smoke?: SmokeResult;` to the parameter object type, and `if (audits.smoke) Object.assign(fields, smokeFields(audits.smoke));` in the body (place after the `netlifyDeploy` line):

```ts
    netlifyDeploy?: NetlifyDeployResult;
    smoke?: SmokeResult;
    formE2e?: FormE2eResult;
  },
): Promise<FieldSet> {
```

```ts
if (audits.netlifyDeploy) Object.assign(fields, netlifyDeployFields(audits.netlifyDeploy));
if (audits.smoke) Object.assign(fields, smokeFields(audits.smoke));
if (audits.formE2e) Object.assign(fields, formE2eFields(audits.formE2e));
```

(`FormE2eResult`, `formE2eFields`, and the `formE2e` slice are added in Task 4 — add the `smoke` parts now; `formE2e` references are added in Task 4. To keep the tree compiling, add only the `smoke?: SmokeResult;` line and the `if (audits.smoke) …` line in THIS task; add the `formE2e` counterparts in Task 4.)

- [ ] **Step 4: implement the extractor** — `src/audits/smoke-airtable.ts`:

```ts
import type { AuditResult } from "../types.js";
import type { SmokeResult } from "../reports/airtable/websites.js";

type SmokeDetails = { ok: "pass" | "fail"; checkedAt: string };

/** True when an AuditResult is a `smoke` audit that actually ran (has details with
 *  a checkedAt — a "skip" for a missing `pnpm` has none, so the writer preserves
 *  the prior verdict). */
export function hasSmokeResult(result: AuditResult): boolean {
  if (result.audit !== "smoke") return false;
  const d = result.details as SmokeDetails | undefined;
  return !!d && typeof d.checkedAt === "string";
}

/** Extract the Airtable-writable smoke verdict (pass/fail + checked-at). */
export function smokeResultFromAudit(result: AuditResult): SmokeResult {
  if (result.audit !== "smoke") {
    throw new Error(`Expected a 'smoke' AuditResult, got '${result.audit}'`);
  }
  const d = result.details as SmokeDetails | undefined;
  return {
    ok: d?.ok === "fail" ? "fail" : "pass",
    checkedAt: typeof d?.checkedAt === "string" ? d.checkedAt : new Date().toISOString(),
  };
}
```

- [ ] **Step 5: wire the collect-and-write block** in `src/audits/write-audits-to-airtable.ts`.

5a. Add the type import (extend the existing `import type { … } from "../reports/airtable/websites.js";` block) and the extractor import:

```ts
import type {
  A11yCounts,
  DepsCounts,
  SecurityCounts,
  SecurityAdvisory,
  DomainResult,
  BrowserAuditFields,
  NetlifyDeployResult,
  SmokeResult,
} from "../reports/airtable/websites.js";
```

```ts
import { hasNetlifyDeployResult, netlifyDeployResultFromAudit } from "./netlify-deploy-airtable.js";
import { hasSmokeResult, smokeResultFromAudit } from "./smoke-airtable.js";
```

5b. Extend the `WriteSummary.audit` union — add `"smoke"` (add `"form-e2e"` too, so the union is touched once; the form-e2e block is added in Task 4):

```ts
    audit:
      | "lighthouse"
      | "a11y"
      | "deps"
      | "security"
      | "github-signals"
      | "domain"
      | "browser"
      | "netlify-deploy"
      | "smoke"
      | "form-e2e";
    counts: object;
```

5c. Extend the merged `audits` accumulator type (in `writeAuditsToAirtable`, after `netlifyDeploy?`):

```ts
    netlifyDeploy?: NetlifyDeployResult;
    smoke?: SmokeResult;
  } = {};
```

5d. Add the collect block (after the `netlifyDeploy` block, before the atomic-write guard):

```ts
const smoke = results.find((r) => r.audit === "smoke");
if (smoke && hasSmokeResult(smoke)) {
  const result = smokeResultFromAudit(smoke);
  audits.smoke = result;
  writes.push({ audit: "smoke", counts: result });
}
```

- [ ] **Step 6: default the new fields in the test helper.** Edit `tests/_helpers/website-row.ts` — add to the returned object (near `githubSignalsAt`):

```ts
    githubSignalsAt: null,
    smokeOk: null,
    lastSmokeAt: null,
```

- [ ] **Step 7: extend the write-back integration test.** Add to `tests/audits/write-audits-to-airtable.test.ts` (inside the `describe("writeAuditsToAirtable", …)` block). First add a `smoke` result factory near the other factories:

```ts
const smokeResult = (ok: "pass" | "fail"): AuditResult =>
  ({
    audit: "smoke",
    site: "acme",
    status: ok === "pass" ? "pass" : "fail",
    summary: "ok",
    details: { ok, checkedAt: "2026-07-06T00:00:00.000Z" },
  }) as unknown as AuditResult;
```

Then the test:

```ts
it("writes the Smoke OK verdict + Last Smoke At from a smoke result", async () => {
  const { base, calls } = makeFakeBase();
  const summary = await writeAuditsToAirtable({
    base,
    websites: [row()],
    slug: "acme",
    results: [smokeResult("fail")],
  });
  expect(calls).toHaveLength(1);
  expect(calls[0]?.fields).toMatchObject({
    "Smoke OK": "fail",
    "Last Smoke At": "2026-07-06T00:00:00.000Z",
  });
  expect(summary.writes.map((w) => w.audit)).toEqual(["smoke"]);
});
```

- [ ] **Step 8: run → PASS.** `pnpm exec vitest run tests/audits/smoke-airtable.test.ts tests/audits/write-audits-to-airtable.test.ts` — expected: all passing. Then `pnpm typecheck` — expected: clean.

- [ ] **Step 9: commit.** `git add -A && git commit -m "feat(audits): persist Smoke OK + Last Smoke At writeback + read-back"`

---

## Task 3: `form-e2e` audit — synthetic prod contact-form submission

**Files:** Create `src/audits/form-e2e.ts`, `tests/audits/form-e2e.test.ts`. Modify `src/audits/index.ts`, `src/audits/util/inject.ts`, `src/cli/commands/audit.ts`, `tests/cli/commands/audit.test.ts` (or the nearest existing audit CLI test — see Step 6).

- [ ] **Step 1: write the failing test** — `tests/audits/form-e2e.test.ts`. It injects a fake `FormRunner` and asserts the pass / fail / n-a(no-form) / skip(no-URL) mapping and the persisted `ok`:

```ts
import { describe, it, expect } from "vitest";
import { formE2eAudit, type FormRunner } from "../../src/audits/form-e2e.js";

const NOW = new Date("2026-07-06T00:00:00.000Z");
const site = { path: "/tmp/acme", name: "acme", deployedUrl: "https://acme.example.com" };

function runner(over: Partial<FormRunner> = {}): FormRunner {
  return {
    submit: async () => ({ formPresent: true, success: true }),
    ...over,
  };
}

describe("audits/form-e2e", () => {
  it("skips (no details) a site with no deployed URL", async () => {
    const r = await formE2eAudit({ site: { path: "/tmp/acme", name: "acme" }, now: NOW });
    expect(r.status).toBe("skip");
    expect(r.details).toBeUndefined();
  });

  it("passes when the synthetic submission succeeds", async () => {
    const r = await formE2eAudit({ site, now: NOW, formRunner: runner() });
    expect(r.status).toBe("pass");
    expect(r.details).toEqual({ ok: "pass", formPresent: true, checkedAt: NOW.toISOString() });
  });

  it("warns + records ok:fail when the submission does not succeed", async () => {
    const r = await formE2eAudit({
      site,
      now: NOW,
      formRunner: runner({
        submit: async () => ({ formPresent: true, success: false, detail: "no success banner" }),
      }),
    });
    expect(r.status).toBe("warn");
    expect(r.details).toMatchObject({ ok: "fail", formPresent: true });
    expect(r.summary).toMatch(/no success banner/);
  });

  it("records n/a (ok:null + fresh checkedAt) when the site has no contact form", async () => {
    const r = await formE2eAudit({
      site,
      now: NOW,
      formRunner: runner({ submit: async () => ({ formPresent: false }) }),
    });
    // Skip STATUS (nothing to assert on the CLI), but WITH details so the writer
    // persists the n/a signal: null verdict + fresh checkedAt (Plan 4 reads that as n/a).
    expect(r.status).toBe("skip");
    expect(r.details).toEqual({ ok: null, formPresent: false, checkedAt: NOW.toISOString() });
  });

  it("passes the CF public test sitekey + testMode marker to the runner", async () => {
    let seen: { baseUrl: string; testMode: boolean; testSitekey: string } | undefined;
    await formE2eAudit({
      site,
      now: NOW,
      formRunner: {
        submit: async (opts) => {
          seen = opts;
          return { formPresent: true, success: true };
        },
      },
    });
    expect(seen).toEqual({
      baseUrl: "https://acme.example.com",
      testMode: true,
      testSitekey: "1x00000000000000000000AA",
    });
  });
});
```

- [ ] **Step 2: run → FAIL.** `pnpm exec vitest run tests/audits/form-e2e.test.ts` — expected: `Cannot find module '../../src/audits/form-e2e.js'`.

- [ ] **Step 3: implement** — `src/audits/form-e2e.ts` (pure core + injected runner + a lazy-Playwright default runner, mirroring browser.ts):

```ts
import type { AuditResult } from "../types.js";
import type { AuditContext } from "./util/inject.js";
import { siteLabel } from "../util/site.js";

/** Cloudflare's PUBLIC test sitekey — always issues a passing client token with no
 *  real challenge, so the probe can satisfy a site's Turnstile widget without any
 *  secret. Central verify is fail-open and the testMode ingest branch skips
 *  enforcement anyway, so the token's validity is never actually required. */
export const CF_TEST_SITEKEY = "1x00000000000000000000AA";

/** The canonical starter contact route. Sites built from reddoor-starter serve the
 *  form here; route discovery for bespoke paths is a follow-up (see Open items). */
const CONTACT_PATH = "/contact";

/** Persisted form-e2e verdict. `ok` is the single-select value: "pass"/"fail" when a
 *  form was found + submitted; null when NO contact form exists (n/a — paired with a
 *  fresh checkedAt so the writer stores "checked, no form" distinctly from "never ran"). */
export type FormE2eDetails = {
  ok: "pass" | "fail" | null;
  formPresent: boolean;
  checkedAt: string;
};

/** Outcome of driving one site's contact form. `formPresent:false` ⇒ n/a. */
export type FormSubmitOutcome =
  | { formPresent: false }
  | { formPresent: true; success: boolean; detail?: string };

/** Injected browser IO. The real impl drives Playwright; tests pass a fake. */
export type FormRunner = {
  submit: (opts: {
    baseUrl: string;
    testMode: boolean;
    testSitekey: string;
  }) => Promise<FormSubmitOutcome>;
  close?: () => Promise<void>;
};

/**
 * Submit the REAL production contact form against `site.deployedUrl` in test-mode
 * and reduce the outcome to a verdict. Checkout-free (drives the deployed URL, like
 * browser.ts). The submission carries a `testMode` marker the central ingest
 * recognizes and routes away from every real sink (no inbox/DB/webhook, Turnstile
 * enforcement bypassed) — so this exercises the whole prod ingest path safely.
 *
 * - no deployedUrl → skip, NO details → writer preserves the prior verdict.
 * - no contact form → skip WITH details (ok:null + fresh checkedAt) → persisted as n/a.
 * - form submitted, success → pass (ok:"pass"); not success → warn (ok:"fail").
 */
export async function formE2eAudit(ctx: AuditContext): Promise<AuditResult> {
  const { site } = ctx;
  const label = siteLabel(site);
  if (!site.deployedUrl) {
    return { audit: "form-e2e", site: label, status: "skip", summary: "no deployed URL" };
  }
  const now = ctx.now ?? new Date();
  const checkedAt = now.toISOString();
  const runner = ctx.formRunner ?? (await defaultFormRunner());
  try {
    const outcome = await runner.submit({
      baseUrl: site.deployedUrl,
      testMode: true,
      testSitekey: CF_TEST_SITEKEY,
    });
    if (!outcome.formPresent) {
      return {
        audit: "form-e2e",
        site: label,
        status: "skip",
        summary: "no contact form (n/a)",
        details: { ok: null, formPresent: false, checkedAt } satisfies FormE2eDetails,
      };
    }
    const ok: "pass" | "fail" = outcome.success ? "pass" : "fail";
    return {
      audit: "form-e2e",
      site: label,
      status: outcome.success ? "pass" : "warn",
      summary: outcome.success
        ? "form-e2e: synthetic submission succeeded"
        : `form-e2e: synthetic submission failed${outcome.detail ? ` — ${outcome.detail}` : ""}`,
      details: { ok, formPresent: true, checkedAt } satisfies FormE2eDetails,
    };
  } finally {
    await runner.close?.();
  }
}

/** Minimum plausible fill time the site's bot-timing screen enforces (client.ts
 *  MIN_FILL_MS = 800). A too-fast submit is silently dropped (success shown, ingest
 *  never reached), so the probe waits past this before submitting. */
const FILL_SETTLE_MS = 1200;
const PAGE_TIMEOUT_MS = 30_000;

/**
 * Real Playwright form runner. Lazily imports @playwright/test so unit tests (which
 * inject a fake runner) never load it — and so the audit's static import graph stays
 * central-dep-free for `test:dist`. Every failure degrades to `success:false` (never
 * throws past the audit), so a flaky run yields a non-pass (box stays manual), not a
 * false green.
 */
export async function defaultFormRunner(): Promise<FormRunner> {
  const { chromium } = await import("@playwright/test");
  return {
    async submit({ baseUrl, testSitekey }) {
      const browser = await chromium.launch();
      try {
        const ctx = await browser.newContext();
        const page = await ctx.newPage();
        const url = new URL(CONTACT_PATH, baseUrl).toString();
        const resp = await page
          .goto(url, { waitUntil: "domcontentloaded", timeout: PAGE_TIMEOUT_MS })
          .catch(() => null);
        // No page, non-2xx, or no <form> with the expected fields ⇒ no contact form (n/a).
        const form = page.locator("form").first();
        const hasForm =
          !!resp &&
          resp.ok() &&
          (await form.count().catch(() => 0)) > 0 &&
          (await page
            .locator('input[name="email"], input[type="email"]')
            .count()
            .catch(() => 0)) > 0;
        if (!hasForm) return { formPresent: false };

        await page.fill('[name="name"]', "Reddoor Monitor").catch(() => {});
        await page.fill('[name="email"]', "monitor+e2e@reddoorla.com").catch(() => {});
        await page.fill('[name="phone"]', "5555550123").catch(() => {});
        await page
          .fill('[name="message"]', "Synthetic end-to-end health check — please ignore.")
          .catch(() => {});

        // Inject the testMode marker + a Turnstile token into the submitted form.
        // The marker routes the submission away from every real sink centrally; the
        // token satisfies any client widget (central verify is fail-open + testMode
        // skips enforcement, so the value is inconsequential — the CF public test
        // sitekey `${testSitekey}` documents the intended zero-secret path).
        await page.evaluate((sitekey) => {
          const f = document.querySelector("form");
          if (!f) return;
          const add = (name: string, value: string) => {
            let el = f.querySelector<HTMLInputElement>(`input[name="${name}"]`);
            if (!el) {
              el = document.createElement("input");
              el.type = "hidden";
              el.name = name;
              f.appendChild(el);
            }
            el.value = value;
          };
          add("testMode", "true");
          add("cf-turnstile-response", `testmode-${sitekey}`);
        }, testSitekey);

        // Beat the bot-timing screen, then submit and wait for the success banner
        // (role="status") the starter renders on a successful action.
        await page.waitForTimeout(FILL_SETTLE_MS);
        await page.locator('button[type="submit"]').first().click({ timeout: PAGE_TIMEOUT_MS });
        const ok = await page
          .locator('[role="status"]')
          .first()
          .waitFor({ state: "visible", timeout: PAGE_TIMEOUT_MS })
          .then(() => true)
          .catch(() => false);
        return ok
          ? { formPresent: true, success: true }
          : { formPresent: true, success: false, detail: "no success banner after submit" };
      } catch (err) {
        return { formPresent: true, success: false, detail: String(err).slice(0, 120) };
      } finally {
        await browser.close().catch(() => {});
      }
    },
  };
}
```

- [ ] **Step 4: add `formRunner` to `AuditContext`.** Edit `src/audits/util/inject.ts` — add the type import + the field:

```ts
import type { BrowserRunner } from "../browser.js";
import type { FormRunner } from "../form-e2e.js";
```

```ts
  /** Playwright runner injection for the browser audit (tests). Defaults to real Playwright. */
  browserRunner?: BrowserRunner;
  /** Playwright runner injection for the form-e2e audit (tests). Defaults to real Playwright. */
  formRunner?: FormRunner;
```

- [ ] **Step 5: replace the temp REGISTRY stub with the real audit.** Edit `src/audits/index.ts` — add the import and swap the stub:

```ts
import { smokeAudit } from "./smoke.js";
import { formE2eAudit } from "./form-e2e.js";
```

Replace the temporary `"form-e2e": async (ctx) => …` stub added in Task 1 with:

```ts
  smoke: smokeAudit,
  "form-e2e": formE2eAudit,
```

- [ ] **Step 6: mark `form-e2e` checkout-free.** Edit `src/cli/commands/audit.ts` — add it to `CHECKOUT_FREE_AUDITS` (it drives `deployedUrl`, so it stays OUT of `NETLIFY_ID_AUDITS`):

```ts
const CHECKOUT_FREE_AUDITS: ReadonlySet<AuditName> = new Set<AuditName>([
  "lighthouse",
  "domain",
  "browser",
  "netlify-deploy",
  "form-e2e",
]);
```

Add the assertion to the existing `auditNeedsCheckout` test (find it via `grep -rn "auditNeedsCheckout" tests/`; it lives in the audit CLI test). Append inside that describe:

```ts
it("form-e2e is checkout-free when the site has a deployed URL", () => {
  expect(auditNeedsCheckout({ path: "/x", deployedUrl: "https://a.example" }, ["form-e2e"])).toBe(
    false,
  );
  // …but still needs a checkout if pointed at a site with no deployed URL.
  expect(auditNeedsCheckout({ path: "/x" }, ["form-e2e"])).toBe(true);
});
```

If no existing `auditNeedsCheckout` test file is found, create `tests/cli/commands/audit-needs-checkout.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { auditNeedsCheckout } from "../../../src/cli/commands/audit.js";

describe("auditNeedsCheckout — form-e2e", () => {
  it("is checkout-free with a deployed URL, checkout-ful without", () => {
    expect(auditNeedsCheckout({ path: "/x", deployedUrl: "https://a.example" }, ["form-e2e"])).toBe(
      false,
    );
    expect(auditNeedsCheckout({ path: "/x" }, ["form-e2e"])).toBe(true);
    // smoke is always clone-based.
    expect(auditNeedsCheckout({ path: "/x", deployedUrl: "https://a.example" }, ["smoke"])).toBe(
      true,
    );
  });
});
```

- [ ] **Step 7: run → PASS.** `pnpm exec vitest run tests/audits/form-e2e.test.ts` and the audit-needs-checkout test — expected: all passing. Then `pnpm typecheck` — expected: clean.

- [ ] **Step 8: verify `test:dist` stays green (no central-dep leak).** `pnpm build && node scripts/smoke-dist.mjs` — expected: `smoke-dist: <version> OK`. (Confirms `form-e2e.ts` + `smoke.ts` reach no central-only dep in the audit static graph — Playwright is lazy-imported, airtable types are `import type`.)

- [ ] **Step 9: commit.** `git add -A && git commit -m "feat(audits): form-e2e audit submits the prod contact form in test-mode"`

---

## Task 4: `form-e2e` Airtable slice — `Form E2E OK` + `Form E2E checked at`

**Files:** Create `src/audits/form-e2e-airtable.ts`, `tests/audits/form-e2e-airtable.test.ts`. Modify `src/reports/airtable/websites.ts`, `src/audits/write-audits-to-airtable.ts`, `tests/_helpers/website-row.ts`, `tests/audits/write-audits-to-airtable.test.ts`.

- [ ] **Step 1: write the failing extractor test** — `tests/audits/form-e2e-airtable.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { hasFormE2eResult, formE2eResultFromAudit } from "../../src/audits/form-e2e-airtable.js";
import type { AuditResult } from "../../src/types.js";

const fe2e = (details: unknown): AuditResult =>
  ({ audit: "form-e2e", site: "acme", status: "pass", summary: "ok", details }) as AuditResult;

describe("form-e2e-airtable", () => {
  it("hasFormE2eResult is true only for a form-e2e audit carrying a checkedAt", () => {
    expect(
      hasFormE2eResult(
        fe2e({ ok: "pass", formPresent: true, checkedAt: "2026-07-06T00:00:00.000Z" }),
      ),
    ).toBe(true);
    // n/a (no form) still has a checkedAt ⇒ persisted (null verdict clears + timestamps the cell).
    expect(
      hasFormE2eResult(
        fe2e({ ok: null, formPresent: false, checkedAt: "2026-07-06T00:00:00.000Z" }),
      ),
    ).toBe(true);
    expect(hasFormE2eResult(fe2e(undefined))).toBe(false);
  });

  it("formE2eResultFromAudit lifts the verdict (pass/fail/null) + timestamp", () => {
    expect(
      formE2eResultFromAudit(
        fe2e({ ok: "fail", formPresent: true, checkedAt: "2026-07-06T00:00:00.000Z" }),
      ),
    ).toEqual({
      ok: "fail",
      checkedAt: "2026-07-06T00:00:00.000Z",
    });
    expect(
      formE2eResultFromAudit(
        fe2e({ ok: null, formPresent: false, checkedAt: "2026-07-06T00:00:00.000Z" }),
      ),
    ).toEqual({
      ok: null,
      checkedAt: "2026-07-06T00:00:00.000Z",
    });
  });

  it("throws on a non-form-e2e result", () => {
    expect(() =>
      formE2eResultFromAudit({
        audit: "a11y",
        site: "x",
        status: "pass",
        summary: "",
      } as AuditResult),
    ).toThrow(/Expected a 'form-e2e'/);
  });
});
```

- [ ] **Step 2: run → FAIL.** `pnpm exec vitest run tests/audits/form-e2e-airtable.test.ts` — expected: `Cannot find module`.

- [ ] **Step 3: add the `FormE2eResult` type + `WebsiteRow` fields + writer to `websites.ts`.** Edit `src/reports/airtable/websites.ts`.

3a. Add the two `WebsiteRow` fields (immediately after the `lastSmokeAt` field added in Task 2, before `notifyRouting`):

```ts
lastSmokeAt: string | null;
/** Synthetic form end-to-end verdict (the `form-e2e` audit submits the real prod
 *  contact form in test-mode). Single-select pass/fail; null = never ran OR (with
 *  a fresh `formE2eCheckedAt`) no contact form → n/a. `formE2eCheckedAt` gates
 *  freshness AND encodes the n/a-vs-never-ran distinction. */
formE2eOk: "pass" | "fail" | null;
formE2eCheckedAt: string | null;
notifyRouting: NotifyRouting | null;
```

3b. Add the two `mapRow` read-backs (after the `lastSmokeAt` read-back from Task 2):

```ts
    lastSmokeAt: (f["Last Smoke At"] as string | undefined) ?? null,
    formE2eOk: toVerdict(f["Form E2E OK"]),
    formE2eCheckedAt: (f["Form E2E checked at"] as string | undefined) ?? null,
```

3c. Add the `FormE2eResult` type (after `SmokeResult`):

```ts
/** `ok` null clears the single-select cell (n/a — no contact form); a fresh
 *  `checkedAt` still stamps the row so Plan 4 reads null+fresh as n/a. */
export type FormE2eResult = { ok: "pass" | "fail" | null; checkedAt: string };
```

3d. Add the `formE2eFields` writer (after `smokeFields`):

```ts
function formE2eFields(r: FormE2eResult): FieldSet {
  // `ok` is already the single-select value ("pass"/"fail") or null. Writing null
  // CLEARS the cell (→ n/a, distinguished from "never ran" by the fresh checked-at
  // stamped alongside). FieldSet's type omits null, hence the widened-record cast
  // (same approach as domainFields / netlifyDeployFields).
  const fields: Record<string, string | null> = {
    "Form E2E OK": r.ok,
    "Form E2E checked at": r.checkedAt,
  };
  return fields as FieldSet;
}
```

3e. Add the `formE2e?: FormE2eResult;` slice to the `updateAuditFields` parameter type + the `if (audits.formE2e) …` line in its body (the placeholder references were noted in Task 2 Step 3f — add them for real now):

```ts
    smoke?: SmokeResult;
    formE2e?: FormE2eResult;
  },
): Promise<FieldSet> {
```

```ts
if (audits.smoke) Object.assign(fields, smokeFields(audits.smoke));
if (audits.formE2e) Object.assign(fields, formE2eFields(audits.formE2e));
```

- [ ] **Step 4: implement the extractor** — `src/audits/form-e2e-airtable.ts`:

```ts
import type { AuditResult } from "../types.js";
import type { FormE2eResult } from "../reports/airtable/websites.js";

type FormE2eDetails = { ok: "pass" | "fail" | null; formPresent: boolean; checkedAt: string };

/** True when an AuditResult is a `form-e2e` audit that actually RAN (has details
 *  with a checkedAt). Both a real verdict AND the no-form n/a case carry a checkedAt,
 *  so both persist; only a no-deployed-URL skip (no details) is preserved-prior. */
export function hasFormE2eResult(result: AuditResult): boolean {
  if (result.audit !== "form-e2e") return false;
  const d = result.details as FormE2eDetails | undefined;
  return !!d && typeof d.checkedAt === "string";
}

/** Extract the Airtable-writable form-e2e verdict (pass/fail/null + checked-at). */
export function formE2eResultFromAudit(result: AuditResult): FormE2eResult {
  if (result.audit !== "form-e2e") {
    throw new Error(`Expected a 'form-e2e' AuditResult, got '${result.audit}'`);
  }
  const d = result.details as FormE2eDetails | undefined;
  const ok = d?.ok === "pass" ? "pass" : d?.ok === "fail" ? "fail" : null;
  return {
    ok,
    checkedAt: typeof d?.checkedAt === "string" ? d.checkedAt : new Date().toISOString(),
  };
}
```

- [ ] **Step 5: wire the collect-and-write block** in `src/audits/write-audits-to-airtable.ts`.

5a. Add `FormE2eResult` to the `import type { … } from "../reports/airtable/websites.js";` block and the extractor import:

```ts
  NetlifyDeployResult,
  SmokeResult,
  FormE2eResult,
} from "../reports/airtable/websites.js";
```

```ts
import { hasSmokeResult, smokeResultFromAudit } from "./smoke-airtable.js";
import { hasFormE2eResult, formE2eResultFromAudit } from "./form-e2e-airtable.js";
```

5b. Extend the merged `audits` accumulator type (after `smoke?`):

```ts
    smoke?: SmokeResult;
    formE2e?: FormE2eResult;
  } = {};
```

5c. Add the collect block (after the `smoke` block):

```ts
const formE2e = results.find((r) => r.audit === "form-e2e");
if (formE2e && hasFormE2eResult(formE2e)) {
  const result = formE2eResultFromAudit(formE2e);
  audits.formE2e = result;
  writes.push({ audit: "form-e2e", counts: result });
}
```

(The `WriteSummary.audit` union already gained `"form-e2e"` in Task 2 Step 5b.)

- [ ] **Step 6: default the new fields in the test helper.** Edit `tests/_helpers/website-row.ts` (after `lastSmokeAt`):

```ts
    lastSmokeAt: null,
    formE2eOk: null,
    formE2eCheckedAt: null,
```

- [ ] **Step 7: extend the write-back integration test.** Add to `tests/audits/write-audits-to-airtable.test.ts`. A factory:

```ts
const formE2eResult = (ok: "pass" | "fail" | null): AuditResult =>
  ({
    audit: "form-e2e",
    site: "acme",
    status: ok === "pass" ? "pass" : ok === "fail" ? "warn" : "skip",
    summary: "ok",
    details: { ok, formPresent: ok !== null, checkedAt: "2026-07-06T00:00:00.000Z" },
  }) as unknown as AuditResult;
```

Then two tests:

```ts
it("writes the Form E2E OK verdict + checked-at from a form-e2e result", async () => {
  const { base, calls } = makeFakeBase();
  await writeAuditsToAirtable({
    base,
    websites: [row()],
    slug: "acme",
    results: [formE2eResult("pass")],
  });
  expect(calls[0]?.fields).toMatchObject({
    "Form E2E OK": "pass",
    "Form E2E checked at": "2026-07-06T00:00:00.000Z",
  });
});

it("clears Form E2E OK (n/a) but stamps checked-at when there is no contact form", async () => {
  const { base, calls } = makeFakeBase();
  await writeAuditsToAirtable({
    base,
    websites: [row()],
    slug: "acme",
    results: [formE2eResult(null)],
  });
  // null verdict clears the cell; a fresh checked-at distinguishes n/a from never-ran.
  expect(calls[0]?.fields["Form E2E OK"]).toBeNull();
  expect(calls[0]?.fields["Form E2E checked at"]).toBe("2026-07-06T00:00:00.000Z");
});
```

- [ ] **Step 8: run → PASS.** `pnpm exec vitest run tests/audits/form-e2e-airtable.test.ts tests/audits/write-audits-to-airtable.test.ts` — expected: all passing. Then `pnpm typecheck` — expected: clean.

- [ ] **Step 9: commit.** `git add -A && git commit -m "feat(audits): persist Form E2E OK verdict (n/a-aware) writeback + read-back"`

---

## Task 5: central ingest `testMode` branch — suppress ALL routing + skip Turnstile

**Files:** Modify `src/forms/ingest.ts`, `tests/forms/ingest.test.ts`.

- [ ] **Step 1: write the failing tests** — add to `tests/forms/ingest.test.ts` (inside `describe("ingestSubmission", …)`):

```ts
it("testMode: suppresses ALL routing — no row, no notify, no fan-out — and accepts", async () => {
  const forwardNewsletter = vi.fn().mockResolvedValue({ ok: true, status: 200 });
  const addToMailchimp = vi.fn().mockResolvedValue({ ok: true, status: 200 });
  const d = deps({ forwardNewsletter, addToMailchimp });
  const r = await ingestSubmission(d, "acme", {
    email: "monitor+e2e@reddoorla.com",
    message: "hi",
    testMode: true,
  });
  expect(r).toEqual({ status: "accepted", submissionId: "test-mode", notifyStatus: "skipped" });
  expect(d.createSubmission).not.toHaveBeenCalled();
  expect(d.notify).not.toHaveBeenCalled();
  expect(d.stampNotified).not.toHaveBeenCalled();
  expect(forwardNewsletter).not.toHaveBeenCalled();
  expect(addToMailchimp).not.toHaveBeenCalled();
});

it("testMode: bypasses Turnstile enforcement even on a requireTurnstile site with a fail token", async () => {
  const d = deps({
    getWebsiteBySlug: vi
      .fn()
      .mockResolvedValue(makeWebsiteRow({ id: "recSITE", requireTurnstile: true })),
  });
  // 4th arg "fail" would auto-spam a normal submission; testMode routes away entirely.
  const r = await ingestSubmission(d, "acme", { email: "a@b.co", testMode: true }, "fail");
  expect(r.status).toBe("accepted");
  if (r.status === "accepted") expect(r.notifyStatus).toBe("skipped");
  expect(d.createSubmission).not.toHaveBeenCalled();
});

it("testMode: still validates the payload first (a junk body is rejected, not smuggled through)", async () => {
  const d = deps();
  const r = await ingestSubmission(d, "acme", { testMode: true });
  expect(r.status).toBe("rejected");
  expect(d.createSubmission).not.toHaveBeenCalled();
});

it("testMode: an unknown site still returns unknown-site (marker grants no bypass of resolution)", async () => {
  const d = deps({ getWebsiteBySlug: vi.fn().mockResolvedValue(null) });
  const r = await ingestSubmission(d, "nope", { email: "a@b.co", testMode: true });
  expect(r).toEqual({ status: "unknown-site", slug: "nope" });
});

it("a normal submission (no testMode) is unaffected — still persists + notifies", async () => {
  const d = deps();
  const r = await ingestSubmission(d, "acme", { email: "a@b.co", message: "hi" });
  expect(r.status).toBe("accepted");
  expect(d.createSubmission).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: run → FAIL.** `pnpm exec vitest run tests/forms/ingest.test.ts` — expected: the four testMode tests fail (`createSubmission` IS called; `submissionId` is `recSUB` not `test-mode`).

- [ ] **Step 3: implement the branch + the marker reader** — edit `src/forms/ingest.ts`.

3a. Insert the short-circuit right after the site-resolution guard (after `if (!site) return { status: "unknown-site", slug };`, before `const n = normalized.value;`):

```ts
const site = await deps.getWebsiteBySlug(slug);
if (!site) return { status: "unknown-site", slug };

// Synthetic end-to-end probe (the `form-e2e` fleet audit). A central-only marker
// on the payload routes the submission away from EVERY real sink: no row is
// persisted, no spam classification, no operator/autoresponder email, no
// newsletter fan-out — and Turnstile enforcement is bypassed (the short-circuit
// sits before that check). The marker therefore grants a bot NO benefit: it
// reaches no inbox/DB/webhook, so skipping Turnstile costs nothing. This
// suppression MUST be central — the submitting site alone cannot stop the real
// inbox firing. Validity + site resolution are still enforced above (a junk body
// is rejected, an unknown slug is unknown-site), so the marker can't smuggle
// anything through. Return accepted+skipped so the probe asserts success.
if (isTestMode(rawPayload)) {
  return { status: "accepted", submissionId: "test-mode", notifyStatus: "skipped" };
}

const n = normalized.value;
```

3b. Add the exported marker reader at the bottom of `src/forms/ingest.ts`:

```ts
/** True when an untrusted ingest payload carries the synthetic-probe marker
 *  (top-level `testMode: true`). Read from the RAW payload so the branch never
 *  depends on normalization internals; any non-`true` value is ignored (a real
 *  visitor's form never sets it — the starter only forwards it when the submitted
 *  form field `testMode` equals "true"). */
export function isTestMode(rawPayload: unknown): boolean {
  if (!rawPayload || typeof rawPayload !== "object") return false;
  return (rawPayload as Record<string, unknown>).testMode === true;
}
```

- [ ] **Step 4: run → PASS.** `pnpm exec vitest run tests/forms/ingest.test.ts` — expected: all passing (new + existing). Then `pnpm typecheck` — expected: clean.

- [ ] **Step 5: verify `test:dist` (forms subpath is central-dep-free).** `pnpm build && node scripts/smoke-dist.mjs` — expected OK. (`ingest.ts` is not on the `./forms` public subpath — it's central-only — but confirm the build still passes the gate.)

- [ ] **Step 6: commit.** `git add -A && git commit -m "feat(forms): central testMode branch suppresses routing + skips Turnstile for the form-e2e probe"`

---

## Task 6: reddoor-starter — forward the `testMode` marker from the contact form

**Files:** Modify `reddoor-starter/src/routes/contact/+page.server.ts`.

This is the ONLY reddoor-starter change the test-mode pass-through needs. The contact `.svelte` is unchanged — the `form-e2e` audit injects a hidden `testMode` input into the form via Playwright before submit; a real visitor's form never carries it, so `buildPayload` only forwards it when present and equal to `"true"`. The marker rides through as an extraField (no schema change).

- [ ] **Step 1: edit `buildPayload`.** In `reddoor-starter/src/routes/contact/+page.server.ts`, change the `buildPayload` mapping:

```ts
    buildPayload: (form, event) => ({
      name: form.get("name")?.toString(),
      email: form.get("email")?.toString(),
      phone: form.get("phone")?.toString(),
      message: form.get("message")?.toString(),
      // Full URL incl. query string so UTM/campaign params (?utm_source=…) are captured.
      sourceUrl: event.url.href,
      // Synthetic end-to-end probe marker (the fleet `form-e2e` audit). Forwarded
      // ONLY when the submitted form carries testMode=true — a real visitor never
      // sets it. Rides through as an extraField (no schema change); central ingest
      // recognizes it and routes the submission away from every real sink.
      ...(form.get("testMode")?.toString() === "true" ? { testMode: true } : {}),
    }),
```

- [ ] **Step 2: verify the starter still checks + builds.** In the starter: `pnpm check` — expected: no new svelte-check/tsc errors (the spread is type-safe: `SubmissionPayload` has an index signature `[key: string]: unknown`, so `testMode` is accepted). `pnpm build` — expected: clean.

- [ ] **Step 3: (documentation) confirm the end-to-end contract.** No unit test is added in the starter (the action's `buildPayload` is an inline closure; it is exercised end-to-end by the `form-e2e` audit against a deploy preview). Confirm by reading: the marker's full round trip is `contact/+page.server.ts buildPayload` → `createIngestAction` merges `formType`+`_meta` → `submitToIngest` POSTs `{…, testMode:true}` to `FORMS_INGEST_URL` → central Netlify `form-ingest.mts` → `ingestSubmission(deps, slug, rawPayload, turnstile)` → `isTestMode(rawPayload)` short-circuit (Task 5). `verifyTurnstile` still runs in the handler but its outcome is ignored by the testMode branch.

- [ ] **Step 4: commit (in reddoor-starter).** `git add -A && git commit -m "feat(forms): forward testMode marker from the contact form for the form-e2e health probe"`

---

## Cross-plan / cross-repo notes

- **`toVerdict` is a shared helper.** This plan introduces `toVerdict` in `websites.ts` for `Smoke OK` / `Form E2E OK`. The sibling health-gate plan (Function health + browser `reachableOk`/`titleMetaOk`) needs the SAME single-select reader. Whichever plan lands second must NOT redeclare it — reuse the one added here (or the coordinator lifts it to a shared spot). Flagged in Open items.
- **`smoke` port contract (`REDDOOR_SMOKE_PORT`) is honored in reddoor-starter Phase 4.** The `smoke` audit allocates a free port and exports it as `REDDOOR_SMOKE_PORT`; the starter's shared smoke playwright config (Spec Phase 4, a SEPARATE plan) must read it to pass `--port <n> --strictPort` to `vite:dev`. Until Phase 4 wires that, the audit still functions (verdict from exit code) — it just loses the zombie-vite immunity. Cross-repo dependency, flagged in Open items.
- **`pnpm test:smoke` must exist in each site.** The `smoke` audit invokes `pnpm test:smoke` in the checkout; that script is promoted into the starter in Spec Phase 4. A site without it makes the audit red (non-zero exit). Sequenced by the spec (Phase 5 dependsOn 4).
- **Plan 4 owns the evidence functions.** This plan makes the audits WRITE `smokeOk`/`lastSmokeAt`/`formE2eOk`/`formE2eCheckedAt`. `interactionsEvidence` (reads `smokeOk`, fresh via `lastSmokeAt`) and `formsEvidence` (reads `formE2eOk`, fresh via `formE2eCheckedAt`; result `"n/a"` when null-verdict-but-fresh-checkedAt = no contact form) are Plan 4. The `EvidenceResult`/`EvidenceRecord`/`STALE_DAYS` widening and the gate predicate are NOT touched here.

## Self-review / coverage checklist

- Every new `src` file ships with a test: `smoke.ts`→`smoke.test.ts`, `smoke-airtable.ts`→`smoke-airtable.test.ts`, `form-e2e.ts`→`form-e2e.test.ts` (fake runner covers the pure core; `defaultFormRunner` is the untested live tail like `defaultBrowserRunner`), `form-e2e-airtable.ts`→`form-e2e-airtable.test.ts`. Modified files (`websites.ts`, `write-audits-to-airtable.ts`, `ingest.ts`, `audit.ts`) gain covering assertions.
- `test:dist` stays green: `smoke.ts` + `form-e2e.ts` (in the audit static graph via REGISTRY) import airtable/websites types with `import type` only and lazy-`import()` Playwright; the `-airtable` extractors are reached only through the dynamically-imported `write-audits-to-airtable.ts`.
- Null-clears-cell honored: `formE2eFields` writes `null` to clear the single-select (n/a), stamped with a fresh checked-at; `smokeFields` only ever writes a concrete verdict (skip produces no `SmokeResult`).
- Working-tree-clean tripwire respected: all tests inject fakes / write nothing to the repo tree (smoke/form-e2e tests never spawn a real process or launch a real browser).
