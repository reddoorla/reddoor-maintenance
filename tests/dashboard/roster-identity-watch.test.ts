// #889. A `maintained` site whose row carries no Git repo, or no Netlify ID, is
// skipped by every sweep that needs that identity — the checkout sweeps
// (smoke / security / prismic-drift) cannot clone without `gitRepo`, and the
// `netlify-deploy` audit skips "no netlify id" — and every one of those runs
// still concludes success. The site's report then blocks on checklist items
// nothing will ever measure (29 Navy, 2026-09-17; beachfront-dentistry,
// measured 2026-09-29 with `netlify_id` and `deploy_checked_at` both NULL).
//
// These are Setup items, not attention items and, since #672 step 2, not watch
// conditions either (the operator, 2026-10-20: roster gaps leave Watch for a
// Setup band). A maintained site that is genuinely not on Netlify is a
// legitimate state, so the operator must still be able to accept it.
import { describe, it, expect } from "vitest";
import {
  assignTier,
  buildCockpitModel,
  buildNeedsYouFeed,
  buildSiteAlarmContext,
} from "../../src/dashboard/fleet-cockpit.js";
import type { Status, WebsiteRow } from "../../src/fleet/site-row.js";
import type { AttentionItem } from "../../src/alerts/attention.js";
import { WATCH_CONDITION_OPTIONS } from "../../src/dashboard/site-details.js";
import { makeWebsiteRow } from "../_helpers/website-row.js";

const NOW = new Date("2026-09-29T12:00:00Z");
const BASE_URL = "https://dash.example.com";

