import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import yaml from "js-yaml";

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
      // `- run: pnpm test` AND `run: pnpm test` under a `- name:` step. The
      // first form alone let time-travel.yml (a named step, so it could carry
      // an `id:` and an `env:`) run the suite with no browser for three weeks
      // (#775) while this test stayed green — a guard that only sees one
      // spelling of the step is a guard the next workflow will write around.
      .filter(({ body }) => /^\s*(- )?run: pnpm (test|test:coverage)\b/m.test(body))
      .filter(({ body }) => !body.includes("playwright install"))
      .map(({ f }) => f);
    expect(offenders).toEqual([]);
  });
});

/**
 * Every workflow that runs the suite must check out full history.
 *
 * `tests/recipes/match-harness-snapshot-guard.test.ts` runs the real guard on
 * the real tree, and the guard reads the previous release tag. A default
 * checkout is shallow and carries no tags, so the guard refuses and the test
 * fails. ci.yml and release.yml took `fetch-depth: 0` for it; time-travel.yml
 * did not, and every weekly run from 2026-09-21 was red on that one test while
 * the tracking issue (#895) read it as a wall-clock failure.
 */
describe("a workflow that runs the suite checks out the tags the suite reads", () => {
  function workflowsRunningTheSuite(): { f: string; body: string }[] {
    const dir = resolve(root, ".github/workflows");
    return readdirSync(dir)
      .filter((f) => f.endsWith(".yml"))
      .map((f) => ({ f, body: readFileSync(resolve(dir, f), "utf-8") }))
      .filter(({ body }) => /^\s*(- )?run: pnpm (test|test:coverage)\b/m.test(body));
  }

  it("finds the workflows it is meant to police", () => {
    expect(workflowsRunningTheSuite().map(({ f }) => f)).toEqual(
      expect.arrayContaining(["ci.yml", "release.yml", "time-travel.yml"]),
    );
  });

  it("holds for every such workflow", () => {
    const offenders = workflowsRunningTheSuite()
      .filter(({ body }) => {
        const checkouts = [
          ...body.matchAll(/- uses: actions\/checkout@[^\n]*\n((?:\s+[^-\s][^\n]*\n)*)/g),
        ];
        return (
          checkouts.length === 0 ||
          checkouts.some(([, block]) => !/^\s+fetch-depth: 0\s*$/m.test(block ?? ""))
        );
      })
      .map(({ f }) => f);
    expect(offenders).toEqual([]);
  });
});

/**
 * The release job's changesets step is the only npm-publish path, and two of
 * the ways to break it are silent: without the `github-token` input the version
 * PR is pushed with the built-in token, so ci.yml never fires and its required
 * `build` check never runs; with the v1 pin, v1 ignores v2's input names and
 * never publishes. Neither fails the step, so this test is what catches them.
 */
describe("the release job drives changesets/action v2 with the App token", () => {
  type Step = {
    id?: string;
    name?: string;
    uses?: string;
    if?: string;
    run?: string;
    with?: Record<string, unknown>;
    env?: Record<string, unknown>;
  };
  const text = readFileSync(resolve(root, ".github/workflows/release.yml"), "utf-8");
  const steps = (yaml.load(text) as { jobs: { release: { steps: Step[] } } }).jobs.release.steps;
  const step = steps.find((s) => s.uses?.startsWith("changesets/action@"));
  // The `inputs:` of changesets/action v2.1.2's action.yml (ae32849d).
  const V2_INPUTS = [
    "github-token",
    "publish-script",
    "version-script",
    "commit-message",
    "pr-title",
    "pr-draft",
    "pr-base-branch",
    "create-github-releases",
    "push-git-tags",
    "push-with-git-cli",
    "cwd",
  ];

  it("pins a v2 release by full commit SHA", () => {
    expect(step?.uses).toMatch(/^changesets\/action@[0-9a-f]{40}$/);
    const line = text.split("\n").find((l) => l.includes(step!.uses!));
    expect(line).toMatch(/# v2\.\d+\.\d+\s*$/);
  });

  it("passes only v2 input names, and runs the repo's own scripts", () => {
    const keys = Object.keys(step!.with ?? {});
    expect(keys.filter((k) => !V2_INPUTS.includes(k))).toEqual([]);
    expect(step!.with!["publish-script"]).toBe("pnpm run release");
    expect(step!.with!["version-script"]).toBe("pnpm run version-packages");
    expect(pkg.scripts.release).toBeDefined();
    expect(pkg.scripts["version-packages"]).toBeDefined();
  });

  it("takes the App token as its input, with no GITHUB_TOKEN env, and pushes with git", () => {
    expect(step!.with!["github-token"]).toBe("${{ steps.app-token.outputs.token }}");
    expect(step!.env?.GITHUB_TOKEN).toBeUndefined();
    expect(step!.with!["push-with-git-cli"]).toBe(true);
  });

  it("pairs with @changesets/cli v3, which v2 requires", () => {
    const deps = JSON.parse(readFileSync(resolve(root, "package.json"), "utf-8")) as {
      devDependencies?: Record<string, string>;
    };
    expect(deps.devDependencies?.["@changesets/cli"]).toMatch(/^\^?3\./);
  });

  it("fails the run when a publish leaves no annotated tag on the published commit", () => {
    const verify = steps.find((s) =>
      s.if?.includes(`steps.${step!.id}.outputs.published == 'true'`),
    );
    expect(step!.id).toBeTruthy();
    expect(verify?.run).toContain("refs/tags/${v}^{}");
    expect(verify?.run).toContain("git rev-parse HEAD");
    expect(verify?.run).toMatch(/exit 1/);
  });
});
