import { describe, it, expect } from "vitest";
import {
  ageLabel,
  coerceSendLog,
  daysBetween,
  decideDigestSend,
  nextReadySince,
  DIGEST_HEARTBEAT_DAYS,
  EMPTY_SEND_LOG,
  sentFrom,
  type DigestLine,
  type DigestSendLog,
} from "../../src/alerts/digest-send.js";

const line = (key: string, metric = 1, asks?: string[]): DigestLine => ({
  key,
  metric,
  ...(asks ? { asks } : {}),
});

const sent = (lines: DigestLine[], sentOn = "2026-09-20"): DigestSendLog => ({
  sentOn,
  sent: sentFrom(lines),
  readySince: {},
});

describe("decideDigestSend", () => {
  it("sends the first time, when nothing has been sent", () => {
    expect(decideDigestSend([line("a")], EMPTY_SEND_LOG, "2026-09-21")).toEqual({
      send: true,
      reason: "first",
    });
  });

  it("stays quiet when every item was already sent at the same or a better metric", () => {
    const log = sent([line("a", 3), line("b")]);
    expect(decideDigestSend([line("b"), line("a", 3)], log, "2026-09-21")).toEqual({
      send: false,
      reason: "unchanged",
    });
    expect(decideDigestSend([line("a", 2)], log, "2026-09-21").send).toBe(false);
  });

  it("sends when an item the operator was not sent appears", () => {
    expect(decideDigestSend([line("a"), line("c")], sent([line("a")]), "2026-09-21").reason).toBe(
      "added",
    );
  });

  it("does not send for a resolution alone; it rides the next send", () => {
    expect(decideDigestSend([line("a")], sent([line("a"), line("b")]), "2026-09-21").send).toBe(
      false,
    );
  });

  it("an item that left and came back since the last send is not news", () => {
    expect(decideDigestSend([line("b")], sent([line("a"), line("b")]), "2026-09-22").send).toBe(
      false,
    );
  });

  it("sends when a metric is worse than at the last send, not than yesterday", () => {
    const log = sent([line("lh", 40)]);
    expect(decideDigestSend([line("lh", 41)], log, "2026-09-21").reason).toBe("worse");
    expect(decideDigestSend([line("lh", 39)], log, "2026-09-21").send).toBe(false);
    expect(decideDigestSend([line("lh", 40)], log, "2026-09-22").send).toBe(false);
  });

  it("sends when an item's ask gains a part, not when it loses one", () => {
    const log = sent([line("p", 2, ["set Report recipients (To)", "health-gate: X (unknown)"])]);
    expect(
      decideDigestSend(
        [line("p", 2, ["add a Header image", "health-gate: X (unknown)"])],
        log,
        "2026-09-21",
      ).reason,
    ).toBe("new-ask");
    expect(
      decideDigestSend([line("p", 1, ["health-gate: X (unknown)"])], log, "2026-09-21").send,
    ).toBe(false);
  });

  it("sends a heartbeat on the seventh day of silence, not the sixth", () => {
    expect(decideDigestSend([line("a")], sent([line("a")], "2026-09-14"), "2026-09-20").send).toBe(
      false,
    );
    expect(decideDigestSend([line("a")], sent([line("a")], "2026-09-14"), "2026-09-21")).toEqual({
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
    expect(
      coerceSendLog({
        sentOn: 5,
        sent: { a: { metric: 2, asks: ["x", 1] }, b: { metric: "3" }, c: 4 },
        readySince: { x: "d", y: 3 },
      }),
    ).toEqual({
      sentOn: null,
      sent: { a: { metric: 2, asks: ["x"] } },
      readySince: { x: "d" },
    });
  });
});
