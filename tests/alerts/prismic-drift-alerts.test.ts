import { describe, it, expect } from "vitest";
import { collectPrismicDriftAlerts } from "../../src/alerts/digest-collectors.js";
import type { WebsiteRow } from "../../src/reports/airtable/websites.js";
import { makeWebsiteRow } from "../_helpers/website-row.js";

const NOW = new Date("2026-08-12T09:00:00.000Z");
const DASH = "https://dash";

/** A drifting, freshly-swept, in-scope site. `makeWebsiteRow` supplies the real
 *  defaults (`status: "maintenance"`, a non-empty `url`) — both load-bearing: the
 *  staleness escalation only fires for sites the nightly sweep is EXPECTED to
 *  cover, and a partial cast would have silently taken every site out of scope. */
const site = (over: Partial<WebsiteRow> = {}): WebsiteRow =>
  makeWebsiteRow({
    id: "rec1",
    name: "Espada",
    prismicModels: "fail",
    prismicModelsCheckedAt: "2026-08-12T06:00:00.000Z",
    prismicModelsDrift: "CHANGED  slice hero",
    ...over,
  });

/** ISO timestamp `days` before NOW. */
const daysAgo = (days: number): string =>
  new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000).toISOString();

describe("collectPrismicDriftAlerts — fail (the repo and Prismic diverge)", () => {
  it("raises one warning item for a drifting site", () => {
    const items = collectPrismicDriftAlerts([site()], DASH, NOW);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      key: "prismic-drift:rec1",
      kind: "prismic-drift",
      siteName: "Espada",
      severity: "warning",
      metric: 1,
    });
    expect(items[0]!.url).toContain(DASH);
  });

  it("puts the first line of the drift detail in the title so the feed is actionable", () => {
    const items = collectPrismicDriftAlerts(
      [site({ prismicModelsDrift: "NEW  slice hero  (src/lib/slices/Hero/model.json)\nmore" })],
      DASH,
      NOW,
    );
    expect(items[0]!.title).toContain("NEW  slice hero");
  });

  it("falls back to a generic title when there is no detail", () => {
    const items = collectPrismicDriftAlerts([site({ prismicModelsDrift: null })], DASH, NOW);
    expect(items[0]!.title).toMatch(/diverge/i);
  });

  it("keeps a verdict whose timestamp is unparseable — never silently drop a real failure", () => {
    const items = collectPrismicDriftAlerts(
      [site({ prismicModelsCheckedAt: "not a date" })],
      DASH,
      NOW,
    );
    expect(items).toHaveLength(1);
    expect(items[0]!.key).toBe("prismic-drift:rec1");
  });

  it("keeps a verdict with a null timestamp", () => {
    const items = collectPrismicDriftAlerts([site({ prismicModelsCheckedAt: null })], DASH, NOW);
    expect(items).toHaveLength(1);
    expect(items[0]!.key).toBe("prismic-drift:rec1");
  });
});

describe("collectPrismicDriftAlerts — the silent states", () => {
  it("says nothing for a freshly-swept clean site", () => {
    expect(collectPrismicDriftAlerts([site({ prismicModels: "pass" })], DASH, NOW)).toEqual([]);
  });

  it("says nothing when the sweep has never run (null verdict)", () => {
    expect(collectPrismicDriftAlerts([site({ prismicModels: null })], DASH, NOW)).toEqual([]);
  });

  it("says nothing for a blank verdict however old — a non-Prismic site holds no verdict to age", () => {
    // A fresh timestamp with a blank verdict is the sweep's "checked, nothing here
    // to check". An ANCIENT one is a site that stopped being swept while holding no
    // claim at all — there is nothing to un-verify, so it must stay silent.
    expect(
      collectPrismicDriftAlerts(
        [site({ prismicModels: null, prismicModelsCheckedAt: daysAgo(400) })],
        DASH,
        NOW,
      ),
    ).toEqual([]);
  });
});

