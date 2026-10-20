import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  markWaiting,
  lockfileWindowClosesAfter,
  transitiveVulnEscalatesAt,
  directVulnEscalatesAt,
  LOCKFILE_SETTLE_DAYS,
  DIRECT_VULN_WAIT_DAYS,
  deadLetterEscalatesAt,
  DEADLETTER_HOLD_HOURS,
  DEADLETTER_REPLAY_EVERY_HOURS,
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

describe("a held direct security PR (P1-54: 29 Navy's sharp, 2026-10-13)", () => {
  const sharp: SecurityAdvisory[] = [
    {
      module: "sharp",
      severity: "high",
      title: "sharp : Vulnerability in librsvg dependency CVE-2026-96889",
      cves: [],
      url: "https://github.com/reddoorla/29-navy/security/dependabot/9",
      relationship: "direct",
    },
  ];
  function navy(over: Partial<WebsiteRow> = {}): WebsiteRow {
    return makeWebsiteRow({
      id: "navy",
      name: "29 Navy",
      pointOfContact: "Tucker",
      ga4PropertyId: "123456789",
      gitRepo: "reddoorla/29-navy",
      netlifyId: "11111111-2222-3333-4444-555555555555",
      url: "https://29navy.example.com",
      pScore: 95,
      rScore: 95,
      bpScore: 95,
      seoScore: 95,
      lastCommitAt: "2026-10-12T00:00:00Z",
      securityVulnsCritical: 0,
      securityVulnsHigh: 1,
      securityAdvisories: sharp,
      securityAutoFixAttempts: null,
      ...over,
    });
  }
  const prior = flagged("2026-10-13", "vuln:navy");
  const escalates = directVulnEscalatesAt("2026-10-13")!;
  const feedAt = (now: Date, row: WebsiteRow = navy()) =>
    buildNeedsYouFeed(buildCockpitModel([row], [], prior, BASE, now));

  it("stays out of the Needs-you feed inside its wait", () => {
    expect(feedAt(justBefore(escalates))).toEqual([]);
  });

  it("reaches Needs-you once the wait has passed, though the auto-fix counter never moved", () => {
    const feed = feedAt(escalates);
    expect(feed).toHaveLength(1);
    expect(feed[0]!.reasons).toEqual([
      "1 critical/high vuln — Renovate has not fixed it since 2026-10-13",
    ]);
  });

  it("is still named when the site is broken for another reason", () => {
    const now = new Date("2026-10-19T12:00:00Z");
    const row = navy({ renovateFailingCis: 2, githubSignalsAt: "2026-10-19T06:00:00Z" });
    const feed = feedAt(now, row);
    expect(feed).toHaveLength(1);
    expect(feed[0]!.group).toBe("broken");
    expect(feed[0]!.reasons).toEqual([
      "2 Renovate PRs failing CI",
      "1 critical/high vuln — Renovate has not fixed it since 2026-10-13",
    ]);
  });
});

/**
 * OD 87 (answered (a), 2026-10-20). A dead letter on a slug that resolves to a
 * site waits two replay cycles before it alarms: `forms-deadletter-replay.yml`
 * drains the queue every 6 h, so a fresh row is a (iii) "just wait" signal. The
 * clock is the OLDEST unreplayed row's `received_at`, which the collector stamps as
 * `oldestReceivedAt`; a slug that resolves to no site gets none and alarms at once.
 */
