// Dependency-boundary check for the light subpath: bundling src/video-pipeline/index.ts
// must leave only node:crypto as an external import. A bundle sees side-effect imports
// (`import "node:fs"`) and re-exports that a regex over the source text misses.
import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

// esbuild is not a direct dependency; it is resolved through tsup, which bundles it.
type BuildResult = { metafile: { outputs: Record<string, { imports: { path: string }[] }> } };
type Build = (options: Record<string, unknown>) => Promise<BuildResult>;
const tsupEntry = createRequire(import.meta.url).resolve("tsup");
const { build } = createRequire(tsupEntry)("esbuild") as { build: Build };

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const dir = join(root, "src/video-pipeline");

describe("video-pipeline: dependency boundary", () => {
  it("finds the light modules", () => {
    const names = [
      "index.ts",
      "key.ts",
      "manifest.ts",
      "classify.ts",
      "webhook.ts",
      "dispatch.ts",
      "relay.ts",
      "stuck.ts",
    ];
    for (const name of names) expect(existsSync(join(dir, name)), name).toBe(true);
  });

  it("bundles with node:crypto as the only external import", async () => {
    const result = await build({
      entryPoints: [join(dir, "index.ts")],
      bundle: true,
      write: false,
      metafile: true,
      platform: "neutral",
      format: "esm",
      external: ["node:crypto", "crypto"],
      logLevel: "silent",
    });
    const imports = Object.values(result.metafile.outputs).flatMap((o) =>
      o.imports.map((i) => i.path),
    );
    const bad = imports.filter((p) => p !== "node:crypto" && p !== "crypto");
    expect(bad).toEqual([]);
  });
});
