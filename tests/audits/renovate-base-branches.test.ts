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

describe("presetFiles uses Renovate's file naming", () => {
  it.each([
    ["github>reddoorla/.github:renovate-config", "reddoorla/.github", ["renovate-config.json"]],
    ["local>reddoorla/.github", "reddoorla/.github", ["default.json", "renovate.json"]],
    ["github>o/r//configs/base", "o/r", ["configs/base.json"]],
    ["github>o/r:thing.json5", "o/r", ["thing.json5"]],
    ["github>o/r:thing(arg)", "o/r", ["thing.json"]],
  ])("%s", (preset, repo, files) => {
    expect(presetFiles(preset)).toEqual({ repo, files });
  });

  it.each([
    "config:recommended",
    "group:allNonMajor",
    "github>o/r#v1",
    "github>o/r:file/sub",
    "npm-pkg",
  ])("%s is not resolvable here (built-in, tagged, sub-preset, other host)", (preset) => {
    expect(presetFiles(preset)).toBeNull();
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
    expect(r.reads).toEqual(RENOVATE_CONFIG_FILES.map((f) => `o/r:${f}`));
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
