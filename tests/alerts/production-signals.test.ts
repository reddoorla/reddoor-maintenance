/**
 * P1-78c: the production signals the alarms never read (workspace
 * briefs/2026-10-26-p1-78c-production-signals.md). Each collector reads a stored
 * verdict only beside a fresh stamp, lands on the ladder where the plan's table puts
 * it, and is registered on the surfaces its level needs.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  collectA11yAlerts,
  collectDepsAlerts,
  collectDomainAlerts,
  collectFormTestAlerts,
  collectFunctionHealthAlerts,
  collectLinkAlerts,
  collectRenderAlerts,
  collectSearchConsoleAlerts,
  collectSmokeAlerts,
  collectTitleMetaAlerts,
  collectUptimeAlerts,
  type LatestDeps,
} from "../../src/alerts/production-signals.js";
import { levelOf } from "../../src/alerts/ladder.js";
import type { AttentionItem } from "../../src/alerts/attention.js";
import { buildCockpitModel } from "../../src/dashboard/fleet-cockpit.js";
import { collectAttention } from "../../src/reports/digest.js";
import { summarizeBrowser } from "../../src/audits/browser.js";
import { browserFieldsFromAudit } from "../../src/audits/browser-fields.js";
import { auditFields } from "../../src/fleet/site-fields.js";
import { auditNeedsCheckout } from "../../src/cli/commands/audit.js";
import type { AuditName } from "../../src/types.js";
import type { WebsiteRow } from "../../src/fleet/site-row.js";
import { makeWebsiteRow } from "../_helpers/website-row.js";

const BASE = "https://cockpit.test";
const NOW = new Date("2026-10-26T12:00:00.000Z");
const FRESH = "2026-10-26T06:30:00.000Z";
/** Just past the 3-day window. */
const STALE = "2026-10-23T11:00:00.000Z";
const DAY = 86_400_000;
const ago = (days: number) => new Date(NOW.getTime() - days * DAY).toISOString();

const site = (over: Partial<WebsiteRow> = {}): WebsiteRow =>
  makeWebsiteRow({ id: "recS", name: "Sonder", status: "maintained", ...over });

const keys = (items: AttentionItem[]) => items.map((i) => i.key);
const level = (it: AttentionItem) => levelOf(it, undefined, NOW);

describe("site down (uptime, Broken)", () => {
  it("a fresh uptime fail is Broken", () => {
    const [it] = collectUptimeAlerts(
      [site({ reachableOk: "fail", browserCheckedAt: FRESH })],
      BASE,
      NOW,
    );
    expect(it!.key).toBe("uptime:recS");
    expect(level(it!)).toBe("broken");
  });

  it("an unreachable route never reads healthy: the cockpit card is Broken", () => {
    const m = buildCockpitModel(
      [site({ reachableOk: "fail", browserCheckedAt: FRESH })],
      [],
      {},
      BASE,
      NOW,
    );
    expect(m.cards[0]!.tier).toBe("broken");
  });

  it("a null stamp reads nothing, never a pass and never down", () => {
    expect(
      collectUptimeAlerts([site({ reachableOk: "fail", browserCheckedAt: null })], BASE, NOW),
    ).toEqual([]);
  });

  it("a stale fail reads nothing", () => {
    expect(
      collectUptimeAlerts([site({ reachableOk: "fail", browserCheckedAt: STALE })], BASE, NOW),
    ).toEqual([]);
  });

  it("a launching site's audits are not alarms", () => {
    expect(
      collectUptimeAlerts(
        [site({ status: "launching", reachableOk: "fail", browserCheckedAt: FRESH })],
        BASE,
        NOW,
      ),
    ).toEqual([]);
  });
});

