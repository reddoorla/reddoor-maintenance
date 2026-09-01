import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ci = readFileSync(resolve(root, ".github/workflows/ci.yml"), "utf-8");
const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf-8")) as {
  scripts: Record<string, string>;
};

/**
 * `pnpm verify` and CI must stay ONE definition of the gate.
 *
 * They used to be two lists maintained separately, and they diverged in the
 * expensive direction: a local run of lint + build + test passed while CI failed
 * on `typecheck` — the only step that typechecks `tests/**` — and nothing local
 * ran `test:dist` at all. Whichever surface is missing a step is the one that
 * lets a break through.
 */
describe("the CI gate and `pnpm verify` are the same thing", () => {
  it("CI delegates to `pnpm verify` rather than listing steps itself", () => {
    expect(ci).toContain("run: pnpm verify");
  });

  it("CI does not re-inline any step that `verify` already runs", () => {
    // A re-inlined step is how the two lists drift back apart: it would pass in
    // CI while `pnpm verify` locally stayed silent about it.
    for (const step of ["typecheck", "lint", "build", "test:coverage", "test:dist"]) {
      expect(ci).not.toContain(`run: pnpm ${step}`);
    }
  });

  it("verify runs every gate CI depends on, in CI's order", () => {
    expect(pkg.scripts.verify).toBe(
      "pnpm typecheck && pnpm lint && pnpm build && pnpm test:coverage && pnpm test:dist",
    );
  });

  it("verify uses the coverage-gated run, not the fast local one", () => {
    // `test` skips the coverage floor in vitest.config.ts; only `test:coverage`
    // enforces it, so verify must not quietly downgrade to the faster script.
    expect(pkg.scripts.verify).toContain("test:coverage");
    expect(pkg.scripts.verify).not.toMatch(/pnpm test(?!:)/);
  });
});