describe("markWaiting — dead letter on a known site (OD 87)", () => {
  const received = "2026-10-20T06:00:00.000Z";
  const at = deadLetterEscalatesAt(received)!;
  const held = (over: Partial<AttentionItem> = {}): AttentionItem => ({
    key: "deadletter:acme-co",
    kind: "deadletter",
    siteName: "Acme Co",
    title: "1 lead dead-lettered and not yet replayed — run `db replay-deadletters`",
    url: `${BASE}/s/acme-co`,
    severity: "critical",
    metric: 1,
    oldestReceivedAt: received,
    ...over,
  });
  const snap = flagged("2026-10-20", "deadletter:acme-co");

  it("escalates two replay cycles (12 h) after the oldest unreplayed row", () => {
    expect(DEADLETTER_REPLAY_EVERY_HOURS).toBe(6);
    expect(DEADLETTER_HOLD_HOURS).toBe(2 * DEADLETTER_REPLAY_EVERY_HOURS);
    expect(at.toISOString()).toBe("2026-10-20T18:00:00.000Z");
    expect(deadLetterEscalatesAt("not a date")).toBeNull();
  });

  it("the replay cadence is the workflow's own cron", () => {
    // Change DEADLETTER_REPLAY_EVERY_HOURS when the workflow's schedule changes.
    const yml = readFileSync(
      fileURLToPath(
        new URL("../../.github/workflows/forms-deadletter-replay.yml", import.meta.url),
      ),
      "utf8",
    );
    expect(yml).toMatch(
      new RegExp(`cron:\\s*"\\d+ \\*/${DEADLETTER_REPLAY_EVERY_HOURS} \\* \\* \\*"`),
    );
  });

  it("aged 11 h 59 m it is waiting: no ask yet", () => {
    const now = new Date(at.getTime() - 60 * 1000);
    const [out] = markWaiting([held()], snap, now, true);
    expect(out!.waiting).toBe(true);
    expect(out!.title).toMatch(/11 h ago/);
    expect(out!.title).toMatch(/2026-10-20 18:00Z/);
  });

  it("says it/them by the count, in full", () => {
    const now = new Date(at.getTime() - 60 * 1000);
    expect(markWaiting([held()], snap, now, true)[0]!.title).toBe(
      "1 lead dead-lettered 11 h ago — the 6-hourly replay should place it; alarms at 2026-10-20 18:00Z if not",
    );
    expect(markWaiting([held({ metric: 3 })], snap, now, true)[0]!.title).toBe(
      "3 leads dead-lettered, oldest 11 h ago — the 6-hourly replay should place them; alarms at 2026-10-20 18:00Z if not",
    );
  });

  it("one millisecond before the threshold it is still waiting", () => {
    expect(markWaiting([held()], snap, justBefore(at), true)[0]!.waiting).toBe(true);
  });

  it("aged 12 h it is CRITICAL, with the age in the title", () => {
    const [out] = markWaiting([held()], snap, at, true);
    expect(out!.waiting).toBeUndefined();
    expect(out!.severity).toBe("critical");
    expect(out!.title).toBe(
      "1 lead dead-lettered and not replayed for 12 h — the 6-hourly replay has not placed it; run `db replay-deadletters` to see why",
    );
  });

  it("names the age of the OLDEST row as it grows", () => {
    const now = new Date(at.getTime() + 15 * 60 * 60 * 1000 + 59 * 60 * 1000);
    const [out] = markWaiting([held({ metric: 3 })], snap, now, true);
    expect(out!.title).toMatch(/^3 leads dead-lettered, the oldest not replayed for 27 h/);
  });

  it("is badged WORSE on the day it escalates, and not after", () => {
    const same = held({ status: "standing" });
    expect(markWaiting([same], snap, at, true)[0]!.status).toBe("worse");
    const dayLater = new Date(at.getTime() + MS_PER_DAY);
    expect(markWaiting([same], snap, dayLater, true)[0]!.status).toBe("standing");
  });

  it("stays NEW when it escalates on its first sighting (the digest never saw the key)", () => {
    // A row 13 h old when the once-a-day digest first runs escalates on sight;
    // a key the snapshot never held is new, not worse.
    const fresh = held({ status: "new" });
    expect(markWaiting([fresh], {}, at, true)[0]!.status).toBe("new");
  });

  it("never names a negative age (a received_at ahead of the clock)", () => {
    const ahead = held({ oldestReceivedAt: "2026-10-20T07:30:00.000Z" });
    const [out] = markWaiting([ahead], snap, new Date(received), true);
    expect(out!.waiting).toBe(true);
    expect(out!.title).toMatch(/^1 lead dead-lettered 0 h ago/);
  });

  it("is clocked by received_at, not by the digest snapshot", () => {
    // The snapshot's day-granular firstFlaggedAt cannot express 12 h, and an
    // unread snapshot cannot restart this clock, so it neither holds nor frees it.
    expect(markWaiting([held()], {}, justBefore(at), false)[0]!.waiting).toBe(true);
    expect(markWaiting([held()], {}, at, false)[0]!.waiting).toBeUndefined();
  });

  it("an item with no received_at alarms at once (an unknown slug, or a failed read)", () => {
    const { oldestReceivedAt: _drop, ...ghost } = held({
      key: "deadletter:ghost-co",
      siteName: "(unknown site: ghost-co)",
    });
    const now = new Date(received);
    expect(markWaiting([ghost], snap, now, true)[0]).toEqual(ghost);
  });

  it("an unparseable received_at never mutes", () => {
    const bad = held({ oldestReceivedAt: "garbage" });
    expect(markWaiting([bad], snap, new Date(received), true)[0]).toEqual(bad);
  });
});
