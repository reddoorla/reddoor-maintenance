import { describe, it, expect, afterEach } from "vitest";
import { runRenovateDispatchCommand } from "../../src/cli/commands/renovate-dispatch.js";
import { makeFakeBase } from "../reports/_helpers/fake-airtable-base.js";

// Mirrors tests/cli/github-signals-command.test.ts: the two guard branches that
// the fleet-security.yml step relies on to never fail. (The dispatch happy path
// is covered by the pure helpers in tests/github/renovate-dispatch.test.ts.)
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
    const r = await runRenovateDispatchCommand({ fleet: false });
    expect(r.code).toBe(2);
  });

  it("clean-skips (exit 0) when no fleet token is configured", async () => {
    delete process.env.RENOVATE_TOKEN;
    delete process.env.GH_TOKEN;
    const r = await runRenovateDispatchCommand({ fleet: true });
    expect(r.code).toBe(0);
    expect(r.output).toContain("skipped");
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

  it("resets stale auto-fix counters on a fully-clean fleet (zero targets)", async () => {
    process.env.RENOVATE_TOKEN = "tok";
    const base = makeFakeBase({
      Websites: [
        {
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
        },
      ],
    });
    const r = await runRenovateDispatchCommand({ fleet: true, base });
    expect(r.code).toBe(0);
    expect(r.output).toContain("RENOVATE_DISPATCH_SUMMARY dispatched=0 skipped=0 failed=0");
    expect(r.output).toContain("AUTO_FIX_ATTEMPTS_SUMMARY written=1 failed=0");
    const updates = base.__calls.filter((c) => c.kind === "update");
    expect(updates).toEqual([
      {
        kind: "update",
        table: "Websites",
        records: [{ id: "recAlamo", fields: { "Security Auto-Fix Attempts": 0 } }],
      },
    ]);
  });

  it("makes no Airtable write when the counter is already 0 (or absent)", async () => {
    process.env.RENOVATE_TOKEN = "tok";
    const base = makeFakeBase({
      Websites: [
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
      ],
    });
    const r = await runRenovateDispatchCommand({ fleet: true, base });
    expect(r.code).toBe(0);
    expect(r.output).toContain("AUTO_FIX_ATTEMPTS_SUMMARY written=0 failed=0");
    expect(base.__calls.filter((c) => c.kind === "update")).toEqual([]);
  });

  it("does not reset while advisories remain (repo-less row keeps targets empty)", async () => {
    process.env.RENOVATE_TOKEN = "tok";
    // No "Git repo" → selectRenovateTargets stays empty, so makeGitHub is never
    // constructed and no network is touched — while the vulns block the reset.
    const base = makeFakeBase({
      Websites: [
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
      ],
    });
    const r = await runRenovateDispatchCommand({ fleet: true, base });
    expect(r.code).toBe(0);
    expect(r.output).toContain("AUTO_FIX_ATTEMPTS_SUMMARY written=0 failed=0");
    expect(base.__calls.filter((c) => c.kind === "update")).toEqual([]);
  });
});
