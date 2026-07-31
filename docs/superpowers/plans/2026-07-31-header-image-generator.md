# Header-Image Generator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate a site's 2400×3200 report header image from a live screenshot of its homepage composited into the fixed Reddoor plate, replacing the manual Figma step.

**Architecture:** A new `src/reports/header-image/` module. `capture.ts` drives Playwright behind an injected interface; `compose.ts` is a pure sharp pipeline that pastes the screenshot into the plate's laptop screen and draws the domain text; `geometry.ts` holds the measured constants; a committed `assets/plate.png` supplies the fixed artwork. A CLI command generates/uploads on demand, and the report draft path regenerates so every send carries a current screenshot.

**Tech Stack:** TypeScript (ESM), sharp 0.35, @playwright/test 1.60, vitest, tsup, Airtable.

**Design spec:** `docs/superpowers/specs/2026-07-31-header-image-generator-design.md`

---

## Background the engineer needs

This repo publishes `@reddoorla/maintenance`. Every client report email opens with
a per-site "Header image" stored as an Airtable attachment on the `Websites`
table. Today those are made by hand in Figma. 34 of 44 rows have none, and
`preflight` hard-fails such a site with `header-image-missing` — "the send will
throw".

**The template is fixed.** Diffing two real headers (Sonder vs Data Dynamiq)
shows only **17.5%** of the canvas differs, in exactly two places: the laptop
screen and the domain text. Everything else — paper texture, red door logo,
"Your website maintenance is complete." headline, laptop chassis — is identical.
That is what makes a single bundled plate correct.

**Measured constants (already verified, do not re-derive):**

| Thing                  | Value                                                   |
| ---------------------- | ------------------------------------------------------- |
| Canvas                 | 2400×3200 (Figma frame 600×800 exported at 4×)          |
| Laptop screen rect     | `x=302 y=1913 w=1349 h=844` — aspect 1.5983, i.e. 16:10 |
| Domain text ink        | starts `x=283 y=2963`, cap-to-descender height 74px     |
| Domain text colour     | `#747474`                                               |
| Paper background       | `#fcfcfc`                                               |
| Figma source           | file `mQ3hy2d9JnOG9ljCzbZS8j`, frame `158:10`           |
| Figma domain-text node | `158:14`, design box `x=70 y=739 w=461 h=24`            |

**The screen rect is derived from the bezel, not from content.** An earlier
content-based measurement (diffing two real headers for pixels that vary) gave
`x=282 y=1856 w=1394 h=871` — and was **wrong**. It spanned the laptop's outer
panel, so it covered the bezel on three sides while falling ~29px short at the
bottom, leaving a visible strip of the plate's baked-in ERP screenshot below
every site's content.

The correct rect is the hole inside the bezel. The bezel is a perfectly flat
black frame (luminance exactly 0.0), which is content-independent and therefore
reliable: walking outward from the screen centre until an entire row or column
reads flat black gives `x=302 y=1913 w=1349 h=844`. Two independent checks agree
— the photo-to-flat-black transition at the bottom lands at y=2756, matching
`y + h - 1`; and masking the rect with a solid colour leaves the bezel cleanly
visible with no surviving screenshot on any edge.

Do not re-measure from content. If you must re-derive, find the bezel.

**Why the plate must be built rather than exported.** `download_assets` on the
Figma frame returns the laptop as a **pre-flattened 4096×2836 PNG with a
screenshot already baked in** — the designer composites the mockup elsewhere and
drops in a raster. There is no empty-laptop layer to export. Task 1 therefore
constructs the plate from the full-frame export by painting out the one variable
element that is _not_ covered by our own compositing: the domain text.

The screen itself needs no cleanup — the generated screenshot covers that rect
completely on every run.

---

## File structure

| File                                        | Responsibility                                                                           |
| ------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `scripts/build-header-plate.mjs`            | Create: one-time, offline. Turns the Figma export into the committed plate. Not shipped. |
| `src/reports/header-image/assets/plate.png` | Create: the 2400×3200 plate, committed binary.                                           |
| `src/reports/header-image/assets/index.ts`  | Create: walk-up loader for the plate (mirrors `maintenance-email/assets/index.ts`).      |
| `src/reports/header-image/geometry.ts`      | Create: measured constants. Pure data, no imports.                                       |
| `src/reports/header-image/compose.ts`       | Create: pure `(plate, screenshot, domain) → JPEG`.                                       |
| `src/reports/header-image/capture.ts`       | Create: Playwright capture behind an injected interface.                                 |
| `src/reports/header-image/index.ts`         | Create: orchestration + `generateHeaderImage`.                                           |
| `src/cli/commands/header-image.ts`          | Create: the CLI command.                                                                 |
| `src/cli/bin.ts`                            | Modify: register `header-image`.                                                         |
| `src/reports/draft.ts`                      | Modify: regenerate before rendering.                                                     |
| `tsup.config.ts`                            | Modify: copy the plate into `dist/`.                                                     |
| `tests/reports/header-image/*.test.ts`      | Create: unit + golden tests.                                                             |

---

## Task 1: Build the plate asset

**Files:**

- Create: `scripts/build-header-plate.mjs`
- Create: `src/reports/header-image/assets/plate.png` (generated output, committed)

This is a one-time offline preparation script. It is committed for
reproducibility but never runs in production.

The Figma full-frame export carries ERP's screenshot and the text
"ERPfunds.com". The screenshot region is irrelevant (we always paint over it).
The domain text must go. The paper has a subtle texture, so a flat fill would
show as a patch — instead copy a clean same-height strip of paper from the right
of the canvas over the text.

- [ ] **Step 1: Download the Figma frame export**

The MCP Figma tools produce short-lived URLs. Export frame `158:10` from file
`mQ3hy2d9JnOG9ljCzbZS8j` as PNG at scale 4 (yields 2400×3200) and save it to
`/tmp/header-export.png`.

- [ ] **Step 2: Write the plate builder**

```javascript
// scripts/build-header-plate.mjs
//
// One-time, offline. Turns the Figma full-frame export into the bundled plate.
//
// The export carries a site's screenshot and domain text baked in. The screen
// region needs no cleanup — compose.ts paints over it every run. The DOMAIN TEXT
// does: it is per-site, sits on textured paper, and a flat fill would read as a
// visible patch. So we copy a clean strip of paper from the right of the canvas
// (which is empty at that height) across the text.
//
// Usage: node scripts/build-header-plate.mjs /tmp/header-export.png
import sharp from "sharp";

const src = process.argv[2];
if (!src) throw new Error("usage: build-header-plate.mjs <figma-export.png>");
const OUT = "src/reports/header-image/assets/plate.png";

// Text ink measured at x=283..~1200, y=2963..3037. Cover generously.
const WIPE = { left: 260, top: 2930, width: 1000, height: 140 };
// Clean paper at the same height, right of any ink.
const CLEAN_LEFT = 1340;

const img = sharp(src);
const { width, height } = await img.metadata();
if (width !== 2400 || height !== 3200) {
  throw new Error(`expected a 2400x3200 export, got ${width}x${height}`);
}

const patch = await sharp(src)
  .extract({ left: CLEAN_LEFT, top: WIPE.top, width: WIPE.width, height: WIPE.height })
  .toBuffer();

await sharp(src)
  .composite([{ input: patch, left: WIPE.left, top: WIPE.top }])
  .png()
  .toFile(OUT);

console.log(`wrote ${OUT}`);
```

