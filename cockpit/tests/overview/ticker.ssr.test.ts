import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { overviewFromSnapshot } from "../../src/lib/overview/view.js";
import { tickerView, type TickerEntry } from "../../src/lib/overview/ticker.js";
import type { CockpitModel, SiteCard } from "../../../src/dashboard/fleet-cockpit.js";
import type { WebsiteRow } from "../../../src/fleet/site-row.js";
import { makeSubmissionRow } from "../../../tests/_helpers/submission-row.js";
import { NOW, FRESH, healthy, snapshot } from "./fixtures.js";

/**
 * P1-87 PR 5b: the site ticker, one row of every maintained site, worst first. These
 * pin what each entry says (its tier, its fact, its link), the order, and that no
 * lead's details reach it. The page's own tests pin how it renders.
 */

const BROKEN_UPTIME = { "uptime:recB": { metric: 1, firstFlaggedAt: "2026-10-25" } };

/** A Broken site (its uptime check fails), a quiet OK one, and a watch one. */
const SNAP = snapshot({
  sites: [
    healthy({ id: "recB", name: "Beta", reachableOk: "fail" }),
    healthy({ id: "recA", name: "Acme", pScore: 97, lastLighthouseAuditAt: FRESH }),
    healthy({
      id: "recW",
      name: "Watcher",
      pScore: 78,
      lastLighthouseAuditAt: FRESH,
      rScore: 80,
      bpScore: 100,
      seoScore: 100,
    }),
  ],
  digest: BROKEN_UPTIME,
  slugById: new Map([
    ["recA", "acme-co"],
    ["recB", "beta"],
    ["recW", "watcher"],
  ]),
});

const ticker = (s = SNAP): TickerEntry[] => overviewFromSnapshot(s, NOW).ticker;
const byName = (name: string, s = SNAP) => ticker(s).find((t) => t.name === name)!;

describe("the ticker's facts, by tier", () => {
  it("names a Broken site with the same plain words as the status line", () => {
    const status = overviewFromSnapshot(SNAP, NOW).status.broken.find((b) => b.siteName === "Beta");
    expect(status).toBeDefined();
    expect(byName("Beta")).toMatchObject({ tier: "broken", tierWord: "Broken" });
    expect(byName("Beta").fact).toBe(status!.reasons);
  });

  it("says 'and N more' after the first reason when a Broken site has more", () => {
    const s = snapshot({
      sites: [
        healthy({
          id: "recB",
          name: "Beta",
          reachableOk: "fail",
          certDaysRemaining: -2,
          domainCheckedAt: FRESH,
        }),
      ],
      digest: BROKEN_UPTIME,
    });
    const status = overviewFromSnapshot(s, NOW).status.broken.find((b) => b.siteName === "Beta");
    const [first, ...rest] = status!.reasons.split("; ");
    expect(rest).toHaveLength(1);
    expect(byName("Beta", s).fact).toBe(`${first}, and 1 more`);
  });

  it("names a Watch site by its watch reasons, and counts the rest", () => {
    expect(byName("Watcher")).toMatchObject({ tier: "watch", tierWord: "Watch" });
    expect(byName("Watcher").fact).toBe("Performance 78, and 1 more");
  });

  it("gives an OK site its Lighthouse speed score", () => {
    expect(byName("Acme")).toMatchObject({ tier: "ok", tierWord: "OK" });
    expect(byName("Acme").fact).toBe("speed 97 of 100");
  });

  it("dates the last deploy when an OK site has no speed score", () => {
    const s = snapshot({
      sites: [
        healthy({
          id: "recD",
          name: "Dune",
          pScore: null,
          lastDeployAt: "2026-10-20T18:00:00.000Z",
        }),
      ],
    });
    expect(byName("Dune", s).fact).toBe("last deployed Oct 20");
  });

  it("says so when an OK site has neither a score nor a deploy", () => {
    const s = snapshot({
      sites: [healthy({ id: "recN", name: "Nil", pScore: null, lastDeployAt: null })],
    });
    expect(byName("Nil", s).fact).toBe("no speed score or deploy recorded yet");
  });
});

/** A hand-built model: one card per entry, so a tier can be set without the rules that
 *  would set it on a real site. */
