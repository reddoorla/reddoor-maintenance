# Blux Pipeline — Plan 2: Deterministic Core (Blux → Content IR)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The deterministic, no-LLM core of the Blux→Reddoor-stack pipeline: parse a Blux `site.json` and turn it into the stack-agnostic **Content IR** (pages+sections, collections from feeds, theme, assets), validated by snapshot tests over small synthetic fixtures.

**Architecture:** Pure functions composed left-to-right — `parse` → `normalize` (+ archetype mapping) + `model-collections` + `resolve-assets` → `assembleIR`. Every function is deterministic (same input → byte-identical output); no network in the tested core (asset URL _resolution_ from local HTML is pure; the optional live ext-probe/download is out of scope here). Lives in `reddoor-maintenance/src/blux/`, tests in `tests/blux/`, using hand-authored minimal fixtures. The real 12-site `~/Desktop` corpus is a separate, local-only integration check (not committed).

**Tech Stack:** TypeScript + tsx, Vitest (node env, `tests/**/*.test.ts`), ESLint + Prettier. No new deps.

---

## File structure

Create under `reddoor-maintenance/src/blux/`:

- `ir.ts` — the Content IR type definitions (single source of truth; imported everywhere).
- `parse.ts` — `parseBluxSite(siteJson: unknown): BluxRaw` — validates + shapes the raw `site.json`.
- `archetype.ts` — `archetype(block: BluxBlock): { sliceType; variation; confidence }` — the census mapping logic.
- `normalize.ts` — `normalizePages(raw): PageIR[]` + `normalizeTheme(raw): ThemeIR`.
- `collections.ts` — `modelCollections(raw): CollectionIR[]` — Blux feeds → repeatable Custom Types + records.
- `assets.ts` — `collectAssetUrls(htmls: string[]): Map<string,string>` (pure HTML-scrape + transform-strip) and `normalizeCdnUrl(url): string | null`.
- `assemble.ts` — `assembleIR(input: { siteJson; htmls }): SiteIR` — composes the above into one `SiteIR`.

Tests under `reddoor-maintenance/tests/blux/`:

- `fixtures/minimal-site.ts` — a hand-authored minimal Blux `site.json` object exercising each archetype + one feed + shared media.
- `parse.test.ts`, `archetype.test.ts`, `normalize.test.ts`, `collections.test.ts`, `assets.test.ts`, `assemble.test.ts`.

**IR note:** `ir.ts` mirrors the spec's Content IR exactly (`SiteIR`, `PageIR`, `SectionIR`, `CollectionIR`, `FieldDef`, `RecordIR`, `AssetRef`, `ThemeIR`, `Diagnostic`). Rich text stays as raw HTML strings in the IR (`htmlAsRichText` conversion happens later, in Plan 3's `emit-prismic`).

---

## Task 1: Content IR types

**Files:**

- Create: `src/blux/ir.ts`

- [ ] **Step 1: Write the IR types**

Create `src/blux/ir.ts`:

```ts
export type AssetId = string;

export type Diagnostic = {
  kind: "low-confidence-block" | "unresolved-asset" | "unwired-collection" | "malformed-feed-field";
  where: string; // page uid / feed apiId / asset uuid
  message: string;
};

export type SectionIR = {
  sliceType: "hero" | "media_text" | "rich_text" | "grid" | "slider" | "collection_list";
  variation: string;
  confidence: number;
  fields: {
    heading?: string; // raw HTML
    body?: string; // raw HTML
    media?: AssetId;
    backgroundMedia?: AssetId;
    ratio?: string;
    columns?: number;
    anim?: string;
  };
  collectionRef?: { apiId: string; mode: "all" | "items"; itemUids?: string[]; wired: boolean };
  children?: SectionIR[];
};

export type PageIR = { uid: string; title: string; description: string; sections: SectionIR[] };

export type FieldDef = {
  key: string;
  type: "text" | "richtext" | "image" | "group" | "date" | "boolean" | "number" | "link";
};
export type RecordIR = { uid: string; values: Record<string, unknown>; mediaRefs: AssetId[] };
export type CollectionIR = {
  apiId: string;
  label: string;
  publishRoute: string | null;
  fields: FieldDef[];
  records: RecordIR[];
};

export type ThemeIR = {
  colors: { role: string; value: string }[];
  fonts: { heading: string; body: string };
  textStyles: { role: string; size: string; weight: number; lineHeight: number }[];
};

export type AssetRef = {
  id: AssetId;
  sourceUrl: string | null;
  name: string;
  mime: string;
  alt: string;
};

export type SiteIR = {
  meta: { name: string; domain: string; bluxSiteId: string };
  theme: ThemeIR;
  pages: PageIR[];
  collections: CollectionIR[];
  assets: AssetRef[];
  diagnostics: Diagnostic[];
};
```

