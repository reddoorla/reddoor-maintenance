import { describe, it, expect } from "vitest";
import {
  markWaiting,
  lockfileWindowClosesAfter,
  transitiveVulnEscalatesAt,
  directVulnEscalatesAt,
  LOCKFILE_SETTLE_DAYS,
  DIRECT_VULN_WAIT_DAYS,
} from "../../src/alerts/waiting.js";
import type { AttentionItem } from "../../src/alerts/attention.js";
import type { DigestSnapshot } from "../../src/alerts/digest-state.js";
import { buildCockpitModel, buildNeedsYouFeed } from "../../src/dashboard/fleet-cockpit.js";
import type { SecurityAdvisory, WebsiteRow } from "../../src/fleet/site-row.js";
import { makeWebsiteRow } from "../_helpers/website-row.js";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const BASE = "https://reddoor-maintenance.netlify.app";

function vuln(over: Partial<AttentionItem> = {}): AttentionItem {
  return {
    key: "vuln:s",
    kind: "vuln",
    siteName: "S",
    title: "3 critical/high vulns",
    severity: "critical",
    metric: 3,
    ...over,
  };
}

function flagged(day: string, key = "vuln:s"): DigestSnapshot {
  return { [key]: { metric: 3, firstFlaggedAt: day } };
}

function justBefore(d: Date): Date {
  return new Date(d.getTime() - 1);
}

describe("lockfileWindowClosesAfter", () => {
  it("is the close of the first Monday window after the flag day", () => {
    expect(lockfileWindowClosesAfter("2026-10-04")!.toISOString()).toBe("2026-10-05T18:00:00.000Z");
    expect(lockfileWindowClosesAfter("2026-10-01")!.toISOString()).toBe("2026-10-05T18:00:00.000Z");
  });

  it("skips the window already open on the flag day", () => {
    expect(lockfileWindowClosesAfter("2026-10-05")!.toISOString()).toBe("2026-10-12T18:00:00.000Z");
  });

  it("is null for a day that does not parse", () => {
    expect(lockfileWindowClosesAfter("not a day")).toBeNull();
    expect(lockfileWindowClosesAfter("2026-10-05T00:00:00Z")).toBeNull();
  });
});

describe("markWaiting — transitive-only vuln", () => {
  const item = vuln({
    transitiveOnly: true,
    title: "3 critical/high vulns — transitive-only, fix rides the weekly lockfile window",
  });
  const at = transitiveVulnEscalatesAt("2026-09-27")!;

  it("escalates LOCKFILE_SETTLE_DAYS after the window closes", () => {
    expect(at.toISOString()).toBe("2026-09-30T18:00:00.000Z");
    expect(at.getTime() - Date.parse("2026-09-28T18:00:00Z")).toBe(
      LOCKFILE_SETTLE_DAYS * MS_PER_DAY,
    );
  });

  it("waits until the threshold", () => {
    const [out] = markWaiting([item], flagged("2026-09-27"), justBefore(at), true);
    expect(out!.waiting).toBe(true);
    expect(out!.title).toBe(item.title);
  });

  it("stops waiting at the threshold and names the window it outlived", () => {
    const [out] = markWaiting([item], flagged("2026-09-27"), at, true);
    expect(out!.waiting).toBeUndefined();
    expect(out!.title).toBe(
      "3 critical/high vulns — transitive-only, still present after the 2026-09-28 lockfile window",
    );
  });
});

describe("markWaiting — direct vuln", () => {
  const item = vuln();
  const at = directVulnEscalatesAt("2026-10-01")!;

  it("escalates DIRECT_VULN_WAIT_DAYS after the flag day", () => {
    expect(at.getTime() - Date.parse("2026-10-01T00:00:00Z")).toBe(
      DIRECT_VULN_WAIT_DAYS * MS_PER_DAY,
    );
  });

  it("waits until the threshold", () => {
    expect(markWaiting([item], flagged("2026-10-01"), justBefore(at), true)[0]!.waiting).toBe(true);
  });

  it("stops waiting at the threshold and says since when", () => {
    const [out] = markWaiting([item], flagged("2026-10-01"), at, true);
    expect(out!.waiting).toBeUndefined();
    expect(out!.title).toBe("3 critical/high vulns — Renovate has not fixed it since 2026-10-01");
  });

  it("is badged WORSE on the day it escalates, and not after", () => {
    const tagged = vuln({ status: "standing" });
    expect(markWaiting([tagged], flagged("2026-10-01"), at, true)[0]!.status).toBe("worse");
    const dayLater = new Date(at.getTime() + MS_PER_DAY);
    expect(markWaiting([tagged], flagged("2026-10-01"), dayLater, true)[0]!.status).toBe(
      "standing",
    );
    expect(markWaiting([vuln()], flagged("2026-10-01"), at, true)[0]!.status).toBeUndefined();
  });

  it("never waits once Renovate's auto-fix is exhausted, however fresh", () => {
    const exhausted = vuln({ autoFixExhausted: true });
    const now = new Date("2026-10-01T01:00:00Z");
    expect(markWaiting([exhausted], flagged("2026-10-01"), now, true)[0]).toEqual(exhausted);
  });
});

