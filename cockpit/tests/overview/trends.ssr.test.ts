import { describe, it, expect } from "vitest";
import type { OverviewNight } from "../../../src/fleet-daily/read.js";
import {
  HOW_WE_COUNT,
  TREND_AXIS_NIGHTS,
  TREND_NIGHTS,
  UNREADABLE,
  trendGeometry,
  trendsFromDaily,
  MIN_COLUMN,
  tickLabel,
  type TrendChart,
} from "../../src/lib/overview/view.js";
import { overviewFromSnapshot } from "../../src/lib/overview/view.js";
import { NOW, night, snapshot, trafficBlock } from "./fixtures.js";

/**
 * P1-78h: section 8, trends from `fleet_daily` (workspace
 * briefs/2026-10-26-p1-78h-trends.md). The model's points and the geometry the page
 * draws from them. NOW is Oct 27, 11am PT, so the night expected by now is Oct 26.
 */

const DAY = 86_400_000;
/** `n` consecutive nights ending on `last`, newest first, as the reader returns them. */
function run(
  last: string,
  n: number,
  over: (date: string, i: number) => Partial<OverviewNight["counts"]> = () => ({}),
): OverviewNight[] {
  return Array.from({ length: n }, (_, i) => {
    const date = new Date(Date.parse(`${last}T00:00:00Z`) - i * DAY).toISOString().slice(0, 10);
    return night(date, over(date, i));
  });
}

const tiers = (broken: number, attention: number) => ({
  sites: { value: { cards: 5, tiers: { broken, attention, healthy: 3 }, preLaunch: 0, setup: 0 } },
});

const chart = (v: ReturnType<typeof trendsFromDaily>, title: RegExp): TrendChart => {
  const c = v.charts?.find((x) => title.test(x.title));
  if (c === undefined) throw new Error(`no chart ${title}`);
  return c;
};
const values = (c: TrendChart, s = 0) => c.series[s]!.points.map((p) => p.value);

describe("the 14-night threshold", () => {
  it("with 13 nights, says how many it has collected and draws nothing", () => {
    const v = trendsFromDaily(run("2026-10-26", TREND_NIGHTS - 1), NOW);
    expect(v.charts).toBeNull();
    expect(v.status).toBe("Collecting: 13 of 14 nights; the charts start once all 14 are in");
  });

  it("with one night, the first-night wording", () => {
    expect(trendsFromDaily(run("2026-10-26", 1), NOW).status).toBe(
      "Collecting: 1 of 14 nights; the charts start once all 14 are in",
    );
  });

  it("with 14 nights, draws the seven charts", () => {
    const v = trendsFromDaily(run("2026-10-26", TREND_NIGHTS), NOW);
    expect(v.charts?.map((c) => c.title)).toEqual([
      "Broken and Attention sites, each night",
      "Checks run on sites, each night",
      "Submissions the client was emailed about, RSVPs included, each night",
      "Vulnerabilities: sites with an alert open, and sites cleared",
      "Engaged visits, each day",
      "Times shown in Google, each day",
      "Clicks through from Google, each day",
    ]);
    expect(v.charts![0]!.series[0]!.points).toHaveLength(14);
  });

  it("nights that could not be read are said so, never collecting", () => {
    expect(trendsFromDaily(null, NOW)).toEqual({ status: UNREADABLE, charts: null });
  });
});

describe("a missing night is a gap, not a zero", () => {
  // Fourteen rows over fifteen nights: Oct 20 has no row.
  const nights = run("2026-10-26", 15, (_, i) => tiers(i % 3, 1)).filter(
    (n) => n.night !== "2026-10-20",
  );
  const v = trendsFromDaily(nights, NOW);

  it("the night has no value, and says why", () => {
    const broken = chart(v, /^Broken/);
    const at = broken.nights.indexOf("Oct 20");
    expect(at).toBeGreaterThan(0);
    expect(broken.series.map((x) => x.name)).toEqual(["Broken", "Attention"]);
    expect(broken.series[0]!.points[at]).toEqual({
      value: null,
      note: "no count that night",
      earlier: false,
    });
    for (const c of v.charts!)
      for (const s of c.series) expect(s.points[at]!.value, `${c.title} ${s.name}`).toBeNull();
  });

  it("the night after it has nothing to subtract from, so a delta is a gap too", () => {
    const leads = chart(v, /^Submissions/);
    const after = leads.series[0]!.points[leads.nights.indexOf("Oct 21")]!;
    expect(after.value).toBeNull();
    expect(after.note).toBe("no count the night before, so nothing to subtract");
  });

  it("the line breaks there: two pieces, no vertex at the gap", () => {
    const broken = chart(v, /^Broken/);
    const g = trendGeometry(broken);
    expect(g.lines.filter((l) => l.series === 0)).toHaveLength(2);
    const at = broken.nights.indexOf("Oct 20");
    const x = g.slots[at]!.x;
    for (const l of g.lines) expect(l.points.map((p) => p.x)).not.toContain(x);
    // Its hover target still names the night, with why it has no point.
    expect(g.slots[at]!.title).toBe("Oct 20: no count that night");
  });

  it("no bar stands on the gap", () => {
    const checks = chart(v, /^Checks run/);
    const g = trendGeometry(checks);
    const at = checks.nights.indexOf("Oct 20");
    expect(g.bars.map((b) => b.x)).not.toContain(g.slots[at]!.x);
    expect(g.bars).toHaveLength(14);
  });
});

describe("a count that could not be read is a gap, not a zero", () => {
  const nights = run("2026-10-26", 14, (date) =>
    date === "2026-10-22"
      ? {
          sites: { value: null, reason: "model: boom" },
          leads: { value: null, reason: "leads: boom" },
          signals: { value: null, reason: "signals: boom" },
          events: { value: null, reason: "events: boom" },
          coverage: {
            value: { security_audit_at: { value: null, reason: "still running" } },
          },
        }
      : {},
  );
  const v = trendsFromDaily(nights, NOW);
  const on = (c: TrendChart, s = 0) => c.series[s]!.points[c.nights.indexOf("Oct 22")]!;

  it("every chart has no value that night, and says why", () => {
    // The fixture's rows carry no traffic block at all, so the three traffic charts are
    // unmeasured (the tile's "not yet collected"), not unreadable. The four count charts
    // read their own rows, which are unreadable that night (P1-87 PR 7b: the traffic charts
    // added to the same loop).
    v.charts!.forEach((c, ci) => {
      const traffic = ci >= 4;
      for (let s = 0; s < c.series.length; s++) {
        expect(on(c, s).value, `${c.title} ${s}`).toBeNull();
        expect(on(c, s).note, `${c.title} ${s}`).toBe(
          traffic ? "not yet collected" : "could not be read that night",
        );
      }
    });
  });

  it("a delta the night after an unread night is not taken across it", () => {
    const leads = chart(v, /^Submissions/);
    const after = leads.series[0]!.points[leads.nights.indexOf("Oct 23")]!;
    expect(after.value).toBeNull();
    expect(after.note).toBe("the night before could not be read, so nothing to subtract");
  });

  it("checks run is unread when any one check's count is unread", () => {
    const nights2 = run("2026-10-26", 14, (date) =>
      date === "2026-10-22"
        ? {
            coverage: {
              value: {
                security_audit_at: { value: 17 },
                lighthouse_at: { value: null, reason: "still running" },
              },
            },
          }
        : {},
    );
    const c = chart(trendsFromDaily(nights2, NOW), /^Checks run/);
    expect(on(c).value).toBeNull();
  });
});

