import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ci = readFileSync(resolve(root, ".github/workflows/ci.yml"), "utf-8");
const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf-8")) as {
  scripts: Record<string, string>;
};

/** The gate, in order, as `verify` defines it: ["pnpm typecheck", "pnpm lint", ...]. */
function verifySteps(): string[] {
  return pkg.scripts.verify!.split("&&").map((s) => s.trim());
}

/**
 * The single-line `- run:` steps of the ci workflow, in order, excluding the
 * dependency install (not part of the gate) and any block scalar (`run: |`,
 * e.g. the working-tree tripwire, which needs a pristine checkout and so is
 * legitimately CI-only).
 */
function ciRunSteps(): string[] {
  return [...ci.matchAll(/^\s*- run: (?!\|)(.+)$/gm)]
    .map((m) => m[1]!.trim())
    .filter((cmd) => !cmd.startsWith("pnpm install"));
}

/**
 * `pnpm verify` and the CI workflow must stay ONE gate.
 *
 * They were two lists maintained separately, and they diverged in the expensive
 * direction: a local `lint && build && test` passed while CI failed on
 * `typecheck` — the only step that typechecks `tests/**` — and nothing local ran
 * `test:dist` at all. Whichever surface is missing a step is the one that lets a
 * break through.
 *
 * CI lists the steps individually so a failure is attributable at a glance in
 * the Actions UI. That is only safe because this test derives the expected list
 * from the `verify` script rather than restating it, so the workflow cannot
 * quietly gain, lose, or reorder a gate.
 */
describe("the CI workflow and `pnpm verify` are one gate", () => {
  it("CI runs exactly the verify steps, in verify's order", () => {
    expect(ciRunSteps()).toEqual(verifySteps());
  });

  it("verify covers every gate, including the ones a local run tends to skip", () => {
    const steps = verifySteps();
    for (const gate of ["pnpm typecheck", "pnpm test:dist"]) {
      expect(steps).toContain(gate);
    }
  });

  it("verify uses the coverage-gated run, not the fast local one", () => {
    // `test` skips the coverage floor in vitest.config.ts; only `test:coverage`
    // enforces it, so verify must not quietly downgrade to the faster script.
    const steps = verifySteps();
    expect(steps).toContain("pnpm test:coverage");
    expect(steps).not.toContain("pnpm test");
  });
});

/**
 * Every workflow that runs the suite must first install a browser.
 *
 * `tests/prospect/interaction-harness.test.ts` drives a real Chromium, and
 * Playwright ships no browser with the npm package. ci.yml gained the install
 * step and release.yml did not, so the PR that added the spec went green on its
 * own check and turned `main` red forty seconds after the merge — the two lists
 * are one gate in `pnpm verify` and were two in setup. This is the assertion
 * that would have caught it, and it is deliberately derived (glob the
 * workflows, look for the run) rather than a hand-kept list of two filenames.
 */
describe("a workflow that runs the suite installs the browser it needs", () => {
  it("holds for every workflow, not just the two we know about", () => {
    const dir = resolve(root, ".github/workflows");
    const offenders = readdirSync(dir)
      .filter((f) => f.endsWith(".yml"))
      .map((f) => ({ f, body: readFileSync(resolve(dir, f), "utf-8") }))
      .filter(({ body }) => /^\s*- run: pnpm (test|test:coverage)\b/m.test(body))
      .filter(({ body }) => !body.includes("playwright install"))
      .map(({ f }) => f);
    expect(offenders).toEqual([]);
  });
});
