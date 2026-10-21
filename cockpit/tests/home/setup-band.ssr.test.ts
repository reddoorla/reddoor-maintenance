import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import Home from "../../src/routes/+page.svelte";
import SitePage from "../../src/routes/s/[slug]/+page.svelte";
import SitesPage from "../../src/routes/fleet/+page.svelte";
import { buildCockpitView, buildSitesView } from "../../src/lib/cockpit/view.js";
import { buildFleetTableModel, parseFleetTableQuery } from "../../../src/dashboard/fleet-table.js";
import { buildSiteView } from "../../src/lib/site/view.js";
import { buildSiteAlarmContext } from "../../../src/dashboard/fleet-cockpit.js";
import { renderPage } from "../_helpers/parity.js";
import { built, siteRow, NOW, BASE } from "./fixtures.js";

/**
 * The Setup band (#672 step 2). Roster gaps (no GA4, no Search Console
 * property, no git repo, no Netlify ID, no custom domain) left the Watch band:
 * `/` counts them in a Setup lane apart from the verdict, and each card and
 * site page lists them as a checklist. The tier rules are pinned in
 * tests/dashboard/fleet-cockpit.test.ts; this file pins what the pages show.
 */

beforeAll(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterAll(() => {
  vi.useRealTimers();
});

const home = (sites: Parameters<typeof built>[0]) =>
  renderPage(Home, { data: { view: buildCockpitView(built(sites), NOW) } });

/** Sites (`/fleet`), where each site's card health sits on its row (#672 step 3). */
const sitesPage = (sites: Parameters<typeof built>[0]) =>
  renderPage(SitesPage, {
    data: {
      model: buildFleetTableModel(sites, parseFleetTableQuery(new URLSearchParams())),
      sites: buildSitesView(built(sites), NOW),
    },
  });

const GAPS = siteRow({ id: "recG", name: "Gappy", ga4PropertyId: null, gitRepo: null });
const CLEAN = siteRow({ id: "recC", name: "Clean", url: "https://clean.example.com" });
// A genuine watch (Performance 80) on a site that also has a roster gap.
const BOTH = siteRow({
  id: "recB",
  name: "Both",
  url: "https://both.example.com",
  pScore: 80,
  netlifyId: null,
});

/** The Setup lane's summary line, or null when the page has no lane. */
const laneSummary = (html: string): string | null =>
  /<details class="setup-lane">\s*<summary>([^<]*)<\/summary>/.exec(html)?.[1] ?? null;

/** The checklist items on the Sites row for `name`. */
function cardGaps(html: string, name: string): string[] {
  const card = html.split('<tr class="fleet-row"').find((c) => c.includes(`>${name}</a>`));
  if (!card) throw new Error(`no row for ${name}`);
  return [
    ...card.matchAll(/<li[^>]*>\s*<span aria-hidden="true">☐<\/span> ([^<]*?)\s*<\/li>/g),
  ].map((m) => m[1]!);
}

describe("/ — the Setup lane", () => {
  it("counts every site with a gap, whatever its tier, and lists each one's gaps", () => {
    const html = home([GAPS, CLEAN, BOTH]);
    expect(laneSummary(html)).toBe("🧰 Setup (2 sites)");
    const lane = html.split('<details class="setup-lane">')[1]!.split("</details>")[0]!;
    expect(lane).toContain('href="/s/gappy"');
    expect(lane).toContain('href="/s/both"');
    expect(lane).not.toContain("Clean");
  });

  it("counts a broken site's gap too: Setup is not a tier", () => {
    const broken = siteRow({
      id: "recX",
      name: "Broken",
      url: "https://broken.example.com",
      securityVulnsCritical: 2,
      gitRepo: null,
    });
    // The site really is broken (its pill is on Sites since #672 step 3).
    expect(sitesPage([broken, CLEAN])).toContain('class="pill attention"');
    expect(laneSummary(home([broken, CLEAN]))).toBe("🧰 Setup (1 site)");
  });

  it("is absent when no site has a gap (the positive control)", () => {
    expect(laneSummary(home([CLEAN]))).toBeNull();
  });

  it("does not count Setup in the verdict: gaps alone are all clear", () => {
    const html = home([GAPS, CLEAN]);
    expect(html).toContain('class="verdict ok"');
    expect(html).toContain("2 sites healthy");
    expect(html).not.toContain('class="needs-you"');
  });

  it("a genuine watch still raises the verdict beside a Setup gap", () => {
    const html = home([BOTH]);
    expect(html).toContain('class="verdict watch"');
    expect(html).toMatch(/Both<\/strong> — Performance 80/);
    // The gap is on the checklist, not among the watch reasons.
    expect(html).not.toMatch(/Performance 80[^<]*Netlify ID/);
  });
});

describe("Sites — each row's checklist (the cards merged in, #672 step 3)", () => {
  it("lists the card's gaps with the text that accepts each", () => {
    expect(cardGaps(sitesPage([GAPS]), "Gappy")).toEqual([
      'GA4 property not recorded (reports carry no analytics) · accept: "no analytics"',
      'Git repo not recorded (checkout sweeps cannot clone this site) · accept: "no git repo"',
    ]);
  });

  it("a complete card shows no checklist", () => {
    expect(cardGaps(sitesPage([CLEAN]), "Clean")).toEqual([]);
  });

  it("a gap still answers its filter chip, though it left the Watch band", () => {
    const html = sitesPage([GAPS]);
    const signals = /<tr class="fleet-row" data-signals="([^"]*)"/.exec(html)?.[1] ?? "";
    expect(signals.split(" ")).toEqual(expect.arrayContaining(["no-analytics", "no-git-repo"]));
  });

  it("an accepted gap leaves the checklist", () => {
    const accepted = siteRow({ ...GAPS, acceptedWatchConditions: ["no analytics"] });
    expect(cardGaps(sitesPage([accepted]), "Gappy")).toEqual([
      'Git repo not recorded (checkout sweeps cannot clone this site) · accept: "no git repo"',
    ]);
  });
});

