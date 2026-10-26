import { describe, it, expect } from "vitest";
import Page from "../../src/routes/+page.svelte";
import { buildCockpitView } from "../../src/lib/cockpit/view.js";
import { buildCockpitModel } from "../../../src/dashboard/fleet-cockpit.js";
import { renderPage } from "../_helpers/parity.js";
import { withoutComments } from "../legacy/render.js";
import { siteRow, NOW, BASE } from "./fixtures.js";

/**
 * The "Not on any site card" lane (#786), as OD 87 (#1575) left it on the old
 * renderer, ported at the cockpit cutover (#582). A dead letter for a site with
 * no card (archived) links that site's page, and is held like any known site's
 * for two replay cycles. A slug that resolves to no site has no page, so no
 * link, and it is never held.
 */

const LEGACY = siteRow({ id: "recL", name: "Legacy", status: "archived", statusRaw: "legacy" });
const LIVE = siteRow({ id: "recA", name: "Acme Co" });

function lane(deadLetters: Record<string, number>, oldest: Record<string, string> = {}) {
  const model = buildCockpitModel(
    [LIVE, LEGACY],
    [],
    {},
    BASE,
    NOW,
    [],
    null,
    [],
    0,
    new Map(),
    new Map(Object.entries(deadLetters)),
    new Map(Object.entries(oldest)),
  );
  const html = withoutComments(renderPage(Page, { data: { view: buildCockpitView(model, NOW) } }));
  return /<details class="cardless"[^>]*>([\s\S]*?)<\/details>/.exec(html)?.[1] ?? null;
}

const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();

describe("/ — the cardless lane", () => {
  it("links a dead letter for a site with no card to its page", () => {
    const html = lane({ legacy: 1 }, { legacy: hoursAgo(13) });
    expect(html).toMatch(/<strong><a href="[^"]*\/s\/legacy">Legacy<\/a><\/strong>/);
  });

  it("holds that dead letter inside its two replay cycles", () => {
    expect(lane({ legacy: 1 }, { legacy: hoursAgo(3) })).toBeNull();
  });

  it("gives a slug that resolves to no site no link, and never holds it", () => {
    const html = lane({ ghost: 2 });
    expect(html).toContain("<strong>(unknown site: ghost)</strong>");
    expect(html).not.toContain("<a ");
  });
});
