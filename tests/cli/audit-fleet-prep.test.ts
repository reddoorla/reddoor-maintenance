import { describe, it, expect } from "vitest";
import { prepareFleetSites, formatSkippedNotice } from "../../src/cli/commands/audit.js";
import type { AuditName, Site } from "../../src/types.js";

const LIGHTHOUSE: AuditName[] = ["lighthouse"];

describe("prepareFleetSites", () => {
  it("passes a deployed-capable site through WITHOUT cloning", async () => {
    let cloneCalls = 0;
    const clone = async (s: Site) => {
      cloneCalls += 1;
      return s;
    };
    const deployed: Site = { path: "/x", name: "acme", deployedUrl: "https://acme.example/" };

    const out = await prepareFleetSites([deployed], LIGHTHOUSE, { workdir: "/tmp/w", clone });

    expect(cloneCalls).toBe(0);
    expect(out.prepared).toEqual([deployed]);
    expect(out.skipped).toEqual([]);
  });

  it("clones a site that needs a checkout and returns the cloned result", async () => {
    const clone = async (s: Site, o: { workdir: string }) => ({
      ...s,
      path: `${o.workdir}/${s.name}`,
    });
    const needsCheckout: Site = { path: "/missing", name: "withrepo", gitRepo: "owner/withrepo" };

    const out = await prepareFleetSites([needsCheckout], LIGHTHOUSE, {
      workdir: "/tmp/w",
      clone,
    });

    expect(out.skipped).toEqual([]);
    expect(out.prepared).toEqual([
      { path: "/tmp/w/withrepo", name: "withrepo", gitRepo: "owner/withrepo" },
    ]);
  });

  it("isolates a per-site prep failure: the bad site is skipped, the rest still prepare", async () => {
    // Regression for the 2026-06-13 nightly crash: ERP (no deployedUrl, no repo)
    // threw inside Promise.all and aborted prep for the ENTIRE fleet.
    const clone = async (s: Site) => {
      if (s.name === "erp") {
        throw new Error(
          "site path does not exist (/tmp/w/erp) and no repoUrl or gitRepo is set — cannot clone",
        );
      }
      return s;
    };
    const sites: Site[] = [
      { path: "/a", name: "good-1", deployedUrl: "https://good1/" },
      { path: "/erp", name: "erp" }, // not deployed-capable, no repo → clone throws
      { path: "/b", name: "good-2", deployedUrl: "https://good2/" },
    ];

    const out = await prepareFleetSites(sites, LIGHTHOUSE, { workdir: "/tmp/w", clone });

    expect(out.prepared.map((s) => s.name)).toEqual(["good-1", "good-2"]);
    expect(out.skipped).toHaveLength(1);
    expect(out.skipped[0]!.site).toBe("erp");
    expect(out.skipped[0]!.reason).toMatch(/cannot clone/);
  });

  it("labels a skipped site by path when it has no name", async () => {
    const clone = async () => {
      throw new Error("boom");
    };
    const out = await prepareFleetSites([{ path: "/no-name" }], LIGHTHOUSE, {
      workdir: "/tmp/w",
      clone,
    });
    expect(out.skipped[0]!.site).toBe("/no-name");
  });

  it("returns no skips when every site prepares cleanly", async () => {
    const clone = async (s: Site) => s;
    const sites: Site[] = [
      { path: "/a", name: "a", deployedUrl: "https://a/" },
      { path: "/b", name: "b", deployedUrl: "https://b/" },
    ];
    const out = await prepareFleetSites(sites, LIGHTHOUSE, { workdir: "/tmp/w", clone });
    expect(out.skipped).toEqual([]);
    expect(out.prepared).toHaveLength(2);
  });

  it("catches the REAL cloneIfNeeded throw (no injected fake) and skips the site", async () => {
    // Integration guard: exercise the default `clone` (the real cloneIfNeeded),
    // not a stub, so the catch wraps the ACTUAL throw paths — including
    // assertCheckoutMatches' wrong-repo refusal, which throws an Error the same
    // way "cannot clone" does and is therefore caught and SKIPPED identically
    // (the site is never silently audited against a mismatched checkout). Here
    // the path doesn't exist and the row has no repo, so cloneIfNeeded throws
    // before any git/network work.
    const goodDeployed: Site = { path: "/x", name: "good", deployedUrl: "https://good/" };
    const noTarget: Site = { path: "/nonexistent/reddoor-prep-guard-xyz", name: "no-target" };

    const out = await prepareFleetSites([goodDeployed, noTarget], LIGHTHOUSE, {
      workdir: "/nonexistent/reddoor-workdir-xyz",
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

  it("emits the grep-stable '⚠ N site(s) skipped' token the workflow keys on", () => {
    const note = formatSkippedNotice([
      { site: "erp", reason: "cannot clone" },
      { site: "foo", reason: "git clone failed" },
    ]);
    // The nightly workflow greps for this exact prefix to raise a ::warning::.
    expect(note).toMatch(/^⚠ 2 site\(s\) skipped \(could not prepare for audit\): /);
    expect(note).toContain("erp (cannot clone)");
    expect(note).toContain("foo (git clone failed)");
  });
});
