/**
 * P1-35. `scripts/pm-cockpit.mts` gives the daily PM pass the cockpit's Needs-you
 * and Watch state. The positive control is a healthy site the formatter must not
 * list; the negative one is a site with one known attention item it must list.
 * A "just wait" vuln (src/alerts/waiting.ts) must stay out, new or not.
 */
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { openDb } from "../../src/db/client.js";
import type { WebsiteRow } from "../../src/fleet/site-row.js";
import type { DigestSnapshot } from "../../src/alerts/digest-state.js";
import { makeWebsiteRow } from "../_helpers/website-row.js";
import {
  assertReadOnly,
  buildPmCockpit,
  formatPmCockpit,
  loadCockpitInputs,
  openReadOnlyDb,
  parseArgs,
  type CockpitInputs,
} from "../../scripts/pm-cockpit.mjs";

const NOW = new Date("2026-10-07T12:00:00Z");

function site(over: Partial<WebsiteRow>): WebsiteRow {
  return makeWebsiteRow({
    pointOfContact: "Tucker",
    ga4PropertyId: "123456789",
    searchConsoleProperty: "sc-domain:example.com",
    gitRepo: "reddoorla/example",
    netlifyId: "11111111-2222-3333-4444-555555555555",
    maintenanceFreq: "Monthly",
    reportRecipientsTo: "t@x.com",
    pScore: 95,
    rScore: 95,
    bpScore: 95,
    seoScore: 95,
    lastLighthouseAuditAt: "2026-10-06T12:00:00Z",
    a11yViolations: 0,
    depsDrifted: 0,
    depsMajorBehind: 0,
    securityVulnsCritical: 0,
    securityVulnsHigh: 0,
    securityVulnsModerate: 0,
    securityVulnsLow: 0,
    ...over,
  });
}

const BROKEN = site({
  id: "recBROKEN",
  name: "Broken Co",
  url: "https://broken.example.com",
  pScore: 60,
});
const HEALTHY = site({ id: "recHEALTHY", name: "Healthy Co", url: "https://healthy.example.com" });
const WAITING = site({
  id: "recWAIT",
  name: "Waiting Co",
  url: "https://waiting.example.com",
  securityVulnsCritical: 1,
});

const PRIOR: DigestSnapshot = {
  "lighthouse:recBROKEN:performance": { metric: 40, firstFlaggedAt: "2026-10-01" },
  "vuln:recWAIT": { metric: 1, firstFlaggedAt: "2026-10-06" },
};

function inputs(over: Partial<CockpitInputs> = {}): CockpitInputs {
  return {
    websites: [BROKEN, HEALTHY, WAITING],
    reports: [],
    prior: PRIOR,
    baseUrl: "https://dash.example.com",
    newSubmissions: [],
    spamTotals: null,
    recentEvents: [],
    autoFilteredCount: 0,
    notifyBounces: new Map(),
    deadLetters: new Map(),
    ...over,
  };
}

describe("pm-cockpit — the formatter lists exactly the site that needs the operator", () => {
  it("the fixture is what it claims: the waiting vuln is collected and marked waiting", () => {
    const pm = buildPmCockpit(inputs(), NOW);
    expect(pm.waitingKeys).toEqual(["vuln:recWAIT"]);
  });

  it("lists the attention site with its reason and page, and nothing else", () => {
    const out = formatPmCockpit(buildPmCockpit(inputs(), NOW));
    expect(out.split("\n")[0]).toBe("PM_COCKPIT_SUMMARY broken=1 watch=0 approval=0 sites=3");
    expect(out).toContain("Broken Co · broken · /s/broken-co");
    expect(out).toContain("Lighthouse Performance 60 (below 75)");
    expect(out).not.toMatch(/Healthy Co|healthy-co/);
    expect(out).not.toMatch(/Waiting Co|waiting-co/);
  });

  it("refuses an empty digest snapshot, which would turn every just-wait item into an ask", () => {
    expect(() => buildPmCockpit(inputs({ prior: {} }), NOW)).toThrow(/digest snapshot/);
  });
});

