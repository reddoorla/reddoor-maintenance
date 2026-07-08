# Blux Pipeline — Plan 4: emit/runner hardening (Pointe live-run findings)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the seven defects the first live conversion (thePointe → the-pointe.prismic.io, 2026-07-06) exposed, so a single `blux emit --probe` + `blux migrate` produces a complete, valid, re-runnable migration.

**Architecture:** All content-shaping fixes land in the **pure emit layer** (coercion at the HTML level, tree flattening, plan-time diagnostics) so `migration-plan.json` is already valid against the slice models and stays snapshot-testable. The **runner** is rewritten on the raw Migration/Asset APIs — upsert by uid, skip already-uploaded assets, surface full `details[]` — with its pure marker-resolution extracted to a tested module. The CDN probe becomes an injectable-fetch module wired to `blux emit --probe`.

**Tech Stack:** TypeScript + tsx, Vitest, `@prismicio/migrate` (`htmlAsRichText`, devDep), raw `fetch` against `asset-api.prismic.io` / `migration.prismic.io` / `customtypes.prismic.io`.

**Live-run evidence this plan fixes** (details in the session memory `blux-pipeline-pointe-live-run`):

1. Slice heading fields are `single` + heading-restricted; bodies allow no headings → 31 blocks failed validation.
2. Page `title` is StructuredText(single heading1); we sent a plain string.
3. `sectionToSlice` flattens one nesting level → depth-4 trees lost most content (7/53 images survived).
4. Blux puts video/pdf in image slots → Prismic Image fields reject them.
5. Export HTML is a shell → scrape resolved 4/320 assets; CDN reconstruct+probe resolved 52/52 but lived in a scratchpad script.
6. `createDocument` is create-only → re-runs crash "UID already exists" and duplicate every asset (112→56 cleanup).
7. The client swallows Migration API `details[]` → "Validation failed" with no cause.

The field-type contract (mirrors `reddoor-starter/src/lib/slices/*/model.json` — keep in sync):

| field                             | allowed blocks                           | single |
| --------------------------------- | ---------------------------------------- | ------ |
| page `title`                      | heading1                                 | yes    |
| `hero.primary.heading`            | h1, h2                                   | yes    |
| `media_text.primary.heading`      | h2, h3                                   | yes    |
| `section_grid.primary.heading`    | h2, h3                                   | yes    |
| `section_grid.items.item_heading` | h3, h4                                   | yes    |
| all `body`/`item_body`            | paragraph (+inline, lists on media_text) | no     |
| `rich_text.primary.content`       | everything                               | no     |

---

### Task 1: HTML-level rich-text coercion helpers

**Files:**

- Create: `src/blux/emit/coerce-html.ts`
- Test: `tests/blux/emit/coerce-html.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { coerceHeadingHtml, demoteHeadingsHtml } from "../../../src/blux/emit/coerce-html.js";

describe("coerceHeadingHtml", () => {
  it("keeps an allowed heading tag", () => {
    expect(coerceHeadingHtml("<h2>Hi</h2>", ["h1", "h2"])).toBe("<h2>Hi</h2>");
  });
  it("clamps a disallowed heading to the nearest allowed level", () => {
    expect(coerceHeadingHtml('<h5 class="x">Hi</h5>', ["h2", "h3"])).toBe('<h3 class="x">Hi</h3>');
    expect(coerceHeadingHtml("<h1>Hi</h1>", ["h3", "h4"])).toBe("<h3>Hi</h3>");
  });
  it("promotes a paragraph to the lowest allowed heading", () => {
    expect(coerceHeadingHtml("<p>Hi</p>", ["h1", "h2"])).toBe("<h2>Hi</h2>");
  });
  it("wraps bare text in the target tag", () => {
    expect(coerceHeadingHtml("Hi", ["h2", "h3"])).toBe("<h3>Hi</h3>");
  });
  it("keeps only the first block for single fields", () => {
    expect(coerceHeadingHtml("<h2>One</h2><p>Two</p>", ["h2", "h3"])).toBe("<h2>One</h2>");
  });
});

describe("demoteHeadingsHtml", () => {
  it("rewrites heading tags to paragraphs, preserving attributes and inline markup", () => {
    expect(demoteHeadingsHtml('<h3 class="x">A <strong>b</strong></h3><p>c</p>')).toBe(
      '<p class="x">A <strong>b</strong></p><p>c</p>',
    );
  });
});
```

- [ ] **Step 2: Run → FAIL** (`touch dist/cli/bin.js` first to skip the stale-dist rebuild): `pnpm exec vitest run tests/blux/emit/coerce-html.test.ts` — expect "Cannot find module … coerce-html.js".

- [ ] **Step 3: Implement** `src/blux/emit/coerce-html.ts`:

