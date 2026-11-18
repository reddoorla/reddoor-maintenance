import { describe, it, expect } from "vitest";
import { readSearch, readVisits, windowsFor } from "../../src/lib/overview/traffic.js";
import { trafficWindows } from "../../../src/fleet-daily/traffic.js";
import type { OverviewNight } from "../../../src/fleet-daily/read.js";
import { datesFrom, night, trafficBlock } from "./fixtures.js";

/**
 * P1-87 PR 7a: the guarded read of the traffic block (cockpit/src/lib/overview/traffic.ts).
 * A series is read from the night that holds its `daily`; every stored total is checked
 * against the windows the night implies (never the stored ones), so a block that is not
 * what the nightly writes reads as malformed, never as a number.
 */

const OK = "2026-10-26";

/** A row for `date` whose `traffic` block is `value`. */
const withTraffic = (date: string, value: Record<string, unknown>): OverviewNight =>
  night(date, { traffic: { value } as unknown as OverviewNight["counts"]["traffic"] });

/** The visits half's value for OK, with `over` merged in: the malformed inputs' base. */
const visitsRead = (visits: Record<string, unknown>) =>
  readVisits([withTraffic(OK, trafficBlock(OK, { visits }))]);

type Daily = Array<Record<string, unknown>>;
/** A fresh copy of OK's visits daily, the 60 days from the previous window's start. */
const dailyOf = (): Daily =>
  (trafficBlock(OK).visits as { value: { daily: Daily } }).value.daily.map((d) => ({ ...d }));
const shiftDate = (date: string, days: number): string =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

describe("P1-87 PR 7a: the guarded read", () => {
  it("windowsFor is pinned to the windows the nightly writes (trafficWindows)", () => {
    for (const d of ["2026-10-26", "2026-10-31", "2026-11-02"]) {
      expect(windowsFor(d)).toEqual(trafficWindows(d));
    }
  });

  it("control: a valid block reads as its own night's numbers", () => {
    const r = readVisits([withTraffic(OK, trafficBlock(OK))]);
    expect(r.value).not.toBeNull();
    expect(r.value).toMatchObject({ night: OK, current: 1674, previous: 1542, sitesRead: 16 });
    expect(r.value!.daily.get("2026-10-26")).toBe(spreadLast());
    const s = readSearch([withTraffic(OK, trafficBlock(OK))]);
    expect(s.value).toMatchObject({ night: OK, clicks: 623, impressions: 12521, sitesRead: 16 });
  });

  it("the series is the night that holds its daily, never the newest row", () => {
    const rows = [
      withTraffic(
        "2026-10-26",
        trafficBlock("2026-10-26", {
          visits: { value: null, reason: "traffic: timeout" },
          search: { value: null, reason: "traffic: timeout" },
        }),
      ),
      withTraffic("2026-10-25", trafficBlock("2026-10-25")),
      withTraffic("2026-10-24", trafficBlock("2026-10-24")),
    ];
    expect(readVisits(rows).value?.night).toBe("2026-10-25");
    expect(readSearch(rows).value?.night).toBe("2026-10-25");
  });

  it("the guards: each malformed input reads as malformed, and only the guard it names catches it", () => {
    const shifted = (k: "startDate" | "endDate", days: number) => ({
      startDate: shiftDate(trafficWindows(OK).previous.startDate, k === "startDate" ? days : 0),
      endDate: shiftDate(trafficWindows(OK).previous.endDate, k === "endDate" ? days : 0),
    });
    const day = (i: number, visits: number) => ({ ...dailyOf()[i]!, visits });
    const cases: Array<[string, Record<string, unknown>]> = [
      ["a window that is not a window", { currentWindow: "x" }],
      [
        "previousWindow shifted a day",
        {
          previousWindow: {
            startDate: shiftDate(trafficWindows(OK).previous.startDate, 1),
            endDate: shiftDate(trafficWindows(OK).previous.endDate, 1),
          },
        },
      ],
      [
        "previousWindow.startDate one day later (29 days)",
        { previousWindow: shifted("startDate", 1) },
      ],
      [
        "a day 55.5 and another 54.5 (the sum kept)",
        {
          daily: dailyWith([
            [54, day(54, 55.5)],
            [55, day(55, 54.5)],
          ]),
        },
      ],
      [
        "a day at −1 and another raised by 56 (the sum kept)",
        {
          daily: dailyWith([
            [54, day(54, -1)],
            [55, day(55, 111)],
          ]),
        },
      ],
      ["sitesRead as a string", { sitesRead: "x" }],
      ["a daily entry {day: 5}", { daily: dailyWith([[0, { day: 5 }]]) }],
      [
        "Oct 1 missing from daily (its day removed, the current total lowered to match)",
        {
          daily: dailyOf().filter((d) => d.date !== "2026-10-01"),
          current: 1674 - 56,
        },
      ],
      ["an extra Oct 27 in daily", { daily: [...dailyOf(), { date: "2026-10-27", visits: 5 }] }],
      ["stored current 1675 against days summing 1674", { current: 1675 }],
    ];
    for (const [why, over] of cases) {
      expect(visitsRead(over), why).toEqual({ value: null, reason: "malformed" });
    }
  });

  it("a search half with its window shifted is malformed", () => {
    const w = trafficWindows(OK).search;
    const search = {
      window: { startDate: shiftDate(w.startDate, 1), endDate: shiftDate(w.endDate, 1) },
    };
    const r = readSearch([withTraffic(OK, trafficBlock(OK, { search }))]);
    expect(r).toEqual({ value: null, reason: "malformed" });
  });

  it("with no night holding daily, the newest night's stored reason decides", () => {
    const reasonOf = (stored: string) =>
      readVisits([withTraffic(OK, trafficBlock(OK, { visits: { value: null, reason: stored } }))]);
    expect(reasonOf("not in this row")).toEqual({ value: null, reason: "not collected" });
    expect(reasonOf("GA not configured")).toEqual({ value: null, reason: "not configured" });
    expect(reasonOf("no site read")).toEqual({ value: null, reason: "no site read" });
    expect(reasonOf("traffic: timeout")).toEqual({ value: null, reason: "not readable" });
    expect(readVisits(null)).toEqual({ value: null, reason: "not readable" });
    expect(readVisits([])).toEqual({ value: null, reason: "not collected" });
  });
});

/** The daily with `edits` applied at the given indexes (index into the 60 days). */
function dailyWith(edits: Array<[number, Record<string, unknown>]>): Daily {
  const d = dailyOf();
  for (const [i, e] of edits) d[i] = e;
  return d;
}

/** The last day of OK's current window: the probe's 55 (1,674 over 30 days: the last 6 are 55). */
function spreadLast(): number {
  return 55;
}
