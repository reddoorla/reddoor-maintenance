import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { ALL_TEMPLATES, templatesByName } from "../../src/recipes/sync-configs/templates.js";

describe("CI/Renovate canonical templates", () => {
  it("registers the renovate files at the right paths — and deliberately NO ci.yml template", () => {
    const byPath = Object.fromEntries(ALL_TEMPLATES.map((t) => [t.config, t.path]));
    expect(byPath["renovate-action"]).toBe(".github/workflows/renovate.yml");
    expect(byPath["renovate-config"]).toBe("renovate.json");
    // ci.yml is per-site parameterized (netlify-site, node-version,
    // permissions) — a canonical byte template for it is an armed clobber: any
    // exact-match heal strips those values in a green auto-mergeable PR
    // (2026-08-02 architecture review). If someone re-adds a ci template,
    // this test is the tripwire that forces that conversation.
    expect(ALL_TEMPLATES.some((t) => t.path === ".github/workflows/ci.yml")).toBe(false);
  });
  it("ships a .prettierignore so `prettier --check .` ignores the lockfile and generated dirs", () => {
    const byPath = Object.fromEntries(ALL_TEMPLATES.map((t) => [t.config, t.path]));
    expect(byPath["prettier-ignore"]).toBe(".prettierignore");
    const contents = templatesByName(["prettier-ignore"])[0]!.contents;
    expect(contents).toContain("pnpm-lock.yaml");
    expect(contents).toContain(".svelte-kit/");
  });
  it("ships a netlify.toml pinning Node 22 (not 22.12, which breaks eslint 10)", () => {
    const byPath = Object.fromEntries(ALL_TEMPLATES.map((t) => [t.config, t.path]));
    expect(byPath["netlify"]).toBe("netlify.toml");
    const contents = templatesByName(["netlify"])[0]!.contents;
    expect(contents).toContain('NODE_VERSION = "22"');
    expect(contents).not.toContain("22.12");
    expect(contents).toContain("COREPACK_INTEGRITY_KEYS");
    expect(contents).toContain('command = "pnpm build"');
  });
  it("renovate.json is a thin shim extending the org preset", () => {
    const cfg = JSON.parse(templatesByName(["renovate-config"])[0]!.contents);
    expect(cfg.extends).toContain("github>reddoorla/.github:renovate-config");
    expect(cfg.packageRules).toBeUndefined();
  });
  it("renovate.yml emits literal GitHub Actions expressions", () => {
    const contents = templatesByName(["renovate-action"])[0]!.contents;
    // App-token minting (the PAT is gone — reddoor-renovate App identity).
    expect(contents).toContain("${{ vars.RENOVATE_APP_ID }}");
    expect(contents).toContain("${{ secrets.RENOVATE_APP_PRIVATE_KEY }}");
    expect(contents).toContain("${{ steps.app-token.outputs.token }}");
    expect(contents).toContain("${{ github.repository }}");
    expect(contents).not.toContain("RENOVATE_TOKEN");
  });

  it("sync-clean fixtures stay byte-identical to the renovate templates", () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
    const renovateFixture = readFileSync(
      join(root, "tests/fixtures/sync-clean/renovate.json"),
      "utf-8",
    );
    expect(renovateFixture).toBe(templatesByName(["renovate-config"])[0]!.contents);
  });
});
