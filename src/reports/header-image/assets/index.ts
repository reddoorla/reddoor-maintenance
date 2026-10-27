import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PLATE = "plate-clean.png";

/** Per-report-type headline overlays, stamped over the CLEAN plate at send time
 *  (see orchestrate.ts). Types with no entry go out on the clean plate.
 *
 *  Source: Figma "Web-Maintenance-Email" (mQ3hy2d9JnOG9ljCzbZS8j) —
 *  Maintenance is node 158:15, Testing is 153:721 ("maintenance & testing",
 *  which is what a Testing report actually covers). Export each at 4x; Figma
 *  crops a text export to its ink box, which is why these are 1328x660 /
 *  1715x664 rather than the 1840x720 text box.
 *
 *  ⚠️ A Figma MCP `download_assets` export arrives FLATTENED — never
 *  transparent — and it flattens onto WHATEVER SITS BEHIND THE NODE, which is
 *  not one fixed colour: Maintenance/Testing live inside a white Header frame
 *  and come back on white, while Announcement/Launch sit on the bare canvas and
 *  come back on Figma's canvas grey (30,30,30). Stamping either unprocessed
 *  paints a solid slab over the paper texture — that, not a bad design file, is
 *  what made the 2026-08-20 Testing asset unusable.
 *
 *  Recover the alpha instead of re-exporting by hand: for ink C over backdrop B,
 *  a = (px - B) / (C - B). DETECT B (the export's most common colour) rather
 *  than assuming white, and pick the channel with the largest |C - B| — green
 *  separates the brand red from white by 221 levels but from canvas grey by only
 *  4, which would quantise the alpha to noise. Verified against the known-good
 *  Maintenance asset at mean abs alpha diff 0.022, 0.0037% of pixels off by
 *  more than 8.
 *
 *  Editing this copy needs Figma desktop, not the Plugin API: `characters`
 *  requires loadFontAsync and the MCP font environment carries no Helvetica at
 *  all, so the licensed Helvetica Neue LT Std can never load there. */
const HEADLINE_FILES = {
  Maintenance: "headline-maintenance.png",
  Testing: "headline-testing.png",
  Announcement: "headline-announcement.png",
  Launch: "headline-launch.png",
} as const;

export type HeadlineKind = keyof typeof HEADLINE_FILES;

/** The headline kind for a report type, or null for types that ship clean. */
export function headlineKindFor(reportType: string): HeadlineKind | null {
  return Object.hasOwn(HEADLINE_FILES, reportType) ? (reportType as HeadlineKind) : null;
}

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

/** Read the bundled 2400x3200 CLEAN plate (no headline — the report type's
 *  headline is stamped at send time, so one stored image serves every type). */
export async function loadPlate(): Promise<Uint8Array> {
  return new Uint8Array(await readFile(join(resolveAssetsDir(), PLATE)));
}

/** Read a headline overlay (transparent PNG, ink-box cropped). */
export async function loadHeadline(kind: HeadlineKind): Promise<Uint8Array> {
  return new Uint8Array(await readFile(join(resolveAssetsDir(), HEADLINE_FILES[kind])));
}
