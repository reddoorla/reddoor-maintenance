import { describe, it, expect } from "vitest";
import { ALL_TEMPLATES, templatesByName } from "../../src/recipes/sync-configs/templates.js";

describe("CI/Renovate canonical templates", () => {
  it("registers the three new files at the right paths", () => {
    const byPath = Object.fromEntries(ALL_TEMPLATES.map((t) => [t.config, t.path]));
    expect(byPath["ci"]).toBe(".github/workflows/ci.yml");
    expect(byPath["renovate-action"]).toBe(".github/workflows/renovate.yml");
    expect(byPath["renovate-config"]).toBe("renovate.json");
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
  it("ci.yml is a thin caller of the org reusable workflow", () => {
    const ci = templatesByName(["ci"])[0]!.contents;
    expect(ci).toMatch(
      /uses:\s+reddoorla\/\.github\/\.github\/workflows\/ci\.yml@[0-9a-f]{40} # v/,
    );
    expect(ci).toContain("on:");
    expect(ci).toContain("pull_request");
    expect(ci).not.toContain("reddoor-maint audit");
    expect(ci).not.toContain("pnpm build");
  });

  it("renovate.json is a thin shim extending the org preset", () => {
    const cfg = JSON.parse(templatesByName(["renovate-config"])[0]!.contents);
    expect(cfg.extends).toContain("github>reddoorla/.github:renovate-config");
    expect(cfg.packageRules).toBeUndefined();
  });
  it("renovate.yml emits literal GitHub Actions expressions", () => {
    const contents = templatesByName(["renovate-action"])[0]!.contents;
    expect(contents).toContain("${{ secrets.RENOVATE_TOKEN }}");
    expect(contents).toContain("${{ github.repository }}");
  });
});
