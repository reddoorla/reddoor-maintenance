import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runDbCommand } from "../../src/cli/commands/db.js";
import { openDb } from "../../src/db/client.js";
import { listFleetEvents } from "../../src/db/fleet-events.js";

// P1-87 PR 9 (a). `db record-backup-event --file <verify.out>` records the
// night's rehearsal as a backup_verified event. Recording never fails the backup:
// the command exits 0 whether or not it recorded.

const NOW = new Date("2026-06-25T07:00:00.000Z");
const CLEAN = "DUMP_VERIFY loaded=true tables=44 rows=12345 blob_bytes=987 hashed=44 mismatches=0";
const FAILED = "DUMP_VERIFY loaded=true tables=44 rows=12345 blob_bytes=987 hashed=44 mismatches=3";

let dir: string;
let url: string;
const savedTurso = { url: process.env.TURSO_DATABASE_URL, token: process.env.TURSO_AUTH_TOKEN };

async function verifyFile(text: string): Promise<string> {
  const file = join(dir, `verify-${Math.random().toString(36).slice(2)}.out`);
  await writeFile(file, text, "utf-8");
  return file;
}

async function rows(): Promise<string[]> {
  const db = await openDb({ url });
  try {
    const events = await listFleetEvents(db, { sinceIso: "2000-01-01T00:00:00.000Z", limit: 100 });
    return events.filter((e) => e.type === "backup_verified").map((e) => e.id);
  } finally {
    await db.destroy();
  }
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "backup-event-"));
  // A file: url, not :memory: — each in-memory client is its own database, so a
  // second run would not see the first run's row.
  url = `file:${join(dir, "fleet.db")}`;
  delete process.env.TURSO_DATABASE_URL;
  delete process.env.TURSO_AUTH_TOKEN;
});

afterEach(() => {
  if (savedTurso.url === undefined) delete process.env.TURSO_DATABASE_URL;
  else process.env.TURSO_DATABASE_URL = savedTurso.url;
  if (savedTurso.token === undefined) delete process.env.TURSO_AUTH_TOKEN;
  else process.env.TURSO_AUTH_TOKEN = savedTurso.token;
});

describe("db record-backup-event", () => {
  it("records a clean rehearsal once per night: a second run adds no row", async () => {
    const file = await verifyFile(CLEAN);
    const first = await runDbCommand("record-backup-event", { file, url }, { now: NOW });
    const second = await runDbCommand("record-backup-event", { file, url }, { now: NOW });
    expect(first.code).toBe(0);
    expect(second.code).toBe(0);
    expect(await rows()).toEqual(["backup_verified:2026-06-25"]);
  });

  it("prints one line saying it recorded", async () => {
    const r = await runDbCommand(
      "record-backup-event",
      { file: await verifyFile(CLEAN), url },
      { now: NOW },
    );
    expect(r.output.split("\n")).toHaveLength(1);
    expect(r.output).toMatch(/recorded backup_verified/);
  });

  it("records nothing for a failed rehearsal, and still exits 0", async () => {
    const r = await runDbCommand(
      "record-backup-event",
      { file: await verifyFile(FAILED), url },
      { now: NOW },
    );
    expect(r.code).toBe(0);
    expect(r.output).toMatch(/not recorded/);
    expect(await rows()).toEqual([]);
  });

  it("exits 0 with no TURSO_* in the environment, and says it did not record", async () => {
    const r = await runDbCommand(
      "record-backup-event",
      { file: await verifyFile(CLEAN) },
      { now: NOW },
    );
    expect(r.code).toBe(0);
    expect(r.output).toMatch(/not recorded/);
  });

  it("exits 0 when the database cannot be opened at all", async () => {
    const r = await runDbCommand(
      "record-backup-event",
      { file: await verifyFile(CLEAN), url: "file:/no-such-dir-for-p1-87/fleet.db" },
      { now: NOW },
    );
    expect(r.code).toBe(0);
    expect(r.output).toMatch(/not recorded/);
  });

  it("refuses without --file, as the other file-reading actions do", async () => {
    const r = await runDbCommand("record-backup-event", { url }, { now: NOW });
    expect(r.code).toBe(1);
    expect(r.output).toMatch(/--file/);
  });
});
