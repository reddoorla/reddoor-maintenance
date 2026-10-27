# M2.2a — Fleet Deployed-URL Lighthouse (CLI) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `reddoor-maint audit --fleet airtable --only lighthouse --write-airtable` audit every active site's **deployed URL** (no checkout) and write each site's scores back to its own Airtable row.

**Architecture:** Source `Site.deployedUrl` from the Airtable `url` field (filtered to `maintenance`/`launch period` sites with a URL), skip cloning for deployed-Lighthouse-capable sites, and add a best-effort fleet write-back that groups pooled results by site slug and reuses the existing single-site writer. Builds on M2.1 (`Site.deployedUrl` + deployed audit mode, PR #131).

**Tech Stack:** TypeScript, Vitest, the existing Airtable inventory + write helpers, `cac` CLI.

**Out of scope:** the nightly `schedule:` GitHub Actions workflow that invokes this command (**M2.2b**); cron-sharding (deferred — the fleet is ~12 sites today); a11y/deps/security on deployed URLs (those still require a checkout).

**Context the implementer needs:**

- `fromAirtableBase` ([src/inventory/airtable.ts](../../../src/inventory/airtable.ts)) currently filters by frequency (`maintenanceFreq !== "None" || testingFreq !== "None"`) and wrongly sets `repoUrl = w.url` (the production URL — would `git clone` a website). `WebsiteRow` ([src/reports/airtable/websites.ts](../../../src/reports/airtable/websites.ts)) has `status: Status | null` (values include `"maintenance"`, `"launch period"`, `"deprecated"`, `"hosting"`, …) and `url: string` (always a string via `String(f["url"] ?? "")`, possibly `""`).
- The audit command ([src/cli/commands/audit.ts](../../../src/cli/commands/audit.ts)) clones every fleet site (`cloneIfNeeded`) and **rejects** `--write-airtable`+`--fleet` outright.
- The single-site writer `writeAuditsToAirtable({ base, websites, slug, results })` ([src/audits/write-audits-to-airtable.ts](../../../src/audits/write-audits-to-airtable.ts)) finds the row via `websites.find((w) => siteSlug(w.name) === slug)` and writes lighthouse (+a11y/deps/security if present). It throws (`.exitCode`) when there's no lighthouse result or no real scores.
- `AuditResult.site` is `siteLabel(site)` = `site.name ?? site.path`; the fleet inventory sets `name = siteSlug(displayName)`, so each result is tagged with the site's slug. `siteSlug` is idempotent on an already-slugged string.
- Test harness: inventory + writer tests use `makeFakeBase({ Websites: [{ id, fields }] })` from [tests/reports/\_helpers/fake-airtable-base.ts](../../../tests/reports/_helpers/fake-airtable-base.ts); `listWebsites(base)` reads the seeded `Websites` table; `base.__calls` captures `update`/`select` calls.

---

### Task 1: Source `deployedUrl` from Airtable + status filter + drop the `repoUrl` mis-mapping

**Files:**

- Modify: `src/inventory/airtable.ts`
- Modify (rewrite assertions): `tests/inventory/airtable.test.ts`
- Modify (add `Status` to fixtures): `tests/inventory/airtable-gitrepo.test.ts`

- [ ] **Step 1: Rewrite `tests/inventory/airtable.test.ts` to the new behavior (failing first)**

Replace the ENTIRE body of the `describe("fromAirtableBase", …)` (keep the imports + `beforeEach`) with:

```typescript
describe("fromAirtableBase", () => {
  it("throws if no workdir is provided and REDDOOR_FLEET_WORKDIR isn't set", async () => {
    const base = makeFakeBase({
      Websites: [
        {
          id: "rec_1",
          fields: { Name: "Acme", url: "https://acme.example.com", Status: "maintenance" },
        },
      ],
    });
    await expect(fromAirtableBase(base)()).rejects.toThrow(/workdir/);
  });

  it("returns one Site per maintenance/launch site, with deployedUrl from url and no repoUrl", async () => {
    const base = makeFakeBase({
      Websites: [
        {
          id: "rec_1",
          fields: { Name: "Acme Co", url: "https://acme.example.com", Status: "maintenance" },
        },
        {
          id: "rec_2",
          fields: { Name: "Beta Corp", url: "https://beta.example.com", Status: "launch period" },
        },
      ],
    });
    const sites = await fromAirtableBase(base, { workdir: "/tmp/sites" })();
    expect(sites).toHaveLength(2);
    expect(sites[0]!.name).toBe("acme-co");
    expect(sites[0]!.path).toBe("/tmp/sites/acme-co");
    expect(sites[0]!.deployedUrl).toBe("https://acme.example.com");
    expect(sites[0]!.repoUrl).toBeUndefined(); // production URL must NOT become a clone source
    expect(sites[0]!.meta?.airtableRowId).toBe("rec_1");
    expect(sites[0]!.meta?.displayName).toBe("Acme Co");
  });

  it("excludes sites whose Status is not maintenance or launch period", async () => {
    const base = makeFakeBase({
      Websites: [
        {
          id: "rec_m",
          fields: { Name: "Live", url: "https://live.example", Status: "maintenance" },
        },
        {
          id: "rec_dep",
          fields: { Name: "Old", url: "https://old.example", Status: "deprecated" },
        },
        {
          id: "rec_host",
          fields: { Name: "Hosted", url: "https://hosted.example", Status: "hosting" },
        },
      ],
    });
    const sites = await fromAirtableBase(base, { workdir: "/tmp" })();
    expect(sites.map((s) => s.name)).toEqual(["live"]);
  });

  it("excludes a maintenance site that has no url", async () => {
    const base = makeFakeBase({
      Websites: [
        { id: "rec_nourl", fields: { Name: "NoUrl", Status: "maintenance" } },
        { id: "rec_ok", fields: { Name: "Ok", url: "https://ok.example", Status: "maintenance" } },
      ],
    });
    const sites = await fromAirtableBase(base, { workdir: "/tmp" })();
    expect(sites.map((s) => s.name)).toEqual(["ok"]);
  });

  it("reads workdir from REDDOOR_FLEET_WORKDIR env when no explicit option", async () => {
    process.env.REDDOOR_FLEET_WORKDIR = "/tmp/env-workdir";
    const base = makeFakeBase({
      Websites: [
        { id: "r", fields: { Name: "x", url: "https://x.example", Status: "maintenance" } },
      ],
    });
    const sites = await fromAirtableBase(base)();
    expect(sites[0]!.path).toBe("/tmp/env-workdir/x");
  });

  it("explicit workdir wins over env", async () => {
    process.env.REDDOOR_FLEET_WORKDIR = "/tmp/env-workdir";
    const base = makeFakeBase({
      Websites: [
        { id: "r", fields: { Name: "x", url: "https://x.example", Status: "maintenance" } },
      ],
    });
    const sites = await fromAirtableBase(base, { workdir: "/tmp/explicit" })();
    expect(sites[0]!.path).toBe("/tmp/explicit/x");
  });
});
```

- [ ] **Step 2: Update `tests/inventory/airtable-gitrepo.test.ts` fixtures** — add `Status: "maintenance"` to BOTH fixtures (without it the new status filter excludes them and `sites[0]` is undefined). In the first test's fields add `Status: "maintenance",` and in the second test's fields add `Status: "maintenance",`. Leave the `gitRepo` assertions unchanged.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm exec vitest run tests/inventory/airtable.test.ts tests/inventory/airtable-gitrepo.test.ts`
Expected: FAIL — the current code filters by frequency and sets `repoUrl = w.url` / no `deployedUrl`, so the new `deployedUrl`/`repoUrl`/status-filter assertions fail.

- [ ] **Step 4: Implement the new mapping in `src/inventory/airtable.ts`**

Add this constant above `fromAirtableBase`:

```typescript
/** Only sites we actively run/report on get fleet-audited. */
const AUDITABLE_STATUSES = new Set<string>(["maintenance", "launch period"]);
```

Replace the doc-comment block on `fromAirtableBase` (the paragraph starting "Read sites from the Airtable Websites table…" through the `repoUrl` note) with:

```typescript
/**
 * Read sites from the Airtable Websites table as an InventoryProvider.
 * Each row becomes one Site; `path` is computed as `{workdir}/{slug}`.
 * Only `maintenance` / `launch period` sites that have a `url` are included
 * (the live sites we audit + report on). The production URL is exposed as
 * `Site.deployedUrl` so the lighthouse audit can run against it with no
 * checkout. `repoUrl` is intentionally NOT set from `url` — a clone source
 * must come from `gitRepo` (`owner/repo`), never the production URL.
 */
```

Replace the `return websites.filter(...).map(...)` chain with:

```typescript
const websites = await listWebsites(base);
return websites
  .filter((w) => AUDITABLE_STATUSES.has(w.status ?? "") && w.url.length > 0)
  .map((w) => {
    const slug = siteSlug(w.name);
    const site: Site = {
      path: `${workdir}/${slug}`,
      name: slug,
      deployedUrl: w.url,
      meta: { airtableRowId: w.id, displayName: w.name },
    };
    if (w.gitRepo) site.gitRepo = w.gitRepo;
    return site;
  });
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm exec vitest run tests/inventory/`
Expected: PASS (airtable.test.ts, airtable-gitrepo.test.ts, json.test.ts, local.test.ts).

- [ ] **Step 6: Typecheck + lint + commit**

Run: `pnpm exec tsc --noEmit` (clean) and `pnpm exec prettier --check src/inventory/airtable.ts tests/inventory/airtable.test.ts tests/inventory/airtable-gitrepo.test.ts` (`--write` if needed).

```bash
git add src/inventory/airtable.ts tests/inventory/airtable.test.ts tests/inventory/airtable-gitrepo.test.ts
git commit -m "feat(inventory): source deployedUrl from Airtable; filter to maintenance/launch; drop repoUrl mis-mapping

Fleet inventory now exposes Websites.url as Site.deployedUrl (for deployed-URL
audits) and includes only maintenance/launch sites that have a url. Stops
assigning the production url to Site.repoUrl (it would git-clone a website).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Skip cloning for deployed-Lighthouse-capable sites

**Files:**

- Modify: `src/cli/commands/audit.ts`
- Test: `tests/cli/audit-deployed-url.test.ts` (extend with an `auditNeedsCheckout` block)

- [ ] **Step 1: Write the failing test** — append to `tests/cli/audit-deployed-url.test.ts`:

```typescript
describe("auditNeedsCheckout", () => {
  it("is false for a deployedUrl site auditing lighthouse only (no checkout needed)", () => {
    expect(auditNeedsCheckout({ path: "/x", deployedUrl: "https://x/" }, ["lighthouse"])).toBe(
      false,
    );
  });

  it("is true when a non-lighthouse audit is also requested", () => {
    expect(
      auditNeedsCheckout({ path: "/x", deployedUrl: "https://x/" }, ["lighthouse", "deps"]),
    ).toBe(true);
  });

  it("is true when the site has no deployedUrl", () => {
    expect(auditNeedsCheckout({ path: "/x" }, ["lighthouse"])).toBe(true);
  });
});
```

Add `auditNeedsCheckout` to the import on line 2:
`import { applyDeployedUrl, deployedUrlNotice, auditNeedsCheckout } from "../../src/cli/commands/audit.js";`

Run `pnpm exec vitest run tests/cli/audit-deployed-url.test.ts` → the 3 new tests FAIL (not exported).

- [ ] **Step 2: Implement `auditNeedsCheckout` and use it** in `src/cli/commands/audit.ts`.

Add the exported helper near `applyDeployedUrl`:

```typescript
/** A fleet site needs a local checkout unless every requested audit can run
 *  against its deployed URL. Today only lighthouse has a deployed mode, so a
 *  site is checkout-free exactly when it has a `deployedUrl` and lighthouse is
 *  the only requested audit. */
export function auditNeedsCheckout(site: Site, which: AuditName[]): boolean {
  const deployedCapable = site.deployedUrl !== undefined && which.every((n) => n === "lighthouse");
  return !deployedCapable;
}
```

In `runAuditCommand`, replace the existing fleet clone block:

```typescript
if (opts.fleet) {
  const workdir = opts.workdir ?? `${process.env.HOME ?? ""}/.reddoor-maint/sites`;
  sites = await Promise.all(sites.map((s) => cloneIfNeeded(s, { workdir })));
}
```

with:

```typescript
if (opts.fleet) {
  const workdir = opts.workdir ?? `${process.env.HOME ?? ""}/.reddoor-maint/sites`;
  sites = await Promise.all(
    sites.map((s) =>
      auditNeedsCheckout(s, which) ? cloneIfNeeded(s, { workdir }) : Promise.resolve(s),
    ),
  );
}
```

- [ ] **Step 3: Run tests + typecheck + commit**

Run: `pnpm exec vitest run tests/cli/audit-deployed-url.test.ts` (pass) and `pnpm exec tsc --noEmit` (clean). Prettier-check the file (`--write` if needed).

```bash
git add src/cli/commands/audit.ts tests/cli/audit-deployed-url.test.ts
git commit -m "feat(audit): skip cloning fleet sites that audit lighthouse against a deployed URL

A site with a deployedUrl audited with --only lighthouse needs no checkout, so
fleet runs no longer git-clone it. Other audits still clone (they need the tree).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Fleet write-back to Airtable

**Files:**

- Modify: `src/audits/write-audits-to-airtable.ts` (add `writeFleetAuditsToAirtable`)
- Modify: `src/cli/commands/audit.ts` (relax the guard + branch to the fleet writer)
- Test: `tests/audits/write-fleet-audits.test.ts` (new)

- [ ] **Step 1: Write the failing test** — create `tests/audits/write-fleet-audits.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { writeFleetAuditsToAirtable } from "../../src/audits/write-audits-to-airtable.js";
import { makeFakeBase } from "../reports/_helpers/fake-airtable-base.js";
import type { AuditResult } from "../../src/types.js";

function lhResult(siteSlug: string, scores: Record<string, number>): AuditResult {
  return {
    audit: "lighthouse",
    site: siteSlug,
    status: "pass",
    summary: "",
    details: { summary: scores },
  };
}

const websites = [
  { id: "recA", fields: { Name: "Acme Co", Status: "maintenance" } },
  { id: "recB", fields: { Name: "Beta Corp", Status: "maintenance" } },
];

describe("writeFleetAuditsToAirtable", () => {
  it("writes each site's lighthouse scores to its own row, grouped by result.site slug", async () => {
    const base = makeFakeBase({ Websites: websites });
    const results = [
      lhResult("acme-co", {
        performance: 0.9,
        accessibility: 1,
        "best-practices": 0.78,
        seo: 0.92,
      }),
      lhResult("beta-corp", { performance: 0.5, accessibility: 0.9, "best-practices": 1, seo: 1 }),
    ];
    const out = await writeFleetAuditsToAirtable({
      base,
      websites: await loadWebsites(base),
      results,
    });
    expect(out.failed).toEqual([]);
    expect(out.written.map((w) => w.siteName).sort()).toEqual(["Acme Co", "Beta Corp"]);
    // Two update calls, one per row.
    const updates = base.__calls.filter((c) => c.kind === "update");
    expect(updates.map((u) => u.records[0]!.id).sort()).toEqual(["recA", "recB"]);
  });

  it("collects a per-site failure (no matching row) without aborting the batch", async () => {
    const base = makeFakeBase({ Websites: websites });
    const results = [
      lhResult("acme-co", { performance: 0.9, accessibility: 1, "best-practices": 1, seo: 1 }),
      lhResult("ghost-site", { performance: 0.9, accessibility: 1, "best-practices": 1, seo: 1 }),
    ];
    const out = await writeFleetAuditsToAirtable({
      base,
      websites: await loadWebsites(base),
      results,
    });
    expect(out.written.map((w) => w.siteName)).toEqual(["Acme Co"]);
    expect(out.failed).toHaveLength(1);
    expect(out.failed[0]!.slug).toBe("ghost-site");
    expect(out.failed[0]!.error).toMatch(/No Websites row matched/);
  });
});

// listWebsites reads the seeded Websites table off the fake base.
async function loadWebsites(base: ReturnType<typeof makeFakeBase>) {
  const { listWebsites } = await import("../../src/reports/airtable/websites.js");
  return listWebsites(base as never);
}
```

Run `pnpm exec vitest run tests/audits/write-fleet-audits.test.ts` → FAIL (`writeFleetAuditsToAirtable` not exported).

- [ ] **Step 2: Implement `writeFleetAuditsToAirtable`** in `src/audits/write-audits-to-airtable.ts` (append after `writeAuditsToAirtable`):

```typescript
export type FleetWriteResult = {
  written: WriteSummary[];
  failed: Array<{ slug: string; error: string }>;
};

/** Write each site's pooled audit results back to its own Websites row,
 *  best-effort. Results are grouped by `result.site` (the slug the fleet
 *  inventory stamped as Site.name). A per-site failure (no scores, no matching
 *  row) is collected — not thrown — so one bad site never aborts the batch. */
export async function writeFleetAuditsToAirtable(args: {
  base: AirtableBase;
  websites: WebsiteRow[];
  results: AuditResult[];
}): Promise<FleetWriteResult> {
  const { base, websites, results } = args;

  const bySlug = new Map<string, AuditResult[]>();
  for (const r of results) {
    const arr = bySlug.get(r.site) ?? [];
    arr.push(r);
    bySlug.set(r.site, arr);
  }

  const written: WriteSummary[] = [];
  const failed: FleetWriteResult["failed"] = [];
  for (const [slug, siteResults] of bySlug) {
    try {
      written.push(await writeAuditsToAirtable({ base, websites, slug, results: siteResults }));
    } catch (e) {
      failed.push({ slug, error: (e as Error).message });
    }
  }
  return { written, failed };
}
```

Run `pnpm exec vitest run tests/audits/write-fleet-audits.test.ts` → PASS.

- [ ] **Step 3: Relax the guard + branch to the fleet writer in `src/cli/commands/audit.ts`.**

Replace the existing `--write-airtable`+`--fleet` rejection (the block that throws "--write-airtable is not supported with --fleet") with a narrower guard that only rejects an explicit _slug_ with `--fleet`:

```typescript
// A literal --write-airtable=<slug> is single-site (the slug names one row).
// Boolean --write-airtable + --fleet is fine: each site's slug comes from the
// inventory, so there's no cwd-derived-slug ambiguity.
if (typeof opts.writeAirtable === "string" && opts.fleet !== undefined) {
  throw Object.assign(
    new Error(
      "--write-airtable=<slug> is single-site; with --fleet each site's slug comes from the inventory. Use --write-airtable (no slug) + --fleet.",
    ),
    { exitCode: 2 },
  );
}
```

Then, in the `if (opts.writeAirtable !== undefined) { … }` block, branch on fleet. Find the existing block (it dynamically imports the airtable client/writer and runs the single-site Listr write). Wrap its body so the fleet case uses the fleet writer:

```typescript
if (opts.writeAirtable !== undefined) {
  const { openBase, readAirtableConfig } = await import("../../reports/airtable/client.js");
  const { listWebsites } = await import("../../reports/airtable/websites.js");

  if (opts.fleet !== undefined) {
    const { writeFleetAuditsToAirtable } = await import("../../audits/write-audits-to-airtable.js");
    const base = openBase(readAirtableConfig());
    const websites = await listWebsites(base);
    const fleetWrite = await writeFleetAuditsToAirtable({ base, websites, results });
    output += `\n\n→ wrote ${fleetWrite.written.length} site(s) to Airtable`;
    if (fleetWrite.failed.length > 0) {
      output += `\n⚠ ${fleetWrite.failed.length} site(s) not written: ${fleetWrite.failed
        .map((f) => `${f.slug} (${f.error})`)
        .join("; ")}`;
    }
  } else {
    // ---- existing single-site write path stays exactly as-is below ----
    const { resolveSlugFromCwd } = await import("../../audits/lighthouse-airtable.js");
    const { writeAuditsToAirtable } = await import("../../audits/write-audits-to-airtable.js");
    const slug =
      typeof opts.writeAirtable === "string" && opts.writeAirtable.length > 0
        ? opts.writeAirtable
        : await resolveSlugFromCwd(cwd);
    let writeSummary: WriteSummary | null = null;
    await new Listr(
      [
        {
          title: `Write to Airtable[${slug}]`,
          task: async (_ctx, task) => {
            const base = openBase(readAirtableConfig());
            task.output = "loading Websites…";
            const websites = await listWebsites(base);
            task.output = "writing scores…";
            writeSummary = await writeAuditsToAirtable({ base, websites, slug, results });
            task.title = `Wrote to Websites[${writeSummary.siteName}] (${writeSummary.writes.length} audit type${writeSummary.writes.length === 1 ? "" : "s"})`;
          },
        },
      ],
      { renderer },
    ).run();
    if (writeSummary) output += `\n\n${formatWriteSummary(writeSummary)}`;
  }
}
```

(Keep the existing `WriteSummary`/`formatWriteSummary` imports/types in the file. The single-site branch is the current code verbatim — only the `openBase`/`listWebsites` imports were hoisted above the branch to share them.)

- [ ] **Step 4: Run tests + typecheck + lint + commit**

Run: `pnpm exec vitest run` (full suite, all pass), `pnpm exec tsc --noEmit` (clean), `pnpm lint` (only the untracked morning-report .md may warn — your changed files must be clean; `prettier --write` them if flagged).

```bash
git add src/audits/write-audits-to-airtable.ts src/cli/commands/audit.ts tests/audits/write-fleet-audits.test.ts
git commit -m "feat(audit): fleet write-back — persist each site's scores to its own Airtable row

Relaxes the --write-airtable + --fleet rejection (only an explicit =<slug> is
single-site now) and adds writeFleetAuditsToAirtable: groups pooled results by
site slug and writes each row best-effort, collecting per-site failures.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Real-run verification against the live fleet (writes to Airtable — APPROVED)

The operator has approved writing real-site scores to the live Websites rows (they're operator-only until a send is approved). No new code.

- [ ] **Step 1: Build**

Run: `pnpm build` (tsup succeeds).

- [ ] **Step 2: Dry read-only fleet audit (no write) to sanity-check inventory + deployed audits**

Run: `pnpm exec tsx src/cli/bin.ts audit --fleet airtable --only lighthouse --workdir /tmp/fleet-audit --json 2>/dev/null | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const rs=JSON.parse(d);console.log(rs.length,"lighthouse results");for(const r of rs){const s=r.details?.summary||{};const p=k=>Math.round((s[k]||0)*100);console.log(r.site.padEnd(20), "P"+p("performance"), "A"+p("accessibility"), "BP"+p("best-practices"), "SEO"+p("seo"), r.status);}})'`
Expected: one row per `maintenance`/`launch` site with a URL (~10–15), each with real deployed-site scores, in a few minutes. No clones created under `/tmp/fleet-audit`. Confirm the sites look right (caltex, erp, etc.) and the count matches Airtable's active set.

- [ ] **Step 3: Real fleet audit WITH write-back**

Run: `pnpm exec tsx src/cli/bin.ts audit --fleet airtable --only lighthouse --write-airtable --workdir /tmp/fleet-audit`
Expected: per-site progress, then `→ wrote N site(s) to Airtable` (and any `⚠ … not written` for sites lacking a matching row / scores). Exit 0 unless a deployed audit hard-failed.

- [ ] **Step 4: Spot-check two Airtable rows updated**

Confirm in Airtable (or via a `list_records` on `Websites` for CalTex + ERP) that `pScore/rScore/bpScore/seoScore` now reflect the deployed-site numbers (e.g. CalTex Best Practices ~78, not 100) and `Last lighthouse audit at` is freshly stamped. No commit needed for this verification task.

---

## Self-Review

**Spec coverage:** deployedUrl-from-Airtable + status filter + repoUrl fix → Task 1; skip-clone → Task 2; fleet write-back + guard relax → Task 3; live verification → Task 4. ✓

**Placeholder scan:** every step has exact code/commands; the single-site write branch in Task 3 is reproduced verbatim (not "same as before"). ✓

**Type consistency:** `auditNeedsCheckout(site: Site, which: AuditName[])`, `writeFleetAuditsToAirtable({ base, websites, results }) → FleetWriteResult`, and `AuditResult.site` (= slug) are used consistently across tasks and tests. The fleet writer reuses `writeAuditsToAirtable`'s exact `{ base, websites, slug, results }` shape. ✓
