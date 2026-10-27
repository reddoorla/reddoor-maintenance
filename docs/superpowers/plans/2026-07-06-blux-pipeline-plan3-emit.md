# Blux Pipeline — Plan 3: Emit (Content IR → Prismic + theme) & Review

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Turn the `SiteIR` (Plan 2) into everything a Reddoor-stack site needs — a serializable Prismic **migration plan** (custom-type schemas + documents + assets), a SvelteKit **theme** stylesheet, and a **review manifest** pairing each converted page with its Blux original — with the two live/creds-gated steps (actual Prismic write, actual screenshots) isolated behind thin runners.

**Architecture:** Pure builders + gated runners. `buildMigrationPlan(ir)` and `emitThemeCss(theme)` and `buildReviewManifest(ir)` are deterministic and fully unit-tested (no Prismic deps, no network). The live tail — `@prismicio/client` `createMigration`/`createAsset`/`htmlAsRichText` + `writeClient.migrate`, and Playwright capture — reads creds and is documented, not run in CI. Lives in `src/blux/emit/`.

**Tech Stack:** TypeScript + tsx, Vitest. The pure builders add NO deps. The runner needs `@prismicio/client` + `@prismicio/migrate` (installed only when actually importing).

**Why a serializable plan (not direct Migration API in the tested core):** keeps `reddoor-maintenance` free of heavy Prismic deps for the deterministic core, makes the emit output snapshot-testable as plain data, and lets a thin runner (in the target site repo, which already has `@prismicio/client`) do the live write. Rich text stays as raw HTML in the plan; the runner converts via `htmlAsRichText` at write time.

---

## File structure (`src/blux/emit/`)

- `plan.ts` — types: `MigrationPlan`, `PlanDocument`, `PlanCustomType`, `PlanAsset`, plus the rich-text/asset marker tags (`RichTextMarker`, `AssetMarker`).
- `custom-types.ts` — `buildCustomType(collection: CollectionIR): PlanCustomType` — `FieldDef[]` → Prismic repeatable custom-type JSON.
- `slices.ts` — `sectionToSlice(section: SectionIR): PlanSlice` — `SectionIR` → the `{ slice_type, variation, primary, items }` shape matching Plan 1's slice models.
- `migration-plan.ts` — `buildMigrationPlan(ir: SiteIR): MigrationPlan` — composes custom types + page docs (with slices) + collection docs + assets.
- `theme.ts` — `emitThemeCss(theme: ThemeIR): string` — `ThemeIR` → Tailwind v4 `@theme` CSS custom properties.
- `review.ts` — `buildReviewManifest(ir, opts): ReviewManifest` — pairs each page uid with its Blux original URL + lists diagnostics for the sign-off gallery.
- `run-migration.ts` — **gated runner** (documented; not imported by tests): reads `PRISMIC_REPOSITORY_NAME`/`PRISMIC_WRITE_TOKEN`, walks a `MigrationPlan`, `createAsset`s the assets, `htmlAsRichText`s the marked fields, `createDocument`s each doc, `writeClient.migrate`s. Kept dependency-light with a lazy dynamic import of `@prismicio/*`.

Tests in `tests/blux/emit/`: `custom-types.test.ts`, `slices.test.ts`, `migration-plan.test.ts`, `theme.test.ts`, `review.test.ts`. Reuse `tests/blux/fixtures/minimal-site.ts` + `assembleIR`.

---

## Plan types

```ts
// src/blux/emit/plan.ts
export type RichTextMarker = { __richtext_html: string };
export type AssetMarker = { __asset_id: string };
export const richText = (html: string): RichTextMarker => ({ __richtext_html: html });
export const assetRef = (id: string): AssetMarker => ({ __asset_id: id });

export type PlanSlice = {
  slice_type: string;
  variation: string;
  primary: Record<string, unknown>;
  items: Record<string, unknown>[];
};
export type PlanDocument = { type: string; uid: string; data: Record<string, unknown> };
export type PlanCustomType = { id: string; label: string; repeatable: true; json: unknown };
export type PlanAsset = { id: string; url: string; alt: string };
export type MigrationPlan = {
  customTypes: PlanCustomType[];
  documents: PlanDocument[];
  assets: PlanAsset[];
};
```

