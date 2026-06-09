# M2.1 — Deployed-URL Lighthouse Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the Lighthouse audit run against a site's **deployed URL** (no local checkout, no dev server), as the keystone for fleet-scale auditing.

**Architecture:** Add an optional `Site.deployedUrl`. When set, `lighthouseAudit` takes a new branch that runs `lhci autorun` against that URL directly (no `startServerCommand`, a throwaway tmp cwd, `numberOfRuns: 3`, filesystem upload) and reuses the existing lhr/assertion parsing. Expose it via a single-site `--url` CLI flag. The checkout-based mode is untouched, so all existing audit behavior and tests stay green.

**Tech Stack:** TypeScript, `@lhci/cli` (`lhci autorun`), Vitest, `cac` (CLI).

**Out of scope (later sub-plans):** sourcing ~200 deployed URLs from Airtable + the sharded GitHub Actions matrix on a central cron (**M2.2**); the client-visible score-baseline transition + the dashboard "trigger audit" button (**M2.3**); moving the **a11y** audit to deployed URLs (deferred — decided 2026-06-09). Median-of-N (vs. the average-of-3 used here) is a noted future refinement if perf variance proves noisy — see [[m2-audits-at-scale-direction]].

**Context the implementer needs:**

- The Lighthouse audit today ([src/audits/lighthouse.ts](../../../src/audits/lighthouse.ts)) is checkout-bound: it spawns `npm run vite:dev` and audits `http://localhost:<port>/dev/a11y-fixtures` (a synthetic fixtures page), desktop preset, 1 run. The fixtures-page default is why current scores don't reflect the real site — this plan fixes that for deployed mode.
- `runOneAudit(site, name)` → `REGISTRY[name]({ site, spawn })`. `AuditContext = { site, spawn? }`. The audit reads `ctx.spawn ?? defaultSpawn`, so tests inject a fake `spawn` that writes the `.lighthouseci/` artifacts the audit parses. **All tests below use that pattern — never real `lhci`.**
- `SpawnFn`/`SpawnResult` come from [src/audits/util/spawn.ts](../../../src/audits/util/spawn.ts); `SpawnResult = { code, stdout, stderr }`.
- A real `lhci collect --url=<deployed>` against a deployed site was verified working during the M2 spot-check (~30s/run, no dev server): CalTex `caltexmedical.com` → P92/A100/BP78/SEO92.

---

### Task 1: Add deployed-URL mode to the Lighthouse audit

**Files:**

- Modify: `src/types.ts` (add `Site.deployedUrl`)
- Modify: `src/audits/lighthouse.ts` (dispatcher + new `deployedLighthouse`, extract shared `parseLhciResults`)
- Test: `tests/audits/lighthouse.test.ts` (new `describe("deployed-URL mode …")`)

- [ ] **Step 1: Write the failing test**

Add this block inside the top-level `describe("audits/lighthouse", …)` in `tests/audits/lighthouse.test.ts`, after the existing `describe("lhci 0.15+ output …")` block (before the final closing `});`):

