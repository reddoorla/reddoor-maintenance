/**
 * P1-88: `site-retest.yml` re-tests one site and must never reach Renovate (backlog
 * P0-1: dispatching fleet-security fires `renovate-dispatch` in client repos). These
 * read what Actions runs (comments stripped, so prose can neither pass nor break an
 * assertion), and the module graph of the command it runs.
 */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, resolve } from "node:path";
import {
  stepEnv,
  stepRunScript,
  withoutComments,
  workflowPath,
  workflowSteps,
  workflowUses,
} from "./_helpers/workflow-source.js";

const SRC = readFileSync(workflowPath("site-retest.yml"), "utf8");
const LIVE = withoutComments(SRC);
const STEP = "Re-test the site and write its row";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");

describe("site-retest.yml never dispatches Renovate", () => {
  it("names no renovate command, workflow or App token anywhere it runs", () => {
    expect(LIVE).not.toMatch(/renovate/i);
    expect(LIVE).not.toMatch(/create-github-app-token|app-id|private-key/i);
  });

  it("holds no GitHub write grant: contents read is the whole permission", () => {
    expect(LIVE).toMatch(/^permissions:\n {2}contents: read\n\n/m);
    expect(LIVE).not.toMatch(/actions: write|issues: write|contents: write/);
  });

  it("runs the site-retest command and no audit sweep, and never security or deps", () => {
    const run = stepRunScript(SRC, STEP);
    expect(run).toMatch(/node dist\/cli\/bin\.js site-retest "\$\{args\[@\]\}"/);
    expect(run).not.toMatch(/\baudit\b.*--fleet|renovate-dispatch|security|deps/);
  });

  it("passes the inputs as env vars, never interpolated into the script", () => {
    const run = stepRunScript(SRC, STEP);
    expect(run).not.toContain("${{");
    expect(stepEnv(SRC, STEP)).toMatchObject({
      SITE: "${{ inputs.site }}",
      ONLY: "${{ inputs.only }}",
    });
  });

  it("takes a required site input, is dispatch-only, and has no secrets but Turso and Netlify", () => {
    expect(LIVE).toMatch(/workflow_dispatch:\n {4}inputs:\n {6}site:[\s\S]*?required: true/);
    expect(LIVE).not.toMatch(/^\s+schedule:/m);
    const secrets = [...LIVE.matchAll(/secrets\.([A-Z_]+)/g)].map((m) => m[1]);
    expect([...new Set(secrets)].sort()).toEqual([
      "NETLIFY_PAT",
      "TURSO_AUTH_TOKEN",
      "TURSO_DATABASE_URL",
    ]);
    expect(workflowSteps(SRC).length).toBeGreaterThan(0);
    for (const u of workflowUses(SRC)) expect(u).toMatch(/@[0-9a-f]{40}$/);
  });
});

describe("the command it runs imports nothing that dispatches Renovate", () => {
  const files = [
    "src/cli/commands/site-retest.ts",
    "src/retest/site-retest.ts",
    "src/dashboard/site-retest-trigger.ts",
    "cockpit/src/lib/server/endpoints/site-retest.ts",
  ];
  it.each(files)("%s imports no renovate module", (f) => {
    const text = readFileSync(join(ROOT, f), "utf8");
    const imports = [...text.matchAll(/from\s+"([^"]+)"|import\(\s*"([^"]+)"\s*\)/g)].map(
      (m) => m[1] ?? m[2],
    );
    expect(imports.length).toBeGreaterThan(0);
    for (const i of imports) expect(i).not.toMatch(/renovate/i);
  });

  /** Every repo module reachable from `starts` by relative static or dynamic import. */
  function reachable(starts: readonly string[]): string[] {
    const seen = new Set<string>();
    const stack = starts.map((f) => resolve(ROOT, f));
    while (stack.length > 0) {
      const f = stack.pop()!;
      if (seen.has(f)) continue;
      seen.add(f);
      const text = readFileSync(f, "utf8");
      for (const m of text.matchAll(/(?:from\s+|import\(\s*)"(\.{1,2}\/[^"]+)"/g)) {
        const p = resolve(dirname(f), m[1]!);
        const hit = [p.replace(/\.js$/, ".ts"), p, `${p}.ts`].find(
          (c) => existsSync(c) && statSync(c).isFile(),
        );
        if (hit) stack.push(hit);
      }
    }
    return [...seen].map((f) => relative(ROOT, f));
  }

  // The renovate classifier is read-only (is this PR Renovate's?), so it may be reached;
  // anything else under a renovate name is the dispatch side (#1888).
  const READ_ONLY = new Set(["src/alerts/renovate.ts"]);

  it("nothing reachable from them, transitively, is a renovate module", () => {
    const graph = reachable(files);
    // The walk is real: it reaches the audit command the CLI imports dynamically.
    expect(graph).toContain("src/cli/commands/audit.ts");
    expect(graph.filter((f) => /renovate/i.test(f) && !READ_ONLY.has(f))).toEqual([]);
  });

  it("the walk finds a dispatcher when one is reachable (the instrument's control)", () => {
    expect(reachable(["src/cli/commands/renovate-dispatch.ts"])).toContain(
      "src/github/renovate-dispatch.ts",
    );
  });
});

describe("the browsers are installed only when the plan runs the browser audit (#1888)", () => {
  const steps = workflowSteps(SRC);
  const plan = steps.find((s) => s.label === "Plan the re-test");
  const install = steps.find((s) => /playwright install/.test(s.source));
  const run = steps.findIndex((s) => s.label === STEP);

  it("a dry-run plan step runs before the install, which is gated on its output", () => {
    expect(plan?.source).toMatch(/site-retest "\$\{args\[@\]\}"/);
    expect(plan?.source).toMatch(/args=\("\$SITE" --dry-run\)/);
    expect(plan?.source).toMatch(/browser=true" >> "\$GITHUB_OUTPUT"/);
    expect(install?.if).toBe("steps.plan.outputs.browser == 'true'");
    expect(steps.indexOf(plan!)).toBeLessThan(steps.indexOf(install!));
    expect(steps.indexOf(install!)).toBeLessThan(run);
  });

  it("passes the inputs to the plan as env vars, never interpolated", () => {
    expect(stepRunScript(SRC, "Plan the re-test")).not.toContain("${{");
    expect(stepEnv(SRC, "Plan the re-test")).toMatchObject({
      SITE: "${{ inputs.site }}",
      ONLY: "${{ inputs.only }}",
    });
  });

  it.each([
    ["RETEST site=acme audits=browser,domain", true],
    ["RETEST site=acme audits=domain,browser (--only)", true],
    ["RETEST site=acme audits=browser", true],
    ["RETEST site=acme audits=domain", false],
    ["RETEST site=acme audits=none", false],
    ["RETEST site=browser audits=domain", false],
  ])("the plan's grep reads %j as browser=%s", (line, want) => {
    const re = / audits=([a-z-]+,)*browser(,| |$)/;
    expect(stepRunScript(SRC, "Plan the re-test")).toContain(re.source);
    expect(re.test(line)).toBe(want);
  });
});
