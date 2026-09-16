import { describe, it, expect } from "vitest";
import { buildCockpitModel } from "../../src/dashboard/fleet-cockpit.js";
import { renderCockpitHtml } from "../../src/dashboard/fleet-render.js";
import { makeWebsiteRow } from "../_helpers/website-row.js";

/**
 * #786 item 2. The cockpit's card grid is built from the VISIBLE sites and
 * attention items are grouped onto it by `siteName`, so an item whose site name
 * matches no card is silently dropped.
 *
 * Exactly one collector can produce such an item today, and it is the one whose
 * whole point is that the site is missing: a dead letter for a slug that
 * resolves to no fleet site reaches the digest as `(unknown site: <slug>)` and
 * means leads are being dropped right now. The digest renders items flat by
 * title so it carries that flavour; the cockpit had nowhere to put it.
 *
 * The lane is deliberately general rather than dead-letter-specific: any future
 * collector emitting a card-less item lands here instead of vanishing.
 */

const BASE = "https://dash.example.com";
const NOW = new Date("2026-09-15T12:00:00.000Z");

const acme = makeWebsiteRow({ id: "recACME", name: "Acme Co", status: "maintained" });

/** buildCockpitModel's dead-letter argument is the 11th positional. */
function modelWithDeadLetters(deadLetters: Map<string, number>) {
  return buildCockpitModel([acme], [], {}, BASE, NOW, [], null, [], 0, new Map(), deadLetters);
}

describe("card-less attention items reach the cockpit", () => {
  it("surfaces an item whose site resolves to NO fleet card", () => {
    const model = modelWithDeadLetters(new Map([["ghost-co", 2]]));
    const keys = (model.cardless ?? []).map((i) => i.key);
    expect(keys).toContain("deadletter:ghost-co");
  });

  it("carries the item's own title, so the lane says what is wrong", () => {
    const model = modelWithDeadLetters(new Map([["ghost-co", 2]]));
    const item = (model.cardless ?? []).find((i) => i.key === "deadletter:ghost-co")!;
    expect(item.siteName).toBe("(unknown site: ghost-co)");
    expect(item.severity).toBe("critical");
    expect(item.title).toMatch(/resolves to NO fleet site/);
  });

  it("does NOT divert an item that HAS a card — it stays on the site card", () => {
    // The grant side, and the one that keeps this from quietly emptying the grid.
    const model = modelWithDeadLetters(new Map([["acme-co", 3]]));
    expect(model.cardless ?? []).toEqual([]);
    const card = model.cards.find((c) => c.site.name === "Acme Co")!;
    expect(card.items.map((i) => i.key)).toContain("deadletter:acme-co");
    expect(card.tier).toBe("attention");
  });

  it("is empty when nothing is card-less", () => {
    expect(modelWithDeadLetters(new Map()).cardless ?? []).toEqual([]);
  });

  it("keeps a card-less item OUT of the per-site card grid entirely", () => {
    const model = modelWithDeadLetters(new Map([["ghost-co", 2]]));
    for (const card of model.cards) {
      expect(card.items.map((i) => i.key)).not.toContain("deadletter:ghost-co");
    }
  });
});

describe("the card-less lane renders", () => {
  it("shows the lane with a count and the item's title", () => {
    const html = renderCockpitHtml(modelWithDeadLetters(new Map([["ghost-co", 2]])));
    expect(html).toContain('<details class="cardless">');
    expect(html).toContain("(1)");
    expect(html).toContain("ghost-co");
  });

  it("renders no lane at all when there is nothing card-less", () => {
    const html = renderCockpitHtml(modelWithDeadLetters(new Map()));
    expect(html).not.toContain('<details class="cardless">');
  });

  it("escapes a hostile slug rather than interpolating it raw", () => {
    // The slug arrives from a form POST's URL path, so it is attacker-chosen.
    const html = renderCockpitHtml(modelWithDeadLetters(new Map([["<img src=x onerror=1>", 2]])));
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img");
  });
});
