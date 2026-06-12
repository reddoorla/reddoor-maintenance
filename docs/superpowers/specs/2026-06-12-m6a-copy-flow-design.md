# M6a — Copy flow: email strings as data (design)

**Date:** 2026-06-12
**Status:** Design — approved at the architecture level (Tucker, 2026-06-12: override set = narrative intro/footer/contact only). Ready for an implementation plan.
**Milestone:** M6 (first of two slices) of [the fleet-scale roadmap](2026-06-02-fleet-scale-roadmap.md) (§M6, §9.5 "copy depth: light"). M6b (launch flow) follows and reuses this copy layer.

> Goal: stop the email wording from being scattered code literals. Centralize every "copy" string into one default module (single edit place), and let a site override the three most client-facing narrative blocks — **intro, contact, footer** — via Airtable, merged with the existing `override ?? default` pattern. Light by decree (§9.5): three per-site fields, not a CMS.

---

## 1. The shape

Today all email copy is hardcoded in [src/reports/maintenance-email/template.ts](../../../src/reports/maintenance-email/template.ts) — the six maintenance-check labels, six testing labels, the intros, NOTES header, SEO CTA, the closing contact block, and the mailing-address footer are all literals. M6a:

- **Centralize** every copy string into one `DEFAULT_COPY` module (a `ResolvedCopy` object). The template reads from that object instead of literals → one place to edit wording.
- **Override** just the three narrative blocks per-site (Tucker's call, §9.5): **intro · contact · footer**. Three flat Airtable text fields; blank → default. The other strings stay default-only (promotable later by adding a field + one merge line — the seam is uniform).
- **Thread** a resolved `copy` object through `ReportData` so the template is data-driven and the resolve happens once, at assembly, from the site row.

## 2. Decisions locked

| Fork              | Decision                                                                                                                                                                                                                                                                                                 |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Override set**  | **intro · contact · footer only** (Tucker, 2026-06-12). Everything else (check labels, testing intro, NOTES, SEO CTA, section headers) is a centralized code default, not per-site.                                                                                                                      |
| **Block mapping** | `intro` = the maintenance-checks intro paragraph ([template.ts:212](../../../src/reports/maintenance-email/template.ts)); `contact` = the closing "Any questions… Just hit reply…" block (:249–251); `footer` = the mailing-address block (org + 2 lines, :255–257). Copyright line keeps the auto-year. |
| **Storage**       | **Three flat Websites long-text fields** (`Copy — Intro`, `Copy — Contact`, `Copy — Footer`), mirroring how `Report recipients (To)` etc. live on Websites. Blank/whitespace → null → default. (JSON blob / separate Copy table rejected: heavier than "light".)                                         |
| **Default home**  | A new `src/reports/copy.ts` exporting `ResolvedCopy`, `DEFAULT_COPY`, `resolveCopy(site)`. ALL current literals move here verbatim.                                                                                                                                                                      |
| **Threading**     | `ReportData` gains `copy?: ResolvedCopy`; the template uses `data.copy ?? DEFAULT_COPY` so an un-threaded path (local preview) still renders defaults safely. `resolveCopy(site)` is called where `ReportData` is assembled in the send path.                                                            |
| **Escaping**      | Overrides are operator-controlled free text → run through the existing `escapeXml` at interpolation (same as `commentary`); the `footer`/`contact` multi-line blocks split on `\n` → `<br/>` like commentary does.                                                                                       |

## 3. Architecture

```text
resolveCopy(site: WebsiteRow): ResolvedCopy        // PURE
   = { ...DEFAULT_COPY,
       intro:   site.copyIntro   ?? DEFAULT_COPY.intro,
       contact: site.copyContact ?? DEFAULT_COPY.contact,
       footer:  site.copyFooter  ?? DEFAULT_COPY.footer }

send/assembly path: ReportData = { ...fields, copy: resolveCopy(site) }
template.buildMjml(data): const copy = data.copy ?? DEFAULT_COPY;
   → every former literal now reads copy.maintenanceChecks / copy.intro / copy.contact / copy.footer / …
```

No behavior change for a site with no overrides — the rendered email is byte-identical to today (a test pins this).

## 4. Components

### 4.1 `src/reports/copy.ts` (new) — the default copy + resolver

```ts
export type ResolvedCopy = {
  maintenanceIntro: string; // the intro under "MAINTENANCE CHECKS"
  maintenanceChecks: string[]; // 6 labels (googleLabel is computed in-template from searchPosition)
  testingIntro: string;
  testingChecklist: string[]; // 6 labels
  notesHeader: string; // "NOTES"
  seoCta: string;
  contact: string[]; // the closing invitation lines
  footerOrg: string; // "Reddoor Creative, LLC"
  footerAddress: string[]; // ["29027 Dapper Dan", "Fair Oaks Ranch, TX 78015"]
};
export const DEFAULT_COPY: ResolvedCopy = {
  /* every current literal, verbatim */
};
export function resolveCopy(site: WebsiteRow): ResolvedCopy;
```

`resolveCopy` overrides only `maintenanceIntro` (from `copyIntro`), `contact` (from `copyContact`, split on `\n`), and `footer*` (from `copyFooter`, split on `\n`: first line → org, rest → address). Blank/whitespace override → keep the default. Pure + unit-tested.

### 4.2 Airtable + `WebsiteRow`

Three new Websites long-text fields (created live via MCP before merge): `Copy — Intro`, `Copy — Contact`, `Copy — Footer`. `WebsiteRow` + `mapRow` gain `copyIntro`, `copyContact`, `copyFooter` (`string | null`, blank-trimmed to null like `dashboardToken`).

### 4.3 `ReportData` + `template.ts`

`ReportData` gains `copy?: ResolvedCopy`. `buildMjml` computes `const copy = data.copy ?? DEFAULT_COPY` once and replaces every hardcoded copy literal with the corresponding `copy.*` read (the `.map()` over `copy.maintenanceChecks` / `copy.testingChecklist`; the intro/contact/footer/NOTES/SEO/testing-intro strings). The `googleLabel` (`Page 1 Google Result (#N)` vs `Google Indexed`) stays computed in-template from `searchPosition` — it's logic, not copy. The overrides + multi-line blocks are `escapeXml`'d.

### 4.4 Assembly threading

Where the send path builds `ReportData` from the `ReportRow` + `WebsiteRow` (the orchestrate/render path), set `copy: resolveCopy(site)`. Any preview/draft path that builds `ReportData` does the same; an omission degrades to `DEFAULT_COPY` (safe).

## 5. Error handling / safety

- A site with all three override fields blank → defaults → **byte-identical** email (regression-pinned).
- Overrides are escaped exactly like `commentary` (XML-strict MJML would throw on a raw `&`/`<`); multi-line splits to `<br/>`.
- `copy` optional on `ReportData` → no caller breaks; the template's `?? DEFAULT_COPY` is the floor.

## 6. Out of scope (M6b or later)

- Overriding **check labels / testing labels / SEO CTA / section headers** per-site (centralized default only here; promotable via the uniform seam).
- The **launch** email type + launch copy + the launched milestone — **M6b**, which reuses `DEFAULT_COPY`/`resolveCopy`.
- A copy-editing UI / separate Copy table.

## 7. Research basis (copy-as-data)

Mirrors the standard i18n / headless-content pattern: a **shared default catalog** + **per-instance overrides** resolved at render via a simple `override ?? default` merge (not a full CMS). This is exactly the existing `reportRecipientsTo ?? pointOfContact` precedent ([send/orchestrate.ts](../../../src/reports/send/orchestrate.ts)), generalized to wording. Keeping the default in code (not Airtable) means the "shared truth" is versioned + reviewed; only the per-site deltas live as data — the lightest correct split (§8 YAGNI).

## 8. Success criteria

The email template contains **zero hardcoded copy strings** — all read from `data.copy ?? DEFAULT_COPY`. A site with blank override fields renders a byte-identical email to today (pinned by a snapshot test). Setting `Copy — Intro` / `Copy — Contact` / `Copy — Footer` on a Websites row changes only that site's email; the others stay on the default. Editing fleet-wide wording is a one-file change in `src/reports/copy.ts`.