describe("the level charts start at the current ladder version", () => {
  // Five nights on ladder 1, then fourteen on ladder 2.
  const nights = run("2026-10-26", 19, (_, i) => ({
    ...tiers(2, 3),
    ladderVersion: i < 14 ? 2 : 1,
  }));
  const v = trendsFromDaily(nights, NOW);

  it("an earlier version's nights are marked earlier and have no value", () => {
    const broken = chart(v, /^Broken/);
    const pts = broken.series[0]!.points;
    expect(pts.slice(0, 5).every((p) => p.earlier && p.value === null)).toBe(true);
    expect(pts[0]!.note).toBe("sorted into levels by earlier rules");
    expect(pts.slice(5).every((p) => !p.earlier && p.value === 2)).toBe(true);
    expect(broken.note).toBe(
      "Each line is the number of sites at that level that night, by each site's worst open item. On the shaded nights, sites were sorted into levels by earlier rules, so those nights are left out rather than compared.",
    );
  });

  it("never one joined line: the line starts at the current version", () => {
    const g = trendGeometry(chart(v, /^Broken/));
    // One line per level, each the current version's fourteen nights only.
    // Attention first, so Broken is drawn on top where the two meet.
    expect(g.lines.map((l) => l.series)).toEqual([1, 0]);
    for (const l of g.lines) {
      expect(l.points).toHaveLength(14);
      expect(l.points[0]!.x).toBe(g.slots[5]!.x);
    }
    // The earlier nights are one shaded band, the break.
    expect(g.earlier).toEqual([
      { x: g.slots[0]!.left, width: g.slots[5]!.left - g.slots[0]!.left },
    ]);
  });

  it("the current version is the newest night's that records one", () => {
    // The two newest rows carry no version (hand-written, or written before the field):
    // they are gaps that say so, and the fourteen before them are the current ladder.
    const mixed = run("2026-10-26", 16, (_, i) =>
      i < 2 ? { ...tiers(1, 1), ladderVersion: undefined as unknown as number } : tiers(2, 3),
    );
    const c = chart(trendsFromDaily(mixed, NOW), /^Broken/);
    expect(c.note).toBe(
      "Each line is the number of sites at that level that night, by each site's worst open item. A blank night has no count, could not be read, or did not record its rules; the table says which.",
    );
    const pts = c.series[0]!.points;
    expect(pts.slice(0, 14).every((p) => p.value === 2 && !p.earlier)).toBe(true);
    expect(pts.slice(14)).toEqual([
      {
        value: null,
        note: "the nightly did not record which ladder rules it used",
        earlier: false,
      },
      {
        value: null,
        note: "the nightly did not record which ladder rules it used",
        earlier: false,
      },
    ]);
  });

  it("charts that do not read the ladder draw every night", () => {
    const checks = chart(v, /^Checks run/);
    expect(checks.note).toBe(
      "Each column adds up, for each kind of check, the sites it checked that night: five checks on seven sites count 35.",
    );
    expect(chart(v, /^Vulnerabilities/).note).toBe(
      "The nightly does not count new vulnerabilities found, so the line shows sites whose vulnerability alert was on the Triage page that night. That leaves out a site whose alert is waiting on an automatic update and takes in sites still launching, so it need not match Open now. The columns are sites cleared that night: from one or more critical or high vulnerabilities to none.",
    );
    expect(values(checks).every((x) => x !== null)).toBe(true);
  });

  it("an earlier version between two current runs is a break of its own", () => {
    const sandwich = run("2026-10-26", 16, (_, i) => ({
      ...tiers(1, 1),
      ladderVersion: i === 7 ? 1 : 2,
    }));
    const g = trendGeometry(chart(trendsFromDaily(sandwich, NOW), /^Broken/));
    expect(g.lines.filter((l) => l.series === 0)).toHaveLength(2);
    expect(g.earlier).toHaveLength(1);
  });
});

describe("what each chart counts", () => {
  const nights = run("2026-10-26", 14, (_, i) => ({
    ...tiers(i === 0 ? 1 : 0, 2),
    // Cumulative totals, newest first: 3 more notified each night, 1 more cleared on two.
    leads: {
      value: { new: 0, read: 0, archived: 0, spamAuto: 0, spam: 0, notified: 400 - 3 * i },
    },
    events: { value: { pr_automerged: 90, vuln_cleared: i < 2 ? 9 : 7 } },
    signals: { value: { vuln: i === 0 ? 0 : 2, renovate: 4 } },
    coverage: {
      value: {
        security_audit_at: { value: 17 },
        lighthouse_at: { value: 17 },
        form_e2e_checked_at: { value: 15 },
      },
    },
  }));
  const v = trendsFromDaily(nights, NOW);

  it("Broken and Attention are the sites at each level", () => {
    expect(values(chart(v, /^Broken/)).at(-1)).toBe(1);
    expect(values(chart(v, /^Broken/)).at(-2)).toBe(0);
    expect(values(chart(v, /^Broken/), 1).at(-1)).toBe(2);
  });

  it("a level absent from a night's measured tiers is 0 that night", () => {
    const quiet = run("2026-10-26", 14, () => ({
      sites: { value: { cards: 2, tiers: { healthy: 2 }, preLaunch: 0, setup: 0 } },
    }));
    expect(values(chart(trendsFromDaily(quiet, NOW), /^Broken/)).every((x) => x === 0)).toBe(true);
  });

  it("checks run adds up every check's sites that night", () => {
    expect(values(chart(v, /^Checks run/)).every((x) => x === 49)).toBe(true);
  });

  it("leads delivered is the night's rise in leads the client was notified of", () => {
    const leads = values(chart(v, /^Submissions/));
    expect(leads[0]).toBeNull();
    expect(leads.slice(1).every((x) => x === 3)).toBe(true);
    expect(chart(v, /^Submissions/).series[0]!.points[0]!.note).toBe(
      "no count the night before, so nothing to subtract",
    );
  });

  it("vulnerabilities: alerts open each night, and sites cleared that night", () => {
    const c = chart(v, /^Vulnerabilities/);
    expect(c.series.map((s) => s.name)).toEqual(["Sites cleared", "Sites with an alert open"]);
    expect(values(c, 0).at(-1)).toBe(0);
    expect(values(c, 0).at(-2)).toBe(2);
    expect(values(c, 1).at(-1)).toBe(0);
    expect(values(c, 1).at(-2)).toBe(2);
  });
});

