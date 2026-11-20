import { describe, it, expect } from "vitest";
import {
  nextToLight,
  STEP_LIGHT_MS,
  LEAD_DOT_MS,
  leadControlsShown,
  chapterInView,
} from "../../src/lib/how/view.js";
import {
  LEVEL_NIGHTS,
  levelNights,
  todayAtLevels,
  todayFromModel,
} from "../../src/lib/how/view.js";
import { cockpitModelFromSnapshot } from "../../../src/dashboard/snapshot-views.js";
import {
  buildNeedsYouFeed,
  type CockpitModel,
  type SiteCard,
  type Tier as CardTier,
} from "../../../src/dashboard/fleet-cockpit.js";
import type { OverviewNight } from "../../../src/fleet-daily/read.js";
import { cockpitCounts } from "../../../src/fleet-daily/write.js";
import { siteSlug } from "../../../src/fleet/site-row.js";
import { NOW, FRESH, healthy, night, snapshot } from "../overview/fixtures.js";

/**
 * PR 8c item 8 (plans/2026-11-16-p1-87-overview-reorg/pr8-motion-plan.md, "8c"): the night's
 * steps light in order as they scroll into view. The ordering rule is a pure function so the
 * mutants on it are caught here, not only in a browser.
 */
describe("PR 8c item 8: the steps light in order", () => {
  it("a step lights once it has been seen and nothing above it is unlit", () => {
    expect(nextToLight([true, true], [false, false])).toBe(0);
    expect(nextToLight([true, true], [true, false])).toBe(1);
  });

  it("nothing lights before a step has been seen", () => {
    expect(nextToLight([false, false], [false, false])).toBeNull();
    expect(nextToLight([false, true], [false, false])).toBeNull();
  });

  it("a step that enters before the one above it waits for that step", () => {
    expect(nextToLight([false, true, true], [false, false, false])).toBeNull();
    expect(nextToLight([true, false, true], [true, false, false])).toBeNull();
  });

  it("nothing is left to light once every step is lit", () => {
    expect(nextToLight([true, true], [true, true])).toBeNull();
  });

  it("each step takes 300 ms, the length of its transition", () => {
    expect(STEP_LIGHT_MS).toBe(300);
  });

  it("the whole run stays under five seconds, the plan's ceiling for moving things", () => {
    expect(STEP_LIGHT_MS * 8).toBeLessThanOrEqual(5_000);
  });
});

/**
 * PR 8c item 9 (pr8-motion-plan.md, "8c"): the lead's dot runs once, across the journey, in 3.5 s.
 */
describe("PR 8c item 9, round 1 D3: the dot and Replay follow the counts", () => {
  it("shows only when motion is allowed and the counts are readable", () => {
    expect(leadControlsShown(true, { allTime: { submissions: 1 } })).toBe(true);
    expect(leadControlsShown(true, { allTime: null })).toBe(false);
    expect(leadControlsShown(false, { allTime: { submissions: 1 } })).toBe(false);
    expect(leadControlsShown(false, { allTime: null })).toBe(false);
  });

  it("reads the counts from the leads object itself, so the page cannot pass the wrong field", () => {
    // The page used to pass v.leads.allTime; the helper now reads allTime itself, so the leads
    // object is what decides, and null counts hide the controls even when the object is present.
    expect(leadControlsShown(true, { allTime: null })).toBe(false);
    expect(leadControlsShown(true, { allTime: { submissions: 0 } })).toBe(true);
  });
});

describe("PR 8c item 9, round 1 E: the chapter counts as in view on a short screen", () => {
  it("at 0.6 of its own height, as before", () => {
    expect(chapterInView(0.6, 188.4, 314, 700)).toBe(true);
    expect(chapterInView(0.59, 185, 314, 700)).toBe(false);
  });

  it("at 0.6 of the viewport when the chapter is taller than it (844x390: 662px tall)", () => {
    expect(chapterInView(234 / 662, 234, 662, 390)).toBe(true);
    expect(chapterInView(233 / 662, 233, 662, 390)).toBe(false);
  });

  it("a tall chapter at 390x700 (716px) needs 420px showing, not the whole screen", () => {
    expect(chapterInView(420 / 716, 420, 716, 700)).toBe(true);
    expect(chapterInView(419 / 716, 419, 716, 700)).toBe(false);
  });
});

