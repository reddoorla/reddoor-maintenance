import { describe, it, expect } from "vitest";
import {
  exitCodeFor,
  formatOutcome,
  parseDesignRulesArgs,
} from "../../../src/audits/design-rules/cli.js";
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

  it("refuses an unknown option rather than reading it as a url", () => {
    expect(parseDesignRulesArgs(["u", "--jsno"])).toEqual({ error: "unknown option --jsno" });
  });

  it("exits 1 on any fail, else 2 on any unmeasured or nothing run, else 0", () => {
    expect(exitCodeFor([outcome("pass"), outcome("fail"), outcome("unmeasured")])).toBe(1);
    expect(exitCodeFor([outcome("pass"), outcome("unmeasured")])).toBe(2);
    expect(exitCodeFor([])).toBe(2);
    expect(exitCodeFor([outcome("pass"), outcome("pass")])).toBe(0);
  });
});

describe("formatOutcome", () => {
  it("prints each problem once, worst first, with a count and three paths", () => {
    const d = "transition-duration 300ms under reduce (at 1440px)";
    const lines = formatOutcome({
      rule: "R2",
      url: "u",
      status: "fail",
      note: "n",
      findings: [
        ...["a", "b", "c", "d"].map((target) => ({ target, problem: d })),
        { target: "e", problem: "transition-delay 1000ms under reduce (at 1440px)" },
        { target: "f", problem: "animation w still running under reduce (no end) (at 1440px)" },
      ],
    });
    expect(lines).toEqual([
      "FAIL R2 u: n",
      "  - animation w still running under reduce (no end) (at 1440px)",
      "      f",
      "  - transition-delay 1000ms under reduce (at 1440px)",
      "      e",
      `  - 4× ${d}`,
      "      a",
      "      b",
      "      c",
      "      (+1 more)",
    ]);
  });

  it("ranks motion a reader sees now above a delay, and a delay above a duration", () => {
    const now = [
      "moved by script, frame by frame, under reduce (at 1440px)",
      "moved by script with the scroll (parallax) under reduce (at 1440px)",
      "playing video under reduce (at 1440px)",
      "smooth scrolling under reduce (at 1440px)",
      "animation r paused short of its end under reduce (400ms left) (at 1440px)",
    ];
    const problems = [
      "transition-duration 300ms under reduce (at 1440px)",
      "animation-delay 900ms under reduce (at 1440px)",
      ...now,
    ];
    const lines = formatOutcome({
      ...outcome("fail"),
      findings: problems.map((problem, i) => ({ target: `t${i}`, problem })),
    }).filter((l) => l.startsWith("  - "));
    expect(
      lines
        .slice(0, now.length)
        .map((l) => l.slice(4))
        .sort(),
    ).toEqual([...now].sort());
    expect(lines.slice(now.length).map((l) => l.slice(4))).toEqual(problems.slice(0, 2).reverse());
  });
});