- [ ] **Step 3: Run it**

Run: `node scripts/build-header-plate.mjs /tmp/header-export.png`
Expected: `wrote src/reports/header-image/assets/plate.png`

- [ ] **Step 4: Verify the plate is clean**

```bash
node --input-type=module -e '
import sharp from "sharp";
const { data, info } = await sharp("src/reports/header-image/assets/plate.png")
  .removeAlpha().raw().toBuffer({ resolveWithObject: true });
const lum = (x, y) => {
  const i = (y * info.width + x) * info.channels;
  return 0.2126 * data[i] + 0.7152 * data[i+1] + 0.0722 * data[i+2];
};
let dark = 0;
for (let y = 2930; y < 3070; y++) for (let x = 260; x < 1260; x++) if (lum(x, y) < 150) dark++;
console.log("residual dark pixels in the domain-text band:", dark);
console.log(dark === 0 ? "CLEAN" : "TEXT STILL PRESENT");
'
```

Expected: `residual dark pixels in the domain-text band: 0` and `CLEAN`.

If it reports text still present, widen `WIPE` and re-run Step 3.

- [ ] **Step 5: Commit**

```bash
git add scripts/build-header-plate.mjs src/reports/header-image/assets/plate.png
git commit -m "feat(header-image): bundle the report header plate"
```

---

## Task 2: Geometry constants

**Files:**

- Create: `src/reports/header-image/geometry.ts`
- Test: `tests/reports/header-image/geometry.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/reports/header-image/geometry.test.ts
import { describe, it, expect } from "vitest";
import { CANVAS, SCREEN, DOMAIN } from "../../../src/reports/header-image/geometry.js";

describe("reports/header-image geometry", () => {
  it("matches the hand-made headers' canvas", () => {
    expect(CANVAS).toEqual({ width: 2400, height: 3200 });
  });

  it("has a 16:10 screen rect, matching the MacBook mockup", () => {
    expect(SCREEN).toEqual({ x: 302, y: 1913, w: 1349, h: 844 });
    expect(SCREEN.w / SCREEN.h).toBeCloseTo(1.6, 2);
  });

  it("keeps the screen inside the canvas", () => {
    expect(SCREEN.x + SCREEN.w).toBeLessThanOrEqual(CANVAS.width);
    expect(SCREEN.y + SCREEN.h).toBeLessThanOrEqual(CANVAS.height);
  });

  it("places the domain text on the shared 70-design-unit left margin", () => {
    expect(DOMAIN.x).toBe(282);
    expect(DOMAIN.baseline).toBe(3037);
    expect(DOMAIN.color).toBe("#747474");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm exec vitest run tests/reports/header-image/geometry.test.ts`
Expected: FAIL — `Failed to resolve import ... geometry.js`

- [ ] **Step 3: Write the constants**

```typescript
// src/reports/header-image/geometry.ts
//
// Measured off the real plate, not guessed.
//
// SCREEN is the hole INSIDE the laptop bezel. It is derived from the bezel —
// a perfectly flat black frame (luminance 0.0) — because that is
// content-independent. Deriving it from content instead (diffing two headers for
// pixels that vary) yields x=282 y=1856 w=1394 h=871, which is WRONG: that rect
// spans the laptop's outer panel, covering the bezel on three sides while
// falling ~29px short at the bottom, so the plate's baked-in screenshot shows
// as a strip under every site's content.
//
// Cross-checked: the photo-to-flat-black transition at the bottom of the plate
// lands at y=2756, exactly SCREEN.y + SCREEN.h - 1.
//
// Re-measure only if the Figma template changes — and if you do, find the bezel.

/** The plate's pixel dimensions — Figma frame 600x800 exported at 4x. */
export const CANVAS = { width: 2400, height: 3200 } as const;

/** The MacBook Pro screen the site screenshot is pasted into — the area inside
 *  the bezel, so the bezel stays visible around the content exactly as it does
 *  in the hand-made headers. Aspect 1.5983 (16:10 to within 0.1%). */
export const SCREEN = { x: 302, y: 1913, w: 1349, h: 844 } as const;

/** The per-site domain line, bottom left. `baseline` is the text baseline in
 *  canvas pixels; `size` is the em size. Both derived from the measured ink box
 *  (x=283, y=2963, cap-to-descender 74px). */
export const DOMAIN = {
  x: 282,
  baseline: 3037,
  size: 62,
  color: "#747474",
} as const;

/** Flat paper tone, used as the compositing background so a transparent or
 *  short source can never punch a hole in the plate. */
export const PAPER = "#fcfcfc" as const;
```

- [ ] **Step 4: Run the test**

Run: `pnpm exec vitest run tests/reports/header-image/geometry.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/reports/header-image/geometry.ts tests/reports/header-image/geometry.test.ts
git commit -m "feat(header-image): measured plate geometry"
```

---

## Task 3: The asset loader

**Files:**

- Create: `src/reports/header-image/assets/index.ts`
- Modify: `tsup.config.ts`
- Test: `tests/reports/header-image/assets.test.ts`

**Read `src/reports/maintenance-email/assets/index.ts` before starting.** It
documents a regression that shipped in 0.10.0–0.10.1: tsup inlines the loader
into `dist/cli/bin.js`, so `import.meta.url`-based sibling resolution looks in
`dist/cli/` and fails with ENOENT — and **dev tests still pass**, because vitest
evaluates the source file where `import.meta.url` is already correct. Copy that
file's walk-up approach exactly; do not invent a new one.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/reports/header-image/assets.test.ts
import { describe, it, expect } from "vitest";
import { loadPlate } from "../../../src/reports/header-image/assets/index.js";
import sharp from "sharp";