describe("pm-cockpit — what the cockpit's own feed leaves out is still listed", () => {
  it("lists a site whose only problem is a failed production deploy", () => {
    const dead = site({
      id: "recDEP",
      name: "Deploy Co",
      url: "https://dep.example.com",
      deployStatus: "error",
    });
    const out = formatPmCockpit(buildPmCockpit(inputs({ websites: [HEALTHY, dead] }), NOW));
    expect(out.split("\n")[0]).toBe("PM_COCKPIT_SUMMARY broken=1 watch=0 approval=0 sites=2");
    expect(out).toContain("- Deploy Co · broken · /s/deploy-co");
    expect(out).toContain("latest production deploy error (undated)");
  });

  it("orders Needs-you as the cockpit does: broken critical-first, then A to Z, then approvals", () => {
    const dead = site({
      id: "recDEP",
      name: "Alpha Deploy",
      url: "https://alpha.example.com",
      deployStatus: "error",
    });
    const out = formatPmCockpit(
      buildPmCockpit(
        inputs({ websites: [HEALTHY, BROKEN, dead], deadLetters: new Map([["ghost-site", 4]]) }),
        NOW,
      ),
    );
    const order = out
      .split("\n")
      .filter((l) => l.startsWith("- "))
      .map((l) => l.split(" · ")[0]);
    expect(order).toEqual(["- (unknown site: ghost-site)", "- Alpha Deploy", "- Broken Co"]);
  });

  it("lists a dead letter for a slug no site owns", () => {
    const out = formatPmCockpit(
      buildPmCockpit(
        inputs({ websites: [HEALTHY], deadLetters: new Map([["ghost-site", 4]]) }),
        NOW,
      ),
    );
    expect(out.split("\n")[0]).toBe("PM_COCKPIT_SUMMARY broken=1 watch=0 approval=0 sites=1");
    expect(out).toContain("(unknown site: ghost-site) · broken · (no site page)");
  });
});

describe("pm-cockpit --since", () => {
  it("dates a vuln that just exhausted its auto-fix today, and an already-exhausted one as undated", () => {
    const ex = site({
      id: "recEX",
      name: "Exhausted Co",
      url: "https://ex.example.com",
      securityVulnsCritical: 1,
      securityAutoFixAttempts: 3,
    });
    const fresh = formatPmCockpit(
      buildPmCockpit(
        inputs({
          websites: [HEALTHY, ex],
          prior: { ...PRIOR, "vuln:recEX": { metric: 1, firstFlaggedAt: "2026-10-04" } },
        }),
        NOW,
        "2026-10-06T12:00:00Z",
      ),
    );
    expect(fresh).toContain("- NEW Exhausted Co · broken · /s/exhausted-co");
    expect(fresh).toContain("(auto-fix exhausted 2026-10-07)");
    const old = formatPmCockpit(
      buildPmCockpit(
        inputs({
          websites: [HEALTHY, ex],
          prior: {
            ...PRIOR,
            "vuln:recEX": { metric: 1, firstFlaggedAt: "2026-10-04", exhausted: true },
          },
        }),
        NOW,
        "2026-10-06T12:00:00Z",
      ),
    );
    expect(old).toContain("- Exhausted Co · broken · /s/exhausted-co");
    expect(old).toMatch(/new=0/);
  });

  it("dates a direct vuln by the day its wait failed, not the day it was first flagged", () => {
    const late = site({
      id: "recLATE",
      name: "Late Co",
      url: "https://late.example.com",
      securityVulnsCritical: 1,
    });
    const out = formatPmCockpit(
      buildPmCockpit(
        inputs({
          websites: [HEALTHY, late],
          prior: { ...PRIOR, "vuln:recLATE": { metric: 1, firstFlaggedAt: "2026-10-02" } },
        }),
        NOW,
        "2026-10-06T12:00:00Z",
      ),
    );
    expect(out).toContain("- NEW Late Co · /s/late-co · ");
    expect(out).toContain("(escalated 2026-10-06)");
  });

  it("marks an item first flagged on or after the since day, and not an older one", () => {
    const fresh = site({
      id: "recFRESH",
      name: "Fresh Co",
      url: "https://fresh.example.com",
      rScore: 50,
    });
    const pm = buildPmCockpit(
      inputs({ websites: [BROKEN, HEALTHY, WAITING, fresh] }),
      NOW,
      "2026-10-05T11:48:00Z",
    );
    const out = formatPmCockpit(pm);
    expect(out.split("\n")[0]).toBe(
      "PM_COCKPIT_SUMMARY broken=2 watch=0 approval=0 sites=4 new=1 since=2026-10-05T11:48:00Z",
    );
    expect(out).toContain("- NEW Fresh Co · broken · /s/fresh-co");
    expect(out).toContain("- Broken Co · broken · /s/broken-co");
    expect(out).toContain("first flagged 2026-10-01");
  });

  it("never marks a just-wait item new, even one first flagged inside the window", () => {
    const pm = buildPmCockpit(
      inputs({ websites: [HEALTHY, WAITING] }),
      NOW,
      "2026-10-01T00:00:00Z",
    );
    const out = formatPmCockpit(pm);
    expect(out.split("\n")[0]).toBe(
      "PM_COCKPIT_SUMMARY broken=0 watch=0 approval=0 sites=2 new=0 since=2026-10-01T00:00:00Z",
    );
    expect(out).not.toMatch(/Waiting Co|NEW/);
  });

  it("dates a watch reason as undated rather than guessing", () => {
    const watch = site({
      id: "recW",
      name: "Watch Co",
      url: "https://watch.example.com",
      pScore: 80,
    });
    const out = formatPmCockpit(
      buildPmCockpit(inputs({ websites: [HEALTHY, watch] }), NOW, "2026-10-05T00:00:00Z"),
    );
    expect(out).toContain("PM_COCKPIT_SUMMARY broken=0 watch=1 approval=0 sites=2 new=0");
    expect(out).toContain("Watch Co · /s/watch-co · Performance 80 (undated)");
  });

  it("parses --since only as an ISO time with a zone", () => {
    expect(parseArgs(["--since", "2026-10-06T11:48:00Z"]).since).toBe("2026-10-06T11:48:00Z");
    expect(() => parseArgs(["--since", "2026-10-06"])).toThrow(/ISO/);
    expect(() => parseArgs(["--bogus"])).toThrow(/unknown/);
  });
});

