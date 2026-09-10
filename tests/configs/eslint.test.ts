import { describe, it, expect } from "vitest";
import { ESLint } from "eslint";
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

  it("ignores the Phase 0 reference capture but keeps the harness scripts linted", async () => {
    // Behavioural on purpose, not a string-presence assertion. `matching/` and
    // `matching/spec*` both contain the substring the capture needs, and both
    // un-lint files that must stay linted — only resolving the ignore for real
    // tells them apart. `isPathIgnored` stats nothing, so this needs no fixture
    // tree on disk.
    const eslint = new ESLint({
      cwd: process.cwd(),
      overrideConfigFile: true,
      baseConfig: createEslintConfig({ svelteConfig: {} }),
    });

    // The capture: third-party bundles the site never wrote.
    expect(await eslint.isPathIgnored("matching/spec/js/jquery-3.5.1.min.js")).toBe(true);
    expect(await eslint.isPathIgnored("matching/spec/js/webflow.schunk.js")).toBe(true);
    // The harness's scratch workspace, from the same .gitignore block.
    expect(await eslint.isPathIgnored("scratch-diff-home/diff.js")).toBe(true);

    // Ours, one directory up. `matching/` would take these too.
    expect(await eslint.isPathIgnored("matching/probe-inventory.mjs")).toBe(false);
    expect(await eslint.isPathIgnored("matching/states/home.mjs")).toBe(false);
    // Tracked, and NOT the capture. `matching/spec*` would take this.
    expect(await eslint.isPathIgnored("matching/spec-sections/build.mjs")).toBe(false);
    // Control. `isPathIgnored` also returns true for a path no config's `files`
    // matched, so without this a `false` above could not be read as "not in the
    // ignore list". Measured: with a bare `[{ ignores }]` config even
    // `src/lib/a.ts` comes back ignored.
    expect(await eslint.isPathIgnored("src/lib/site-pages.js")).toBe(false);
  });
});