describe("markWaiting — what never waits", () => {
  const now = new Date("2026-10-05T12:00:00Z");
  const kinds: AttentionItem["kind"][] = [
    "delivery",
    "renovate",
    "lighthouse",
    "ci",
    "analytics",
    "preflight",
    "turnstile",
    "notify-bounce",
    "deadletter",
    "prismic-drift",
    "url",
  ];

  it.each(kinds)("a fresh %s item needs the operator now", (kind) => {
    const it = vuln({ kind, key: `${kind}:s` });
    expect(markWaiting([it], flagged("2026-10-05", it.key), now, true)[0]).toEqual(it);
  });

  it("nothing waits when the prior snapshot was not read", () => {
    const fresh = flagged("2026-10-05");
    expect(markWaiting([vuln()], fresh, now, false)[0]!.waiting).toBeUndefined();
    expect(markWaiting([vuln()], fresh, now, true)[0]!.waiting).toBe(true);
  });

  it("a vuln with no first-flagged day is not muted", () => {
    expect(markWaiting([vuln()], {}, now, true)[0]!.waiting).toBeUndefined();
  });

  it("a vuln with an unparseable first-flagged day is not muted", () => {
    expect(markWaiting([vuln()], flagged("someday"), now, true)[0]!.waiting).toBeUndefined();
    const t = vuln({ transitiveOnly: true });
    expect(markWaiting([t], flagged("someday"), now, true)[0]!.waiting).toBeUndefined();
  });
});

describe("ERP Industrials, 2026-10-05 — a transitive-only vuln on the cockpit", () => {
  const NOW = new Date("2026-10-05T23:30:00Z");
  const transitive: SecurityAdvisory[] = [
    {
      module: "a",
      severity: "critical",
      title: "",
      cves: [],
      url: null,
      relationship: "transitive",
    },
    { module: "b", severity: "high", title: "", cves: [], url: null, relationship: "transitive" },
    { module: "c", severity: "high", title: "", cves: [], url: null, relationship: "transitive" },
  ];
  function erp(over: Partial<WebsiteRow> = {}): WebsiteRow {
    return makeWebsiteRow({
      id: "erp",
      name: "ERP Industrials",
      pointOfContact: "Tucker",
      ga4PropertyId: "123456789",
      gitRepo: "reddoorla/erp-industrials",
      netlifyId: "11111111-2222-3333-4444-555555555555",
      url: "https://erp.example.com",
      pScore: 95,
      rScore: 95,
      bpScore: 95,
      seoScore: 95,
      lastCommitAt: "2026-10-01T00:00:00Z",
      securityVulnsCritical: 1,
      securityVulnsHigh: 2,
      securityAdvisories: transitive,
      ...over,
    });
  }
  const feedFor = (prior: DigestSnapshot) =>
    buildNeedsYouFeed(buildCockpitModel([erp()], [], prior, BASE, NOW));

  it("is off Watch and out of the Needs-you feed while the next lockfile window is pending", () => {
    const m = buildCockpitModel([erp()], [], flagged("2026-10-01", "vuln:erp"), BASE, NOW);
    expect(m.cards[0]!.tier).toBe("healthy");
    expect(m.cards[0]!.items).toEqual([]);
    expect(feedFor(flagged("2026-10-01", "vuln:erp"))).toEqual([]);
  });

  it("is on Watch once the window has passed and the vuln is still there", () => {
    const feed = feedFor(flagged("2026-09-27", "vuln:erp"));
    expect(feed).toHaveLength(1);
    expect(feed[0]!.group).toBe("watch");
    expect(feed[0]!.reasons).toEqual([
      "3 critical/high vulns — transitive-only, still present after the 2026-09-28 lockfile window",
    ]);
  });

  it("first seen today, with no snapshot entry yet, it waits", () => {
    expect(feedFor(flagged("2026-10-05", "ci:other"))).toEqual([]);
  });

  it("an unread or empty snapshot never hides it", () => {
    expect(feedFor({}).map((r) => r.group)).toEqual(["watch"]);
    const m = buildCockpitModel([erp()], [], {}, BASE, NOW);
    expect(m.cards[0]!.items.map((i) => i.kind)).toEqual(["vuln"]);
  });
});
