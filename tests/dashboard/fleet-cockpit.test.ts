import { describe, it, expect } from "vitest";
import {
  assignTier,
  buildCockpitModel,
  fleetLastAuditedAt,
  buildNeedsYouFeed,
} from "../../src/dashboard/fleet-cockpit.js";
import type {
  SiteCard,
  CockpitModel,
  CockpitSummary,
  PendingEntry,
} from "../../src/dashboard/fleet-cockpit.js";
import type { WebsiteRow } from "../../src/reports/airtable/websites.js";
import type { AttentionItem } from "../../src/alerts/attention.js";
import type { ReportRow } from "../../src/reports/airtable/reports.js";
import type { DigestSnapshot } from "../../src/alerts/digest-state.js";
import { siteSlug } from "../../src/reports/airtable/websites.js";
import { makeWebsiteRow } from "../_helpers/website-row.js";

const NOW = new Date("2026-06-11T12:00:00Z");

function site(over: Partial<WebsiteRow> = {}): WebsiteRow {
  return makeWebsiteRow({
    pointOfContact: "Tucker",
    maintenanceFreq: "Monthly",
    reportRecipientsTo: "t@x.com",
    pScore: 95,
    rScore: 95,
    bpScore: 95,
    seoScore: 95,
    lastLighthouseAuditAt: "2026-06-10T12:00:00Z",
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

function item(over: Partial<AttentionItem> = {}): AttentionItem {
  return {
    key: "vuln:recSITE",
    kind: "vuln",
    siteName: "Acme Co",
    title: "1 critical/high vuln",
    severity: "critical",
    metric: 1,
    ...over,
  };
}

describe("assignTier", () => {
  it("is 'attention' when the site has any attention item", () => {
    const r = assignTier(site(), [item()], NOW);
    expect(r.tier).toBe("attention");
    expect(r.watchReasons).toEqual([]);
  });

  it("is 'watch' on a Lighthouse score in [75,85) with no attention items", () => {
    const r = assignTier(site({ pScore: 80 }), [], NOW);
    expect(r.tier).toBe("watch");
    expect(r.watchReasons).toContain("Performance 80");
  });

  it("is 'watch' when the last commit is older than 30 days", () => {
    const r = assignTier(site({ lastCommitAt: "2026-04-01T00:00:00Z" }), [], NOW);
    expect(r.tier).toBe("watch");
    expect(r.watchReasons.some((s) => /ago/.test(s))).toBe(true);
  });

  it("does NOT treat a site with no last commit (null) as stale", () => {
    const r = assignTier(site({ lastCommitAt: null }), [], NOW);
    expect(r.tier).toBe("healthy");
  });

  it("is 'healthy' when clean and recently audited", () => {
    expect(assignTier(site(), [], NOW).tier).toBe("healthy");
  });

  it("a score below the floor (handled as an attention item) is NOT double-counted as watch", () => {
    // pScore 60 would be an attention item upstream; assignTier sees the item → attention.
    const r = assignTier(
      site({ pScore: 60 }),
      [item({ kind: "lighthouse", severity: "warning" })],
      NOW,
    );
    expect(r.tier).toBe("attention");
  });

  it("is 'attention' when the latest production deploy failed (no other items)", () => {
    expect(assignTier(site({ deployStatus: "error" }), [], NOW).tier).toBe("attention");
    expect(assignTier(site({ deployStatus: "failed" }), [], NOW).tier).toBe("attention");
  });

  it("does NOT escalate a ready / building / unknown deploy to attention", () => {
    expect(assignTier(site({ deployStatus: "ready" }), [], NOW).tier).toBe("healthy");
    expect(assignTier(site({ deployStatus: "building" }), [], NOW).tier).toBe("healthy");
    expect(assignTier(site({ deployStatus: null }), [], NOW).tier).toBe("healthy");
  });

  it("mutes a pre-live 'launch period' site to 'pre-launch' even with attention items", () => {
    // The lifecycle short-circuit beats the items>0 rule: a not-yet-live site's
    // expected pre-launch failures must never read as broken.
    const r = assignTier(site({ status: "launch period" }), [item()], NOW);
    expect(r.tier).toBe("pre-launch");
    expect(r.watchReasons).toEqual([]);
  });

  it("mutes a 'launch period' site to 'pre-launch' even with a failed deploy", () => {
    expect(assignTier(site({ status: "launch period", deployStatus: "error" }), [], NOW).tier).toBe(
      "pre-launch",
    );
  });

  it("routes an accepted Lighthouse watch category to acceptedReasons and stays healthy", () => {
    const r = assignTier(
      site({ bpScore: 78, acceptedWatchConditions: ["Best Practices"] }),
      [],
      NOW,
    );
    expect(r.tier).toBe("healthy");
    expect(r.watchReasons).toEqual([]);
    expect(r.acceptedReasons).toEqual(["Best Practices 78"]);
  });

  it("still watches an un-accepted Lighthouse category", () => {
    const r = assignTier(site({ bpScore: 78 }), [], NOW);
    expect(r.tier).toBe("watch");
    expect(r.watchReasons).toEqual(["Best Practices 78"]);
    expect(r.acceptedReasons).toEqual([]);
  });

  it("keeps watching an un-accepted reason while accepting another on the same site", () => {
    const r = assignTier(
      site({
        bpScore: 78,
        lastCommitAt: "2026-04-01T00:00:00Z",
        acceptedWatchConditions: ["Best Practices"],
      }),
      [],
      NOW,
    );
    expect(r.tier).toBe("watch");
    expect(r.watchReasons).not.toContain("Best Practices 78");
    expect(r.watchReasons.some((x) => x.startsWith("last commit"))).toBe(true);
    expect(r.acceptedReasons).toEqual(["Best Practices 78"]);
  });

  it("accepts the stale-repo condition", () => {
    const r = assignTier(
      site({ lastCommitAt: "2026-04-01T00:00:00Z", acceptedWatchConditions: ["stale repo"] }),
      [],
      NOW,
    );
    expect(r.tier).toBe("healthy");
    expect(r.acceptedReasons.some((x) => x.startsWith("last commit"))).toBe(true);
  });

  it("accepts the no-custom-domain condition", () => {
    const r = assignTier(
      site({
        status: "maintenance",
        url: "https://foo.netlify.app/",
        acceptedWatchConditions: ["no custom domain"],
      }),
      [],
      NOW,
    );
    expect(r.tier).toBe("healthy");
    expect(r.acceptedReasons).toContain("on *.netlify.app (no custom domain)");
  });

  it("matches accepted conditions case-insensitively", () => {
    const r = assignTier(
      site({ bpScore: 78, acceptedWatchConditions: ["best practices"] }),
      [],
      NOW,
    );
    expect(r.tier).toBe("healthy");
    expect(r.acceptedReasons).toEqual(["Best Practices 78"]);
  });

  it("does not list an accepted condition that isn't currently active", () => {
    const r = assignTier(
      site({ bpScore: 95, acceptedWatchConditions: ["Best Practices"] }),
      [],
      NOW,
    );
    expect(r.tier).toBe("healthy");
    expect(r.acceptedReasons).toEqual([]);
  });

  it("returns empty acceptedReasons when the site has attention items", () => {
    const r = assignTier(site({ acceptedWatchConditions: ["Best Practices"] }), [item()], NOW);
    expect(r.tier).toBe("attention");
    expect(r.acceptedReasons).toEqual([]);
  });
});

describe("assignTier — generic accept-key matcher + discoverability", () => {
  it("accepts the no-custom-domain watch via the friendly alias 'netlify'", () => {
    const r = assignTier(
      site({
        status: "maintenance",
        url: "https://foo.netlify.app/",
        acceptedWatchConditions: ["netlify"],
      }),
      [],
      NOW,
    );
    expect(r.tier).toBe("healthy");
    expect(r.acceptedReasons).toContain("on *.netlify.app (no custom domain)");
    expect(r.watchReasons).toEqual([]);
  });

  it("still accepts the no-custom-domain watch via canonical 'no custom domain' (back-compat)", () => {
    const r = assignTier(
      site({
        status: "maintenance",
        url: "https://foo.netlify.app/",
        acceptedWatchConditions: ["no custom domain"],
      }),
      [],
      NOW,
    );
    expect(r.tier).toBe("healthy");
    expect(r.acceptedReasons).toContain("on *.netlify.app (no custom domain)");
  });

  it("exposes the primary accept key aligned to each un-accepted watch reason", () => {
    const r = assignTier(site({ status: "maintenance", url: "https://foo.netlify.app/" }), [], NOW);
    expect(r.tier).toBe("watch");
    expect(r.watchReasons).toEqual(["on *.netlify.app (no custom domain)"]);
    expect(r.watchAcceptKeys).toEqual(["no custom domain"]);
  });

  it("keys Lighthouse acceptance on the category label, tolerating a changed score", () => {
    // Accepted earlier at some score; today it reads 78 (still in [75,85)) → muted.
    const r = assignTier(site({ pScore: 78, acceptedWatchConditions: ["performance"] }), [], NOW);
    expect(r.tier).toBe("healthy");
    expect(r.acceptedReasons).toEqual(["Performance 78"]);
    expect(r.watchAcceptKeys).toEqual([]);
  });

  it("surfaces the Lighthouse category label as its accept key when un-accepted", () => {
    const r = assignTier(site({ pScore: 80 }), [], NOW);
    expect(r.watchReasons).toEqual(["Performance 80"]);
    expect(r.watchAcceptKeys).toEqual(["performance"]);
  });

  it("accepts the stale-repo watch via the short alias 'stale'", () => {
    const r = assignTier(
      site({ lastCommitAt: "2026-01-01T00:00:00Z", acceptedWatchConditions: ["stale"] }),
      [],
      NOW,
    );
    expect(r.tier).toBe("healthy");
    expect(r.acceptedReasons.some((x) => x.startsWith("last commit"))).toBe(true);
  });

  it("mutes only the accepted ones among several simultaneous watch conditions", () => {
    const r = assignTier(
      site({
        status: "maintenance",
        url: "https://foo.netlify.app/",
        bpScore: 78,
        lastCommitAt: "2026-01-01T00:00:00Z",
        acceptedWatchConditions: ["best practices", "stale"],
      }),
      [],
      NOW,
    );
    expect(r.tier).toBe("watch");
    expect(r.acceptedReasons).toContain("Best Practices 78");
    expect(r.acceptedReasons.some((x) => x.startsWith("last commit"))).toBe(true);
    // netlify is the only un-accepted watch → the sole watch reason + key + signal.
    expect(r.watchReasons).toEqual(["on *.netlify.app (no custom domain)"]);
    expect(r.watchAcceptKeys).toEqual(["no custom domain"]);
    expect(r.watchSignals).toEqual(["no-domain"]);
  });
});

const BASE = "https://reddoor-maintenance.netlify.app";

function report(over: Partial<ReportRow> = {}): ReportRow {
  return {
    id: "recRPT",
    siteId: "recSITE",
    reportType: "Maintenance",
    period: "2026-05",
    periodStart: null,
    periodEnd: null,
    gaUsersCurrent: null,
    gaUsersPrevious: null,
    draftReady: true,
    approvedToSend: false,
    sentAt: null,
    deliveryStatus: "pending",
    ...over,
  } as ReportRow;
}

describe("buildCockpitModel", () => {
  it("only includes Status-visible sites (maintenance or launch period)", () => {
    const m = buildCockpitModel(
      [
        site({ id: "a", name: "Maintained", status: "maintenance" }),
        site({ id: "b", name: "Launching", status: "launch period" }),
        site({ id: "c", name: "Hosted", status: "hosting" }),
        site({ id: "d", name: "Deprecated", status: "deprecated" }),
        site({ id: "e", name: "NoStatus", status: null }),
      ],
      [],
      {},
      BASE,
      NOW,
    );
    expect(m.cards.map((c) => c.site.name).sort()).toEqual(["Launching", "Maintained"]);
  });

  it("tiers a vuln site as attention and a clean site as healthy", () => {
    const m = buildCockpitModel(
      [
        site({ id: "a", name: "Bad", securityVulnsCritical: 2, securityVulnsHigh: 1 }),
        site({ id: "b", name: "Good" }),
      ],
      [],
      {},
      BASE,
      NOW,
    );
    const bad = m.cards.find((c) => c.site.name === "Bad")!;
    const good = m.cards.find((c) => c.site.name === "Good")!;
    expect(bad.tier).toBe("attention");
    expect(bad.items).toHaveLength(1);
    expect(good.tier).toBe("healthy");
    expect(m.summary).toMatchObject({ attention: 1, healthy: 1, criticalHighVulns: 3 });
  });

  it("mutes a pre-live 'launch period' site to pre-launch, never broken nor in the feed", () => {
    const m = buildCockpitModel(
      [
        site({
          id: "p",
          name: "Launching",
          status: "launch period",
          securityVulnsCritical: 2, // would be 🔴 attention on a live site
        }),
      ],
      [],
      {},
      BASE,
      NOW,
    );
    const card = m.cards.find((c) => c.site.name === "Launching")!;
    expect(card.tier).toBe("pre-launch");
    expect(m.summary.attention).toBe(0);
    expect(m.summary.preLaunch).toBe(1);
    // A pre-launch card must never surface as "needs you" (not broken).
    const feed = buildNeedsYouFeed(m);
    expect(feed.some((r) => r.siteName === "Launching")).toBe(false);
  });

  it("tags items NEW/WORSE from the prior snapshot but never returns a written snapshot", () => {
    const prior: DigestSnapshot = { "vuln:a": { metric: 1, firstFlaggedAt: "2026-06-01" } };
    const m = buildCockpitModel(
      [site({ id: "a", name: "Bad", securityVulnsCritical: 3, securityVulnsHigh: 0 })], // metric 3 > prior 1
      [],
      prior,
      BASE,
      NOW,
    );
    expect(m.cards[0]!.items[0]!.status).toBe("worse");
    // model has no `next`/snapshot field — read-only contract
    expect((m as Record<string, unknown>).next).toBeUndefined();
  });

  it("sorts attention worst-first: critical before warning, then higher total metric", () => {
    const m = buildCockpitModel(
      [
        site({ id: "a", name: "WarnOnly", securityVulnsCritical: 0, securityVulnsHigh: 5 }),
        site({ id: "b", name: "CritLow", securityVulnsCritical: 1, securityVulnsHigh: 0 }),
        site({ id: "c", name: "CritHigh", securityVulnsCritical: 4, securityVulnsHigh: 0 }),
      ],
      [],
      {},
      BASE,
      NOW,
    );
    const attn = m.cards.filter((c) => c.tier === "attention").map((c) => c.site.name);
    expect(attn).toEqual(["CritHigh", "CritLow", "WarnOnly"]);
  });

  it("orders tiers attention → watch → healthy, alphabetical within watch/healthy", () => {
    const m = buildCockpitModel(
      [
        site({ id: "h2", name: "Zeta" }),
        site({ id: "h1", name: "Alpha" }),
        site({ id: "w", name: "Mid", pScore: 80 }),
        site({ id: "a", name: "Bad", securityVulnsCritical: 1 }),
      ],
      [],
      {},
      BASE,
      NOW,
    );
    expect(m.cards.map((c) => c.tier)).toEqual(["attention", "watch", "healthy", "healthy"]);
    expect(m.cards.map((c) => c.site.name)).toEqual(["Bad", "Mid", "Alpha", "Zeta"]);
  });

  it("builds pending entries from draft-ready∧¬approved∧¬sent reports, resolving the site name", () => {
    const m = buildCockpitModel(
      [site({ id: "recSITE", name: "Acme Co" })],
      [
        report({ id: "r1", siteId: "recSITE", period: "2026-05" }),
        report({ id: "r2", siteId: "recSITE", approvedToSend: true }), // already approved → excluded
        report({ id: "r3", siteId: "recSITE", sentAt: "2026-05-02" }), // already sent → excluded
      ],
      {},
      BASE,
      NOW,
    );
    expect(m.pending).toEqual([
      {
        reportId: "r1",
        siteName: "Acme Co",
        slug: "acme-co",
        reportType: "Maintenance",
        period: "2026-05",
      },
    ]);
    expect(m.summary.pending).toBe(1);
  });

  it("counts lighthouse-below-floor and delivery failures in the summary", () => {
    const m = buildCockpitModel(
      [site({ id: "a", name: "Slow", pScore: 60, bpScore: 50 })],
      [report({ id: "rb", siteId: "a", deliveryStatus: "bounced" })],
      {},
      BASE,
      NOW,
    );
    expect(m.summary.lighthouseBelowFloor).toBe(2); // pScore + bpScore both < 75
    expect(m.summary.deliveryFailures).toBe(1);
  });
});

describe("assignTier — structured watchSignals", () => {
  it("tags 'lighthouse' for a watch-band score and 'stale' for an old commit", () => {
    const both = assignTier(site({ pScore: 80, lastCommitAt: "2026-01-01T00:00:00Z" }), [], NOW);
    expect(both.watchSignals).toContain("lighthouse");
    expect(both.watchSignals).toContain("stale");
  });

  it("is empty for attention and healthy sites", () => {
    expect(assignTier(site(), [item()], NOW).watchSignals).toEqual([]);
    expect(assignTier(site(), [], NOW).watchSignals).toEqual([]);
  });

  it("flags a maintenance site still on *.netlify.app (no custom domain) as watch", () => {
    const r = assignTier(
      site({ status: "maintenance", url: "https://vineyard-custom-homes.netlify.app" }),
      [],
      NOW,
    );
    expect(r.tier).toBe("watch");
    expect(r.watchSignals).toContain("no-domain");
    expect(r.watchReasons.some((s) => /netlify\.app/.test(s))).toBe(true);
  });

  it("does NOT flag a maintenance site that has a custom domain", () => {
    const r = assignTier(site({ status: "maintenance", url: "https://acme.example.com" }), [], NOW);
    expect(r.watchSignals).not.toContain("no-domain");
  });

  it("does NOT flag a launch-period site on *.netlify.app (no domain is expected pre-launch)", () => {
    const r = assignTier(
      site({ status: "launch period", url: "https://espada.netlify.app" }),
      [],
      NOW,
    );
    expect(r.watchSignals).not.toContain("no-domain");
  });
});

describe("buildCockpitModel — GitHub signals (slice 2b)", () => {
  it("tiers a Renovate-failing site and a CI-red site as attention, and counts them", () => {
    const m = buildCockpitModel(
      [
        site({ id: "a", name: "Reno", renovateFailingCis: 2 }),
        site({ id: "b", name: "CiRed", defaultBranchCi: "failing" }),
      ],
      [],
      {},
      BASE,
      NOW,
    );
    expect(m.cards.find((c) => c.site.name === "Reno")!.tier).toBe("attention");
    expect(m.cards.find((c) => c.site.name === "CiRed")!.tier).toBe("attention");
    expect(m.summary).toMatchObject({ renovateFailing: 2, ciRed: 1, attention: 2 });
  });

  it("uses lastCommitAt (not audit age) for Watch staleness; null commit is not stale", () => {
    const stale = buildCockpitModel(
      [site({ id: "s", name: "Stale", lastCommitAt: "2026-01-01T00:00:00Z" })],
      [],
      {},
      BASE,
      NOW,
    );
    expect(stale.cards[0]!.tier).toBe("watch");
    expect(stale.cards[0]!.watchSignals).toContain("stale");

    const noCommit = buildCockpitModel(
      [site({ id: "n", name: "NoCommit", lastCommitAt: null })],
      [],
      {},
      BASE,
      NOW,
    );
    expect(noCommit.cards[0]!.tier).toBe("healthy");
  });

  it("counts auto-fix-stuck sites in the summary", () => {
    const m = buildCockpitModel(
      [
        site({ id: "rS", name: "Stuck", securityVulnsCritical: 1, securityAutoFixAttempts: 3 }),
        site({ id: "rF", name: "Fresh", securityVulnsCritical: 1, securityAutoFixAttempts: 1 }),
      ],
      [],
      {},
      BASE,
      NOW,
    );
    expect(m.summary.autoFixStuck).toBe(1);
  });
});

function healthyCard(name: string, lastLighthouseAuditAt: string | null): SiteCard {
  return {
    site: makeWebsiteRow({ name, lastLighthouseAuditAt }),
    tier: "healthy",
    items: [],
    watchReasons: [],
    watchSignals: [],
    acceptedReasons: [],
  };
}

describe("fleetLastAuditedAt", () => {
  it("returns null for no cards", () => {
    expect(fleetLastAuditedAt([])).toBeNull();
  });
  it("returns null when every card has no audit timestamp", () => {
    expect(fleetLastAuditedAt([healthyCard("A", null), healthyCard("B", null)])).toBeNull();
  });
  it("returns the most recent ISO timestamp", () => {
    const cards = [
      healthyCard("A", "2026-06-20T10:00:00Z"),
      healthyCard("B", "2026-06-24T09:00:00Z"),
      healthyCard("C", null),
    ];
    expect(fleetLastAuditedAt(cards)).toBe("2026-06-24T09:00:00Z");
  });
  it("skips unparseable timestamps", () => {
    const cards = [healthyCard("A", "not-a-date"), healthyCard("B", "2026-06-01T00:00:00Z")];
    expect(fleetLastAuditedAt(cards)).toBe("2026-06-01T00:00:00Z");
  });
});

const ZERO_SUMMARY: CockpitSummary = {
  attention: 0,
  watch: 0,
  healthy: 0,
  preLaunch: 0,
  criticalHighVulns: 0,
  lighthouseBelowFloor: 0,
  deliveryFailures: 0,
  renovateFailing: 0,
  ciRed: 0,
  autoFixStuck: 0,
  pending: 0,
  newSubmissions: 0,
};

function feedModel(over: Partial<CockpitModel>): CockpitModel {
  return { summary: ZERO_SUMMARY, cards: [], pending: [], submissions: [], spam: null, ...over };
}
function attnCard(name: string, items: AttentionItem[]): SiteCard {
  return {
    site: makeWebsiteRow({ name }),
    tier: "attention",
    items,
    watchReasons: [],
    watchSignals: [],
    acceptedReasons: [],
  };
}
function watchCard(name: string, reasons: string[]): SiteCard {
  return {
    site: makeWebsiteRow({ name }),
    tier: "watch",
    items: [],
    watchReasons: reasons,
    watchSignals: ["lighthouse"],
    acceptedReasons: [],
  };
}
function vuln(
  name: string,
  opts: { exhausted?: boolean; severity?: "critical" | "warning" } = {},
): AttentionItem {
  return {
    key: "vuln:" + name,
    kind: "vuln",
    siteName: name,
    title: (opts.severity ?? "critical") + " vuln",
    severity: opts.severity ?? "critical",
    metric: 1,
    autoFixExhausted: opts.exhausted ?? false,
  };
}
function ci(name: string): AttentionItem {
  return {
    key: "ci:" + name,
    kind: "ci",
    siteName: name,
    title: "CI red",
    severity: "critical",
    metric: 1,
  };
}
function delivery(name: string): AttentionItem {
  return {
    key: "delivery:" + name,
    kind: "delivery",
    siteName: name,
    title: "reports failing to send",
    severity: "warning",
    metric: 1,
  };
}
function pending(name: string, reportType = "Maintenance", period = "2026-Q2"): PendingEntry {
  return {
    reportId: "r-" + name,
    siteName: name,
    slug: siteSlug(name),
    reportType: reportType as PendingEntry["reportType"],
    period,
  };
}

describe("buildNeedsYouFeed", () => {
  it("returns [] for an empty model", () => {
    expect(buildNeedsYouFeed(feedModel({}))).toEqual([]);
  });
  it("collapses multiple broken items of one site into a single row", () => {
    const feed = buildNeedsYouFeed(
      feedModel({ cards: [attnCard("Acme", [ci("Acme"), delivery("Acme")])] }),
    );
    expect(feed).toHaveLength(1);
    expect(feed[0]).toMatchObject({
      group: "broken",
      siteName: "Acme",
      url: "/s/" + siteSlug("Acme"),
    });
    expect(feed[0]!.reasons).toEqual(["CI red", "reports failing to send"]);
  });
  it("routes a self-patching vuln to watch and an exhausted vuln to broken", () => {
    const inflight = buildNeedsYouFeed(
      feedModel({ cards: [attnCard("Acme", [vuln("Acme", { exhausted: false })])] }),
    );
    expect(inflight).toHaveLength(1);
    expect(inflight[0]!.group).toBe("watch");
    const stuck = buildNeedsYouFeed(
      feedModel({ cards: [attnCard("Acme", [vuln("Acme", { exhausted: true })])] }),
    );
    expect(stuck).toHaveLength(1);
    expect(stuck[0]!.group).toBe("broken");
  });
  it("keeps a hard-broken site broken and omits its self-patching vuln from the reasons", () => {
    const feed = buildNeedsYouFeed(
      feedModel({ cards: [attnCard("Acme", [ci("Acme"), vuln("Acme", { exhausted: false })])] }),
    );
    expect(feed).toHaveLength(1);
    expect(feed[0]!.group).toBe("broken");
    expect(feed[0]!.reasons).toEqual(["CI red"]);
  });
  it("merges a broken site's pending report into the same broken row", () => {
    const feed = buildNeedsYouFeed(
      feedModel({
        cards: [attnCard("Acme", [ci("Acme")])],
        pending: [pending("Acme")],
      }),
    );
    expect(feed).toHaveLength(1);
    expect(feed[0]!.group).toBe("broken");
    expect(feed[0]!.reasons).toEqual(["CI red", "Maintenance 2026-Q2 ready"]);
  });
  it("a watch site with a pending report collapses to one watch row (worst band wins)", () => {
    const feed = buildNeedsYouFeed(
      feedModel({ cards: [watchCard("Delta", ["Performance 70"])], pending: [pending("Delta")] }),
    );
    expect(feed).toHaveLength(1);
    expect(feed[0]!.group).toBe("watch");
    expect(feed[0]!.reasons).toEqual(["Performance 70", "Maintenance 2026-Q2 ready"]);
  });
  it("surfaces an approval on an otherwise-healthy site", () => {
    const feed = buildNeedsYouFeed(feedModel({ pending: [pending("Beta")] }));
    expect(feed).toHaveLength(1);
    expect(feed[0]).toMatchObject({ group: "approval", siteName: "Beta" });
    expect(feed[0]!.reasons).toEqual(["Maintenance 2026-Q2 ready"]);
  });
  it("surfaces a watch-tier site as watch", () => {
    const feed = buildNeedsYouFeed(feedModel({ cards: [watchCard("Gamma", ["Performance 68"])] }));
    expect(feed).toHaveLength(1);
    expect(feed[0]).toMatchObject({ group: "watch", siteName: "Gamma" });
    expect(feed[0]!.reasons).toEqual(["Performance 68"]);
  });
  it("orders broken → watch → approval, critical-first within broken, then by name", () => {
    const feed = buildNeedsYouFeed(
      feedModel({
        cards: [
          watchCard("Zeta", ["SEO 80"]),
          attnCard("Delta", [delivery("Delta")]),
          attnCard("Apex", [ci("Apex")]),
        ],
        pending: [pending("Yara")],
      }),
    );
    expect(feed.map((f) => f.siteName)).toEqual(["Apex", "Delta", "Zeta", "Yara"]);
    expect(feed.map((f) => f.group)).toEqual(["broken", "broken", "watch", "approval"]);
  });
});