describe("the writer stores null when nothing was sampled", () => {
  it("an audit that sampled no route stores no uptime verdict, so it never reads site down", () => {
    const summary = summarizeBrowser([], [], {});
    const fields = browserFieldsFromAudit({
      audit: "browser",
      site: "sonder",
      status: "warn",
      summary: "",
      details: { ...summary, checkedAt: FRESH },
    });
    expect(fields.reachableOk).toBeNull();
    expect(fields.linksOk).toBeNull();
    expect(fields.titleMetaOk).toBeNull();
    const cells = auditFields({ browser: fields });
    expect(cells["Uptime Reachable"]).toBeNull();
    expect(cells["Titles & Meta OK"]).toBeNull();
    expect(cells["Links OK"]).toBeNull();
  });

  it("a stored false is still a fail", () => {
    const fields = browserFieldsFromAudit({
      audit: "browser",
      site: "sonder",
      status: "warn",
      summary: "",
      details: { reachableOk: false, linksOk: false, titleMetaOk: false, checkedAt: FRESH },
    });
    const cells = auditFields({ browser: fields });
    expect(cells["Uptime Reachable"]).toBe("fail");
    expect(cells["Links OK"]).toBe(false);
  });
});

describe("domain and certificate", () => {
  it("a certificate at 7 days is Broken, at 8 Attention, at 30 Attention, at 31 nothing", () => {
    const at = (days: number) =>
      collectDomainAlerts([site({ certDaysRemaining: days, domainCheckedAt: FRESH })], BASE, NOW);
    expect(at(7).map(level)).toEqual(["broken"]);
    expect(keys(at(7))).toEqual(["cert-expiring:recS"]);
    expect(at(8).map(level)).toEqual(["attention"]);
    expect(keys(at(8))).toEqual(["cert:recS"]);
    expect(at(30).map(level)).toEqual(["attention"]);
    expect(at(31)).toEqual([]);
  });

  it("an expired certificate is Broken and says so", () => {
    const [it] = collectDomainAlerts(
      [site({ certDaysRemaining: -2, domainCheckedAt: FRESH })],
      BASE,
      NOW,
    );
    expect(level(it!)).toBe("broken");
    expect(it!.title).toContain("expired");
  });

  it("a fresh run with no certificate days is a dead domain, Broken", () => {
    const [it] = collectDomainAlerts(
      [site({ certDaysRemaining: null, domainCheckedAt: FRESH })],
      BASE,
      NOW,
    );
    expect(it!.key).toBe("domain:recS");
    expect(level(it!)).toBe("broken");
  });

  it("no certificate days beside a stale stamp is not a dead domain: nothing ran", () => {
    expect(
      collectDomainAlerts([site({ certDaysRemaining: null, domainCheckedAt: STALE })], BASE, NOW),
    ).toEqual([]);
    expect(
      collectDomainAlerts([site({ certDaysRemaining: 3, domainCheckedAt: null })], BASE, NOW),
    ).toEqual([]);
  });
});

describe("server function and CMS (Broken)", () => {
  it("a fresh function-health fail and a fresh CMS fail are each Broken", () => {
    const items = collectFunctionHealthAlerts(
      [site({ functionHealth: "fail", cmsReachable: "fail", functionHealthCheckedAt: FRESH })],
      BASE,
      NOW,
    );
    expect(keys(items)).toEqual(["function-health:recS", "cms:recS"]);
    expect(items.map(level)).toEqual(["broken", "broken"]);
  });

  it("a stale stamp reads nothing", () => {
    expect(
      collectFunctionHealthAlerts(
        [site({ functionHealth: "fail", cmsReachable: "fail", functionHealthCheckedAt: STALE })],
        BASE,
        NOW,
      ),
    ).toEqual([]);
  });
});

describe("pages fail to render (Broken)", () => {
  it("a fresh desktop or mobile fail is Broken, naming where", () => {
    const [it] = collectRenderAlerts(
      [site({ crossbrowserOk: true, mobileOk: false, browserCheckedAt: FRESH })],
      BASE,
      NOW,
    );
    expect(level(it!)).toBe("broken");
    expect(it!.title).toContain("mobile");
    expect(
      collectRenderAlerts(
        [site({ crossbrowserOk: false, mobileOk: true, browserCheckedAt: STALE })],
        BASE,
        NOW,
      ),
    ).toEqual([]);
  });
});

