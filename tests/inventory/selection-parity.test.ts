/**
 * #646 step 4 — the Turso fleet roster selects exactly the sites the rule states.
 *
 * `status=maintained` gates every fleet sweep, so the Turso roster must select
 * EXACTLY the maintained sites that have a url. One list of logical site fixtures
 * is written into Turso the way it really receives them —
 *
 *   - the importer's mapper (`mirrorSiteInsert`, which is how every `rec…` row got
 *     into Turso), or, for a `site_<ULID>` site, `insertSiteRows` — the
 *     Turso-native creator's insert (#646 step 3) —
 *
 * then the real provider (`fromTursoDb`) is run and its site set is required to
 * match the rule statement, Site object for Site object.
 *
 * The selection RULE is one shared function (`selectFleetSites`), so what this
 * really pins is that the store hands that rule the right values for every
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
import { fromTursoDb } from "../../src/inventory/turso.js";
import { CANONICAL_STATUSES } from "../../src/fleet/site-status.js";
import { mintSiteId } from "../../src/fleet/site-id.js";
import type { Site } from "../../src/types.js";
import { siteSlug } from "../../src/fleet/site-row.js";
import type { RawRow } from "../_helpers/raw-rows.js";

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
 *  canonicalizeStatus, so it must be excluded, not coerced). */
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
  // since launched. The launched one MUST be swept and the building one must not be.
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

function importedRecord(f: Fixture): RawRow {
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
    await mirrorSiteInsert(db, importedRecord(f), NOW);
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

function byId(sites: Site[]): Site[] {
  return [...sites].sort((a, b) => String(a.meta?.siteId).localeCompare(String(b.meta?.siteId)));
}

function expectedSite(f: Fixture): Site {
  const slug = siteSlug(f.name);
  return {
    path: `${WORKDIR}/${slug}`,
    name: slug,
    meta: { siteId: f.id, displayName: f.name },
    // Always present on a roster site: null says the row was read and has no
    // GA4 property, which a bare checkout (no row read) must not claim.
    ga4PropertyId: null,
    ...(f.url !== undefined && /^https?:/.test(f.url) ? { deployedUrl: f.url } : {}),
    ...(f.gitRepo !== undefined ? { gitRepo: f.gitRepo } : {}),
    ...(f.netlifyId !== undefined ? { netlifyId: f.netlifyId } : {}),
  };
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

async function tursoRoster(rows: Fixture[]): Promise<Site[]> {
  const seed = await openDb({ url: dbFile });
  try {
    for (const f of rows) await seedTurso(seed, f);
  } finally {
    await seed.destroy();
  }
  return byId(await fromTursoDb(() => openDb({ url: dbFile }), { workdir: WORKDIR })());
}

describe("fleet selection: the Turso roster selects maintained sites with a url", () => {
  it("selects the rule's site set across every status × url shape, rec and site_ ids alike", async () => {
    const rows = fixtures();
    const turso = await tursoRoster(rows);

    const expected = rows.filter((f) => f.status === "maintained" && f.url !== undefined);
    expect(turso).toEqual(byId(expected.map(expectedSite)));
    expect(turso.length).toBeGreaterThan(0);
    expect(turso.length).toBeLessThan(rows.length);
  });

  it("sweeps a launched site_<ULID> site, with its deployed url and git repo, and never a building one", async () => {
    const rows = fixtures();
    const turso = await tursoRoster(rows);
    const launched = rows.find((f) => f.name === "Native Launched")!;
    const building = rows.find((f) => f.name === "Native Building")!;
    expect(turso).toContainEqual({
      path: `${WORKDIR}/native-launched`,
      name: "native-launched",
      meta: { siteId: launched.id, displayName: "Native Launched" },
      ga4PropertyId: null,
      deployedUrl: "https://native-launched.example.com",
      gitRepo: "reddoorla/native-launched",
    });
    expect(turso.map((s) => s.meta?.siteId)).not.toContain(building.id);
  });

  it("keeps a non-http url site in the roster but drops its deployed-audit target", async () => {
    const rows = fixtures();
    const turso = await tursoRoster(rows);
    const evil = turso.filter((s) => s.deployedUrl === undefined);
    expect(evil.length).toBeGreaterThan(0);
    expect(evil.map((s) => s.meta?.siteId)).toEqual(
      rows
        .filter((f) => f.status === "maintained" && f.url === "file:///etc/passwd")
        .map((f) => f.id)
        .sort(),
    );
  });

  it("an empty-slug Name: Turso cannot hold it at all, so the roster never sweeps it", async () => {
    const bad: Fixture = {
      id: "recEmptySlug",
      name: "!!!",
      status: "maintained",
      url: "https://empty.example.com",
      via: "import",
    };
    const seed = await openDb({ url: dbFile });
    try {
      await expect(mirrorSiteInsert(seed, importedRecord(bad), NOW)).rejects.toThrow(/empty slug/);
    } finally {
      await seed.destroy();
    }
    expect(await fromTursoDb(() => openDb({ url: dbFile }), { workdir: WORKDIR })()).toEqual([]);
  });
});
