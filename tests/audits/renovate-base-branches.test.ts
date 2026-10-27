import { describe, it, expect } from "vitest";
import {
  isBranchPattern,
  json5ToJson,
  presetFiles,
  readRenovateBaseBranches,
  RENOVATE_CONFIG_FILES,
} from "../../src/audits/renovate-base-branches.js";

function reader(files: Record<string, string | Error>) {
  const reads: string[] = [];
  return {
    reads,
    repoTextFile: async (repo: string, path: string) => {
      reads.push(`${repo}:${path}`);
      const hit = files[`${repo}:${path}`];
      if (hit instanceof Error) throw hit;
      return hit ?? null;
    },
  };
}

describe("json5ToJson", () => {
  it("leaves comment- and comma-looking text INSIDE strings alone", () => {
    const text = `{ a: 'x // not a comment', "b": "y,}", c: ['it\\'s', "q\\"q",], }`;
    expect(JSON.parse(json5ToJson(text))).toEqual({
      a: "x // not a comment",
      b: "y,}",
      c: ["it's", 'q"q'],
    });
  });

  it("keeps bare true/false/null values as values, not keys", () => {
    expect(JSON.parse(json5ToJson(`{ automerge: true, x: null /* c */, }`))).toEqual({
      automerge: true,
      x: null,
    });
  });
});

describe("presetFiles follows Renovate 44's preset parser (lib/config/presets/parse.ts, util.ts @ 44.0.0)", () => {
  it.each([
    ["github>reddoorla/.github:renovate-config", "reddoorla/.github", ["renovate-config.json"]],
    ["local>reddoorla/.github", "reddoorla/.github", ["default.json", "renovate.json"]],
    // A bare owner/repo is a `local>` preset in Renovate's parser.
    ["reddoorla/.github:renovate-config", "reddoorla/.github", ["renovate-config.json"]],
    ["github>o/r//configs/base", "o/r", ["configs/base.json"]],
    ["github>o/r:thing.json5", "o/r", ["thing.json5"]],
    ["github>o/r:thing.jsonc", "o/r", ["thing.jsonc"]],
    ["github>o/r:thing(arg)", "o/r", ["thing.json"]],
  ])("%s", (preset, repo, files) => {
    expect(presetFiles(preset)).toEqual({ kind: "file", repo, files });
  });

  // Renovate's own built-in groups. Every one of the 17 group files at 44.0.0
  // was grepped for `baseBranch` (0 hits), so these are RESOLVED — to "sets
  // no base branch" — not skipped, and they print nothing.
  it.each([
    "config:recommended",
    "group:allNonMajor",
    ":dependencyDashboard",
    "helpers:pinGitHubActionDigests",
  ])("%s is built-in", (preset) => {
    expect(presetFiles(preset)).toEqual({ kind: "builtin" });
  });

  it.each([
    ["github>o/r#v1", "pinned to a tag"],
    ["github>o/r//path/name#v1", "pinned to a tag"],
    ["github>o/r:file/sub", "sub-preset"],
    ["github>o/r//path:name", "sub-preset"],
    ["gitlab>o/r", "not hosted on GitHub"],
    ["gitea>o/r", "not hosted on GitHub"],
    ["https://example.com/preset.json", "not hosted on GitHub"],
    ["renovate-config-foo", "npm"],
    ["@scope/renovate-config", "npm"],
  ])("%s is SKIPPED with a reason", (preset, why) => {
    expect(presetFiles(preset)).toEqual({ kind: "skipped", why: expect.stringContaining(why) });
  });
});

describe("isBranchPattern", () => {
  it("regexes and globs are patterns; branch names are not", () => {
    expect(isBranchPattern("/^release\\/.*/")).toBe(true);
    expect(isBranchPattern("/staging/i")).toBe(true);
    expect(isBranchPattern("release/*")).toBe(true);
    expect(isBranchPattern("staging")).toBe(false);
    expect(isBranchPattern("release/2026-09")).toBe(false);
  });
});