describe("the live form test (Broken)", () => {
  it("a fresh fail is Broken", () => {
    const [it] = collectFormTestAlerts(
      [site({ formE2eOk: "fail", formE2eCheckedAt: FRESH })],
      BASE,
      NOW,
    );
    expect(level(it!)).toBe("broken");
  });

  it("a fail stamped 4 days ago reads nothing", () => {
    expect(
      collectFormTestAlerts([site({ formE2eOk: "fail", formE2eCheckedAt: ago(4) })], BASE, NOW),
    ).toEqual([]);
  });

  it("no form (null verdict, fresh stamp) is not an alarm", () => {
    expect(
      collectFormTestAlerts([site({ formE2eOk: null, formE2eCheckedAt: FRESH })], BASE, NOW),
    ).toEqual([]);
  });
});

describe("broken links (Attention)", () => {
  it("a fresh links fail with broken links named is Attention", () => {
    const [it] = collectLinkAlerts(
      [site({ linksOk: false, brokenLinks: 2, browserCheckedAt: FRESH })],
      BASE,
      NOW,
    );
    expect(level(it!)).toBe("attention");
    expect(it!.title).toBe("2 broken links");
  });

  it("a links fail that named no broken link (no link checked) is nothing", () => {
    expect(
      collectLinkAlerts(
        [site({ linksOk: false, brokenLinks: 0, browserCheckedAt: FRESH })],
        BASE,
        NOW,
      ),
    ).toEqual([]);
    expect(
      collectLinkAlerts(
        [site({ linksOk: null, brokenLinks: 0, browserCheckedAt: FRESH })],
        BASE,
        NOW,
      ),
    ).toEqual([]);
  });
});

describe("titles and meta (Attention)", () => {
  it("a fresh fail is Attention; a stale one nothing", () => {
    const [it] = collectTitleMetaAlerts(
      [site({ titleMetaOk: "fail", browserCheckedAt: FRESH })],
      BASE,
      NOW,
    );
    expect(level(it!)).toBe("attention");
    expect(
      collectTitleMetaAlerts([site({ titleMetaOk: "fail", browserCheckedAt: STALE })], BASE, NOW),
    ).toEqual([]);
  });
});

describe("accessibility (Attention, weekly)", () => {
  const complete = { a11yViolations: 3, a11yRoutesScanned: 8, a11yRoutesTotal: 8 };

  it("violations from a complete run stamped within 8 days are Attention", () => {
    const [it] = collectA11yAlerts([site({ ...complete, a11yCheckedAt: ago(5) })], BASE, NOW);
    expect(level(it!)).toBe("attention");
    expect(it!.title).toBe("3 accessibility violations");
    expect(
      collectA11yAlerts([site({ ...complete, a11yCheckedAt: ago(7.9) })], BASE, NOW),
    ).toHaveLength(1);
  });

  it("a stale or missing stamp reads nothing", () => {
    expect(collectA11yAlerts([site({ ...complete, a11yCheckedAt: ago(8.1) })], BASE, NOW)).toEqual(
      [],
    );
    expect(collectA11yAlerts([site({ ...complete, a11yCheckedAt: null })], BASE, NOW)).toEqual([]);
  });

  it("a partial run (fewer routes scanned than given) is not measured", () => {
    expect(
      collectA11yAlerts(
        [site({ ...complete, a11yRoutesScanned: 7, a11yCheckedAt: FRESH })],
        BASE,
        NOW,
      ),
    ).toEqual([]);
    expect(
      collectA11yAlerts(
        [site({ ...complete, a11yRoutesScanned: null, a11yCheckedAt: FRESH })],
        BASE,
        NOW,
      ),
    ).toEqual([]);
  });
});

