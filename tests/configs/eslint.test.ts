import { describe, it, expect } from "vitest";
import { createEslintConfig } from "../../src/configs/eslint.js";

describe("configs/eslint", () => {
  it("returns a flat config array", () => {
    const config = createEslintConfig({ svelteConfig: {} });
    expect(Array.isArray(config)).toBe(true);
    expect(config.length).toBeGreaterThan(3);
  });

  it("includes ignores block with starter-relevant paths", () => {
    const config = createEslintConfig({ svelteConfig: {} });
    const ignores = config.find((c) => "ignores" in c && Array.isArray(c.ignores)) as {
      ignores: string[];
    };
    expect(ignores).toBeDefined();
    expect(ignores.ignores).toEqual(
      expect.arrayContaining([
        "build/",
        ".svelte-kit/",
        ".netlify/",
        "node_modules/",
        "static/",
        "customtypes/",
        "src/lib/slices/**/index.js",
      ]),
    );
  });

  it("passes through the supplied svelteConfig into the .svelte parser options", () => {
    const svelteConfig = { __marker: "from-test" };
    const config = createEslintConfig({ svelteConfig });
    const svelteBlock = config.find(
      (c) =>
        "files" in c &&
        Array.isArray(c.files) &&
        c.files.some((f) => typeof f === "string" && f.includes(".svelte")) &&
        "languageOptions" in c &&
        !!c.languageOptions?.parserOptions,
    ) as { languageOptions?: { parserOptions?: { svelteConfig?: unknown } } } | undefined;
    expect(svelteBlock?.languageOptions?.parserOptions?.svelteConfig).toBe(svelteConfig);
  });
});