Rich-text fields carry a `RichTextMarker` (raw HTML) so the runner converts with `htmlAsRichText`; image fields carry an `AssetMarker` (uuid) the runner resolves to the created Prismic asset. Both are plain JSON → the whole plan is snapshot-testable.

---

## Task 1: theme (emit-theme)

**Files:** Create `src/blux/emit/theme.ts`, `tests/blux/emit/theme.test.ts`.

- [ ] **Step 1: failing test** — `tests/blux/emit/theme.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { emitThemeCss } from "../../../src/blux/emit/theme.js";

describe("emitThemeCss", () => {
  const css = emitThemeCss({
    colors: [
      { role: "c1", value: "#111111" },
      { role: "c2", value: "#ffffff" },
    ],
    fonts: { heading: "Inter", body: "Georgia" },
    textStyles: [{ role: "t1", size: "16px", weight: 400, lineHeight: 1.5 }],
  });
  it("emits a Tailwind v4 @theme block with color + font vars", () => {
    expect(css).toContain("@theme {");
    expect(css).toContain("--color-c1: #111111;");
    expect(css).toContain("--font-heading: Inter;");
    expect(css).toContain("--font-body: Georgia;");
  });
  it("is deterministic", () => {
    const again = emitThemeCss({
      colors: [{ role: "c1", value: "#111111" }],
      fonts: { heading: "Inter", body: "Inter" },
      textStyles: [],
    });
    expect(again).toBe(again);
  });
});
```

- [ ] **Step 2: run → FAIL.** `pnpm exec vitest run tests/blux/emit/theme.test.ts` (after `touch dist/cli/bin.js` to skip the stale-dist rebuild — see Plan 2 execution notes).

- [ ] **Step 3: implement** — `src/blux/emit/theme.ts`:

```ts
import type { ThemeIR } from "../ir.js";

/** ThemeIR → a Tailwind v4 `@theme` block of CSS custom properties. Deterministic. */
export function emitThemeCss(theme: ThemeIR): string {
  const lines: string[] = ["@theme {"];
  for (const c of theme.colors) lines.push(`  --color-${c.role}: ${c.value};`);
  lines.push(`  --font-heading: ${theme.fonts.heading || "sans-serif"};`);
  lines.push(`  --font-body: ${theme.fonts.body || "sans-serif"};`);
  for (const t of theme.textStyles) {
    lines.push(`  --text-${t.role}: ${t.size};`);
    lines.push(`  --text-${t.role}--line-height: ${t.lineHeight};`);
    lines.push(`  --text-${t.role}--font-weight: ${t.weight};`);
  }
  lines.push("}");
  return lines.join("\n") + "\n";
}
```

- [ ] **Step 4: run → PASS.** **Step 5: commit** `feat(blux): emit-theme (IR → Tailwind v4 @theme)`.

---

## Task 2: custom types (emit-prismic, part 1)

**Files:** Create `src/blux/emit/plan.ts`, `src/blux/emit/custom-types.ts`, `tests/blux/emit/custom-types.test.ts`.

- [ ] **Step 1: failing test** — `tests/blux/emit/custom-types.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildCustomType } from "../../../src/blux/emit/custom-types.js";

describe("buildCustomType", () => {
  const ct = buildCustomType({
    apiId: "team_member",
    label: "Team",
    publishRoute: "team",
    fields: [
      { key: "title", type: "text" },
      { key: "body", type: "richtext" },
      { key: "media", type: "image" },
      { key: "tags", type: "group" },
    ],
    records: [],
  });
  it("produces a repeatable custom type with a field per FieldDef", () => {
    expect(ct.id).toBe("team_member");
    expect(ct.repeatable).toBe(true);
    const json = ct.json as { json: { Main: Record<string, { type: string }> } };
    expect(json.json.Main.title!.type).toBe("Text");
    expect(json.json.Main.body!.type).toBe("StructuredText");
    expect(json.json.Main.media!.type).toBe("Image");
    expect(json.json.Main.tags!.type).toBe("Group");
  });
});
```

