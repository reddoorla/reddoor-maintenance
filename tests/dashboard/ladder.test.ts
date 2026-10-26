/**
 * P1-78b: the severity ladder (workspace briefs/2026-10-26-p1-78b-severity-ladder.md;
 * the plan's "The severity ladder" table, answered by the operator on 10-26). Each
 * existing signal is pinned twice: `levelOf` places its item, and a site carrying that
 * one signal reads that tier and that Needs-you group through the real collectors.
 */
import { describe, it, expect } from "vitest";
import {
  assignTier,
  buildCockpitModel,
  buildNeedsYouFeed,
  buildSiteAlarmContext,
  type CockpitModel,
} from "../../src/dashboard/fleet-cockpit.js";
import { siteSlug as siteSlugOf } from "../../src/fleet/site-row.js";
import { levelOf, RENOVATE_ATTENTION_DAYS } from "../../src/alerts/ladder.js";
import { collectDeployAlerts } from "../../src/alerts/digest-collectors.js";
import type { AttentionItem } from "../../src/alerts/attention.js";
import type { DigestSnapshot } from "../../src/alerts/digest-state.js";
import type { WebsiteRow } from "../../src/fleet/site-row.js";
import type { ReportRow } from "../../src/reports/report-fields.js";
import type { NotifyBounceCounts } from "../../src/db/submissions.js";
import { makeWebsiteRow } from "../_helpers/website-row.js";
import { buildCockpitView, buildSitesView } from "../../cockpit/src/lib/cockpit/view.js";

const NOW = new Date("2026-10-26T16:00:00Z");
const TODAY = "2026-10-26";
const FRESH = "2026-10-26T07:00:00.000Z";
const BASE = "https://cockpit.test";

const daysAgo = (n: number): string =>
  new Date(Date.parse(TODAY) - n * 86_400_000).toISOString().slice(0, 10);

function site(over: Partial<WebsiteRow> = {}): WebsiteRow {
  return makeWebsiteRow({
    id: "recS",
    name: "Solo",
    url: "https://solo.example.com",
    status: "maintained",
    ga4PropertyId: "1",
    gitRepo: "reddoorla/solo",
    netlifyId: "n-1",
    pScore: 95,
    rScore: 95,
    bpScore: 95,
    seoScore: 95,
    lastCommitAt: FRESH,
    githubSignalsAt: FRESH,
    ...over,
  });
}

type Extra = {
  reports?: ReportRow[];
  prior?: DigestSnapshot;
  bounces?: Map<string, NotifyBounceCounts>;
  deadLetters?: Map<string, number>;
  deadLetterOldest?: Map<string, string>;
};

/** A non-empty snapshot, so markWaiting applies its waits as in production. */
const PRIOR: DigestSnapshot = { "noop:x": { metric: 1, firstFlaggedAt: "2026-01-01" } };

function model(sites: WebsiteRow[], x: Extra = {}): CockpitModel {
  return buildCockpitModel(
    sites,
    x.reports ?? [],
    { ...PRIOR, ...(x.prior ?? {}) },
    BASE,
    NOW,
    [],
    null,
    [],
    0,
    x.bounces ?? new Map(),
    x.deadLetters ?? new Map(),
    x.deadLetterOldest ?? new Map(),
  );
}

function verdictOf(m: CockpitModel): { tier: string; group: string | null } {
  const card = m.cards[0]!;
  const row = buildNeedsYouFeed(m).find((r) => r.siteName === card.site.name);
  return { tier: card.tier, group: row?.group ?? null };
}

const it_ = (key: string, kind: AttentionItem["kind"]) => ({ key, kind });

