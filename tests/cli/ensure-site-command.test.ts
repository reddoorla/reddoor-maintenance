/**
 * The `ensure-site` composition root (#646 step 3). Driven end to end against a
 * temp `file:` libSQL database injected through `deps.openDb` — so no test here
 * can open a real handle even with `TURSO_*` exported — and with Airtable either
 * absent (`airtable: null`) or a recording double.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, type Db } from "../../src/db/client.js";
import { runEnsureSiteCommand } from "../../src/cli/commands/ensure-site.js";
import type { LegacyAirtableSites } from "../../src/fleet/ensure-site.js";

let dir: string;
let db: Db;
const deps = (airtable: LegacyAirtableSites | null = null) => ({
  openDb: async () => db,
  airtable: async () => airtable,
});

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "ensure-site-cmd-"));
  db = await openDb({ url: `file:${join(dir, "fleet.db")}` });
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(async () => {
  await db.destroy();
  rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("runEnsureSiteCommand", () => {
  it("rejects a missing slug (exit 2)", async () => {
    const res = await runEnsureSiteCommand(undefined, {}, deps());
    expect(res.code).toBe(2);
    expect(res.output.toLowerCase()).toContain("slug");
  });

  it("creates a Turso site with a site_ id, passing every flag through", async () => {
    const res = await runEnsureSiteCommand(
      "roalson",
      {
        name: "Roalson",
        url: "https://roalson.netlify.app",
        contact: "owner@roalson.com",
        gitRepo: "reddoorla/custom",
      },
      deps(),
    );
    expect(res.code).toBe(0);
    expect(res.output).toMatch(/^\[roalson\] created \(site_[0-9A-HJKMNP-TV-Z]{26}\)/);
    const row = await db
      .selectFrom("sites")
      .selectAll()
      .where("slug", "=", "roalson")
      .executeTakeFirst();
    expect(row).toMatchObject({
      name: "Roalson",
      url: "https://roalson.netlify.app",
      point_of_contact: "owner@roalson.com",
      git_repo: "reddoorla/custom",
    });
  });

  it("says a created site is invisible to the Airtable-enumerated batch jobs until step 4", async () => {
    const res = await runEnsureSiteCommand("roalson", { name: "Roalson" }, deps());
    expect(res.output).toContain("no Airtable record was created");
    expect(res.output).toContain("#646 step 4");
  });

  it("reports exists + which blanks were filled", async () => {
    await runEnsureSiteCommand("acme-co", {}, deps());
    const res = await runEnsureSiteCommand("acme-co", { url: "https://acme.example.com" }, deps());
    expect(res.code).toBe(0);
    expect(res.output).toContain("exists");
    expect(res.output).toContain("filled blank field(s): url");
    expect(res.output).not.toContain("no Airtable record was created");
  });

  it("tells the operator when inputs differ from existing values", async () => {
    await runEnsureSiteCommand("acme-co", { url: "https://acme.example.com" }, deps());
    const res = await runEnsureSiteCommand("acme-co", { url: "https://x.example.com" }, deps());
    expect(res.output).toContain("left untouched");
    expect(res.output).toContain("url");
  });

  it("warns that a bare-slug create leaves a machine name in client-facing copy", async () => {
    const res = await runEnsureSiteCommand("roalson", {}, deps());
    // #664: the fix it points at must be one the command can actually do.
    expect(res.output).toContain("re-run with --name");
    expect(res.output).not.toContain("re-create");
  });

  it("#664: reports a name update on the exists path as a rename, not a filled blank", async () => {
    await runEnsureSiteCommand("roalson", {}, deps());
    const res = await runEnsureSiteCommand("roalson", { name: "Roalson" }, deps());
    expect(res.output).toContain('name set to "Roalson"');
    expect(res.output).not.toContain("filled blank");
    const row = await db
      .selectFrom("sites")
      .select(["name", "slug"])
      .where("slug", "=", "roalson")
      .executeTakeFirst();
    expect(row).toEqual({ name: "Roalson", slug: "roalson" });
  });

  it("refuses a slug-changing --name as exit 1", async () => {
    await runEnsureSiteCommand("roalson", {}, deps());
    const res = await runEnsureSiteCommand("roalson", { name: "Roalson Group" }, deps());
    expect(res.code).toBe(1);
    expect(res.output).toContain("never changes the slug");
  });

  it("surfaces a store failure as exit 1", async () => {
    const res = await runEnsureSiteCommand(
      "bad",
      {},
      {
        openDb: async () => {
          throw new Error("boom");
        },
        airtable: async () => null,
      },
    );
    expect(res.code).toBe(1);
    expect(res.output).toContain("boom");
  });

  it("#645: announces a heal loudly when an Airtable-only site is adopted", async () => {
    const legacy: LegacyAirtableSites = {
      findBySlug: async () => ({ id: "recEXIST", fields: { Name: "Acme Co" } }),
      adopt: async (rec) => {
        const { mirrorSiteInsert } = await import("../../src/db/fleet-state.js");
        await mirrorSiteInsert(db, rec, "2026-09-17T00:00:00.000Z");
      },
      update: async () => {},
    };
    const res = await runEnsureSiteCommand("acme-co", {}, deps(legacy));
    expect(res.output).toContain("exists (recEXIST)");
    expect(res.output).toContain("HEALED");
  });
});
