/**
 * #646 step 3: the Turso-native `ensure-site`. Driven against a REAL migrated
 * libSQL database in a temp `file:` — never `:memory:` (a libSQL transaction on
 * an in-memory client hands the connection away, and the next statement opens a
 * fresh EMPTY database; the atomic create below is a transaction) and never a
 * `TURSO_*` url from the environment.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, type Db } from "../../src/db/client.js";
import { makeSiteStore } from "../../src/db/site-create.js";
import { ensureSite } from "../../src/fleet/ensure-site.js";
import { isMintedSiteId } from "../../src/fleet/site-id.js";

let dir: string;
let db: Db;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "ensure-site-"));
  db = await openDb({ url: `file:${join(dir, "fleet.db")}` });
});

afterEach(async () => {
  await db.destroy();
  rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

async function rowsFor(id: string) {
  const site = await db.selectFrom("sites").selectAll().where("id", "=", id).execute();
  const health = await db.selectFrom("site_health").selectAll().where("site_id", "=", id).execute();
  const schedule = await db
    .selectFrom("site_schedule")
    .selectAll()
    .where("site_id", "=", id)
    .execute();
  return { site, health, schedule };
}

describe("ensureSite — create (Turso is the source of truth)", () => {
  it("(a) creates a site: a site_ id and all three Turso rows, in one go", async () => {
    const result = await ensureSite(
      { slug: "Roalson", url: "https://roalson.netlify.app", pointOfContact: "owner@roalson.com" },
      { store: makeSiteStore(db) },
    );
    expect(result.status).toBe("created");
    expect(isMintedSiteId(result.siteId)).toBe(true);

    const { site, health, schedule } = await rowsFor(result.siteId);
    expect(site).toHaveLength(1);
    expect(site[0]).toMatchObject({
      id: result.siteId,
      slug: "roalson",
      name: "roalson",
      status: "building",
      url: "https://roalson.netlify.app",
      point_of_contact: "owner@roalson.com",
      git_repo: "reddoorla/roalson",
      require_turnstile: 0,
    });
    expect(health).toHaveLength(1);
    expect(schedule).toHaveLength(1);
  });

  it("the new site reads back through the same lookup form-ingest uses", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const { getSiteBySlug } = await import("../../src/db/fleet-state.js");
    const result = await ensureSite(
      { slug: "acme-co", displayName: "Acme Co" },
      { store: makeSiteStore(db) },
    );
    const row = await getSiteBySlug(db, "acme-co");
    expect(row?.id).toBe(result.siteId);
    expect(row?.name).toBe("Acme Co");
    expect(row?.status).toBe("building");
  });

  it("(b) re-running for the same slug finds the site and never mints a second id", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const store = makeSiteStore(db);
    const mintId = vi.fn(() => "site_01ARYZ6S41TSV4RRFFQ69G5FAV");
    const first = await ensureSite({ slug: "roalson" }, { store, mintId });
    const again = await ensureSite({ slug: "roalson" }, { store, mintId });
    const third = await ensureSite({ slug: "Roalson" }, { store, mintId });
    expect(first.status).toBe("created");
    expect(again).toMatchObject({ status: "exists", siteId: first.siteId, updatedFields: [] });
    expect(third.siteId).toBe(first.siteId);
    expect(mintId).toHaveBeenCalledTimes(1);
    const count = await db.selectFrom("sites").select(db.fn.countAll().as("n")).executeTakeFirst();
    expect(Number(count?.n)).toBe(1);
  });

  it("the three rows are ATOMIC: a failure on the last insert leaves no sites row behind", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const id = "site_01ARYZ6S41TSV4RRFFQ69G5FAV";
    // An orphan schedule row under the id about to be minted makes the THIRD
    // insert fail on its primary key — after `sites` and `site_health` ran.
    await db
      .insertInto("site_schedule")
      .values({ site_id: id, next_maintenance_at: null, next_testing_at: null, computed_at: null })
      .execute();
    await expect(
      ensureSite({ slug: "roalson" }, { store: makeSiteStore(db), mintId: () => id }),
    ).rejects.toThrow();
    const { site, health } = await rowsFor(id);
    expect(site).toEqual([]);
    expect(health).toEqual([]);
  });

  it("refuses a slug collision the lookup did not see (a concurrent create)", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const real = makeSiteStore(db);
    await ensureSite(
      { slug: "roalson" },
      { store: real, mintId: () => "site_01ARYZ6S41TSV4RRFFQ69G5FAV" },
    );
    // A store whose lookup answers "absent" stands in for the race: the row landed
    // between this run's read and its insert.
    const racing = { ...real, findBySlug: async () => null };
    await expect(
      ensureSite(
        { slug: "roalson" },
        { store: racing, mintId: () => "site_01BX5ZZKBKACTAV9WEVGEMMVRZ" },
      ),
    ).rejects.toThrow(/slug 'roalson' is already taken/);
    const count = await db.selectFrom("sites").select(db.fn.countAll().as("n")).executeTakeFirst();
    expect(Number(count?.n)).toBe(1);
  });

  it("refuses a slug that does not slugify to anything usable", async () => {
    await expect(ensureSite({ slug: "!!!" }, { store: makeSiteStore(db) })).rejects.toThrow(
      /usable slug/,
    );
  });
});

describe("ensureSite — exists path (fill blanks, --name)", () => {
  async function seed() {
    vi.spyOn(console, "log").mockImplementation(() => {});
    return ensureSite(
      { slug: "acme-co", pointOfContact: "kept@client.com" },
      { store: makeSiteStore(db), mintId: () => "site_01ARYZ6S41TSV4RRFFQ69G5FAV" },
    );
  }

  it("fills ONLY blank fields and reports differing inputs as left untouched", async () => {
    const created = await seed();
    const result = await ensureSite(
      { slug: "acme-co", url: "https://acme.example.com", pointOfContact: "IGNORED@example.com" },
      { store: makeSiteStore(db) },
    );
    expect(result.updatedFields).toEqual(["url"]);
    expect(result.skippedMismatches).toEqual(["pointOfContact"]);
    const { site } = await rowsFor(created.siteId);
    expect(site[0]).toMatchObject({
      url: "https://acme.example.com",
      point_of_contact: "kept@client.com",
    });
  });

  it("--name renames: sites.name changes, sites.slug NEVER does", async () => {
    const created = await seed();
    const result = await ensureSite(
      { slug: "acme-co", displayName: "Acme  Co" },
      { store: makeSiteStore(db) },
    );
    expect(result.updatedFields).toEqual(["name"]);
    const { site } = await rowsFor(created.siteId);
    expect(site[0]).toMatchObject({ name: "Acme  Co", slug: "acme-co" });
  });

  it("--name that would change the slug is REFUSED before any write", async () => {
    const created = await seed();
    await expect(
      ensureSite({ slug: "acme-co", displayName: "Acme Company" }, { store: makeSiteStore(db) }),
    ).rejects.toThrow(/slugifies to 'acme-company', not 'acme-co'/);
    const { site } = await rowsFor(created.siteId);
    expect(site[0]).toMatchObject({ name: "acme-co", slug: "acme-co" });
  });
});

describe("ensureSite — pre-existing rec sites (both id shapes coexist)", () => {
  const legacyRec = {
    id: "recEXIST",
    fields: { Name: "Acme Co", Status: "maintained", url: "https://acme.example.com" },
  };

  it("a rec site already in Turso keeps its rec id, and its fill lands in Turso", async () => {
    const { mirrorSiteInsert } = await import("../../src/db/fleet-state.js");
    await mirrorSiteInsert(db, legacyRec, "2026-09-17T00:00:00.000Z");
    const result = await ensureSite(
      { slug: "acme-co", pointOfContact: "owner@acme.example.com" },
      { store: makeSiteStore(db) },
    );
    expect(result).toEqual({
      status: "exists",
      siteId: "recEXIST",
      updatedFields: ["pointOfContact"],
      skippedMismatches: [],
    });
    const { site } = await rowsFor("recEXIST");
    expect(site[0]?.point_of_contact).toBe("owner@acme.example.com");
  });
});
