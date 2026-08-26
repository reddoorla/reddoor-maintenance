import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

// reddoor-website imports this subpath to type the report it fetches. It must
// stay dependency-free: a runtime import in src/prospect/types.ts would reach
// reddoorla.com's bundle and drag the audit's heavy deps (the Anthropic SDK,
// Playwright) with it. tsup.config.ts's own comment already states the rule —
// consumers only ever import the dependency-free entries — and until now
// nothing enforced it.
describe("the ./audit package entry", () => {
  it("is declared in the export map", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf-8")) as {
      exports: Record<string, { types: string; import: string }>;
    };
    expect(pkg.exports["./audit"]).toEqual({
      types: "./dist/prospect/types.d.ts",
      import: "./dist/prospect/types.js",
    });
  });

  it("is built by tsup", () => {
    const cfg = readFileSync("tsup.config.ts", "utf-8");
    expect(cfg).toContain("src/prospect/types.ts");
  });

  // The guarantee the whole export rests on.
  it("has no runtime imports — only `import type`", () => {
    const src = readFileSync("src/prospect/types.ts", "utf-8");
    const runtimeImports = src
      .split("\n")
      .filter((l) => /^\s*import\s/.test(l) && !/^\s*import\s+type\s/.test(l));
    expect(runtimeImports).toEqual([]);
  });
});
