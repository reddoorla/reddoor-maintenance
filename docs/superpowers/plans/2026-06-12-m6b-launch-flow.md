# M6b — Launch flow implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** A `launch <site>` command that bootstraps (CI+Renovate) → first-audits → **drafts** a purpose-built launch email; the M3 approve loop sends it, and **on send** the site flips Status → maintenance + stamps `Launched at`. Completes M1–M6.

**Architecture:** `Launch` joins `ReportType`. `DEFAULT_COPY` gains launch defaults. A new `buildLaunchMjml` (reusing the maintenance template's header/escape helpers) renders the go-live email; `renderReportHtml` dispatches on `reportType`. `launch` is a step-chain recipe (mirror `init`) that drafts-only. `orchestrate.sendApprovedReports` flips Status + stamps `Launched at` after a successful Launch send.

**Tech Stack:** TypeScript (ESM, `.js` specifiers), vitest, MJML. No new deps.

**Reference (real code):**

- `src/reports/types.ts` — `ReportType`.
- `src/reports/copy.ts` — `DEFAULT_COPY`/`ResolvedCopy` (M6a).
- `src/reports/maintenance-email/template.ts` — `escapeXml`, `fmtDate`, `headerImageTag`, `headerStyleBlock` (module-private today → export them); `buildMjml`.
- `src/reports/render.ts` — `renderReportHtml(data)` calls `buildMjml`.
- `src/reports/airtable/websites.ts` — `WebsiteRow`/`mapRow`; `updateScores` etc. are the writer pattern; `Status` single-select values incl `"maintenance"`.
- `src/reports/airtable/reports.ts` — `DraftInput` (lighthouse REQUIRED), `createDraft`.
- `src/reports/send/orchestrate.ts:79-85` — the `sendApprovedReports` loop (flip hook goes right after `sendOne` succeeds); `sendOne` requires `report.lighthouse` + `site.headerImage`.
- `src/recipes/init.ts` — the step-chain pattern to mirror; `runAudits`, `selfUpdating` (`src/recipes/self-updating/index.ts`).
- `src/cli/bin.ts` — `init` command registration to mirror.

**PREREQUISITE (controller, before merge):** via Airtable MCP (base `appHG8nLOzULzXOER`): (1) add a **"Launch"** option to the Reports table (`tblKJEIONbGcWzvZ1`) `Report type` single-select; (2) create a **`Launched at`** dateTime field on Websites (`tblerElkKDif2VqrO`).

---

## File Structure

- **Modify** `src/reports/types.ts` — `ReportType` += `"Launch"`.
- **Modify** `src/reports/copy.ts` — launch fields on `ResolvedCopy`/`DEFAULT_COPY`.
- **Modify** `src/reports/maintenance-email/template.ts` — `export` the 4 shared helpers.
- **Create** `src/reports/launch-email/template.ts` — `buildLaunchMjml`.
- **Modify** `src/reports/render.ts` — dispatch on `reportType`.
- **Modify** `src/reports/airtable/websites.ts` — `launchedAt` + `updateLaunched`.
- **Modify** `src/reports/send/orchestrate.ts` — flip-on-send.
- **Create** `src/recipes/launch.ts` — the step-chain.
- **Modify** `src/cli/bin.ts` — register `launch`.
- **Create** `.changeset/m6b-launch-flow.md`.

---

## Task 1: `Launch` type + launch copy

**Files:** `src/reports/types.ts`, `src/reports/copy.ts`; Test `tests/reports/copy.test.ts`.

- [ ] **Step 1: Failing test** — append to `tests/reports/copy.test.ts`:

```ts
it("exposes launch copy defaults", () => {
  expect(DEFAULT_COPY.launchHeading).toBe("LAUNCHED");
  expect(typeof DEFAULT_COPY.launchBody).toBe("string");
  expect(Array.isArray(DEFAULT_COPY.launchSetupItems)).toBe(true);
  expect(DEFAULT_COPY.launchSetupItems.length).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Run** `pnpm test -- copy` → FAIL.

- [ ] **Step 3: Implement.** In `src/reports/types.ts`:

```ts
export type ReportType = "Maintenance" | "Testing" | "Launch";
```

In `src/reports/copy.ts`, add to `ResolvedCopy` + `DEFAULT_COPY`:

```ts
  // ResolvedCopy:
  launchHeading: string;
  launchBody: string;
  launchSetupItems: string[];
```

```ts
  // DEFAULT_COPY:
  launchHeading: "LAUNCHED",
  launchBody:
    "Your site is live. We've set it up on the Reddoor stack with hosting, security, and automatic maintenance so it stays fast and healthy. Here's what's in place:",
  launchSetupItems: [
    "Hosting, DNS, and SSL configured",
    "Continuous integration + automatic dependency updates",
    "Analytics and uptime monitoring",
  ],
```

(`resolveCopy` is unchanged — launch copy is default-only.)

- [ ] **Step 4: Run** `pnpm test -- copy` → PASS. `pnpm typecheck` (the `ReportType` widening may surface exhaustiveness spots — fix any).

- [ ] **Step 5: Commit** — `git add src/reports/types.ts src/reports/copy.ts tests/reports/copy.test.ts && git commit -m "feat(launch): Launch report type + launch copy defaults"`.

---

## Task 2: Purpose-built launch template + render dispatch

**Files:** `src/reports/maintenance-email/template.ts` (export helpers), `src/reports/launch-email/template.ts` (new), `src/reports/render.ts`; Test `tests/reports/render.test.ts`.

- [ ] **Step 1: Failing test** — append to `tests/reports/render.test.ts`:

```ts
it("renders a purpose-built launch email (no maintenance sections)", async () => {
  const { html, warnings } = await renderReportHtml(baseData({ reportType: "Launch" }));
  expect(warnings).toEqual([]);
  expect(html).toContain("LAUNCHED");
  expect(html).toContain(DEFAULT_COPY.launchBody);
  expect(html).toContain(DEFAULT_COPY.launchSetupItems[0]!);
  // purpose-built: no maintenance/checks/analytics sections
  expect(html).not.toContain("MAINTENANCE CHECKS");
  expect(html).not.toContain("LIGHTHOUSE SCORES");
  expect(html).not.toContain("ANALYTICS");
  // still carries the shared copy layer (contact + footer)
  expect(html).toContain("Just hit reply.");
  expect(html).toContain(DEFAULT_COPY.footerOrg);
});

it("honors a per-site contact/footer override on the launch email", async () => {
  const { html } = await renderReportHtml({
    ...baseData({ reportType: "Launch" }),
    copy: { ...DEFAULT_COPY, footerOrg: "Beta LLC" },
  });
  expect(html).toContain("Beta LLC");
});
```

- [ ] **Step 2: Run** `pnpm test -- render` → FAIL.

- [ ] **Step 3: Implement.**

(a) In `src/reports/maintenance-email/template.ts`, add `export` to `escapeXml`, `fmtDate`, `headerImageTag`, `headerStyleBlock` (no logic change — keeps the maintenance output byte-identical).

(b) Create `src/reports/launch-email/template.ts`:

```ts
import type { ReportData } from "../types.js";
import { DEFAULT_COPY } from "../copy.js";
import {
  escapeXml,
  fmtDate,
  headerImageTag,
  headerStyleBlock,
} from "../maintenance-email/template.js";

const RED = "#C00";
const GREY = "#757575";

/** Purpose-built go-live email: header · LAUNCHED + date · message · what-we-set-up
 *  · contact · footer. Reuses the M6a copy layer (contact/footer honor per-site
 *  overrides). No maintenance checklist / Lighthouse / analytics. */
export function buildLaunchMjml(data: ReportData): string {
  const copy = data.copy ?? DEFAULT_COPY;
  const previewText = `${escapeXml(data.siteName)} is live`;
  const setupRows = copy.launchSetupItems
    .map(
      (item) => `
      <mj-text color="${GREY}" font-family="helvetica, sans-serif" font-size="16px" font-weight="300" line-height="24px" padding-top="4px" padding-bottom="4px">• ${escapeXml(item)}</mj-text>`,
    )
    .join("");
  const contactRows = copy.contact
    .map(
      (line) => `
      <mj-text font-family="helvetica, sans-serif" font-size="24px" font-weight="300" line-height="30px">${escapeXml(line)}</mj-text>`,
    )
    .join("");
  const footerAddressRows = copy.footerAddress
    .map(
      (line) => `
      <mj-text color="${GREY}" font-family="helvetica, sans-serif" font-size="12px" font-weight="300" line-height="16px" padding-top="0" padding-bottom="0px">${escapeXml(line)}</mj-text>`,
    )
    .join("");

  return `<mjml>
  <mj-head>
    <mj-attributes>
      <mj-text font-family="helvetica, sans-serif" padding-left="5px" padding-right="5px" />
      <mj-section padding-left="11%" padding-right="11%"/>
      <mj-image padding="0px" />
    </mj-attributes>
    <mj-preview>${previewText}</mj-preview>
    ${headerStyleBlock(data)}
  </mj-head>
  <mj-body background-color="white">
    <mj-section background-color="#F4F4F4" padding-top="0px" padding-bottom="0px" padding-left="0px" padding-right="0px">
      <mj-column>${headerImageTag(data)}</mj-column>
    </mj-section>
    <mj-section background-color="white">
      <mj-column>
        <mj-text color="${RED}" font-size="20px" font-weight="700" padding-top="75px">${escapeXml(copy.launchHeading)}</mj-text>
        <mj-text color="${RED}" font-size="44px" font-weight="400">${fmtDate(data.completedOn)}</mj-text>
        <mj-text color="${GREY}" font-family="helvetica, sans-serif" font-size="16px" font-weight="300" line-height="24px" padding-top="20px">${escapeXml(copy.launchBody)}</mj-text>
        ${setupRows}
      </mj-column>
    </mj-section>
    <mj-section background-color="white">
      <mj-column padding-top="36px">
        <mj-text color="${RED}" font-family="helvetica, sans-serif" font-size="24px" font-weight="700" padding-top="36px" line-height="36px">Any questions, concerns or requests?</mj-text>
        ${contactRows}
        <mj-divider border-width="1px" border-style="solid" border-color="#CCCCCC" padding="0" />
        <mj-text color="${GREY}" font-family="helvetica, sans-serif" font-size="12px" font-weight="300" padding-top="24px" line-height="20px" font-style="italic">Copyright ${new Date().getUTCFullYear()} ${escapeXml(copy.footerOrg)}. All rights reserved.</mj-text>
        <mj-text color="${GREY}" font-family="helvetica, sans-serif" font-size="12px" font-weight="700" line-height="16px" padding-top="0" padding-bottom="0px">Our mailing address is:</mj-text>
        <mj-text color="${GREY}" font-family="helvetica, sans-serif" font-size="12px" font-weight="300" line-height="16px" padding-top="0" padding-bottom="0px">${escapeXml(copy.footerOrg)}</mj-text>
        ${footerAddressRows}
      </mj-column>
    </mj-section>
  </mj-body>
</mjml>`;
}
```

(c) In `src/reports/render.ts`, import `buildLaunchMjml` and dispatch:

```ts
const mjml = data.reportType === "Launch" ? buildLaunchMjml(data) : buildMjml(data);
```

(Replace the existing `buildMjml(data)` call with this; keep the rest of `renderReportHtml` unchanged.)

- [ ] **Step 4: Run** `pnpm test -- render` → PASS (new launch tests + existing maintenance/testing assertions stay green). `pnpm typecheck`.

- [ ] **Step 5: Commit** — `git add src/reports/maintenance-email/template.ts src/reports/launch-email/template.ts src/reports/render.ts tests/reports/render.test.ts && git commit -m "feat(launch): purpose-built launch email + render dispatch"`.

---

## Task 3: `Launched at` field + `updateLaunched`

**Files:** `src/reports/airtable/websites.ts`; Test `tests/reports/airtable/update-launched.test.ts` (mirror `update-github-signals.test.ts`); fixtures.

- [ ] **Step 1: Failing test** — new `tests/reports/airtable/update-launched.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { updateLaunched } from "../../../src/reports/airtable/websites.js";

function fakeBase() {
  const calls: Array<{ id: string; fields: Record<string, unknown> }> = [];
  const base = (() => ({
    update: async (recs: Array<{ id: string; fields: Record<string, unknown> }>) => {
      calls.push(...recs);
      return recs;
    },
  })) as unknown as Parameters<typeof updateLaunched>[0];
  return { base, calls };
}

describe("updateLaunched", () => {
  it("writes Status=maintenance + Launched at", async () => {
    const { base, calls } = fakeBase();
    await updateLaunched(base, "rec1", "2026-06-12T00:00:00Z");
    expect(calls[0]!.fields).toMatchObject({
      Status: "maintenance",
      "Launched at": "2026-06-12T00:00:00Z",
    });
  });
});
```

- [ ] **Step 2: Run** `pnpm test -- update-launched` → FAIL.

- [ ] **Step 3: Implement.** In `src/reports/airtable/websites.ts`: add `launchedAt: string | null` to `WebsiteRow` (after the copy fields) + `mapRow` read `launchedAt: (f["Launched at"] as string | undefined) ?? null`; add:

```ts
/** Mark a site launched: flip Status → maintenance + stamp Launched at (M6b).
 *  The first code that writes Status. Called after a Launch report sends. */
export async function updateLaunched(
  base: AirtableBase,
  recordId: string,
  at: string,
): Promise<void> {
  const fields: FieldSet = { Status: "maintenance", "Launched at": at };
  await base(WEBSITES_TABLE).update([{ id: recordId, fields }]);
}
```

- [ ] **Step 4:** Run `pnpm typecheck` and add `launchedAt: null` to EVERY full-WebsiteRow fixture it flags (the recurring churn — iterate to 0 errors). Then `pnpm test -- update-launched websites` → green.

- [ ] **Step 5: Commit** — `git add -A ':!docs/morning-reports' && git commit -m "feat(launch): Launched at field + updateLaunched (flip Status on launch)"`.

---

## Task 4: Flip-on-send

**Files:** `src/reports/send/orchestrate.ts`; Test `tests/reports/send/*` if a send-orchestrate test exists (else gate on typecheck+build+suite).

- [ ] **Step 1: Implement.** In `sendApprovedReports`, import `updateLaunched`, and right after `sendOne` succeeds (the `lines.push(\`✓ sent…\`)` line):

```ts
const messageId = await sendOne(client, base, site, report);
lines.push(`✓ sent: ${report.reportId} (${messageId})`);
if (report.reportType === "Launch") {
  try {
    await updateLaunched(base, site.id, new Date().toISOString());
    lines.push(`  ↳ launched: ${site.name} flipped to maintenance`);
  } catch (e) {
    lines.push(`  ⚠ launch flip failed for ${site.name}: ${(e as Error).message}`);
  }
}
```

(The flip is wrapped so a Status-write hiccup never fails an already-sent email.)

- [ ] **Step 2:** `pnpm typecheck && pnpm build && pnpm test` → green.

- [ ] **Step 3: Commit** — `git add src/reports/send/orchestrate.ts && git commit -m "feat(launch): flip Status + stamp Launched at after a Launch send"`.

---

## Task 5: The `launch <site>` command (step-chain)

**Files:** `src/recipes/launch.ts` (new), `src/cli/bin.ts`. (Integration; gate = typecheck + build + a no-op-ish smoke.)

- [ ] **Step 1: Implement `src/recipes/launch.ts`** — mirror `src/recipes/init.ts`'s step-chain. A `launch(site, deps)` that runs, in order, stopping on first failure:
  1. `selfUpdating(site)` (bootstrap).
  2. `runAudits(site)` + write the scores to Airtable (reuse the init audit step + the fleet/single-site Airtable writer; read how `init`'s audit step + `audit --write-airtable` persist scores, and reuse that to get a `LighthouseScores` for the draft).
  3. Build a `DraftInput` (`reportType: "Launch"`, `completedOn: new Date()`, `periodStart`/`periodEnd: new Date()`, `lighthouse:` the just-audited scores, `lastTestedDate: null`, a generated `reportId`, the site's record id) → `createDraft(base, input)`.

  Return a `LaunchResult { site, steps, complete }` shaped like `InitResult`. Read `init.ts` + `draft.ts` (how a draft `reportId`/period is generated) and reuse those helpers — do NOT invent a new id scheme.

- [ ] **Step 2: Register in `bin.ts`** — mirror the `init` command:

```ts
import { runLaunchCommand } from "./commands/launch.js"; // or call the recipe directly as init does
cli
  .command(
    "launch <site>",
    "Bootstrap + first-audit a site, then draft its launch email for approval.",
  )
  .action((site, opts) => runOrExit(() => runLaunch(site, opts), opts));
```

(Match how `init` wires its recipe to the CLI — `src/cli/commands/` may hold an `init` command wrapper; mirror that exact shape, including reading the site path/inventory the same way.)

- [ ] **Step 3:** `pnpm typecheck && pnpm build`; smoke `node dist/cli/bin.js launch --help` exits 0.

- [ ] **Step 4: Commit** — `git add src/recipes/launch.ts src/cli/bin.ts src/cli/commands/launch.ts && git commit -m "feat(launch): launch <site> command — bootstrap → audit → draft"`.

---

## Task 6: Changeset + final gate

- [ ] **Step 1:** `.changeset/m6b-launch-flow.md`:

```md
---
"@reddoorla/maintenance": minor
---

feat(launch): first-class site launch (M6b — completes M1–M6). `launch <site>` bootstraps CI+Renovate, runs a first audit, and drafts a **purpose-built launch email** (a new `Launch` report type) into the dashboard approve queue. Approving it sends the go-live email and flips the site **Status → maintenance** with a **`Launched at`** stamp — no client email leaves without the one-click approval. The launch email reuses the M6a copy layer (per-site contact/footer overrides honored).
```

- [ ] **Step 2: Commit** — `git add .changeset/m6b-launch-flow.md && git commit -m "chore(changeset): M6b launch flow"`.

- [ ] **Step 3: Final gate** (controller): `pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm test:dist`. Then the 3-lens review (spec / quality / a LIVE lens: confirm the Reports "Launch" option + Websites "Launched at" field exist and `mapRow`/`updateLaunched`/`createDraft` field names match; render a launch email and eyeball it has no maintenance sections) before the head-SHA merge.

---

## Self-review

- **Spec coverage:** Launch type + copy (§3.1/3.2) → Task 1; template + dispatch (§3.3) → Task 2; milestone field + writer (§3.5) → Task 3; flip-on-send (§3.5) → Task 4; the `launch` command (§3.4) → Task 5.
- **Lighthouse guard:** the launch draft carries the first-audit scores (Task 5 step 1.3), so `sendOne`'s `report.lighthouse` guard passes; the launch template ignores them (Task 2).
- **Type consistency:** `ReportType` widened in Task 1 before any Launch consumer; `buildLaunchMjml` consumes the launch copy fields added in Task 1; `updateLaunched`/`launchedAt` (Task 3) used by Task 4.
- **Fixture churn:** Task 3 step 4 updates all WebsiteRow fixtures (the recurring lesson).
- **Byte-identical maintenance:** Task 2 only adds `export` to the 4 helpers — the maintenance/testing render is unchanged (existing tests guard it).