```typescript
describe("deployed-URL mode (no dev server)", () => {
  /** A spawn that captures the lhci `ci` config block and the cwd it ran in,
   * then writes a 3-run passing result so the audit's parser succeeds. */
  function captureCiSpawn(): {
    spawn: SpawnFn;
    getCi: () => {
      collect: {
        url: string[];
        numberOfRuns: number;
        startServerCommand?: string;
        settings: { preset: string };
      };
      upload: { target: string };
    };
    getCwd: () => string | undefined;
  } {
    let ci: ReturnType<ReturnType<typeof captureCiSpawn>["getCi"]> | undefined;
    let cwdUsed: string | undefined;
    const spawn: SpawnFn = async (_cmd, args, opts): Promise<SpawnResult> => {
      const cfgArg = args.find((a) => a.startsWith("--config="));
      if (cfgArg) {
        const raw = await readFile(cfgArg.slice("--config=".length), "utf-8");
        ci = (JSON.parse(raw) as { ci: typeof ci }).ci;
      }
      cwdUsed = opts?.cwd;
      const dir = join(opts?.cwd ?? process.cwd(), ".lighthouseci");
      await mkdir(dir, { recursive: true });
      for (let i = 0; i < 3; i++) {
        await writeFile(
          join(dir, `lhr-${i}.json`),
          JSON.stringify({
            requestedUrl: "https://www.caltexmedical.com/",
            categories: {
              performance: { score: 0.92 },
              accessibility: { score: 1 },
              "best-practices": { score: 0.78 },
              seo: { score: 0.92 },
            },
          }),
          "utf-8",
        );
      }
      await writeFile(join(dir, "assertion-results.json"), "[]", "utf-8");
      return { code: 0, stdout: "", stderr: "" };
    };
    return {
      spawn,
      getCi: () => {
        if (!ci) throw new Error("spawn was never called with a --config");
        return ci;
      },
      getCwd: () => cwdUsed,
    };
  }

  it("audits the deployed URL directly with no startServerCommand", async () => {
    const { spawn, getCi } = captureCiSpawn();
    const result = await lighthouseAudit({
      site: { path: "/does/not/exist", deployedUrl: "https://www.caltexmedical.com/" },
      spawn,
    });
    expect(result.status).toBe("pass");
    const ci = getCi();
    expect(ci.collect.url).toEqual(["https://www.caltexmedical.com/"]);
    expect(ci.collect.startServerCommand).toBeUndefined();
    expect(ci.collect.numberOfRuns).toBe(3);
    expect(ci.collect.settings.preset).toBe("desktop");
    const details = result.details as { summary: Record<string, number> };
    expect(details.summary["best-practices"]).toBe(0.78);
  });

  it("never uses site.path as the lhci cwd (no checkout required)", async () => {
    const { spawn, getCwd } = captureCiSpawn();
    await lighthouseAudit({
      site: { path: "/does/not/exist/checkout", deployedUrl: "https://x.example/" },
      spawn,
    });
    expect(getCwd()).toBeDefined();
    expect(getCwd()).not.toBe("/does/not/exist/checkout");
  });

  it("uploads to the filesystem, never public storage (no 200 public uploads at fleet scale)", async () => {
    const { spawn, getCi } = captureCiSpawn();
    await lighthouseAudit({ site: { path: "/x", deployedUrl: "https://x.example/" }, spawn });
    expect(getCi().upload.target).toBe("filesystem");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/audits/lighthouse.test.ts`
Expected: the three new tests FAIL. The first failure is a TypeScript error — `deployedUrl` is not a property of `Site` — and/or the audit ignores `deployedUrl` and tries the checkout path. (Compile error counts as the red signal here.)

- [ ] **Step 3: Add the `deployedUrl` field to `Site`**

In `src/types.ts`, change the `Site` type:

```typescript
export type Site = {
  path: string;
  name?: string;
  repoUrl?: string;
  /** GitHub repo identity as `owner/repo`, when known (from Airtable). */
  gitRepo?: string;
  /** Deployed/production URL. When set, the lighthouse audit runs against this
   *  URL directly (no checkout, no dev server) instead of a local vite server. */
  deployedUrl?: string;
  meta?: Record<string, unknown>;
};
```

- [ ] **Step 4: Refactor `lighthouse.ts` into a dispatcher + checkout/deployed branches sharing the parser**

In `src/audits/lighthouse.ts`:

(a) Update the imports at the top of the file:

```typescript
import type { AuditResult, Site } from "../types.js";
import { siteLabel } from "../util/site.js";
import { lighthouseConfig } from "../configs/lighthouse.js";
import { defaultSpawn } from "./util/spawn.js";
import type { SpawnFn, SpawnResult } from "./util/spawn.js";
import type { AuditContext } from "./util/inject.js";
import { readSiteConfig } from "./util/site-config.js";
import { findFreePort, withFreePort } from "../util/free-port.js";
```

