import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const CHECK_CID = "rd-check-png";
export const BLURRED_CID = "rd-blurred-tests-jpg";

export type BundledImage = {
  bytes: Uint8Array;
  contentType: string;
  cid: string;
  filename: string;
};

// Walk up from the current module's URL looking for the assets dir in either
// the dev layout (src/reports/maintenance-email/assets/) or the published
// layout (dist/reports/maintenance-email/assets/). REQUIRED because tsup
// inlines this module into dist/cli/bin.js — so `import.meta.url`-based
// sibling resolution looks in dist/cli/ for the PNGs and fails with ENOENT.
// Regression that shipped in 0.10.0–0.10.1; tests passed in dev because
// vitest evaluates the source file where import.meta.url is already correct.
let cachedAssetsDir: string | null = null;
function resolveAssetsDir(): string {
  if (cachedAssetsDir) return cachedAssetsDir;
  let dir = dirname(fileURLToPath(import.meta.url));
  while (true) {
    // Source layout preferred — single source of truth in the workspace
    // and the only one present in dev/test environments.
    const srcCandidate = join(dir, "src", "reports", "maintenance-email", "assets", "check.png");
    if (existsSync(srcCandidate)) {
      cachedAssetsDir = dirname(srcCandidate);
      return cachedAssetsDir;
    }
    // Published layout — only `dist/` ships per package.json#files, so
    // consumers fall through to here.
    const distCandidate = join(dir, "dist", "reports", "maintenance-email", "assets", "check.png");
    if (existsSync(distCandidate)) {
      cachedAssetsDir = dirname(distCandidate);
      return cachedAssetsDir;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error(
        `loadBundledImages: could not locate maintenance-email assets dir by walking up from ${fileURLToPath(import.meta.url)}. Checked both src/ and dist/ layouts.`,
      );
    }
    dir = parent;
  }
}

/**
 * Read the bundled image bytes from disk. Both Maintenance and Testing
 * variants reference `check.png`; only the Maintenance variant references
 * `blurredTests.jpg`.
 */
export async function loadBundledImages(): Promise<{
  check: BundledImage;
  blurred: BundledImage;
}> {
  const assetsDir = resolveAssetsDir();
  const [check, blurred] = await Promise.all([
    readFile(join(assetsDir, "check.png")),
    readFile(join(assetsDir, "blurredTests.jpg")),
  ]);
  return {
    check: {
      bytes: new Uint8Array(check),
      contentType: "image/png",
      cid: CHECK_CID,
      filename: "check.png",
    },
    blurred: {
      bytes: new Uint8Array(blurred),
      contentType: "image/jpeg",
      cid: BLURRED_CID,
      filename: "blurredTests.jpg",
    },
  };
}
