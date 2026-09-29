/**
 * #907 review. The CLI gives a reserved slot back only if no PAID stage has
 * started, so every pipeline stage needs a paid/free verdict. `STAGE_COST` is
 * typed `satisfies Record<StageName, …>`, which makes `tsc` fail on a stage
 * with no verdict; this checks the same thing at test time, against the
 * `StageName` union as written in pipeline.ts, so the suite fails too.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { STAGE_COST } from "../../src/cli/commands/prospect-audit.js";

const pipelineSource = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "../../src/prospect/pipeline.ts"),
  "utf-8",
);

/** The string literals of `export type StageName = | "a" | "b" …;`. */
function stageNamesInPipeline(source: string): string[] {
  const m = /export type StageName\s*=([^;]+);/.exec(source);
  if (!m) throw new Error("pipeline.ts no longer declares `export type StageName = …;`");
  return [...m[1]!.matchAll(/"([^"]+)"/g)].map((x) => x[1]!).sort();
}

describe("every pipeline stage is classified paid or free", () => {
  it("the parser reads the union (positive control)", () => {
    // A parse that found nothing would make the check below pass vacuously.
    expect(stageNamesInPipeline(pipelineSource)).toContain("analyze");
    expect(stageNamesInPipeline(pipelineSource).length).toBeGreaterThan(5);
  });

  it("STAGE_COST names exactly the stages pipeline.ts declares", () => {
    expect(Object.keys(STAGE_COST).sort()).toEqual(stageNamesInPipeline(pipelineSource));
  });

  it("the parser would catch an unclassified stage (negative control)", () => {
    const withNewStage = pipelineSource.replace(
      /export type StageName\s*=/,
      'export type StageName =\n  | "newPaidThing"',
    );
    expect(stageNamesInPipeline(withNewStage)).not.toEqual(Object.keys(STAGE_COST).sort());
  });

  it("the paid stages are exactly the three that bill per call", () => {
    const paid = Object.entries(STAGE_COST)
      .filter(([, c]) => c === "paid")
      .map(([n]) => n)
      .sort();
    expect(paid).toEqual(["accuracy", "analyze", "probes"]);
  });
});
