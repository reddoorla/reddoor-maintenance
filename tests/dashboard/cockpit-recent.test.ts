import { describe, it, expect } from "vitest";
import { buildCockpitModel } from "../../src/dashboard/fleet-cockpit.js";
import type { FleetEvent } from "../../src/db/fleet-events.js";

const events: FleetEvent[] = [
  {
    id: "pr_automerged:reddoorla/caltex#14",
    ts: "2026-06-24T09:00:00.000Z",
    type: "pr_automerged",
    siteId: "recCALTEX",
    siteName: "Caltex Landing",
    summary: "auto-merged vite→7.3.5",
    data: {
      url: "https://github.com/reddoorla/caltex/pull/14",
      repo: "reddoorla/caltex",
      number: 14,
    },
  },
  {
    id: "fleet_swept:security:2026-06-25",
    ts: "2026-06-25T07:00:00.000Z",
    type: "fleet_swept",
    siteId: null,
    siteName: null,
    summary: "security-swept 11 sites",
    data: { sweep: "security", count: 11 },
  },
];

describe("buildCockpitModel — recent lane", () => {
  it("maps events into model.recent with slug + external url", () => {
    const model = buildCockpitModel([], [], {}, "https://d.test", new Date(), [], null, events);
    expect(model.recent).toHaveLength(2);
    const pr = model.recent!.find((r) => r.type === "pr_automerged")!;
    expect(pr.slug).toBe("caltex-landing");
    expect(pr.url).toBe("https://github.com/reddoorla/caltex/pull/14");
    const sweep = model.recent!.find((r) => r.type === "fleet_swept")!;
    expect(sweep.slug).toBeNull();
    expect(sweep.url).toBeNull();
  });

  it("defaults to an empty recent array when omitted (back-compat)", () => {
    const model = buildCockpitModel([], [], {}, "https://d.test", new Date());
    expect(model.recent).toEqual([]);
  });
});
