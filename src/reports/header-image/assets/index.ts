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