describe("dependencies behind (Attention past 90 days, else Watch)", () => {
  const reading = (
    firstSeen: Record<string, string>,
    packages: string[] | null = null,
  ): LatestDeps => ({
    night: "2026-10-25",
    sites: {
      recS: {
        name: "Sonder",
        packages: packages ?? Object.keys(firstSeen),
        at: FRESH,
        firstSeen,
      },
    },
  });

  it("a package 91 calendar days behind is Attention; 90 or 89 is Watch", () => {
    const at = (first: string) =>
      collectDepsAlerts([site()], reading({ "svelte@4": first }), BASE, NOW);
    expect(keys(at("2026-07-26").far)).toEqual(["deps-far:recS"]);
    expect(at("2026-07-26").far.map(level)).toEqual(["attention"]);
    expect(at("2026-07-27").far).toEqual([]);
    expect(keys(at("2026-07-28").behind)).toEqual(["deps:recS"]);
    expect(at("2026-07-28").behind.map(level)).toEqual(["watch"]);
  });

  it("a site whose packages rotate, each under 90 days, never reaches Attention", () => {
    const d = collectDepsAlerts(
      [site()],
      reading({ "vite@5": "2026-08-01", "svelte@4": "2026-09-15", "kit@1": "2026-10-20" }),
      BASE,
      NOW,
    );
    expect(d.far).toEqual([]);
    expect(d.behind).toHaveLength(1);
  });

  it("a night with no reading uses the run carried through it, unreset", () => {
    const d = collectDepsAlerts([site()], reading({ "svelte@4": "2026-07-01" }, null), BASE, NOW);
    // packages: null (no reading tonight): the carried run still ages.
    const noReading: LatestDeps = {
      night: "2026-10-25",
      sites: {
        recS: {
          name: "Sonder",
          packages: null,
          at: FRESH,
          firstSeen: { "svelte@4": "2026-07-01" },
        },
      },
    };
    expect(keys(collectDepsAlerts([site()], noReading, BASE, NOW).far)).toEqual(["deps-far:recS"]);
    expect(keys(d.far)).toEqual(["deps-far:recS"]);
  });

  it("a stale list or no fleet_daily row reads nothing", () => {
    const stale: LatestDeps = {
      night: "2026-10-25",
      sites: {
        recS: {
          name: "Sonder",
          packages: ["svelte@4"],
          at: STALE,
          firstSeen: { "svelte@4": "2026-01-01" },
        },
      },
    };
    expect(collectDepsAlerts([site()], stale, BASE, NOW)).toEqual({ far: [], behind: [] });
    expect(collectDepsAlerts([site()], null, BASE, NOW)).toEqual({ far: [], behind: [] });
  });
});

describe("Watch signals", () => {
  it("a fresh smoke fail is Watch, never Attention", () => {
    const [it] = collectSmokeAlerts([site({ smokeOk: "fail", lastSmokeAt: FRESH })], BASE, NOW);
    expect(level(it!)).toBe("watch");
  });

  it("a prior smoke fail stamped more than 3 days ago reads nothing", () => {
    expect(
      collectSmokeAlerts([site({ smokeOk: "fail", lastSmokeAt: ago(3.5) })], BASE, NOW),
    ).toEqual([]);
  });

  it("a Search Console soft-fail within the report cadence is Watch; resolved and no-property are not", () => {
    const sc = (outcome: WebsiteRow["searchConsoleOutcome"], at = FRESH) =>
      collectSearchConsoleAlerts(
        [
          site({
            searchConsoleOutcome: outcome,
            searchConsoleCheckedAt: at,
            maintenanceFreq: "Monthly",
          }),
        ],
        BASE,
        NOW,
      );
    expect(sc("soft-fail").map(level)).toEqual(["watch"]);
    expect(sc("resolved")).toEqual([]);
    expect(sc("no-property")).toEqual([]);
    expect(sc("soft-fail", ago(60))).toEqual([]);
  });
});