- [ ] **Step 2: Verify it typechecks + lints**

Run: `cd /Users/tuckerlemos/Documents/GitHub/reddoor-maintenance && pnpm exec tsc --noEmit src/blux/ir.ts 2>&1 | head` (expect no output) and `pnpm exec eslint src/blux/ir.ts` (expect clean).

- [ ] **Step 3: Commit**

```bash
git add src/blux/ir.ts
git commit -m "feat(blux): Content IR types"
```

---

## Task 2: the synthetic fixture

**Files:**

- Create: `tests/blux/fixtures/minimal-site.ts`

- [ ] **Step 1: Author the minimal Blux site object**

Create `tests/blux/fixtures/minimal-site.ts`. It mirrors the real `site.json` shape (learned from the census) but is tiny — one page with one block of each archetype, one feed, and a media map with a shared asset:

```ts
// A hand-authored minimal Blux site.json exercising each archetype, one feed,
// and shared media. Field names match the real export (title/_title, body/_body,
// media, backgroundMedia, class, items, styles).
export const minimalSite = {
  name: "Test Site",
  id: "site-1",
  domain: "www.testsite.com",
  content: {
    pages: [
      {
        title: "Home",
        description: "",
        items: [
          // hero: backgroundMedia + copy
          {
            _title: "<h1>Welcome</h1>",
            _body: "<p>Intro copy.</p>",
            backgroundMedia: { media: "img-1" },
            class: "",
            styles: {},
          },
          // heading + text + media
          {
            _title: "<h2>About</h2>",
            _body: "<p>About us.</p>",
            media: { media: "img-1" },
            styles: {},
          },
          // heading + text
          { _title: "<h2>Mission</h2>", _body: "<p>Our mission.</p>", styles: {} },
          // grid container of two children
          {
            class: "grid",
            items: [
              {
                _title: "<h3>Card A</h3>",
                _body: "<p>A.</p>",
                media: { media: "img-2" },
                styles: {},
              },
              {
                _title: "<h3>Card B</h3>",
                _body: "<p>B.</p>",
                media: { media: "img-2" },
                styles: {},
              },
            ],
            styles: {},
          },
        ],
        widgets: {},
        featured: false,
      },
    ],
  },
  navigation: [{ items: [{ title: "Home", url: "/" }], styles: {}, config: {} }],
  footer: [{ items: [], styles: {}, config: {} }],
  styles: {
    colors: { c1: "#111111", c2: "#ffffff", c3: "#3bb0c9" },
    text: { t1: { size: "16px", weight: 400, lineHeight: 1.5 } },
    buttons: {},
  },
  media: {
    "img-1": { name: "Hero.jpg", type: "image/jpeg", size: { w: 1600, h: 900 }, siteID: "site-1" },
    "img-2": { name: "Card.jpg", type: "image/jpeg", size: { w: 800, h: 600 }, siteID: "site-1" },
  },
  feeds: {
    "feed-1": {
      name: "Team",
      source: "manual",
      publish: "team",
      fields: [{ title: "Role", field: "role", type: "text" }],
      items: [
        { title: "Jane Doe", role: "CEO", body: "<p>Bio.</p>", media: { media: "img-2" } },
        { title: "John Roe", role: "CTO", body: "<p>Bio.</p>" },
      ],
    },
  },
  settings: { fonts: { heading: "Inter", body: "Inter" }, widgets: {} },
} as const;

// A rendered HTML string that references img-1 via the real CDN URL shape (with a
// transform segment) so assets.ts can be exercised.
export const minimalHtml = `<html><body>
<img src="https://d3syaxnfm3oj0e.cloudfront.net/site-1/w:96/from:jpg/img-1.jpg">
<img src="https://d3syaxnfm3oj0e.cloudfront.net/site-1/img-2.png">
</body></html>`;
```

