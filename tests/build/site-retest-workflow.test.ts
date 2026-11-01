/**
 * P1-88: `site-retest.yml` re-tests one site and must never reach Renovate (backlog
 * P0-1: dispatching fleet-security fires `renovate-dispatch` in client repos). These
 * read what Actions runs (comments stripped, so prose can neither pass nor break an
 * assertion), and the module graph of the command it runs.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
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
});
