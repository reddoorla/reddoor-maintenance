import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { overviewFromSnapshot } from "../../src/lib/overview/view.js";
import { tickerSeconds, tickerView, type TickerEntry } from "../../src/lib/overview/ticker.js";
import type { CockpitModel, SiteCard } from "../../../src/dashboard/fleet-cockpit.js";
import type { WebsiteRow } from "../../../src/fleet/site-row.js";
import type { AttentionItem } from "../../../src/alerts/attention.js";
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

  it.each(["garbage", "", "2026-13-45"])(
    "does not take the page down on a deploy date it cannot read (%j)",
    (bad) => {
      const s = snapshot({
        sites: [healthy({ id: "recK", name: "Kiln", pScore: null, lastDeployAt: bad })],
      });
      expect(() => overviewFromSnapshot(s, NOW)).not.toThrow();
      expect(byName("Kiln", s).fact).toBe("no speed score or deploy recorded yet");
    },
  );

  it("reads a deploy by its Pacific day, so 03:00 UTC is the evening before", () => {
    const s = snapshot({
      sites: [
        healthy({
          id: "recP",
          name: "Pacific",
          pScore: null,
          lastDeployAt: "2026-10-21T03:00:00Z",
        }),
      ],
    });
    expect(byName("Pacific", s).fact).toBe("last deployed Oct 20");
  });

  // r2 E (R2-10): 06:00 UTC is 11pm the day before in Pacific time, and Oct 21 in New York.
  it("reads 06:00 UTC by its Pacific day, so it is still Oct 20 (New York would say Oct 21)", () => {
    const s = snapshot({
      sites: [
        healthy({ id: "recY", name: "Yonder", pScore: null, lastDeployAt: "2026-10-21T06:00:00Z" }),
      ],
    });
    expect(byName("Yonder", s).fact).toBe("last deployed Oct 20");
  });

  // P1-87 PR 5b review r2 B: Date.parse is lenient. "0" and "12" parse to a year 2000 or a
  // day in 2001, and "2026-02-30" rolls over into March, so each read as a believable date.
  // Only a real timestamp is a deploy date; anything else falls back.
  it.each(["0", "12", "2026-02-30T12:00:00Z", "2026-10-20", "2026-13-01T12:00:00Z"])(
    "gives the fallback for a deploy value that is not a real timestamp (%j)",
    (bad) => {
      const s = snapshot({
        sites: [healthy({ id: "recF", name: "Fake", pScore: null, lastDeployAt: bad })],
      });
      expect(byName("Fake", s).fact).toBe("no speed score or deploy recorded yet");
    },
  );

  it("dates a full timestamp, 18:00 UTC on Oct 20, as Oct 20", () => {
    const s = snapshot({
      sites: [
        healthy({ id: "recT", name: "Stamp", pScore: null, lastDeployAt: "2026-10-20T18:00:00Z" }),
      ],
    });
    expect(byName("Stamp", s).fact).toBe("last deployed Oct 20");
  });

  it("dates a deploy at 03:00 UTC on Oct 21 as Oct 20, the Pacific day it fell on", () => {
    const s = snapshot({
      sites: [
        healthy({ id: "recU", name: "Early", pScore: null, lastDeployAt: "2026-10-21T03:00:00Z" }),
      ],
    });
    expect(byName("Early", s).fact).toBe("last deployed Oct 20");
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

  it("leaves out a launching site even when its tier is broken", () => {
    const m = modelOf(
      card({ id: "recT", name: "Tower", status: "launching" }, "broken"),
      card({ id: "recM", name: "Maint" }, "healthy"),
    );
    expect(tickerView(m, new Map(), NOW).map((t) => t.name)).toEqual(["Maint"]);
  });

  it("names a Watch site by its watch-level item before its watch reasons", () => {
    const item = {
      key: "renovate:recW",
      kind: "renovate",
      title: "Renovate PR open 9 days",
      level: "watch",
    } as unknown as AttentionItem;
    const c: SiteCard = {
      ...card({ id: "recW", name: "Watcher" }, "watch"),
      items: [item],
      watchReasons: ["Performance 78"],
    };
    const [t] = tickerView(modelOf(c), new Map(), NOW);
    expect(t!.fact).toBe("Renovate PR open 9 days, and 1 more");
  });

  it("leaves out a site that is not maintained", () => {
    const m = modelOf(
      card({ id: "recL", name: "Launch", status: "launching" }, "pre-launch"),
      card({ id: "recM", name: "Maint" }, "healthy"),
    );
    expect(tickerView(m, new Map(), NOW).map((t) => t.name)).toEqual(["Maint"]);
  });
});

describe("the ticker's speed", () => {
  /** An entry of exactly `chars` characters across its name, tier word and fact. */
  const entry = (chars: number): TickerEntry => ({
    key: "k",
    name: "A",
    tier: "ok",
    tierWord: "OK",
    fact: "f".repeat(chars - 3),
    href: null,
  });

  it("holds a floor of 20 seconds for a short row", () => {
    expect(tickerSeconds([entry(40), entry(40), entry(40)])).toBe(20);
  });

  it("runs 0.15 seconds a character once the text is long: 200 characters give 30", () => {
    expect(tickerSeconds([entry(100), entry(100)])).toBe(30);
  });

  // r2 E (R2-4): the name counts. A fixture named "A" hides a tickerSeconds that ignores it.
  it("counts a long name in the row's text, so long names loop slower", () => {
    const named = { ...entry(200), name: "N".repeat(100), fact: "f".repeat(97) };
    expect(tickerSeconds([named, named])).toBe(60);
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

  it("orders a model whose cards come out of order: Broken, then Attention, then OK, by name", () => {
    const m = modelOf(
      card({ id: "recZ", name: "Acme" }, "healthy"),
      card({ id: "recY", name: "Zeta", reachableOk: "fail" }, "broken"),
      card({ id: "recX", name: "Bravo" }, "attention"),
      card({ id: "recW", name: "Beta" }, "healthy"),
      card({ id: "recV", name: "Mike" }, "broken"),
    );
    expect(tickerView(m, new Map(), NOW).map((t) => t.name)).toEqual([
      "Mike",
      "Zeta",
      "Bravo",
      "Acme",
      "Beta",
    ]);
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

  it("names a site whose stored slug is empty without a link (r2 C)", () => {
    const s = snapshot({
      sites: [healthy({ id: "recE", name: "Blank", pScore: 90, lastLighthouseAuditAt: FRESH })],
      slugById: new Map([["recE", ""]]),
    });
    expect(byName("Blank", s).href).toBeNull();
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
