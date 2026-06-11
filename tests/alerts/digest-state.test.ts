// tests/alerts/digest-state.test.ts
import { describe, it, expect } from "vitest";
import { diffAttention, type DigestSnapshot } from "../../src/alerts/digest-state.js";
import type { AttentionItem } from "../../src/reports/digest.js";

const TODAY = "2026-06-11";

function item(over: Partial<AttentionItem> = {}): AttentionItem {
  return {
    key: "vuln:rec1",
    kind: "vuln",
    siteName: "Acme Co",
    title: "2 critical/high vulns",
    url: "https://reddoor-maintenance.netlify.app/s/acme-co",
    severity: "critical",
    metric: 2,
    ...over,
  };
}

describe("diffAttention", () => {
  it("tags an item absent from prior as NEW and stamps firstFlaggedAt=today", () => {
    const { tagged, next } = diffAttention([item({ key: "vuln:rec1", metric: 2 })], {}, TODAY);
    expect(tagged[0]!.status).toBe("new");
    expect(next["vuln:rec1"]).toEqual({ metric: 2, firstFlaggedAt: TODAY });
  });

  it("tags an item whose metric rose above prior as WORSE and KEEPS the original firstFlaggedAt", () => {
    const prior: DigestSnapshot = { "vuln:rec1": { metric: 2, firstFlaggedAt: "2026-06-01" } };
    const { tagged, next } = diffAttention([item({ key: "vuln:rec1", metric: 5 })], prior, TODAY);
    expect(tagged[0]!.status).toBe("worse");
    expect(next["vuln:rec1"]).toEqual({ metric: 5, firstFlaggedAt: "2026-06-01" });
  });

  it("tags an unchanged item as STANDING and preserves firstFlaggedAt", () => {
    const prior: DigestSnapshot = { "vuln:rec1": { metric: 2, firstFlaggedAt: "2026-06-01" } };
    const { tagged, next } = diffAttention([item({ key: "vuln:rec1", metric: 2 })], prior, TODAY);
    expect(tagged[0]!.status).toBe("standing");
    expect(next["vuln:rec1"]).toEqual({ metric: 2, firstFlaggedAt: "2026-06-01" });
  });

  it("a dropping metric is STANDING (only a RISE is WORSE), firstFlaggedAt preserved", () => {
    const prior: DigestSnapshot = { "vuln:rec1": { metric: 5, firstFlaggedAt: "2026-06-01" } };
    const { tagged, next } = diffAttention([item({ key: "vuln:rec1", metric: 2 })], prior, TODAY);
    expect(tagged[0]!.status).toBe("standing");
    expect(next["vuln:rec1"]).toEqual({ metric: 2, firstFlaggedAt: "2026-06-01" });
  });

  it("next holds EXACTLY the current items' keys — a resolved prior key drops out", () => {
    const prior: DigestSnapshot = {
      "vuln:rec1": { metric: 2, firstFlaggedAt: "2026-06-01" },
      "vuln:gone": { metric: 9, firstFlaggedAt: "2026-05-01" },
    };
    const { next } = diffAttention([item({ key: "vuln:rec1", metric: 2 })], prior, TODAY);
    expect(Object.keys(next)).toEqual(["vuln:rec1"]);
    expect(next["vuln:gone"]).toBeUndefined();
  });

  it("a fixed-then-recurring problem re-news (dropped key → absent → NEW, firstFlaggedAt=today)", () => {
    // day 1: present
    const r1 = diffAttention([item({ key: "vuln:rec1", metric: 2 })], {}, "2026-06-01");
    expect(r1.tagged[0]!.status).toBe("new");
    // day 2: resolved (no items) → snapshot empties
    const r2 = diffAttention([], r1.next, "2026-06-02");
    expect(r2.next).toEqual({});
    // day 3: recurs → NEW again, firstFlaggedAt is the recurrence day, not the original
    const r3 = diffAttention([item({ key: "vuln:rec1", metric: 2 })], r2.next, "2026-06-03");
    expect(r3.tagged[0]!.status).toBe("new");
    expect(r3.next["vuln:rec1"]).toEqual({ metric: 2, firstFlaggedAt: "2026-06-03" });
  });

  it("does not mutate the input items (returns tagged copies)", () => {
    const input = item({ key: "vuln:rec1", metric: 2 });
    diffAttention([input], {}, TODAY);
    expect(input.status).toBeUndefined();
  });

  it("does not mutate the prior snapshot", () => {
    const prior: DigestSnapshot = { "vuln:rec1": { metric: 2, firstFlaggedAt: "2026-06-01" } };
    diffAttention([item({ key: "vuln:rec1", metric: 5 })], prior, TODAY);
    expect(prior["vuln:rec1"]).toEqual({ metric: 2, firstFlaggedAt: "2026-06-01" });
  });
});
