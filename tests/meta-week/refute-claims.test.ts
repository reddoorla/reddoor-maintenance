import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  CHORE_MODEL,
  CLAIM_FLOOR,
  DEFAULT_CHUNK,
  DEFAULT_MODEL,
  MEASURED_ROUND,
  TOKENS_PER_CLAIM,
  chunkClaims,
  enforceQuoteRule,
  estimateRound,
  formatEstimate,
  parseEvidenceRef,
  validateClaims,
} from "../../scripts/meta-week/lib/refute-claims.mjs";

const LIB = fileURLToPath(
  new URL("../../scripts/meta-week/lib/refute-claims.mjs", import.meta.url),
);
const WORKFLOW = fileURLToPath(
  new URL("../../.claude/workflows/refute-claims.workflow.js", import.meta.url),
);
const LEVERS = fileURLToPath(
  new URL("../../docs/meta-week/_data/refute-claims-levers.json", import.meta.url),
);
const SEEDED = fileURLToPath(
  new URL("../../docs/meta-week/_data/refute-claims-levers-seeded.json", import.meta.url),
);

const claim = (over: Record<string, unknown> = {}) => ({
  id: "c1",
  claim: "a thing is so",
  evidence: ["docs/a.md:10-20"],
  ...over,
});

describe("parseEvidenceRef", () => {
  it("takes path:line and path:line-line, absolute or relative", () => {
    expect(parseEvidenceRef("docs/a.md:10")).toEqual({ path: "docs/a.md", from: 10, to: 10 });
    expect(parseEvidenceRef("docs/a.md:10-20")).toEqual({ path: "docs/a.md", from: 10, to: 20 });
    expect(parseEvidenceRef("  /tmp/x/hooks.md:3030  ")).toEqual({
      path: "/tmp/x/hooks.md",
      from: 3030,
      to: 3030,
    });
  });

  it("rejects a citation that names no line, and a backwards or zero range", () => {
    // The whole point of the round: "read hooks.md" is not a citation.
    expect(parseEvidenceRef("docs/a.md")).toBeNull();
    expect(parseEvidenceRef("docs/a.md:")).toBeNull();
    expect(parseEvidenceRef(":10")).toBeNull();
    expect(parseEvidenceRef("docs/a.md:20-10")).toBeNull();
    expect(parseEvidenceRef("docs/a.md:0")).toBeNull();
    expect(parseEvidenceRef(42 as unknown as string)).toBeNull();
  });
});

describe("validateClaims", () => {
  it("accepts a well-formed package and parses each reference once", () => {
    const { claims, errors } = validateClaims([claim(), claim({ id: "c2" })]);
    expect(errors).toEqual([]);
    expect(claims).toHaveLength(2);
    expect(claims[0]!.id).toBe("c1");
    expect(claims[0]!.refs[0]).toEqual({ path: "docs/a.md", from: 10, to: 20 });
  });

  it("rejects a non-array, an empty array, and a non-object entry", () => {
    expect(validateClaims({} as unknown[]).errors[0]).toMatch(/must be a JSON array/);
    expect(validateClaims([]).errors[0]).toMatch(/empty/);
    expect(validateClaims([null]).errors[0]).toMatch(/not an object/);
    expect(validateClaims(["a claim"]).errors[0]).toMatch(/not an object/);
  });

  it("names the claim that is wrong, by id", () => {
    const { errors } = validateClaims([claim({ id: "good" }), claim({ id: "bad", evidence: [] })]);
    expect(errors).toHaveLength(1);
    expect(errors[0]!).toContain("bad");
    expect(errors[0]!).toMatch(/evidence must be a non-empty array/);
  });

  it("catches a duplicate id, an empty claim, and an evidence ref with no line", () => {
    expect(validateClaims([claim(), claim()]).errors[0]!).toMatch(/duplicate id/);
    expect(validateClaims([claim({ claim: "   " })]).errors[0]!).toMatch(/non-empty string/);
    expect(validateClaims([claim({ id: "", claim: "x" })]).errors[0]!).toMatch(/id must be/);
    const bad = validateClaims([claim({ evidence: ["docs/a.md"] })]);
    expect(bad.errors[0]!).toMatch(/evidence\[0\] is not "path:line"/);
  });

  it("returns NO claims when any claim is invalid — a partly-valid package is not a package", () => {
    const { claims, errors } = validateClaims([
      claim({ id: "good" }),
      claim({ id: "bad", evidence: [] }),
    ]);
    expect(errors).toHaveLength(1);
    expect(claims).toEqual([]);
  });
});

describe("chunkClaims", () => {
  const items = [1, 2, 3, 4, 5, 6, 7];

  it("splits in order, with a short final chunk", () => {
    expect(chunkClaims(items, 3)).toEqual([[1, 2, 3], [4, 5, 6], [7]]);
    expect(chunkClaims(items, 1)).toEqual([[1], [2], [3], [4], [5], [6], [7]]);
    expect(chunkClaims(items, 100)).toEqual([items]);
  });

  it("defaults to 3 and covers every item exactly once", () => {
    const chunks = chunkClaims(items);
    expect(chunks).toEqual(chunkClaims(items, DEFAULT_CHUNK));
    expect(chunks.flat()).toEqual(items);
  });

  it("returns nothing for an empty package and throws on a nonsense chunk", () => {
    expect(chunkClaims([], 3)).toEqual([]);
    expect(() => chunkClaims(items, 0)).toThrow(/positive integer/);
    expect(() => chunkClaims(items, -1)).toThrow(/positive integer/);
    expect(() => chunkClaims(items, 2.5)).toThrow(/positive integer/);
  });
});

