import { describe, it, expect } from "vitest";
import type { OverviewNight } from "../../../src/fleet-daily/read.js";
import {
  TREND_NIGHTS,
  UNREADABLE,
  WINDOW_NIGHTS,
  trendGeometry,
  trendsFromDaily,
  MIN_COLUMN,
  type TrendChart,
} from "../../src/lib/overview/view.js";
import { overviewFromSnapshot } from "../../src/lib/overview/view.js";
import { NOW, night, snapshot } from "./fixtures.js";

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

  it("with 14 nights, draws the four charts", () => {
    const v = trendsFromDaily(run("2026-10-26", TREND_NIGHTS), NOW);
    expect(v.charts?.map((c) => c.title)).toEqual([
      "Broken and Attention sites, each night",
      "Site checks run, each night",
      "Submissions the client was emailed about, each night",
      "Vulnerabilities: sites with an alert open, and sites cleared",
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
    const checks = chart(v, /^Site checks/);
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

  it("every chart has no value that night, and says it could not be read", () => {
    for (const c of v.charts!)
      for (let s = 0; s < c.series.length; s++) {
        expect(on(c, s).value, `${c.title} ${s}`).toBeNull();
        expect(on(c, s).note, `${c.title} ${s}`).toBe("could not be read that night");
      }
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
    const c = chart(trendsFromDaily(nights2, NOW), /^Site checks/);
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
    const checks = chart(v, /^Site checks/);
    expect(checks.note).toBe(
      "Each column adds up, for each kind of check, the sites it checked that night: five checks on seven sites count 35.",
    );
    expect(chart(v, /^Vulnerabilities/).note).toBe(
      "The nightly does not count new vulnerabilities found, so the line shows sites whose vulnerability alert was on the Triage page that night. That leaves out one waiting for an automatic update and takes in sites still launching, so it need not match Open now. The columns are sites cleared that night: from one or more critical or high vulnerabilities to none.",
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
    expect(values(chart(v, /^Site checks/)).every((x) => x === 49)).toBe(true);
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
  it("spans at most the last 30 nights", () => {
    const v = trendsFromDaily(run("2026-10-26", 31), NOW);
    expect(v.charts![0]!.series[0]!.points).toHaveLength(WINDOW_NIGHTS);
    expect(v.charts![0]!.nights.at(-1)).toBe("Oct 26");
    expect(v.charts![0]!.nights[0]).toBe("Sep 27");
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
      "The 18 nights from Oct 9 to Oct 26, 4 with no count; none counted since Oct 22",
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
    expect(trendGeometry(chart(v, /^Site checks/)).slots.at(-1)!.title).toBe(
      "Oct 26: Site checks: 5",
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
    // Fourteen rows ending Oct 3: only Sep 27 to Oct 3 fall in the 30 nights to Oct 26.
    const v = trendsFromDaily(run("2026-10-03", 14), NOW);
    expect(v).toEqual({
      status:
        "Collecting: 7 of 14 nights in the last 30; the charts start once all 14 are in; none counted since Oct 3",
      charts: null,
    });
  });

  it("the collecting line says when the nightly stopped (round 3, C1)", () => {
    // Twenty rows to Oct 3: the night expected by now is Oct 26.
    expect(trendsFromDaily(run("2026-10-03", 20), NOW).status).toBe(
      "Collecting: 7 of 14 nights in the last 30; the charts start once all 14 are in; none counted since Oct 3",
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