describe("pm-cockpit — the connection is SELECT-only, proven before the first read", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = null;
  });

  async function seeded(): Promise<string> {
    dir = mkdtempSync(join(tmpdir(), "pm-cockpit-"));
    const url = `file:${join(dir, "db.sqlite")}`;
    const rw = await openDb({ url });
    await rw
      .insertInto("sites")
      .values({
        id: "recA",
        slug: "site-a",
        name: "Site A",
        url: "https://a.example.com",
        status: "Maintained",
      } as never)
      .execute();
    await rw.destroy();
    return url;
  }

  it("passes the UPDATE control, reads, and refuses a real UPDATE without touching the row", async () => {
    const url = await seeded();
    const ro = await openReadOnlyDb({ url });
    await expect(assertReadOnly(ro)).resolves.toBeUndefined();
    const got = await loadCockpitInputs(ro, NOW);
    expect(got.websites.map((w) => w.name)).toEqual(["Site A"]);
    await expect(
      ro
        .updateTable("sites")
        .set({ name: "Changed" } as never)
        .where("id", "=", "recA")
        .execute(),
    ).rejects.toThrow(/read-only/);
    await ro.destroy();
    const check = await openDb({ url });
    const row = await check
      .selectFrom("sites")
      .select("name")
      .where("id", "=", "recA")
      .executeTakeFirst();
    expect(row?.name).toBe("Site A");
    await check.destroy();
  });

  it("the control fails on a writable connection, so the script stops", async () => {
    const url = await seeded();
    const rw = await openDb({ url });
    await expect(assertReadOnly(rw)).rejects.toThrow(/can write/);
    await rw.destroy();
  });

  it("does not run migrations (openDb would)", async () => {
    dir = mkdtempSync(join(tmpdir(), "pm-cockpit-"));
    const url = `file:${join(dir, "fresh.sqlite")}`;
    const ro = await openReadOnlyDb({ url });
    await ro.destroy();
    const c = createClient({ url });
    const r = await c.execute("SELECT count(*) AS n FROM sqlite_master");
    c.close();
    expect(Number(r.rows[0]?.n)).toBe(0);
  });
});
