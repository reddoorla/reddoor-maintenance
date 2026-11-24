import { describe, it, expect } from "vitest";
import Page from "../../src/routes/s/[slug]/+page.svelte";
import { buildSiteView, leadsView } from "../../src/lib/site/view.js";
import { leadPeriods } from "../../../src/reports/lead-periods.js";
import { renderPage } from "../_helpers/parity.js";
import { input } from "./fixtures.js";

/** P1-127: the site page's leads panel, from the same periods the report uses. */
const NOW = new Date("2026-11-24T20:00:00Z");

describe("leadsView", () => {
  it("states the last 30 days, the 30 before with the change, six months and all time", () => {
    const p = leadPeriods(
      [
        ...Array.from({ length: 3 }, () => "2026-11-10T19:00:00Z"),
        ...Array.from({ length: 2 }, () => "2026-10-10T19:00:00Z"),
        "2025-01-01T19:00:00Z",
      ],
      NOW,
    );
    expect(leadsView(p)).toEqual({
      last30: 3,
      prior30: 2,
      change: "up 50%",
      window: "Oct 25 – Nov 23",
      months: [
        { label: "May '26", count: 0 },
        { label: "Jun '26", count: 0 },
        { label: "Jul '26", count: 0 },
        { label: "Aug '26", count: 0 },
        { label: "Sep '26", count: 0 },
        { label: "Oct '26", count: 2 },
      ],
      allTime: 6,
    });
  });

  it("names a fall, no change, a first month and an empty pair", () => {
    const v = (cur: number, prev: number) =>
      leadsView({ ...leadPeriods([], NOW), last30: cur, prior30: prev }).change;
    expect(v(1, 4)).toBe("down 75%");
    expect(v(4, 4)).toBe("no change");
    expect(v(2, 0)).toBe("new");
    expect(v(0, 0)).toBe("");
  });
});

describe("/s/:slug leads panel", () => {
  const i = input({ now: NOW });
  const view = buildSiteView(i.site, i.reports, i.submissions, i.spam, i.now, i.alarm);

  it("renders the panel when leads were read", () => {
    const leads = leadsView(leadPeriods(["2026-11-10T19:00:00Z"], NOW));
    const html = renderPage(Page, { data: { view, leads } });
    expect(html).toContain("Leads");
    expect(html).toContain("Last 30 days");
    expect(html).toContain("Oct 25 – Nov 23");
    expect(html).toContain("All time");
    expect(html).toMatch(/Oct (&#39;|')26/);
  });

  it("renders no panel when the read failed", () => {
    const html = renderPage(Page, { data: { view, leads: null } });
    expect(html).not.toContain("Last 30 days");
  });
});
