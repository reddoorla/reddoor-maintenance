import { describe, it, expect, beforeEach, vi } from "vitest";

const h = vi.hoisted(() => ({
  log: [] as string[],
  mirrored: [] as Array<{ siteId: string; fields: Record<string, unknown> }>,
  tursoFails: false,
}));

vi.mock("../../src/fleet/roster.js", () => ({
  readFleetRoster: async () => [
    { id: "recA", name: "Espada" },
    { id: "recB", name: "Beacon" },
  ],
}));

vi.mock("../../src/db/site-mirror.js", () => ({
  makeSiteMirror: async () => ({
    created: async () => {},
    hasRow: async () => true,
    health: async (siteId: string, fields: Record<string, unknown>) => {
      h.log.push(`turso:${siteId}`);
      if (h.tursoFails) throw new Error("turso down");
      h.mirrored.push({ siteId, fields });
    },
    site: async () => {},
  }),
}));

import {
  defaultDeps,
  writeSweepToAirtable,
  type SweepRow,
} from "../../src/cli/commands/prismic-models.js";

const CHECKED_AT = "2026-09-28T06:00:00.000Z";

const row = (site: string, over: Partial<SweepRow> = {}): SweepRow => ({
  site,
  repositoryName: site.toLowerCase(),
  commit: { resolved: "0123456789abcdef0123456789abcdef01234567" },
  status: "checked",
  clean: true,
  detail: "3 model(s) match Prismic — nothing to push.",
  ...over,
});

const ROWS = [row("Espada"), row("Beacon", { clean: false, detail: "CHANGED  slice hero" })];

describe("the real prismic-models verdict sink writes each verdict into Turso", () => {
  beforeEach(() => {
    h.log.length = 0;
    h.mirrored.length = 0;
    h.tursoFails = false;
  });

  it("lands every verdict as its exact FieldSet (known-good control)", async () => {
    const sink = await defaultDeps().openVerdictSink();
    const res = await writeSweepToAirtable(ROWS, sink.websites, sink.update, CHECKED_AT);
    expect(res.failed).toEqual([]);
    expect(res.written).toHaveLength(2);
    expect(h.mirrored).toEqual([
      {
        siteId: "recA",
        fields: {
          "Prismic Models": "pass",
          "Prismic Models Checked At": CHECKED_AT,
          "Prismic Models Drift": null,
        },
      },
      {
        siteId: "recB",
        fields: {
          "Prismic Models": "fail",
          "Prismic Models Checked At": CHECKED_AT,
          "Prismic Models Drift": "CHANGED  slice hero",
        },
      },
    ]);
  });

  it("a Turso failure files every row as failed, and every row is still attempted", async () => {
    h.tursoFails = true;
    const sink = await defaultDeps().openVerdictSink();
    const res = await writeSweepToAirtable(ROWS, sink.websites, sink.update, CHECKED_AT);
    expect(h.log).toEqual(["turso:recA", "turso:recB"]);
    expect(res.written).toEqual([]);
    expect(res.failed.map((f) => f.slug)).toEqual(["espada", "beacon"]);
    expect(res.failed.map((f) => f.error)).toEqual(["turso down", "turso down"]);
  });
});