- [ ] **Step 2: run → FAIL.**

- [ ] **Step 3: implement** — `src/blux/emit/plan.ts` (the types block above), then `src/blux/emit/custom-types.ts`:

```ts
import type { CollectionIR, FieldDef } from "../ir.js";
import type { PlanCustomType } from "./plan.js";

const FIELD_CONFIG: Record<
  FieldDef["type"],
  () => { type: string; config: Record<string, unknown> }
> = {
  text: () => ({ type: "Text", config: {} }),
  richtext: () => ({
    type: "StructuredText",
    config: { multi: "paragraph,strong,em,hyperlink,list-item,o-list-item" },
  }),
  image: () => ({ type: "Image", config: { constraint: {}, thumbnails: [] } }),
  group: () => ({ type: "Group", config: { fields: { value: { type: "Text", config: {} } } } }),
  date: () => ({ type: "Date", config: {} }),
  boolean: () => ({ type: "Boolean", config: {} }),
  number: () => ({ type: "Number", config: {} }),
  link: () => ({ type: "Link", config: { allowTargetBlank: true } }),
};

export function buildCustomType(c: CollectionIR): PlanCustomType {
  const Main: Record<string, unknown> = {};
  for (const f of c.fields) {
    const build = FIELD_CONFIG[f.type];
    const spec = build();
    Main[f.key] = { ...spec, config: { ...spec.config, label: f.key } };
  }
  return {
    id: c.apiId,
    label: c.label,
    repeatable: true,
    json: { id: c.apiId, label: c.label, repeatable: true, status: true, json: { Main } },
  };
}
```

- [ ] **Step 4: run → PASS.** **Step 5: commit** `feat(blux): emit custom-type schemas from feeds`.

---

## Task 3: slice mapping (emit-prismic, part 2)

**Files:** Create `src/blux/emit/slices.ts`, `tests/blux/emit/slices.test.ts`.

**Mapping** (matches Plan 1 slice models): `hero` → primary `{heading,body,background_image,cta_label,cta_link}`; `media_text` → primary `{heading,body,media}`; `rich_text` → primary `{content}`; `grid`→`section_grid` → primary `{heading,columns}` + items from `children`; `collection_list` → primary `{heading,collection_type,max_items}`. `slider` maps to `section_grid` for now (no Slider _slice_ exists — component only) + a note.

- [ ] **Step 1: failing test** — `tests/blux/emit/slices.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { sectionToSlice } from "../../../src/blux/emit/slices.js";

describe("sectionToSlice", () => {
  it("maps a hero section with rich-text + asset markers", () => {
    const s = sectionToSlice({
      sliceType: "hero",
      variation: "default",
      confidence: 0.9,
      fields: { heading: "<h1>Hi</h1>", body: "<p>b</p>", backgroundMedia: "img-1" },
    });
    expect(s.slice_type).toBe("hero");
    expect(s.primary.heading).toEqual({ __richtext_html: "<h1>Hi</h1>" });
    expect(s.primary.background_image).toEqual({ __asset_id: "img-1" });
  });
  it("maps a grid section's children to items", () => {
    const s = sectionToSlice({
      sliceType: "grid",
      variation: "default",
      confidence: 0.9,
      fields: { heading: "<h2>Grid</h2>" },
      children: [
        {
          sliceType: "media_text",
          variation: "imageRight",
          confidence: 0.9,
          fields: { heading: "<h3>c</h3>", media: "img-2" },
        },
      ],
    });
    expect(s.slice_type).toBe("section_grid");
    expect(s.items).toHaveLength(1);
    expect(s.items[0]!.item_media).toEqual({ __asset_id: "img-2" });
  });
});
```