describe("collectPrismicDriftAlerts — unknown (the check RAN AND COULD NOT ANSWER)", () => {
  it("alarms, with its own wording — a dead token is not a diverging model", () => {
    const items = collectPrismicDriftAlerts(
      [
        site({
          prismicModels: "unknown",
          prismicModelsDrift: "write token rejected (403)",
        }),
      ],
      DASH,
      NOW,
    );
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      key: "prismic-unknown:rec1",
      kind: "prismic-drift",
      siteName: "Espada",
      severity: "warning",
      metric: 1,
    });
    // Sending the operator to fix a MODEL when the job is to fix a SECRET is the
    // whole reason this branch has separate copy.
    expect(items[0]!.title).toMatch(/could not run/i);
    expect(items[0]!.title).not.toMatch(/diverge/i);
    expect(items[0]!.title).toContain("write token rejected (403)");
    expect(items[0]!.url).toContain(DASH);
  });

  it("still alarms when the sweep recorded no reason", () => {
    const items = collectPrismicDriftAlerts(
      [site({ prismicModels: "unknown", prismicModelsDrift: null })],
      DASH,
      NOW,
    );
    expect(items).toHaveLength(1);
    expect(items[0]!.key).toBe("prismic-unknown:rec1");
    expect(items[0]!.title).toMatch(/could not run/i);
  });

  it("keeps an unknown with an unparseable or null timestamp", () => {
    for (const at of ["not a date", null]) {
      const items = collectPrismicDriftAlerts(
        [site({ prismicModels: "unknown", prismicModelsCheckedAt: at })],
        DASH,
        NOW,
      );
      expect(items).toHaveLength(1);
      expect(items[0]!.key).toBe("prismic-unknown:rec1");
    }
  });
});

describe("collectPrismicDriftAlerts — a verdict nobody has re-established", () => {
  it("escalates a pass nobody has refreshed for a week", () => {
    const items = collectPrismicDriftAlerts(
      [site({ prismicModels: "pass", prismicModelsCheckedAt: daysAgo(8) })],
      DASH,
      NOW,
    );
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      key: "prismic-stale:rec1",
      kind: "prismic-drift",
      siteName: "Espada",
      severity: "warning",
      metric: 1,
    });
    expect(items[0]!.title).toMatch(/has not run/i);
    expect(items[0]!.title).toContain("pass");
    expect(items[0]!.url).toContain(DASH);
  });

  it("leaves a pass alone inside the 7-day window — the asymmetry with the 3-day fail window is deliberate", () => {
    // 5 days: past the fail window, inside the pass window. Escalating here would
    // fire on a long weekend of runner flakes across the WHOLE fleet at once, which
    // is the noise that gets a real alarm muted.
    expect(
      collectPrismicDriftAlerts(
        [site({ prismicModels: "pass", prismicModelsCheckedAt: daysAgo(5) })],
        DASH,
        NOW,
      ),
    ).toEqual([]);
  });

  it("escalates a pass with no timestamp at all", () => {
    const items = collectPrismicDriftAlerts(
      [site({ prismicModels: "pass", prismicModelsCheckedAt: null })],
      DASH,
      NOW,
    );
    expect(items).toHaveLength(1);
    expect(items[0]!.key).toBe("prismic-stale:rec1");
  });

  it("escalates a pass whose timestamp is unparseable — a green claim nobody can date is not a green claim", () => {
    const items = collectPrismicDriftAlerts(
      [site({ prismicModels: "pass", prismicModelsCheckedAt: "not a date" })],
      DASH,
      NOW,
    );
    expect(items).toHaveLength(1);
    expect(items[0]!.key).toBe("prismic-stale:rec1");
  });

  // The half-a-gate defect, one level down: aging a fail out at 3 days and raising
  // NOTHING in its place is exactly "I could not read X" wearing the face of "X is
  // fine". A frozen fail/unknown converts to the staleness alarm; it never vanishes.
  it("converts a fail past its 3-day currency window into a staleness alarm, never silence", () => {
    const items = collectPrismicDriftAlerts(
      [site({ prismicModelsCheckedAt: daysAgo(7) })],
      DASH,
      NOW,
    );
    expect(items).toHaveLength(1);
    expect(items[0]!.key).toBe("prismic-stale:rec1");
    // It no longer CLAIMS current drift — that is what the 3-day window is for —
    // but it still names the verdict left frozen.
    expect(items[0]!.title).not.toMatch(/diverge/i);
    expect(items[0]!.title).toContain("fail");
  });

  it("converts a stale unknown into a staleness alarm too", () => {
    const items = collectPrismicDriftAlerts(
      [site({ prismicModels: "unknown", prismicModelsCheckedAt: daysAgo(7) })],
      DASH,
      NOW,
    );
    expect(items).toHaveLength(1);
    expect(items[0]!.key).toBe("prismic-stale:rec1");
    expect(items[0]!.title).toContain("unknown");
  });
});