- [ ] **Step 2: Commit**

```bash
git add tests/blux/fixtures/minimal-site.ts
git commit -m "test(blux): minimal synthetic Blux fixture"
```

---

## Task 3: parse

**Files:**

- Create: `src/blux/parse.ts`
- Create: `tests/blux/parse.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/blux/parse.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseBluxSite } from "../../src/blux/parse";
import { minimalSite } from "./fixtures/minimal-site";

describe("parseBluxSite", () => {
  it("shapes meta, pages, feeds, media, styles from site.json", () => {
    const raw = parseBluxSite(minimalSite);
    expect(raw.meta).toEqual({
      name: "Test Site",
      domain: "www.testsite.com",
      bluxSiteId: "site-1",
    });
    expect(raw.pages).toHaveLength(1);
    expect(raw.pages[0]!.items).toHaveLength(4);
    expect(Object.keys(raw.feeds)).toEqual(["feed-1"]);
    expect(Object.keys(raw.media)).toEqual(["img-1", "img-2"]);
    expect(raw.styles.colors).toBeDefined();
  });

  it("throws a clear error on a non-object", () => {
    expect(() => parseBluxSite(null)).toThrow(/site\.json/i);
  });
});
```

- [ ] **Step 2: Run it, expect FAIL**

Run: `cd /Users/tuckerlemos/Documents/GitHub/reddoor-maintenance && pnpm exec vitest run tests/blux/parse.test.ts`
Expected: FAIL — cannot import `parseBluxSite`.

- [ ] **Step 3: Implement**

Create `src/blux/parse.ts`:

```ts
export type BluxBlock = {
  title?: string;
  _title?: string;
  body?: string;
  _body?: string;
  media?: { media?: string };
  backgroundMedia?: { media?: string };
  class?: string;
  ratio?: string;
  loadEffect?: string;
  items?: BluxBlock[];
  styles?: Record<string, unknown>;
};
export type BluxPage = { title?: string; description?: string; items?: BluxBlock[] };
export type BluxFeed = {
  name?: string;
  source?: string;
  publish?: string;
  fields?: { title?: string; field?: string; type?: string }[];
  items?: Record<string, unknown>[];
};
export type BluxMedia = { name?: string; type?: string; size?: unknown; siteID?: string };
export type BluxRaw = {
  meta: { name: string; domain: string; bluxSiteId: string };
  pages: BluxPage[];
  feeds: Record<string, BluxFeed>;
  media: Record<string, BluxMedia>;
  styles: {
    colors?: Record<string, string>;
    text?: Record<string, unknown>;
    buttons?: Record<string, unknown>;
  };
  nav: { title?: string; url?: string }[];
  settings: { fonts?: { heading?: string; body?: string } };
};

function asObject(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v))
    throw new Error("Invalid site.json: expected an object");
  return v as Record<string, unknown>;
}

export function parseBluxSite(input: unknown): BluxRaw {
  const j = asObject(input);
  const content = (j.content ?? {}) as { pages?: BluxPage[] };
  const styles = (j.styles ?? {}) as BluxRaw["styles"];
  const nav = ((j.navigation as { items?: unknown }[] | undefined)?.[0]?.items ?? []) as {
    title?: string;
    url?: string;
  }[];
  return {
    meta: {
      name: String(j.name ?? ""),
      domain: String(j.domain ?? ""),
      bluxSiteId: String(j.id ?? ""),
    },
    pages: Array.isArray(content.pages) ? content.pages : [],
    feeds: (j.feeds ?? {}) as Record<string, BluxFeed>,
    media: (j.media ?? {}) as Record<string, BluxMedia>,
    styles,
    nav,
    settings: (j.settings ?? {}) as BluxRaw["settings"],
  };
}
```

- [ ] **Step 4: Run it, expect PASS**