```ts
/** HTML-level rich-text coercion so emitted plans validate against the slice
 *  models' StructuredText restrictions (see the field-type table in Plan 4).
 *  Blux markup is simple generated HTML, so tag rewriting is reliable here. */

const BLOCK_RE = /<(h[1-6]|p|div)(\s[^>]*)?>[\s\S]*?<\/\1>/i;

/** Coerce a heading-slot HTML fragment to a single block whose tag is in
 *  `allowed` (e.g. ["h2","h3"]): keep an allowed tag, clamp other headings to
 *  the nearest allowed level, promote paragraphs/bare text to the LOWEST
 *  allowed heading. Only the first block survives (the fields are `single`). */
export function coerceHeadingHtml(html: string, allowed: string[]): string {
  const m = html.match(BLOCK_RE);
  const block = m ? m[0] : html;
  const tagMatch = block.match(/^<(h[1-6]|p|div)(\s[^>]*)?>/i);
  const tag = tagMatch?.[1]?.toLowerCase();
  if (tag && allowed.includes(tag)) return block;

  const levels = allowed.filter((t) => /^h[1-6]$/.test(t)).map((t) => Number(t[1]));
  const target = tag?.startsWith("h")
    ? `h${levels.reduce((b, l) => (Math.abs(l - Number(tag[1])) < Math.abs(b - Number(tag[1])) ? l : b))}`
    : `h${Math.max(...levels)}`;

  if (!tag) return `<${target}>${block}</${target}>`;
  return block
    .replace(new RegExp(`^<${tag}`, "i"), `<${target}`)
    .replace(new RegExp(`</${tag}>$`, "i"), `</${target}>`);
}

/** Demote all headings in a body-slot fragment to paragraphs (body fields
 *  allow no heading blocks). Attributes and inline markup pass through. */
export function demoteHeadingsHtml(html: string): string {
  return html.replace(/<(\/?)h[1-6](\s[^>]*)?>/gi, "<$1p$2>");
}
```

- [ ] **Step 4: Run → PASS**: `pnpm exec vitest run tests/blux/emit/coerce-html.test.ts`

- [ ] **Step 5: Commit** `git add src/blux/emit/coerce-html.ts tests/blux/emit/coerce-html.test.ts && git commit -m "feat(blux): HTML-level rich-text coercion helpers"`

---

### Task 2: apply coercion in sectionToSlice + page title

**Files:**

- Modify: `src/blux/emit/slices.ts`
- Modify: `src/blux/emit/migration-plan.ts` (title only; rest in Task 4)
- Test: `tests/blux/emit/slices.test.ts` (update expectations), `tests/blux/emit/migration-plan.test.ts`

- [ ] **Step 1: Write the failing tests** — add to `tests/blux/emit/slices.test.ts`:

```ts
it("coerces heading HTML to each field's allowed tags", () => {
  const s = sectionToSlice({
    sliceType: "media_text",
    variation: "imageRight",
    confidence: 1,
    fields: { heading: "<h5>Deep</h5>", body: "<h3>Not a heading slot</h3><p>ok</p>" },
  });
  expect(s.primary.heading).toEqual({ __richtext_html: "<h3>Deep</h3>" });
  expect(s.primary.body).toEqual({ __richtext_html: "<p>Not a heading slot</p><p>ok</p>" });
});
```

and to `tests/blux/emit/migration-plan.test.ts`:

```ts
it("emits the page title as single-heading1 rich text", () => {
  const plan = buildMigrationPlan(ir); // existing fixture IR
  const page = plan.documents.find((d) => d.type === "page");
  expect(page?.data.title).toEqual({ __richtext_html: "<h1>Home</h1>" });
});
```

- [ ] **Step 2: Run → FAIL**: `pnpm exec vitest run tests/blux/emit/slices.test.ts tests/blux/emit/migration-plan.test.ts`

- [ ] **Step 3: Implement** — in `src/blux/emit/slices.ts`, import the helpers and define the contract map next to `sectionToSlice` (documented as mirroring the starter models):

```ts
import { coerceHeadingHtml, demoteHeadingsHtml } from "./coerce-html.js";

/** Allowed heading tags per slice heading slot — MUST mirror
 *  reddoor-starter/src/lib/slices/<Slice>/model.json StructuredText configs. */
const HEADING_TAGS: Record<string, string[]> = {
  hero: ["h1", "h2"],
  media_text: ["h2", "h3"],
  section_grid: ["h2", "h3"],
  section_grid_item: ["h3", "h4"],
};
const rtHeading = (html: string | undefined, slot: string) =>
  html ? richText(coerceHeadingHtml(html, HEADING_TAGS[slot])) : undefined;
const rtBody = (html?: string) => (html ? richText(demoteHeadingsHtml(html)) : undefined);
```

Replace in each case: hero `heading: rtHeading(f.heading, "hero"), body: rtBody(f.body)`; media_text `heading: rtHeading(f.heading, "media_text"), body: rtBody(f.body)`; grid/slider `heading: rtHeading(f.heading, "section_grid")`, items `item_heading: rtHeading(c.fields.heading, "section_grid_item"), item_body: rtBody(c.fields.body)`. The `rich_text` case keeps plain `rt` (content allows everything). In `migration-plan.ts` change the page document to:

```ts
documents.push({
  type: "page",
  uid: page.uid,
  data: {
    title: richText(coerceHeadingHtml(page.title || page.uid, ["h1"])),
    slices: page.sections.map(sectionToSlice),
  },
});
```