function card(site: Partial<WebsiteRow>, tier: SiteCard["tier"]): SiteCard {
  return {
    site: healthy(site),
    tier,
    items: [],
    watchReasons: [],
    watchSignals: [],
    acceptedReasons: [],
  };
}
const modelOf = (...cards: SiteCard[]): CockpitModel =>
  ({ summary: {}, cards, pending: [] }) as unknown as CockpitModel;

describe("the ticker's unit rules", () => {
  it("speaks of a speed score of 0 as a score, not as none", () => {
    const m = modelOf(card({ id: "recZ", name: "Zero", pScore: 0 }, "healthy"));
    expect(tickerView(m, new Map(), NOW)[0]!.fact).toBe("speed 0 of 100");
  });

  it("names a not-OK site with nothing to name by pointing at its page", () => {
    const m = modelOf(card({ id: "recQ", name: "Quiet" }, "attention"));
    const [t] = tickerView(m, new Map(), NOW);
    expect(t!.tier).toBe("attention");
    expect(t!.fact).toBe("see the site's page");
  });

  it("leaves out a site that is not maintained", () => {
    const m = modelOf(
      card({ id: "recL", name: "Launch", status: "launching" }, "pre-launch"),
      card({ id: "recM", name: "Maint" }, "healthy"),
    );
    expect(tickerView(m, new Map(), NOW).map((t) => t.name)).toEqual(["Maint"]);
  });
});

describe("the ticker's order", () => {
  it("puts a Broken site before an OK one, whatever the names", () => {
    const s = snapshot({
      sites: [
        healthy({ id: "recA", name: "Acme" }),
        healthy({ id: "recZ", name: "Zeta", reachableOk: "fail" }),
      ],
      digest: { "uptime:recZ": { metric: 1, firstFlaggedAt: "2026-10-25" } },
    });
    expect(ticker(s).map((t) => t.name)).toEqual(["Zeta", "Acme"]);
  });

  it("orders sites of one tier by name", () => {
    const s = snapshot({
      sites: [healthy({ id: "recD", name: "Delta" }), healthy({ id: "recC", name: "Charlie" })],
    });
    expect(ticker(s).map((t) => t.name)).toEqual(["Charlie", "Delta"]);
  });
});

describe("the ticker's link", () => {
  it("links a site to its stored slug, not one made from its name", () => {
    expect(byName("Acme").href).toBe("/s/acme-co");
  });

  it("names a site with no stored slug without a link", () => {
    const s = snapshot({
      sites: [healthy({ id: "recN", name: "Nolink", pScore: 90, lastLighthouseAuditAt: FRESH })],
      slugById: new Map(),
    });
    expect(byName("Nolink", s).href).toBeNull();
  });
});

describe("the ticker and a lead's details", () => {
  it("carries no submitter's name, email or message", () => {
    const s = snapshot({
      sites: [healthy({ id: "recA", name: "Acme", pScore: 97, lastLighthouseAuditAt: FRESH })],
      submissions: [
        makeSubmissionRow({
          id: "sub-x",
          siteId: "recA",
          name: "SENTINEL-NAME-7731",
          email: "sentinel-email-7731@example.invalid",
          message: "SENTINEL-MESSAGE-7731",
          status: "new",
          submittedAt: FRESH,
        }),
      ],
      slugById: new Map([["recA", "acme"]]),
    });
    const json = JSON.stringify(ticker(s));
    expect(json).not.toContain("SENTINEL");
    expect(json).not.toContain("sentinel-email");
  });
});

describe("the ticker's styles", () => {
  const css = readFileSync(
    new URL("../../src/lib/overview/overview.css", import.meta.url),
    "utf8",
  ).replace(/\/\*[\s\S]*?\*\//g, "");
  const reduced = (() => {
    const at = css.indexOf("@media (prefers-reduced-motion: reduce)");
    if (at < 0) return "";
    const open = css.indexOf("{", at);
    let depth = 0;
    for (let i = open; i < css.length; i++) {
      if (css[i] === "{") depth++;
      else if (css[i] === "}" && --depth === 0) return css.slice(open + 1, i);
    }
    return "";
  })();

  it("stops the run under reduced motion, with the run's own rule", () => {
    expect(reduced).toMatch(/(?<=^|\})\s*\.ov-ticker-run\s*\{[^}]*animation:\s*none/);
  });

  it("hides the copy under reduced motion, with the copy's own rule", () => {
    expect(reduced).toMatch(/(?<=^|\})\s*\.ov-ticker-list\.copy\s*\{[^}]*display:\s*none/);
  });
});