Run: `pnpm exec vitest run tests/blux/parse.test.ts`
Expected: 2 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/blux/parse.ts tests/blux/parse.test.ts
git commit -m "feat(blux): parse site.json into BluxRaw"
```

---

## Task 4: archetype

**Files:**

- Create: `src/blux/archetype.ts`
- Create: `tests/blux/archetype.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/blux/archetype.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { archetype } from "../../src/blux/archetype";

describe("archetype", () => {
  it("maps bg-media + copy to hero", () => {
    const r = archetype({
      _title: "<h1>x</h1>",
      _body: "<p>y</p>",
      backgroundMedia: { media: "m" },
    });
    expect(r.sliceType).toBe("hero");
    expect(r.confidence).toBeGreaterThanOrEqual(0.8);
  });
  it("maps heading+text+media to media_text", () => {
    expect(
      archetype({ _title: "<h2>x</h2>", _body: "<p>y</p>", media: { media: "m" } }).sliceType,
    ).toBe("media_text");
  });
  it("maps heading+text to rich_text", () => {
    expect(archetype({ _title: "<h2>x</h2>", _body: "<p>y</p>" }).sliceType).toBe("rich_text");
  });
  it("maps a grid container to grid", () => {
    expect(archetype({ class: "grid", items: [{ _title: "a" }] }).sliceType).toBe("grid");
  });
  it("maps a slides container to slider", () => {
    expect(archetype({ class: "slides", items: [{ _title: "a" }] }).sliceType).toBe("slider");
  });
  it("flags an empty/unknown block as low confidence", () => {
    expect(archetype({}).confidence).toBeLessThan(0.5);
  });
});
```

- [ ] **Step 2: Run it, expect FAIL**

Run: `pnpm exec vitest run tests/blux/archetype.test.ts` — FAIL (no `archetype`).

- [ ] **Step 3: Implement**

Create `src/blux/archetype.ts`:

```ts
import type { BluxBlock } from "./parse";

const nonEmpty = (v: unknown): boolean =>
  v != null &&
  v !== "" &&
  !(Array.isArray(v) && v.length === 0) &&
  !(typeof v === "object" && !Array.isArray(v) && Object.keys(v as object).length === 0);

export type ArchetypeResult = {
  sliceType: "hero" | "media_text" | "rich_text" | "grid" | "slider" | "collection_list";
  variation: string;
  confidence: number;
};

export function archetype(b: BluxBlock): ArchetypeResult {
  const heading = nonEmpty(b.title) || nonEmpty(b._title);
  const text = nonEmpty(b.body) || nonEmpty(b._body);
  const media = nonEmpty(b.media?.media);
  const bg = nonEmpty(b.backgroundMedia?.media);
  const kids = Array.isArray(b.items) && b.items.length > 0;
  const cls = nonEmpty(b.class) ? String(b.class) : null;

  if (bg && (heading || text)) return { sliceType: "hero", variation: "default", confidence: 0.9 };
  if (kids && cls === "slides")
    return { sliceType: "slider", variation: "default", confidence: 0.85 };
  if (kids)
    return { sliceType: "grid", variation: "default", confidence: cls === "grid" ? 0.9 : 0.7 };
  if (heading && text && media)
    return { sliceType: "media_text", variation: "imageRight", confidence: 0.9 };
  if (heading && text) return { sliceType: "rich_text", variation: "default", confidence: 0.85 };
  if (media && !heading && !text)
    return { sliceType: "media_text", variation: "imageRight", confidence: 0.6 };
  if (text) return { sliceType: "rich_text", variation: "default", confidence: 0.6 };
  return { sliceType: "rich_text", variation: "default", confidence: 0.2 };
}
```

- [ ] **Step 4: Run it, expect PASS**

Run: `pnpm exec vitest run tests/blux/archetype.test.ts` — 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/blux/archetype.ts tests/blux/archetype.test.ts
git commit -m "feat(blux): block archetype mapping"
```

---

## Task 5: normalize (pages + theme)

**Files:**

