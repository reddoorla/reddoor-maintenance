import { describe, it, expect } from "vitest";
import { renderFleetTableHtml } from "../../src/dashboard/fleet-table-render.js";
import { buildFleetTableModel } from "../../src/dashboard/fleet-table.js";
import type { FleetTableQuery } from "../../src/dashboard/fleet-table.js";
import { makeWebsiteRow } from "../_helpers/website-row.js";

const DEFAULT_QUERY: FleetTableQuery = { sort: "name", dir: "asc", status: "", q: "" };

function sites() {
  return [
    makeWebsiteRow({
      id: "r1",
      name: "Acme Co",
      url: "https://acme.example.com",
      status: "maintenance",
      pScore: 87,
      rScore: 95,
      bpScore: 90,
      seoScore: 100,
      nextMaintenanceAt: "2026-09-01",
      nextTestingAt: "2026-10-01",
      lastLighthouseAuditAt: "2026-08-20T18:00:00Z",
    }),
    makeWebsiteRow({ id: "r2", name: "Beachfront", status: "legacy" }),
    makeWebsiteRow({ id: "r3", name: "Untracked", status: null }),
  ];
}

function render(query: Partial<FleetTableQuery> = {}, rows = sites()) {
  return renderFleetTableHtml(buildFleetTableModel(rows, { ...DEFAULT_QUERY, ...query }));
}

describe("renderFleetTableHtml — document + rows", () => {
  it("renders a full document with one row per site and a back link home", () => {
    const html = render();
    expect(html).toContain("<!doctype html>");
    expect(html).toContain('href="/"'); // ← Fleet home, same as the submissions page
    expect((html.match(/<tr class="fleet-row">/g) ?? []).length).toBe(3);
    expect(html).toContain("3 of 3 sites");
  });
  it("links each site name to its detail page and its URL out", () => {
    const html = render();
    expect(html).toContain('href="/s/acme-co"');
    expect(html).toContain('href="https://acme.example.com"');
  });
  it("renders the RAW status value and a dash for null status", () => {
    const html = render();
    expect(html).toContain("legacy"); // raw value, no remap
    expect(html).toContain("maintenance");
    expect(html).toContain("—"); // null status/scores degrade to a dash
  });
  it("renders scores and dates, with dashes for nulls", () => {
    const html = render();
    expect(html).toContain(">87<");
    expect(html).toContain(">100<");
    expect(html).toContain("2026-09-01");
    expect(html).toContain("2026-08-20"); // date part of the audit timestamp
  });
  it("renders an empty state when no site matches", () => {
    const html = render({ q: "zzz-no-match" });
    expect(html.toLowerCase()).toContain("no sites match");
    expect(html).not.toContain('<tr class="fleet-row">');
  });
  it("contains no inline script at all (server-rendered links only)", () => {
    // House trap: one raw \n in a served template literal killed a whole inline
    // <script> while the page looked fine. This page ships zero inline JS.
    expect(render()).not.toContain("<script");
  });
});

describe("renderFleetTableHtml — sort headers", () => {
  it("toggles the active column to the opposite direction and marks it", () => {
    const html = render({ sort: "perf", dir: "asc" });
    expect(html).toMatch(/href="\/fleet\?[^"]*sort=perf[^"]*dir=desc/);
    expect(html).toContain("▲"); // active asc indicator
  });
  it("links inactive columns ascending", () => {
    const html = render({ sort: "perf", dir: "desc" });
    expect(html).toMatch(/href="\/fleet\?[^"]*sort=name[^"]*dir=asc/);
    expect(html).toContain("▼"); // active desc indicator
  });
  it("preserves the active filters in every sort link", () => {
    const html = render({ status: "maintenance", q: "acme" });
    const sortLinks = html.match(/href="\/fleet\?[^"]*sort=[^"]*"/g) ?? [];
    expect(sortLinks.length).toBeGreaterThan(0);
    for (const link of sortLinks) {
      expect(link).toContain("status=maintenance");
      expect(link).toContain("q=acme");
    }
  });
});

describe("renderFleetTableHtml — filter form", () => {
  it("renders a GET form to /fleet with the fleet's distinct statuses as options", () => {
    const html = render();
    expect(html).toContain('method="get"');
    expect(html).toContain('action="/fleet"');
    expect(html).toContain('<option value="legacy"');
    expect(html).toContain('<option value="maintenance"');
  });
  it("marks the active status selected and repopulates q", () => {
    const html = render({ status: "legacy", q: "beach" });
    expect(html).toMatch(/<option value="legacy" selected/);
    expect(html).toContain('value="beach"');
  });
});

describe("renderFleetTableHtml — escaping", () => {
  it("escapes a hostile site name, status, and URL wherever they land", () => {
    const hostile = [
      makeWebsiteRow({
        id: "r1",
        name: 'Evil <script>alert(1)</script> "Site"',
        url: 'javascript:alert(2)//"',
        status: "<img src=x onerror=alert(3)>" as never,
      }),
    ];
    const html = renderFleetTableHtml(buildFleetTableModel(hostile, DEFAULT_QUERY));
    expect(html).not.toContain("<script>alert(1)");
    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain('href="javascript:'); // safeUrl collapses to "#"
  });
  it("escapes a hostile q filter echoed into the form", () => {
    const html = render({ q: '"><script>alert(4)</script>' });
    expect(html).not.toContain("<script>alert(4)");
  });
});