describe("estimateRound", () => {
  it("reproduces the one round that was actually measured", () => {
    // 31 claims cost 1,981,897 subagent tokens across 32 agents (census-refute.json).
    const est = estimateRound(MEASURED_ROUND.claims, 4);
    expect(est.subagentTokens).toBe(MEASURED_ROUND.subagentTokens);
    expect(est.tokensPerClaim).toBe(Math.round(TOKENS_PER_CLAIM));
    expect(est.tokensPerClaim).toBe(63932);
    // The measured round's 32 agents were 31 skeptics + 1 critic; this script adds a guard.
    expect(est.agents).toBe(MEASURED_ROUND.agents + 1);
  });

  it("scales linearly and counts guard + skeptics + critic", () => {
    const est = estimateRound(16, 3);
    expect(est.claims).toBe(16);
    expect(est.skeptics).toBe(16);
    expect(est.agents).toBe(18);
    expect(est.chunks).toBe(6);
    expect(est.subagentTokens).toBe(Math.round(TOKENS_PER_CLAIM * 16));
    expect(est.subagentTokens).toBe(1022915);
    expect(est.belowFloor).toBe(false);
  });

  it("flags a package below R4's ~10-claim floor", () => {
    expect(estimateRound(CLAIM_FLOOR).belowFloor).toBe(false);
    expect(estimateRound(CLAIM_FLOOR - 1).belowFloor).toBe(true);
    expect(formatEstimate(estimateRound(4))).toMatch(/below the ~10-claim floor/);
    expect(formatEstimate(estimateRound(16))).not.toMatch(/below the/);
  });

  it("names the cost, the agent count and the basis in one log line", () => {
    const line = formatEstimate(estimateRound(16, 3));
    expect(line).toContain("16 claims");
    expect(line).toContain("18 agents");
    expect(line).toContain("6 chunk(s) of 3");
    expect(line).toContain("1.02M");
    expect(line).toContain(MEASURED_ROUND.source);
  });

  it("throws rather than guessing on bad input", () => {
    expect(() => estimateRound(-1)).toThrow(/non-negative integer/);
    expect(() => estimateRound(1.5)).toThrow(/non-negative integer/);
    expect(() => estimateRound(10, 0)).toThrow(/positive integer/);
  });
});