describe("the window", () => {
  it("spans at most the last 31 nights", () => {
    const v = trendsFromDaily(run("2026-10-26", 32), NOW);
    expect(v.charts![0]!.series[0]!.points).toHaveLength(TREND_AXIS_NIGHTS);
    expect(v.charts![0]!.nights.at(-1)).toBe("Oct 26");
    expect(v.charts![0]!.nights[0]).toBe("Sep 26");
  });

  it("runs to the night expected by now, so a nightly that stopped shows as gaps", () => {
    // Fourteen nights to Oct 22; the night expected by NOW is Oct 26.
    const v = trendsFromDaily(run("2026-10-22", 14), NOW);
    const c = v.charts![0]!;
    expect(c.nights).toHaveLength(18);
    expect(c.nights.slice(-4).map((l, i) => [l, c.series[0]!.points[14 + i]!.value])).toEqual([
      ["Oct 23", null],
      ["Oct 24", null],
      ["Oct 25", null],
      ["Oct 26", null],
    ]);
    expect(v.status).toBe(
      "The 18 nights from Oct 9 to Oct 26, 4 with no count; none counted since the night of Oct 22",
    );
  });

  it("starts at the first night counted, not 30 nights back", () => {
    const v = trendsFromDaily(run("2026-10-26", 14), NOW);
    expect(v.charts![0]!.nights[0]).toBe("Oct 13");
    expect(v.status).toBe("The 14 nights from Oct 13 to Oct 26");
  });
});

describe("the axis and the geometry", () => {
  const v = trendsFromDaily(
    run("2026-10-26", 14, (_, i) => tiers(i % 4, 0)),
    NOW,
  );
  const broken = chart(v, /^Broken/);

  it("the axis runs from 0 to a round number at or above the highest value", () => {
    expect(broken.low).toBe(0);
    expect(broken.high).toBe(4);
    const flat = chart(
      trendsFromDaily(
        run("2026-10-26", 14, () => tiers(0, 0)),
        NOW,
      ),
      /^Broken/,
    );
    // All zero still has an axis to draw on.
    expect(flat.high).toBe(1);
  });

  it("a value sits at its height on that axis, and 0 on the baseline", () => {
    const g = trendGeometry(broken);
    const all = g.lines.flatMap((l) => l.points);
    const zero = all.find((p) => p.value === 0)!;
    expect(zero.y).toBe(g.baseline);
    const three = all.find((p) => p.value === 3)!;
    expect(three.y).toBeCloseTo(g.baseline - (3 / 4) * (g.baseline - g.top));
  });

  it("every night has a hover target naming it and each value", () => {
    const g = trendGeometry(broken);
    expect(g.slots).toHaveLength(14);
    expect(g.slots.at(-1)!.title).toBe("Oct 26: Broken: 0; Attention: 0");
  });

  it("a one-series chart's hover target names its series too (round 3)", () => {
    expect(trendGeometry(chart(v, /^Checks run/)).slots.at(-1)!.title).toBe(
      "Oct 26: Checks run: 5",
    );
  });

  it("the vulnerabilities chart names both in each hover target", () => {
    const g = trendGeometry(chart(v, /^Vulnerabilities/));
    expect(g.slots.at(-1)!.title).toBe("Oct 26: Sites cleared: 0; Sites with an alert open: 0");
  });
});

describe("review round 1", () => {
  /** Every line runs over consecutive slots only: never across a gap or a break. */
  const contiguous = (c: TrendChart) => {
    const g = trendGeometry(c);
    const xs = g.slots.map((t) => t.x);
    for (const l of g.lines) {
      const at = l.points.map((p) => xs.indexOf(p.x));
      expect(at.every((k) => k >= 0)).toBe(true);
      for (let k = 1; k < at.length; k++) expect(at[k]! - at[k - 1]!, l.d).toBe(1);
      const d = l.points.map((p, k) => `${k === 0 ? "M" : "L"}${p.x},${p.y}`).join("");
      expect(l.d).toBe(d);
      for (const k of at) expect(c.series[l.series]!.points[k]!.value).not.toBeNull();
    }
    return g;
  };

  it("no line runs across a gap (T1)", () => {
    const nights = run("2026-10-26", 15, (_, i) => tiers(i % 3, 1)).filter(
      (n) => n.night !== "2026-10-20",
    );
    contiguous(chart(trendsFromDaily(nights, NOW), /^Broken/));
  });

  it("no line runs across an earlier version between two current runs (T1)", () => {
    const sandwich = run("2026-10-26", 16, (_, i) => ({
      ...tiers(1, 1),
      ladderVersion: i === 7 ? 1 : 2,
    }));
    const g = contiguous(chart(trendsFromDaily(sandwich, NOW), /^Broken/));
    expect(g.lines).toHaveLength(4);
    // The band is marked by a rule at each edge.
    expect(g.breaks).toEqual([g.earlier[0]!.x, g.earlier[0]!.x + g.earlier[0]!.width]);
  });

  it("a night alone between gaps is a dot, not lost (T2)", () => {
    const nights = run("2026-10-26", 16, () => tiers(1, 0)).filter(
      (n) => n.night !== "2026-10-23" && n.night !== "2026-10-25",
    );
    const c = chart(trendsFromDaily(nights, NOW), /^Broken/);
    const g = trendGeometry(c);
    const x = g.slots[c.nights.indexOf("Oct 24")]!.x;
    expect(g.dots.filter((d) => d.series === 0 && d.x === x)).toHaveLength(1);
    expect(g.lines.flatMap((l) => l.points.map((p) => p.x))).not.toContain(x);
  });

  it("a 0 is a low column; a gap has none (C2, O2)", () => {
    const nights = run("2026-10-26", 15, () => ({
      leads: {
        value: { new: 0, read: 0, archived: 0, spamAuto: 0, spam: 0, notified: 10 },
      },
    })).filter((n) => n.night !== "2026-10-20");
    const c = chart(trendsFromDaily(nights, NOW), /^Submissions/);
    const g = trendGeometry(c);
    expect(c.series[0]!.points.filter((p) => p.value === 0)).toHaveLength(g.bars.length);
    for (const b of g.bars) expect(b.height).toBe(MIN_COLUMN);
    expect(MIN_COLUMN).toBeGreaterThanOrEqual(2);
    const gap = g.slots[c.nights.indexOf("Oct 20")]!.x;
    expect(g.bars.map((b) => b.x)).not.toContain(gap);
  });

  it("a fall in a running total is a gap that says so, never a column below the axis (C1, O4)", () => {
    const nights = run("2026-10-26", 14, (_, i) => ({
      leads: {
        value: { new: 0, read: 0, archived: 0, spamAuto: 0, spam: 0, notified: i === 0 ? 9 : 10 },
      },
    }));
    const c = chart(trendsFromDaily(nights, NOW), /^Submissions/);
    expect(c.series[0]!.points.at(-1)).toEqual({
      value: null,
      note: "fewer than the night before: at least one the client was emailed about was later marked spam, or its email bounced, so not drawn",
      earlier: false,
    });
    expect(c.low).toBe(0);
    expect(c.summary).not.toContain("-");
  });

  it("a malformed row reads as unread and the page still returns (C3)", () => {
    const nights = run("2026-10-26", 14, (_, i) =>
      i === 0
        ? {
            leads: { value: { new: 1 } as never },
            sites: { value: { cards: 1, preLaunch: 0, setup: 0 } as never },
            coverage: { value: { security_audit_at: {} as never } },
          }
        : {},
    );
    const v = trendsFromDaily(nights, NOW);
    for (const c of v.charts!.slice(0, 3))
      expect(c.series[0]!.points.at(-1)!.note, c.title).toBe("could not be read that night");
    for (const c of v.charts!) expect(Number.isFinite(c.high), c.title).toBe(true);
  });

  it("the summary gives the range and the newest value (O9)", () => {
    const v = trendsFromDaily(
      run("2026-10-26", 14, (_, i) => tiers(i % 4, 2)),
      NOW,
    );
    expect(chart(v, /^Broken/).summary).toBe(
      "Broken: from 0 to 3 over the 14 nights drawn, 0 on Oct 26. Attention: 2 on each of the 14 nights drawn, 2 on Oct 26. Every night is drawn.",
    );
  });
});

