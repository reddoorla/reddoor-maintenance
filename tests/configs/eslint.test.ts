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

  it("turns valid-prop-names-in-kit-pages off for +error.svelte only", () => {
    const config = createEslintConfig({ svelteConfig: {} });
    const errorBlock = config.find(
      (c) => "files" in c && Array.isArray(c.files) && c.files.includes("**/+error.svelte"),
    );
    expect(errorBlock?.rules).toEqual({ "svelte/valid-prop-names-in-kit-pages": "off" });
    // Flat config: last matching block wins, so the off-switch must come after
    // every block that enables the rule (e.g. svelte.configs.recommended).
    const rulePositions = config
      .map((c, i) => ({ i, severity: c.rules?.["svelte/valid-prop-names-in-kit-pages"] }))
      .filter((p) => p.severity !== undefined);
    expect(rulePositions.at(-1)?.severity).toBe("off");
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

  it("ignores the agency process directories", () => {
    // Upstreamed from reddoor-starter (2026-09-01): docs/superpowers/ and
    // scratchpad/ are git-ignored but present on disk, so a local `pnpm lint`
    // would try to parse them.
    const config = createEslintConfig({ svelteConfig: {} });
    const ignores = config.flatMap((c) => ("ignores" in c && c.ignores ? c.ignores : []));
    expect(ignores).toContain("docs/superpowers/");
    expect(ignores).toContain("scratchpad/");
  });
});
