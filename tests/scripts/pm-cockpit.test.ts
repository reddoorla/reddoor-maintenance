/**
 * P1-35. `scripts/pm-cockpit.mts` gives the daily PM pass the cockpit's Needs-you
 * and Watch state. The positive control is a healthy site the formatter must not
 * list; the negative one is a site with one known attention item it must list.
 * A "just wait" vuln (src/alerts/waiting.ts) must stay out, new or not.
 */
import { createDeadLetter } from "../../src/db/deadletter.js";
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { openDb } from "../../src/db/client.js";
import type { WebsiteRow } from "../../src/fleet/site-row.js";
import type { DigestSnapshot } from "../../src/alerts/digest-state.js";
import type { ReportRow } from "../../src/reports/report-fields.js";
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
    deadLetterOldest: new Map(),
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
    expect(out.split("\n")[0]).toBe(
      "PM_COCKPIT_SUMMARY broken=0 attention=1 watch=0 approval=0 setup=0 sites=3",
    );
    expect(out).toContain("Broken Co · attention · /s/broken-co");
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
    expect(out.split("\n")[0]).toBe(
      "PM_COCKPIT_SUMMARY broken=1 attention=0 watch=0 approval=0 setup=0 sites=2",
    );
    expect(out).toContain("- Deploy Co · broken · /s/deploy-co");
    // P1-78b: a failed deploy is a `deploy:` item, so it is dated, and named once.
    expect(out).toContain("latest production deploy error (first flagged 2026-10-07)");
    expect(out.match(/latest production deploy/g)).toHaveLength(1);
  });

  it("a Renovate PR that rose to Attention today is NEW, dated the day it rose (P1-78b)", () => {
    const reno = site({
      id: "recRENO",
      name: "Reno Co",
      url: "https://reno.example.com",
      renovateFailingCis: 1,
      githubSignalsAt: NOW.toISOString(),
    });
    const base = inputs({ websites: [HEALTHY, reno] });
    const firstFlagged = new Date(NOW.getTime() - 7 * 86_400_000).toISOString().slice(0, 10);
    const prior = {
      ...base.prior,
      "renovate:recRENO": { metric: 1, firstFlaggedAt: firstFlagged },
    };
    const since = new Date(NOW.getTime() - 86_400_000).toISOString();
    const out = formatPmCockpit(buildPmCockpit({ ...base, prior }, NOW, since));
    const today = NOW.toISOString().slice(0, 10);
    expect(out).toContain("- NEW Reno Co · attention · /s/reno-co");
    expect(out).toContain(`1 Renovate PR failing CI (escalated ${today})`);
  });

  it("prints a stale url probe as Attention, not Broken (P1-78b)", () => {
    const unstamped = { ...HEALTHY, urlCheckedAt: null };
    const out = formatPmCockpit(buildPmCockpit(inputs({ websites: [unstamped] }), NOW));
    expect(out.split("\n")[0]).toBe(
      "PM_COCKPIT_SUMMARY broken=0 attention=1 watch=0 approval=0 setup=0 sites=1",
    );
    expect(out).toContain("- (fleet) · attention · (no site page)");
  });

  it("dates a failed deploy from the digest snapshot (P1-78b)", () => {
    const dead = site({
      id: "recDEP",
      name: "Deploy Co",
      url: "https://dep.example.com",
      deployStatus: "error",
    });
    const base = inputs({ websites: [HEALTHY, dead] });
    const prior = { ...base.prior, "deploy:recDEP": { metric: 1, firstFlaggedAt: "2026-10-03" } };
    const out = formatPmCockpit(buildPmCockpit({ ...base, prior }, NOW));
    expect(out).toContain("latest production deploy error (first flagged 2026-10-03)");
  });

  it("a launching site's failed deploy stays muted (P1-78b)", () => {
    const dead = site({
      id: "recDEP",
      name: "Deploy Co",
      url: "https://dep.example.com",
      status: "launching",
      deployStatus: "error",
    });
    const out = formatPmCockpit(buildPmCockpit(inputs({ websites: [HEALTHY, dead] }), NOW));
    expect(out).not.toContain("Deploy Co");
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
    // A slug no site owns is never held, so it is never "just wait" either.
    expect(out).toMatch(/just_wait_left_out=0\b/);
  });

  it("lists a dead letter for a slug no site owns", () => {
    const out = formatPmCockpit(
      buildPmCockpit(
        inputs({ websites: [HEALTHY], deadLetters: new Map([["ghost-site", 4]]) }),
        NOW,
      ),
    );
    expect(out.split("\n")[0]).toBe(
      "PM_COCKPIT_SUMMARY broken=1 attention=0 watch=0 approval=0 setup=0 sites=1",
    );
    expect(out).toContain("(unknown site: ghost-site) · broken · (no site page)");
  });
});

