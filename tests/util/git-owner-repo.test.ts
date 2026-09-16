import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  parseOwnerRepo,
  isOwnerRepo,
  sameOwnerRepo,
  resolveOwnerRepo,
} from "../../src/util/git.js";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, realpath, rm } from "node:fs/promises";
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

  // ------------------------------------------------------------------ #712
  // The GRANT side first, so the deny cases below cannot pass by the parser
  // simply refusing everything. Every form here is one a real fleet checkout
  // carries; each must still resolve.
  it("still resolves every remote form a real GitHub checkout carries", () => {
    const expected = "tucksravin/erpfunds";
    for (const remote of [
      "https://github.com/tucksravin/erpfunds.git",
      "https://github.com/tucksravin/erpfunds",
      "https://github.com/tucksravin/erpfunds/",
      "git@github.com:tucksravin/erpfunds.git",
      "git@github.com:tucksravin/erpfunds",
      "ssh://git@github.com/tucksravin/erpfunds.git",
      "git://github.com/tucksravin/erpfunds.git",
      // The token-bearing form an Actions checkout writes into .git/config.
      "https://x-access-token:ghs_EXAMPLE@github.com/tucksravin/erpfunds.git",
      // ssh.github.com:443 is GitHub's documented way out of a firewall that
      // blocks port 22 — a legitimate origin, not an impostor host.
      "ssh://git@ssh.github.com:443/tucksravin/erpfunds.git",
    ]) {
      expect(parseOwnerRepo(remote), remote).toBe(expected);
    }
    // Case is preserved (owner/repo is compared case-insensitively elsewhere),
    // and a capitalised host is still GitHub.
    expect(parseOwnerRepo("https://GitHub.com/TuckSravin/ErpFunds")).toBe("TuckSravin/ErpFunds");
  });

  it("refuses a remote whose host is not GitHub (#712)", () => {
    // The old parser stripped `^https?://[^/]+/` — the host was thrown away, so
    // a GitLab or impostor origin still yielded a confident GitHub write target.
    for (const remote of [
      "https://gitlab.com/acme/site.git",
      "https://user@evil.example.com/attacker/target",
      "git@gitlab.com:acme/site.git",
      "https://github.com.evil.example/attacker/target",
      "https://notgithub.com/attacker/target",
      "ssh://git@bitbucket.org/acme/site.git",
      "file:///Users/me/mirrors/acme/site.git",
    ]) {
      expect(parseOwnerRepo(remote), remote).toBeNull();
    }
  });

  it("refuses a traversal segment instead of normalising it into another repo (#712)", () => {
    // `new URL` (and curl, and therefore git-over-http) collapse these to
    // /evil/target; ssh hands the literal path to the server. The two
    // disagree about what the remote MEANS, so no answer is proven.
    for (const remote of [
      "https://github.com/ok/repo/../../evil/target",
      "git@github.com:ok/repo/../../evil/target.git",
      "https://github.com/ok/../evil",
    ]) {
      expect(parseOwnerRepo(remote), remote).toBeNull();
    }
  });

  it("refuses a nested path rather than taking the last two segments (#712)", () => {
    for (const remote of [
      "https://github.com/org/team/repo.git",
      "git@github.com:org/team/repo.git",
      "https://github.com/lonely",
      "https://github.com/",
    ]) {
      expect(parseOwnerRepo(remote), remote).toBeNull();
    }
  });

  it("refuses a local filesystem path (#712)", () => {
    // A local-path origin is not exotic in a bootstrap flow that clones from a
    // template; the old parser read it as `GitHub/reddoor-starter`.
    for (const remote of [
      "/Users/me/Documents/GitHub/reddoor-starter",
      "../reddoor-starter",
      "./a/b",
    ]) {
      expect(parseOwnerRepo(remote), remote).toBeNull();
    }
  });

  it("reads the path, not the query string (#712)", () => {
    // `?x=/evil/other` is not part of the path git resolves; the old
    // last-two-segments rule returned `evil/other` for this remote.
    expect(parseOwnerRepo("https://github.com/ok/repo?x=/evil/other")).toBe("ok/repo");
    expect(parseOwnerRepo("https://github.com/ok/repo#/evil/other")).toBe("ok/repo");
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
  it("does not equate a non-GitHub remote with the GitHub repo of the same name (#712)", () => {
    expect(sameOwnerRepo("https://gitlab.com/acme/site.git", "acme/site")).toBe(false);
  });
});

