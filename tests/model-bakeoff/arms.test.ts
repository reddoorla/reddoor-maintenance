import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as prettier from "prettier";
import {
  readOnlyRules,
  validateArm,
  validateArms,
  validateRun,
  workDir,
} from "../../scripts/model-bakeoff/lib/arms.mjs";
import { extractArgs } from "../../scripts/model-bakeoff/bakeoff.mjs";
import * as census from "../../scripts/model-bakeoff/tasks/t5-census.mjs";

const LIB = fileURLToPath(new URL("../../scripts/model-bakeoff/lib/arms.mjs", import.meta.url));
const WORKFLOW = fileURLToPath(
  new URL("../../.claude/workflows/model-bakeoff.workflow.js", import.meta.url),
);

describe("validateArms", () => {
  it("accepts arms that each name a model and an effort", () => {
    expect(validateArms(census.arms)).toEqual([]);
    expect(validateArm(census.gold, "gold")).toEqual([]);
  });

  it("refuses an arm with no effort, because it would inherit the session's", () => {
    const errors = validateArms([{ id: "haiku-1", model: "haiku" }]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/has no effort/);
    expect(validateArms([{ id: "h", model: "haiku", effort: "" }])[0]).toMatch(/has no effort/);
  });

  it("refuses an effort the client does not have, a missing model, a bad or repeated id", () => {
    expect(validateArms([{ id: "h", model: "haiku", effort: "default" }])[0]).toMatch(/not one of/);
    expect(validateArms([{ id: "h", model: "", effort: "low" }])[0]).toMatch(/no model/);
    expect(validateArms([{ id: "H 1", model: "haiku", effort: "low" }])[0]).toMatch(/must match/);
    const twice = { id: "h", model: "haiku", effort: "low" };
    expect(validateArms([twice, twice])).toEqual(["arm id h is used twice"]);
    expect(validateArms([{ id: "gold", model: "opus", effort: "high" }])).toEqual([
      'arm id "gold" is reserved',
    ]);
    expect(validateArms([])).toEqual(["arms must be a non-empty array"]);
  });

  it("makes the harness refuse to build a run with an effortless arm", () => {
    const arms = [{ id: "haiku-1", model: "haiku" }];
    expect(() => extractArgs(census, "/tmp/x", arms)).toThrow(/has no effort/);
    expect(extractArgs(census, "/tmp/x").arms).toEqual(census.arms);
  });

  it("requires the gold's id to be gold", () => {
    const arm = { id: "opus-low-1", model: "opus", effort: "low" };
    expect(validateRun([arm], { ...arm })).toEqual(['gold id must be "gold", not "opus-low-1"']);
    expect(validateRun(census.arms, census.gold)).toEqual([]);
  });

  it("gives every arm its own work dir beside the frozen input", () => {
    const args = extractArgs(census, "/run/input");
    expect(args.work).toBe("/run/work");
    expect(readOnlyRules("/run/input", workDir("/run/work", "haiku-low-1"))).toContain(
      "Your own scratch directory is /run/work/haiku-low-1.",
    );
  });
});

describe("the workflow's inline copy", () => {
  const START = "// --8<-- shared-with-workflow START";
  const END = "// --8<-- shared-with-workflow END";
  const between = (src: string) => {
    const a = src.indexOf(START);
    const b = src.indexOf(END);
    expect(a).toBeGreaterThan(-1);
    expect(b).toBeGreaterThan(a);
    return src.slice(a + START.length, b);
  };

  it("matches lib/arms.mjs character for character, export stripped", () => {
    const lib = between(readFileSync(LIB, "utf8")).replace(/^export /gm, "");
    expect(between(readFileSync(WORKFLOW, "utf8"))).toBe(lib);
  });

  it("validates every arm and the gold before the first agent call", () => {
    const src = readFileSync(WORKFLOW, "utf8");
    const refuse = src.indexOf("validateRun(args.arms, args.gold)");
    expect(refuse).toBeGreaterThan(src.indexOf(END));
    expect(src.indexOf("return { refused: errors }")).toBeGreaterThan(refuse);
    expect(src.indexOf("agent(", src.indexOf(END))).toBeGreaterThan(refuse);
    expect(src).toContain("model: a.model");
    expect(src).toContain("effort: a.effort");
  });

  it("uses no clock and no module loader", () => {
    const src = readFileSync(WORKFLOW, "utf8").replace(/^\s*\/\/.*$/gm, "");
    expect(src).not.toMatch(/Date\.now\(|Math\.random\(|new Date\(\)/);
    expect(src).not.toMatch(/^import .* from |require\(/m);
  });

  it("is Prettier-clean", async () => {
    const src = readFileSync(WORKFLOW, "utf8");
    const opts = (await prettier.resolveConfig(WORKFLOW)) ?? {};
    expect(await prettier.format(src, { ...opts, filepath: WORKFLOW })).toBe(src);
  });
});