describe("PR 8c item 9: the lead's dot runs once, in 3.5 s", () => {
  it("the dot's run is 3.5 s, a named constant", () => {
    expect(LEAD_DOT_MS).toBe(3500);
  });

  it("the run stays under five seconds, the plan's ceiling for moving things", () => {
    expect(LEAD_DOT_MS).toBeLessThanOrEqual(5_000);
  });
});

/** PR 8c item 10 (pr8-motion-plan.md, "8c"): the ladder's panels. Today's sites and the 21-night
 *  line come from the overview's own counts and the Triage feed's wording, never a second copy. */
const DAY_MS = 86_400_000;
const shift = (d: string, n: number) =>
  new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);

/** One entry per night of the 21 ending on the night expected by NOW (Oct 26), oldest first:
 *  a count of sites at the level, or how that night is missing or wrong. */
type Entry = number | "missing" | "unread" | "earlier";
/** The writer's sites block for `n` cards at one card tier: cockpitCounts builds it, so the
 *  tests read the keys production writes (`healthy`, `watch`, `attention`, `broken`). */
function sitesBlock(tier: CardTier, n: number): OverviewNight["counts"]["sites"] {
  return sitesBlockOf(Array.from({ length: n }, () => tier));
}
/** The writer's sites block for one card per entry, each at its own card tier. */
function sitesBlockOf(tiers: CardTier[]): OverviewNight["counts"]["sites"] {
  const cards = tiers.map((tier) => ({ tier, items: [], setup: [] }));
  const model = { cards, cardless: [], summary: { preLaunch: 0 } } as unknown as CockpitModel;
  return { value: cockpitCounts(model).sites } as unknown as OverviewNight["counts"]["sites"];
}
function window21(entries: Entry[], tier: CardTier = "broken"): OverviewNight[] {
  const out: OverviewNight[] = [];
  entries.forEach((e, i) => {
    if (e === "missing") return;
    const date = shift("2026-10-26", i - 20);
    const sites = e === "unread" ? null : sitesBlock(tier, e === "earlier" ? 2 : e);
    out.push(
      night(date, {
        ladderVersion: e === "earlier" ? 1 : 2,
        sites: sites as unknown as OverviewNight["counts"]["sites"],
      }),
    );
  });
  return out;
}
const ZEROS: Entry[] = Array(16).fill(0);
const line = (nights: OverviewNight[] | null, tier: "broken" | "ok" = "broken") =>
  levelNights(nights, tier, NOW);

