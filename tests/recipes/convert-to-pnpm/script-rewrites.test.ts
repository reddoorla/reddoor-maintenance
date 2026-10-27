import { describe, it, expect } from "vitest";
import { rewriteScriptForPnpm } from "../../../src/recipes/convert-to-pnpm/script-rewrites.js";

describe("convert-to-pnpm: rewriteScriptForPnpm", () => {
  it("rewrites `npm run <name>` to `pnpm run <name>`", () => {
    expect(rewriteScriptForPnpm("npm run build")).toBe("pnpm run build");
  });

  it("rewrites `npm run <name>` inside a concurrently chain", () => {
    const input = `concurrently "npm:vite:dev" "npm run slicemachine"`;
    const out = rewriteScriptForPnpm(input);
    // Only the standalone `npm run ...` is touched; `npm:vite:dev` (the
    // concurrently script-ref syntax) is left alone.
    expect(out).toBe(`concurrently "npm:vite:dev" "pnpm run slicemachine"`);
  });

  it("rewrites `npx <pkg>` to `pnpm dlx <pkg>`", () => {
    expect(rewriteScriptForPnpm("npx playwright test")).toBe("pnpm dlx playwright test");
  });

  it("does not touch bare `npm install` at end of a build script", () => {
    // `npm install` (no args) on its own is intentionally left for the operator
    // to decide — running `pnpm install` inside another script is rare.
    const input = "npm install";
    expect(rewriteScriptForPnpm(input)).toBe(input);
  });

  it("does not touch words that contain npm as a substring", () => {
    // e.g., `npm-check-updates`, `@types/npm-package-arg`
    expect(rewriteScriptForPnpm("npm-check-updates --upgrade")).toBe("npm-check-updates --upgrade");
    expect(rewriteScriptForPnpm("echo @types/npm-package-arg")).toBe("echo @types/npm-package-arg");
  });

  it("is a noop on a script with no npm references", () => {
    const input = "vite dev --host";
    expect(rewriteScriptForPnpm(input)).toBe(input);
  });
});