(import `coerceHeadingHtml` there; `richText` is already imported).

- [ ] **Step 4: Run the two suites → PASS**, and fix any pre-existing expectation in `slices.test.ts`/`migration-plan.test.ts` that asserted the old raw markers (update the expected HTML to its coerced form — deliberate behavior change).

- [ ] **Step 5: Commit** `git commit -am "feat(blux): coerce rich text to slice-model block restrictions at emit"`

---

### Task 3: flatten deep section trees

**Files:**

- Create: `src/blux/emit/flatten.ts`
- Test: `tests/blux/emit/flatten.test.ts`

Rule: a container (`grid`/`slider`) **keeps its items form only when every child is a childless `media_text` or `rich_text`**. Otherwise it explodes: its own heading (if any) becomes a `rich_text` section, then each child is emitted in order as a sibling (containers recurse). This preserves heroes' background images and depth-4 content as sequential slices.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { flattenSections } from "../../../src/blux/emit/flatten.js";
import type { SectionIR } from "../../../src/blux/ir.js";

const leaf = (over: Partial<SectionIR> = {}): SectionIR => ({
  sliceType: "media_text",
  variation: "imageRight",
  confidence: 1,
  fields: { body: "<p>x</p>" },
  ...over,
});

describe("flattenSections", () => {
  it("keeps a pure-leaf grid intact", () => {
    const grid: SectionIR = {
      sliceType: "grid",
      variation: "default",
      confidence: 1,
      fields: {},
      children: [leaf(), leaf()],
    };
    expect(flattenSections([grid])).toEqual([grid]);
  });
  it("explodes a grid containing a nested container, hoisting grandchildren", () => {
    const inner: SectionIR = {
      sliceType: "grid",
      variation: "default",
      confidence: 1,
      fields: {},
      children: [leaf(), leaf()],
    };
    const outer: SectionIR = {
      sliceType: "grid",
      variation: "default",
      confidence: 1,
      fields: { heading: "<h2>Section</h2>" },
      children: [leaf(), inner],
    };
    const out = flattenSections([outer]);
    expect(out.map((s) => s.sliceType)).toEqual(["rich_text", "media_text", "grid"]);
    expect(out[0].fields.heading).toBe("<h2>Section</h2>");
    expect(out[2].children).toHaveLength(2);
  });
  it("explodes a grid containing a hero so the hero keeps its background", () => {
    const hero = leaf({ sliceType: "hero", fields: { backgroundMedia: "img-1" } });
    const grid: SectionIR = {
      sliceType: "grid",
      variation: "default",
      confidence: 1,
      fields: {},
      children: [hero, leaf()],
    };
    expect(flattenSections([grid]).map((s) => s.sliceType)).toEqual(["hero", "media_text"]);
  });
});
```

- [ ] **Step 2: Run → FAIL**: `pnpm exec vitest run tests/blux/emit/flatten.test.ts`

- [ ] **Step 3: Implement** `src/blux/emit/flatten.ts`:

```ts
import type { SectionIR } from "../ir.js";

const isContainer = (s: SectionIR) => s.sliceType === "grid" || s.sliceType === "slider";
const isFlatLeaf = (s: SectionIR) =>
  (s.sliceType === "media_text" || s.sliceType === "rich_text") && !(s.children ?? []).length;

/** Depth-first flatten: Prismic slices cannot nest, so a container survives
 *  as a section_grid-with-items only when every child is representable as a
 *  flat item (childless media_text/rich_text). Anything richer explodes into
 *  sequential sibling sections — the container's heading becomes a rich_text
 *  section so the visual grouping label survives. */
export function flattenSections(sections: SectionIR[]): SectionIR[] {
  const out: SectionIR[] = [];
  for (const s of sections) {
    const children = s.children ?? [];
    if (isContainer(s) && children.length && !children.every(isFlatLeaf)) {
      if (s.fields.heading) {
        out.push({
          sliceType: "rich_text",
          variation: "default",
          confidence: s.confidence,
          fields: { heading: s.fields.heading },
        });
      }
      out.push(...flattenSections(children));
    } else {
      out.push(s);
    }
  }
  return out;
}
```

- [ ] **Step 4: Run → PASS**

- [ ] **Step 5: Commit** `git commit -am "feat(blux): flatten deep section trees into sequential slices"`

---

### Task 4: migration-plan hardening (flatten + skip-empty + non-image + diagnostics)

**Files:**

- Modify: `src/blux/emit/plan.ts` (add `diagnostics` to `MigrationPlan`)
- Modify: `src/blux/emit/migration-plan.ts`
- Modify: `src/cli/commands/blux.ts` (print plan diagnostics; count skipped pages)
- Test: `tests/blux/emit/migration-plan.test.ts`, `tests/cli/blux-command.test.ts`

- [ ] **Step 1: Write the failing tests** — add to `migration-plan.test.ts`:

```ts
it("skips empty pages with a diagnostic instead of emitting hollow documents", () => {
  const withEmpty = {
    ...ir,
    pages: [...ir.pages, { uid: "stub", title: "", description: "", sections: [] }],
  };
  const plan = buildMigrationPlan(withEmpty);
  expect(plan.documents.find((d) => d.uid === "stub")).toBeUndefined();
  expect(plan.diagnostics).toContainEqual(
    expect.objectContaining({ kind: "empty-page", where: "stub" }),
  );
});