describe("review round 2", () => {
  it("the threshold counts nights inside the window, not every row (C2)", () => {
    // Fourteen rows ending Oct 3: only Sep 26 to Oct 3 fall in the 31 nights to Oct 26.
    const v = trendsFromDaily(run("2026-10-03", 14), NOW);
    expect(v).toEqual({
      status:
        "Collecting: 8 of 14 nights in the last 31; the charts start once all 14 are in; none counted since the night of Oct 3",
      charts: null,
    });
  });

  it("the collecting line says when the nightly stopped (round 3, C1)", () => {
    // Twenty rows to Oct 3: the night expected by now is Oct 26.
    expect(trendsFromDaily(run("2026-10-03", 20), NOW).status).toBe(
      "Collecting: 8 of 14 nights in the last 31; the charts start once all 14 are in; none counted since the night of Oct 3",
    );
    // Up to date: nothing said.
    expect(trendsFromDaily(run("2026-10-26", 3), NOW).status).toBe(
      "Collecting: 3 of 14 nights; the charts start once all 14 are in",
    );
  });

  it("no rows at all is collecting, not a throw", () => {
    expect(trendsFromDaily([], NOW).status).toBe(
      "Collecting: 0 of 14 nights; the charts start once all 14 are in",
    );
  });

  it("a halfway tick when it is a whole number (O-m2)", () => {
    const at = (b: number) =>
      chart(
        trendsFromDaily(
          run("2026-10-26", 14, () => tiers(b, 0)),
          NOW,
        ),
        /^Broken/,
      );
    expect([at(0).high, at(0).mid]).toEqual([1, null]);
    expect([at(2).high, at(2).mid]).toEqual([2, 1]);
    // Round 3: a 3 reads off a 0-4 axis with a tick at 2, not 0-5 with none.
    expect([at(3).high, at(3).mid]).toEqual([4, 2]);
    expect([at(5).high, at(5).mid]).toEqual([6, 3]);
    expect([at(9).high, at(9).mid]).toEqual([10, 5]);
    const g = trendGeometry(at(2));
    expect(g.midY).toBe((g.top + g.baseline) / 2);
  });

  it("a night is a gap in the summary only when every series has no point (T5)", () => {
    // Events unread on Oct 22: the cleared columns gap there and on Oct 23; the open
    // line is drawn every night, so no night is without a point.
    const nights = run("2026-10-26", 14, (date) =>
      date === "2026-10-22" ? { events: { value: null, reason: "boom" } } : {},
    );
    const c = chart(trendsFromDaily(nights, NOW), /^Vulnerabilities/);
    expect(c.series[0]!.points.filter((p) => p.value === null)).toHaveLength(3);
    expect(c.summary.endsWith("Every night is drawn.")).toBe(true);
  });

  it("a night whose events hold no clearing cleared none (T6-F)", () => {
    const nights = run("2026-10-26", 14, () => ({ events: { value: { pr_automerged: 4 } } }));
    const c = chart(trendsFromDaily(nights, NOW), /^Vulnerabilities/);
    expect(c.series[0]!.points.slice(1).every((p) => p.value === 0)).toBe(true);
  });
});

describe("review round 3", () => {
  it("before 6am PT the newest night still ends the window (T1)", () => {
    // Oct 27, 2am PT: the expected night is still Oct 25, but Oct 26's row is in.
    const early = new Date("2026-10-27T09:00:00.000Z");
    const v = trendsFromDaily(run("2026-10-26", 14), early);
    expect(v.status).toBe("The 14 nights from Oct 13 to Oct 26");
    expect(v.charts![0]!.series[0]!.points.at(-1)!.value).not.toBeNull();
  });

  it("a hover title names each series' own reason (T3)", () => {
    // Oct 21 has no row; on Oct 22 the open count could not be read, so the cleared
    // column has no night before and the line is unread: two different reasons.
    const nights = run("2026-10-26", 15, (date) =>
      date === "2026-10-22" ? { signals: { value: null, reason: "boom" } } : {},
    ).filter((n) => n.night !== "2026-10-21");
    const c = chart(trendsFromDaily(nights, NOW), /^Vulnerabilities/);
    const g = trendGeometry(c);
    expect(g.slots[c.nights.indexOf("Oct 22")]!.title).toBe(
      "Oct 22: Sites cleared: no count the night before, so nothing to subtract; Sites with an alert open: could not be read that night",
    );
  });

  it("a hand-written null coverage column does not throw the overview (C2)", () => {
    const nights = run("2026-10-26", 2, (_, i) =>
      i === 0
        ? { coverage: { value: { last_smoke_at: null, lighthouse_at: { value: 17 } } as never } }
        : {},
    );
    const v = overviewFromSnapshot(snapshot({ nights }), NOW);
    expect(v.nightly.scale).toBe(
      "1 kind of check ran on the night of Oct 26, reaching up to 17 sites",
    );
  });
});

