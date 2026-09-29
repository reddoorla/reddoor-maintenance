import { describe, it, expect } from "vitest";
import {
  ageLabel,
  coerceSendLog,
  daysBetween,
  decideDigestSend,
  nextReadySince,
  DIGEST_HEARTBEAT_DAYS,
  EMPTY_SEND_LOG,
  nextSendLog,
  type DigestLine,
  type DigestSendLog,
} from "../../src/alerts/digest-send.js";

const line = (key: string, metric = 1, asks?: string[]): DigestLine => ({
  key,
  metric,
  ...(asks ? { asks } : {}),
});

const sent = (lines: DigestLine[], sentOn = "2026-09-20"): DigestSendLog =>
  nextSendLog(lines, EMPTY_SEND_LOG, sentOn, true, {});

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

  it("an item still in the log is not news while another one resolves", () => {
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

describe("nextSendLog over consecutive days", () => {
  function replay(days: DigestLine[][], start = "2026-10-01"): string[] {
    let log = EMPTY_SEND_LOG;
    return days.map((lines, n) => {
      const today = new Date(Date.parse(`${start}T00:00:00Z`) + n * 86_400_000)
        .toISOString()
        .slice(0, 10);
      if (lines.length === 0) {
        log = nextSendLog(lines, log, today, false, {});
        return "empty";
      }
      const d = decideDigestSend(lines, log, today);
      log = nextSendLog(lines, log, today, d.send, {});
      return d.send ? d.reason : "skip";
    });
  }

  it("a key mailed, fixed and back sends on its return, after empty or skipped days", () => {
    const bounce = line("delivery:r1");
    const other = line("ready:r2");
    expect(replay([[bounce], [], [], [bounce], [bounce]])).toEqual([
      "first",
      "empty",
      "empty",
      "added",
      "skip",
    ]);
    expect(replay([[other, bounce], [other], [other], [other, bounce]])).toEqual([
      "first",
      "skip",
      "skip",
      "added",
    ]);
  });

  it("keeps the high-water across sends, so jitter under it stays quiet", () => {
    const lh = (m: number) => line("lighthouse:s:performance", m);
    const heart = line("ready:r");
    const days = [
      [lh(70), heart],
      ...Array.from({ length: 6 }, () => [lh(67), heart]),
      [lh(66), heart],
      [lh(69), heart],
      [lh(70), heart],
    ];
    expect(replay(days)).toEqual([
      "first",
      "skip",
      "skip",
      "skip",
      "skip",
      "skip",
      "skip",
      "heartbeat",
      "skip",
      "skip",
    ]);
  });

  it("a metric worse than the high-water still sends, and raises it", () => {
    const lh = (m: number) => line("lh", m);
    expect(replay([[lh(66)], [lh(68)], [lh(67)], [lh(68)], [lh(69)]])).toEqual([
      "first",
      "worse",
      "skip",
      "skip",
      "worse",
    ]);
  });

  it("resets the high-water only when the key drops out, so a lower recurrence can worsen again", () => {
    const lh = (m: number) => line("lh", m);
    const keep = line("ready:r");
    expect(replay([[lh(70), keep], [keep], [lh(60), keep], [lh(65), keep]])).toEqual([
      "first",
      "skip",
      "added",
      "worse",
    ]);
  });

  it("a new blocker swapped in for an old one sends; a returning ask part sends", () => {
    const p = (asks: string[]) => line("preflight:r:pending", 1, asks);
    expect(
      replay([
        [p(["set Report recipients (To)"])],
        [p(["add a Header image"])],
        [p(["add a Header image", "set Report recipients (To)"])],
        [p(["set Report recipients (To)"])],
        [p(["add a Header image", "set Report recipients (To)"])],
      ]),
    ).toEqual(["first", "new-ask", "new-ask", "skip", "new-ask"]);
  });

  it("keeps sentOn on a skip and prunes to the day's keys and parts", () => {
    const log = nextSendLog(
      [line("a", 3, ["x", "y"]), line("b", 2)],
      EMPTY_SEND_LOG,
      "2026-10-01",
      true,
      {},
    );
    expect(nextSendLog([line("a", 1, ["y"])], log, "2026-10-02", false, { r: "d" })).toEqual({
      sentOn: "2026-10-01",
      sent: { a: { metric: 3, asks: ["y"] } },
      readySince: { r: "d" },
    });
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
