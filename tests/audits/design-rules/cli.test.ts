import { describe, it, expect } from "vitest";
import { exitCodeFor, parseDesignRulesArgs } from "../../../src/audits/design-rules/cli.js";
import type { RuleOutcome } from "../../../src/audits/design-rules/types.js";

const outcome = (status: RuleOutcome["status"]): RuleOutcome => ({
  rule: "R2",
  url: "u",
  status,
  findings: [],
  note: "",
});

describe("design-rules CLI", () => {
  it("reads urls, --rule and --json", () => {
    expect(parseDesignRulesArgs(["https://a/", "--rule", "R2", "--json"])).toEqual({
      urls: ["https://a/"],
      rules: ["R2"],
      json: true,
    });
  });

  it("runs every rule when none is named", () => {
    expect(parseDesignRulesArgs(["https://a/"])).toEqual({
      urls: ["https://a/"],
      rules: ["R2"],
      json: false,
    });
  });

  it("refuses an unknown rule, a name only the prototype has, and no url", () => {
    expect(parseDesignRulesArgs(["u", "--rule", "R99"])).toEqual({
      error: "unknown rule R99; known: R2",
    });
    expect(parseDesignRulesArgs(["u", "--rule", "toString"])).toHaveProperty("error");
    expect(parseDesignRulesArgs(["u", "--rule"])).toHaveProperty("error");
    expect(parseDesignRulesArgs([])).toHaveProperty("error");
  });

  it("exits 1 on any fail, else 2 on any unmeasured or nothing run, else 0", () => {
    expect(exitCodeFor([outcome("pass"), outcome("fail"), outcome("unmeasured")])).toBe(1);
    expect(exitCodeFor([outcome("pass"), outcome("unmeasured")])).toBe(2);
    expect(exitCodeFor([])).toBe(2);
    expect(exitCodeFor([outcome("pass"), outcome("pass")])).toBe(0);
  });
});