describe("/s/:slug — the site's checklist", () => {
  const sitePage = (site: typeof GAPS) => {
    const alarm = buildSiteAlarmContext(site, [], BASE, NOW);
    return renderPage(SitePage, {
      data: { view: buildSiteView(site, [], [], null, NOW, alarm) },
    });
  };

  it("lists the gaps under the setup line, and raises no Watch for them", () => {
    const html = sitePage(GAPS);
    expect(html).toMatch(
      /<ul aria-label="Setup" class="setup-gaps">|<ul class="setup-gaps" aria-label="Setup">/,
    );
    expect(html).toContain('accept: "no git repo"');
    expect(html).not.toContain("<h2>Watch</h2>");
  });

  it("a complete site shows no checklist", () => {
    expect(sitePage(CLEAN)).not.toContain("setup-gaps");
  });
});

describe("the onboarding score never says complete beside an open gap", () => {
  // Review round 1: the six-point onboarding score and the Setup checklist use
  // different rules, so a site can score 6/6 with a roster gap open.
  const GIT_ONLY = siteRow({
    id: "recO",
    name: "Only Git",
    url: "https://o.example.com",
    gitRepo: null,
  });

  it("on /s/:slug, a full score with a gap points at the checklist", () => {
    const alarm = buildSiteAlarmContext(GIT_ONLY, [], BASE, NOW);
    const html = renderPage(SitePage, {
      data: { view: buildSiteView(GIT_ONLY, [], [], null, NOW, alarm) },
    });
    expect(html).toMatch(
      /Setup 6\/6 — (<!--[^>]*-->)*<span class="setup-missing">1 roster gap open, below<\/span>/,
    );
    expect(html).not.toContain('class="setup-ok"');
  });

  it("on /s/:slug, a full score with no gap still says complete (the positive control)", () => {
    const alarm = buildSiteAlarmContext(CLEAN, [], BASE, NOW);
    const html = renderPage(SitePage, {
      data: { view: buildSiteView(CLEAN, [], [], null, NOW, alarm) },
    });
    expect(html).toContain('<span class="setup-ok">complete</span>');
  });

  it("on a Sites row, the setup tooltip names the open gap rather than complete", () => {
    expect(sitesPage([GIT_ONLY])).toContain('title="1 roster gap open"');
    expect(sitesPage([CLEAN])).toContain('title="Setup complete"');
  });

  it("on /s/:slug, the gaps still show when the site's alarm data failed to load", () => {
    // page-data passes a null alarm when building it threw; the gaps come from the row.
    const html = renderPage(SitePage, {
      data: { view: buildSiteView(GIT_ONLY, [], [], null, NOW, null) },
    });
    expect(html).toContain("Git repo not recorded");
    expect(html).not.toContain('class="setup-ok"');
  });

  it("on /s/:slug, missing onboarding items stay on the line with gaps below", () => {
    const both = siteRow({
      id: "recM",
      name: "Both Kinds",
      url: "https://m.example.com",
      ga4PropertyId: null,
      gitRepo: null,
    });
    const alarm = buildSiteAlarmContext(both, [], BASE, NOW);
    const html = renderPage(SitePage, {
      data: { view: buildSiteView(both, [], [], null, NOW, alarm) },
    });
    expect(html).toMatch(/<span class="setup-missing">Missing: GA4 property/);
    expect(html).toContain("Git repo not recorded");
  });
});
