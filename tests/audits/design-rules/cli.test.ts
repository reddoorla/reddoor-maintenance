import { describe, it, expect } from "vitest";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
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
      rules: ["R2", "R9", "R12"],
      json: false,
    });
  });

  it("refuses an unknown rule, a name only the prototype has, and no url", () => {
    expect(parseDesignRulesArgs(["u", "--rule", "R99"])).toEqual({
      error: "unknown rule R99; known: R2, R9, R12",
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

/**
 * The CLI, run as the operator runs it: under tsx, whose keep-names transform
 * wraps a named inner function in `__name(...)`. The in-page samplers must
 * have none, and vitest's transform does not add the wrapper, so only a run
 * under tsx can see a breach: R4's first live run was UNMEASURED on every
 * page with "__name is not defined" while its whole suite was green (that
 * check, R4, is parked in reddoorla/reddoor-maintenance#1579).
 */
describe("design-rules CLI under tsx", () => {
  it("runs every rule on a plain page and passes it", async () => {
    const server = createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(
        `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>CLI</title></head><body><main><h1>Plain</h1><p>Text and <a href="#x">a link</a></p></main></body></html>`,
      );
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
      const root = fileURLToPath(new URL("../../../", import.meta.url));
      const tsx = fileURLToPath(new URL("../../../node_modules/.bin/tsx", import.meta.url));
      // A failing CLI exits 1 or 2; its JSON on stdout says why.
      const { stdout } = await promisify(execFile)(
        tsx,
        ["scripts/design-rules.mts", "--json", url],
        { cwd: root, timeout: 120_000 },
      ).catch((error: { stdout?: string }) => ({ stdout: error.stdout ?? "[]" }));
      const outcomes = JSON.parse(stdout) as Array<{ rule: string; status: string; note: string }>;
      expect(outcomes.map((o) => `${o.rule} ${o.status}`)).toEqual([
        "R2 pass",
        "R9 pass",
        "R12 pass",
      ]);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }, 150_000);

  it("finds no keep-names wrapper in any in-page function, in branches a plain page never reaches", async () => {
    const root = fileURLToPath(new URL("../../../", import.meta.url));
    const tsx = fileURLToPath(new URL("../../../node_modules/.bin/tsx", import.meta.url));
    const probe = [
      `const fns = {`,
      `  sampleReducedMotion: (await import("./src/audits/design-rules/reduced-motion.ts")).sampleReducedMotion,`,
      `  sampleOutline: (await import("./src/audits/design-rules/heading-levels.ts")).sampleOutline,`,
      `  describeFocus: (await import("./src/audits/design-rules/focus-ring.ts")).describeFocus,`,
      `  scrollRest: (await import("./src/audits/design-rules/focus-ring.ts")).scrollRest,`,
      `  revealBelowFold: (await import("./src/audits/util/reveal-below-fold.ts")).revealBelowFold,`,
      `};`,
      `console.log(JSON.stringify(Object.entries(fns).filter(([, f]) => String(f).includes("__name")).map(([n]) => n)));`,
    ].join("\n");
    const { stdout } = await promisify(execFile)(tsx, ["--input-type=module", "-e", probe], {
      cwd: root,
      timeout: 60_000,
    });
    expect(JSON.parse(stdout.trim().split("\n").pop()!)).toEqual([]);
  }, 90_000);
});
