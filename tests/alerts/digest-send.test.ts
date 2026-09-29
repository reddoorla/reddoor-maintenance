import { describe, it, expect } from "vitest";
import {
  ageLabel,
  coerceSendLog,
  daysBetween,
  decideDigestSend,
  nextReadySince,
  DIGEST_HEARTBEAT_DAYS,
  EMPTY_SEND_LOG,
  type DigestSendLog,
} from "../../src/alerts/digest-send.js";
import type { AttentionItem } from "../../src/alerts/attention.js";

const item = (key: string, status: AttentionItem["status"] = "standing"): AttentionItem => ({
  key,
  kind: "preflight",
  siteName: "29 Navy",
  title: "t",
  severity: "warning",
  metric: 1,
  status,
});

const sent = (keys: string[], sentOn = "2026-09-20"): DigestSendLog => ({
  sentOn,
  keys,
  readySince: {},
});

describe("decideDigestSend", () => {
  it("sends the first time, when nothing has been sent", () => {
    expect(decideDigestSend(["a"], [item("a")], EMPTY_SEND_LOG, "2026-09-21")).toEqual({
      send: true,
      reason: "first",
    });
  });

  it("stays quiet when the set and every status are unchanged", () => {
    expect(decideDigestSend(["a", "b"], [item("a")], sent(["b", "a"]), "2026-09-21")).toEqual({
      send: false,
      reason: "unchanged",
    });
  });

  it("sends when an item joins the set", () => {
    expect(decideDigestSend(["a", "c"], [], sent(["a"]), "2026-09-21").reason).toBe("changed");
  });

  it("sends when an item leaves the set", () => {
    expect(decideDigestSend(["a"], [], sent(["a", "b"]), "2026-09-21").reason).toBe("changed");
  });

  it("sends when one item is swapped for another of the same count", () => {
    expect(decideDigestSend(["a", "c"], [], sent(["a", "b"]), "2026-09-21").reason).toBe("changed");
  });

  it("sends when an unchanged key recurred as NEW", () => {
    expect(decideDigestSend(["a"], [item("a", "new")], sent(["a"]), "2026-09-21").reason).toBe(
      "new",
    );
  });

  it("sends when an unchanged key got WORSE", () => {
    expect(decideDigestSend(["a"], [item("a", "worse")], sent(["a"]), "2026-09-21").reason).toBe(
      "worse",
    );
  });

  it("sends a heartbeat on the seventh day of silence, not the sixth", () => {
    expect(decideDigestSend(["a"], [], sent(["a"], "2026-09-14"), "2026-09-20").send).toBe(false);
    expect(decideDigestSend(["a"], [], sent(["a"], "2026-09-14"), "2026-09-21")).toEqual({
      send: true,
      reason: "heartbeat",
    });
    expect(DIGEST_HEARTBEAT_DAYS).toBe(7);
  });
});

describe("ages", () => {
  it("counts whole UTC days", () => {
    expect(daysBetween("2026-09-18", "2026-09-29")).toBe(11);
    expect(daysBetween("2026-09-29", "2026-09-29")).toBe(0);
    expect(daysBetween("2026-09-30", "2026-09-29")).toBe(0);
    expect(daysBetween("garbage", "2026-09-29")).toBe(0);
  });

  it("labels nothing under a day, and singular for one", () => {
    expect(ageLabel(undefined)).toBe("");
    expect(ageLabel(0)).toBe("");
    expect(ageLabel(1)).toBe("1 day");
    expect(ageLabel(3)).toBe("3 days");
  });

  it("keeps a ready item's first-seen day and drops ones no longer ready", () => {
    expect(
      nextReadySince(
        ["ready:a", "ready:b"],
        { "ready:a": "2026-09-18", "ready:z": "2026-09-01" },
        "2026-09-29",
      ),
    ).toEqual({ "ready:a": "2026-09-18", "ready:b": "2026-09-29" });
  });
});

describe("coerceSendLog", () => {
  it("reads garbage as never sent", () => {
    expect(coerceSendLog(null)).toEqual(EMPTY_SEND_LOG);
    expect(coerceSendLog([1])).toEqual(EMPTY_SEND_LOG);
    expect(coerceSendLog({ sentOn: 5, keys: ["a", 2], readySince: { x: "d", y: 3 } })).toEqual({
      sentOn: null,
      keys: ["a"],
      readySince: { x: "d" },
    });
  });
});
