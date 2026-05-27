import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const distIndex = resolve(here, "../../dist/index.js");

// Regression for the 0.10.0–0.10.1 prod-only ENOENT.
//
// The loader previously used `dirname(fileURLToPath(import.meta.url))` to find
// `check.png` and `blurredTests.jpg` "next to itself." Vitest evaluates source
// files directly, where `import.meta.url` resolves to the .ts beside the
// assets, so every dev test passed. After tsup inlined the loader into
// dist/cli/bin.js (and dist/index.js etc), `import.meta.url` resolved to the
// bundled file's location instead — `dist/cli/check.png` doesn't exist, the
// loader threw ENOENT at first send. Caught only when a user actually ran the
// published package.
//
// This test exercises the loader through the BUILT library entry (dist/index.js)
// from an arbitrary cwd, simulating a consumer's npx invocation. Self-skips
// with a clear message if dist isn't present.
describe("bundled email assets (post-build regression for 0.10.0–0.10.1 ENOENT)", () => {
  beforeAll(() => {
    if (!existsSync(distIndex)) {
      throw new Error(
        `dist/index.js not built — run 'pnpm build' before this test (the regression only manifests in built output).`,
      );
    }
  });

  function invokeLoaderFrom(cwd: string): { check: number; blurred: number } {
    const distUrl = `file://${distIndex.replace(/\\/g, "/")}`;
    const script = `
      import("${distUrl}")
        .then(m => m.loadBundledImages())
        .then(r => process.stdout.write(JSON.stringify({ check: r.check.bytes.length, blurred: r.blurred.bytes.length })))
        .catch(e => { process.stderr.write(String(e)); process.exit(1); });
    `;
    const out = execFileSync(process.execPath, ["--input-type=module", "-e", script], {
      cwd,
      encoding: "utf-8",
    });
    return JSON.parse(out) as { check: number; blurred: number };
  }

  it("loader works when invoked from the package root", () => {
    const r = invokeLoaderFrom(resolve(here, "../.."));
    expect(r.check).toBeGreaterThan(1000); // ~1.6 KB png
    expect(r.blurred).toBeGreaterThan(100_000); // ~600 KB jpg
  });

  // The actual failure mode that shipped: npx runs the package from
  // ~/.npm/_npx/<hash>/ with the user's cwd being arbitrary. cwd MUST NOT
  // influence asset resolution.
  it("loader works when cwd is unrelated to the package install location", () => {
    const r = invokeLoaderFrom("/");
    expect(r.check).toBeGreaterThan(1000);
    expect(r.blurred).toBeGreaterThan(100_000);
  });
});
