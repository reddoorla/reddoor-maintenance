import { describe, it, expectTypeOf } from "vitest";
import type {
  Site,
  AuditResult,
  RecipeResult,
  InventoryProvider,
  AuditName,
  RecipeName,
  ConfigName,
} from "../src/types.js";

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
  });

  it("ConfigName covers v1 configs", () => {
    const _ok: ConfigName = "lighthouse";
    const _ok2: ConfigName = "eslint";
    const _ok3: ConfigName = "prettier";
    const _ok4: ConfigName = "playwright-a11y";
    const _ok5: ConfigName = "svelte";
  });
});
