// #889. A `maintained` site whose row carries no Git repo, or no Netlify ID, is
// skipped by every sweep that needs that identity — the checkout sweeps
// (smoke / security / prismic-drift) cannot clone without `gitRepo`, and the
// `netlify-deploy` audit skips "no netlify id" — and every one of those runs
// still concludes success. The site's report then blocks on checklist items
// nothing will ever measure (29 Navy, 2026-09-17; beachfront-dentistry,
// measured 2026-09-29 with `netlify_id` and `deploy_checked_at` both NULL).
//
// These are watch conditions, not attention items: a maintained site that is
// genuinely not on Netlify is a legitimate state, so the operator must be able
// to accept it — and attention items sit above the accept loop by design.
import { describe, it, expect } from "vitest";
import {
  assignTier,
  buildCockpitModel,
  buildNeedsYouFeed,
  buildSiteAlarmContext,
} from "../../src/dashboard/fleet-cockpit.js";
import type { WebsiteRow } from "../../src/fleet/site-row.js";
import { WATCH_CONDITION_OPTIONS } from "../../src/dashboard/site-details.js";
import { makeWebsiteRow } from "../_helpers/website-row.js";

const NOW = new Date("2026-09-29T12:00:00Z");
const BASE_URL = "https://dash.example.com";

const REPO_REASON = "Git repo not recorded (checkout sweeps skip this site)";
const NETLIFY_REASON = "Netlify ID not recorded (deploy check skips this site)";

/** A maintained site with nothing else to watch: every OTHER watch condition is
 *  satisfied, so the only thing that can move its tier is the roster identity. */
function healthy(over: Partial<WebsiteRow> = {}): WebsiteRow {
  return makeWebsiteRow({
    id: "recGOOD",
    name: "Good Site",
    url: "https://good.example.com",
    status: "maintained",
    ga4PropertyId: "123456789",
    searchConsoleProperty: "sc-domain:good.example.com",
    gitRepo: "reddoorla/good-site",
    netlifyId: "11111111-2222-3333-4444-555555555555",
    pScore: 95,
    rScore: 95,
    bpScore: 95,
    seoScore: 95,
    ...over,
  });
}

/** beachfront-dentistry as measured 2026-09-29: maintained, a repo, no Netlify ID,
 *  and therefore never deploy-checked. */
function beachfrontShape(over: Partial<WebsiteRow> = {}): WebsiteRow {
  return healthy({
    id: "recBEACH",
    name: "Beachfront Dentistry",
    url: "https://beachfront.example.com",
    netlifyId: null,
    deployCheckedAt: null,
    ...over,
  });
}