(b) Replace the entire `export async function lighthouseAudit(ctx: AuditContext)` function (current lines 104–207) with the dispatcher + three functions below. Leave every other function in the file (`readLhrEntries`, `averageSummaries`, `categoryFromAssertion`, `messageForAssertion`, the types) exactly as-is.

```typescript
/** Shared tail: scan `.lighthouseci/` for lhr-*.json + assertion-results.json and
 *  build the AuditResult. Identical for the checkout and deployed paths. */
async function parseLhciResults(
  resultsDir: string,
  label: string,
  raw: SpawnResult,
): Promise<AuditResult> {
  const manifest = await readLhrEntries(resultsDir);

  if (manifest.length === 0) {
    return {
      audit: "lighthouse",
      site: label,
      status: "fail",
      summary: `lighthouse: no lhr-*.json written (exit ${raw.code})${
        raw.stderr ? ` — ${raw.stderr.slice(0, 200)}` : ""
      }`,
    };
  }

  const assertionResults =
    (await readJsonMaybe<AssertionResult[]>(join(resultsDir, "assertion-results.json"))) ?? [];

  const failed = assertionResults.filter((a) => !a.passed);
  const assertions = failed.map((a) => ({
    category: categoryFromAssertion(a),
    level: a.level,
    message: messageForAssertion(a),
  }));

  const anyError = assertions.some((a) => a.level === "error");
  const anyWarn = assertions.some((a) => a.level === "warn");
  const status: AuditResult["status"] = anyError ? "fail" : anyWarn ? "warn" : "pass";

  const normalized: NormalizedLhciResult = {
    summary: averageSummaries(manifest),
    assertionsFailed: failed.length,
    assertions,
  };

  const summary =
    status === "pass"
      ? "lighthouse: all categories passing"
      : `lighthouse: ${failed.length} assertion(s) failed`;

  return { audit: "lighthouse", site: label, status, summary, details: normalized };
}

/** Checkout mode (unchanged behavior): boot the site's vite dev server on a
 *  pinned free port and audit the local fixtures/override URL. */
async function checkoutLighthouse(spawn: SpawnFn, site: Site, label: string): Promise<AuditResult> {
  const siteCfg = await readSiteConfig(site.path);
  // Allocate a free port + force vite to `--strictPort` so the spawned dev
  // server either binds the port we picked or fails loudly (caltex 2026-05-28
  // zombie-vite incident).
  const port = await findFreePort();
  const baseUrl = siteCfg.lighthouseUrl ?? lighthouseConfig.ci.collect.url[0];
  const resolvedConfig = {
    ...lighthouseConfig,
    ci: {
      ...lighthouseConfig.ci,
      collect: {
        ...lighthouseConfig.ci.collect,
        url: [withFreePort(baseUrl, port)],
        startServerCommand: `npm run vite:dev -- --port ${port} --strictPort`,
      },
    },
  };

  const configDir = await mkdtemp(join(tmpdir(), "reddoor-lhci-"));
  const configPath = join(configDir, "lighthouserc.json");
  await writeFile(configPath, JSON.stringify(resolvedConfig), "utf-8");

  const resultsDir = join(site.path, ".lighthouseci");
  await rm(resultsDir, { recursive: true, force: true });

  let raw: SpawnResult;
  try {
    raw = await spawn("npx", ["--yes", "@lhci/cli", "autorun", `--config=${configPath}`], {
      cwd: site.path,
      timeoutMs: 5 * 60_000,
    });
  } catch (err) {
    await rm(configDir, { recursive: true, force: true });
    const e = err as NodeJS.ErrnoException;
    if (e.code === "ENOENT" || /ENOENT/.test(String(err))) {
      return {
        audit: "lighthouse",
        site: label,
        status: "skip",
        summary: "npx/@lhci/cli not available",
      };
    }
    throw err;
  }
  await rm(configDir, { recursive: true, force: true });

  return parseLhciResults(resultsDir, label, raw);
}

/** Deployed mode: audit a production URL directly — no checkout, no dev server.
 *  Runs in a throwaway tmp cwd; uploads to the filesystem so fleet runs never
 *  push 200 public reports to temporary-public-storage. */
async function deployedLighthouse(
  spawn: SpawnFn,
  deployedUrl: string,
  label: string,
): Promise<AuditResult> {
  const workDir = await mkdtemp(join(tmpdir(), "reddoor-lh-deployed-"));
  const resolvedConfig = {
    ci: {
      collect: {
        url: [deployedUrl],
        // 3 runs to damp Lighthouse's run-to-run variance; parseLhciResults
        // averages the lhr files. (Median is a tracked future refinement.)
        numberOfRuns: 3,
        settings: { preset: "desktop", skipAudits: ["uses-http2"] },
      },
      assert: lighthouseConfig.ci.assert,
      upload: { target: "filesystem", outputDir: join(workDir, "lhci-report") },
    },
  };

  const configPath = join(workDir, "lighthouserc.json");
  await writeFile(configPath, JSON.stringify(resolvedConfig), "utf-8");

  const resultsDir = join(workDir, ".lighthouseci");
  await rm(resultsDir, { recursive: true, force: true });

  let raw: SpawnResult;
  try {
    raw = await spawn("npx", ["--yes", "@lhci/cli", "autorun", `--config=${configPath}`], {
      cwd: workDir,
      // No dev-server boot: ~30s/run × 3 + first-use Chrome download headroom.
      timeoutMs: 3 * 60_000,
    });
  } catch (err) {
    await rm(workDir, { recursive: true, force: true });
    const e = err as NodeJS.ErrnoException;
    if (e.code === "ENOENT" || /ENOENT/.test(String(err))) {
      return {
        audit: "lighthouse",
        site: label,
        status: "skip",
        summary: "npx/@lhci/cli not available",
      };
    }
    throw err;
  }

  const result = await parseLhciResults(resultsDir, label, raw);
  await rm(workDir, { recursive: true, force: true });
  return result;
}

export async function lighthouseAudit(ctx: AuditContext): Promise<AuditResult> {
  const spawn = ctx.spawn ?? defaultSpawn;
  const site = ctx.site;
  const label = siteLabel(site);

  return site.deployedUrl
    ? deployedLighthouse(spawn, site.deployedUrl, label)
    : checkoutLighthouse(spawn, site, label);
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm exec vitest run tests/audits/lighthouse.test.ts`
Expected: PASS — the 3 new deployed-mode tests **and** all pre-existing checkout/port-hardening/lhci-0.15 tests (the refactor must not change checkout behavior).