it("drops non-image assets from image fields with a diagnostic", () => {
  // minimal fixture: give the hero's backgroundMedia asset a video mime
  const videoIr = structuredClone(ir);
  const heroAsset = videoIr.assets.find(
    (a) => a.id === videoIr.pages[0].sections[0].fields.backgroundMedia,
  );
  heroAsset.mime = "video/mp4";
  const plan = buildMigrationPlan(videoIr);
  const hero = plan.documents[0].data.slices.find((s) => s.slice_type === "hero");
  expect(hero.primary.background_image).toBeUndefined();
  expect(plan.diagnostics).toContainEqual(
    expect.objectContaining({ kind: "non-image-in-image-field" }),
  );
});

it("applies flattening before emitting slices", () => {
  const deep = structuredClone(ir);
  deep.pages[0].sections = [
    {
      sliceType: "grid",
      variation: "default",
      confidence: 1,
      fields: {},
      children: [
        {
          sliceType: "grid",
          variation: "default",
          confidence: 1,
          fields: {},
          children: [
            {
              sliceType: "media_text",
              variation: "imageRight",
              confidence: 1,
              fields: { body: "<p>deep</p>" },
            },
          ],
        },
      ],
    },
  ];
  const plan = buildMigrationPlan(deep);
  const types = plan.documents[0].data.slices.map((s) => s.slice_type);
  expect(types).toEqual(["section_grid"]); // inner pure-leaf grid hoisted to a kept grid
});
```

Extend the `Diagnostic["kind"]` union in `src/blux/ir.ts` with `"empty-page" | "non-image-in-image-field"`.

- [ ] **Step 2: Run → FAIL**

- [ ] **Step 3: Implement** — in `plan.ts` add `diagnostics: Diagnostic[]` to `MigrationPlan` (import the type from `../ir.js`). In `migration-plan.ts`:

```ts
import { flattenSections } from "./flatten.js";
import { coerceHeadingHtml } from "./coerce-html.js";
import type { Diagnostic } from "../ir.js";

const IMAGE_FIELDS = new Set(["background_image", "media", "item_media"]);

export function buildMigrationPlan(ir: SiteIR): MigrationPlan {
  const diagnostics: Diagnostic[] = [];
  const customTypes = ir.collections.map(buildCustomType);
  const mimeById = new Map(ir.assets.map((a) => [a.id, a.mime]));

  const documents: PlanDocument[] = [];
  for (const page of ir.pages) {
    if (!page.sections.length && !page.title.trim()) {
      diagnostics.push({
        kind: "empty-page",
        where: page.uid,
        message: "page has no title and no sections; skipped",
      });
      continue;
    }
    const slices = flattenSections(page.sections).map(sectionToSlice);
    for (const slice of slices) {
      for (const rec of [slice.primary, ...slice.items]) {
        for (const [key, val] of Object.entries(rec)) {
          if (!IMAGE_FIELDS.has(key) || !val || typeof val !== "object" || !("__asset_id" in val))
            continue;
          const mime = mimeById.get((val as { __asset_id: string }).__asset_id) ?? "";
          if (!mime.startsWith("image/")) {
            diagnostics.push({
              kind: "non-image-in-image-field",
              where: `${page.uid}/${slice.slice_type}.${key}`,
              message: `${mime || "unknown mime"} asset dropped from image field`,
            });
            delete rec[key];
          }
        }
      }
    }
    documents.push({
      type: "page",
      uid: page.uid,
      data: { title: richText(coerceHeadingHtml(page.title || page.uid, ["h1"])), slices },
    });
  }
  // …collection documents + assets unchanged…
  return { customTypes, documents, assets, diagnostics };
}
```

In `src/cli/commands/blux.ts` extend the emit summary: total diagnostics = `ir.diagnostics.length + plan.diagnostics.length`, list both arrays.

- [ ] **Step 4: Run emit suites + CLI suite → PASS** (update any count expectations in `tests/cli/blux-command.test.ts` if the summary line changed).

- [ ] **Step 5: Commit** `git commit -am "feat(blux): plan-time flattening, empty-page skip, non-image drop + plan diagnostics"`

---

### Task 5: CDN reconstruct + ext-probe module

**Files:**

- Create: `src/blux/emit/probe.ts`
- Test: `tests/blux/emit/probe.test.ts` (injected fetch — no network)

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { probeAssetUrls } from "../../../src/blux/emit/probe.js";

const ok = { ok: true } as Response;
const miss = { ok: false } as Response;

describe("probeAssetUrls", () => {
  it("tries name-ext first on the image host and returns the hit", async () => {
    const tried: string[] = [];
    const fetchImpl = (async (url: string) => {
      tried.push(url);
      return url.endsWith("u1.jpg") && url.includes("d3syaxnfm3oj0e") ? ok : miss;
    }) as unknown as typeof fetch;
    const map = await probeAssetUrls(
      [{ id: "u1", name: "Photo.jpg", mime: "image/jpeg" }],
      "site-1",
      fetchImpl,
    );
    expect(map.get("u1")).toBe("https://d3syaxnfm3oj0e.cloudfront.net/site-1/u1.jpg");
    expect(tried[0]).toContain("/site-1/u1.jpg");
  });
  it("falls back through mime ext and common exts across both hosts, null when nothing hits", async () => {
    const fetchImpl = (async () => miss) as unknown as typeof fetch;
    const map = await probeAssetUrls([{ id: "u2", name: "x", mime: "" }], "site-1", fetchImpl);
    expect(map.get("u2")).toBeNull();
  });
});
```

