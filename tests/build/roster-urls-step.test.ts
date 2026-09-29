import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import yaml from "js-yaml";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

type Step = {
  name?: string;
  run?: string;
  if?: string;
  env?: Record<string, string>;
  "timeout-minutes"?: number;
  "continue-on-error"?: boolean;
};

function steps(): Step[] {
  const wf = yaml.load(
    readFileSync(join(repoRoot, ".github/workflows/fleet-lighthouse.yml"), "utf-8"),
  ) as { jobs: Record<string, { steps: Step[] }> };
  return Object.values(wf.jobs).flatMap((j) => j.steps);
}

describe("fleet-lighthouse › Probe roster urls to Turso (#912)", () => {
  const all = steps();
  const step = all.find((s) => s.name === "Probe roster urls to Turso");

  it("runs the fleet write-back, after the build and the GitHub-signals sweep", () => {
    expect(step).toBeDefined();
    expect(step!.run?.trim()).toBe("node dist/cli/bin.js roster-urls --fleet --write-back");
    const at = all.indexOf(step!);
    expect(all.findIndex((s) => s.run?.includes("pnpm build"))).toBeLessThan(at);
    expect(all.findIndex((s) => s.name === "Sweep GitHub signals to Turso")).toBeLessThan(at);
  });

  it("is bounded, keeps the audit's verdict, and carries only the two Turso secrets", () => {
    expect(step!.if).toBe("${{ !cancelled() }}");
    expect(step!["timeout-minutes"]).toBe(10);
    expect(step!["continue-on-error"]).toBe(true);
    expect(Object.keys(step!.env ?? {}).sort()).toEqual(["TURSO_AUTH_TOKEN", "TURSO_DATABASE_URL"]);
  });
});

describe("roster-urls CLI registration", () => {
  it("passes both flags through to the command", () => {
    const bin = readFileSync(join(repoRoot, "src/cli/bin.ts"), "utf-8");
    const start = bin.indexOf('"roster-urls"');
    expect(start).toBeGreaterThan(-1);
    const rest = bin.slice(start);
    const end = rest.indexOf("\ncli\n");
    const block = end === -1 ? rest : rest.slice(0, end);
    expect(block).toContain('.option("--fleet"');
    expect(block).toContain('.option("--write-back"');
    expect(block).toMatch(/fleet:\s*opts\.fleet,/);
    expect(block).toMatch(/writeBack:\s*opts\.writeBack,/);
  });
});
