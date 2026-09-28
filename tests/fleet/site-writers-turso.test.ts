import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const h = vi.hoisted(() => ({
  health: [] as Array<{ siteId: string; fields: Record<string, unknown> }>,
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
      h.health.push({ siteId, fields });
    },
    site: async () => {},
  }),
}));

import { runRenovateDispatchCommand } from "../../src/cli/commands/renovate-dispatch.js";
import {
  defaultDeps,
  writeSweepToAirtable,
  type SweepRow,
} from "../../src/cli/commands/prismic-models.js";
import { writeNextDueDates } from "../../src/cli/commands/report.js";
import type { SiteMirror } from "../../src/db/site-mirror.js";
import { makeWebsiteRow } from "../_helpers/website-row.js";

let fetchSpy: ReturnType<typeof vi.fn>;
let logged: () => string;
let warned: () => string;

beforeEach(() => {
  h.health.length = 0;
  fetchSpy = vi.fn(async (input: unknown) => {
    throw new Error(`network touched: ${String(input)}`);
  });
  vi.stubGlobal("fetch", fetchSpy);
  vi.stubEnv("TURSO_DATABASE_URL", "");
  vi.stubEnv("TURSO_AUTH_TOKEN", "");
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  logged = () => log.mock.calls.flat().join("\n");
  warned = () => warn.mock.calls.flat().join("\n");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("the renovate-dispatch auto-fix counter lands in Turso", () => {
  it("resets every counter in Turso and tallies no failure", async () => {
    vi.stubEnv("GH_TOKEN", "tok");
    const mirrored: Array<{ siteId: string; fields: Record<string, unknown> }> = [];
    const siteMirror: SiteMirror = {
      created: async () => {},
      hasRow: async () => true,
      health: async (siteId, fields) => {
        mirrored.push({ siteId, fields });
      },
      site: async () => {},
    };
    const r = await runRenovateDispatchCommand({
      fleet: true,
      roster: async () => [
        makeWebsiteRow({ id: "recA", name: "Alamo", securityAutoFixAttempts: 7 }),
        makeWebsiteRow({ id: "recB", name: "Beta", securityAutoFixAttempts: 3 }),
      ],
      siteMirror,
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(r.code).toBe(0);
    expect(r.output).toContain("AUTO_FIX_ATTEMPTS_SUMMARY written=2 failed=0");
    expect(mirrored).toEqual([
      { siteId: "recA", fields: { "Security Auto-Fix Attempts": 0 } },
      { siteId: "recB", fields: { "Security Auto-Fix Attempts": 0 } },
    ]);
  });
});

describe("the real prismic-models verdict sink lands in Turso", () => {
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

  it("lands every verdict in Turso and files none as failed", async () => {
    const sink = await defaultDeps().openVerdictSink();
    const res = await writeSweepToAirtable(
      [row("Espada"), row("Beacon", { clean: false, detail: "CHANGED  slice hero" })],
      sink.websites,
      sink.update,
      CHECKED_AT,
    );
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(res.failed).toEqual([]);
    expect(res.written.map((w) => w.siteName)).toEqual(["Espada", "Beacon"]);
    expect(h.health).toEqual([
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
});

describe("report --due's next-due write lands in site_schedule", () => {
  it("lands every moved date in site_schedule and reports no failure", async () => {
    const today = new Date("2026-08-24T09:23:00.000Z");
    const mirrored: Array<{ siteId: string; fields: Record<string, unknown>; at: string }> = [];
    await writeNextDueDates(
      [
        makeWebsiteRow({ id: "recA", name: "Acme", maintenanceFreq: "Monthly" }),
        makeWebsiteRow({ id: "recB", name: "Beta", testingFreq: "Monthly" }),
      ],
      [],
      today,
      async (siteId, fields, at) => {
        mirrored.push({ siteId, fields, at });
        return true;
      },
    );
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(mirrored).toEqual([
      {
        siteId: "recA",
        fields: { "Next maintenance at": "2026-08-24", "Next testing at": null },
        at: today.toISOString(),
      },
      {
        siteId: "recB",
        fields: { "Next maintenance at": null, "Next testing at": "2026-08-24" },
        at: today.toISOString(),
      },
    ]);
    expect(logged()).toContain(
      "NEXT_DUE_WRITE wrote=2 skipped=0 failed=0 mirrored=2 mirror_failed=0 mirror_missed=0",
    );
    expect(warned()).toBe("");
  });
});
