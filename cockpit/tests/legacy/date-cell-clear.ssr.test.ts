import { describe, it, expect } from "vitest";
import { renderSiteDashboardHtml } from "./render.js";
import { makeWebsiteRow } from "../../../tests/_helpers/website-row.js";

/**
 * A latent, destructive path: `<input type="date">` accepts only `YYYY-MM-DD`.
 * Handed an ISO datetime it sanitizes `.value` to `""` while `.defaultValue` keeps
 * the raw string — so the blur guard's `value !== defaultValue` fires with NO user
 * edit, and the server accepts `""` as a deliberate clear. `maintenanceDay` and
 * `testingDay` feed the code-owned next-due schedule, so an untouched tab-through
 * would silently reschedule the site.
 *
 * Dormant while those columns are date-only; it goes live the instant one holds
 * a datetime. Two independent defences are asserted
 * here, because either alone would leave the class open:
 *   1. the renderer never emits a value the control cannot hold (this file);
 *   2. the editor requires a real edit gesture before any blur can save (the
 *      DOM tests, cockpit/tests/site/site.dom.test.ts, since the port, #582).
 */

function render(over: Parameters<typeof makeWebsiteRow>[0] = {}): string {
  return renderSiteDashboardHtml(
    makeWebsiteRow({ name: "Acme", ...over }),
    [],
    [],
    null,
    new Date("2026-08-26T12:00:00Z"),
    null,
  );
}

function dateValue(html: string, field: string): string {
  const re = new RegExp(`<input type="date"[^>]*data-detail-field="${field}"[^>]*>`);
  const tag = re.exec(html)?.[0] ?? "";
  return /value="([^"]*)"/.exec(tag)?.[1] ?? "";
}

describe("date cells never render a value the control cannot hold", () => {
  it("truncates an ISO datetime to the date part", () => {
    const html = render({
      maintenanceDay: "2026-08-01T00:00:00.000Z",
      testingDay: "2026-07-15T09:30:00.000Z",
    });
    expect(dateValue(html, "maintenanceDay")).toBe("2026-08-01");
    expect(dateValue(html, "testingDay")).toBe("2026-07-15");
  });

  it("leaves an already date-only value exactly as it is", () => {
    // The positive control: truncation must not be doing something to every value.
    const html = render({ maintenanceDay: "2026-08-01" });
    expect(dateValue(html, "maintenanceDay")).toBe("2026-08-01");
  });

  it("renders empty for a null cell, without inventing a date", () => {
    const html = render({ maintenanceDay: null });
    expect(dateValue(html, "maintenanceDay")).toBe("");
  });
});

// "a blur cannot save without a real edit gesture": the site-details editor's
// save rule (an input event, then a changed value on blur) is the DOM tests' now
// (cockpit/tests/site/site.dom.test.ts, the site-details editor).