describe("collectPrismicDriftAlerts — only sites the sweep is expected to cover can go stale", () => {
  // The staleness item is an alarm INVENTED FROM AN ABSENCE, so it is only honest
  // where the absence is wrong. A deprecated site leaving the fleet inventory is
  // the sweep working as designed; alarming on it daily forever, in an email the
  // operator cannot ack, is how a real alarm gets muted.
  const ancientPass = { prismicModels: "pass", prismicModelsCheckedAt: daysAgo(90) } as const;

  it("says nothing for an archived site holding an ancient pass", () => {
    for (const status of ["deprecated", "legacy"] as const) {
      expect(collectPrismicDriftAlerts([site({ ...ancientPass, status })], DASH, NOW)).toEqual([]);
    }
  });

  it("says nothing for a pre-launch site — the sweep excludes it by design", () => {
    for (const status of ["launch period", "in development"] as const) {
      expect(collectPrismicDriftAlerts([site({ ...ancientPass, status })], DASH, NOW)).toEqual([]);
    }
  });

  it("says nothing for a hosting-only / out-of-fleet site", () => {
    for (const status of ["hosting", "probably not our problem", null] as const) {
      expect(collectPrismicDriftAlerts([site({ ...ancientPass, status })], DASH, NOW)).toEqual([]);
    }
  });

  it("says nothing for a maintenance site with no url — the inventory skips it", () => {
    expect(collectPrismicDriftAlerts([site({ ...ancientPass, url: "" })], DASH, NOW)).toEqual([]);
  });

  it("still reports a FRESH finding on an out-of-scope site — that verdict was actually established", () => {
    // A hand-run `prismic-models --site x --write-airtable` on a deprecated repo
    // still found real drift. The scope gate guards the invented alarm only.
    const items = collectPrismicDriftAlerts([site({ status: "deprecated" })], DASH, NOW);
    expect(items).toHaveLength(1);
    expect(items[0]!.key).toBe("prismic-drift:rec1");
  });
});

describe("collectPrismicDriftAlerts — shape", () => {
  it("emits at most one item per site (the verdict is one cell, one state at a time)", () => {
    for (const over of [
      {},
      { prismicModels: "unknown" as const },
      { prismicModels: "pass" as const, prismicModelsCheckedAt: daysAgo(30) },
      { prismicModelsCheckedAt: daysAgo(30) },
      { prismicModelsCheckedAt: null },
    ]) {
      expect(collectPrismicDriftAlerts([site(over)], DASH, NOW).length).toBeLessThanOrEqual(1);
    }
  });

  it("keys never collide across the three flavors, so a diff on one can't stand in for another", () => {
    const items = collectPrismicDriftAlerts(
      [
        site({ id: "recA", name: "A" }),
        site({ id: "recB", name: "B", prismicModels: "unknown" }),
        site({
          id: "recC",
          name: "C",
          prismicModels: "pass",
          prismicModelsCheckedAt: daysAgo(30),
        }),
      ],
      DASH,
      NOW,
    );
    expect(items.map((i) => i.key)).toEqual([
      "prismic-drift:recA",
      "prismic-unknown:recB",
      "prismic-stale:recC",
    ]);
    expect(new Set(items.map((i) => i.key)).size).toBe(3);
    expect(items.every((i) => i.kind === "prismic-drift")).toBe(true);
  });

  it("defaults `now` to wall-clock without throwing", () => {
    const items = collectPrismicDriftAlerts(
      [site({ prismicModelsCheckedAt: new Date().toISOString() })],
      DASH,
    );
    expect(items).toHaveLength(1);
  });

  it("falls back to the fleet root when a site name has no slug", () => {
    const items = collectPrismicDriftAlerts([site({ name: "!!!" })], DASH, NOW);
    expect(items[0]!.url).toBe(DASH);
  });
});