describe("assignTier — roster identity a sweep needs (#889)", () => {
  it("KNOWN-GOOD: a maintained site with a Git repo and a Netlify ID raises nothing", () => {
    const r = assignTier(healthy(), [], NOW);
    expect(r.tier).toBe("healthy");
    expect(r.watchReasons).toEqual([]);
    expect(r.watchSignals).toEqual([]);
    expect(r.acceptedReasons).toEqual([]);
  });

  it("KNOWN-BAD: Beachfront's shape (no Netlify ID) watches, names the key that mutes it, and tags the signal", () => {
    const r = assignTier(beachfrontShape(), [], NOW);
    expect(r.tier).toBe("watch");
    expect(r.watchReasons).toEqual([NETLIFY_REASON]);
    expect(r.watchAcceptKeys).toEqual(["no netlify id"]);
    expect(r.watchSignals).toEqual(["no-netlify-id"]);
  });

  it("KNOWN-BAD: 29 Navy's shape (no Git repo, no Netlify ID) watches for both, independently", () => {
    const r = assignTier(healthy({ gitRepo: null, netlifyId: null }), [], NOW);
    expect(r.tier).toBe("watch");
    expect(r.watchReasons).toEqual([REPO_REASON, NETLIFY_REASON]);
    expect(r.watchAcceptKeys).toEqual(["no git repo", "no netlify id"]);
    expect(r.watchSignals).toEqual(["no-git-repo", "no-netlify-id"]);
  });

  it("treats a whitespace-only cell as blank", () => {
    const r = assignTier(healthy({ gitRepo: "  ", netlifyId: "\t" }), [], NOW);
    expect(r.watchSignals).toEqual(["no-git-repo", "no-netlify-id"]);
  });

  it.each(["building", "launching", "hosted-only", "external", "archived"] as const)(
    "does not ask a %s site for a Git repo or a Netlify ID (no sweep owes it a measurement)",
    (status) => {
      const r = assignTier(healthy({ status, gitRepo: null, netlifyId: null }), [], NOW);
      expect(r.watchSignals).not.toContain("no-git-repo");
      expect(r.watchSignals).not.toContain("no-netlify-id");
      expect(r.watchReasons).not.toContain(REPO_REASON);
      expect(r.watchReasons).not.toContain(NETLIFY_REASON);
      expect(r.acceptedReasons).toEqual([]);
    },
  );

  it("an accepted 'no netlify id' leaves the band as a muted chip and does not mute the repo condition", () => {
    const r = assignTier(
      healthy({ gitRepo: null, netlifyId: null, acceptedWatchConditions: [" Not On Netlify "] }),
      [],
      NOW,
    );
    expect(r.tier).toBe("watch");
    expect(r.watchReasons).toEqual([REPO_REASON]);
    expect(r.acceptedReasons).toEqual([NETLIFY_REASON]);
  });

  it("an accepted 'no git repo' makes an otherwise-healthy site healthy, with the chip still visible", () => {
    const r = assignTier(
      healthy({ gitRepo: null, acceptedWatchConditions: ["no git repo"] }),
      [],
      NOW,
    );
    expect(r.tier).toBe("healthy");
    expect(r.acceptedReasons).toEqual([REPO_REASON]);
  });

  it("the key each card names to mute it is one the site editor will actually accept", () => {
    // Acceptance is only real if the operator can enter it: the editor's
    // multi-select rejects any value outside WATCH_CONDITION_OPTIONS, exactly
    // (the turnstile-unverified key is the standing example of a watch that
    // names a key the console cannot store).
    const r = assignTier(healthy({ gitRepo: null, netlifyId: null }), [], NOW);
    expect(r.watchAcceptKeys).toHaveLength(2);
    for (const key of r.watchAcceptKeys) expect(WATCH_CONDITION_OPTIONS).toContain(key);
  });

  it("the no-custom-domain accept keys ('netlify', 'on netlify', …) do NOT mute a missing Netlify ID", () => {
    const r = assignTier(
      beachfrontShape({ acceptedWatchConditions: ["netlify", "netlify.app", "on netlify"] }),
      [],
      NOW,
    );
    expect(r.tier).toBe("watch");
    expect(r.watchReasons).toEqual([NETLIFY_REASON]);
  });
});

describe("roster identity reaches the operator's surfaces (#889)", () => {
  it("the cockpit card and the Needs-you feed carry Beachfront's reason; the healthy control is absent", () => {
    const model = buildCockpitModel([healthy(), beachfrontShape()], [], {}, BASE_URL, NOW);
    const byName = new Map(model.cards.map((c) => [c.site.name, c]));
    expect(byName.get("Good Site")!.tier).toBe("healthy");
    expect(byName.get("Beachfront Dentistry")!.tier).toBe("watch");
    expect(byName.get("Beachfront Dentistry")!.watchSignals).toContain("no-netlify-id");

    const feed = buildNeedsYouFeed(model);
    expect(feed.map((f) => f.siteName)).toEqual(["Beachfront Dentistry"]);
    expect(feed[0]!.group).toBe("watch");
    expect(feed[0]!.reasons).toEqual([NETLIFY_REASON]);
  });

  it("the /s/<slug> page header (buildSiteAlarmContext) carries the same reason", () => {
    const good = buildSiteAlarmContext(healthy(), [], BASE_URL, NOW);
    expect(good.tier).toBe("healthy");
    expect(good.watchReasons).toEqual([]);

    const bad = buildSiteAlarmContext(beachfrontShape(), [], BASE_URL, NOW);
    expect(bad.tier).toBe("watch");
    expect(bad.watchReasons).toEqual([NETLIFY_REASON]);
    expect(bad.watchAcceptKeys).toEqual(["no netlify id"]);
  });
});
