/**
 * #646 step 4 — SELECTION PARITY between the two fleet rosters.
 *
 * `status=maintained` gates every fleet sweep, so moving `--fleet` from Airtable to
 * Turso is only safe if the Turso roster selects EXACTLY the sites the Airtable
 * roster did, for the same data. This proves it without touching production: one
 * list of logical site fixtures is written into BOTH stores the way each store
 * really receives it —
 *
 *   - Airtable: a Websites record, served by a fake base through the real
 *     `listWebsites` → `mapRow`;
 *   - Turso: the same record through the importer's own mapper
 *     (`mirrorSiteInsert`, which is how every `rec…` row got into Turso), or, for a
 *     `site_<ULID>` site, through `insertSiteRows` — the Turso-native creator's
 *     insert (#646 step 3) —
 *
 * then both real providers (`fromAirtableBase`, `fromTursoDb`) are run and their
 * site sets are required to be identical, Site object for Site object.
 *
 * The selection RULE is one shared function (`selectFleetSites`), so what this
 * really pins is that the two stores hand that rule the same values for every
 * column it reads — status (incl. blank and a typo), url (absent, http, non-http),
 * Name, Git repo, Netlify ID — and that the rule never keys on the id's shape.
 *
 * Driven against a REAL migrated libSQL database in a temp `file:`, never
 * `:memory:` and never a `TURSO_*` url from the environment.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, type Db } from "../../src/db/client.js";
import { insertSiteRows, mirrorSiteInsert } from "../../src/db/fleet-state.js";
import { fromAirtableBase } from "../../src/inventory/airtable.js";
import { fromTursoDb } from "../../src/inventory/turso.js";
import { CANONICAL_STATUSES } from "../../src/fleet/site-status.js";
import { mintSiteId } from "../../src/fleet/site-id.js";
import type { Site } from "../../src/types.js";
import { makeFakeBase, type FakeRecord } from "../reports/_helpers/fake-airtable-base.js";

const WORKDIR = "/tmp/selection-parity";
const NOW = "2026-09-17T00:00:00.000Z";

type Fixture = {
  id: string;
  name: string;
  /** undefined = blank cell / NULL column. */
  status?: string;
  url?: string;
  gitRepo?: string;
  netlifyId?: string;
  /** How the row reaches Turso: the importer's mapper (every `rec…` site) or the
   *  step-3 creator's insert (every `site_…` site). */
  via: "import" | "create";
};

/** Every canonical status, blank, and an operator typo (passed through verbatim by
 *  canonicalizeStatus, so it must be excluded by BOTH, not coerced by one). */
const STATUSES: ReadonlyArray<string | undefined> = [
  ...CANONICAL_STATUSES,
  undefined,
  "Maintained ",
];
const URLS: ReadonlyArray<string | undefined> = [
  "https://site.example.com",
  undefined,
  "file:///etc/passwd",
];

function fixtures(): Fixture[] {
  const out: Fixture[] = [];
  let n = 0;
  for (const status of STATUSES) {
    for (const url of URLS) {
      n += 1;
      out.push({
        id: `recParity${String(n).padStart(3, "0")}`,
        name: `Parity Site ${n}`,
        ...(status !== undefined ? { status } : {}),
        ...(url !== undefined ? { url } : {}),
        ...(n % 2 === 0 ? { gitRepo: `reddoorla/parity-${n}` } : {}),
        ...(n % 3 === 0 ? { netlifyId: `nlf-parity-${n}` } : {}),
        via: "import",
      });
    }
  }
  // Two Turso-native sites (#646 step 3): the creator makes them `building`; one has
  // since launched. The launched one MUST be swept — it is the site an Airtable
  // roster could never see — and the building one must not be.
  out.push({
    id: mintSiteId(Date.parse(NOW)),
    name: "Native Launched",
    status: "maintained",
    url: "https://native-launched.example.com",
    gitRepo: "reddoorla/native-launched",
    via: "create",
  });
  out.push({
    id: mintSiteId(Date.parse(NOW) + 1),
    name: "Native Building",
    status: "building",
    url: "https://native-building.example.com",
    via: "create",
  });
  return out;
}

function airtableRecord(f: Fixture): FakeRecord {
  return {
    id: f.id,
    fields: {
      Name: f.name,
      ...(f.status !== undefined ? { Status: f.status } : {}),
      ...(f.url !== undefined ? { url: f.url } : {}),
      ...(f.gitRepo !== undefined ? { "Git repo": f.gitRepo } : {}),
      ...(f.netlifyId !== undefined ? { "Netlify ID": f.netlifyId } : {}),
    },
  };
}