- Create: `src/blux/normalize.ts`
- Create: `tests/blux/normalize.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/blux/normalize.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseBluxSite } from "../../src/blux/parse";
import { normalizePages, normalizeTheme } from "../../src/blux/normalize";
import { minimalSite } from "./fixtures/minimal-site";

describe("normalizePages", () => {
  const raw = parseBluxSite(minimalSite);
  it("produces one page with hero, media_text, rich_text, grid sections", () => {
    const { pages } = normalizePages(raw);
    expect(pages).toHaveLength(1);
    expect(pages[0]!.sections.map((s) => s.sliceType)).toEqual([
      "hero",
      "media_text",
      "rich_text",
      "grid",
    ]);
  });
  it("nests grid children as SectionIR", () => {
    const { pages } = normalizePages(raw);
    const grid = pages[0]!.sections.find((s) => s.sliceType === "grid")!;
    expect(grid.children).toHaveLength(2);
    expect(grid.children![0]!.fields.media).toBe("img-2");
  });
  it("carries media ids and raises no low-confidence diagnostics for the fixture", () => {
    const { pages, diagnostics } = normalizePages(raw);
    expect(pages[0]!.sections[0]!.fields.backgroundMedia).toBe("img-1");
    expect(diagnostics).toHaveLength(0);
  });
});

describe("normalizeTheme", () => {
  it("maps the palette + font pair", () => {
    const theme = normalizeTheme(parseBluxSite(minimalSite));
    expect(theme.colors).toHaveLength(3);
    expect(theme.fonts).toEqual({ heading: "Inter", body: "Inter" });
  });
});
```

- [ ] **Step 2: Run it, expect FAIL**

Run: `pnpm exec vitest run tests/blux/normalize.test.ts` — FAIL.

- [ ] **Step 3: Implement**

Create `src/blux/normalize.ts`:

```ts
import type { BluxBlock, BluxRaw } from "./parse";
import { archetype } from "./archetype";
import type { PageIR, SectionIR, ThemeIR, Diagnostic } from "./ir";

const CONFIDENCE_MIN = 0.5;

function sectionFromBlock(b: BluxBlock, pageUid: string, diagnostics: Diagnostic[]): SectionIR {
  const a = archetype(b);
  if (a.confidence < CONFIDENCE_MIN) {
    diagnostics.push({
      kind: "low-confidence-block",
      where: pageUid,
      message: `block mapped to ${a.sliceType} at ${a.confidence}`,
    });
  }
  const section: SectionIR = {
    sliceType: a.sliceType,
    variation: a.variation,
    confidence: a.confidence,
    fields: {
      ...(b._title || b.title ? { heading: String(b._title ?? b.title) } : {}),
      ...(b._body || b.body ? { body: String(b._body ?? b.body) } : {}),
      ...(b.media?.media ? { media: b.media.media } : {}),
      ...(b.backgroundMedia?.media ? { backgroundMedia: b.backgroundMedia.media } : {}),
      ...(b.ratio ? { ratio: String(b.ratio) } : {}),
      ...(b.loadEffect ? { anim: String(b.loadEffect) } : {}),
    },
  };
  if (Array.isArray(b.items) && b.items.length > 0) {
    section.children = b.items.map((child) => sectionFromBlock(child, pageUid, diagnostics));
  }
  return section;
}

function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "page"
  );
}

export function normalizePages(raw: BluxRaw): { pages: PageIR[]; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = [];
  const pages = raw.pages.map((p) => {
    const uid = slugify(String(p.title ?? ""));
    return {
      uid,
      title: String(p.title ?? ""),
      description: String(p.description ?? ""),
      sections: (p.items ?? []).map((b) => sectionFromBlock(b, uid, diagnostics)),
    };
  });
  return { pages, diagnostics };
}

export function normalizeTheme(raw: BluxRaw): ThemeIR {
  const colors = Object.entries(raw.styles.colors ?? {}).map(([role, value]) => ({
    role,
    value: String(value),
  }));
  const textStyles = Object.entries(raw.styles.text ?? {}).map(([role, v]) => {
    const t = (v ?? {}) as { size?: string; weight?: number; lineHeight?: number };
    return {
      role,
      size: String(t.size ?? "16px"),
      weight: Number(t.weight ?? 400),
      lineHeight: Number(t.lineHeight ?? 1.5),
    };
  });
  return {
    colors,
    fonts: {
      heading: String(raw.settings.fonts?.heading ?? ""),
      body: String(raw.settings.fonts?.body ?? ""),
    },
    textStyles,
  };
}
```