- [ ] **Step 2: Run → FAIL**

- [ ] **Step 3: Implement** `src/blux/emit/probe.ts`:

```ts
/** Reconstruct-and-probe fallback for assets the rendered HTML never showed:
 *  the Blux CDN serves originals at <host>/<siteId>/<uuid>.<ext>. Proven on
 *  thePointe 2026-07-06: scrape found 4/320, probe resolved the remaining
 *  52/52 used assets. Network-touching by design — wired to `blux emit --probe`,
 *  never into the pure builders. */
const HOSTS = ["d3syaxnfm3oj0e.cloudfront.net", "dv4tl7yyk1zlp.cloudfront.net"];
const COMMON_EXTS = ["jpg", "png", "jpeg", "webp", "gif", "svg", "mp4", "pdf"];

export type ProbeTarget = { id: string; name: string; mime: string };

function extCandidates(t: ProbeTarget): string[] {
  const c: string[] = [];
  const nameExt = t.name.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();
  if (nameExt) c.push(nameExt);
  const mimeExt = t.mime.split("/")[1]?.replace("jpeg", "jpg");
  if (mimeExt && !c.includes(mimeExt)) c.push(mimeExt);
  for (const e of COMMON_EXTS) if (!c.includes(e)) c.push(e);
  return c;
}

export async function probeAssetUrls(
  targets: ProbeTarget[],
  siteId: string,
  fetchImpl: typeof fetch = fetch,
  concurrency = 8,
): Promise<Map<string, string | null>> {
  const results = new Map<string, string | null>();
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, targets.length) }, async () => {
      while (i < targets.length) {
        const t = targets[i++];
        results.set(t.id, await probeOne(t, siteId, fetchImpl));
      }
    }),
  );
  return results;
}

async function probeOne(
  t: ProbeTarget,
  siteId: string,
  fetchImpl: typeof fetch,
): Promise<string | null> {
  for (const ext of extCandidates(t)) {
    for (const host of HOSTS) {
      const url = `https://${host}/${siteId}/${t.id}.${ext}`;
      try {
        if ((await fetchImpl(url, { method: "HEAD" })).ok) return url;
      } catch {
        // network hiccup on one candidate — try the next
      }
    }
  }
  return null;
}
```

- [ ] **Step 4: Run → PASS**

- [ ] **Step 5: Commit** `git commit -am "feat(blux): CDN reconstruct + ext-probe module"`

---

### Task 6: wire `--probe` into `blux emit`

**Files:**

- Modify: `src/cli/commands/blux.ts`, `src/cli/bin.ts`
- Test: `tests/cli/blux-command.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
it("emit --probe resolves used assets via the injected prober", async () => {
  const dir = await makeExportDir();
  // strip the rendered HTML so scrape finds nothing
  await writeFile(join(dir, "index.html"), "<html><body>shell</body></html>");
  const out = join(dir, "probed-out");
  const fetchImpl = (async (url: string) =>
    ({
      ok: url.includes("img-1") || url.includes("img-2"),
    }) as Response) as unknown as typeof fetch;
  const result = await runBluxCommand("emit", dir, { out, probe: true, fetchImpl });
  expect(result.code).toBe(0);
  const plan = JSON.parse(await readFile(join(out, "migration-plan.json"), "utf-8"));
  expect(plan.assets.length).toBeGreaterThan(0);
  expect(result.output).toContain("probe resolved");
});
```

- [ ] **Step 2: Run → FAIL** (unknown option `probe`).

- [ ] **Step 3: Implement** — `BluxCommandOptions` gains `probe?: boolean; fetchImpl?: typeof fetch`. In the emit branch, after `assembleIR` and before `buildMigrationPlan`:

```ts
if (opts.probe) {
  const { probeAssetUrls } = await import("../../blux/emit/probe.js");
  const used = new Set<string>();
  const walk = (s: (typeof ir.pages)[number]["sections"][number]): void => {
    if (s.fields.media) used.add(s.fields.media);
    if (s.fields.backgroundMedia) used.add(s.fields.backgroundMedia);
    (s.children ?? []).forEach(walk);
  };
  ir.pages.forEach((p) => p.sections.forEach(walk));
  for (const c of ir.collections)
    for (const r of c.records) r.mediaRefs.forEach((m) => used.add(m));

  const targets = ir.assets.filter((a) => used.has(a.id) && !a.sourceUrl);
  const probed = await probeAssetUrls(targets, ir.meta.bluxSiteId, opts.fetchImpl ?? fetch);
  let hits = 0;
  for (const a of ir.assets) {
    const url = probed.get(a.id);
    if (url) {
      a.sourceUrl = url;
      hits++;
    }
  }
  // probe-resolved assets are no longer unresolved diagnostics
  ir.diagnostics = ir.diagnostics.filter(
    (d) => !(d.kind === "unresolved-asset" && probed.get(d.where)),
  );
  probeLine = `probe resolved ${hits}/${targets.length} used assets`;
}
```

(declare `let probeLine = ""` above and include it in the output lines when non-empty). Register `--probe` in `bin.ts` on the blux command: `.option("--probe", "Reconstruct + HEAD-probe CDN URLs for used assets the HTML scrape missed (network)")` and pass `probe: opts.probe` through.

- [ ] **Step 4: Run CLI suite → PASS**

- [ ] **Step 5: Commit** `git commit -am "feat(blux): emit --probe wires the CDN prober into the CLI"`

---

### Task 7: pure marker resolution module

**Files:**

- Create: `src/blux/emit/resolve-doc.ts`
- Test: `tests/blux/emit/resolve-doc.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { resolveDocData } from "../../../src/blux/emit/resolve-doc.js";

