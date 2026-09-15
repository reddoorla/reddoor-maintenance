import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import * as prettier from "prettier";
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
  formatEvidenceRef,
  parseEvidenceRef,
  resolveEvidencePath,
  resolveEvidenceRef,
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
const EXPECTED_FILE = fileURLToPath(
  new URL("../../docs/meta-week/_data/refute-claims-levers.expected.json", import.meta.url),
);
const SEEDED = fileURLToPath(
  new URL("../../docs/meta-week/_data/refute-claims-levers-seeded.json", import.meta.url),
);
const MANIFEST = fileURLToPath(
  new URL("../../docs/meta-week/_data/refute-claims-corpus.manifest.json", import.meta.url),
);
const GITIGNORE = fileURLToPath(new URL("../../.gitignore", import.meta.url));
const CORPUS_DIR = "docs/meta-week/_corpus/";

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

describe("resolving a relative evidence path against the evidence checkout", () => {
  // The packages cite the docs corpus repo-relative because it is re-fetched per checkout
  // and absolute in none of them. The first version hard-coded one session's scratchpad.
  const ROOT = "/Users/x/repo";

  it("joins a repo-relative path onto repoRoot and leaves an absolute one alone", () => {
    expect(resolveEvidencePath("docs/meta-week/_corpus/hooks.md", ROOT)).toBe(
      "/Users/x/repo/docs/meta-week/_corpus/hooks.md",
    );
    expect(resolveEvidencePath("/private/tmp/scratch/hooks.md", ROOT)).toBe(
      "/private/tmp/scratch/hooks.md",
    );
  });

  it("is a no-op without a repoRoot, so an un-guarded caller behaves as it did before", () => {
    expect(resolveEvidencePath("docs/a.md", undefined)).toBe("docs/a.md");
    expect(resolveEvidencePath("docs/a.md", "")).toBe("docs/a.md");
  });

  it("tolerates a trailing slash on repoRoot and a leading ./ on the path", () => {
    expect(resolveEvidencePath("./docs/a.md", "/r/")).toBe("/r/docs/a.md");
    expect(resolveEvidencePath("docs/a.md", "/r//")).toBe("/r/docs/a.md");
  });

  it("keeps the line range when it resolves, and formats it back", () => {
    expect(resolveEvidenceRef("docs/a.md:10-20", ROOT)).toEqual({
      path: "/Users/x/repo/docs/a.md",
      from: 10,
      to: 20,
    });
    expect(formatEvidenceRef("docs/a.md:10-20", ROOT)).toBe("/Users/x/repo/docs/a.md:10-20");
    expect(formatEvidenceRef("docs/a.md:10", ROOT)).toBe("/Users/x/repo/docs/a.md:10");
    expect(formatEvidenceRef("/abs/a.md:7", ROOT)).toBe("/abs/a.md:7");
  });

  it("passes an unparseable citation through verbatim rather than dropping it", () => {
    // A skeptic told to report what it could not read is better served by a bad line than
    // by a silently missing one.
    expect(resolveEvidenceRef("docs/a.md", ROOT)).toBeNull();
    expect(formatEvidenceRef("docs/a.md", ROOT)).toBe("docs/a.md");
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
  it("predicts both of the rounds it was fitted to, within 2%", () => {
    // The controls, 2026-09-14: 16 claims / 1,244,652 tokens / 19 agents, and
    // 17 / 1,342,927 / 20. The census round's 63,932/claim under-predicted both by ~20%.
    expect(TOKENS_PER_CLAIM).toBe(78000);
    const pass = estimateRound(MEASURED_ROUND.passClaims, 3);
    expect(pass.agents).toBe(MEASURED_ROUND.passAgents);
    expect(
      Math.abs(pass.subagentTokens - MEASURED_ROUND.passSubagentTokens) /
        MEASURED_ROUND.passSubagentTokens,
    ).toBeLessThan(0.02);
    const fail = estimateRound(MEASURED_ROUND.failClaims, 3);
    expect(fail.agents).toBe(MEASURED_ROUND.failAgents);
    expect(
      Math.abs(fail.subagentTokens - MEASURED_ROUND.failSubagentTokens) /
        MEASURED_ROUND.failSubagentTokens,
    ).toBeLessThan(0.02);
    // The old basis would have been out by far more than that.
    expect(Math.abs(63932 * 16 - MEASURED_ROUND.passSubagentTokens) / 1244652).toBeGreaterThan(
      0.15,
    );
  });

  it("scales linearly and counts guard + loader + skeptics + critic", () => {
    const est = estimateRound(16, 3);
    expect(est.claims).toBe(16);
    expect(est.skeptics).toBe(16);
    expect(est.agents).toBe(19);
    expect(est.chunks).toBe(6);
    expect(est.subagentTokens).toBe(TOKENS_PER_CLAIM * 16);
    expect(est.subagentTokens).toBe(1248000);
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
    expect(line).toContain("19 agents");
    expect(line).toContain("6 chunk(s) of 3");
    expect(line).toContain("1.25M");
    expect(line).toContain(MEASURED_ROUND.basis);
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

  it("resolves both sides against repoRoot, so a corpus citation matches what a skeptic opened", () => {
    // The real shape: the claim cites the corpus repo-relative, the skeptic opens the file
    // and reports the absolute path it actually read. These must be the same path.
    const root = "/Users/x/repo";
    const corpus = claim({ evidence: ["docs/meta-week/_corpus/hooks.md:1356-1378"] });
    const v = {
      ...confirmed,
      quoteSource: "/Users/x/repo/docs/meta-week/_corpus/hooks.md:1360",
    };
    expect(enforceQuoteRule(v, corpus, root).verdict).toBe("confirmed");
    // And a skeptic that answers relative is accepted the same way.
    expect(
      enforceQuoteRule({ ...v, quoteSource: "docs/meta-week/_corpus/hooks.md:1360" }, corpus, root)
        .verdict,
    ).toBe("confirmed");
    // A different corpus page is still not this claim's evidence, resolved or not.
    expect(
      enforceQuoteRule(
        { ...v, quoteSource: `${root}/docs/meta-week/_corpus/env-vars.md:12` },
        corpus,
        root,
      ).verdict,
    ).toBe("unclear");
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
    // Whitespace-normalised, so Prettier's line wrapping cannot break the assertions.
    const flat = src.replace(/\s+/g, " ");
    expect(DEFAULT_MODEL).toBe("opus");
    expect(CHORE_MODEL).toBe("haiku");
    expect(src).toContain("const model = args?.model ?? DEFAULT_MODEL;");
    // All four call sites, named. The guard and loader judge nothing; the skeptics and
    // the critic take args.model. None is left to inherit the session's.
    expect(src.match(/\bagent\(/g)).toHaveLength(4);
    expect(flat).toContain(
      'label: "guard:evidence-head", phase: "Guard", schema: GUARD, model: CHORE_MODEL, effort: "low"',
    );
    expect(flat).toContain(
      'label: "load:claims", phase: "Load", model: CHORE_MODEL, effort: "low"',
    );
    expect(flat).toContain('label: `refute:${c.id}`, phase: "Refute", schema: VERDICT, model,');
    expect(flat).toContain(
      'label: "completeness-critic", phase: "Critique", schema: CRITIQUE, model }',
    );
  });

  it("is Prettier-clean, whatever .gitignore currently says about .claude/", async () => {
    // Prettier's default --ignore-path includes .gitignore. Before #788 that file carried a
    // blanket `.claude/`, so `prettier --check .` silently SKIPPED this script in a local
    // checkout while CI, building the merge ref against main's un-ignoring .gitignore,
    // checked it — the same command, green locally and red in CI. #788 closed that gap, but
    // one line of .gitignore should not decide whether a tracked file is linted at all, so
    // this asserts the file directly, by path.
    const src = readFileSync(WORKFLOW, "utf8");
    const opts = (await prettier.resolveConfig(WORKFLOW)) ?? {};
    expect(await prettier.format(src, { ...opts, filepath: WORKFLOW })).toBe(src);
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

  it("resolves evidence against the guard's repoRoot at BOTH places a path is used", () => {
    // Handing the skeptic a relative path and then judging its answer against a different
    // one is how a round reads nothing and still returns verdicts. Both call sites take
    // guard.repoRoot, which the guard derives from the claims file's own directory.
    const src = readFileSync(WORKFLOW, "utf8").replace(/^\s*\/\/.*$/gm, "");
    const flat = src.replace(/\s+/g, " ");
    expect(flat).toContain("formatEvidenceRef(e, guard.repoRoot)");
    expect(flat).toContain("enforceQuoteRule(r, byId.get(r.id), guard.repoRoot)");
  });

  it("tells the reader how to regenerate the corpus before a control is run", () => {
    const src = readFileSync(WORKFLOW, "utf8");
    expect(src).toContain("node scripts/meta-week/fetch-corpus.mjs");
    expect(src).toContain("refute-claims-corpus.manifest.json");
    // The point of the note: drift invalidates the anchors, it is not a formality.
    expect(src).toMatch(/drift/i);
  });
});

describe("the docs corpus is re-fetchable, and the manifest says exactly what it was", () => {
  type Page = { name: string; url: string; sha256: string; bytes: number };
  const manifest = JSON.parse(readFileSync(MANIFEST, "utf8")) as {
    fetchedAt: string;
    base: string;
    pages: Page[];
  };

  it("records 40 pages, sorted by name, each with a sha256 and a byte count", () => {
    expect(manifest.fetchedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(manifest.base).toBe("https://code.claude.com/docs/");
    expect(manifest.pages).toHaveLength(40);
    const names = manifest.pages.map((p) => p.name);
    expect(names).toEqual([...names].sort());
    expect(new Set(names).size).toBe(names.length);
    for (const p of manifest.pages) {
      expect(p.sha256, p.name).toMatch(/^[0-9a-f]{64}$/);
      expect(p.bytes, p.name).toBeGreaterThan(0);
      expect(p.url, p.name).toMatch(/^https:\/\/code\.claude\.com\/docs\//);
    }
  });

  it("covers every corpus page the two control packages cite", () => {
    // A claim citing a page the manifest does not carry is a claim whose evidence no
    // fetch can restore — the exact failure the absolute scratchpad paths already were.
    const inManifest = new Set(manifest.pages.map((p) => p.name));
    const levers = JSON.parse(readFileSync(LEVERS, "utf8")) as { evidence: string[] }[];
    const seeded = JSON.parse(readFileSync(SEEDED, "utf8")) as { evidence: string[] }[];
    const cited = new Set<string>();
    for (const c of [...levers, ...seeded]) {
      for (const e of c.evidence) {
        const path = parseEvidenceRef(e)?.path ?? "";
        if (path.startsWith(CORPUS_DIR)) cited.add(path.slice(CORPUS_DIR.length));
      }
    }
    expect(cited.size).toBeGreaterThan(0);
    for (const name of cited) expect(inManifest, name).toContain(name);
  });

  it("is gitignored — the corpus is fetched third-party docs, never committed", () => {
    expect(readFileSync(GITIGNORE, "utf8")).toMatch(/^docs\/meta-week\/_corpus\/$/m);
  });
});

/**
 * The expected verdict for every claim in the two controls. This map is the answer key and
 * it lives HERE and in docs/meta-week/_data/refute-claims-levers.expected.json — never in
 * the claims files themselves, and never in anything the workflow script reads. The first
 * version of these controls encoded the answer in the id (`lever-*` survives, `earlier-*`
 * dies) and the skeptic prompt prints the id, so a skeptic could score without reading a
 * line. The round's own completeness critic caught it. Ids are opaque now; keep them so.
 */
const EXPECTED: Record<string, "confirmed" | "refuted"> = {
  c01: "refuted",
  c02: "confirmed",
  c03: "confirmed",
  c04: "refuted",
  c05: "confirmed",
  c06: "confirmed",
  c07: "refuted", // the hook-contract error R4 names: PreCompact cannot inject context
  c08: "confirmed",
  c09: "refuted",
  c10: "confirmed",
  c11: "confirmed", // same evidence as c04, opposite claim
  c12: "refuted",
  c13: "confirmed",
  c14: "confirmed",
  c15: "refuted",
  c16: "confirmed",
  c17: "refuted", // the seeded claim, present only in the FAIL control
};

describe("the two control inputs", () => {
  type Claim = { id: string; claim: string; evidence: string[] };
  const levers = JSON.parse(readFileSync(LEVERS, "utf8")) as Claim[];
  const seeded = JSON.parse(readFileSync(SEEDED, "utf8")) as Claim[];
  const key = JSON.parse(readFileSync(EXPECTED_FILE, "utf8")) as {
    expected: Record<string, { verdict: string }>;
  };

  it("both validate, and the PASS control clears R4's ~10-claim floor", () => {
    expect(validateClaims(levers).errors).toEqual([]);
    expect(validateClaims(seeded).errors).toEqual([]);
    expect(levers).toHaveLength(16);
    expect(estimateRound(levers.length).belowFloor).toBe(false);
  });

  it("cites its evidence repo-relative, never into a session scratchpad", () => {
    // As shipped in #789 every citation was an absolute path into one session's scratchpad
    // (/private/tmp/claude-501/<session-uuid>/scratchpad/docs/…). That directory dies with
    // the session: every skeptic in any later round would have filled `readFailed`, and the
    // round would have returned sixteen confident findings about files it never opened.
    for (const c of [...levers, ...seeded]) {
      for (const e of c.evidence) {
        const ref = parseEvidenceRef(e);
        expect(ref, `${c.id}: ${e}`).not.toBeNull();
        expect(ref!.path, `${c.id}: ${e}`).not.toMatch(/^\//);
        expect(ref!.path, `${c.id}: ${e}`).not.toMatch(/scratchpad|\/private\/tmp|claude-501/);
        expect(ref!.path, `${c.id}: ${e}`).toMatch(/^docs\/meta-week\//);
      }
    }
  });

  it("carries no id that tells a skeptic the answer", () => {
    // Every id opaque and uniform, in BOTH files: nothing in `CLAIM ${c.id}` can be
    // scored on. Checking only one file would miss a speaking id in the other.
    for (const c of [...levers, ...seeded]) {
      expect(c.id).toMatch(/^c\d{2}$/);
      // And the claim text must not leak the frame either.
      expect(c.claim).not.toMatch(/earlier survey|verified form|seeded|planted/i);
    }
    expect(new Set(levers.map((c) => c.id)).size).toBe(levers.length);
    expect(new Set(seeded.map((c) => c.id)).size).toBe(seeded.length);
  });

  it("the FAIL control is the PASS control plus exactly one claim, and not at the end", () => {
    // The whole discriminator: if anything else differs, a verdict delta proves nothing.
    const passIds = new Set(levers.map((c) => c.id));
    const extra = seeded.filter((c) => !passIds.has(c.id));
    expect(extra).toHaveLength(1);
    expect(extra[0]!.id).toBe("c17");
    expect(seeded).toHaveLength(levers.length + 1);
    // Every shared claim byte-identical, so no verdict can move for another reason.
    expect(seeded.filter((c) => passIds.has(c.id))).toEqual(levers);
    // Planted mid-file: last position would telegraph it to anyone reading the file.
    expect(seeded[seeded.length - 1]!.id).not.toBe("c17");
  });

  it("expects 10 to survive and 6 to die, with the planted claim making 7", () => {
    const verdicts = levers.map((c) => EXPECTED[c.id]);
    expect(verdicts.filter((v) => v === "confirmed")).toHaveLength(10);
    expect(verdicts.filter((v) => v === "refuted")).toHaveLength(6);
    expect(EXPECTED.c17).toBe("refuted");
    // Neither id order nor file position correlates with the verdict.
    expect(verdicts.slice(0, 8)).not.toEqual(verdicts.slice(8).reverse());
    expect(new Set(verdicts.slice(0, 5)).size).toBe(2);
  });

  it("the on-disk answer key and this file agree, and no claims file carries either", () => {
    expect(
      Object.fromEntries(Object.entries(key.expected).map(([k, v]) => [k, v.verdict])),
    ).toEqual(EXPECTED);
    // The script never READS the key — only a header comment names where it lives, and
    // comments never reach an agent. Strip them and no code path can touch it.
    const code = readFileSync(WORKFLOW, "utf8").replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toContain("expected.json");
    for (const c of seeded) expect(Object.keys(c).sort()).toEqual(["claim", "evidence", "id"]);
  });
});