describe("PR 8c item 10: the nights line", () => {
  it("the window is 21 nights", () => {
    expect(LEVEL_NIGHTS).toBe(21);
  });

  it("says on how many nights a site sat at the level, and the most on one night", () => {
    expect(line(window21([0, 2, 1, 0, 3, ...ZEROS]))).toBe(
      "At least one site sat here on 3 of the last 21 nights; the most on one night was 3.",
    );
  });

  it("a night on an earlier ladder version is left out", () => {
    expect(line(window21([0, "earlier", 1, 0, 3, ...ZEROS]))).toBe(
      "At least one site sat here on 2 of the 20 nights counted in the last 21; the most on one night was 3.",
    );
  });

  it("a missing night shrinks the count, and is never read as zero", () => {
    expect(line(window21([0, "missing", 1, 0, 3, ...ZEROS]))).toBe(
      "At least one site sat here on 2 of the 20 nights counted in the last 21; the most on one night was 3.",
    );
  });

  it("a count that could not be read is left out, as a missing night is", () => {
    expect(line(window21([0, "unread", 1, 0, 3, ...ZEROS]))).toBe(
      "At least one site sat here on 2 of the 20 nights counted in the last 21; the most on one night was 3.",
    );
  });

  it("nights older than the window do not count", () => {
    const older = Array.from({ length: 10 }, (_, k) =>
      night(shift("2026-10-26", -21 - k), {
        ladderVersion: 2,
        sites: {
          value: { cards: 2, tiers: { broken: 5 } },
        } as unknown as OverviewNight["counts"]["sites"],
      }),
    );
    expect(line([...older, ...window21([0, 2, 1, 0, 3, ...ZEROS])])).toBe(
      "At least one site sat here on 3 of the last 21 nights; the most on one night was 3.",
    );
  });

  it("no site on any counted night reads as none, not as a count", () => {
    expect(line(window21(ZEROS.concat([0, 0, 0, 0, 0])))).toBe(
      "No site sat here on any of the last 21 nights.",
    );
  });

  it("no counted night yet says so", () => {
    expect(line([])).toBe("No nights counted yet in the last 21.");
  });

  it("unreadable nights say the counts could not be read", () => {
    expect(line(null)).toBe("The nightly counts could not be read just now.");
  });

  it("the OK level reads its own counts", () => {
    expect(line(window21([...Array(21)].map(() => 0) as Entry[]), "ok")).toBe(
      "No site sat here on any of the last 21 nights.",
    );
  });

  it("the OK level reads the writer's healthy count, the key OK is stored under", () => {
    expect(line(window21([0, 2, 1, 0, 3, ...ZEROS], "healthy"), "ok")).toBe(
      "At least one site sat here on 3 of the last 21 nights; the most on one night was 3.",
    );
  });

  it("the most on one night is taken over counted nights only (an earlier or unreadable night's count is ignored)", () => {
    // Round 1, C1: the earlier-version night carries 9, and the unreadable night reads "9" as
    // a tier count, which is not a count. Neither is counted, so the most is the counted 3.
    const nights = window21([0, "earlier", 1, 0, 3, ...ZEROS]);
    nights[1]!.counts.sites = sitesBlock("broken", 9);
    nights[2]!.counts.sites = {
      value: { cards: 2, tiers: { broken: "9" } },
    } as unknown as OverviewNight["counts"]["sites"];
    expect(line(nights)).toBe(
      "At least one site sat here on 1 of the 19 nights counted in the last 21; the most on one night was 3.",
    );
  });

  it("the version comes from the newest night: older nights on version 1 are left out", () => {
    // Round 1, C2: the ten oldest nights are on version 1 with 5 sites each; the eleven newest
    // are on version 2. Only the version-2 nights count, so the most is 3, over 11 nights.
    const nights = window21([...Array(10).fill(5), 0, 2, 1, 0, 3, 0, 0, 0, 0, 0, 0]);
    for (const n of nights.slice(0, 10)) {
      n.counts.ladderVersion = 1;
      n.counts.sites = sitesBlock("broken", 5);
    }
    expect(line(nights)).toBe(
      "At least one site sat here on 3 of the 11 nights counted in the last 21; the most on one night was 3.",
    );
  });

  it("the Watch and Attention lines read their own tier's count, not the healthy count (round 2 B)", () => {
    // One watch site on the five oldest nights, two attention sites on the three newest, built as
    // cockpitCounts writes them. Watch and Attention must each read their own key.
    const nights = Array.from({ length: 21 }, (_, i) =>
      night(shift("2026-10-26", i - 20), {
        ladderVersion: 2,
        sites: sitesBlockOf([
          ...(i < 5 ? (["watch"] as const) : []),
          ...(i >= 18 ? (["attention", "attention"] as const) : []),
        ]),
      }),
    );
    expect(levelNights(nights, "watch", NOW)).toBe(
      "At least one site sat here on 5 of the last 21 nights; the most on one night was 1.",
    );
    expect(levelNights(nights, "attention", NOW)).toBe(
      "At least one site sat here on 3 of the last 21 nights; the most on one night was 2.",
    );
  });
});

