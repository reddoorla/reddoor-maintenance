import { describe, it, expect, expectTypeOf } from "vitest";
import type {
  Site,
  AuditResult,
  RecipeResult,
  InventoryProvider,
  AuditName,
  RecipeName,
  ConfigName,
} from "../src/types.js";
import { ALL_RECIPE_NAMES, isRecipeName } from "../src/recipes/index.js";
import { ALL_CONFIG_NAMES, isConfigName } from "../src/recipes/sync-configs.js";

/** Every `RecipeName`, checked by tsc against the union in BOTH directions: a
 *  missing member and an extra key are each a compile error. The drift tests
 *  compare the runtime arrays to these keys, so the expected set cannot drift
 *  from the union the way a hand-typed `RecipeName[]` could. */
const EVERY_RECIPE_NAME: Record<RecipeName, true> = {
  "sync-configs": true,
  "bump-deps": true,
  "svelte-4-to-5": true,
  "svelte-codemods": true,
  "convert-to-pnpm": true,
  onboard: true,
  "a11y-fixtures-page": true,
  "health-endpoint": true,
  "smoke-suite": true,
  "self-updating": true,
  "prismic-ci": true,
  "match-harness": true,
  init: true,
};

/** Every `ConfigName`, exhaustive by the same compile-time check. */
const EVERY_CONFIG_NAME: Record<ConfigName, true> = {
  lighthouse: true,
  eslint: true,
  prettier: true,
  "prettier-ignore": true,
  "playwright-a11y": true,
  svelte: true,
  gitignore: true,
  "renovate-action": true,
  "renovate-config": true,
  netlify: true,
};

describe("types", () => {
  it("Site requires path, allows optional fields", () => {
    expectTypeOf<Site>().toHaveProperty("path").toEqualTypeOf<string>();
    expectTypeOf<Site>().toHaveProperty("name").toEqualTypeOf<string | undefined>();
    expectTypeOf<Site>().toHaveProperty("repoUrl").toEqualTypeOf<string | undefined>();
  });

  it("AuditResult status is a closed union", () => {
    expectTypeOf<AuditResult["status"]>().toEqualTypeOf<"pass" | "warn" | "fail" | "skip">();
  });

  it("RecipeResult status is a closed union", () => {
    expectTypeOf<RecipeResult["status"]>().toEqualTypeOf<"applied" | "noop" | "failed">();
  });

  it("InventoryProvider is a zero-arg promise of sites", () => {
    expectTypeOf<InventoryProvider>().toEqualTypeOf<() => Promise<Site[]>>();
  });

  it("AuditName covers v1 audits", () => {
    const _ok: AuditName = "deps";
    const _ok2: AuditName = "lighthouse";
    const _ok3: AuditName = "a11y";
    const _ok4: AuditName = "security";
    const _ok5: AuditName = "lint";
  });

  it("RecipeName covers v1 recipes", () => {
    const _ok: RecipeName = "sync-configs";
    const _ok2: RecipeName = "bump-deps";
    const _ok3: RecipeName = "svelte-4-to-5";
    const _ok4: RecipeName = "convert-to-pnpm";
    const _ok5: RecipeName = "onboard";
    const _ok6: RecipeName = "svelte-codemods";
    const _ok7: RecipeName = "a11y-fixtures-page";
    const _ok8: RecipeName = "init";
    const _ok9: RecipeName = "self-updating";
  });

  it("ALL_RECIPE_NAMES matches the RecipeName union exactly (no registration drift)", () => {
    // Regression: svelteCodemods was added to the union but missed in the
    // runtime array, so isRecipeName("svelte-codemods") silently returned
    // false. Check every union member is registered.
    //
    // The expected set is DERIVED from the union (#731), not hand-listed beside
    // it. A `RecipeName[]` literal let a member be missing from both this list
    // and ALL_RECIPE_NAMES — the exact regression above — and stay green:
    // dropping "init" from both left tsc and this test passing. `Record<RecipeName,
    // true>` makes tsc refuse the object unless it names EVERY union member (and
    // nothing else), so the runtime comparison below is against the union itself.
    const all = Object.keys(EVERY_RECIPE_NAME) as RecipeName[];
    expect([...ALL_RECIPE_NAMES].sort()).toEqual([...all].sort());
    for (const name of all) {
      expect(isRecipeName(name)).toBe(true);
    }
    expect(isRecipeName("not-a-recipe")).toBe(false);
  });

  it("ConfigName covers v1 configs", () => {
    const _ok: ConfigName = "lighthouse";
    const _ok2: ConfigName = "eslint";
    const _ok3: ConfigName = "prettier";
    const _ok4: ConfigName = "playwright-a11y";
    const _ok5: ConfigName = "svelte";
    const _ok6: ConfigName = "gitignore";
    const _ok7: ConfigName = "renovate-action";
    const _ok8: ConfigName = "renovate-config";
    const _ok9: ConfigName = "prettier-ignore";
    const _ok10: ConfigName = "netlify";
  });

  it("ALL_CONFIG_NAMES matches the ConfigName union exactly (no registration drift)", () => {
    // Same regression class as the ALL_RECIPE_NAMES drift: the runtime
    // array must enumerate every union member so CLI --only validation
    // catches typos rather than silently passing them through. Derived from the
    // union for the same reason (#731) — see EVERY_CONFIG_NAME.
    const all = Object.keys(EVERY_CONFIG_NAME) as ConfigName[];
    expect([...ALL_CONFIG_NAMES].sort()).toEqual([...all].sort());
    for (const name of all) {
      expect(isConfigName(name)).toBe(true);
    }
    expect(isConfigName("not-a-config")).toBe(false);
  });
});