describe("resolveDocData", () => {
  it("converts richtext markers to nodes and asset markers to {id}, reporting misses", () => {
    const { data, missingAssets } = resolveDocData(
      {
        title: { __richtext_html: "<h1>Hi</h1>" },
        slices: [
          {
            slice_type: "hero",
            variation: "default",
            primary: { background_image: { __asset_id: "u1" }, media: { __asset_id: "nope" } },
            items: [],
          },
        ],
      },
      new Map([["u1", "prismic-asset-1"]]),
    );
    expect(data.title).toEqual([expect.objectContaining({ type: "heading1", text: "Hi" })]);
    const primary = (data.slices as any)[0].primary;
    expect(primary.background_image).toEqual({ id: "prismic-asset-1" });
    expect(primary.media).toBeUndefined();
    expect(missingAssets).toEqual(["nope"]);
  });
});
```

- [ ] **Step 2: Run → FAIL**

- [ ] **Step 3: Implement** `src/blux/emit/resolve-doc.ts`:

```ts
import { htmlAsRichText } from "@prismicio/migrate";

/** Resolve a PlanDocument's plain-JSON markers into Migration API values:
 *  `__richtext_html` → rich text nodes, `__asset_id` → `{ id }` using the
 *  uuid → Prismic-asset-id map (missing assets are dropped and reported).
 *  Pure — the network shell in run-migration.ts stays untestable-thin. */
export function resolveDocData(
  data: Record<string, unknown>,
  assetIdByUuid: Map<string, string>,
): { data: Record<string, unknown>; missingAssets: string[] } {
  const missing: string[] = [];
  const resolve = (v: unknown): unknown => {
    if (v && typeof v === "object") {
      if ("__richtext_html" in v) {
        return htmlAsRichText((v as { __richtext_html: string }).__richtext_html).result;
      }
      if ("__asset_id" in v) {
        const uuid = (v as { __asset_id: string }).__asset_id;
        const id = assetIdByUuid.get(uuid);
        if (!id) {
          missing.push(uuid);
          return undefined;
        }
        return { id };
      }
      if (Array.isArray(v)) return v.map(resolve);
      return Object.fromEntries(
        Object.entries(v)
          .map(([k, val]) => [k, resolve(val)])
          .filter(([, val]) => val !== undefined),
      );
    }
    return v;
  };
  return { data: resolve(data) as Record<string, unknown>, missingAssets: missing };
}
```

- [ ] **Step 4: Run → PASS**

- [ ] **Step 5: Commit** `git commit -am "feat(blux): pure marker-resolution module for the migration runner"`

---

### Task 8: runner v2 — raw APIs, upsert, no-dupe assets, full error details

**Files:**

- Rewrite: `src/blux/emit/run-migration.ts` (stays in vitest `coverage.exclude`)
- Modify: `src/cli/commands/blux.ts` (migrate branch uses the new return shape)

No unit test (live I/O; its pure half is Task 7 and the plan it consumes is tested). The acceptance test is Task 10's live re-run — which exercises the upsert path against the real repo.

- [ ] **Step 1: Rewrite** `src/blux/emit/run-migration.ts`:

```ts
import type { MigrationPlan, PlanCustomType } from "./plan.js";
import { resolveDocData } from "./resolve-doc.js";

/** LIVE runner on the raw Prismic APIs. Learned from the Pointe run
 *  (2026-07-06): the js client's migrate() creates docs hollow, PATCHes data
 *  later, swallows validation details[], re-uploads assets on retry, and cannot
 *  update existing docs. This runner: skips assets already in the library
 *  (by filename), POSTs docs and falls back to PUT when the uid exists
 *  (id looked up via the Document API), and surfaces full error bodies.
 *  Creds: PRISMIC_REPOSITORY_NAME + PRISMIC_WRITE_TOKEN (+ optional
 *  PRISMIC_ACCESS_TOKEN when the repo's Document API is private). */