describe("pm-cockpit — a dead letter on a known site waits two replay cycles (OD 87)", () => {
  // NOW is 2026-10-07T12:00Z.
  const held = (oldest: string) =>
    buildPmCockpit(
      inputs({
        deadLetters: new Map([["healthy-co", 1]]),
        deadLetterOldest: new Map([["healthy-co", oldest]]),
      }),
      NOW,
    );

  it("aged 11 h 59 m: counted in just_wait_left_out and not listed", () => {
    const pm = held("2026-10-07T00:01:00.000Z");
    expect(pm.waitingKeys).toEqual(["deadletter:healthy-co", "vuln:recWAIT"]);
    const out = formatPmCockpit(pm);
    expect(out).toContain("just_wait_left_out=2");
    expect(out).not.toMatch(/Healthy Co|healthy-co/);
  });

  it("a held dead letter on an archived site counts in just_wait_left_out too", () => {
    const gone = site({ id: "recGONE", name: "Gone Co", status: "archived" });
    const pm = buildPmCockpit(
      inputs({
        websites: [BROKEN, HEALTHY, WAITING, gone],
        deadLetters: new Map([["gone-co", 1]]),
        deadLetterOldest: new Map([["gone-co", "2026-10-07T06:00:00.000Z"]]),
      }),
      NOW,
    );
    expect(pm.waitingKeys).toEqual(["deadletter:gone-co", "vuln:recWAIT"]);
    expect(formatPmCockpit(pm)).not.toMatch(/Gone Co|gone-co/);
  });

  it("an archived site's held dead letter is counted once, even when a visible site shares its slug", () => {
    const twin = site({ id: "recTWIN", name: "HEALTHY CO", status: "archived" });
    const pm = buildPmCockpit(
      inputs({
        websites: [BROKEN, HEALTHY, WAITING, twin],
        deadLetters: new Map([["healthy-co", 1]]),
        deadLetterOldest: new Map([["healthy-co", "2026-10-07T06:00:00.000Z"]]),
      }),
      NOW,
    );
    expect(pm.waitingKeys).toEqual(["deadletter:healthy-co", "vuln:recWAIT"]);
  });

  it("an archived site's escalated dead letter is listed with its page", () => {
    const gone = site({ id: "recGONE", name: "Gone Co", status: "archived" });
    const out = formatPmCockpit(
      buildPmCockpit(
        inputs({
          websites: [BROKEN, HEALTHY, WAITING, gone],
          deadLetters: new Map([["gone-co", 1]]),
          deadLetterOldest: new Map([["gone-co", "2026-10-06T08:00:00.000Z"]]),
        }),
        NOW,
      ),
    );
    expect(out).toContain("- Gone Co · broken · /s/gone-co");
    expect(out).not.toContain("(no site page)");
  });

  it("an escalated dead letter joins its site's existing row rather than listing it twice", () => {
    // An unrecognized Status already puts the site on Watch with its page; the
    // dead letter moves that one row to broken.
    const typo = site({ id: "recTYPO", name: "Typo Co", status: "actve" as never });
    const out = formatPmCockpit(
      buildPmCockpit(
        inputs({
          websites: [BROKEN, HEALTHY, WAITING, typo],
          deadLetters: new Map([["typo-co", 2]]),
          deadLetterOldest: new Map([["typo-co", "2026-10-06T00:00:00.000Z"]]),
        }),
        NOW,
      ),
    );
    expect(out.split("\n").filter((l) => l.startsWith("- Typo Co"))).toEqual([
      "- Typo Co · broken · /s/typo-co",
    ]);
    expect(out).toContain("2 leads dead-lettered, the oldest not replayed for 36 h");
  });

  it("an unparseable received_at holds nothing and is dated as first flagged", () => {
    const out = formatPmCockpit(
      buildPmCockpit(
        inputs({
          deadLetters: new Map([["healthy-co", 1]]),
          deadLetterOldest: new Map([["healthy-co", "garbage"]]),
        }),
        NOW,
      ),
    );
    expect(out).toContain("Healthy Co · broken · /s/healthy-co");
    expect(out).toMatch(/not yet replayed[^\n]*\(first flagged 2026-10-07\)/);
  });

  it("a cardless item that is not a dead letter never gets a site page", () => {
    // collectPreflightBlocked names a report's missing site "(unlinked site)" and
    // links the fleet root; there is no /s/ page for it.
    const out = formatPmCockpit(
      buildPmCockpit(
        inputs({
          reports: [
            {
              id: "recR",
              siteId: "recNOWHERE",
              reportType: "Maintenance",
              period: "2026-09",
              periodStart: null,
              periodEnd: null,
              gaUsersCurrent: null,
              gaUsersPrevious: null,
              draftReady: true,
              approvedToSend: true,
              sentAt: null,
              withdrawnAt: null,
              deliveryStatus: "pending",
            } as ReportRow,
          ],
        }),
        NOW,
      ),
    );
    expect(out).toContain("- (unlinked site) · attention · (no site page)");
    expect(out).not.toContain("/s/unlinked-site");
  });

  it("aged 28 h: listed as broken, dated the DAY its hold ran out, not today", () => {
    // Received 2026-10-06T08:00Z, so the hold ran out 2026-10-06T20:00Z; NOW is
    // 2026-10-07, so a reason dated "today" would be wrong.
    const pm = held("2026-10-06T08:00:00.000Z");
    expect(pm.waitingKeys).toEqual(["vuln:recWAIT"]);
    const out = formatPmCockpit(pm);
    expect(out).toContain("Healthy Co · broken · /s/healthy-co");
    expect(out).toContain("1 lead dead-lettered and not replayed for 28 h");
    expect(out).toContain("(escalated 2026-10-06)");
  });

  it("is dated by its escalation too when the digest saw it while it was held", () => {
    // The common production case: the daily digest wrote the key during the hold,
    // so the cockpit diffs it as standing, not new.
    const out = formatPmCockpit(
      buildPmCockpit(
        inputs({
          prior: { ...PRIOR, "deadletter:healthy-co": { metric: 1, firstFlaggedAt: "2026-10-05" } },
          deadLetters: new Map([["healthy-co", 1]]),
          deadLetterOldest: new Map([["healthy-co", "2026-10-06T08:00:00.000Z"]]),
        }),
        NOW,
      ),
    );
    expect(out).toContain("(escalated 2026-10-06)");
    expect(out).not.toContain("first flagged 2026-10-05");
  });
});