describe("review round 4", () => {
  it("ladder version 0, the old tiers, is an earlier version like any other (T1)", () => {
    // Five nights on version 0 (the old tiers, in fleet_daily since P1-78a), then
    // fourteen on version 2: a truthiness test on the version would lose the break.
    const nights = run("2026-10-26", 19, (_, i) => ({
      ...tiers(2, 3),
      ladderVersion: i < 14 ? 2 : 0,
    }));
    const broken = chart(trendsFromDaily(nights, NOW), /^Broken/);
    const pts = broken.series[0]!.points;
    expect(
      pts.slice(0, 5).every((p) => p.earlier && p.note === "sorted into levels by earlier rules"),
    ).toBe(true);
    expect(pts.slice(5).every((p) => !p.earlier && p.value === 2)).toBe(true);
    expect(broken.note).toContain("On the shaded nights");
    const g = trendGeometry(broken);
    expect(g.earlier).toHaveLength(1);
    // One rule, where the band meets the current version; none on the plot's left edge.
    expect(g.breaks).toEqual([g.slots[5]!.left]);
  });

  it("the current version is read off a night on version 0 too (T1)", () => {
    const nights = run("2026-10-26", 14, () => ({ ...tiers(1, 1), ladderVersion: 0 }));
    const broken = chart(trendsFromDaily(nights, NOW), /^Broken/);
    expect(values(broken)).toEqual(Array(14).fill(1));
  });

  it("a block that is not an object reads as unread, never as 0 (C1)", () => {
    const bad = {
      events: { value: 7 },
      signals: { value: 7 },
      sites: { value: { cards: 5, tiers: "x", preLaunch: 0, setup: 0 } },
      coverage: { value: 5 },
    } as never;
    const nights = run("2026-10-26", 14, (_, i) =>
      i === 3 ? bad : { ...tiers(2, 3), events: { value: { vuln_cleared: 2 } } },
    );
    const v = trendsFromDaily(nights, NOW);
    const at = 10; // the night of `bad`, oldest first
    for (const [title, s] of [
      [/^Broken/, 0],
      [/^Broken/, 1],
      [/^Checks run/, 0],
      [/^Vulnerabilities/, 0],
      [/^Vulnerabilities/, 1],
    ] as const)
      expect(chart(v, title).series[s]!.points[at]!.note, `${title} ${s}`).toBe(
        "could not be read that night",
      );
    // The night after it has no base: no false column of sites cleared.
    expect(chart(v, /^Vulnerabilities/).series[0]!.points[at + 1]!.value).toBeNull();
    expect(chart(v, /^Vulnerabilities/).series[0]!.points[at + 1]!.note).toBe(
      "the night before could not be read, so nothing to subtract",
    );
  });

  it("a negative count reads as unread, never as a 0 column or a line off the chart (C2)", () => {
    const nights = run("2026-10-26", 14, (_, i) =>
      i === 0
        ? { ...tiers(-3, 1), coverage: { value: { lighthouse_at: { value: -5 } } } }
        : tiers(2, 3),
    );
    const v = trendsFromDaily(nights, NOW);
    expect(chart(v, /^Broken/).series[0]!.points.at(-1)!.note).toBe("could not be read that night");
    expect(chart(v, /^Checks run/).series[0]!.points.at(-1)!.note).toBe(
      "could not be read that night",
    );
    const g = trendGeometry(chart(v, /^Broken/));
    for (const l of g.lines) for (const p of l.points) expect(p.y).toBeLessThanOrEqual(g.height);
  });
  it("a block hand-written as an array reads as unread, never as an empty one (round 5, T1)", () => {
    const bad = {
      sites: { value: { cards: 5, tiers: [], preLaunch: 0, setup: 0 } },
      events: { value: [] },
      signals: { value: [] },
    } as never;
    const nights = run("2026-10-26", 14, (_, i) =>
      i === 3 ? bad : { ...tiers(2, 3), events: { value: { vuln_cleared: 2 } } },
    );
    const v = trendsFromDaily(nights, NOW);
    const at = 10;
    for (const [title, s] of [
      [/^Broken/, 0],
      [/^Broken/, 1],
      [/^Vulnerabilities/, 0],
      [/^Vulnerabilities/, 1],
    ] as const)
      expect(chart(v, title).series[s]!.points[at]!.note, `${title} ${s}`).toBe(
        "could not be read that night",
      );
  });

  it("an infinite count reads as unread (round 5, T2)", () => {
    const nights = run("2026-10-26", 14, (_, i) =>
      i === 0 ? { coverage: { value: { lighthouse_at: { value: Infinity } } } } : {},
    );
    const c = chart(trendsFromDaily(nights, NOW), /^Checks run/);
    expect(c.series[0]!.points.at(-1)!.note).toBe("could not be read that night");
  });

  it("a night whose coverage block holds no check ran none: a real 0 (round 5, T3)", () => {
    const nights = run("2026-10-26", 14, (_, i) => (i === 0 ? { coverage: { value: {} } } : {}));
    const c = chart(trendsFromDaily(nights, NOW), /^Checks run/);
    expect(c.series[0]!.points.at(-1)!.value).toBe(0);
  });
});

/**
 * P1-87 PR 7b: the 31-night axis and the three traffic charts (engaged visits, times shown in
 * Google, clicks through). The series is the night holding `daily`; a day after it is "no
 * reading", a search day in its last three is "Google has no data yet", a visits day in the
 * window is its value (the newest is still being counted), and every point before its window
 * is "before the 30 days the tile counts" (visits) or "before the 28 days the tile counts"
 * (search).
 */