/** One maintained site carrying every new signal at once. */
const everything = site({
  reachableOk: "fail",
  browserCheckedAt: FRESH,
  certDaysRemaining: 5,
  domainCheckedAt: FRESH,
  functionHealth: "fail",
  cmsReachable: "fail",
  functionHealthCheckedAt: FRESH,
  crossbrowserOk: false,
  mobileOk: true,
  formE2eOk: "fail",
  formE2eCheckedAt: FRESH,
  linksOk: false,
  brokenLinks: 1,
  titleMetaOk: "fail",
  a11yViolations: 2,
  a11yRoutesScanned: 4,
  a11yRoutesTotal: 4,
  a11yCheckedAt: FRESH,
  smokeOk: "fail",
  lastSmokeAt: FRESH,
  searchConsoleOutcome: "soft-fail",
  searchConsoleCheckedAt: FRESH,
  maintenanceFreq: "Monthly",
});
const farDeps: LatestDeps = {
  night: "2026-10-25",
  sites: {
    recS: {
      name: "Sonder",
      packages: ["svelte@4"],
      at: FRESH,
      firstSeen: { "svelte@4": "2026-06-01" },
    },
  },
};
const BROKEN_AND_ATTENTION = [
  "uptime:recS",
  "cert-expiring:recS",
  "function-health:recS",
  "cms:recS",
  "render:recS",
  "links:recS",
  "titles:recS",
  "a11y:recS",
  "deps-far:recS",
];

describe("registration: Broken and Attention in both lists, Watch in the cockpit's only", () => {
  it("the cockpit carries every new signal, Watch included", () => {
    const m = buildCockpitModel(
      [everything],
      [],
      {},
      BASE,
      NOW,
      [],
      null,
      [],
      0,
      new Map(),
      new Map(),
      new Map(),
      farDeps,
    );
    const onCard = keys(m.cards[0]!.items);
    for (const k of BROKEN_AND_ATTENTION) expect(onCard).toContain(k);
    expect(onCard).toContain("search-console:recS");
    expect(m.cards[0]!.tier).toBe("broken");
  });

  it("the digest collects every Broken and Attention signal, so each one ages", async () => {
    const items = await collectAttention({
      baseUrl: BASE,
      websites: [everything],
      reports: [],
      now: NOW,
      notifyBounces: new Map(),
      deadLetters: new Map(),
      fleetDeps: farDeps,
    });
    const k = keys(items);
    for (const want of BROKEN_AND_ATTENTION) expect(k).toContain(want);
  });

  it("the digest never collects a Watch signal (smoke, dependencies behind, Search Console)", async () => {
    const behind: LatestDeps = {
      night: "2026-10-25",
      sites: {
        recS: {
          name: "Sonder",
          packages: ["svelte@4"],
          at: FRESH,
          firstSeen: { "svelte@4": "2026-10-20" },
        },
      },
    };
    const items = await collectAttention({
      baseUrl: BASE,
      websites: [everything],
      reports: [],
      now: NOW,
      notifyBounces: new Map(),
      deadLetters: new Map(),
      fleetDeps: behind,
    });
    const k = keys(items);
    expect(k).not.toContain("smoke:recS");
    expect(k).not.toContain("deps:recS");
    expect(k).not.toContain("search-console:recS");
  });
});

describe("the form test and smoke are built but not wired (the operator, 2026-10-26)", () => {
  // Every 10-26 failure of both was false (#1736, #1737, #1777): each is registered
  // by a one-line follow-up once its probe is fixed.
  it("neither reaches the cockpit nor the digest", async () => {
    const m = buildCockpitModel([everything], [], {}, BASE, NOW);
    const onCard = keys(m.cards[0]!.items);
    expect(onCard).not.toContain("form:recS");
    expect(onCard).not.toContain("smoke:recS");
    const items = await collectAttention({
      baseUrl: BASE,
      websites: [everything],
      reports: [],
      now: NOW,
      notifyBounces: new Map(),
      deadLetters: new Map(),
    });
    expect(keys(items)).not.toContain("form:recS");
  });
});

describe("fleet-lighthouse stays checkout-free", () => {
  it("its --only list needs no checkout (a11y and smoke would clone every site)", () => {
    const yml = readFileSync(".github/workflows/fleet-lighthouse.yml", "utf8");
    const only = /--only ([a-z,-]+)/.exec(yml)![1]!.split(",") as AuditName[];
    expect(only).not.toContain("a11y");
    expect(
      auditNeedsCheckout(
        { name: "s", path: "/x", deployedUrl: "https://s.example", netlifyId: "n" } as never,
        only,
      ),
    ).toBe(false);
  });
});