describe("pm-cockpit — a cardless item's flags and rows (#1570, #1571)", () => {
  // Typo Co's unrecognized Status puts it on Watch with an undated reason, so
  // only the dead letter it takes can make its row new or critical.
  const typo = site({ id: "recTYPO", name: "Typo Co", status: "actve" as never });
  const typoDeadLetter = {
    websites: [BROKEN, HEALTHY, WAITING, typo],
    deadLetters: new Map([["typo-co", 2]]),
    deadLetterOldest: new Map([["typo-co", "2026-10-06T00:00:00.000Z"]]),
  };
  const orphanReport = {
    id: "recR",
    siteId: "recNOWHERE",
    reportType: "Maintenance",
    period: "2026-09",
    periodStart: null,
    periodEnd: null,
    gaUsersCurrent: null,
    gaUsersPrevious: null,
    draftReady: true,
    approvedToSend: true,
    sentAt: null,
    withdrawnAt: null,
    deliveryStatus: "pending",
  } as ReportRow;
  const listedNames = (out: string): string[] =>
    out
      .split("\n")
      .filter((l) => l.startsWith("- "))
      .map((l) => l.split(" · ")[0]!);

  it("a Watch row that takes a dead letter escalated inside the window turns NEW", () => {
    const out = formatPmCockpit(
      buildPmCockpit(inputs(typoDeadLetter), NOW, "2026-10-05T00:00:00Z"),
    );
    expect(out).toContain("- NEW Typo Co · broken · /s/typo-co");
    // It escalated 2026-10-06, so a window from 10-07 does not make it new.
    const later = formatPmCockpit(
      buildPmCockpit(inputs(typoDeadLetter), NOW, "2026-10-07T00:00:00Z"),
    );
    expect(later).toContain("- Typo Co · broken · /s/typo-co");
  });

  it("a Watch row that takes a dead letter sorts as critical, ahead of a non-critical broken row", () => {
    const out = formatPmCockpit(buildPmCockpit(inputs(typoDeadLetter), NOW));
    expect(listedNames(out)).toEqual(["- Typo Co", "- Broken Co"]);
  });

  it("a standalone cardless dead letter is NEW inside the window, and sorts as critical", () => {
    const zed = site({ id: "recZED", name: "Zed Co", status: "archived" });
    const out = formatPmCockpit(
      buildPmCockpit(
        inputs({
          websites: [BROKEN, HEALTHY, WAITING, zed],
          deadLetters: new Map([["zed-co", 1]]),
          deadLetterOldest: new Map([["zed-co", "2026-10-06T08:00:00.000Z"]]),
        }),
        NOW,
        "2026-10-05T00:00:00Z",
      ),
    );
    expect(listedNames(out)).toEqual(["- NEW Zed Co", "- Broken Co"]);
    const later = formatPmCockpit(
      buildPmCockpit(
        inputs({
          websites: [BROKEN, HEALTHY, WAITING, zed],
          deadLetters: new Map([["zed-co", 1]]),
          deadLetterOldest: new Map([["zed-co", "2026-10-06T08:00:00.000Z"]]),
        }),
        NOW,
        "2026-10-07T00:00:00Z",
      ),
    );
    expect(listedNames(later)).toEqual(["- Zed Co", "- Broken Co"]);
  });

  it("two cardless items with no site page keep a row each", () => {
    const out = formatPmCockpit(
      buildPmCockpit(
        inputs({ reports: [orphanReport], deadLetters: new Map([["ghost-site", 1]]) }),
        NOW,
      ),
    );
    expect(out).toContain("- (unlinked site) · attention · (no site page)");
    expect(out).toContain("- (unknown site: ghost-site) · broken · (no site page)");
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
    expect(fresh).toContain("- NEW Exhausted Co · attention · /s/exhausted-co");
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
    expect(old).toContain("- Exhausted Co · attention · /s/exhausted-co");
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
    expect(out).toContain("- NEW Late Co · attention · /s/late-co");
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
      "PM_COCKPIT_SUMMARY broken=0 attention=2 watch=0 approval=0 setup=0 sites=4 new=1 since=2026-10-05T11:48:00Z",
    );
    expect(out).toContain("- NEW Fresh Co · attention · /s/fresh-co");
    expect(out).toContain("- Broken Co · attention · /s/broken-co");
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
      "PM_COCKPIT_SUMMARY broken=0 attention=0 watch=0 approval=0 setup=0 sites=2 new=0 since=2026-10-01T00:00:00Z",
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
    expect(out).toContain(
      "PM_COCKPIT_SUMMARY broken=0 attention=0 watch=1 approval=0 setup=0 sites=2 new=0",
    );
    expect(out).toContain("Watch Co · /s/watch-co · Performance 80 (undated)");
  });

  it("lists a Setup-only site under Setup, never counted as watch (#672 step 2)", () => {
    const gaps = site({
      id: "recGAP",
      name: "Gap Co",
      url: "https://gap.example.com",
      status: "maintained",
      ga4PropertyId: null,
      gitRepo: null,
    });
    const pm = buildPmCockpit(inputs({ websites: [HEALTHY, gaps] }), NOW);
    expect(pm.watch).toEqual([]);
    const out = formatPmCockpit(pm);
    expect(out.split("\n")[0]).toBe(
      "PM_COCKPIT_SUMMARY broken=0 attention=0 watch=0 approval=0 setup=1 sites=2",
    );
    expect(out).toContain(
      "## Setup (1)\n- Gap Co · /s/gap-co · GA4 property not recorded (reports carry no analytics); Git repo not recorded (checkout sweeps cannot clone this site)",
    );
    expect(out).not.toContain("Healthy Co");
  });

  it("lists a broken site's gap under Setup too, and orders Setup by name", () => {
    const broken = site({
      id: "recZB",
      name: "Zulu Broken",
      url: "https://zulu.example.com",
      pScore: 60,
      gitRepo: null,
    });
    const gap = site({
      id: "recAG",
      name: "Alpha Gap",
      url: "https://alpha.example.com",
      gitRepo: null,
    });
    const pm = buildPmCockpit(
      inputs({
        websites: [broken, gap],
        prior: {
          ...PRIOR,
          "lighthouse:recZB:performance": { metric: 40, firstFlaggedAt: "2026-10-01" },
        },
      }),
      NOW,
    );
    expect(pm.setup.map((e) => e.siteName)).toEqual(["Alpha Gap", "Zulu Broken"]);
    expect(pm.needsYou.map((e) => e.siteName)).toEqual(["Zulu Broken"]);
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
    await createDeadLetter(rw, {
      siteSlug: "site-a",
      payload: { email: "ada@example.com" },
      turnstile: { outcome: "pass", hostname: "a.example.com" },
      error: "Error: upstream 429 quota",
      receivedAt: new Date("2026-10-07T09:00:00.000Z"),
    });
    await rw.destroy();
    return url;
  }

  it("passes the UPDATE control, reads, and refuses a real UPDATE without touching the row", async () => {
    const url = await seeded();
    const ro = await openReadOnlyDb({ url });
    await expect(assertReadOnly(ro)).resolves.toBeUndefined();
    const got = await loadCockpitInputs(ro, NOW);
    expect(got.websites.map((w) => w.name)).toEqual(["Site A"]);
    // OD 87: the loader reads the hold's clock beside the count.
    expect(got.deadLetters.get("site-a")).toBe(1);
    expect(got.deadLetterOldest.get("site-a")).toBe("2026-10-07T09:00:00.000Z");
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