- [ ] **Step 6: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: clean (no errors).

- [ ] **Step 7: Commit**

```bash
git add src/types.ts src/audits/lighthouse.ts tests/audits/lighthouse.test.ts
git commit -m "feat(lighthouse): audit a deployed URL when site.deployedUrl is set

Adds a deployed-URL branch (no checkout, no dev server) alongside the existing
checkout/vite path, sharing the lhr+assertion parser. 3 runs, desktop preset,
filesystem upload (no public uploads at fleet scale). Keystone for M2 audits-at-scale.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Expose deployed mode via a single-site `--url` CLI flag

**Files:**

- Modify: `src/cli/commands/audit.ts` (export `applyDeployedUrl`, wire into `runAuditCommand`, add `url` option type, `--fleet` guard)
- Modify: `src/cli/bin.ts` (register `--url` option + action opts type)
- Test: `tests/cli/audit-deployed-url.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `tests/cli/audit-deployed-url.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { applyDeployedUrl } from "../../src/cli/commands/audit.js";
import type { Site } from "../../src/types.js";

describe("applyDeployedUrl", () => {
  it("returns sites unchanged when url is undefined", () => {
    const sites: Site[] = [{ path: "/a" }, { path: "/b" }];
    expect(applyDeployedUrl(sites, undefined)).toBe(sites);
  });

  it("sets deployedUrl on the single resolved site", () => {
    const out = applyDeployedUrl([{ path: "/a", name: "Acme" }], "https://acme.example/");
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({ path: "/a", name: "Acme", deployedUrl: "https://acme.example/" });
  });

  it("rejects --url when more than one site resolved (exitCode 2)", () => {
    try {
      applyDeployedUrl([{ path: "/a" }, { path: "/b" }], "https://x/");
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as Error).message).toMatch(/exactly one site/i);
      expect((e as { exitCode?: number }).exitCode).toBe(2);
    }
  });

  it("rejects --url when zero sites resolved (exitCode 2)", () => {
    try {
      applyDeployedUrl([], "https://x/");
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as { exitCode?: number }).exitCode).toBe(2);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/cli/audit-deployed-url.test.ts`
Expected: FAIL — `applyDeployedUrl` is not exported from `audit.ts` (import error).

