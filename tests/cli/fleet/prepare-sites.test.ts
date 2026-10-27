import { describe, it, expect } from "vitest";
import {
  prepareFleetSites,
  formatSkippedNotice,
  appendSkipNotice,
} from "../../../src/cli/fleet/prepare-sites.js";
import type { Site } from "../../../src/types.js";

describe("prepareFleetSites", () => {
  it("clones every site by default (recipe commands always need a checkout)", async () => {
    const clone = async (s: Site, o: { workdir: string }) => ({
      ...s,
      path: `${o.workdir}/${s.name}`,
    });
    const sites: Site[] = [
      { path: "/a", name: "a", gitRepo: "o/a" },
      { path: "/b", name: "b", gitRepo: "o/b" },
    ];
    const out = await prepareFleetSites(sites, { workdir: "/tmp/w", clone });
    expect(out.skipped).toEqual([]);
    expect(out.prepared.map((s) => s.path)).toEqual(["/tmp/w/a", "/tmp/w/b"]);
  });

  it("isolates a per-site clone failure: the bad site is skipped, the rest still prepare", async () => {
    // The core regression: a bare Promise.all would reject the whole batch.
    const clone = async (s: Site) => {
      if (s.name === "bad") throw new Error("cannot clone");
      return s;
    };
    const sites: Site[] = [
      { path: "/a", name: "good-1", gitRepo: "o/a" },
      { path: "/bad", name: "bad" },
      { path: "/c", name: "good-2", gitRepo: "o/c" },
    ];
    const out = await prepareFleetSites(sites, { workdir: "/tmp/w", clone });
    expect(out.prepared.map((s) => s.name)).toEqual(["good-1", "good-2"]);
    expect(out.skipped).toEqual([{ site: "bad", reason: "cannot clone" }]);
  });

  it("honors a needsCheckout predicate (deployed-capable sites pass through unclone)", async () => {
    let cloneCalls = 0;
    const clone = async (s: Site) => {
      cloneCalls += 1;
      return s;
    };
    const deployed: Site = { path: "/x", name: "deployed", deployedUrl: "https://x/" };
    const local: Site = { path: "/y", name: "local", gitRepo: "o/y" };
    const out = await prepareFleetSites([deployed, local], {
      workdir: "/tmp/w",
      clone,
      needsCheckout: (s) => s.deployedUrl === undefined,
    });
    expect(cloneCalls).toBe(1); // only `local` cloned
    expect(out.prepared.map((s) => s.name)).toEqual(["deployed", "local"]);
    expect(out.skipped).toEqual([]);
  });

  it("labels a skipped site by name, falling back to path — including when name is the empty string", async () => {
    const clone = async () => {
      throw new Error("boom");
    };
    // name "" must NOT pass through `??`; the empty string falls back to path.
    const out = await prepareFleetSites([{ path: "/no-name", name: "" }], {
      workdir: "/tmp/w",
      clone,
    });
    expect(out.skipped[0]!.site).toBe("/no-name");
  });

  it("catches the REAL cloneIfNeeded throw (no injected fake) and skips the site", async () => {
    // Integration guard: exercise the default `clone` (the real cloneIfNeeded),
    // not a stub, so the catch wraps the ACTUAL throw paths — including
    // assertCheckoutMatches' wrong-repo refusal, which throws an Error the same
    // way "cannot clone" does and is therefore caught and SKIPPED identically.
    // Here the path doesn't exist and the row has no repo, so cloneIfNeeded
    // throws before any git/network work.
    const good: Site = { path: "/x", name: "good", gitRepo: "o/good" };
    const noTarget: Site = { path: "/nonexistent/reddoor-prep-guard-xyz", name: "no-target" };
    const out = await prepareFleetSites([good, noTarget], {
      workdir: "/nonexistent/reddoor-workdir-xyz",
      // `good` has a gitRepo but its path doesn't exist; the fake-free default
      // clone would try a real git clone for it, so stub only that site through
      // by marking it not-needing-checkout to keep the test hermetic.
      needsCheckout: (s) => s.name === "no-target",
    });
    expect(out.prepared.map((s) => s.name)).toEqual(["good"]);
    expect(out.skipped).toHaveLength(1);
    expect(out.skipped[0]!.site).toBe("no-target");
    expect(out.skipped[0]!.reason).toMatch(/cannot clone/);
  });
});

describe("formatSkippedNotice", () => {
  it("returns null when nothing was skipped", () => {
    expect(formatSkippedNotice([])).toBeNull();
  });

  it("emits the grep-stable '⚠ N site(s) skipped (could not prepare)' token", () => {
    const note = formatSkippedNotice([
      { site: "erp", reason: "cannot clone" },
      { site: "foo", reason: "git clone failed" },
    ]);
    expect(note).toMatch(/^⚠ 2 site\(s\) skipped \(could not prepare\): /);
    expect(note).toContain("erp (cannot clone)");
    expect(note).toContain("foo (git clone failed)");
  });
});

describe("appendSkipNotice", () => {
  it("returns the output unchanged when nothing was skipped", () => {
    expect(appendSkipNotice("done", [])).toBe("done");
  });

  it("appends the notice on a blank line when sites were skipped", () => {
    const out = appendSkipNotice("done", [{ site: "erp", reason: "cannot clone" }]);
    expect(out).toBe("done\n\n⚠ 1 site(s) skipped (could not prepare): erp (cannot clone)");
  });
});
