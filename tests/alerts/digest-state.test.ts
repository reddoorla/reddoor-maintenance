// tests/alerts/digest-state.test.ts
import { describe, it, expect } from "vitest";
import {
  diffAttention,
  readDigestState,
  writeDigestState,
  DIGEST_STATE_TABLE,
  type DigestSnapshot,
} from "../../src/alerts/digest-state.js";
import type { AttentionItem } from "../../src/alerts/attention.js";
import { makeFakeBase } from "../reports/_helpers/fake-airtable-base.js";

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

describe("readDigestState / writeDigestState", () => {
  it("exposes the exact Airtable table name", () => {
    expect(DIGEST_STATE_TABLE).toBe("Digest State");
  });

  it("reads + JSON-parses the Snapshot field of the single row", async () => {
    const snap = { "vuln:rec_a": { metric: 3, firstFlaggedAt: "2026-06-10" } };
    const base = makeFakeBase({
      "Digest State": [{ id: "rec_state", fields: { Snapshot: JSON.stringify(snap) } }],
    });
    const out = await readDigestState(base);
    expect(out).toEqual(snap);
  });

  it("returns {} when the Digest State table is empty (read miss → safe degrade)", async () => {
    const base = makeFakeBase({ "Digest State": [] });
    const out = await readDigestState(base);
    expect(out).toEqual({});
  });

  it("returns {} when the table has no seed at all", async () => {
    // makeFakeBase lazily ensures the table; an unseeded read must not throw.
    const base = makeFakeBase();
    const out = await readDigestState(base);
    expect(out).toEqual({});
  });

  it("returns {} when the Snapshot field holds malformed JSON (parse miss → safe degrade)", async () => {
    const base = makeFakeBase({
      "Digest State": [{ id: "rec_state", fields: { Snapshot: "{not valid json" } }],
    });
    const out = await readDigestState(base);
    expect(out).toEqual({});
  });

  it("write CREATES a row when none exists, stamping Snapshot + the injected Updated At", async () => {
    const base = makeFakeBase({ "Digest State": [] });
    const snap = { "delivery:rec_r": { metric: 1, firstFlaggedAt: "2026-06-11" } };
    await writeDigestState(base, snap, "2026-06-11T00:00:00.000Z");

    const create = base.__calls.find((c) => c.kind === "create");
    expect(create).toBeDefined();
    expect(base.__calls.some((c) => c.kind === "update")).toBe(false);
    expect(create!.table).toBe("Digest State");
    const fields = create!.records[0]!.fields;
    expect(JSON.parse(fields["Snapshot"] as string)).toEqual(snap);
    expect(fields["Updated At"]).toBe("2026-06-11T00:00:00.000Z");
  });

  it("write UPDATES the existing row (not create), keying off its record id", async () => {
    const base = makeFakeBase({
      "Digest State": [
        { id: "rec_state", fields: { Snapshot: "{}", "Updated At": "2026-06-10T00:00:00.000Z" } },
      ],
    });
    const snap = { "vuln:rec_a": { metric: 5, firstFlaggedAt: "2026-06-09" } };
    await writeDigestState(base, snap, "2026-06-11T00:00:00.000Z");

    expect(base.__calls.some((c) => c.kind === "create")).toBe(false);
    const update = base.__calls.find((c) => c.kind === "update");
    expect(update).toBeDefined();
    expect(update!.table).toBe("Digest State");
    const rec = update!.records[0]!;
    expect(rec.id).toBe("rec_state");
    expect(JSON.parse(rec.fields["Snapshot"] as string)).toEqual(snap);
    expect(rec.fields["Updated At"]).toBe("2026-06-11T00:00:00.000Z");
  });

  it("round-trips: a written snapshot reads back equal", async () => {
    const base = makeFakeBase({ "Digest State": [] });
    const snap = { "vuln:rec_a": { metric: 2, firstFlaggedAt: "2026-06-11" } };
    await writeDigestState(base, snap, "2026-06-11T00:00:00.000Z");
    const out = await readDigestState(base);
    expect(out).toEqual(snap);
  });
});
