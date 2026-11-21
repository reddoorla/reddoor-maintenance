import { describe, it, expect } from "vitest";
import type { FleetEvent, FleetEventType } from "../../src/db/fleet-events.js";
import {
  DEPLOY_AFTER_MERGE_MS,
  RECENT_EVENTS_LIMIT,
  deploysToShow,
} from "../../src/dashboard/snapshot-views.js";

/**
 * P1-87 PR 9: a site's deploy is listed in the overview's feed only when no dependency
 * update merged on that site in the hour before it, because the merge's line already
 * says the site changed.
 */
const DEPLOY = "2026-11-17T12:00:00.000Z";
const at = (ms: number): string => new Date(Date.parse(DEPLOY) + ms).toISOString();

function ev(
  id: string,
  ts: string,
  type: FleetEventType = "site_deployed",
  siteId: string | null = "recA",
): FleetEvent {
  return { id, ts, type, siteId, siteName: "Acme", summary: id, data: null };
}

describe("deploysToShow — a deploy after a merge on the same site is left out", () => {
  it("hides a deploy with a dependency merge 30 minutes before on the same site", () => {
    const rows = [ev("deploy", DEPLOY), ev("merge", at(-30 * 60_000), "pr_automerged")];
    expect(deploysToShow(rows).map((e) => e.id)).toEqual([]);
  });

  it("keeps the deploy when the merge is on another site", () => {
    const rows = [ev("deploy", DEPLOY), ev("merge", at(-30 * 60_000), "pr_automerged", "recB")];
    expect(deploysToShow(rows).map((e) => e.id)).toEqual(["deploy"]);
  });

  it("keeps the deploy when the merge is 61 minutes before", () => {
    const rows = [ev("deploy", DEPLOY), ev("merge", at(-61 * 60_000), "pr_automerged")];
    expect(deploysToShow(rows).map((e) => e.id)).toEqual(["deploy"]);
  });

  it("hides the deploy when the merge is exactly 60 minutes before (inclusive)", () => {
    expect(DEPLOY_AFTER_MERGE_MS).toBe(3_600_000);
    const rows = [ev("deploy", DEPLOY), ev("merge", at(-60 * 60_000), "pr_automerged")];
    expect(deploysToShow(rows).map((e) => e.id)).toEqual([]);
  });

  // #2195: the window's upper end is inclusive too.
  it("hides the deploy when the merge has exactly the deploy's time (inclusive)", () => {
    const rows = [ev("deploy", DEPLOY), ev("merge", DEPLOY, "pr_automerged")];
    expect(deploysToShow(rows).map((e) => e.id)).toEqual([]);
  });

  it("keeps the deploy when the merge is 1 ms after it", () => {
    const rows = [ev("deploy", DEPLOY), ev("merge", at(1), "pr_automerged")];
    expect(deploysToShow(rows).map((e) => e.id)).toEqual(["deploy"]);
  });

  it("keeps the deploy when the merge is after it", () => {
    const rows = [ev("deploy", DEPLOY), ev("merge", at(5 * 60_000), "pr_automerged")];
    expect(deploysToShow(rows).map((e) => e.id)).toEqual(["deploy"]);
  });

  it("keeps a deploy with no site, whatever merges there are", () => {
    const rows = [
      ev("deploy", DEPLOY, "site_deployed", null),
      ev("merge", at(-10 * 60_000), "pr_automerged", null),
    ];
    expect(deploysToShow(rows).map((e) => e.id)).toEqual(["deploy"]);
  });

  it("never returns an event of another type", () => {
    const rows = [
      ev("merge", DEPLOY, "pr_automerged"),
      ev("sync", DEPLOY, "prismic_sync_opened"),
      ev("sweep", DEPLOY, "fleet_swept", null),
      ev("deploy", at(-120 * 60_000)),
    ];
    expect(deploysToShow(rows).map((e) => e.id)).toEqual(["deploy"]);
  });

  it("returns the kept deploys newest first, at most RECENT_EVENTS_LIMIT", () => {
    const deploys = Array.from({ length: RECENT_EVENTS_LIMIT + 5 }, (_, i) =>
      ev(`d${i}`, at(i * 60_000), "site_deployed", `site${i}`),
    );
    // Shuffled input, so the order comes from the function, not the caller.
    const shuffled = [...deploys].sort((a, b) => a.id.localeCompare(b.id));
    const out = deploysToShow(shuffled);
    expect(out).toHaveLength(RECENT_EVENTS_LIMIT);
    expect(out[0]!.id).toBe(`d${RECENT_EVENTS_LIMIT + 4}`);
    expect(out.map((e) => e.ts)).toEqual([...out.map((e) => e.ts)].sort().reverse());
  });
});

// #2193: the snapshot reads merges from an hour before the week, and lists only the
// week's deploys. A merge before `sinceIso` still hides the deploy after it.
describe("deploysToShow — sinceIso lists the window's deploys, and earlier merges still hide", () => {
  const SINCE = DEPLOY;

  it("hides a deploy just inside the window when its merge is just before it", () => {
    const rows = [ev("deploy", at(10 * 60_000)), ev("merge", at(-20 * 60_000), "pr_automerged")];
    expect(deploysToShow(rows, SINCE).map((e) => e.id)).toEqual([]);
  });

  it("lists a deploy exactly at sinceIso, and none 1 ms before it", () => {
    const rows = [
      ev("at", SINCE, "site_deployed", "recA"),
      ev("before", at(-1), "site_deployed", "recB"),
    ];
    expect(deploysToShow(rows, SINCE).map((e) => e.id)).toEqual(["at"]);
  });

  it("without sinceIso, lists every deploy given, as before", () => {
    const rows = [ev("old", at(-10 * 86_400_000)), ev("new", DEPLOY, "site_deployed", "recB")];
    expect(deploysToShow(rows).map((e) => e.id)).toEqual(["new", "old"]);
  });
});