- [ ] **Step 3: Add `applyDeployedUrl` and wire it into the command**

In `src/cli/commands/audit.ts`:

(a) Add `Site` to the existing type import and add `url` to the options type:

```typescript
import type { AuditName, AuditResult, Site } from "../../types.js";
```

```typescript
export type AuditCommandOptions = {
  only?: string;
  json?: boolean;
  fleet?: string;
  workdir?: string;
  cwd?: string;
  writeAirtable?: string | boolean;
  failOnViolations?: boolean;
  /** Audit this deployed URL directly (lighthouse only; single-site). */
  url?: string;
};
```

(b) Add the exported helper (place it just above `runAuditCommand`):

```typescript
/** Apply a single-site `--url` to the resolved sites. Returns the input
 *  untouched when no url is given; otherwise requires exactly one site and
 *  stamps `deployedUrl` on it so the lighthouse audit takes its deployed path. */
export function applyDeployedUrl(sites: Site[], url: string | undefined): Site[] {
  if (url === undefined) return sites;
  if (sites.length !== 1) {
    throw Object.assign(
      new Error(`--url expects exactly one site, but ${sites.length} resolved.`),
      { exitCode: 2 },
    );
  }
  return [{ ...sites[0]!, deployedUrl: url }];
}
```

(c) Guard against `--url --fleet` next to the existing `--write-airtable`/`--fleet` guard inside `runAuditCommand`:

```typescript
if (opts.url !== undefined && opts.fleet !== undefined) {
  throw Object.assign(new Error("--url is single-site only and cannot be combined with --fleet."), {
    exitCode: 2,
  });
}
```

(d) Apply it right after `resolveSites` returns (before the `if (opts.fleet)` clone block). Change:

```typescript
  let sites = await resolveSites({
    ...(site !== undefined ? { site } : {}),
    ...(opts.fleet !== undefined ? { fleet: opts.fleet } : {}),
    ...(opts.workdir !== undefined ? { workdir: opts.workdir } : {}),
    cwd,
  });

  sites = applyDeployedUrl(sites, opts.url);

  if (opts.fleet) {
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm exec vitest run tests/cli/audit-deployed-url.test.ts`
Expected: PASS.

- [ ] **Step 5: Register the `--url` flag in the CLI entrypoint**

In `src/cli/bin.ts`, add the option to the `audit` command (after the `--fail-on-violations` option, before `.action(`) and add `url?: string` to the action's `opts` type:

```typescript
  .option("--fail-on-violations", "Exit non-zero if any a11y violations are found (for CI gates)")
  .option(
    "--url <url>",
    "Audit this deployed URL directly instead of a local dev server (lighthouse only; single-site).",
  )
  .action(
    async (
      site,
      opts: {
        only?: string;
        json?: boolean;
        fleet?: string;
        workdir?: string;
        cwd?: string;
        verbose?: boolean;
        writeAirtable?: string | boolean;
        failOnViolations?: boolean;
        url?: string;
      },
    ) => runOrExit(() => runAuditCommand(site, opts), opts),
  );
```

