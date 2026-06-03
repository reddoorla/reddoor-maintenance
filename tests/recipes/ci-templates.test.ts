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
  it("ci.yml runs the four-layer gate including a11y with --fail-on-violations", () => {
    const ci = templatesByName(["ci"])[0]!.contents;
    expect(ci).toContain("prettier --check");
    expect(ci).toContain("eslint");
    expect(ci).toContain("build");
    expect(ci).toContain("reddoor-maint audit --only a11y --fail-on-violations");
    expect(ci).not.toContain("lighthouse");
  });
  it("renovate.json auto-merges patch/minor but not major", () => {
    const cfg = JSON.parse(templatesByName(["renovate-config"])[0]!.contents);
    const rules = cfg.packageRules as Array<Record<string, unknown>>;
    const patchMinor = rules.find(
      (r) =>
        Array.isArray(r.matchUpdateTypes) && (r.matchUpdateTypes as string[]).includes("minor"),
    );
    const major = rules.find(
      (r) =>
        Array.isArray(r.matchUpdateTypes) && (r.matchUpdateTypes as string[]).includes("major"),
    );
    expect(patchMinor!.automerge).toBe(true);
    expect(major!.automerge).toBe(false);
  });
  it("renovate.yml emits literal GitHub Actions expressions", () => {
    const contents = templatesByName(["renovate-action"])[0]!.contents;
    expect(contents).toContain("${{ secrets.RENOVATE_TOKEN }}");
    expect(contents).toContain("${{ github.repository }}");
  });
});
