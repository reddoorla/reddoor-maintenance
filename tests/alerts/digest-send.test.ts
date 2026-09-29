import { describe, it, expect } from "vitest";
import {
  ageLabel,
  coerceSendLog,
  daysBetween,
  decideDigestSend,
  nextReadySince,
  DIGEST_HEARTBEAT_DAYS,
  EMPTY_SEND_LOG,
  nextSent,
  LIGHTHOUSE_WORSE_POINTS,
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
  sent: nextSent({}, lines, sentOn, true),
  readySince: {},
});

function days(start: string, n: number): string[] {
  const t = Date.parse(`${start}T00:00:00Z`);
  return Array.from({ length: n }, (_, i) =>
    new Date(t + i * 86_400_000).toISOString().slice(0, 10),
  );
}

function replay(perDay: DigestLine[][], start = "2026-10-01"): string[] {
  let log: DigestSendLog = EMPTY_SEND_LOG;
  const out: string[] = [];
  days(start, perDay.length).forEach((today, i) => {
    const lines = perDay[i]!;
    if (lines.length === 0) {
      log = { ...log, sent: nextSent(log.sent, lines, today, false) };
      out.push("empty");
      return;
    }
    const d = decideDigestSend(lines, log, today);
    log = {
      sentOn: d.send ? today : log.sentOn,
      sent: nextSent(log.sent, lines, today, d.send),
      readySince: {},
    };
    out.push(d.send ? d.reason : "skip");
  });
  return out;
}

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

  it("a Lighthouse deficit is worse only past its tolerance", () => {
    const log = sent([{ ...line("lh", 30), tolerance: 5 }]);
    expect(decideDigestSend([{ ...line("lh", 35), tolerance: 5 }], log, "2026-09-21").send).toBe(
      false,
    );
    expect(decideDigestSend([{ ...line("lh", 36), tolerance: 5 }], log, "2026-09-21").reason).toBe(
      "worse",
    );
  });

  it("sends when a metric beats its baseline", () => {
    const log = sent([line("lh", 40)]);
    expect(decideDigestSend([line("lh", 41)], log, "2026-09-21").reason).toBe("worse");
    expect(decideDigestSend([line("lh", 39)], log, "2026-09-21").send).toBe(false);
  });

  it("sends when an item's ask gains a part, not when it loses one", () => {
    const log = sent([line("p", 2, ["set Report recipients (To)", "health-gate: X"])]);
    expect(
      decideDigestSend([line("p", 2, ["add a Header image", "health-gate: X"])], log, "2026-09-21")
        .reason,
    ).toBe("added");
    expect(decideDigestSend([line("p", 1, ["health-gate: X"])], log, "2026-09-21").send).toBe(
      false,
    );
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

describe("day sequences (P1-20 review round 2)", () => {
  it("an item mailed, fixed for two runs, then back is mailed again at once", () => {
    const bounce = [line("notify-bounce:s1", 3)];
    expect(
      replay([bounce, [], [], [line("notify-bounce:s1", 2)], [line("notify-bounce:s1", 2)]]),
    ).toEqual(["first", "empty", "empty", "added", "skip"]);
  });

  it("a one-run flap (a score hovering at the floor) is not news", () => {
    const lh = line("lighthouse:s1:performance", 26);
    const other = line("ci:s2");
    expect(replay([[lh, other], [other], [lh, other], [other], [lh, other]])).toEqual([
      "first",
      "skip",
      "skip",
      "skip",
      "skip",
    ]);
  });

  it("a fixed ask part that comes back after two runs is news; after one it is not", () => {
    const withAsk = [line("p", 1, ["set Report recipients (To)"])];
    const without = [line("p", 1, ["add a Header image"])];
    expect(replay([withAsk, without, withAsk])).toEqual(["first", "added", "skip"]);
    expect(replay([withAsk, without, without, withAsk])).toEqual([
      "first",
      "added",
      "skip",
      "added",
    ]);
  });

  it("a send does not reset baselines: six jittering scores send at most a few times in 28 days", () => {
    const pattern = [30, 32, 34, 31, 33, 30, 34, 32, 31, 33];
    const perDay = Array.from({ length: 28 }, (_, d) =>
      Array.from({ length: 6 }, (_, i) => ({
        ...line(`lighthouse:s${i}:performance`, pattern[(d * 3 + i * 7) % pattern.length]!),
        tolerance: LIGHTHOUSE_WORSE_POINTS,
      })),
    );
    expect(replay(perDay).filter((r) => r !== "skip")).toEqual([
      "first",
      "heartbeat",
      "heartbeat",
      "heartbeat",
    ]);
    const noTolerance = perDay.map((ls) => ls.map(({ tolerance: _, ...l }) => l));
    expect(replay(noTolerance).filter((r) => r === "worse").length).toBeGreaterThan(0);
  });

  it("a send caused by one item does not lower another item's baseline", () => {
    expect(
      replay([[line("a", 30)], [line("a", 20), line("b")], [line("a", 26), line("b")]]),
    ).toEqual(["first", "added", "skip"]);
  });

  it("a critical item gets no one-run grace: a dead-letter back after one clean run is mailed", () => {
    const dl = (n: number) => [{ ...line("deadletter:x", n), critical: true }];
    expect(replay([dl(3), [], dl(1), dl(1), dl(2)])).toEqual([
      "first",
      "empty",
      "added",
      "skip",
      "worse",
    ]);
  });

  it("a Lighthouse score creeping 4 points a day is mailed once it is 5 past the last send", () => {
    const lh = (n: number) => [{ ...line("lh", n), tolerance: LIGHTHOUSE_WORSE_POINTS }];
    expect(replay([lh(30), lh(34), lh(38), lh(42)])).toEqual(["first", "skip", "worse", "skip"]);
  });

  it("a health-gate field flipping between failing and unknown is the same ask", () => {
    const asks = [line("p", 1, ["health-gate: Maint: Uptime Checked"])];
    expect(replay([asks, asks, asks, asks])).toEqual(["first", "skip", "skip", "skip"]);
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
        sent: {
          a: { metric: 2, gone: "2026-10-01" },
          b: { metric: "3" },
          c: 4,
          d: { metric: 1, gone: 7 },
        },
        readySince: { x: "d", y: 3 },
      }),
    ).toEqual({
      sentOn: null,
      sent: { a: { metric: 2, gone: "2026-10-01" }, d: { metric: 1 } },
      readySince: { x: "d" },
    });
  });
});