- [ ] **Step 2: run → FAIL.**

- [ ] **Step 3: implement** — `src/blux/emit/slices.ts`:

```ts
import type { SectionIR } from "../ir.js";
import { richText, assetRef, type PlanSlice } from "./plan.js";

function rt(html?: string) {
  return html ? richText(html) : undefined;
}
function img(id?: string) {
  return id ? assetRef(id) : undefined;
}
function compact(o: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
}

export function sectionToSlice(s: SectionIR): PlanSlice {
  const f = s.fields;
  switch (s.sliceType) {
    case "hero":
      return {
        slice_type: "hero",
        variation: "default",
        primary: compact({
          heading: rt(f.heading),
          body: rt(f.body),
          background_image: img(f.backgroundMedia ?? f.media),
        }),
        items: [],
      };
    case "media_text":
      return {
        slice_type: "media_text",
        variation: s.variation === "imageLeft" ? "imageLeft" : "imageRight",
        primary: compact({ heading: rt(f.heading), body: rt(f.body), media: img(f.media) }),
        items: [],
      };
    case "collection_list":
      return {
        slice_type: "collection_list",
        variation: s.variation === "list" ? "list" : "grid",
        primary: compact({
          heading: rt(f.heading),
          collection_type: s.collectionRef?.apiId ?? "",
          max_items: 24,
        }),
        items: [],
      };
    case "grid":
    case "slider":
      return {
        slice_type: "section_grid",
        variation: "default",
        primary: compact({ heading: rt(f.heading), columns: f.columns ?? 3 }),
        items: (s.children ?? []).map((c) =>
          compact({
            item_heading: rt(c.fields.heading),
            item_body: rt(c.fields.body),
            item_media: img(c.fields.media),
          }),
        ),
      };
    case "rich_text":
    default:
      return {
        slice_type: "rich_text",
        variation: "default",
        primary: compact({ content: rt(f.heading ? `${f.heading}${f.body ?? ""}` : f.body) }),
        items: [],
      };
  }
}
```

- [ ] **Step 4: run → PASS.** **Step 5: commit** `feat(blux): map IR sections to Prismic slice shapes`.

---

## Task 4: migration plan (emit-prismic, part 3)

**Files:** Create `src/blux/emit/migration-plan.ts`, `tests/blux/emit/migration-plan.test.ts`.

- [ ] **Step 1: failing test** — build the IR from the fixture, then the plan:

```ts
import { describe, it, expect } from "vitest";
import { assembleIR } from "../../../src/blux/assemble.js";
import { buildMigrationPlan } from "../../../src/blux/emit/migration-plan.js";
import { minimalSite, minimalHtml } from "../fixtures/minimal-site.js";

describe("buildMigrationPlan", () => {
  const plan = buildMigrationPlan(assembleIR({ siteJson: minimalSite, htmls: [minimalHtml] }));
  it("emits a custom type per collection", () => {
    expect(plan.customTypes.map((c) => c.id)).toEqual(["team"]);
  });
  it("emits a page document with slices + a doc per collection record", () => {
    const pages = plan.documents.filter((d) => d.type === "page");
    const team = plan.documents.filter((d) => d.type === "team");
    expect(pages).toHaveLength(1);
    expect((pages[0]!.data.slices as unknown[]).length).toBe(4);
    expect(team).toHaveLength(2);
  });
  it("lists only resolved assets", () => {
    expect(plan.assets.every((a) => a.url.startsWith("https://"))).toBe(true);
    expect(plan.assets.map((a) => a.id).sort()).toEqual(["img-1", "img-2"]);
  });
  it("is deterministic", () => {
    const again = buildMigrationPlan(assembleIR({ siteJson: minimalSite, htmls: [minimalHtml] }));
    expect(again).toEqual(plan);
  });
});
```