- [ ] **Step 6: Typecheck + full test suite**

Run: `pnpm exec tsc --noEmit && pnpm exec vitest run`
Expected: clean typecheck; all tests pass (new + existing).

- [ ] **Step 7: Lint**

Run: `pnpm lint`
Expected: clean (eslint + prettier). If prettier flags either changed file, run `pnpm exec prettier --write` on it and re-check.

- [ ] **Step 8: Commit**

```bash
git add src/cli/commands/audit.ts src/cli/bin.ts tests/cli/audit-deployed-url.test.ts
git commit -m "feat(audit): add single-site --url flag to audit a deployed URL

\`reddoor-maint audit --only lighthouse --url <deployed>\` runs the lighthouse
audit against the deployed site (no checkout). Rejects --url with --fleet or a
non-single-site resolution.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Real-run verification against a deployed fleet site

This task runs the real audit (no mocks) to confirm the deployed path works end-to-end and that the Airtable write path is unchanged. No new code.

- [ ] **Step 1: Build the CLI**

Run: `pnpm build`
Expected: tsup build succeeds.

- [ ] **Step 2: Run the deployed Lighthouse audit against CalTex (no Airtable write)**

Run: `pnpm exec tsx src/cli/bin.ts audit --only lighthouse --url https://www.caltexmedical.com/`
Expected: completes in ~1–2 min (3 runs, no dev server). Output shows a `lighthouse` row whose status reflects the **real** site. Sanity-check against the M2 spot-check (P≈92, BP≈78, SEO≈92) — Best Practices will be well below the 0.9 error threshold, so the audit status will be `fail`, and that is correct (it reflects real-site debt, not a bug).

- [ ] **Step 3: Confirm the Airtable write path is unchanged**

The deployed `AuditResult` has the same `{ audit, site, status, summary, details: { summary } }` shape as checkout mode, so `writeAuditsToAirtable` needs no change. Verify by reading the writer and confirming it consumes only `details.summary` category scores (not anything checkout-specific):

Run: `grep -n "details\|summary\|performance\|accessibility" src/audits/write-audits-to-airtable.ts | head`
Expected: it reads `details.summary` category scores — confirming deployed results write identically. (Do **not** run `--write-airtable` here; that mutates the live CalTex row. The M2.2 fleet wiring will own real writes.)

- [ ] **Step 4: Final commit (docs/notes only, if any)**

If Step 2 surfaced anything worth recording (e.g., the real CalTex score set), note it in the commit; otherwise no commit is needed for this verification task.

---

## Self-Review

**Spec coverage:**

- "Lighthouse runs against a deployed URL, no checkout/dev server" → Task 1 (`deployedLighthouse`). ✓
- "CLI-runnable" → Task 2 (`--url`). ✓
- "Don't break checkout mode" → Task 1 keeps `checkoutLighthouse` byte-identical and re-runs the full existing suite (Task 1 Step 5, Task 2 Step 6). ✓
- "No public uploads at fleet scale" → filesystem upload target + test (Task 1). ✓
- a11y deployed mode, Airtable URL sourcing, CI matrix → correctly deferred to M2.2/M2.3 (stated in header). ✓

**Placeholder scan:** No TBD/TODO; every code/test step shows complete code and an exact command with expected output. ✓

**Type consistency:** `Site.deployedUrl?: string` (types.ts) is read in `lighthouseAudit`, set by `applyDeployedUrl`, and asserted in both test files. `parseLhciResults(resultsDir, label, raw: SpawnResult)` is called identically from `checkoutLighthouse` and `deployedLighthouse`. `applyDeployedUrl(sites, url)` signature matches its test and its `runAuditCommand` call site. ✓