describe("levelOf places every existing signal", () => {
  const cases: Array<[string, AttentionItem["kind"], string]> = [
    ["url-unresolved:recS", "url", "broken"],
    ["deploy:recS", "deploy", "broken"],
    ["deadletter:solo", "deadletter", "broken"],
    ["notify-bounce:recS", "notify-bounce", "broken"],
    ["turnstile:recS", "turnstile", "broken"],
    ["vuln:recS", "vuln", "attention"],
    ["preflight:rep:pending", "preflight", "attention"],
    ["delivery:rep", "delivery", "attention"],
    ["ci:recS", "ci", "attention"],
    ["lighthouse:recS:performance", "lighthouse", "attention"],
    ["prismic-drift:recS", "prismic-drift", "attention"],
    ["analytics:recS", "analytics", "attention"],
    ["url-probe-stale", "url", "attention"],
    ["prismic-unknown:recS", "prismic-drift", "watch"],
    ["prismic-stale:recS", "prismic-drift", "watch"],
  ];
  it.each(cases)("%s is %s", (key, kind, level) => {
    expect(levelOf(it_(key, kind), TODAY, NOW)).toBe(level);
  });

  it("a Renovate PR is Watch until it has been red 7 days, then Attention", () => {
    const r = it_("renovate:recS", "renovate");
    expect(RENOVATE_ATTENTION_DAYS).toBe(7);
    expect(levelOf(r, undefined, NOW)).toBe("watch");
    expect(levelOf(r, daysAgo(0), NOW)).toBe("watch");
    expect(levelOf(r, daysAgo(6), NOW)).toBe("watch");
    expect(levelOf(r, daysAgo(7), NOW)).toBe("attention");
  });
});