describe("readRenovateBaseBranches", () => {
  it("no config file anywhere is default-only, after trying every Renovate location", async () => {
    const r = reader({});
    expect(await readRenovateBaseBranches("o/r", r)).toEqual({
      state: "default-only",
      reason: "no Renovate config file",
      unreadPresets: [],
    });
    // Pinned LITERALLY, not derived from RENOVATE_CONFIG_FILES: this is
    // Renovate 44's `getConfigFileNames("github")` (lib/config/app-strings.ts
    // @ 44.0.0 — `.gitlab/*` filtered out on GitHub, `.jsonc` second). A list
    // compared against itself could never catch a missing name.
    const expected = [
      "renovate.json",
      "renovate.jsonc",
      "renovate.json5",
      ".github/renovate.json",
      ".github/renovate.jsonc",
      ".github/renovate.json5",
      ".renovaterc",
      ".renovaterc.json",
      ".renovaterc.jsonc",
      ".renovaterc.json5",
      "package.json",
    ];
    expect([...RENOVATE_CONFIG_FILES]).toEqual(expected);
    expect(r.reads).toEqual(expected.map((f) => `o/r:${f}`));
  });

  it("package.json counts only with a `renovate` key", async () => {
    const plain = reader({ "o/r:package.json": JSON.stringify({ name: "x" }) });
    expect((await readRenovateBaseBranches("o/r", plain)).state).toBe("default-only");
    const keyed = reader({
      "o/r:package.json": JSON.stringify({ renovate: { baseBranchPatterns: ["staging"] } }),
    });
    expect(await readRenovateBaseBranches("o/r", keyed)).toEqual({
      state: "configured",
      source: "baseBranchPatterns in package.json",
      patterns: ["staging"],
      unreadPresets: [],
    });
  });

  it("the LAST preset that sets a base branch wins, and nested presets are followed", async () => {
    const r = reader({
      "o/r:renovate.json": JSON.stringify({ extends: ["github>o/a", "github>o/b"] }),
      "o/a:default.json": JSON.stringify({ baseBranchPatterns: ["from-a"] }),
      "o/b:default.json": JSON.stringify({ extends: ["github>o/c:deep"] }),
      "o/c:deep.json": JSON.stringify({ baseBranches: ["from-c"] }),
    });
    expect(await readRenovateBaseBranches("o/r", r)).toEqual({
      state: "configured",
      source: "baseBranches in github>o/c:deep",
      patterns: ["from-c"],
      unreadPresets: [],
    });
  });

  it("a preset cycle terminates as default-only; a malformed key in the repo's OWN config is unverified", async () => {
    const cycle = reader({
      "o/r:renovate.json": JSON.stringify({ extends: ["github>o/a"] }),
      "o/a:default.json": JSON.stringify({ extends: ["github>o/a"] }),
    });
    expect((await readRenovateBaseBranches("o/r", cycle)).state).toBe("default-only");

    const malformed = reader({
      "o/r:renovate.json": JSON.stringify({ baseBranchPatterns: "staging" }),
    });
    expect(await readRenovateBaseBranches("o/r", malformed)).toMatchObject({
      state: "unverified",
      reason: expect.stringContaining("not a list of strings"),
    });
  });

  it("a preset's OWN value beats anything its nested `extends` sets", async () => {
    // Renovate resolves a preset's extends first and then applies the preset's
    // own keys over them, so P's ["x"] must win over Q's ["y"].
    const r = reader({
      "o/r:renovate.json": JSON.stringify({ extends: ["github>o/p"] }),
      "o/p:default.json": JSON.stringify({ extends: ["github>o/q"], baseBranchPatterns: ["x"] }),
      "o/q:default.json": JSON.stringify({ baseBranchPatterns: ["y"] }),
    });
    expect(await readRenovateBaseBranches("o/r", r)).toEqual({
      state: "configured",
      source: "baseBranchPatterns in github>o/p",
      patterns: ["x"],
      unreadPresets: [],
    });
  });

  it("every preset this audit cannot follow is NAMED; a built-in one is not", async () => {
    const r = reader({
      "o/r:renovate.json": JSON.stringify({
        extends: [
          "config:recommended",
          "github>o/pinned#v2",
          "github>o/r:file/sub",
          "gitlab>o/elsewhere",
          "renovate-config-foo",
        ],
      }),
    });
    const out = await readRenovateBaseBranches("o/r", r);
    expect(out.state).toBe("default-only");
    if (out.state === "unverified") throw new Error("unreachable");
    expect(out.unreadPresets).toEqual([
      expect.stringMatching(/^renovate-config-foo \(npm/),
      expect.stringMatching(/^gitlab>o\/elsewhere \(not hosted on GitHub/),
      expect.stringMatching(/^github>o\/r:file\/sub \(sub-preset/),
      expect.stringMatching(/^github>o\/pinned#v2 \(pinned to a tag/),
    ]);
  });

  it("a refused or broken PRESET is skipped and NAMED, never unverified — and an earlier preset still counts", async () => {
    const r = reader({
      "o/r:renovate.json": JSON.stringify({ extends: ["github>o/a", "github>o/b", "github>o/c"] }),
      "o/a:default.json": JSON.stringify({ baseBranchPatterns: ["from-a"] }),
      "o/b:default.json": "{ not json",
      "o/c:default.json": new Error(
        "repoTextFile(o/c/default.json) failed: gh: GitHub access to this repository is not enabled (HTTP 403)",
      ),
    });
    expect(await readRenovateBaseBranches("o/r", r)).toEqual({
      state: "configured",
      source: "baseBranchPatterns in github>o/a",
      patterns: ["from-a"],
      unreadPresets: ["github>o/c (HTTP 403)", expect.stringMatching(/^github>o\/b \(/)],
    });
  });
});
