import { describe, it, expect } from "vitest";
import { renderFleetTableHtml } from "../../src/dashboard/fleet-table-render.js";
import { buildFleetTableModel, NO_STATUS_FILTER } from "../../src/dashboard/fleet-table.js";
import type { FleetTableQuery, FleetTableRow } from "../../src/dashboard/fleet-table.js";
import type { WebsiteRow } from "../../src/reports/airtable/websites.js";
import { makeWebsiteRow } from "../_helpers/website-row.js";

const DEFAULT_QUERY: FleetTableQuery = { sort: "name", dir: "asc", status: "", q: "" };

/** The filter <form> only — so "the page contains X somewhere" can never stand
 *  in for "the form offers X". */
function formOf(html: string): string {
  return /<form class="filters"[\s\S]*?<\/form>/.exec(html)?.[0] ?? "";
}

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
  it("renders the RAW status value IN ITS CELL, and a dash for null status", () => {
    const html = render();
    // `toContain("legacy")` is satisfied by the filter <option> alone — the
    // whole status COLUMN could render blank and still pass. Pin the cell.
    expect(html).toMatch(/<td>legacy<\/td>/); // raw value, no remap
    expect(html).toMatch(/<td>maintenance<\/td>/);
    // …and the null-status row's own status cell, not just a dash somewhere.
    expect(html).toMatch(
      /<td><a href="\/s\/untracked">Untracked<\/a><\/td>\s*<td>[\s\S]*?<\/td>\s*<td>—<\/td>/,
    );
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
  it("contains no inline JS at all — no <script>, no handler attribute, no javascript:", () => {
    // House trap: one raw \n in a served template literal killed a whole inline
    // <script> while the page looked fine. This page ships zero inline JS.
    // Banning the STRING "<script" is not the same as banning inline JS: an
    // onclick="…" on a sort header is inline JS and contains no <script at all.
    const html = render();
    expect(html).not.toContain("<script");
    expect(html).not.toMatch(/\son[a-z]+\s*=/i); // onclick=, onchange=, onload=…
    expect(html).not.toContain("javascript:");
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
  it("preserves the no-status sentinel in every sort link", () => {
    const html = render({ status: NO_STATUS_FILTER });
    const sortLinks = html.match(/href="\/fleet\?[^"]*sort=[^"]*"/g) ?? [];
    expect(sortLinks.length).toBeGreaterThan(0);
    for (const link of sortLinks) expect(link).toContain(`status=${NO_STATUS_FILTER}`);
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
  it("carries the active sort and direction through the form, so Apply cannot reset the ranking", () => {
    // Preservation was one-way: sortHref kept the filters, but the form dropped
    // the sort — so an operator on /fleet?sort=perf&dir=asc who typed a search
    // term came back name-sorted with nothing on the page saying so.
    const form = formOf(render({ sort: "perf", dir: "desc", q: "acme" }));
    expect(form).toContain('<input type="hidden" name="sort" value="perf"');
    expect(form).toContain('<input type="hidden" name="dir" value="desc"');
  });
  it("carries the DEFAULT sort through the form too", () => {
    const form = formOf(render());
    expect(form).toContain('name="sort" value="name"');
    expect(form).toContain('name="dir" value="asc"');
  });
  it("names an UNRECOGNIZED ?status= as the filter in force rather than showing 'All statuses'", () => {
    // A stale bookmark (or the pending status-vocabulary rename) leaves the
    // select on its first option — "All statuses" — above zero rows, which
    // reads as "the fleet is empty" or "search is broken".
    const html = render({ status: "Maintenance" }); // capital M; stored value is lowercase
    expect(html).toContain("0 of 3 sites");
    expect(formOf(html)).toMatch(/<option value="Maintenance" selected/);
  });
  it("escapes an unrecognized status before echoing it into the option", () => {
    const html = render({ status: '"><script>alert(5)</script>' });
    expect(html).not.toContain("<script>alert(5)");
    expect(formOf(html)).toContain(
      '<option value="&quot;&gt;&lt;script&gt;alert(5)&lt;/script&gt;" selected',
    );
  });
  it("offers a 'no status set' option and marks it selected when it is in force", () => {
    const plain = formOf(render());
    expect(plain).toContain(`<option value="${NO_STATUS_FILTER}"`);
    const active = formOf(render({ status: NO_STATUS_FILTER }));
    expect(active).toMatch(new RegExp(`<option value="${NO_STATUS_FILTER}" selected`));
    // …and it is a real filter, not just decoration.
    expect(render({ status: NO_STATUS_FILTER })).toContain("1 of 3 sites");
  });
  it("drops the sentinel option when a stored status literally equals it — no duplicate values", () => {
    // `Status` is a closed union in TS but an unchecked cast at the DB boundary
    // (fleet-state.ts: `str(r.status) as Status | null`), so a stored value the
    // union does not name is exactly the case under test.
    const colliding = [
      makeWebsiteRow({
        id: "r1",
        name: "Acme Co",
        status: NO_STATUS_FILTER as WebsiteRow["status"],
      }),
    ];
    const form = formOf(render({}, colliding));
    const options = form.match(new RegExp(`<option value="${NO_STATUS_FILTER}"`, "g")) ?? [];
    expect(options).toHaveLength(1);
    expect(form).not.toContain("no status set");
  });
});

describe("renderFleetTableHtml — date cells", () => {
  it("shows the calendar day and keeps the full timestamp on hover", () => {
    const html = render();
    expect(html).toContain('<span title="2026-08-20T18:00:00Z">2026-08-20</span>');
  });
  it("renders a date-only value bare, with no hover span", () => {
    const html = render();
    expect(html).toContain("<td>2026-09-01</td>");
  });
  it("escapes the hover title — an attribute context of its own", () => {
    const hostile = [
      makeWebsiteRow({
        id: "r1",
        lastLighthouseAuditAt: '2026-08-20T00:00:00Z" onmouseover="alert(1)',
      }),
    ];
    const html = renderFleetTableHtml(buildFleetTableModel(hostile, DEFAULT_QUERY));
    expect(html).toContain('title="2026-08-20T00:00:00Z&quot; onmouseover=&quot;alert(1)"');
    expect(html).not.toContain('" onmouseover="alert(1)"');
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
    // Absence alone would pass over a blank cell: pin the ESCAPED form, in place.
    expect(html).toMatch(/<td>&lt;img src=x onerror=alert\(3\)&gt;<\/td>/);
    expect(html).toContain("Evil &lt;script&gt;alert(1)&lt;/script&gt; &quot;Site&quot;");
  });
  it("escapes a hostile but VALID https URL in BOTH the href and the link text", () => {
    // safeUrl gates the SCHEME only — for a well-formed https URL it returns the
    // raw string, quotes and all, and never reaches u.href. So this is the only
    // fixture shape that can exercise the <a> branch with hostile content; the
    // javascript: fixture above collapses to "#" and renders no anchor at all.
    const hostile = [
      makeWebsiteRow({
        id: "r1",
        name: "Acme Co",
        url: 'https://evil.example.com/"><script>alert(9)</script>',
      }),
    ];
    const html = renderFleetTableHtml(buildFleetTableModel(hostile, DEFAULT_QUERY));
    const escaped = "https://evil.example.com/&quot;&gt;&lt;script&gt;alert(9)&lt;/script&gt;";
    expect(html).toContain(`href="${escaped}"`); // attribute context
    expect(html).toContain(`>${escaped}</a>`); // text context
    expect(html).not.toContain('"><script');
  });
  it("escapes the slug in the site-detail href", () => {
    // siteSlug strips to [a-z0-9-], so no WebsiteRow can produce this today —
    // but the renderer's contract is with any FleetTableModel it is handed, and
    // a future slug source must not be able to break out of the attribute.
    const row: FleetTableRow = {
      slug: '" onmouseover="alert(1)',
      name: "Acme Co",
      url: "https://acme.example.com",
      status: null,
      pScore: null,
      rScore: null,
      bpScore: null,
      seoScore: null,
      nextMaintenanceAt: null,
      nextTestingAt: null,
      lastLighthouseAuditAt: null,
    };
    const html = renderFleetTableHtml({
      rows: [row],
      totalSites: 1,
      statuses: [],
      query: DEFAULT_QUERY,
    });
    expect(html).toContain('href="/s/&quot; onmouseover=&quot;alert(1)"');
    expect(html).not.toContain('href="/s/" onmouseover=');
  });
  it("escapes a hostile q filter echoed into the form", () => {
    const html = render({ q: '"><script>alert(4)</script>' });
    expect(html).not.toContain("<script>alert(4)");
  });
});
