import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  parseOwnerRepo,
  isOwnerRepo,
  sameOwnerRepo,
  resolveOwnerRepo,
} from "../../src/util/git.js";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

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

describe("resolveOwnerRepo", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "owner-repo-"));
    execFileSync("git", ["init", "-q"], { cwd: dir });
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("prefers an explicit gitRepo over the checkout's origin", async () => {
    execFileSync("git", ["remote", "add", "origin", "https://github.com/other/thing.git"], {
      cwd: dir,
    });
    expect(await resolveOwnerRepo({ path: dir, gitRepo: "reddoorla/espada" })).toBe(
      "reddoorla/espada",
    );
  });

  it("derives owner/repo from origin when the site carries no gitRepo", async () => {
    // The whole reason this helper is shared: `localPath()` (src/inventory/local.ts:11)
    // builds a positional Site with NO gitRepo, so every recipe that read
    // site.gitRepo directly refused a checkout passed by path.
    execFileSync("git", ["remote", "add", "origin", "git@github.com:reddoorla/29-navy.git"], {
      cwd: dir,
    });
    expect(await resolveOwnerRepo({ path: dir })).toBe("reddoorla/29-navy");
  });

  it("returns null — not a throw — when there is no gitRepo and no origin", async () => {
    expect(await resolveOwnerRepo({ path: dir })).toBeNull();
  });

  it("throws on a malformed explicit gitRepo before any caller can use it", async () => {
    await expect(resolveOwnerRepo({ path: dir, gitRepo: "--flag" })).rejects.toThrow(/owner\/repo/);
  });

  it("throws on a malformed identity derived from origin", async () => {
    // The fixture must be a value that fails AFTER parseOwnerRepo, not one that
    // fails to parse. `--flag` (the case above) has no slash, so parseOwnerRepo
    // returns null and this helper returns null instead of throwing. And an
    // origin of `https://github.com/ok/--evil` is NOT malformed by this repo's
    // rules: `-` is inside OWNER_REPO_RE's character class (src/util/git.ts:94),
    // so isOwnerRepo("ok/--evil") is TRUE. A traversal segment is what the
    // explicit `repo.includes("..")` reject at src/util/git.ts:100 catches:
    // parseOwnerRepo takes the LAST TWO path segments, so this origin parses to
    // "../evil" — verified against the real parser, not assumed.
    execFileSync("git", ["remote", "add", "origin", "https://github.com/ok/../evil"], {
      cwd: dir,
    });
    await expect(resolveOwnerRepo({ path: dir })).rejects.toThrow(/from origin/);
  });
});