/** Await a rejection and return the Error, or fail loudly if it resolved. */
async function rejection<T>(p: Promise<T>): Promise<Error> {
  const outcome = await p.then(
    (v) => ({ ok: true as const, v }),
    (e: unknown) => ({ ok: false as const, e }),
  );
  if (outcome.ok) {
    throw new Error(`expected a refusal, but it resolved to ${JSON.stringify(outcome.v)}`);
  }
  return outcome.e as Error;
}

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
    //
    // This is also the PASS control for the toplevel check below: on macOS
    // `mkdtemp` hands back /var/... while `git rev-parse --show-toplevel`
    // answers /private/var/..., so a naive string comparison of the two would
    // refuse every legitimate run here.
    execFileSync("git", ["remote", "add", "origin", "git@github.com:reddoorla/29-navy.git"], {
      cwd: dir,
    });
    expect(await resolveOwnerRepo({ path: dir })).toBe("reddoorla/29-navy");
  });

  it("returns null — not a throw — when there is no gitRepo and no origin", async () => {
    // Precondition, stated rather than assumed: this IS a work tree, and it IS
    // its own root — so the null below means "no origin configured" and nothing else.
    expect(
      execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: dir }).toString().trim(),
    ).toBe(await realpath(dir));
    expect(await resolveOwnerRepo({ path: dir })).toBeNull();
  });

  it("throws on a malformed explicit gitRepo before any caller can use it", async () => {
    await expect(resolveOwnerRepo({ path: dir, gitRepo: "--flag" })).rejects.toThrow(/owner\/repo/);
  });

  it("throws on a malformed identity derived from origin", async () => {
    // `https://github.com/ok/../evil` used to parse to "../evil" (the last two
    // path segments) and was caught by isOwnerRepo's explicit `..` reject. It is
    // now refused one step earlier, in parseOwnerRepo — but the refusal must
    // still name origin as the source, because that is where the operator looks.
    execFileSync("git", ["remote", "add", "origin", "https://github.com/ok/../evil"], {
      cwd: dir,
    });
    await expect(resolveOwnerRepo({ path: dir })).rejects.toThrow(/from origin/);
  });

  // ------------------------------------------------------------------ #712
  it("refuses a non-GitHub origin instead of returning a GitHub write identity", async () => {
    // A GitLab origin used to yield `acme/site` — a perfectly-shaped identity
    // that a caller would then write repo secrets and rulesets at, ON GITHUB.
    execFileSync("git", ["remote", "add", "origin", "https://gitlab.com/acme/site.git"], {
      cwd: dir,
    });
    const err = await rejection(resolveOwnerRepo({ path: dir }));
    expect(err.message).toMatch(/from origin/);
    expect(err.message).toContain("https://gitlab.com/acme/site.git");
  });

  it("refuses to adopt the ENCLOSING repository when the path is not a checkout root", async () => {
    // `git remote get-url` walks up. A site directory that has no clone in it
    // yet — exactly what the positional /new-site route points at — therefore
    // resolved to whatever repository happened to contain it. A wrong `cd` was
    // enough to aim a token secret and a ruleset at the maintenance repo.
    const outer = await mkdtemp(join(tmpdir(), "owner-repo-outer-"));
    try {
      execFileSync("git", ["init", "-q"], { cwd: outer });
      execFileSync("git", ["remote", "add", "origin", "https://github.com/reddoorla/outer.git"], {
        cwd: outer,
      });
      const inner = join(outer, "sites", "new-client");
      await mkdir(inner, { recursive: true });
      // Precondition: git really does walk up from `inner` to `outer`.
      expect(
        execFileSync("git", ["remote", "get-url", "origin"], { cwd: inner }).toString().trim(),
      ).toBe("https://github.com/reddoorla/outer.git");

      const err = await rejection(resolveOwnerRepo({ path: inner }));
      // The refusal names BOTH sides: what was asked about, and what git found.
      expect(err.message).toContain(inner);
      expect(err.message).toContain("reddoorla/outer");
      expect(err.message).toMatch(/not the root/i);
    } finally {
      await rm(outer, { recursive: true, force: true });
    }
  });

  it("refuses a non-root path even when the enclosing repo has no origin to name", async () => {
    const outer = await mkdtemp(join(tmpdir(), "owner-repo-bare-"));
    try {
      execFileSync("git", ["init", "-q"], { cwd: outer });
      const inner = join(outer, "sub");
      await mkdir(inner, { recursive: true });
      const err = await rejection(resolveOwnerRepo({ path: inner }));
      expect(err.message).toMatch(/not the root/i);
      expect(err.message).toContain(inner);
    } finally {
      await rm(outer, { recursive: true, force: true });
    }
  });

  it("returns null when the directory is not inside any git work tree", async () => {
    // The precondition is ASSERTED, not inherited from where the OS happens to
    // put temp directories: with TMPDIR inside a checkout this test would
    // otherwise silently become a test of the enclosing repository (#712).
    const plain = await mkdtemp(join(tmpdir(), "owner-repo-plain-"));
    try {
      expect(() =>
        execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: plain, stdio: "pipe" }),
      ).toThrow();
      expect(await resolveOwnerRepo({ path: plain })).toBeNull();
    } finally {
      await rm(plain, { recursive: true, force: true });
    }
  });

  it("throws — never null — when git fails for a reason other than a missing origin", async () => {
    // "there is no remote" and "git could not run" were the same answer to the
    // caller, so `selfUpdating` printed "add an origin remote" for a missing
    // binary, an unreadable path and a dubious-ownership refusal alike.
    const gone = join(dir, "does-not-exist");
    const err = await rejection(resolveOwnerRepo({ path: gone }));
    expect(err.message).not.toMatch(/could not determine/i);
  });

  it("trims an explicit gitRepo, and treats a blank cell as unset", async () => {
    // A hand-typed Airtable cell with a trailing space used to fail closed with
    // an alarming "refusing to act on malformed repo identity".
    expect(await resolveOwnerRepo({ path: dir, gitRepo: "  reddoorla/espada  " })).toBe(
      "reddoorla/espada",
    );
    execFileSync("git", ["remote", "add", "origin", "https://github.com/reddoorla/29-navy.git"], {
      cwd: dir,
    });
    expect(await resolveOwnerRepo({ path: dir, gitRepo: "   " })).toBe("reddoorla/29-navy");
  });
});
