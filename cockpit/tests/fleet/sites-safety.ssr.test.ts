import { describe, it, expect } from "vitest";
import Page from "../../src/routes/fleet/+page.svelte";
import { buildSitesView } from "../../src/lib/cockpit/view.js";
import { buildFleetTableModel, parseFleetTableQuery } from "../../../src/dashboard/fleet-table.js";
import { renderPage } from "../_helpers/parity.js";
import { built, siteRow, handModel, card, item, NOW } from "../home/fixtures.js";

/**
 * Sites looks each row's card up by slug (#672 step 3). A row with no card
 * whose slug names an Object.prototype key must find no card, not the inherited
 * function: review round 1 reproduced a 500 for an archived site named
 * "Constructor".
 */
describe("Sites — a card lookup is an own-property read", () => {
  it("renders a cardless row whose slug is 'constructor' as having no health", () => {
    const acme = siteRow({ id: "recA", name: "Acme" });
    const ctor = siteRow({
      id: "recC",
      name: "Constructor",
      status: "archived",
      statusRaw: "archived",
    });
    const html = renderPage(Page, {
      data: {
        model: buildFleetTableModel([acme, ctor], parseFleetTableQuery(new URLSearchParams())),
        sites: buildSitesView(built([acme, ctor]), NOW),
      },
    });
    const row = html.split('<tr class="fleet-row"').find((r) => r.includes(">Constructor</a>"))!;
    expect(row).toMatch(/<td class="health">(?:\s|<!--[^>]*-->)*<span class="muted">—<\/span>/);
    expect(row).toContain('data-signals=""');
  });
});

describe("Sites — chip text is text", () => {
  it("escapes a hostile attention-item title rather than emitting markup", () => {
    const acme = siteRow({ id: "recA", name: "Acme Co" });
    const model = handModel({
      cards: [
        card({
          site: acme,
          tier: "attention",
          items: [item({ title: "<img src=x onerror=alert(1)> vulns" })],
        }),
      ],
    });
    const html = renderPage(Page, {
      data: {
        model: buildFleetTableModel([acme], parseFleetTableQuery(new URLSearchParams())),
        sites: buildSitesView(model, NOW),
      },
    });
    expect(html).toContain("&lt;img src=x onerror=alert(1)> vulns");
    expect(html).not.toContain("<img src=x");
  });
});