const THROTTLE_MS = 1200; // migration API limit ~1 req/s
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function readCreds(): { repo: string; token: string } {
  const repo = process.env.PRISMIC_REPOSITORY_NAME;
  const token = process.env.PRISMIC_WRITE_TOKEN;
  if (!repo || !token) throw new Error("Set PRISMIC_REPOSITORY_NAME and PRISMIC_WRITE_TOKEN");
  return { repo, token };
}
const apiHeaders = (repo: string, token: string) => ({
  repository: repo,
  Authorization: `Bearer ${token}`,
});

async function expectOk(res: Response, what: string): Promise<Response> {
  if (res.ok) return res;
  throw new Error(`${what}: ${res.status} ${await res.text()}`);
}

export async function pushCustomTypes(types: PlanCustomType[]): Promise<string[]> {
  const { repo, token } = readCreds();
  const headers = { ...apiHeaders(repo, token), "Content-Type": "application/json" };
  const pushed: string[] = [];
  for (const t of types) {
    const body = JSON.stringify(t.json);
    let res = await fetch("https://customtypes.prismic.io/customtypes/insert", {
      method: "POST",
      headers,
      body,
    });
    if (res.status === 409 || res.status === 400) {
      res = await fetch("https://customtypes.prismic.io/customtypes/update", {
        method: "POST",
        headers,
        body,
      });
    }
    await expectOk(res, `custom type ${t.id}`);
    pushed.push(t.id);
  }
  return pushed;
}

async function listAssetIdsByFilename(repo: string, token: string): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  let cursor = "";
  for (;;) {
    const res = await expectOk(
      await fetch(`https://asset-api.prismic.io/assets?limit=500${cursor}`, {
        headers: apiHeaders(repo, token),
      }),
      "asset list",
    );
    const page = (await res.json()) as {
      items: { id: string; filename: string }[];
      cursor?: string;
    };
    for (const a of page.items) map.set(a.filename, a.id);
    if (!page.cursor || !page.items.length) return map;
    cursor = `&cursor=${encodeURIComponent(page.cursor)}`;
  }
}

async function lookupDocIds(repo: string): Promise<Map<string, string>> {
  const access = process.env.PRISMIC_ACCESS_TOKEN;
  const qs = access ? `?access_token=${access}` : "";
  const api = (await (await fetch(`https://${repo}.prismic.io/api/v2${qs}`)).json()) as {
    refs: { id: string; ref: string }[];
  };
  const master = api.refs.find((r) => r.id === "master")?.ref;
  const sep = qs ? "&" : "?";
  const search = (await (
    await fetch(
      `https://${repo}.prismic.io/api/v2/documents/search${qs}${sep}ref=${master}&pageSize=100`,
    )
  ).json()) as { results: { id: string; uid: string }[] };
  return new Map(search.results.map((d) => [d.uid, d.id]));
}

export type MigrationResult = {
  assetsUploaded: number;
  assetsReused: number;
  docsCreated: number;
  docsUpdated: number;
  missingAssets: string[];
};

export async function runMigration(
  plan: MigrationPlan,
  log: (line: string) => void = console.log,
): Promise<MigrationResult> {
  const { repo, token } = readCreds();
  const existing = await listAssetIdsByFilename(repo, token);
  const assetIdByUuid = new Map<string, string>();
  let assetsUploaded = 0;
  let assetsReused = 0;

  for (const a of plan.assets) {
    const filename = a.url.split("/").pop() ?? a.id;
    const known = existing.get(filename);
    if (known) {
      assetIdByUuid.set(a.id, known);
      assetsReused++;
      continue;
    }
    const blob = await (await expectOk(await fetch(a.url), `fetch asset ${filename}`)).blob();
    const form = new FormData();
    form.append("file", blob, filename);
    if (a.alt) form.append("alt", a.alt);
    const res = await expectOk(
      await fetch("https://asset-api.prismic.io/assets", {
        method: "POST",
        headers: apiHeaders(repo, token),
        body: form,
      }),
      `upload asset ${filename}`,
    );
    const created = (await res.json()) as { id: string };
    assetIdByUuid.set(a.id, created.id);
    assetsUploaded++;
    log(`asset ${assetsUploaded + assetsReused}/${plan.assets.length} ${filename}`);
    await sleep(THROTTLE_MS);
  }

  let docIds: Map<string, string> | null = null;
  let docsCreated = 0;
  let docsUpdated = 0;
  const missingAssets: string[] = [];

  for (const doc of plan.documents) {
    const { data, missingAssets: miss } = resolveDocData(doc.data, assetIdByUuid);
    missingAssets.push(...miss);
    const body = JSON.stringify({
      type: doc.type,
      uid: doc.uid,
      lang: "en-us",
      title: doc.uid,
      data,
    });
    const headers = { ...apiHeaders(repo, token), "Content-Type": "application/json" };
    const res = await fetch("https://migration.prismic.io/documents", {
      method: "POST",
      headers,
      body,
    });
    if (res.ok) {
      docsCreated++;
      log(`created ${doc.uid}`);
    } else {
      const text = await res.text();
      if (!/already exists/i.test(text))
        throw new Error(`create ${doc.uid}: ${res.status} ${text}`);
      docIds ??= await lookupDocIds(repo);
      const id = docIds.get(doc.uid);
      if (!id)
        throw new Error(
          `update ${doc.uid}: uid exists but not found via Document API (set PRISMIC_ACCESS_TOKEN?)`,
        );
      await expectOk(
        await fetch(`https://migration.prismic.io/documents/${id}`, {
          method: "PUT",
          headers,
          body,
        }),
        `update ${doc.uid}`,
      );
      docsUpdated++;
      log(`updated ${doc.uid}`);
    }
    await sleep(THROTTLE_MS);
  }
  return { assetsUploaded, assetsReused, docsCreated, docsUpdated, missingAssets };
}
```

- [ ] **Step 2: Update the migrate branch** in `src/cli/commands/blux.ts` to use `MigrationResult`:

```ts
const { pushCustomTypes, runMigration } = await import("../../blux/emit/run-migration.js");
const pushed = await pushCustomTypes(plan.customTypes);
const progress: string[] = [];
const r = await runMigration(plan, (line) => progress.push(line));
const missing = r.missingAssets.length
  ? `\nWARNING missing assets: ${r.missingAssets.join(", ")}`
  : "";
