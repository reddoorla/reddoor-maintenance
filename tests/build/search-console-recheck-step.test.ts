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

describe("fleet-lighthouse › Re-check Search Console no-property sites to Turso (P1-48)", () => {
  const all = steps();
  const step = all.find((s) => s.name === "Re-check Search Console no-property sites to Turso");

  it("runs the fleet write-back after the build", () => {
    expect(step).toBeDefined();
    expect(step!.run).toContain("node dist/cli/bin.js search-console-recheck --fleet --write-back");
    expect(all.findIndex((s) => s.run?.includes("pnpm build"))).toBeLessThan(all.indexOf(step!));
  });

  it("is bounded, keeps the audit's verdict, and carries Turso plus the GA key the draft uses", () => {
    expect(step!.if).toBe("${{ !cancelled() }}");
    expect(step!["timeout-minutes"]).toBe(10);
    expect(step!["continue-on-error"]).toBe(true);
    expect(Object.keys(step!.env ?? {}).sort()).toEqual([
      "GA_SA_KEY_JSON",
      "GA_SA_KEY_PATH",
      "GA_SUBJECT",
      "TURSO_AUTH_TOKEN",
      "TURSO_DATABASE_URL",
    ]);
    expect(step!.env!.GA_SA_KEY_PATH).toBe("${{ runner.temp }}/ga-service-account.json");
  });

  it("writes the key without echoing it", () => {
    expect(step!.run).toContain(`printf '%s' "$GA_SA_KEY_JSON" > "$GA_SA_KEY_PATH"`);
    expect(step!.run).not.toMatch(/set -x|echo .*GA_SA_KEY_JSON/);
  });

  it("is the only fleet-lighthouse step that sees the GA key", () => {
    const withKey = all.filter((s) => s.env && "GA_SA_KEY_JSON" in s.env);
    expect(withKey.map((s) => s.name)).toEqual([step!.name]);
  });
});

describe("search-console-recheck CLI registration", () => {
  it("passes both flags through to the command", () => {
    const bin = readFileSync(join(repoRoot, "src/cli/bin.ts"), "utf-8");
    const start = bin.indexOf('"search-console-recheck"');
    expect(start).toBeGreaterThan(-1);
    const rest = bin.slice(start);
    const end = rest.indexOf("\ncli\n");
    const block = end === -1 ? rest : rest.slice(0, end);
    expect(block).toContain('.option("--fleet"');
    expect(block).toContain('"--write-back"');
    expect(block).toMatch(/fleet:\s*opts\.fleet,/);
    expect(block).toMatch(/writeBack:\s*opts\.writeBack,/);
  });
});
