import { describe, it, expect } from "vitest";
import { parseOwnerRepo, isOwnerRepo, sameOwnerRepo } from "../../src/util/git.js";

describe("parseOwnerRepo", () => {
  it("parses https URLs with and without .git", () => {
    expect(parseOwnerRepo("https://github.com/tucksravin/erpfunds.git")).toBe(
      "tucksravin/erpfunds",
    );
    expect(parseOwnerRepo("https://github.com/tucksravin/erpfunds")).toBe("tucksravin/erpfunds");
  });
  it("parses scp-style git@ URLs", () => {
    expect(parseOwnerRepo("git@github.com:tucksravin/erpfunds.git")).toBe("tucksravin/erpfunds");
  });
  it("strips a trailing slash", () => {
    expect(parseOwnerRepo("https://github.com/tucksravin/erpfunds/")).toBe("tucksravin/erpfunds");
  });
  it("returns null for an unparseable remote", () => {
    expect(parseOwnerRepo("not a url")).toBeNull();
  });
});

describe("isOwnerRepo", () => {
  it("accepts a clean owner/repo", () => {
    expect(isOwnerRepo("reddoorla/caltex")).toBe(true);
    expect(isOwnerRepo("o-1/r_2.x")).toBe(true);
  });
  it("rejects traversal, missing/extra segments, whitespace, and schemes", () => {
    for (const bad of [
      "../evil",
      "o",
      "o/r/x",
      "o /r",
      "o/r ",
      "https://github.com/o/r",
      "git@github.com:o/r",
      "owner/",
      "/r",
      "o//r",
      "--upload-pack=x/y",
    ]) {
      expect(isOwnerRepo(bad)).toBe(false);
    }
  });
});

describe("sameOwnerRepo", () => {
  it("treats https, scp-style, and bare owner/repo as equal", () => {
    const forms = [
      "https://github.com/o/r.git",
      "https://github.com/o/r",
      "git@github.com:o/r.git",
      "o/r",
    ];
    for (const a of forms) {
      for (const b of forms) {
        expect(sameOwnerRepo(a, b)).toBe(true);
      }
    }
  });
  it("is case-insensitive on owner/repo", () => {
    expect(sameOwnerRepo("https://github.com/O/R.git", "o/r")).toBe(true);
  });
  it("detects a mismatched owner or repo", () => {
    expect(sameOwnerRepo("o/r", "other/r")).toBe(false);
    expect(sameOwnerRepo("o/r", "o/other")).toBe(false);
    expect(sameOwnerRepo("git@github.com:o/r.git", "https://github.com/o/other.git")).toBe(false);
  });
  it("returns false when either side is unparseable", () => {
    expect(sameOwnerRepo("not a url", "o/r")).toBe(false);
    expect(sameOwnerRepo("o/r", "garbage")).toBe(false);
  });
});