describe("enforceQuoteRule", () => {
  const c = claim({ evidence: ["/tmp/docs/hooks.md:3013-3034", "docs/a.md:1-5"] });
  const confirmed = {
    id: "c1",
    verdict: "confirmed",
    reason: "the line says so",
    quote: "Claude Code discards a PreCompact hook's `systemMessage`",
    quoteSource: "/tmp/docs/hooks.md:3030",
  };

  it("lets a confirmation through when it quotes a line on the claim's own evidence", () => {
    const out = enforceQuoteRule(confirmed, c);
    expect(out.verdict).toBe("confirmed");
    expect(out.downgraded).toBe(false);
  });

  it("matches a repo-relative quoteSource against an absolute evidence path, and back", () => {
    expect(enforceQuoteRule({ ...confirmed, quoteSource: "hooks.md:3030" }, c).verdict).toBe(
      "confirmed",
    );
    expect(enforceQuoteRule({ ...confirmed, quoteSource: "/repo/docs/a.md:3" }, c).verdict).toBe(
      "confirmed",
    );
  });

  it("downgrades a confirmation with no quote", () => {
    const out = enforceQuoteRule({ ...confirmed, quote: "  " }, c);
    expect(out.verdict).toBe("unclear");
    expect(out.downgraded).toBe(true);
    expect(out.downgradeReason).toMatch(/no verbatim quote/);
  });

  it("downgrades a confirmation whose quoteSource names no line", () => {
    const out = enforceQuoteRule({ ...confirmed, quoteSource: "hooks.md" }, c);
    expect(out.verdict).toBe("unclear");
    expect(out.downgradeReason).toMatch(/no file:line quoteSource/);
  });

  it("downgrades a confirmation quoting a file that is not the claim's evidence", () => {
    const out = enforceQuoteRule({ ...confirmed, quoteSource: "/tmp/docs/env-vars.md:12" }, c);
    expect(out.verdict).toBe("unclear");
    expect(out.downgradeReason).toMatch(/not one of the claim's evidence paths/);
  });

  it("leaves refuted and unclear alone — refuted is the round's default, not a privilege", () => {
    const refuted = { ...confirmed, verdict: "refuted", quote: "", quoteSource: "" };
    expect(enforceQuoteRule(refuted, c)).toEqual({ ...refuted, downgraded: false });
    const unclear = { ...confirmed, verdict: "unclear", quote: "", quoteSource: "" };
    expect(enforceQuoteRule(unclear, c).verdict).toBe("unclear");
  });

  it("downgrades rather than throwing when the claim is missing entirely", () => {
    expect(enforceQuoteRule(confirmed, undefined).verdict).toBe("unclear");
  });
});

describe("the workflow script carries the lib's rules verbatim", () => {
  const START = "// --8<-- shared-with-workflow START";
  const END = "// --8<-- shared-with-workflow END";
  const between = (src: string, where: string) => {
    const a = src.indexOf(START);
    const b = src.indexOf(END);
    expect(a, `${where}: no START sentinel`).toBeGreaterThan(-1);
    expect(b, `${where}: no END sentinel`).toBeGreaterThan(a);
    return src.slice(a + START.length, b);
  };

  it("has not drifted — a workflow script has no module loader, so the block is pasted", () => {
    const lib = between(readFileSync(LIB, "utf8"), "lib").replace(/^export /gm, "");
    const wf = between(readFileSync(WORKFLOW, "utf8"), "workflow");
    expect(wf).toBe(lib);
  });

  it("names both control invocations and the scriptPath that runs them", () => {
    const src = readFileSync(WORKFLOW, "utf8");
    expect(src).toContain(".claude/workflows/refute-claims.workflow.js");
    expect(src).toContain("docs/meta-week/_data/refute-claims-levers.json");
    expect(src).toContain("docs/meta-week/_data/refute-claims-levers-seeded.json");
  });

  it("pins the model on every agent call rather than inheriting the session's", () => {
    // R4 specifies one Opus skeptic per claim, and the cost figure is an Opus cost. A call
    // with no `model` inherits the session model — routinely Fable — and would change both
    // silently, which is precisely the class of unread mechanism this round exists to catch.
    const src = readFileSync(WORKFLOW, "utf8").replace(/^\s*\/\/.*$/gm, "");
    expect(DEFAULT_MODEL).toBe("opus");
    expect(CHORE_MODEL).toBe("haiku");
    expect(src).toContain("const model = args?.model ?? DEFAULT_MODEL;");
    // guard + loader judge nothing; skeptics + critic take args.model.
    expect(src.match(/model: CHORE_MODEL/g)).toHaveLength(2);
    expect(src.match(/schema: (VERDICT|CRITIQUE), model \}/g)).toHaveLength(2);
    // Every agent() call site carries a model — none is left to inherit.
    expect(src.match(/\bagent\(/g)).toHaveLength(4);
  });

  it("reads origin/main by full refspec, never by the ambiguous glob", () => {
    // `git ls-remote origin main` returns two lines on this repo and the wrong one first:
    // refs/heads/changeset-release/main sorts above refs/heads/main. A guard taking "the
    // first line" compares against the release branch and fails a checkout that IS at
    // main's head — the exact false alarm this whole stage exists to prevent.
    const src = readFileSync(WORKFLOW, "utf8");
    expect(src).toContain("git ls-remote origin refs/heads/main");
    expect(src).toContain("SECOND field is exactly");
    // The defect, verbatim, as it was written the first time.
    expect(src).not.toContain("report the 40-char sha in its first field");
    // And the two-ref output stays in the file as the reason.
    expect(src).toContain("refs/heads/changeset-release/main");
  });

  it("uses no clock and no Node API — both are unavailable to a workflow script", () => {
    const src = readFileSync(WORKFLOW, "utf8").replace(/^\s*\/\/.*$/gm, "");
    expect(src).not.toMatch(/Date\.now\(|Math\.random\(|new Date\(\)/);
    expect(src).not.toMatch(/^import .* from |require\(/m);
  });
});

describe("the two control inputs", () => {
  const levers = JSON.parse(readFileSync(LEVERS, "utf8")) as unknown[];
  const seeded = JSON.parse(readFileSync(SEEDED, "utf8")) as { id: string }[];

  it("both validate, and the PASS control clears R4's ~10-claim floor", () => {
    expect(validateClaims(levers).errors).toEqual([]);
    expect(validateClaims(seeded).errors).toEqual([]);
    expect(levers.length).toBe(16);
    expect(estimateRound(levers.length).belowFloor).toBe(false);
  });

  it("the FAIL control is the PASS control plus exactly one seeded claim", () => {
    // The whole discriminator: if anything else differs, a verdict delta proves nothing.
    expect(seeded.slice(0, levers.length)).toEqual(levers);
    expect(seeded).toHaveLength(levers.length + 1);
    expect(seeded[seeded.length - 1]!.id).toBe("seed-1");
  });

  it("the PASS control carries the hook-contract claim the round must refute", () => {
    const ids = (levers as { id: string }[]).map((c) => c.id);
    expect(ids).toContain("earlier-precompact-inject");
    // And true claims it must NOT refute — the half a default-refuted round can fail.
    expect(ids.filter((id) => id.startsWith("lever-"))).toHaveLength(10);
    expect(ids.filter((id) => id.startsWith("earlier-"))).toHaveLength(6);
  });
});