describe("PR 8c item 10: today's sites at each level", () => {
  // Beta: a Broken item and an Attention one; Tee: Attention; Watcher: Watch; Acme: OK;
  // Alpha: Attention (sorts before Tee); Launch: launching, so it is in no level.
  const SNAP = snapshot({
    sites: [
      healthy({
        id: "recB",
        name: "Beta",
        reachableOk: "fail",
        certDaysRemaining: 10,
        securityVulnsHigh: 1,
        lastSecurityAuditAt: FRESH,
      }),
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
      healthy({ id: "recT", name: "Tee", certDaysRemaining: 10 }),
      healthy({ id: "recG", name: "Alpha", certDaysRemaining: 10 }),
      healthy({ id: "recL", name: "Launch", status: "launching", reachableOk: "fail" }),
    ],
    digest: { "uptime:recB": { metric: 1, firstFlaggedAt: "2026-10-25" } },
    slugById: new Map([
      ["recA", "acme-co"],
      ["recB", "beta"],
      ["recW", "watcher"],
    ]),
  });
  const today = todayAtLevels(SNAP, NOW);

  it("lists each maintained site once, at its own level, and leaves out a launching site", () => {
    expect(today.broken.map((s) => s.name)).toEqual(["Beta"]);
    expect(today.attention.map((s) => s.name)).toEqual(["Alpha", "Tee"]);
    expect(today.watch.map((s) => s.name)).toEqual(["Watcher"]);
    expect(today.ok.map((s) => s.name)).toEqual(["Acme"]);
    const everyName = Object.values(today)
      .flat()
      .map((s) => s.name);
    expect(everyName).not.toContain("Launch");
    expect(new Set(everyName).size).toBe(everyName.length);
  });

  it("names a site by its worst open item, in the Triage page's own words", () => {
    // Beta is Broken with a Broken item and an Attention one: the Broken title is named.
    expect(today.broken[0]!.reason).toBe("a sampled page did not answer 2xx or 3xx");
    expect(today.attention[1]!.reason).toBe("TLS certificate expires in 10 days");
    expect(today.watch[0]!.reason).toBe("Performance 78");
  });

  it("agrees with the Triage feed's reason for every named site", () => {
    const feed = buildNeedsYouFeed(cockpitModelFromSnapshot(SNAP, NOW));
    for (const level of ["broken", "attention", "watch"] as const) {
      for (const s of today[level]) {
        expect(s.reason).toBe(feed.find((r) => r.siteName === s.name)!.reasons[0]);
      }
    }
  });

  it("an OK site says no open items, and never that every check is passing", () => {
    expect(today.ok[0]!.reason).toBe("no open items");
  });

  it("a healthy site with a failing smoke test reads no open items, not every check passing", () => {
    // Reproduced in node (correctness F3): the card sits at healthy with a fresh failed smoke
    // test, and the overview counts that check as failing. A healthy card holds no open
    // Triage item, so the line is "no open items"; "every check passing" would be false here.
    const s = snapshot({
      sites: [healthy({ id: "recS", name: "Smoky", smokeOk: "fail", lastSmokeAt: FRESH })],
      digest: {},
      slugById: new Map(),
    });
    const model = cockpitModelFromSnapshot(s, NOW);
    expect(model.cards.find((c) => c.site.name === "Smoky")!.tier).toBe("healthy");
    expect(buildNeedsYouFeed(model).some((r) => r.slug === siteSlug("Smoky"))).toBe(false);
    expect(todayAtLevels(s, NOW).ok).toEqual([{ name: "Smoky", reason: "no open items" }]);
  });

  it("a level lists its sites by name, not by how bad their items are (round 1 fold)", () => {
    // Tee's certificate expires in 8 days, worse than Alpha's 10 (both Attention): order stays by name.
    const s = snapshot({
      sites: [
        healthy({ id: "recTe", name: "Tee", certDaysRemaining: 8 }),
        healthy({ id: "recAl", name: "Alpha", certDaysRemaining: 10 }),
      ],
      digest: {},
      slugById: new Map(),
    });
    expect(todayAtLevels(s, NOW).attention.map((x) => x.name)).toEqual(["Alpha", "Tee"]);
  });
});

describe("PR 8c item 10: the level's sites, by their own status and count", () => {
  it("a site that is not maintained is never listed, even at a broken tier", () => {
    const card = (name: string, status: string, tier: string) =>
      ({ site: { name, status }, tier, items: [], watchReasons: [] }) as unknown as SiteCard;
    const model = {
      cards: [card("Tower", "launching", "broken"), card("Maint", "maintained", "broken")],
      pending: [],
    } as unknown as CockpitModel;
    expect(todayFromModel(model).broken.map((s) => s.name)).toEqual(["Maint"]);
  });

  it("a tier count that is not a count is left out, never read as 0", () => {
    const bad = window21([0, 2, 1, 0, 3, ...ZEROS]);
    bad[1]!.counts.sites = { value: { cards: 2, tiers: { broken: "many" } } } as never;
    expect(line(bad)).toBe(
      "At least one site sat here on 2 of the 20 nights counted in the last 21; the most on one night was 3.",
    );
  });
});
