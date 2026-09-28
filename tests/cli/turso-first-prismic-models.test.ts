import { describe, it, expect, beforeEach, vi } from "vitest";

const h = vi.hoisted(() => ({
  log: [] as string[],
  mirrored: [] as Array<{ siteId: string; fields: Record<string, unknown> }>,
  shadowed: [] as Array<{ siteId: string; fields: Record<string, unknown> }>,
  fail: false,
  tursoFails: false,
}));

vi.mock("../../src/reports/airtable/client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/reports/airtable/client.js")>()),
  readAirtableConfig: () => ({ apiKey: "pat", baseId: "app" }),
  openBase: () => (table: string) => ({
    update: async (records: Array<{ id: string; fields: Record<string, unknown> }>) => {
      h.log.push(`airtable:${table}:${records[0]!.id}`);
      h.shadowed.push({ siteId: records[0]!.id, fields: records[0]!.fields });
      if (h.fail) {
        throw Object.assign(new Error("Airtable monthly API call quota exhausted"), {
          code: "AIRTABLE_QUOTA_EXHAUSTED",
        });
      }
      return records;
    },
  }),
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

vi.mock("../../src/db/freeze.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/db/freeze.js")>()),
  AIRTABLE_SHADOW_WRITES: true,
}));

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

describe("the real prismic-models verdict sink writes Turso before the Airtable shadow", () => {
  beforeEach(() => {
    h.log.length = 0;
    h.mirrored.length = 0;
    h.shadowed.length = 0;
    h.fail = false;
    h.tursoFails = false;
  });

  it("mirrors each verdict before its Airtable update (both succeed: known-good control)", async () => {
    const sink = await defaultDeps().openVerdictSink();
    const res = await writeSweepToAirtable(ROWS, sink.websites, sink.update, CHECKED_AT);
    expect(res.failed).toEqual([]);
    expect(res.written).toHaveLength(2);
    expect(h.log).toEqual([
      "turso:recA",
      "airtable:Websites:recA",
      "turso:recB",
      "airtable:Websites:recB",
    ]);
    expect(h.mirrored).toEqual(h.shadowed);
  });

  it("still lands every verdict in Turso when every Airtable write fails, and still files them as failed", async () => {
    h.fail = true;
    const sink = await defaultDeps().openVerdictSink();
    const res = await writeSweepToAirtable(ROWS, sink.websites, sink.update, CHECKED_AT);
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
    expect(h.mirrored).toEqual(h.shadowed);
    expect(res.written).toEqual([]);
    expect(res.failed.map((f) => f.slug)).toEqual(["espada", "beacon"]);
    expect(res.failed[0]!.error).toMatch(/quota exhausted/);
  });

  it("a Turso failure still files the row as failed, and the shadow is not written ahead of Turso", async () => {
    h.tursoFails = true;
    const sink = await defaultDeps().openVerdictSink();
    const res = await writeSweepToAirtable(ROWS, sink.websites, sink.update, CHECKED_AT);
    expect(h.log).toEqual(["turso:recA", "turso:recB"]);
    expect(res.written).toEqual([]);
    expect(res.failed.map((f) => f.error)).toEqual(["turso down", "turso down"]);
  });
});
