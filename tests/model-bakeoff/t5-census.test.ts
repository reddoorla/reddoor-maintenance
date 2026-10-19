import { describe, it, expect } from "vitest";
import { scriptFacts, workflowFacts } from "../../scripts/model-bakeoff/tasks/t5-census.mjs";

describe("t5-census truth", () => {
  it("reads a workflow's name, triggers, crons, actions, secrets and job count", () => {
    const text = [
      "name: Nightly",
      "on:",
      "  schedule:",
      "    - cron: '0 9 * * 1-5'",
      "  workflow_dispatch:",
      "# token: ${{ secrets.OLD_TOKEN }}",
      "jobs:",
      "  a:",
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - uses: actions/checkout@v6",
      "      # - uses: actions/cache@v4",
      "      - run: echo ${{ secrets.GH_TOKEN }} ${{ secrets.GH_TOKEN }}",
      "  b:",
      "    uses: ./.github/workflows/reusable.yml",
    ].join("\n");
    expect(workflowFacts("n.yml", text)).toEqual({
      file: "n.yml",
      name: "Nightly",
      triggers: ["schedule", "workflow_dispatch"],
      crons: ["0 9 * * 1-5"],
      actions: ["actions/checkout", "./.github/workflows/reusable.yml"],
      secrets: ["OLD_TOKEN", "GH_TOKEN"],
      jobs: 2,
    });
  });

  it("reads `on` as a list or a single string, and a missing name as empty", () => {
    expect(workflowFacts("x.yml", "on: [push, pull_request]\njobs: {}\n")).toMatchObject({
      name: "",
      triggers: ["push", "pull_request"],
      crons: [],
      jobs: 0,
    });
    expect(workflowFacts("y.yml", "on: push\njobs:\n  a: {}\n").triggers).toEqual(["push"]);
  });

  it('counts a bare "node:" literal, as the 2026-10-19 referee ruled', () => {
    const text = 'if (!s.startsWith("node:")) {}\n// node: builtins pass\n';
    expect(scriptFacts("c.mjs", text).nodeImports).toEqual(["node:"]);
  });

  it("counts newlines, the shebang, node: literals and `gh api`", () => {
    const text =
      '#!/usr/bin/env node\nimport fs from "node:fs";\nconst p = await import(`node:path`);\n// gh api repos\n';
    expect(scriptFacts("s.mjs", text)).toEqual({
      file: "s.mjs",
      lines: 4,
      shebang: true,
      nodeImports: ["node:fs", "node:path"],
      ghApi: true,
    });
    expect(scriptFacts("t.sh", "echo hi")).toMatchObject({
      lines: 0,
      shebang: false,
      ghApi: false,
    });
  });
});
