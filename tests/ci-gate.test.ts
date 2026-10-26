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
    // cockpit:build is the dashboard site's production bundle, which netlify.toml builds;
    // without it here only a deploy preview would catch a bundle-time break (#1577).
    for (const gate of ["pnpm typecheck", "pnpm test:dist", "pnpm cockpit:build"]) {
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
 * Every workflow that runs the suite must generate the cockpit's SvelteKit files first.
 *
 * The cockpit tests load the tsconfig and types that only `svelte-kit sync` writes, and
 * only `pnpm cockpit:sync`, from the repo root, gives the sync the cockpit's config
 * (`vite.cockpit.config.ts`, which sets `files.src` and `outDir`; a bare sync finds no
 * config and writes defaults for a `src/` app that does not exist).
 * ci.yml and release.yml get it from `pnpm typecheck` → `cockpit:check`; time-travel.yml
 * ran `pnpm test` alone, so once the cockpit suite landed (#1568) every one of its 35
 * files failed to load and the weekly run would have gone red blaming the wall clock
 * (#1616) — and stayed blind to the cockpit's own clock bugs until then.
 */
describe("a workflow that runs the suite syncs the cockpit before it", () => {
  type Step = { name?: string; if?: unknown; run?: string; "working-directory"?: string };
  type Defaults = { run?: { "working-directory"?: string } };
  type Workflow = {
    defaults?: Defaults;
    jobs?: Record<string, { defaults?: Defaults; steps?: Step[] }>;
  };
  // Any line of the step, so a `run: |` block is policed too; not `test:dist`, which
  // smokes the built package and loads no cockpit test.
  const SUITE = /^\s*pnpm (test|test:coverage)(?=\s|$)/m;
  // `pnpm typecheck` reaches `cockpit:check`, whose first command is the sync.
  const SYNC = /^\s*pnpm (cockpit:sync|typecheck|cockpit:check)\s*$/;

  // GitHub resolves a `run:` step's directory as the step's `working-directory`, else the
  // job's `defaults.run.working-directory`, else the workflow's; `.` and `./` are the root.
  const atRoot = (dir: string | undefined) => dir === undefined || /^\.\/?$/.test(dir);

  /** The jobs of one parsed workflow that run the suite, with the suite step's index and
   *  the `defaults.run.working-directory` their steps inherit. */
  function jobsRunningSuite(
    doc: Workflow,
  ): { job: string; steps: Step[]; at: number; dir: string | undefined }[] {
    const workflowDir = doc.defaults?.run?.["working-directory"];
    return Object.entries(doc.jobs ?? {})
      .map(([job, j]) => {
        const steps = j.steps ?? [];
        return {
          job,
          steps,
          at: steps.findIndex((s) => SUITE.test(s.run ?? "")),
          dir: j.defaults?.run?.["working-directory"] ?? workflowDir,
        };
      })
      .filter(({ at }) => at >= 0);
  }

  /**
   * The jobs of one parsed workflow that run the suite without a qualifying sync before it.
   * A sync qualifies only when it runs from the repo root, with the directory resolved as
   * GitHub does (`atRoot` above), and has no `if:` at all (#1620). The `if:` rule is
   * deliberately strict: any `if:`, even `success()`, makes the sync conditional, and this
   * guard cannot evaluate expressions to tell which ones always pass. No workflow uses one.
   */
  function unsyncedSuiteJobs(doc: Workflow): string[] {
    return jobsRunningSuite(doc)
      .filter(
        ({ steps, at, dir }) =>
          !steps
            .slice(0, at)
            .some(
              (s) =>
                SYNC.test(s.run ?? "") &&
                s.if === undefined &&
                atRoot(s["working-directory"] ?? dir),
            ),
      )
      .map(({ job }) => job);
  }

  function workflows(): { file: string; doc: Workflow }[] {
    const dir = resolve(root, ".github/workflows");
    return readdirSync(dir)
      .filter((f) => f.endsWith(".yml"))
      .map((file) => ({
        file,
        doc: yaml.load(readFileSync(resolve(dir, file), "utf-8")) as Workflow,
      }));
  }

  function suiteJobs(): { where: string }[] {
    return workflows().flatMap(({ file, doc }) =>
      jobsRunningSuite(doc).map(({ job }) => ({ where: `${file}:${job}` })),
    );
  }

  it("finds the jobs it is meant to police", () => {
    expect(suiteJobs().map(({ where }) => where.split(":")[0])).toEqual(
      expect.arrayContaining(["ci.yml", "release.yml", "time-travel.yml"]),
    );
  });

  it("holds for every such job, from the repo root", () => {
    const offenders = workflows().flatMap(({ file, doc }) =>
      unsyncedSuiteJobs(doc).map((job) => `${file}:${job}`),
    );
    expect(offenders).toEqual([]);
  });

  // Fixtures: the guard must go red on each way a sync can miss the root or not run.
  const job = (sync: Step, defaults?: Defaults) => ({
    jobs: { test: { ...(defaults ? { defaults } : {}), steps: [sync, { run: "pnpm test" }] } },
  });

  it("accepts a root sync that always runs (the known-good fixture)", () => {
    expect(unsyncedSuiteJobs(job({ run: "pnpm typecheck" }))).toEqual([]);
  });

  it("refuses a job with no sync before the suite", () => {
    expect(unsyncedSuiteJobs({ jobs: { test: { steps: [{ run: "pnpm test" }] } } })).toEqual([
      "test",
    ]);
  });

  it("refuses a sync step with its own working-directory", () => {
    expect(
      unsyncedSuiteJobs(job({ run: "pnpm typecheck", "working-directory": "cockpit" })),
    ).toEqual(["test"]);
  });

  it("refuses a sync step that can be skipped by its if:", () => {
    expect(unsyncedSuiteJobs(job({ run: "pnpm typecheck", if: false }))).toEqual(["test"]);
    expect(
      unsyncedSuiteJobs(job({ run: "pnpm typecheck", if: "github.event_name == 'push'" })),
    ).toEqual(["test"]);
  });

  it("refuses a sync moved off the root by the job's defaults.run.working-directory", () => {
    expect(
      unsyncedSuiteJobs(
        job({ run: "pnpm typecheck" }, { run: { "working-directory": "cockpit" } }),
      ),
    ).toEqual(["test"]);
  });

  it("accepts `.` and `./` as the repo root at every level", () => {
    expect(unsyncedSuiteJobs(job({ run: "pnpm typecheck", "working-directory": "." }))).toEqual([]);
    expect(
      unsyncedSuiteJobs(job({ run: "pnpm typecheck" }, { run: { "working-directory": "./" } })),
    ).toEqual([]);
    expect(
      unsyncedSuiteJobs({
        defaults: { run: { "working-directory": "." } },
        ...job({ run: "pnpm typecheck" }),
      }),
    ).toEqual([]);
  });

  it("lets a step's working-directory override the job's and the workflow's defaults", () => {
    expect(
      unsyncedSuiteJobs(
        job(
          { run: "pnpm typecheck", "working-directory": "." },
          { run: { "working-directory": "cockpit" } },
        ),
      ),
    ).toEqual([]);
    expect(
      unsyncedSuiteJobs({
        defaults: { run: { "working-directory": "cockpit" } },
        ...job({ run: "pnpm typecheck", "working-directory": "./" }),
      }),
    ).toEqual([]);
  });

  it("refuses a sync moved off the root by the workflow's defaults.run.working-directory", () => {
    expect(
      unsyncedSuiteJobs({
        defaults: { run: { "working-directory": "cockpit" } },
        ...job({ run: "pnpm typecheck" }),
      }),
    ).toEqual(["test"]);
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