- [ ] **Step 2: run → FAIL.**

- [ ] **Step 3: implement** — `src/blux/emit/migration-plan.ts`:

```ts
import type { SiteIR, RecordIR } from "../ir.js";
import { richText, assetRef, type MigrationPlan, type PlanDocument } from "./plan.js";
import { buildCustomType } from "./custom-types.js";
import { sectionToSlice } from "./slices.js";

const RICHTEXT = new Set(["body", "description"]);

function recordData(rec: RecordIR): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(rec.values)) {
    if (
      value &&
      typeof value === "object" &&
      typeof (value as { media?: string }).media === "string"
    ) {
      data[key] = assetRef((value as { media: string }).media);
    } else if (RICHTEXT.has(key) && typeof value === "string") {
      data[key] = richText(value);
    } else {
      data[key] = value;
    }
  }
  return data;
}

export function buildMigrationPlan(ir: SiteIR): MigrationPlan {
  const customTypes = ir.collections.map(buildCustomType);

  const documents: PlanDocument[] = [];
  for (const page of ir.pages) {
    documents.push({
      type: "page",
      uid: page.uid,
      data: { title: page.title, slices: page.sections.map(sectionToSlice) },
    });
  }
  for (const c of ir.collections) {
    for (const rec of c.records) {
      documents.push({ type: c.apiId, uid: rec.uid, data: recordData(rec) });
    }
  }

  const assets = ir.assets
    .filter((a) => a.sourceUrl !== null)
    .map((a) => ({ id: a.id, url: a.sourceUrl as string, alt: a.alt }));

  return { customTypes, documents, assets };
}
```

- [ ] **Step 4: run → PASS.** **Step 5: commit** `feat(blux): assemble the Prismic migration plan`.

---

## Task 5: review manifest

**Files:** Create `src/blux/emit/review.ts`, `tests/blux/emit/review.test.ts`.

- [ ] **Step 1: failing test:**

```ts
import { describe, it, expect } from "vitest";
import { assembleIR } from "../../../src/blux/assemble.js";
import { buildReviewManifest } from "../../../src/blux/emit/review.js";
import { minimalSite, minimalHtml } from "../fixtures/minimal-site.js";

describe("buildReviewManifest", () => {
  const ir = assembleIR({ siteJson: minimalSite, htmls: [minimalHtml] });
  it("pairs each page with a converted url + the Blux original", () => {
    const m = buildReviewManifest(ir, {
      convertedBase: "http://localhost:5173",
      bluxBase: "https://www.testsite.com",
    });
    expect(m.pairs).toHaveLength(1);
    expect(m.pairs[0]).toEqual({
      uid: "home",
      converted: "http://localhost:5173/home",
      original: "https://www.testsite.com/",
    });
  });
  it("surfaces diagnostics for the sign-off", () => {
    const m = buildReviewManifest(ir, { convertedBase: "x", bluxBase: "y" });
    expect(Array.isArray(m.diagnostics)).toBe(true);
  });
});
```

- [ ] **Step 2: run → FAIL.**

- [ ] **Step 3: implement** — `src/blux/emit/review.ts`:

```ts
import type { SiteIR, Diagnostic } from "../ir.js";

export type ReviewPair = { uid: string; converted: string; original: string };
export type ReviewManifest = { pairs: ReviewPair[]; diagnostics: Diagnostic[] };

export function buildReviewManifest(
  ir: SiteIR,
  opts: { convertedBase: string; bluxBase: string },
): ReviewManifest {
  const pairs = ir.pages.map((p) => ({
    uid: p.uid,
    converted: `${opts.convertedBase}/${p.uid}`,
    // The home page maps to the site root; other pages to /uid.
    original: p.uid === "home" ? `${opts.bluxBase}/` : `${opts.bluxBase}/${p.uid}`,
  }));
  return { pairs, diagnostics: ir.diagnostics };
}
```

