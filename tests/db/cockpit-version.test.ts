import { describe, it, expect, beforeEach } from "vitest";
import { createClient, type Client } from "@libsql/client";
import { runMigrations } from "../../src/db/migrate.js";
import { kyselyOverClient } from "../../src/db/client.js";
import { readCockpitVersion } from "../../src/db/cockpit-version.js";
import { DATABASE_TABLES } from "../../src/db/schema.js";

/**
 * The cockpit snapshot's change counter (migration 0048; the operator's choice,
 * workspace decisions/2026-10-21-2339-cockpit-snapshot-version-stamp.md). The
 * cockpit skips a full re-read when the counter has not moved, so a write that
 * fails to move it would leave the operator looking at old data: every write to
 * every table the snapshot reads must move it, and nothing else may be needed.
 */

/** The tables with no trigger, each for a reason. Every other table the app
 *  owns must carry all three: a new table fails here until it is decided. */
const NOT_COUNTED: Record<string, string> = {
  _migrations: "schema bookkeeping; the snapshot never reads it",
  cockpit_version: "the counter itself",
};

/** One insertable row per table, as narrow as each table's NOT NULL columns allow. */
const ROW: Record<string, string> = {
  sites: "INSERT INTO sites (id, slug, name) VALUES ('recZ', 'z', 'Zed')",
  site_health: "INSERT INTO site_health (site_id) VALUES ('recZ')",
  site_schedule: "INSERT INTO site_schedule (site_id) VALUES ('recZ')",
  reports: "INSERT INTO reports (id, site_id, report_id) VALUES ('repZ', 'recZ', 'r')",
  submissions:
    "INSERT INTO submissions (id, site_id, form_type, name, email) VALUES ('subZ', 'recZ', 'contact', 'a', 'b')",
  spam_screenouts:
    "INSERT INTO spam_screenouts (site_id, date, honeypot) VALUES ('recZ', '2026-10-21', 1)",
  fleet_events:
    "INSERT INTO fleet_events (id, ts, type, summary, created_at) VALUES ('evZ', '2026-10-21T00:00:00Z', 'pr_automerged', 's', '2026-10-21T00:00:00Z')",
  submission_deadletter:
    "INSERT INTO submission_deadletter (id, site_slug, payload, turnstile, error, received_at) VALUES ('dlZ', 'z', '{}', '{}', 'e', '2026-10-21T00:00:00Z')",
  digest_state: "INSERT INTO digest_state (id, snapshot) VALUES ('z', '{}')",
  prospect_audits:
    "INSERT INTO prospect_audits (id, token, url, created_at, status, result_json) VALUES ('paZ', 't', 'https://p/', '2026-10-21T00:00:00Z', 'complete', '{}')",
};

let client: Client;
const version = async () => readCockpitVersion(await kyselyOverClient(client));

beforeEach(async () => {
  client = createClient({ url: ":memory:" });
  await runMigrations(client);
});

describe("the cockpit change counter", () => {
  it("starts with its one row", async () => {
    const rows = await client.execute("SELECT id, n FROM cockpit_version");
    expect(rows.rows.map((r) => [Number(r.id), Number(r.n)])).toEqual([[1, 0]]);
  });

  it("every table but the named exceptions carries an insert, update and delete trigger", async () => {
    const triggers = await client.execute(
      "SELECT tbl_name, name FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'cockpit_version_%'",
    );
    const have = new Set(triggers.rows.map((r) => `${String(r.tbl_name)}:${String(r.name)}`));
    const missing: string[] = [];
    for (const table of DATABASE_TABLES) {
      if (table in NOT_COUNTED) continue;
      for (const op of ["insert", "update", "delete"]) {
        if (!have.has(`${table}:cockpit_version_${table}_${op}`)) missing.push(`${table} ${op}`);
      }
    }
    expect(missing).toEqual([]);
    // And the instrument sees one: the exceptions really have none.
    for (const table of Object.keys(NOT_COUNTED)) {
      expect([...have].filter((h) => h.startsWith(`${table}:`))).toEqual([]);
    }
  });

  for (const table of DATABASE_TABLES.filter((t) => !(t in NOT_COUNTED))) {
    it(`${table}: an insert, an update and a delete each move it; a read does not`, async () => {
      const sql = ROW[table];
      if (!sql) throw new Error(`no test row for ${table}: add one to ROW`);
      // site_health and site_schedule rows hang off a site.
      if (table !== "sites") await client.execute(ROW.sites!);
      const before = await version();
      await client.execute(sql);
      const afterInsert = await version();
      expect(afterInsert).toBeGreaterThan(before);

      await client.execute(`SELECT * FROM ${table}`);
      expect(await version()).toBe(afterInsert);

      const keyed = await client.execute(`SELECT rowid FROM ${table} LIMIT 1`);
      const rowid = Number(keyed.rows[0]?.rowid);
      const col = (await client.execute(`PRAGMA table_info(${table})`)).rows[0]?.name;
      await client.execute(
        `UPDATE ${table} SET ${String(col)} = ${String(col)} WHERE rowid = ${rowid}`,
      );
      const afterUpdate = await version();
      expect(afterUpdate).toBeGreaterThan(afterInsert);

      await client.execute(`DELETE FROM ${table} WHERE rowid = ${rowid}`);
      expect(await version()).toBeGreaterThan(afterUpdate);
    });
  }

  it("a submission's status change moves it: the write the brief's stamp could not see", async () => {
    await client.execute(ROW.sites!);
    await client.execute(ROW.submissions!);
    const before = await version();
    await client.execute("UPDATE submissions SET status = 'read' WHERE id = 'subZ'");
    expect(await version()).toBe(before + 1);
  });

  it("re-running the migrations adds no second trigger and keeps the count", async () => {
    await client.execute(ROW.sites!);
    const before = await version();
    await client.execute("DELETE FROM _migrations WHERE id = '0048_cockpit_version'");
    await runMigrations(client);
    expect(await version()).toBe(before);
    await client.execute("UPDATE sites SET name = 'Zee' WHERE id = 'recZ'");
    // One trigger per write, not two.
    expect(await version()).toBe(before + 1);
  });
});