describe("one signal per site: tier and Needs-you group", () => {
  it("a clean site is healthy and not in the feed (the control)", () => {
    expect(verdictOf(model([site()]))).toEqual({ tier: "healthy", group: null });
  });

  it("a dead roster url is Broken", () => {
    const m = model([site({ urlResolves: "fail", urlStatus: "404", urlCheckedAt: FRESH })]);
    expect(verdictOf(m)).toEqual({ tier: "broken", group: "broken" });
  });

  it("a failed production deploy is Broken, with a row and an age from the snapshot", () => {
    const m = model([site({ deployStatus: "error" })], {
      prior: { "deploy:recS": { metric: 1, firstFlaggedAt: daysAgo(2) } },
    });
    expect(verdictOf(m)).toEqual({ tier: "broken", group: "broken" });
    expect(m.cards[0]!.items.map((i) => i.key)).toEqual(["deploy:recS"]);
  });

  it("two bounced lead notifications are Broken", () => {
    const m = model([site()], { bounces: new Map([["recS", { total: 2, permanent: 0 }]]) });
    expect(verdictOf(m)).toEqual({ tier: "broken", group: "broken" });
  });

  it("a fresh Turnstile widget fail on a Require-Turnstile site is Broken", () => {
    const m = model([
      site({ requireTurnstile: true, turnstileWidget: "fail", formE2eCheckedAt: FRESH }),
    ]);
    expect(verdictOf(m)).toEqual({ tier: "broken", group: "broken" });
  });

  it("a dead letter past its hold on a known site is Broken", () => {
    const m = model([site()], {
      deadLetters: new Map([["solo", 1]]),
      deadLetterOldest: new Map([["solo", "2026-10-20T00:00:00Z"]]),
    });
    expect(verdictOf(m)).toEqual({ tier: "broken", group: "broken" });
  });

  it("a vulnerability past its wait is Attention", () => {
    const m = model([site({ securityVulnsHigh: 1 })], {
      prior: { "vuln:recS": { metric: 1, firstFlaggedAt: daysAgo(20) } },
    });
    expect(verdictOf(m)).toEqual({ tier: "attention", group: "attention" });
  });

  it("a vulnerability inside its wait is on the site page only", () => {
    const m = model([site({ securityVulnsHigh: 1 })], {
      prior: { "vuln:recS": { metric: 1, firstFlaggedAt: TODAY } },
    });
    expect(verdictOf(m)).toEqual({ tier: "healthy", group: null });
  });

  it("red default-branch CI is Attention", () => {
    expect(verdictOf(model([site({ defaultBranchCi: "failing" })]))).toEqual({
      tier: "attention",
      group: "attention",
    });
  });

  it("a Lighthouse category below 75 is Attention; 75 to 85 is Watch", () => {
    expect(verdictOf(model([site({ pScore: 60 })]))).toEqual({
      tier: "attention",
      group: "attention",
    });
    expect(verdictOf(model([site({ pScore: 80 })]))).toEqual({ tier: "watch", group: "watch" });
  });

  it("failing analytics enrichment is Attention", () => {
    expect(verdictOf(model([site({ analyticsSoftFailAt: FRESH })]))).toEqual({
      tier: "attention",
      group: "attention",
    });
  });

  it("Prismic drift is Attention; a check that could not run is Watch", () => {
    expect(
      verdictOf(model([site({ prismicModels: "fail", prismicModelsCheckedAt: FRESH })])),
    ).toEqual({ tier: "attention", group: "attention" });
    expect(
      verdictOf(model([site({ prismicModels: "unknown", prismicModelsCheckedAt: FRESH })])),
    ).toEqual({ tier: "watch", group: "watch" });
  });

  it("a bounced report is Attention", () => {
    const report = {
      id: "rep",
      siteId: "recS",
      reportType: "Maintenance",
      period: "2026-09",
      deliveryStatus: "bounced",
      sentAt: FRESH,
    } as ReportRow;
    expect(verdictOf(model([site()], { reports: [report] }))).toEqual({
      tier: "attention",
      group: "attention",
    });
  });

  it("a Renovate PR red on day 1 is Watch, and Attention on day 7", () => {
    const red = site({ renovateFailingCis: 1 });
    expect(verdictOf(model([red]))).toEqual({ tier: "watch", group: "watch" });
    const week = model([red], {
      prior: { "renovate:recS": { metric: 1, firstFlaggedAt: daysAgo(7) } },
    });
    expect(verdictOf(week)).toEqual({ tier: "attention", group: "attention" });
  });

  it("a stale repo is Watch", () => {
    expect(verdictOf(model([site({ lastCommitAt: "2026-08-01T00:00:00Z" })]))).toEqual({
      tier: "watch",
      group: "watch",
    });
  });

  it("an unverified Turnstile widget is Watch", () => {
    expect(verdictOf(model([site({ requireTurnstile: true, turnstileWidget: null })]))).toEqual({
      tier: "watch",
      group: "watch",
    });
  });

  it("a stale url probe is an Attention item on no card", () => {
    const m = model([site({ urlCheckedAt: null })]);
    expect(m.cards[0]!.tier).toBe("healthy");
    expect((m.cardless ?? []).map((i) => [i.key, i.level])).toEqual([
      ["url-probe-stale", "attention"],
    ]);
    const view = buildCockpitView(m, NOW);
    expect(view.cardless.map((c) => c.levelLabel)).toEqual(["Attention"]);
  });

  it("a dead letter for a slug no site owns is a Broken item on no card", () => {
    const m = model([site()], { deadLetters: new Map([["ghost", 1]]) });
    expect((m.cardless ?? []).map((i) => [i.key, i.level])).toEqual([
      ["deadletter:ghost", "broken"],
    ]);
  });
});

describe("accept keys", () => {
  it("never mute an Attention item", () => {
    const m = model([
      site({
        defaultBranchCi: "failing",
        acceptedWatchConditions: ["ci", "ci red", "stale", "performance"],
      }),
    ]);
    expect(verdictOf(m)).toEqual({ tier: "attention", group: "attention" });
  });

  it("still mute a Watch reason", () => {
    const m = model([site({ pScore: 80, acceptedWatchConditions: ["performance"] })]);
    expect(verdictOf(m)).toEqual({ tier: "healthy", group: null });
  });
});

