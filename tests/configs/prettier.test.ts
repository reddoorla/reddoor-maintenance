import { describe, it, expect } from "vitest";
import prettierConfig, { prettierConfig as named } from "../../src/configs/prettier.js";

describe("configs/prettier", () => {
  it("default equals named export", () => {
    expect(prettierConfig).toBe(named);
  });

  it("registers the svelte plugin", () => {
    expect(prettierConfig.plugins).toEqual(["prettier-plugin-svelte"]);
  });

  it("maps .svelte files to the svelte parser via overrides", () => {
    const svelteOverride = prettierConfig.overrides?.find((o) => o.files === "*.svelte");
    expect(svelteOverride).toBeDefined();
    expect(svelteOverride?.options).toEqual({ parser: "svelte" });
  });

  it("uses repo-wide formatting defaults", () => {
    expect(prettierConfig.trailingComma).toBe("all");
    expect(prettierConfig.singleQuote).toBe(false);
    expect(prettierConfig.printWidth).toBe(100);
  });
});