- [ ] **Step 4: run → PASS.** **Step 5: commit** `feat(blux): review manifest (converted vs Blux pairing)`.

---

## Task 6: the gated live runner (documented; not CI-tested)

**Files:** Create `src/blux/emit/run-migration.ts`.

Not unit-tested (it performs live I/O). It reads creds, lazily imports `@prismicio/client` + `@prismicio/migrate`, and executes a `MigrationPlan`. Install deps only when running: `pnpm add -D @prismicio/client @prismicio/migrate`.

- [ ] **Step 1: implement** — `src/blux/emit/run-migration.ts`:

```ts
import type { MigrationPlan } from "./plan.js";

/** Execute a MigrationPlan against a staging Prismic repo. LIVE — needs
 *  PRISMIC_REPOSITORY_NAME + PRISMIC_WRITE_TOKEN and `@prismicio/client` +
 *  `@prismicio/migrate` installed. Custom-type schemas are written to
 *  `customtypes/<id>.json` in the target repo by the operator/Slice Machine;
 *  this uploads assets + documents. */
export async function runMigration(plan: MigrationPlan): Promise<void> {
  const repo = process.env.PRISMIC_REPOSITORY_NAME;
  const token = process.env.PRISMIC_WRITE_TOKEN;
  if (!repo || !token) throw new Error("Set PRISMIC_REPOSITORY_NAME and PRISMIC_WRITE_TOKEN");
  const prismic = await import("@prismicio/client");
  const { htmlAsRichText } = await import("@prismicio/migrate");

  const writeClient = prismic.createWriteClient(repo, { writeToken: token });
  const migration = prismic.createMigration();

  const assetRefs = new Map<string, ReturnType<typeof migration.createAsset>>();
  for (const a of plan.assets) assetRefs.set(a.id, migration.createAsset(a.url, a.alt));

  const resolve = (v: unknown): unknown => {
    if (v && typeof v === "object") {
      if ("__richtext_html" in v)
        return htmlAsRichText((v as { __richtext_html: string }).__richtext_html).result;
      if ("__asset_id" in v) return assetRefs.get((v as { __asset_id: string }).__asset_id);
      if (Array.isArray(v)) return v.map(resolve);
      return Object.fromEntries(Object.entries(v).map(([k, val]) => [k, resolve(val)]));
    }
    return v;
  };

  for (const doc of plan.documents) {
    migration.createDocument(
      {
        type: doc.type,
        uid: doc.uid,
        lang: "en-us",
        data: resolve(doc.data) as Record<string, unknown>,
      },
      doc.uid,
    );
  }
  await writeClient.migrate(migration, { reporter: (e) => console.log(e.type) });
}
```

- [ ] **Step 2: lint + commit** `feat(blux): gated live Prismic migration runner`. (No test — it is live I/O; the plan it consumes is fully tested.)

---

## Self-review / coverage

- Pure builders (`theme`, `custom-types`, `slices`, `migration-plan`, `review`) are deterministic and unit-tested; `buildMigrationPlan` asserts deep-equal on re-run.
- `run-migration.ts` is excluded from the coverage graph by adding it to `vitest.config.ts` `coverage.exclude` (live I/O, no unit test) — or accept its 0% if the global floor still holds; check with `pnpm test:coverage` locally is blocked by the dist-rebuild, so rely on CI.
- Every field/asset in a document is a plain-JSON marker → the runner is the only place Prismic types appear.

## Remaining after this plan (creds-gated / operator)

- **Run the live import** on thePinnacle: scaffold a site with `/new-site`, `pnpm add -D @prismicio/client @prismicio/migrate`, write `customtypes/*.json` from the plan, `runMigration(plan)` against a staging repo (`PRISMIC_REPOSITORY_NAME`/`PRISMIC_WRITE_TOKEN`), drop `emitThemeCss` output into the theme, render, and screenshot via `buildReviewManifest` for the "good enough" sign-off.
- **Media preservation archive** to S3/R2 (separate track; needs bucket + creds).