describe("a launching site's mute", () => {
  const launching = (over: Partial<WebsiteRow> = {}) => site({ status: "launching", ...over });

  it("stays muted for its own pre-launch noise: Renovate, Lighthouse, a failed deploy", () => {
    const m = model([launching({ renovateFailingCis: 2, pScore: 40, deployStatus: "error" })]);
    expect(m.cards[0]!.tier).toBe("pre-launch");
    expect(buildNeedsYouFeed(m)).toEqual([]);
  });

  it("a launching site's failed deploy is not even collected, for the digest either", () => {
    expect(collectDeployAlerts([launching({ deployStatus: "error" })], BASE)).toEqual([]);
    expect(collectDeployAlerts([site({ deployStatus: "error" })], BASE).map((i) => i.key)).toEqual([
      "deploy:recS",
    ]);
  });

  it("red CI breaks it, as today", () => {
    expect(verdictOf(model([launching({ defaultBranchCi: "failing" })]))).toEqual({
      tier: "attention",
      group: "attention",
    });
  });

  it("a dead roster url breaks it: a Broken item", () => {
    const m = model([launching({ urlResolves: "fail", urlStatus: "404", urlCheckedAt: FRESH })]);
    expect(verdictOf(m)).toEqual({ tier: "broken", group: "broken" });
  });

  it("a critical vulnerability whose auto-fix is still working does not break it", () => {
    const m = model([launching({ securityVulnsCritical: 3, securityAutoFixAttempts: 1 })], {
      prior: { "vuln:recS": { metric: 3, firstFlaggedAt: daysAgo(20) } },
    });
    expect(m.cards[0]!.tier).toBe("pre-launch");
  });

  it("an exhausted vulnerability breaks it", () => {
    const m = model([launching({ securityVulnsHigh: 1, securityAutoFixAttempts: 3 })]);
    expect(verdictOf(m)).toEqual({ tier: "attention", group: "attention" });
  });

  it("assignTier on a launching site takes the worst piercing level", () => {
    const items: AttentionItem[] = [
      {
        key: "ci:recS",
        kind: "ci",
        siteName: "Solo",
        title: "CI red",
        severity: "warning",
        metric: 1,
        level: "attention",
      },
      {
        key: "url-unresolved:recS",
        kind: "url",
        siteName: "Solo",
        title: "url",
        severity: "warning",
        metric: 1,
        level: "broken",
      },
    ];
    expect(assignTier(launching(), items, NOW).tier).toBe("broken");
  });
});

describe("Mon 10-26, replayed", () => {
  // The plan's "What today reads under the ladder": four sites read broken on the old
  // rule, none a visitor could see. Reddoor: five high vulns past their wait and a
  // Renovate PR on its first day. 29 Navy: a vuln past its window. Beachfront and
  // Sonder: a Renovate PR on its first day.
  const fleet = [
    site({ id: "recR", name: "Reddoor", securityVulnsHigh: 5, renovateFailingCis: 1 }),
    site({ id: "recN", name: "29 Navy", securityVulnsHigh: 1 }),
    site({ id: "recB", name: "Beachfront", renovateFailingCis: 1 }),
    site({ id: "recO", name: "Sonder", renovateFailingCis: 1 }),
    site({ id: "recC", name: "CalTex" }),
  ];
  const prior: DigestSnapshot = {
    "vuln:recR": { metric: 5, firstFlaggedAt: "2026-10-20" },
    "vuln:recN": { metric: 1, firstFlaggedAt: "2026-10-13" },
    "renovate:recR": { metric: 1, firstFlaggedAt: TODAY },
    "renovate:recB": { metric: 1, firstFlaggedAt: TODAY },
    "renovate:recO": { metric: 1, firstFlaggedAt: TODAY },
  };
  const m = model(fleet, { prior });

  it("reads Attention for Reddoor and 29 Navy, Watch for Beachfront and Sonder, and no Broken", () => {
    const tiers = Object.fromEntries(m.cards.map((c) => [c.site.name, c.tier]));
    expect(tiers).toEqual({
      Reddoor: "attention",
      "29 Navy": "attention",
      Beachfront: "watch",
      Sonder: "watch",
      CalTex: "healthy",
    });
    expect(buildNeedsYouFeed(m).map((r) => [r.siteName, r.group])).toEqual([
      ["29 Navy", "attention"],
      ["Reddoor", "attention"],
      ["Beachfront", "watch"],
      ["Sonder", "watch"],
    ]);
  });

  it("the verdict reads the ladder", () => {
    const v = buildCockpitView(m, NOW).verdict;
    expect(v.line).toBe("2 need attention · 2 to watch");
    expect(v.cls).toBe("attention");
  });
});