- [ ] **Step 4: Run it, expect PASS**

Run: `pnpm exec vitest run tests/blux/normalize.test.ts` — 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/blux/normalize.ts tests/blux/normalize.test.ts
git commit -m "feat(blux): normalize pages + theme into IR"
```

---

## Task 6: model-collections

**Files:**

- Create: `src/blux/collections.ts`
- Create: `tests/blux/collections.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/blux/collections.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseBluxSite } from "../../src/blux/parse";
import { modelCollections } from "../../src/blux/collections";
import { minimalSite } from "./fixtures/minimal-site";

describe("modelCollections", () => {
  const collections = modelCollections(parseBluxSite(minimalSite));
  it("turns the Team feed into a repeatable custom type", () => {
    expect(collections).toHaveLength(1);
    const c = collections[0]!;
    expect(c.apiId).toBe("team");
    expect(c.label).toBe("Team");
    expect(c.publishRoute).toBe("team");
  });
  it("derives a typed schema from declared fields + item keys", () => {
    const keys = collections[0]!.fields.map((f) => `${f.key}:${f.type}`);
    expect(keys).toContain("title:text");
    expect(keys).toContain("role:text");
    expect(keys).toContain("body:richtext");
    expect(keys).toContain("media:image");
  });
  it("emits one record per item with media refs", () => {
    const c = collections[0]!;
    expect(c.records).toHaveLength(2);
    expect(c.records[0]!.values.title).toBe("Jane Doe");
    expect(c.records[0]!.mediaRefs).toEqual(["img-2"]);
    expect(c.records[1]!.mediaRefs).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it, expect FAIL**

Run: `pnpm exec vitest run tests/blux/collections.test.ts` — FAIL.

- [ ] **Step 3: Implement**

Create `src/blux/collections.ts`:

```ts
import type { BluxFeed, BluxRaw } from "./parse";
import type { CollectionIR, FieldDef, RecordIR } from "./ir";

function singularSlug(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
  return slug.replace(/s$/, "") || "item";
}

const RICHTEXT_KEYS = new Set(["body", "description"]);

function fieldType(key: string, value: unknown): FieldDef["type"] {
  if (RICHTEXT_KEYS.has(key)) return "richtext";
  if (value && typeof value === "object" && "media" in (value as object)) return "image";
  if (Array.isArray(value)) return "group";
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number") return "number";
  if (key === "date") return "date";
  if (/^(url|link)/.test(key)) return "link";
  return "text";
}

function deriveFields(feed: BluxFeed): FieldDef[] {
  const seen = new Map<string, FieldDef["type"]>();
  // Declared custom fields first (Blux feed.fields), then observed item keys.
  for (const d of feed.fields ?? []) {
    if (d.field) seen.set(d.field, "text");
  }
  for (const item of feed.items ?? []) {
    for (const [key, value] of Object.entries(item)) {
      if (!seen.has(key) || seen.get(key) === "text") seen.set(key, fieldType(key, value));
    }
  }
  return [...seen.entries()].map(([key, type]) => ({ key, type }));
}

function recordUid(values: Record<string, unknown>, i: number): string {
  const title = typeof values.title === "string" ? values.title : "";
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return slug || `item-${i}`;
}

export function modelCollections(raw: BluxRaw): CollectionIR[] {
  const out: CollectionIR[] = [];
  for (const feed of Object.values(raw.feeds)) {
    const label = String(feed.name ?? "");
    const items = feed.items ?? [];
    const records: RecordIR[] = items.map((item, i) => {
      const mediaRefs: string[] = [];
      for (const value of Object.values(item)) {
        if (
          value &&
          typeof value === "object" &&
          typeof (value as { media?: string }).media === "string"
        ) {
          mediaRefs.push((value as { media: string }).media);
        }
      }
      return { uid: recordUid(item, i), values: item, mediaRefs };
    });
    out.push({
      apiId: singularSlug(label),
      label,
      publishRoute: feed.publish ? String(feed.publish) : null,
      fields: deriveFields(feed),
      records,
    });
  }
  return out;
}
```

- [ ] **Step 4: Run it, expect PASS**

Run: `pnpm exec vitest run tests/blux/collections.test.ts` — 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/blux/collections.ts tests/blux/collections.test.ts
git commit -m "feat(blux): model feeds as repeatable custom types"
```

---

## Task 7: resolve-assets (pure URL layer)

**Files:**

- Create: `src/blux/assets.ts`
- Create: `tests/blux/assets.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/blux/assets.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { normalizeCdnUrl, collectAssetUrls } from "../../src/blux/assets";
import { minimalHtml } from "./fixtures/minimal-site";

describe("normalizeCdnUrl", () => {
  it("strips transform segments to the canonical original", () => {
    expect(
      normalizeCdnUrl("https://d3syaxnfm3oj0e.cloudfront.net/site-1/w:96/from:jpg/img-1.jpg"),
    ).toBe("https://d3syaxnfm3oj0e.cloudfront.net/site-1/img-1.jpg");
  });
  it("passes through an already-canonical url", () => {
    expect(normalizeCdnUrl("https://d3syaxnfm3oj0e.cloudfront.net/site-1/img-2.png")).toBe(
      "https://d3syaxnfm3oj0e.cloudfront.net/site-1/img-2.png",
    );
  });
  it("returns null for a non-cdn url", () => {
    expect(normalizeCdnUrl("https://example.com/x.jpg")).toBeNull();
  });
});

describe("collectAssetUrls", () => {
  it("builds a uuid → canonical-url map from rendered HTML", () => {
    const map = collectAssetUrls([minimalHtml]);
    expect(map.get("img-1")).toBe("https://d3syaxnfm3oj0e.cloudfront.net/site-1/img-1.jpg");
    expect(map.get("img-2")).toBe("https://d3syaxnfm3oj0e.cloudfront.net/site-1/img-2.png");
  });
});
```

- [ ] **Step 2: Run it, expect FAIL**

Run: `pnpm exec vitest run tests/blux/assets.test.ts` — FAIL.

- [ ] **Step 3: Implement**

Create `src/blux/assets.ts`:

```ts
const HOSTS = ["d3syaxnfm3oj0e.cloudfront.net", "dv4tl7yyk1zlp.cloudfront.net"];

/** Strip Blux transform segments (any path part containing ':') to the proven
 *  original `<host>/<siteId>/<uuid>.<ext>`. Returns null for non-CDN urls. */
export function normalizeCdnUrl(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (!HOSTS.includes(u.hostname)) return null;
  const segs = u.pathname.split("/").filter(Boolean);
  if (segs.length < 2) return null;
  const siteId = segs[0];
  const file = segs[segs.length - 1];
  if (!/\.[a-z0-9]+$/i.test(file)) return null;
  return `https://${u.hostname}/${siteId}/${file}`;
}

const URL_RE = new RegExp(
  `https?://(?:${HOSTS.join("|").replace(/\./g, "\\.")})/[^"'\\\\ )>]+`,
  "g",
);

/** uuid (last path segment sans extension) → canonical CDN url, scraped from HTML. */
export function collectAssetUrls(htmls: string[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const html of htmls) {
    for (const m of html.matchAll(URL_RE)) {
      const canon = normalizeCdnUrl(m[0]);
      if (!canon) continue;
      const file = canon.split("/").pop()!;
      const uuid = file.replace(/\.[a-z0-9]+$/i, "");
      if (!map.has(uuid)) map.set(uuid, canon);
    }
  }
  return map;
}
```

- [ ] **Step 4: Run it, expect PASS**

Run: `pnpm exec vitest run tests/blux/assets.test.ts` — 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/blux/assets.ts tests/blux/assets.test.ts
git commit -m "feat(blux): pure CDN-url normalization + HTML asset scrape"
```

---

## Task 8: assemble the SiteIR

**Files:**

- Create: `src/blux/assemble.ts`
- Create: `tests/blux/assemble.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/blux/assemble.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { assembleIR } from "../../src/blux/assemble";
import { minimalSite, minimalHtml } from "./fixtures/minimal-site";

describe("assembleIR", () => {
  const ir = assembleIR({ siteJson: minimalSite, htmls: [minimalHtml] });
  it("assembles a complete SiteIR", () => {
    expect(ir.meta.name).toBe("Test Site");
    expect(ir.pages).toHaveLength(1);
    expect(ir.collections).toHaveLength(1);
    expect(ir.theme.colors).toHaveLength(3);
  });
  it("resolves every referenced asset to a canonical url", () => {
    const img1 = ir.assets.find((a) => a.id === "img-1")!;
    expect(img1.sourceUrl).toBe("https://d3syaxnfm3oj0e.cloudfront.net/site-1/img-1.jpg");
    expect(ir.assets.every((a) => a.sourceUrl !== null)).toBe(true);
    expect(ir.diagnostics.filter((d) => d.kind === "unresolved-asset")).toHaveLength(0);
  });
  it("is deterministic — same input yields deep-equal output", () => {
    const again = assembleIR({ siteJson: minimalSite, htmls: [minimalHtml] });
    expect(again).toEqual(ir);
  });
});
```

- [ ] **Step 2: Run it, expect FAIL**

Run: `pnpm exec vitest run tests/blux/assemble.test.ts` — FAIL.

- [ ] **Step 3: Implement**

Create `src/blux/assemble.ts`:

```ts
import { parseBluxSite } from "./parse";
import { normalizePages, normalizeTheme } from "./normalize";
import { modelCollections } from "./collections";
import { collectAssetUrls } from "./assets";
import type { AssetRef, Diagnostic, SiteIR } from "./ir";

export function assembleIR(input: { siteJson: unknown; htmls: string[] }): SiteIR {
  const raw = parseBluxSite(input.siteJson);
  const { pages, diagnostics: pageDiags } = normalizePages(raw);
  const theme = normalizeTheme(raw);
  const collections = modelCollections(raw);
  const urlMap = collectAssetUrls(input.htmls);

  const diagnostics: Diagnostic[] = [...pageDiags];
  const assets: AssetRef[] = Object.entries(raw.media).map(([id, m]) => {
    const sourceUrl = urlMap.get(id) ?? null;
    if (!sourceUrl)
      diagnostics.push({
        kind: "unresolved-asset",
        where: id,
        message: `no CDN url for ${m.name ?? id}`,
      });
    return {
      id,
      sourceUrl,
      name: String(m.name ?? ""),
      mime: String(m.type ?? ""),
      alt: String(m.name ?? ""),
    };
  });

  return {
    meta: raw.meta,
    theme,
    pages,
    collections,
    assets,
    diagnostics,
  };
}
```

- [ ] **Step 4: Run it, expect PASS**

Run: `pnpm exec vitest run tests/blux/assemble.test.ts` — 3 tests PASS.

- [ ] **Step 5: Full-suite + lint + commit**

Run: `pnpm exec vitest run tests/blux/ && pnpm run lint`
Expected: all blux tests pass; lint clean.

```bash
git add src/blux/assemble.ts tests/blux/assemble.test.ts
git commit -m "feat(blux): assemble the Content IR from a Blux export"
```

---

## Self-review notes

- **Spec coverage:** implements the spec's `parse`, `normalize`, `model-collections`, and the pure layer of `resolve-assets`, producing the `SiteIR`. The live ext-probe/download and the Prismic/theme emit are deliberately deferred to Plan 3.
- **Determinism:** every function is pure; Task 8 asserts deep-equal on a re-run. No `Date.now()`/network in the tested path.
- **Types:** `BluxBlock`/`BluxRaw` (from `parse.ts`) and the IR types (`ir.ts`) are the shared vocabulary; `archetype` consumes `BluxBlock`, `normalize`/`collections` produce IR.
- **Fixtures:** synthetic + in-repo (no client data). A later local-only harness can run `assembleIR` over the real `~/Desktop` exports and snapshot the IR for a coverage check.

## Next plan

- **Plan 3 — emit + end-to-end:** `emit-prismic` (custom-type schemas + collection docs + page docs + `createAsset` upload), `emit-theme` (IR → SvelteKit tokens), `review` gallery; proven end-to-end on thePinnacle against a staging Prismic repo.