describe("reports/header-image assets", () => {
  it("loads a 2400x3200 plate", async () => {
    const bytes = await loadPlate();
    expect(bytes.byteLength).toBeGreaterThan(1000);
    const meta = await sharp(Buffer.from(bytes)).metadata();
    expect(meta.width).toBe(2400);
    expect(meta.height).toBe(3200);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm exec vitest run tests/reports/header-image/assets.test.ts`
Expected: FAIL — cannot resolve `assets/index.js`.

- [ ] **Step 3: Write the loader**

```typescript
// src/reports/header-image/assets/index.ts
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PLATE = "plate.png";

// Walk up from this module's URL looking for the assets dir in either the dev
// layout (src/reports/header-image/assets/) or the published layout
// (dist/reports/header-image/assets/). REQUIRED because tsup inlines this module
// into dist/cli/bin.js — so import.meta.url-based sibling resolution looks in
// dist/cli/ and fails with ENOENT. This exact bug shipped in 0.10.0-0.10.1 for
// the maintenance-email assets; tests passed in dev because vitest evaluates the
// source file, where import.meta.url is already correct. Only `pnpm test:dist`
// catches a regression here.
let cachedAssetsDir: string | null = null;
function resolveAssetsDir(): string {
  if (cachedAssetsDir) return cachedAssetsDir;
  let dir = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    for (const layout of ["src", "dist"]) {
      const candidate = join(dir, layout, "reports", "header-image", "assets", PLATE);
      if (existsSync(candidate)) {
        cachedAssetsDir = dirname(candidate);
        return cachedAssetsDir;
      }
    }
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error(
        `loadPlate: could not locate the header-image assets dir by walking up from ${fileURLToPath(import.meta.url)}. Checked both src/ and dist/ layouts.`,
      );
    }
    dir = parent;
  }
}

/** Read the bundled 2400x3200 plate. */
export async function loadPlate(): Promise<Uint8Array> {
  return new Uint8Array(await readFile(join(resolveAssetsDir(), PLATE)));
}
```

- [ ] **Step 4: Run the test**

Run: `pnpm exec vitest run tests/reports/header-image/assets.test.ts`
Expected: PASS.

- [ ] **Step 5: Teach tsup to copy the plate**

In `tsup.config.ts`, the `onSuccess` hook copies bundled assets **by explicit
filename**. Add the plate. `package.json#files` is `["dist", "README.md"]`, so a
missed copy ships a package that throws on first use.

Change the `onSuccess` body to:

```typescript
  onSuccess: async () => {
    const { copyFile, mkdir } = await import("node:fs/promises");
    const dest = "dist/reports/maintenance-email/assets";
    await mkdir(dest, { recursive: true });
    await copyFile("src/reports/maintenance-email/assets/check.png", `${dest}/check.png`);
    await copyFile(
      "src/reports/maintenance-email/assets/blurredTests.jpg",
      `${dest}/blurredTests.jpg`,
    );
    // Header-image plate — same explicit-copy contract as above; the runtime
    // loader reads it from dist/reports/header-image/assets/.
    const headerDest = "dist/reports/header-image/assets";
    await mkdir(headerDest, { recursive: true });
    await copyFile("src/reports/header-image/assets/plate.png", `${headerDest}/plate.png`);
  },
```

- [ ] **Step 6: Verify it reaches dist**

```bash
pnpm build && ls -la dist/reports/header-image/assets/plate.png
```

Expected: the file exists.

- [ ] **Step 7: Commit**

```bash
git add src/reports/header-image/assets/index.ts tests/reports/header-image/assets.test.ts tsup.config.ts
git commit -m "feat(header-image): bundled plate loader + dist copy"
```

---

## Task 4: Compose

**Files:**

- Create: `src/reports/header-image/compose.ts`
- Test: `tests/reports/header-image/compose.test.ts`

This is where fidelity lives. It is pure — no browser, no network — so it is
fully testable.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/reports/header-image/compose.test.ts
import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { composeHeaderImage } from "../../../src/reports/header-image/compose.js";
import { loadPlate } from "../../../src/reports/header-image/assets/index.js";
import { SCREEN, CANVAS } from "../../../src/reports/header-image/geometry.js";

/** A solid-colour stand-in for a homepage screenshot. */
async function fakeShot(color: string, w = 1600, h = 1000): Promise<Uint8Array> {
  const png = await sharp({
    create: { width: w, height: h, channels: 3, background: color },
  })
    .png()
    .toBuffer();
  return new Uint8Array(png);
}

/** Read one pixel as #rrggbb. */
async function pixel(bytes: Uint8Array, x: number, y: number): Promise<string> {
  const { data, info } = await sharp(Buffer.from(bytes))
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const i = (y * info.width + x) * info.channels;
  return (
    "#" + [data[i], data[i + 1], data[i + 2]].map((v) => v.toString(16).padStart(2, "0")).join("")
  );
}

describe("reports/header-image compose", () => {
  it("returns a JPEG at the plate's dimensions", async () => {
    const out = await composeHeaderImage({
      plate: await loadPlate(),
      screenshot: await fakeShot("#ff0000"),
      domain: "acme.com",
    });
    const meta = await sharp(Buffer.from(out)).metadata();
    expect(meta.format).toBe("jpeg");
    expect(meta.width).toBe(CANVAS.width);
    expect(meta.height).toBe(CANVAS.height);
  });

  it("paints the screenshot into the screen rect", async () => {
    const out = await composeHeaderImage({
      plate: await loadPlate(),
      screenshot: await fakeShot("#ff0000"),
      domain: "acme.com",
    });
    const mid = await pixel(out, SCREEN.x + SCREEN.w / 2, SCREEN.y + SCREEN.h / 2);
    expect(mid).toBe("#ff0000");
  });

  it("leaves the plate outside the screen rect untouched", async () => {
    const plate = await loadPlate();
    const out = await composeHeaderImage({
      plate,
      screenshot: await fakeShot("#ff0000"),
      domain: "acme.com",
    });
    // 40px left of the screen is laptop chassis / paper — never the screenshot.
    const before = await pixel(plate, SCREEN.x - 40, SCREEN.y + 100);
    const after = await pixel(out, SCREEN.x - 40, SCREEN.y + 100);
    expect(after).toBe(before);
  });

  it("crops a tall screenshot from the top rather than distorting it", async () => {
    // A 1600x4000 shot: cover-from-top keeps the header band, drops the fold.
    const tall = await sharp({
      create: { width: 1600, height: 4000, channels: 3, background: "#0000ff" },
    })
      .composite([
        {
          input: await sharp({
            create: { width: 1600, height: 200, channels: 3, background: "#00ff00" },
          })
            .png()
            .toBuffer(),
          left: 0,
          top: 0,
        },
      ])
      .png()
      .toBuffer();
    const out = await composeHeaderImage({
      plate: await loadPlate(),
      screenshot: new Uint8Array(tall),
      domain: "acme.com",
    });
    // The green top band must survive at the top of the screen rect.
    expect(await pixel(out, SCREEN.x + SCREEN.w / 2, SCREEN.y + 10)).toBe("#00ff00");
  });

  it("draws the domain text", async () => {
    const plain = await composeHeaderImage({
      plate: await loadPlate(),
      screenshot: await fakeShot("#ff0000"),
      domain: "",
    });
    const withText = await composeHeaderImage({
      plate: await loadPlate(),
      screenshot: await fakeShot("#ff0000"),
      domain: "averylongdomainname.com",
    });
    expect(Buffer.from(withText).equals(Buffer.from(plain))).toBe(false);
  });

  it("escapes XML metacharacters in the domain", async () => {
    // The domain is interpolated into an SVG; a raw & would produce invalid XML
    // and sharp would throw.
    await expect(
      composeHeaderImage({
        plate: await loadPlate(),
        screenshot: await fakeShot("#ff0000"),
        domain: 'a&b<c>"d".com',
      }),
    ).resolves.toBeInstanceOf(Uint8Array);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm exec vitest run tests/reports/header-image/compose.test.ts`
Expected: FAIL — cannot resolve `compose.js`.

- [ ] **Step 3: Implement compose**

```typescript
// src/reports/header-image/compose.ts
import sharp from "sharp";
import { CANVAS, SCREEN, DOMAIN, PAPER } from "./geometry.js";

export type ComposeInput = {
  /** The bundled 2400x3200 plate. */
  plate: Uint8Array;
  /** A homepage screenshot, any size. Cropped to fill the screen rect. */
  screenshot: Uint8Array;
  /** The site's public domain, drawn bottom-left (e.g. "gallerysonder.com"). */
  domain: string;
};

/** JPEG quality. The hand-made headers are ~2.4MB; 88 lands near 0.7MB with no
 *  visible difference at the 600px the email actually renders. */
const JPEG_QUALITY = 88;

/** Escape the five XML metacharacters. The domain is interpolated into an SVG,
 *  and a bare `&` yields invalid XML that sharp rejects outright. */
function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** The domain line as a transparent SVG overlay the size of the full canvas, so
 *  it can be composited at 0,0 and positioned by its own coordinates. */
function domainSvg(domain: string): Buffer {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS.width}" height="${CANVAS.height}">
       <text x="${DOMAIN.x}" y="${DOMAIN.baseline}"
             font-family="Helvetica Neue, Helvetica, Arial, sans-serif"
             font-size="${DOMAIN.size}" font-weight="300"
             fill="${DOMAIN.color}">${escapeXml(domain)}</text>
     </svg>`,
    "utf-8",
  );
}

/**
 * Composite one site's header image: paste its homepage screenshot into the
 * plate's laptop screen and draw its domain underneath.
 *
 * PURE — no browser, no network, no filesystem. Fidelity lives here, so it must
 * be verifiable in a unit test.
 *
 * The screenshot is cropped to FILL the 16:10 screen from the top: a taller
 * homepage loses its fold rather than being squashed, which would be obvious
 * and wrong. `flatten` guards against a transparent source punching a hole in
 * the plate.
 */
export async function composeHeaderImage(input: ComposeInput): Promise<Uint8Array> {
  const screen = await sharp(Buffer.from(input.screenshot))
    .resize(SCREEN.w, SCREEN.h, { fit: "cover", position: "top" })
    .flatten({ background: PAPER })
    .toBuffer();

  const layers: sharp.OverlayOptions[] = [{ input: screen, left: SCREEN.x, top: SCREEN.y }];
  if (input.domain.trim().length > 0) {
    layers.push({ input: domainSvg(input.domain), left: 0, top: 0 });
  }

  const out = await sharp(Buffer.from(input.plate))
    .composite(layers)
    .jpeg({ quality: JPEG_QUALITY })
    .toBuffer();
  return new Uint8Array(out);
}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm exec vitest run tests/reports/header-image/compose.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/reports/header-image/compose.ts tests/reports/header-image/compose.test.ts
git commit -m "feat(header-image): pure compose pipeline"
```

---

## Task 5: Match the domain typography to the template

**Files:**

- Modify: `src/reports/header-image/geometry.ts`
- Create: `docs/superpowers/plans/header-image-domain-font.md` (findings note)

Task 4 ships a system-font approximation. The real template uses a specific
face, and CI runners carry almost no fonts — so this needs pinning before the
output can be called faithful.

- [ ] **Step 1: Read the true text style from Figma**

Load the `figma-design-to-code` guidance (the `/figma-design-to-code` skill if
present, otherwise the `skill://figma/figma-design-to-code/SKILL.md` MCP
resource — `get_design_context` requires it), then call `get_design_context` for
file `mQ3hy2d9JnOG9ljCzbZS8j`, node `158:14`.

Record: font family, weight, and font-size in design units. Multiply the size by
4 for canvas pixels.

- [ ] **Step 2: Compare against the reference**

```bash
node --input-type=module -e '
import sharp from "sharp";
// Sonder header, domain-text band, blown up 3x for visual comparison.
await sharp("/tmp/hdr-Sonder.jpg")
  .extract({ left: 270, top: 2930, width: 900, height: 140 })
  .resize(2700)
  .toFile("/tmp/domain-reference.png");
console.log("wrote /tmp/domain-reference.png");
'
```

Render the same string through `composeHeaderImage` and crop the identical box.
Compare glyph shapes, weight and width.

- [ ] **Step 3: Pin the family**

If the Figma face is a licensed brand font, add it as an `@fontsource` dependency
if one exists, or commit the `.otf`/`.woff2` beside the plate and register it
with `sharp` (sharp reads system-installed fonts via fontconfig; on CI you must
set `FONTCONFIG_PATH` or install the font). Update `DOMAIN.size` and the
`font-family` in `domainSvg` to the measured values.

If it is a common grotesque already approximated well by the current stack, keep
the fallback list and just correct `DOMAIN.size`.

- [ ] **Step 4: Record the decision**

Write `docs/superpowers/plans/header-image-domain-font.md` with the Figma-reported
family/weight/size, what was chosen, and why. A future engineer must not have to
re-derive this.

- [ ] **Step 5: Re-run the compose tests**

Run: `pnpm exec vitest run tests/reports/header-image/compose.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 6: Commit**

```bash
git add src/reports/header-image/geometry.ts src/reports/header-image/compose.ts docs/superpowers/plans/header-image-domain-font.md
git commit -m "feat(header-image): pin the domain typography to the template"
```

---

## Task 6: Capture

**Files:**

- Create: `src/reports/header-image/capture.ts`
- Test: `tests/reports/header-image/capture.test.ts`

Follow the injected-IO pattern in `src/audits/form-e2e.ts`: the real
implementation lazily imports `@playwright/test`, and tests pass a fake. Lazy
import matters — it keeps the static graph free of central-only deps so
`test:dist` stays green.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/reports/header-image/capture.test.ts
import { describe, it, expect } from "vitest";
import { captureHomepage, type Shooter } from "../../../src/reports/header-image/capture.js";

function shooter(over: Partial<Shooter> = {}): Shooter {
  return {
    shoot: async () => new Uint8Array([1, 2, 3]),
    ...over,
  };
}

describe("reports/header-image capture", () => {
  it("shoots the site's homepage at a 16:10 retina viewport", async () => {
    let seen: Parameters<Shooter["shoot"]>[0] | undefined;
    const bytes = await captureHomepage("https://acme.com/", {
      shooter: shooter({
        shoot: async (opts) => {
          seen = opts;
          return new Uint8Array([9]);
        },
      }),
    });
    expect(bytes).toEqual(new Uint8Array([9]));
    expect(seen?.url).toBe("https://acme.com/");
    expect(seen?.width).toBe(1600);
    expect(seen?.height).toBe(1000);
    expect(seen!.width / seen!.height).toBeCloseTo(1.6, 5);
    expect(seen?.deviceScaleFactor).toBe(2);
    expect(seen?.settleMs).toBe(2500);
  });

  it("honours an explicit settle delay for animation-heavy sites", async () => {
    let seen: Parameters<Shooter["shoot"]>[0] | undefined;
    await captureHomepage("https://acme.com/", {
      settleMs: 9000,
      shooter: shooter({
        shoot: async (opts) => {
          seen = opts;
          return new Uint8Array([9]);
        },
      }),
    });
    expect(seen?.settleMs).toBe(9000);
  });

  it("propagates a capture failure rather than returning empty bytes", async () => {
    await expect(
      captureHomepage("https://acme.com/", {
        shooter: shooter({
          shoot: async () => {
            throw new Error("net::ERR_CONNECTION_REFUSED");
          },
        }),
      }),
    ).rejects.toThrow(/ERR_CONNECTION_REFUSED/);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm exec vitest run tests/reports/header-image/capture.test.ts`
Expected: FAIL — cannot resolve `capture.js`.

- [ ] **Step 3: Implement capture**

```typescript
// src/reports/header-image/capture.ts

/** Viewport matching the plate's MacBook screen aspect (16:10), so the crop in
 *  compose.ts is a no-op for a well-behaved homepage. */
const VIEWPORT = { width: 1600, height: 1000 } as const;
/** 2x so the 1349px-wide screen rect is fed real pixels, not upscaled ones. */
const DEVICE_SCALE_FACTOR = 2;
/** Entrance animations and webfonts settle before the shutter. Measured against
 *  live fleet sites; overridable per site because consent gates and long
 *  animations vary. */
const DEFAULT_SETTLE_MS = 2500;
const NAV_TIMEOUT_MS = 60_000;

export type ShootOptions = {
  url: string;
  width: number;
  height: number;
  deviceScaleFactor: number;
  settleMs: number;
};

/** Injected browser IO. The real impl drives Playwright; tests pass a fake. */
export type Shooter = {
  shoot: (opts: ShootOptions) => Promise<Uint8Array>;
};

export type CaptureOptions = {
  shooter?: Shooter;
  settleMs?: number;
};

/**
 * Screenshot a site's homepage for the header image.
 *
 * Viewport-only, never `fullPage`: the plate shows a laptop screen, not a
 * scroll. Failures propagate — a caller must be able to keep the site's existing
 * header rather than overwrite it with a broken shot.
 */
export async function captureHomepage(
  url: string,
  options: CaptureOptions = {},
): Promise<Uint8Array> {
  const shooter = options.shooter ?? (await defaultShooter());
  return shooter.shoot({
    url,
    width: VIEWPORT.width,
    height: VIEWPORT.height,
    deviceScaleFactor: DEVICE_SCALE_FACTOR,
    settleMs: options.settleMs ?? DEFAULT_SETTLE_MS,
  });
}

/** Real Playwright shooter. Lazily imported so unit tests never load it and the
 *  static import graph stays central-dep-free for `test:dist`. */
export async function defaultShooter(): Promise<Shooter> {
  const { chromium } = await import("@playwright/test");
  return {
    async shoot(opts) {
      const browser = await chromium.launch();
      try {
        const page = await browser.newPage({
          viewport: { width: opts.width, height: opts.height },
          deviceScaleFactor: opts.deviceScaleFactor,
        });
        await page.goto(opts.url, { waitUntil: "networkidle", timeout: NAV_TIMEOUT_MS });
        await page.evaluate("document.fonts && document.fonts.ready");
        await page.waitForTimeout(opts.settleMs);
        const buf = await page.screenshot({ type: "png" });
        return new Uint8Array(buf);
      } finally {
        await browser.close();
      }
    },
  };
}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm exec vitest run tests/reports/header-image/capture.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/reports/header-image/capture.ts tests/reports/header-image/capture.test.ts
git commit -m "feat(header-image): homepage capture behind injected browser IO"
```

---

## Task 7: Orchestration

**Files:**

- Create: `src/reports/header-image/index.ts`
- Test: `tests/reports/header-image/index.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/reports/header-image/index.test.ts
import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { generateHeaderImage } from "../../../src/reports/header-image/index.js";
import type { Shooter } from "../../../src/reports/header-image/capture.js";

async function shot(color = "#123456"): Promise<Uint8Array> {
  const png = await sharp({
    create: { width: 1600, height: 1000, channels: 3, background: color },
  })
    .png()
    .toBuffer();
  return new Uint8Array(png);
}

const shooter: Shooter = { shoot: async () => shot() };

describe("reports/header-image generateHeaderImage", () => {
  it("produces a 2400x3200 JPEG for a site", async () => {
    const out = await generateHeaderImage({ url: "https://acme.com/", shooter });
    const meta = await sharp(Buffer.from(out.bytes)).metadata();
    expect(meta.format).toBe("jpeg");
    expect(meta.width).toBe(2400);
    expect(meta.height).toBe(3200);
  });

  it("derives the printed domain from the URL, without scheme, www or slash", async () => {
    const out = await generateHeaderImage({ url: "https://www.acme.com/", shooter });
    expect(out.domain).toBe("acme.com");
  });

  it("keeps a non-www host intact", async () => {
    const out = await generateHeaderImage({ url: "https://1836dig.com/", shooter });
    expect(out.domain).toBe("1836dig.com");
  });

  it("names the file after the site slug", async () => {
    const out = await generateHeaderImage({ url: "https://acme.com/", slug: "acme", shooter });
    expect(out.filename).toBe("acmeHeader.jpg");
  });

  it("rejects a blank capture rather than overwriting a good header", async () => {
    const blank: Shooter = {
      shoot: async () =>
        new Uint8Array(
          await sharp({
            create: { width: 1600, height: 1000, channels: 3, background: "#ffffff" },
          })
            .png()
            .toBuffer(),
        ),
    };
    await expect(generateHeaderImage({ url: "https://acme.com/", shooter: blank })).rejects.toThrow(
      /blank/i,
    );
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm exec vitest run tests/reports/header-image/index.test.ts`
Expected: FAIL — cannot resolve `index.js`.

- [ ] **Step 3: Implement orchestration**

```typescript
// src/reports/header-image/index.ts
import sharp from "sharp";
import { captureHomepage, type Shooter } from "./capture.js";
import { composeHeaderImage } from "./compose.js";
import { loadPlate } from "./assets/index.js";

export type GenerateInput = {
  /** The site's production URL. */
  url: string;
  /** Airtable site slug; drives the attachment filename. */
  slug?: string;
  /** Injected browser IO (tests). */
  shooter?: Shooter;
  /** Per-site settle override for animation-heavy or consent-gated homepages. */
  settleMs?: number;
};

export type GeneratedHeaderImage = {
  bytes: Uint8Array;
  /** The domain as printed on the plate. */
  domain: string;
  filename: string;
  contentType: "image/jpeg";
};

/** Strip scheme, leading www and any path — the plate prints a bare domain. */
export function domainFromUrl(url: string): string {
  return new URL(url).hostname.replace(/^www\./, "");
}

/**
 * A capture is "blank" when almost every pixel is one colour — a consent gate,
 * a failed render, or a shot fired mid-fade. The operator reviews the rendered
 * email before sending, so this is a backstop rather than the only gate; its job
 * is to stop an obviously broken shot from replacing a good stored header.
 */
async function assertNotBlank(shot: Uint8Array): Promise<void> {
  const { dominant } = await sharp(Buffer.from(shot)).stats();
  const { data, info } = await sharp(Buffer.from(shot))
    .resize(64, 40, { fit: "fill" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let near = 0;
  const total = info.width * info.height;
  for (let i = 0; i < data.length; i += info.channels) {
    if (
      Math.abs(data[i] - dominant.r) < 8 &&
      Math.abs(data[i + 1] - dominant.g) < 8 &&
      Math.abs(data[i + 2] - dominant.b) < 8
    ) {
      near++;
    }
  }
  if (near / total > 0.95) {
    throw new Error(
      "header-image: capture looks blank (>95% one colour) — keeping the existing header",
    );
  }
}

/** Capture a site's homepage and composite its header image. */
export async function generateHeaderImage(input: GenerateInput): Promise<GeneratedHeaderImage> {
  const screenshot = await captureHomepage(input.url, {
    shooter: input.shooter,
    settleMs: input.settleMs,
  });
  await assertNotBlank(screenshot);

  const domain = domainFromUrl(input.url);
  const bytes = await composeHeaderImage({
    plate: await loadPlate(),
    screenshot,
    domain,
  });
  const base = input.slug ?? domain.split(".")[0];
  return { bytes, domain, filename: `${base}Header.jpg`, contentType: "image/jpeg" };
}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm exec vitest run tests/reports/header-image/index.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Export it from the package root**

`src/reports/header-image/index.ts` is not a tsup entry, so it only exists in
`dist/` as a hashed chunk with no stable path. Task 8's verifier imports it from
the package root, so re-export it there.

Add to `src/index.ts`:

```typescript
export { generateHeaderImage, domainFromUrl } from "./reports/header-image/index.js";
export type { GenerateInput, GeneratedHeaderImage } from "./reports/header-image/index.js";
```

Verify it resolves from the build:

```bash
pnpm build && node -e "import('./dist/index.js').then(m => console.log(typeof m.generateHeaderImage))"
```

Expected: `function`

- [ ] **Step 6: Commit**

```bash
git add src/reports/header-image/index.ts tests/reports/header-image/index.test.ts src/index.ts
git commit -m "feat(header-image): generateHeaderImage orchestration"
```

---

## Task 8: Fidelity acceptance test

**Files:**

- Create: `scripts/verify-header-fidelity.mjs`

The objective proof that the plate and geometry are right: regenerate a real
site's header and diff it against the hand-made original. Everything outside the
screen rect and the domain text must be identical.

This is a script rather than a unit test because it needs a live browser and the
network.

- [ ] **Step 1: Write the verifier**

```javascript
// scripts/verify-header-fidelity.mjs
//
// Regenerate a site's header from its live homepage and diff against the
// hand-made original. Everything OUTSIDE the laptop screen and the domain text
// must match — that is what proves the plate and geometry are faithful.
//
// Usage: node scripts/verify-header-fidelity.mjs <original.jpg> <url>
import sharp from "sharp";
import { generateHeaderImage } from "../dist/index.js";

const [original, url] = process.argv.slice(2);
if (!original || !url) {
  throw new Error("usage: verify-header-fidelity.mjs <original.jpg> <url>");
}

const SCREEN = { x: 302, y: 1913, w: 1349, h: 844 };
const DOMAIN_BAND = { x0: 250, x1: 1300, y0: 2920, y1: 3080 };

const gen = await generateHeaderImage({ url });

const raw = async (b) =>
  sharp(Buffer.from(b)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const a = await raw(await sharp(original).toBuffer());
const c = await raw(gen.bytes);

const inScreen = (x, y) =>
  x >= SCREEN.x && x < SCREEN.x + SCREEN.w && y >= SCREEN.y && y < SCREEN.y + SCREEN.h;
const inDomain = (x, y) =>
  x >= DOMAIN_BAND.x0 && x <= DOMAIN_BAND.x1 && y >= DOMAIN_BAND.y0 && y <= DOMAIN_BAND.y1;

let compared = 0;
let differing = 0;
let worst = 0;
for (let y = 0; y < a.info.height; y++) {
  for (let x = 0; x < a.info.width; x++) {
    if (inScreen(x, y) || inDomain(x, y)) continue;
    const i = (y * a.info.width + x) * a.info.channels;
    const d =
      Math.abs(a.data[i] - c.data[i]) +
      Math.abs(a.data[i + 1] - c.data[i + 1]) +
      Math.abs(a.data[i + 2] - c.data[i + 2]);
    compared++;
    if (d > worst) worst = d;
    // JPEG round-tripping shifts channels slightly; >24 total is a real difference.
    if (d > 24) differing++;
  }
}
const pct = (100 * differing) / compared;
console.log(`compared ${compared} px outside screen + domain`);
console.log(`differing: ${differing} (${pct.toFixed(3)}%)  worst channel-sum delta: ${worst}`);
console.log(pct < 0.5 ? "PASS — plate is faithful" : "FAIL — plate or geometry is off");
process.exit(pct < 0.5 ? 0 : 1);
```

- [ ] **Step 2: Fetch a reference header**

Download Sonder's current `Header image` attachment from the Airtable `Websites`
row to `/tmp/hdr-Sonder.jpg`.

- [ ] **Step 3: Run the verifier**

```bash
pnpm build && node scripts/verify-header-fidelity.mjs /tmp/hdr-Sonder.jpg https://gallerysonder.com/
```

Expected: `PASS — plate is faithful`, differing well under 0.5%.

If it fails, the plate wipe (Task 1) or the geometry (Task 2) is wrong — do not
proceed until this passes.

- [ ] **Step 4: Commit**

```bash
git add scripts/verify-header-fidelity.mjs
git commit -m "test(header-image): plate fidelity verifier"
```

---

## Task 9: CLI command

**Files:**

- Create: `src/cli/commands/header-image.ts`
- Modify: `src/cli/bin.ts`
- Test: `tests/cli/header-image-command.test.ts`

Read `src/cli/commands/launch.ts` for the command shape, and
`src/reports/airtable/attachments.ts` for `uploadAttachment`.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/cli/header-image-command.test.ts
import { describe, it, expect } from "vitest";
import { resolveTargets } from "../../src/cli/commands/header-image.js";
import type { WebsiteRow } from "../../src/reports/airtable/websites.js";

function row(over: Partial<WebsiteRow>): WebsiteRow {
  return {
    id: "rec1",
    name: "Acme",
    url: "https://acme.com/",
    status: "maintenance",
    headerImage: null,
    ...over,
  } as WebsiteRow;
}

describe("cli/header-image resolveTargets", () => {
  it("selects one site by slug", () => {
    const rows = [row({ name: "Acme" }), row({ id: "rec2", name: "Other" })];
    expect(resolveTargets(rows, { site: "acme" }).map((r) => r.name)).toEqual(["Acme"]);
  });

  it("with --all, selects only live sites missing a header image", () => {
    const rows = [
      row({
        id: "a",
        name: "HasOne",
        headerImage: { url: "u", filename: "f", type: "image/jpeg" },
      }),
      row({ id: "b", name: "NeedsOne" }),
      row({ id: "c", name: "Archived", status: "deprecated" }),
      row({ id: "d", name: "NoUrl", url: "" }),
    ];
    expect(resolveTargets(rows, { all: true }).map((r) => r.name)).toEqual(["NeedsOne"]);
  });

  it("with --all --force, includes sites that already have one", () => {
    const rows = [
      row({
        id: "a",
        name: "HasOne",
        headerImage: { url: "u", filename: "f", type: "image/jpeg" },
      }),
      row({ id: "b", name: "NeedsOne" }),
    ];
    expect(resolveTargets(rows, { all: true, force: true }).map((r) => r.name)).toEqual([
      "HasOne",
      "NeedsOne",
    ]);
  });

  it("returns nothing for an unknown slug", () => {
    expect(resolveTargets([row({ name: "Acme" })], { site: "nope" })).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm exec vitest run tests/cli/header-image-command.test.ts`
Expected: FAIL — cannot resolve `header-image.js`.

- [ ] **Step 3: Implement the command**

```typescript
// src/cli/commands/header-image.ts
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { openBase, readAirtableConfig } from "../../reports/airtable/client.js";
import { listWebsites, siteSlug, ACTIVE_STATUSES } from "../../reports/airtable/websites.js";
import type { WebsiteRow } from "../../reports/airtable/websites.js";
import { uploadAttachment } from "../../reports/airtable/attachments.js";
import { generateHeaderImage } from "../../reports/header-image/index.js";

export type HeaderImageOptions = {
  all?: boolean;
  force?: boolean;
  writeAirtable?: boolean;
  outDir?: string;
  settleMs?: string;
};

/** Which rows this invocation should act on. Pure, so it is unit-tested. */
export function resolveTargets(
  rows: readonly WebsiteRow[],
  opts: { site?: string; all?: boolean; force?: boolean },
): WebsiteRow[] {
  if (opts.site) {
    const want = siteSlug(opts.site);
    return rows.filter((r) => siteSlug(r.name) === want);
  }
  if (!opts.all) return [];
  return rows.filter((r) => {
    if (!r.url) return false;
    if (r.status === null || !ACTIVE_STATUSES.has(r.status)) return false;
    return opts.force ? true : !r.headerImage;
  });
}

export async function runHeaderImageCommand(
  site: string | undefined,
  opts: HeaderImageOptions,
): Promise<{ output: string; code: number }> {
  const base = openBase(readAirtableConfig());
  const rows = await listWebsites(base);
  const targets = resolveTargets(rows, { site, all: opts.all, force: opts.force });
  if (targets.length === 0) {
    return {
      output: site ? `No site matched "${site}".` : "No sites need a header image.",
      code: 1,
    };
  }

  const outDir = resolve(opts.outDir ?? "reports");
  const settleMs = opts.settleMs ? Number(opts.settleMs) : undefined;
  const lines: string[] = [];
  let failed = 0;

  for (const row of targets) {
    try {
      const gen = await generateHeaderImage({
        url: row.url,
        slug: siteSlug(row.name),
        settleMs,
      });
      if (opts.writeAirtable) {
        await uploadAttachment(row.id, "Header image", gen.bytes, gen.filename, gen.contentType);
        lines.push(
          `✔ ${row.name} — uploaded ${gen.filename} (${(gen.bytes.byteLength / 1024 / 1024).toFixed(2)} MB)`,
        );
      } else {
        const path = resolve(outDir, gen.filename);
        await writeFile(path, gen.bytes);
        lines.push(`✔ ${row.name} — wrote ${path} (review, then re-run with --write-airtable)`);
      }
    } catch (err) {
      failed++;
      lines.push(`✖ ${row.name} — ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  lines.push(`${targets.length - failed}/${targets.length} generated.`);
  return { output: lines.join("\n"), code: failed > 0 ? 1 : 0 };
}
```

- [ ] **Step 4: Register it in the CLI**

In `src/cli/bin.ts`, after the `launch` command block, add:

```typescript
cli
  .command("header-image [site]", "Generate a site's report header image from its live homepage.")
  .option("--all", "Every live site with no Header image yet (backfill)")
  .option("--force", "With --all, regenerate sites that already have one")
  .option("--write-airtable", "Upload to the Websites row instead of writing a local file")
  .option("--out-dir <path>", "Directory for local output (default: reports/)")
  .option("--settle-ms <ms>", "Override the post-load settle delay for slow/animated homepages")
  .action(async (site: string | undefined, opts: Record<string, unknown>) =>
    runOrExit(
      async () => (await import("./commands/header-image.js")).runHeaderImageCommand(site, opts),
      opts,
    ),
  );
```

- [ ] **Step 5: Run the tests**

Run: `pnpm exec vitest run tests/cli/header-image-command.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 6: Verify the command is wired**

```bash
pnpm build && node dist/cli/bin.js header-image --help
```

Expected: the usage block with all five options.

- [ ] **Step 7: Commit**

```bash
git add src/cli/commands/header-image.ts src/cli/bin.ts tests/cli/header-image-command.test.ts
git commit -m "feat(header-image): header-image CLI command"
```

---

## Task 10: Regenerate at draft time

**Files:**

- Modify: `src/reports/draft.ts`
- Test: `tests/reports/draft-header-image.test.ts`

The screenshot must match the period being reported. The draft already renders
the email and uploads a `Rendered HTML` preview that the operator reviews before
approving, so a regenerated header is always seen by a human before it can reach
a client.

**A regeneration failure must never fail the draft.** Mirror how `launch.ts`
tolerates a preview-upload hiccup: log and carry on with the stored image.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/reports/draft-header-image.test.ts
import { describe, it, expect, vi } from "vitest";
import { refreshHeaderImage } from "../../src/reports/draft.js";
import type { WebsiteRow } from "../../src/reports/airtable/websites.js";

const site = { id: "rec1", name: "Acme", url: "https://acme.com/" } as WebsiteRow;

describe("reports/draft refreshHeaderImage", () => {
  it("uploads a freshly generated header", async () => {
    const upload = vi.fn(async () => {});
    const generate = vi.fn(async () => ({
      bytes: new Uint8Array([1]),
      domain: "acme.com",
      filename: "acmeHeader.jpg",
      contentType: "image/jpeg" as const,
    }));
    const ok = await refreshHeaderImage(site, { generate, upload });
    expect(ok).toBe(true);
    expect(upload).toHaveBeenCalledWith(
      "rec1",
      "Header image",
      new Uint8Array([1]),
      "acmeHeader.jpg",
      "image/jpeg",
    );
  });

  it("returns false and does NOT throw when capture fails — the draft continues", async () => {
    const upload = vi.fn(async () => {});
    const generate = vi.fn(async () => {
      throw new Error("net::ERR_TIMED_OUT");
    });
    await expect(refreshHeaderImage(site, { generate, upload })).resolves.toBe(false);
    expect(upload).not.toHaveBeenCalled();
  });

  it("returns false when the upload fails, leaving the stored header intact", async () => {
    const generate = vi.fn(async () => ({
      bytes: new Uint8Array([1]),
      domain: "acme.com",
      filename: "acmeHeader.jpg",
      contentType: "image/jpeg" as const,
    }));
    const upload = vi.fn(async () => {
      throw new Error("airtable 503");
    });
    await expect(refreshHeaderImage(site, { generate, upload })).resolves.toBe(false);
  });

  it("skips a site with no URL", async () => {
    const generate = vi.fn();
    const upload = vi.fn();
    const ok = await refreshHeaderImage({ ...site, url: "" } as WebsiteRow, { generate, upload });
    expect(ok).toBe(false);
    expect(generate).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm exec vitest run tests/reports/draft-header-image.test.ts`
Expected: FAIL — `refreshHeaderImage` is not exported.

- [ ] **Step 3: Add refreshHeaderImage to draft.ts**

Add these imports at the top of `src/reports/draft.ts`:

```typescript
import { generateHeaderImage } from "./header-image/index.js";
import { uploadAttachment } from "./airtable/attachments.js";
import type { GeneratedHeaderImage } from "./header-image/index.js";
```

Then add:

```typescript
export type RefreshHeaderDeps = {
  generate?: (input: { url: string; slug?: string }) => Promise<GeneratedHeaderImage>;
  upload?: (
    recordId: string,
    field: string,
    bytes: Uint8Array,
    filename: string,
    contentType: string,
  ) => Promise<void>;
};

/**
 * Regenerate a site's Header image from its live homepage so the report ships a
 * current screenshot rather than one frozen whenever the image was last made by
 * hand. Sonder alone runs 16 reports a year, so a static header goes visibly
 * stale.
 *
 * BEST-EFFORT BY DESIGN — returns false and never throws. A capture or upload
 * failure must not fail the draft: the stored image is still perfectly usable,
 * and the operator reviews the rendered preview before approving the send.
 */
export async function refreshHeaderImage(
  site: WebsiteRow,
  deps: RefreshHeaderDeps = {},
): Promise<boolean> {
  if (!site.url) return false;
  const generate = deps.generate ?? generateHeaderImage;
  const upload = deps.upload ?? uploadAttachment;
  try {
    const gen = await generate({ url: site.url, slug: siteSlug(site.name) });
    await upload(site.id, "Header image", gen.bytes, gen.filename, gen.contentType);
    return true;
  } catch (err) {
    console.warn(
      `⚠ header-image refresh skipped for ${site.name}: ${
        err instanceof Error ? err.message : String(err)
      } — keeping the stored image`,
    );
    return false;
  }
}
```

Ensure `siteSlug` and `WebsiteRow` are imported in `draft.ts`; add them to the
existing `./airtable/websites.js` import if absent.

- [ ] **Step 4: Call it from the draft path**

In `draftReportForSite` (the function that renders and uploads the preview), call
`refreshHeaderImage` **before** the row is read for rendering, so the preview and
the eventual send both use the new image:

```typescript
// Refresh before render so the preview the operator approves is the image the
// client will actually receive.
await refreshHeaderImage(target);
```

- [ ] **Step 5: Run the tests**

Run: `pnpm exec vitest run tests/reports/draft-header-image.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 6: Commit**

```bash
git add src/reports/draft.ts tests/reports/draft-header-image.test.ts
git commit -m "feat(header-image): regenerate at draft time"
```

---

## Task 11: Full gate, changeset, PR

**Files:**

- Create: `.changeset/header-image-generator.md`

- [ ] **Step 1: Run the complete gate**

```bash
pnpm test && pnpm typecheck && pnpm lint && pnpm build && pnpm test:dist
```

Expected: all green. `test:dist` must print `smoke-dist: <version> OK` — this is
the only check that catches the bundled-plate ENOENT failure mode described in
Task 3.

- [ ] **Step 2: Backfill one real site end to end**

```bash
node dist/cli/bin.js header-image 1836dig
```

Expected: `✔ 1836dig — wrote .../1836digHeader.jpg`. Open it. The 1836dig
homepage must sit inside the laptop screen with the chassis intact, and the
bottom-left must read `1836dig.com`.

Then upload it:

```bash
node dist/cli/bin.js header-image 1836dig --write-airtable
```

- [ ] **Step 3: Confirm preflight clears**

```bash
node dist/cli/bin.js preflight 1836dig
```

Expected: the `header-image-missing` failure is gone.

- [ ] **Step 4: Write the changeset**

```markdown
---
"@reddoorla/maintenance": minor
---

Generate report header images from a site's live homepage.

The per-site "Header image" was made by hand in Figma. 34 of 44 Websites rows had
none, which hard-fails `preflight` with `header-image-missing` — "the send will
throw" — and blocked 1836dig's launch report.

`reddoor-maint header-image <site>` screenshots the site's homepage and
composites it into the bundled plate, writing a local JPEG for review;
`--write-airtable` uploads it, and `--all` backfills every live site without one.

Report drafts now regenerate the header first, so the screenshot matches the
period being reported instead of whenever the image was last made by hand. Sonder
runs 16 reports a year, so a static header goes visibly stale. Regeneration is
best-effort: a capture failure keeps the stored image rather than failing the
draft, and the operator still reviews the rendered preview before approving.
```

- [ ] **Step 5: Commit and open the PR**

```bash
git add .changeset/header-image-generator.md
git commit -m "feat(header-image): changeset"
git push -u origin feat/header-image-generator
gh pr create --repo reddoorla/reddoor-maintenance \
  --title "feat(reports): generate header images from live homepages"
```

---

## Notes for the reviewer

- **Do not re-derive the geometry from content.** `SCREEN` is the hole inside the
  laptop bezel, found by walking out to the flat-black frame. A content-based
  measurement was tried first and was wrong in a way that only showed up as a
  strip of the plate's baked-in screenshot under the bottom edge — see the
  Background section.
- **`pnpm test:dist` is load-bearing.** The bundled-asset resolution bug it
  guards shipped once already (0.10.0–0.10.1) and unit tests cannot see it.
- **Task 5 is the one genuine unknown.** Everything else is measured; the domain
  typeface still needs pinning against the Figma text style, and CI font
  availability is the risk.