describe("review round 1 (P1-78b)", () => {
  it("a Watch-level item is one chip on the Sites row and one item on the site page, with no accept hint", () => {
    const m = model([site({ renovateFailingCis: 1 })]);
    const chips = buildSitesView(m, NOW).cards[siteSlugOf("Solo")]!.chips;
    expect(chips.filter((c) => c.text === "1 Renovate PR failing CI")).toHaveLength(1);
    expect(chips.some((c) => c.title !== null)).toBe(false);
    const ctx = buildSiteAlarmContext(
      site({ renovateFailingCis: 1 }),
      [],
      BASE,
      NOW,
      new Map(),
      new Map(),
      PRIOR,
    );
    expect(ctx.tier).toBe("watch");
    expect(ctx.items.map((i) => i.key)).toEqual(["renovate:recS"]);
    expect(ctx.watchReasons).toEqual([]);
    // The feed still names it.
    expect(buildNeedsYouFeed(m)[0]!.reasons).toEqual(["1 Renovate PR failing CI"]);
  });

  it('an accepted "url not deployed" stays visible as an accepted chip', () => {
    const m = model([
      site({
        urlResolves: "fail",
        urlStatus: "404",
        urlCheckedAt: FRESH,
        acceptedWatchConditions: ["url not deployed"],
      }),
    ]);
    expect(m.cards[0]!.tier).toBe("healthy");
    expect(m.cards[0]!.acceptedReasons).toEqual([
      "roster url https://solo.example.com does not resolve (404)",
    ]);
  });

  it("the verdict counts an item on no card: never All clear while one is on the page", () => {
    const v = buildCockpitView(model([site({ urlCheckedAt: "2026-10-01T00:00:00.000Z" })]), NOW);
    expect(v.verdict.line).toBe("1 needs attention");
    expect(v.verdict.cls).toBe("attention");
  });

  it("Broken and Attention rows carry their age, oldest first within a group", () => {
    const m = model(
      [
        site({ id: "recY", name: "Young", defaultBranchCi: "failing" }),
        site({ id: "recO", name: "Old", defaultBranchCi: "failing" }),
      ],
      {
        prior: {
          "ci:recY": { metric: 1, firstFlaggedAt: daysAgo(1) },
          "ci:recO": { metric: 1, firstFlaggedAt: daysAgo(6) },
        },
      },
    );
    expect(buildNeedsYouFeed(m).map((r) => [r.siteName, r.since])).toEqual([
      ["Old", daysAgo(6)],
      ["Young", daysAgo(1)],
    ]);
    const rows = buildCockpitView(m, NOW).feed[0]!.rows;
    expect(rows.map((r) => r.age)).toEqual(["for 6 days", "for 1 day"]);
  });

  it("the stale probe counts every non-archived row, as the digest does", () => {
    const m = model([
      site({ urlCheckedAt: null }),
      site({ id: "recB", name: "Building", status: "building", urlCheckedAt: null }),
    ]);
    expect((m.cardless ?? []).map((i) => [i.key, i.metric])).toEqual([["url-probe-stale", 2]]);
  });
});