async function seedTurso(db: Db, f: Fixture): Promise<void> {
  if (f.via === "import") {
    await mirrorSiteInsert(db, airtableRecord(f), NOW);
    return;
  }
  // The creator's own insert. It carries no Netlify ID column (an operator sets it
  // later), so a `create` fixture must not declare one — asserted, not assumed.
  expect(f.netlifyId).toBeUndefined();
  await insertSiteRows(
    db,
    {
      id: f.id,
      slug: f.name.toLowerCase().replace(/\s+/g, "-"),
      name: f.name,
      status: f.status ?? "",
      url: f.url ?? null,
      pointOfContact: null,
      gitRepo: f.gitRepo ?? null,
    },
    NOW,
  );
}

/** Order-free comparison: Airtable returns table order, Turso name order, and no
 *  sweep is order-sensitive. The ids are all distinct, so sorting by them is total. */
function byId(sites: Site[]): Site[] {
  return [...sites].sort((a, b) => String(a.meta?.siteId).localeCompare(String(b.meta?.siteId)));
}

/** `fromAirtableBase` additionally carries the legacy `meta.airtableRowId` key; it
 *  is the one permitted difference, and it must equal `siteId` where present. */
function withoutLegacyMeta(sites: Site[]): Site[] {
  return sites.map((s) => {
    const { airtableRowId, ...meta } = s.meta ?? {};
    expect(airtableRowId).toBe(meta.siteId);
    return { ...s, meta };
  });
}

let dir: string;
let dbFile: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "selection-parity-"));
  dbFile = `file:${join(dir, "fleet.db")}`;
  // The providers warn (correctly) on non-http urls. Keep the matrix output quiet.
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

async function bothRosters(rows: Fixture[]): Promise<{ airtable: Site[]; turso: Site[] }> {
  const seed = await openDb({ url: dbFile });
  try {
    for (const f of rows) await seedTurso(seed, f);
  } finally {
    await seed.destroy();
  }
  const base = makeFakeBase({ Websites: rows.map(airtableRecord) });
  const airtable = await fromAirtableBase(base, { workdir: WORKDIR })();
  const turso = await fromTursoDb(() => openDb({ url: dbFile }), { workdir: WORKDIR })();
  return { airtable: byId(withoutLegacyMeta(airtable)), turso: byId(turso) };
}

describe("fleet selection parity: Airtable roster ≡ Turso roster for the same rows", () => {
  it("selects the identical site set across every status × url shape, rec and site_ ids alike", async () => {
    const rows = fixtures();
    const { airtable, turso } = await bothRosters(rows);

    expect(turso).toEqual(airtable);

    // Guard the matrix itself: an equality between two EMPTY lists would pass with
    // both filters deleted. The expected membership is spelled out from the rule
    // statement (maintained + has a url), independently of either implementation.
    const expected = rows
      .filter((f) => f.status === "maintained" && f.url !== undefined)
      .map((f) => f.id)
      .sort();
    expect(turso.map((s) => s.meta?.siteId).sort()).toEqual(expected);
    // Both sides of every axis were exercised: something selected, something not.
    expect(turso.length).toBeGreaterThan(0);
    expect(turso.length).toBeLessThan(rows.length);
  });

  it("sweeps a launched site_<ULID> site, with its deployed url and git repo, and never a building one", async () => {
    const rows = fixtures();
    const { turso } = await bothRosters(rows);
    const launched = rows.find((f) => f.name === "Native Launched")!;
    const building = rows.find((f) => f.name === "Native Building")!;
    expect(turso).toContainEqual({
      path: `${WORKDIR}/native-launched`,
      name: "native-launched",
      meta: { siteId: launched.id, displayName: "Native Launched" },
      deployedUrl: "https://native-launched.example.com",
      gitRepo: "reddoorla/native-launched",
    });
    expect(turso.map((s) => s.meta?.siteId)).not.toContain(building.id);
  });

  it("keeps a non-http url site in both rosters but drops its deployed-audit target in both", async () => {
    const { airtable, turso } = await bothRosters(fixtures());
    const evil = turso.filter((s) => s.deployedUrl === undefined);
    expect(evil.length).toBeGreaterThan(0);
    expect(evil).toEqual(airtable.filter((s) => s.deployedUrl === undefined));
  });

  it("an empty-slug Name: Airtable skips the row, and Turso cannot hold it at all — so neither sweeps it", async () => {
    const bad: Fixture = {
      id: "recEmptySlug",
      name: "!!!",
      status: "maintained",
      url: "https://empty.example.com",
      via: "import",
    };
    const seed = await openDb({ url: dbFile });
    try {
      await expect(mirrorSiteInsert(seed, airtableRecord(bad), NOW)).rejects.toThrow(/empty slug/);
    } finally {
      await seed.destroy();
    }
    const base = makeFakeBase({ Websites: [airtableRecord(bad)] });
    expect(await fromAirtableBase(base, { workdir: WORKDIR })()).toEqual([]);
    expect(await fromTursoDb(() => openDb({ url: dbFile }), { workdir: WORKDIR })()).toEqual([]);
  });
});
