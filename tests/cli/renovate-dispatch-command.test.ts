import { describe, it, expect, afterEach } from "vitest";
import { runRenovateDispatchCommand } from "../../src/cli/commands/renovate-dispatch.js";
import type { SiteMirror } from "../../src/db/site-mirror.js";
import { websiteRowsFrom, type RawRow } from "../_helpers/raw-rows.js";

/** #646 step 4: the roster comes from Turso; injected here. */
const rosterOf = (rows: RawRow[]) => async () => websiteRowsFrom(rows);

type Write = { id: string; fields: Record<string, unknown> };

function turso(opts: { fails?: boolean } = {}): { writes: Write[]; siteMirror: SiteMirror } {
  const writes: Write[] = [];
  return {
    writes,
    siteMirror: {
      created: async () => {},
      hasRow: async () => true,
      health: async (id, fields) => {
        if (opts.fails) throw new Error("turso down");
        writes.push({ id, fields });
      },
      site: async () => {},
    },
  };
}

// Mirrors tests/cli/github-signals-command.test.ts: the two guard branches that
// the fleet-security.yml step relies on to never fail. (The dispatch happy path
// is covered by the pure helpers in tests/github/renovate-dispatch.test.ts.)
const unusedMirror = {
  created: async () => {},
  hasRow: async () => true,
  health: async () => {
    throw new Error("this path must not write");
  },
  site: async () => {},
};

describe("runRenovateDispatchCommand guards", () => {
  const originalRenovate = process.env.RENOVATE_TOKEN;
  const originalGh = process.env.GH_TOKEN;

  afterEach(() => {
    if (originalRenovate === undefined) delete process.env.RENOVATE_TOKEN;
    else process.env.RENOVATE_TOKEN = originalRenovate;
    if (originalGh === undefined) delete process.env.GH_TOKEN;
    else process.env.GH_TOKEN = originalGh;
  });

  it("rejects a non-fleet invocation with exit 2", async () => {
    const r = await runRenovateDispatchCommand({ fleet: false, siteMirror: unusedMirror });
    expect(r.code).toBe(2);
  });

  it("clean-skips (exit 0) when no fleet token is configured", async () => {
    delete process.env.RENOVATE_TOKEN;
    delete process.env.GH_TOKEN;
    const r = await runRenovateDispatchCommand({ fleet: true, siteMirror: unusedMirror });
    expect(r.code).toBe(0);
    expect(r.output).toContain("skipped");
  });

  it("RENOVATE_TOKEN ALONE no longer authorizes a dispatch — the retired PAT name is not a token source", async () => {
    process.env.RENOVATE_TOKEN = "ghp_retired_pat";
    delete process.env.GH_TOKEN;
    // An empty fleet: had the retired name been honoured, the run would read it
    // and report "nothing to dispatch" instead of the no-token skip.
    const r = await runRenovateDispatchCommand({
      fleet: true,
      roster: async () => [],
      siteMirror: unusedMirror,
    });
    expect(r.code).toBe(0);
    expect(r.output).toContain("skipped: no GH_TOKEN");
  });
});

// Counter bookkeeping must run even when there is nothing to dispatch — the
// reset-on-clean branch used to sit behind a zero-targets early return, so a
// fully-clean fleet never cleared stale counters (Alamo stuck at 7, 2026-07).
describe("runRenovateDispatchCommand — auto-fix counter bookkeeping", () => {
  const originalRenovate = process.env.RENOVATE_TOKEN;
  const originalGh = process.env.GH_TOKEN;

  afterEach(() => {
    if (originalRenovate === undefined) delete process.env.RENOVATE_TOKEN;
    else process.env.RENOVATE_TOKEN = originalRenovate;
    if (originalGh === undefined) delete process.env.GH_TOKEN;
    else process.env.GH_TOKEN = originalGh;
  });

  const ALAMO: RawRow = {
    id: "recAlamo",
    fields: {
      Name: "Alamo",
      Status: "maintenance",
      url: "https://alamo.example.com",
      "Git repo": "reddoorla/alamo",
      "Security Vulns Critical": 0,
      "Security Vulns High": 0,
      "Security Auto-Fix Attempts": 7,
    },
  };

  it("resets stale auto-fix counters in Turso on a fully-clean fleet (zero targets)", async () => {
    process.env.GH_TOKEN = "tok";
    const { writes, siteMirror } = turso();
    const r = await runRenovateDispatchCommand({
      fleet: true,
      roster: rosterOf([ALAMO]),
      siteMirror,
    });
    expect(r.code).toBe(0);
    expect(r.output).toContain("RENOVATE_DISPATCH_SUMMARY dispatched=0 skipped=0 failed=0");
    expect(r.output).toContain("AUTO_FIX_ATTEMPTS_SUMMARY written=1 failed=0");
    expect(writes).toEqual([{ id: "recAlamo", fields: { "Security Auto-Fix Attempts": 0 } }]);
  });

  it("tallies a Turso write failure as failed, never throws, and still exits 0", async () => {
    process.env.GH_TOKEN = "tok";
    const { writes, siteMirror } = turso({ fails: true });
    const r = await runRenovateDispatchCommand({
      fleet: true,
      roster: rosterOf([ALAMO, { id: "recB", fields: { ...ALAMO.fields, Name: "Beta" } }]),
      siteMirror,
    });
    expect(r.code).toBe(0);
    expect(r.output).toContain("AUTO_FIX_ATTEMPTS_SUMMARY written=0 failed=2");
    expect(writes).toEqual([]);
  });

  it("makes no write when the counter is already 0 (or absent)", async () => {
    process.env.GH_TOKEN = "tok";
    const { writes, siteMirror } = turso();
    const r = await runRenovateDispatchCommand({
      fleet: true,
      siteMirror,
      roster: rosterOf([
        {
          id: "recA",
          fields: {
            Name: "Alamo",
            Status: "maintenance",
            url: "https://alamo.example.com",
            "Git repo": "reddoorla/alamo",
            "Security Vulns Critical": 0,
            "Security Vulns High": 0,
            "Security Auto-Fix Attempts": 0,
          },
        },
        {
          id: "recB",
          fields: {
            Name: "Beta",
            Status: "maintenance",
            url: "https://beta.example.com",
            "Git repo": "reddoorla/beta",
            "Security Vulns Critical": 0,
            "Security Vulns High": 0,
            // counter field absent — null reads as 0, no write
          },
        },
      ]),
    });
    expect(r.code).toBe(0);
    expect(r.output).toContain("AUTO_FIX_ATTEMPTS_SUMMARY written=0 failed=0");
    expect(writes).toEqual([]);
  });

  it("does not reset while advisories remain (repo-less row keeps targets empty)", async () => {
    process.env.GH_TOKEN = "tok";
    // No "Git repo" → selectRenovateTargets stays empty, so makeGitHub is never
    // constructed and no network is touched — while the vulns block the reset.
    const { writes, siteMirror } = turso();
    const r = await runRenovateDispatchCommand({
      fleet: true,
      siteMirror,
      roster: rosterOf([
        {
          id: "recV",
          fields: {
            Name: "Vulny",
            Status: "maintenance",
            url: "https://vulny.example.com",
            "Security Vulns Critical": 2,
            "Security Auto-Fix Attempts": 4,
          },
        },
      ]),
    });
    expect(r.code).toBe(0);
    expect(r.output).toContain("AUTO_FIX_ATTEMPTS_SUMMARY written=0 failed=0");
    expect(writes).toEqual([]);
  });
});