describe("P1-87 PR 7b: 31 nights and the three traffic charts", () => {
  const N = "2026-10-26";
  const traffic = (block: Record<string, unknown>) =>
    ({ value: block }) as unknown as OverviewNight["counts"]["traffic"];
  /** 32 nights to Oct 26, with the traffic block `block` on the newest row. */
  const withBlock = (block: Record<string, unknown>) =>
    run(N, 32, (_, i) => (i === 0 ? { traffic: traffic(block) } : {}));
  const sumOf = (xs: Array<number | null>) => xs.reduce<number>((a, x) => a + (x ?? 0), 0);
  // The traffic charts' indices, after the four existing ones.
  const DAYS = { visits: 4, searchTimes: 5, clicks: 6 } as const;
  const TF = (v: ReturnType<typeof trendsFromDaily>, i: number) => v.charts![i]!;
  const v = trendsFromDaily(withBlock(trafficBlock(N)), NOW);

  it("the axis is 31 nights, Sep 26 to Oct 26, and the status says so", () => {
    expect(v.status).toBe("The 31 nights from Sep 26 to Oct 26");
    expect(TF(v, DAYS.visits).nights).toHaveLength(TREND_AXIS_NIGHTS);
  });

  it("visits: the night before the window is blank with its reason, the window sums to the tile", () => {
    const c = TF(v, DAYS.visits);
    const p = c.series[0]!.points;
    expect(p[0]).toMatchObject({ value: null, note: "before the 30 days the tile counts" });
    expect(sumOf(p.slice(1).map((q) => q.value))).toBe(1674);
    expect(p[30]).toMatchObject({ value: 55, partial: true, note: "still being counted" });
    expect(c.slotHeading).toBe("Day");
    expect(c.term).toBe("Engaged visits");
  });

  it("search: the 28 days to Oct 23 sum to the tile, and the last three days are lag", () => {
    const impressions = TF(v, DAYS.searchTimes);
    const clicks = TF(v, DAYS.clicks);
    expect(sumOf(impressions.series[0]!.points.slice(0, 28).map((q) => q.value))).toBe(12521);
    expect(sumOf(clicks.series[0]!.points.slice(0, 28).map((q) => q.value))).toBe(623);
    for (const c of [impressions, clicks]) {
      expect(c.series[0]!.points.slice(28).map((q) => [q.value, q.lag, q.note])).toEqual([
        [null, true, "Google has no data yet"],
        [null, true, "Google has no data yet"],
        [null, true, "Google has no data yet"],
      ]);
      // Sep 26 is the search window's first day, so it has its count, not a blank.
      expect(c.series[0]!.points[0]!.value).not.toBeNull();
      expect(c.term).toBe("Times shown in Google");
    }
  });

  it("a day is drawn at its own date, not its index: a spike on Oct 1 lands at Oct 1", () => {
    const block = trafficBlock(N) as {
      search: {
        value: { daily: Array<{ date: string; clicks: number; impressions: number }> };
      };
    };
    const daily = block.search.value.daily.map((d) => ({ ...d }));
    const oct1 = daily.findIndex((d) => d.date === "2026-10-01");
    const oct2 = oct1 + 1;
    daily[oct1]!.impressions += 300;
    daily[oct2]!.impressions -= 300;
    const spiked = { ...block, search: { value: { ...block.search.value, daily } } };
    const c = TF(trendsFromDaily(withBlock(spiked), NOW), DAYS.searchTimes);
    const at = c.nights.indexOf("Oct 1");
    expect(c.series[0]!.points[at]!.value).toBe(747);
    expect(c.series[0]!.points[at + 1]!.value).toBe(147);
  });

  it("late: a day after the series' night is no reading, never 0; the window's days before the axis are counted", () => {
    const rows = run(N, 32, (d, i) =>
      d === "2026-10-24"
        ? { traffic: traffic(trafficBlock("2026-10-24")) }
        : i < 2
          ? {
              traffic: traffic({
                visits: { value: null, reason: "traffic: timeout" },
                search: { value: null, reason: "traffic: timeout" },
                sites: [],
              }),
            }
          : {},
    );
    const late = trendsFromDaily(rows, NOW);
    const vis = TF(late, DAYS.visits);
    const oct = (d: string) => vis.nights.indexOf(d);
    expect(vis.series[0]!.points[oct("Oct 25")]).toMatchObject({
      value: null,
      note: "no traffic reading since the night of Oct 24",
    });
    expect(vis.series[0]!.points[oct("Oct 26")]!.value).toBeNull();
    expect(vis.series[0]!.points[oct("Oct 24")]).toMatchObject({ partial: true });
    expect(vis.series[0]!.points[oct("Oct 24")]!.value).not.toBeNull();
    expect(vis.note).toContain("1 of the tile's 30 days falls before it");

    const srch = TF(late, DAYS.searchTimes);
    const at = (d: string) => srch.nights.indexOf(d);
    for (const d of ["Oct 22", "Oct 23", "Oct 24"]) {
      expect(srch.series[0]!.points[at(d)]).toMatchObject({ value: null, lag: true });
    }
    expect(srch.series[0]!.points[at("Oct 25")]!.note).toBe(
      "no traffic reading since the night of Oct 24",
    );
    expect(srch.note).toContain("2 of the tile's 28 days");
  });

  it("a short axis: with 17 nights the visits note names the 13 window days before it", () => {
    const short = trendsFromDaily(
      run(N, 17, (_, i) => (i === 0 ? { traffic: traffic(trafficBlock(N)) } : {})),
      NOW,
    );
    expect(short.status).toBe("The 17 nights from Oct 10 to Oct 26");
    expect(TF(short, DAYS.visits).note).toContain("13 of the tile's 30 days");
  });

  it("each traffic note in full (PR 7b review round 1, B and tests major 2): the standard fixture, a short axis, a late reading, a series older than the axis", () => {
    const notes = (x: ReturnType<typeof trendsFromDaily>) =>
      [DAYS.visits, DAYS.searchTimes, DAYS.clicks].map((i) => TF(x, i).note);
    // (a) the standard fixture: the axis shows the whole window, so the columns add up.
    expect(notes(v)).toEqual([
      "Each column is that day's engaged visits across 16 sites; the 30 columns add up to the tile's 1,674. The night of Oct 26 is still being counted, so its column is drawn in outline.",
      "Each column is that day's times shown in Google across 16 sites; the 28 columns add up to the tile's 12,521. Google's data lags about 3 days: the hatched days have none yet.",
      "Each column is that day's clicks through from Google across 16 sites; the 28 columns add up to the tile's 623. Google's data lags about 3 days: the hatched days have none yet.",
    ]);
    // (b) a 17-night axis from Oct 10: 13 visits days and 14 search days fall before it.
    const short = trendsFromDaily(
      run(N, 17, (_, i) => (i === 0 ? { traffic: traffic(trafficBlock(N)) } : {})),
      NOW,
    );
    expect(notes(short)).toEqual([
      "Each column is that day's engaged visits across 16 sites. The chart starts on Oct 10, so 13 of the tile's 30 days fall before it, and the columns add up to less than the tile's 1,674. The night of Oct 26 is still being counted, so its column is drawn in outline.",
      "Each column is that day's times shown in Google across 16 sites. The chart starts on Oct 10, so 14 of the tile's 28 days fall before it, and the columns add up to less than the tile's 12,521. Google's data lags about 3 days: the hatched days have none yet.",
      "Each column is that day's clicks through from Google across 16 sites. The chart starts on Oct 10, so 14 of the tile's 28 days fall before it, and the columns add up to less than the tile's 623. Google's data lags about 3 days: the hatched days have none yet.",
    ]);
    // (c) one night late: the newest reading is Oct 24, so the axis starts Sep 26 with the
    // window's Sep 25 (visits) and Sep 24 and 25 (search) before it.
    const late = trendsFromDaily(
      run(N, 32, (d, i) =>
        d === "2026-10-24"
          ? { traffic: traffic(trafficBlock("2026-10-24")) }
          : i < 2
            ? {
                traffic: traffic({
                  visits: { value: null, reason: "traffic: timeout" },
                  search: { value: null, reason: "traffic: timeout" },
                  sites: [],
                }),
              }
            : {},
      ),
      NOW,
    );
    expect(notes(late)).toEqual([
      "Each column is that day's engaged visits across 16 sites. The chart starts on Sep 26, so 1 of the tile's 30 days falls before it, and the columns add up to less than the tile's 1,674. The night of Oct 24 is still being counted, so its column is drawn in outline.",
      "Each column is that day's times shown in Google across 16 sites. The chart starts on Sep 26, so 2 of the tile's 28 days fall before it, and the columns add up to less than the tile's 12,521. Google's data lags about 3 days: the hatched days have none yet.",
      "Each column is that day's clicks through from Google across 16 sites. The chart starts on Sep 26, so 2 of the tile's 28 days fall before it, and the columns add up to less than the tile's 623. Google's data lags about 3 days: the hatched days have none yet.",
    ]);
    // (d) the only series is on Sep 20, older than the axis: every window day is before it.
    const older = trendsFromDaily(
      run(N, 40, (d) => (d === "2026-09-20" ? { traffic: traffic(trafficBlock(d)) } : {})),
      NOW,
    );
    // No lag day is on this axis (the series' night is older than it), so no hatch is drawn and
    // the search notes say nothing of one (PR 7b review round 2, correctness minor 2).
    expect(notes(older)).toEqual([
      "Each column is that day's engaged visits across 16 sites. All 30 of the tile's days fall before this chart starts on Sep 26, so no column is drawn.",
      "Each column is that day's times shown in Google across 16 sites. All 28 of the tile's days fall before this chart starts on Sep 26, so no column is drawn.",
      "Each column is that day's clicks through from Google across 16 sites. All 28 of the tile's days fall before this chart starts on Sep 26, so no column is drawn.",
    ]);
  });

  /** The traffic block for `night` with some days' counts set, each reading's total re-summed
   *  over its own window, so a note's "tile's total" is what the window's days really add to. */
  const edited = (
    night: string,
    visits: Record<string, number>,
    search: Record<string, { clicks: number; impressions: number }>,
  ) => {
    type Day = { date: string; [k: string]: unknown };
    const block = trafficBlock(night) as Record<string, { value: Record<string, unknown> }>;
    const inWin = (date: string, w: { startDate: string; endDate: string }) =>
      date >= w.startDate && date <= w.endDate;
    const vv = block.visits!.value as {
      current: number;
      currentWindow: { startDate: string; endDate: string };
      daily: Day[];
    };
    vv.daily = vv.daily.map((d) =>
      visits[d.date] === undefined ? d : { ...d, visits: visits[d.date] },
    );
    vv.current = vv.daily
      .filter((d) => inWin(d.date, vv.currentWindow))
      .reduce((a, d) => a + (d.visits as number), 0);
    const sv = block.search!.value as {
      clicks: number;
      impressions: number;
      window: { startDate: string; endDate: string };
      daily: Day[];
    };
    sv.daily = sv.daily.map((d) =>
      search[d.date] === undefined ? d : { ...d, ...search[d.date] },
    );
    const inSearch = sv.daily.filter((d) => inWin(d.date, sv.window));
    sv.clicks = inSearch.reduce((a, d) => a + (d.clicks as number), 0);
    sv.impressions = inSearch.reduce((a, d) => a + (d.impressions as number), 0);
    return block;
  };

  it("the dropped days count none: the note says so, and the columns still add up (review round 2, correctness major)", () => {
    // The Oct 24 night's window is Sep 25 to Oct 24; the axis starts Sep 26, so Sep 25 is dropped
    // and counted 0. The drawn columns sum to the whole tile, so "less than" would be false.
    const block = edited("2026-10-24", { "2026-09-25": 0 }, {});
    const late = trendsFromDaily(
      run(N, 32, (d) => (d === "2026-10-24" ? { traffic: traffic(block) } : {})),
      NOW,
    );
    expect(TF(late, DAYS.visits).note).toBe(
      "Each column is that day's engaged visits across 16 sites. The chart starts on Sep 26, so 1 of the tile's 30 days falls before it; that day counted none, so the columns still add up to the tile's 1,618. The night of Oct 24 is still being counted, so its column is drawn in outline.",
    );
  });

  it("the same for search, per chart: clicks whose dropped days are 0 say counted none; impressions whose dropped days are not 0 say less than (review round 2, correctness major)", () => {
    // The Oct 24 night's search window is Sep 24 to Oct 21; Sep 24 and 25 fall before the axis.
    // Their clicks are 0 and their impressions are not.
    const block = edited(
      "2026-10-24",
      {},
      {
        "2026-09-24": { clicks: 0, impressions: 300 },
        "2026-09-25": { clicks: 0, impressions: 300 },
      },
    );
    const late = trendsFromDaily(
      run(N, 32, (d) => (d === "2026-10-24" ? { traffic: traffic(block) } : {})),
      NOW,
    );
    expect(TF(late, DAYS.clicks).note).toBe(
      "Each column is that day's clicks through from Google across 16 sites. The chart starts on Sep 26, so 2 of the tile's 28 days fall before it; they counted none, so the columns still add up to the tile's 577. Google's data lags about 3 days: the hatched days have none yet.",
    );
    expect(TF(late, DAYS.searchTimes).note).toBe(
      "Each column is that day's times shown in Google across 16 sites. The chart starts on Sep 26, so 2 of the tile's 28 days fall before it, and the columns add up to less than the tile's 12,225. Google's data lags about 3 days: the hatched days have none yet.",
    );
  });

  it("the dropped days are summed whole: one counted something, the other none (PR 7b review round 3, tests R3T-1)", () => {
    // Sep 24 and 25 fall before the axis. Sep 24 has impressions and no clicks, Sep 25 the
    // reverse, so a sum that skipped either day would say "still add up" for one chart.
    const block = edited(
      "2026-10-24",
      {},
      {
        "2026-09-24": { clicks: 0, impressions: 300 },
        "2026-09-25": { clicks: 5, impressions: 0 },
      },
    );
    const late = trendsFromDaily(
      run(N, 32, (d) => (d === "2026-10-24" ? { traffic: traffic(block) } : {})),
      NOW,
    );
    expect(TF(late, DAYS.clicks).note).toContain(
      "2 of the tile's 28 days fall before it, and the columns add up to less than the tile's",
    );
    expect(TF(late, DAYS.searchTimes).note).toContain(
      "2 of the tile's 28 days fall before it, and the columns add up to less than the tile's",
    );
  });

  it("an unmeasured reason, visits half (PR 7b review round 1, minor 3): every visits day says Google Analytics", () => {
    const rows = run(N, 32, (_, i) =>
      i === 0
        ? {
            traffic: traffic({
              visits: { value: null, reason: "GA not configured" },
              search: { value: null, reason: "not in this row" },
              sites: [],
            }),
          }
        : {},
    );
    const c = TF(trendsFromDaily(rows, NOW), DAYS.visits);
    expect(c.series[0]!.points.map((p) => p.note)).toEqual(
      Array(TREND_AXIS_NIGHTS).fill("not readable: Google Analytics is not set up for the nightly"),
    );
  });

  it("an unmeasured reason, search half (minor 3): every search day names Google, not Analytics", () => {
    const rows = run(N, 32, (_, i) =>
      i === 0
        ? {
            traffic: traffic({
              visits: { value: null, reason: "not in this row" },
              search: { value: null, reason: "GA not configured" },
              sites: [],
            }),
          }
        : {},
    );
    const late = trendsFromDaily(rows, NOW);
    for (const i of [DAYS.searchTimes, DAYS.clicks]) {
      const c = TF(late, i);
      expect(c.series[0]!.points.map((p) => p.note)).toEqual(
        Array(TREND_AXIS_NIGHTS).fill("not readable: Google is not set up for the nightly"),
      );
      expect(c.note + c.summary).not.toContain("Analytics");
    }
  });

  it("each traffic summary names its partial day and its lag days (PR 7b review round 1, E)", () => {
    expect(TF(v, DAYS.visits).summary.endsWith("Oct 26 is still being counted.")).toBe(true);
    for (const i of [DAYS.searchTimes, DAYS.clicks]) {
      expect(
        TF(v, i).summary.endsWith("Google has no data yet for 3 days, Oct 24 to Oct 26."),
      ).toBe(true);
    }
  });

  it("each traffic summary in full (PR 7b review round 2, T2 and T3): the four round-1 fixtures, and one whose lag band has one day on the axis", () => {
    const summaries = (x: ReturnType<typeof trendsFromDaily>) =>
      [DAYS.visits, DAYS.searchTimes, DAYS.clicks].map((i) => TF(x, i).summary);
    // (a) the standard fixture.
    expect(summaries(v)).toEqual([
      "Engaged visits: from 55 to 56 over the 30 days drawn, 55 on Oct 26. 1 day has no point; the table gives why. Oct 26 is still being counted.",
      "Times shown in Google: from 447 to 448 over the 28 days drawn, 447 on Oct 23. 3 days have no point; the table gives why. Google has no data yet for 3 days, Oct 24 to Oct 26.",
      "Clicks through from Google: from 22 to 23 over the 28 days drawn, 22 on Oct 23. 3 days have no point; the table gives why. Google has no data yet for 3 days, Oct 24 to Oct 26.",
    ]);
    // (b) a 17-night axis from Oct 10.
    expect(
      summaries(
        trendsFromDaily(
          run(N, 17, (_, i) => (i === 0 ? { traffic: traffic(trafficBlock(N)) } : {})),
          NOW,
        ),
      ),
    ).toEqual([
      "Engaged visits: from 55 to 56 over the 17 days drawn, 55 on Oct 26. Every day is drawn. Oct 26 is still being counted.",
      "Times shown in Google: 447 on each of the 14 days drawn, 447 on Oct 23. 3 days have no point; the table gives why. Google has no data yet for 3 days, Oct 24 to Oct 26.",
      "Clicks through from Google: 22 on each of the 14 days drawn, 22 on Oct 23. 3 days have no point; the table gives why. Google has no data yet for 3 days, Oct 24 to Oct 26.",
    ]);
    // (c) the series one night late, on Oct 24.
    expect(
      summaries(
        trendsFromDaily(
          run(N, 32, (d) =>
            d === "2026-10-24" ? { traffic: traffic(trafficBlock("2026-10-24")) } : {},
          ),
          NOW,
        ),
      ),
    ).toEqual([
      "Engaged visits: from 55 to 56 over the 29 days drawn, 55 on Oct 24. 2 days have no point; the table gives why. Oct 24 is still being counted.",
      "Times shown in Google: from 447 to 448 over the 26 days drawn, 447 on Oct 21. 5 days have no point; the table gives why. Google has no data yet for 3 days, Oct 22 to Oct 24.",
      "Clicks through from Google: from 22 to 23 over the 26 days drawn, 22 on Oct 21. 5 days have no point; the table gives why. Google has no data yet for 3 days, Oct 22 to Oct 24.",
    ]);
    // (d) the only series is on Sep 20, older than the axis.
    expect(
      summaries(
        trendsFromDaily(
          run(N, 40, (d) => (d === "2026-09-20" ? { traffic: traffic(trafficBlock(d)) } : {})),
          NOW,
        ),
      ),
    ).toEqual([
      "Engaged visits: no day drawn. 31 days have no point; the table gives why.",
      "Times shown in Google: no day drawn. 31 days have no point; the table gives why.",
      "Clicks through from Google: no day drawn. 31 days have no point; the table gives why.",
    ]);
    // (e) the series on Sep 26, the axis's first day: its search lag band is that one day, so
    // the summary's one-day form is "Google has no data yet for Sep 26." The visits line keeps
    // "55 on each of the 1 day drawn", the wording the round-2 review filed as not folded.
    expect(
      summaries(
        trendsFromDaily(
          run(N, 32, (d) => (d === "2026-09-26" ? { traffic: traffic(trafficBlock(d)) } : {})),
          NOW,
        ),
      ),
    ).toEqual([
      "Engaged visits: 55 on each of the 1 day drawn, 55 on Sep 26. 30 days have no point; the table gives why. Sep 26 is still being counted.",
      "Times shown in Google: no day drawn. 31 days have no point; the table gives why. Google has no data yet for Sep 26.",
      "Clicks through from Google: no day drawn. 31 days have no point; the table gives why. Google has no data yet for Sep 26.",
    ]);
  });

  it("the clicks chart counts days, not nights, and a partial point keeps its value in its slot title (minor 4, minor 5)", () => {
    const clicks = TF(v, DAYS.clicks);
    expect(clicks.slotHeading).toBe("Day");
    expect(clicks.summary).toContain("3 days have no point");
    expect(clicks.summary).not.toContain("nights");
    expect(trendGeometry(TF(v, DAYS.visits)).slots.at(-1)!.title).toBe(
      "Oct 26: Engaged visits: 55, still being counted",
    );
  });

  it("no traffic block anywhere: every day is blank with its words, and the summary says no day drawn", () => {
    const none = TF(trendsFromDaily(run(N, 32), NOW), DAYS.visits);
    expect(none.series[0]!.points.every((q) => q.value === null)).toBe(true);
    expect(none.series[0]!.points.every((q) => q.note === "not yet collected")).toBe(true);
    expect(none.summary).toContain("Engaged visits: no day drawn");
  });

  it("the axis for clicks is its own: roundUp of its largest day, not impressions'", () => {
    // Clicks: 623 over 28 days, the largest day 23 (roundUp: 40); impressions' largest 448 (600).
    expect(TF(v, DAYS.clicks).high).toBe(40);
    expect(TF(v, DAYS.searchTimes).high).toBe(600);
  });

  it("geometry: visits has 30 columns, the last partial; each search chart has one 3-day lag band and no column there", () => {
    const gv = trendGeometry(TF(v, DAYS.visits));
    expect(gv.bars).toHaveLength(30);
    expect(gv.bars.at(-1)).toMatchObject({ partial: true });
    expect(gv.lag).toHaveLength(0);
    for (const i of [DAYS.searchTimes, DAYS.clicks]) {
      const g = trendGeometry(TF(v, i));
      expect(g.lag).toHaveLength(1);
      expect(g.bars).toHaveLength(28);
      expect(g.bars.every((b) => b.x < g.lag[0]!.x)).toBe(true);
      // The band starts at the 29th day's left edge and runs to the plot's right edge: three
      // days wide, exactly (PR 7b review round 1, tests major 1). Rounded, as the SVG gets it.
      expect(g.lag[0]).toEqual({ x: 286.6, width: 27.4 });
      expect(g.lag[0]!.x).toBe(g.slots[28]!.left);
    }
  });

  it("How we count: the reworded Engaged visits and Times shown texts are pinned, and no text says lighter (PR 7b review round 2, T4)", () => {
    const how = (term: string) => HOW_WE_COUNT.find((h) => h.term === term)!.text;
    expect(how("Engaged visits")).toContain("so its column is drawn in outline");
    expect(how("Times shown in Google")).toContain(
      "the days Google has no data for yet are hatched",
    );
    // Nothing describes the partial column as lighter, in the definitions or in any chart's
    // note or summary: the round-1 wording that a test did not hold.
    const charts = trendsFromDaily(withBlock(trafficBlock(N)), NOW).charts!;
    const said = [
      ...HOW_WE_COUNT.map((h) => h.text),
      ...charts.flatMap((c) => [c.note, c.summary]),
    ];
    expect(said.filter((t) => t.includes("lighter"))).toEqual([]);
  });

  it("How we count: the Trends text says the search window ends three days before the night", () => {
    const trends = HOW_WE_COUNT.find((h) => h.term === "Trends")!.text;
    expect(trends).toContain(
      "Google's data lags about three days, so each search chart's 28 days end three days before the night, and the days Google has no data for yet are hatched.",
    );
    expect(trends).toContain("the last 31 calendar nights");
    const terms = HOW_WE_COUNT.map((h) => h.term);
    expect(terms).toContain("Engaged visits");
    expect(terms).toContain("Times shown in Google");
  });
});

describe("P1-87 PR 7b item 1: y-axis ticks fit in four characters", () => {
  it("tickLabel shortens thousands, millions and billions, and leaves smaller counts whole", () => {
    expect(tickLabel(0)).toBe("0");
    expect(tickLabel(6)).toBe("6");
    expect(tickLabel(600)).toBe("600");
    expect(tickLabel(1000)).toBe("1k");
    expect(tickLabel(6000)).toBe("6k");
    expect(tickLabel(10000)).toBe("10k");
    expect(tickLabel(300000)).toBe("300k");
    expect(tickLabel(600000)).toBe("600k");
    expect(tickLabel(1000000)).toBe("1M");
    expect(tickLabel(2000000)).toBe("2M");
    expect(tickLabel(4000000000)).toBe("4B");
  });
});