const REPO_REASON = "Git repo not recorded (checkout sweeps cannot clone this site)";
const NETLIFY_REASON = "Netlify ID not recorded (the deploy check cannot read this site)";
const REPO_ITEM = { signal: "no-git-repo", reason: REPO_REASON, acceptKey: "no git repo" };
const NETLIFY_ITEM = {
  signal: "no-netlify-id",
  reason: NETLIFY_REASON,
  acceptKey: "no netlify id",
};

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
    expect(r.setup).toEqual([]);
  });

  it("KNOWN-BAD: Beachfront's shape (no Netlify ID) is a Setup item naming its key; the site stays healthy", () => {
    const r = assignTier(beachfrontShape(), [], NOW);
    expect(r.tier).toBe("healthy");
    expect(r.setup).toEqual([NETLIFY_ITEM]);
    expect(r.watchReasons).toEqual([]);
    expect(r.watchSignals).toEqual([]);
  });

  it("KNOWN-BAD: 29 Navy's shape (no Git repo, no Netlify ID) carries both Setup items, independently", () => {
    const r = assignTier(healthy({ gitRepo: null, netlifyId: null }), [], NOW);
    expect(r.tier).toBe("healthy");
    expect(r.setup).toEqual([REPO_ITEM, NETLIFY_ITEM]);
    expect(r.watchReasons).toEqual([]);
  });

  it("treats a whitespace-only cell as blank", () => {
    const r = assignTier(healthy({ gitRepo: "  ", netlifyId: "\t" }), [], NOW);
    expect(r.setup.map((i) => i.signal)).toEqual(["no-git-repo", "no-netlify-id"]);
  });

  // `null` and a retired/typo'd cell are here because the rule is an ALLOW-list
  // (`=== "maintained"`): a deny-list of the other canonical statuses would admit
  // both, and neither is swept (`selectFleetSites` requires a known active status).
  it.each([
    "building",
    "launching",
    "hosted-only",
    "external",
    "archived",
    null,
    "maintenance" as Status,
  ] satisfies (Status | null)[])(
    "does not ask a %s site for a Git repo or a Netlify ID (no sweep owes it a measurement)",
    (status) => {
      const r = assignTier(healthy({ status, gitRepo: null, netlifyId: null }), [], NOW);
      expect(r.setup).toEqual([]);
      expect(r.watchSignals).not.toContain("no-git-repo");
      expect(r.watchSignals).not.toContain("no-netlify-id");
      expect(r.watchReasons).not.toContain(REPO_REASON);
      expect(r.watchReasons).not.toContain(NETLIFY_REASON);
      expect(r.acceptedReasons).toEqual([]);
    },
  );

  it("an accepted 'no netlify id' leaves Setup as a muted chip and does not accept the repo gap", () => {
    const r = assignTier(
      healthy({ gitRepo: null, netlifyId: null, acceptedWatchConditions: [" Not On Netlify "] }),
      [],
      NOW,
    );
    expect(r.tier).toBe("healthy");
    expect(r.setup).toEqual([REPO_ITEM]);
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

  it.each(["no git repo", "no-git-repo", "no repo", "git repo", " No Repo "])(
    "accepts the missing-repo condition via %j, and that alias leaves the Netlify condition alone",
    (key) => {
      const r = assignTier(
        healthy({ gitRepo: null, netlifyId: null, acceptedWatchConditions: [key] }),
        [],
        NOW,
      );
      expect(r.acceptedReasons).toEqual([REPO_REASON]);
      expect(r.setup).toEqual([NETLIFY_ITEM]);
    },
  );

  it.each(["no netlify id", "no-netlify-id", "not on netlify", "netlify id", "NETLIFY ID"])(
    "accepts the missing-Netlify-ID condition via %j, and that alias leaves the repo condition alone",
    (key) => {
      const r = assignTier(
        healthy({ gitRepo: null, netlifyId: null, acceptedWatchConditions: [key] }),
        [],
        NOW,
      );
      expect(r.acceptedReasons).toEqual([NETLIFY_REASON]);
      expect(r.setup).toEqual([REPO_ITEM]);
    },
  );

  it("on a broken site both gaps stay on Setup: the tier stays attention and no accept key moves it", () => {
    const ci: AttentionItem = {
      key: "ci:recBEACH",
      kind: "ci",
      siteName: "Beachfront Dentistry",
      title: "Default-branch CI failing",
      severity: "warning",
      metric: 1,
    };
    const r = assignTier(beachfrontShape({ gitRepo: null }), [ci], NOW);
    expect(r.tier).toBe("attention");
    expect(r.setup).toEqual([REPO_ITEM, NETLIFY_ITEM]);
    expect(r.watchSignals).toEqual([]);
    expect(r.watchReasons).toEqual([]);
    expect(r.acceptedReasons).toEqual([]);

    // An accepted gap leaves Setup, and the tier still does not move.
    const acked = assignTier(
      beachfrontShape({ gitRepo: null, acceptedWatchConditions: ["no netlify id"] }),
      [ci],
      NOW,
    );
    expect(acked.tier).toBe("attention");
    expect(acked.setup).toEqual([REPO_ITEM]);
    expect(acked.acceptedReasons).toEqual([]);
  });

  it("the key each card names to mute it is one the site editor will actually accept", () => {
    // Acceptance is only real if the operator can enter it: the editor's
    // multi-select rejects any value outside WATCH_CONDITION_OPTIONS, exactly
    // (the turnstile-unverified key is the standing example of a watch that
    // names a key the console cannot store).
    const r = assignTier(healthy({ gitRepo: null, netlifyId: null }), [], NOW);
    expect(r.setup).toHaveLength(2);
    for (const { acceptKey } of r.setup) expect(WATCH_CONDITION_OPTIONS).toContain(acceptKey);
  });

  it("the no-custom-domain accept keys ('netlify', 'on netlify', …) do NOT mute a missing Netlify ID", () => {
    const r = assignTier(
      beachfrontShape({ acceptedWatchConditions: ["netlify", "netlify.app", "on netlify"] }),
      [],
      NOW,
    );
    expect(r.setup).toEqual([NETLIFY_ITEM]);
    expect(r.acceptedReasons).toEqual([]);
  });
});

describe("roster identity reaches the operator's surfaces (#889)", () => {
  it("the cockpit card carries Beachfront's Setup item and the summary counts it; the Needs-you feed does not", () => {
    const model = buildCockpitModel([healthy(), beachfrontShape()], [], {}, BASE_URL, NOW);
    const byName = new Map(model.cards.map((c) => [c.site.name, c]));
    expect(byName.get("Good Site")!.setup).toEqual([]);
    expect(byName.get("Beachfront Dentistry")!.tier).toBe("healthy");
    expect(byName.get("Beachfront Dentistry")!.setup).toEqual([NETLIFY_ITEM]);
    expect(model.cards.filter((c) => (c.setup ?? []).length > 0)).toHaveLength(1);
    expect(model.summary.watch).toBe(0);
    expect(model.summary.healthy).toBe(2);
    expect(buildNeedsYouFeed(model)).toEqual([]);
  });

  it("the /s/<slug> page header (buildSiteAlarmContext) carries the same Setup item, apart from the verdict", () => {
    const good = buildSiteAlarmContext(healthy(), [], BASE_URL, NOW);
    expect(good.tier).toBe("healthy");
    expect(good.setup).toEqual([]);

    const bad = buildSiteAlarmContext(beachfrontShape(), [], BASE_URL, NOW);
    expect(bad.tier).toBe("healthy");
    expect(bad.watchReasons).toEqual([]);
    expect(bad.setup).toEqual([NETLIFY_ITEM]);
  });
});
