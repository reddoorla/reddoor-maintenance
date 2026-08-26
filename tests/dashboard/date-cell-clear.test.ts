import { describe, it, expect } from "vitest";
import { renderSiteDashboardHtml } from "../../src/dashboard/render.js";
import { makeWebsiteRow } from "../_helpers/website-row.js";

/**
 * A latent, destructive path: `<input type="date">` accepts only `YYYY-MM-DD`.
 * Handed an ISO datetime it sanitizes `.value` to `""` while `.defaultValue` keeps
 * the raw string — so the blur guard's `value !== defaultValue` fires with NO user
 * edit, and the server accepts `""` as a deliberate clear. `maintenanceDay` and
 * `testingDay` feed the code-owned next-due schedule, so an untouched tab-through
 * would silently reschedule the site.
 *
 * Dormant while those Airtable columns are date-only; it goes live the instant
 * anyone ticks "include time" on the field. Two independent defences are asserted
 * here, because either alone would leave the class open:
 *   1. the renderer never emits a value the control cannot hold;
 *   2. the script requires a real edit gesture before any blur can save.
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

describe("a blur cannot save without a real edit gesture", () => {
  const script = /<script>([\s\S]*?)<\/script>/.exec(render())![1]!;

  it("arms the save on an input event and requires it on blur", () => {
    // `value !== defaultValue` alone is not evidence of an edit — the browser
    // rewrites `.value` by itself whenever a control is handed something it cannot
    // represent. Only a keystroke or picker choice fires `input`.
    expect(script).toContain('i.addEventListener("input", () => { i.dataset.edited = "1"; })');
    expect(script).toContain('if (i.dataset.edited === "1" && i.value !== i.defaultValue)');
  });

  it("still requires the value to have actually changed", () => {
    // Belt and braces: typing and then undoing the edit must not save.
    expect(script).toMatch(/i\.dataset\.edited === "1" && i\.value !== i\.defaultValue/);
  });
});