return {
  output:
    `custom types pushed: ${pushed.join(", ") || "none"}\n` +
    `assets: ${r.assetsUploaded} uploaded, ${r.assetsReused} reused | documents: ${r.docsCreated} created, ${r.docsUpdated} updated ` +
    `→ ${process.env.PRISMIC_REPOSITORY_NAME} (publish the migration release in the dashboard)` +
    missing,
  code: 0,
};
```

- [ ] **Step 3: Run the full CLI suite** (`pnpm exec vitest run tests/cli/blux-command.test.ts`) — the creds-gate test must still pass unchanged. Expected: PASS.

- [ ] **Step 4: Commit** `git commit -am "feat(blux): raw-API migration runner — upsert by uid, asset reuse, full error details"`

---

### Task 9: gate, changeset, PR, merge

- [ ] **Step 1:** `pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm test:dist && pnpm test:coverage` — all green (coverage floor: S78/B67/F76/L80).
- [ ] **Step 2:** Changeset `.changeset/blux-plan4-hardening.md`, `minor`:

```md
---
"@reddoorla/maintenance": minor
---

Blux pipeline hardening from the first live conversion: emit now coerces rich text to each slice's allowed block types, flattens deep section trees into sequential slices, skips empty pages, and drops non-image assets from image fields (all with plan diagnostics); `blux emit --probe` reconstructs + HEAD-probes CDN URLs for assets the HTML scrape missed; the migration runner is rewritten on the raw Prismic APIs — upserts documents by uid, reuses already-uploaded assets, and surfaces full validation details.
```

- [ ] **Step 3:** Commit plan doc + changeset, push `blux-plan4-hardening`, open PR titled `feat(blux): Plan 4 — emit/runner hardening from the Pointe live run`, wait for `build` check on the head SHA, review (8-angle), squash-merge.

---

### Task 10: acceptance — live re-run on thePointe

Operator/creds steps, from the worktree with `PRISMIC_REPOSITORY_NAME=the-pointe PRISMIC_WRITE_TOKEN=…`:

- [ ] **Step 1:** `node dist/cli/bin.js blux emit ~/Desktop/thePointe --out ~/Desktop/thePointe/blux-out-v2 --probe` — expect "probe resolved 52/52" (±video), diagnostics listing the empty page + any non-image drops.
- [ ] **Step 2:** `node dist/cli/bin.js blux migrate ~/Desktop/thePointe/blux-out-v2` — expect `assets: 0 uploaded, 56 reused | documents: 0 created, 1 updated` (the stub is skipped at emit now; the live doc repairs in place).
- [ ] **Step 3:** Verify via Document API after publishing the release: the-pointe doc has ≥40 prismic image refs, media_text slices present, no cloudfront leftovers.

---

### Task 11: reddoor-starter — register the slices in the page type

**Files (in `~/Documents/GitHub/reddoor-starter`):**

- Modify: `customtypes/page/index.json` — slice zone `choices` gains `hero`, `media_text`, `section_grid`, `collection_list` (each `{ "type": "SharedSlice" }`) alongside `rich_text`.

- [ ] **Step 1:** Branch, edit, verify `git diff` shows only the four added choices.
- [ ] **Step 2:** PR to reddoorla/reddoor-starter, gate green, squash-merge (Plan 1 built the slices but never registered them — every scaffolded site needs the registration).

---

## Self-review notes

- Spec coverage: findings 1–7 map to Tasks 2/2/3+4/4/5+6/8/8 respectively; starter registration = Task 11; acceptance = Task 10.
- Types: `MigrationPlan.diagnostics` (Task 4) is used by the CLI in Task 4 and serialized by the existing writeFile; `MigrationResult` (Task 8) consumed in Task 8's CLI step; `ProbeTarget` fields match `AssetRef` (id/name/mime).
- Known trade-offs: exploded grids lose their N-column visual grouping (fidelity-to-a-point; the gallery judges); videos remain dropped from image slots until slices grow a video story.
