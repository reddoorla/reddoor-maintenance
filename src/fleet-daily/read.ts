/**
 * P1-78a: the Turso half of the nightly `fleet_daily` writer. Nightly only, never
 * on a request path, so the all-time counts here may scan their tables (the
 * EXPLAIN gate covers `src/db/`, the request path's modules). The overview reads
 * the row this writes, not these queries.
 */
import { sql } from "kysely";
import type { Db } from "../db/client.js";
import type { FleetDailyCounts, Measured } from "./types.js";
import type { DepsReading, StoredRow } from "./core.js";

const failed = (what: string, e: unknown): { value: null; reason: string } => ({
  value: null,
  reason: `${what}: ${e instanceof Error ? e.message : String(e)}`.slice(0, 300),
});

/** Read one block; a failure is null with its reason, never a thrown night. */
export async function measure<T>(what: string, read: () => Promise<T>): Promise<Measured<T>> {
  try {
    return { value: await read() };
  } catch (e) {
    return failed(what, e);
  }
}

/** The newest rows, newest first: enough for a previous row and a merge target. */
export async function readRecentRows(db: Db, limit = 7): Promise<StoredRow[]> {
  const rows = await db
    .selectFrom("fleet_daily")
    .select(["night", "counts", "written_at"])
    .orderBy("night", "desc")
    .limit(limit)
    .execute();
  return rows.map((r) => ({
    night: r.night,
    counts: JSON.parse(r.counts) as FleetDailyCounts,
    writtenAt: r.written_at,
  }));
}

/** Insert the night, or replace it: a re-run of the same night overwrites. */
export async function upsertRow(db: Db, row: StoredRow): Promise<void> {
  const values = {
    night: row.night,
    counts: JSON.stringify(row.counts),
    written_at: row.writtenAt,
  };
  await db
    .insertInto("fleet_daily")
    .values(values)
    .onConflict((oc) => oc.column("night").doUpdateSet(values))
    .execute();
}

/** Submissions by status, all time, and how many the client was told about. */
export async function readLeads(db: Db): Promise<NonNullable<FleetDailyCounts["leads"]["value"]>> {
  const rows = await db
    .selectFrom("submissions")
    .select(["status", sql<number>`count(*)`.as("n")])
    .groupBy("status")
    .execute();
  const by = (s: string): number => Number(rows.find((r) => r.status === s)?.n ?? 0);
  const notified = await db
    .selectFrom("submissions")
    .select(sql<number>`count(*)`.as("n"))
    .where("status", "in", ["new", "read", "archived"])
    .where("notify_status", "=", "sent")
    .executeTakeFirstOrThrow();
  return {
    new: by("new"),
    read: by("read"),
    archived: by("archived"),
    spamAuto: by("spam_auto"),
    spam: by("spam"),
    notified: Number(notified.n),
  };
}

/** Screen-outs stopped before storage: `honeypot` and `too_fast` only. The legacy
 *  `marked_spam` column is not read (src/db/screenouts.ts no longer counts it). */
export async function readScreenouts(
  db: Db,
): Promise<NonNullable<FleetDailyCounts["screenouts"]["value"]>> {
  const r = await db
    .selectFrom("spam_screenouts")
    .select([
      sql<number>`coalesce(sum(honeypot), 0)`.as("honeypot"),
      sql<number>`coalesce(sum(too_fast), 0)`.as("too_fast"),
    ])
    .executeTakeFirstOrThrow();
  return { honeypot: Number(r.honeypot), tooFast: Number(r.too_fast) };
}

/** Reports sent, all time, less the August `test send via Claude` rows. A row
 *  with no `approved_by` is a real send (NOT LIKE alone would drop it as NULL). */
export async function readReportsSent(db: Db): Promise<number> {
  const r = await db
    .selectFrom("reports")
    .select(sql<number>`count(*)`.as("n"))
    .where("sent_at", "is not", null)
    .where((eb) =>
      eb.or([eb("approved_by", "is", null), eb("approved_by", "not like", "%test send%")]),
    )
    .executeTakeFirstOrThrow();
  return Number(r.n);
}

/** `fleet_events` recorded after `sinceIso` (or all it still holds), by type. */
export async function readEventsSince(
  db: Db,
  sinceIso: string | null,
): Promise<Record<string, number>> {
  let q = db.selectFrom("fleet_events").select(["type", sql<number>`count(*)`.as("n")]);
  if (sinceIso !== null) q = q.where("created_at", ">", sinceIso);
  const rows = await q.groupBy("type").execute();
  return Object.fromEntries(rows.map((r) => [r.type, Number(r.n)]));
}

/** Each maintained site's stored package list and its stamp. */
export async function readDepsReadings(db: Db): Promise<DepsReading[]> {
  const rows = await db
    .selectFrom("sites")
    .leftJoin("site_health", "site_health.site_id", "sites.id")
    .select([
      "sites.id as id",
      "sites.name as name",
      "site_health.deps_behind_packages as packages",
      "site_health.deps_behind_packages_at as at",
    ])
    .where("sites.status", "=", "maintained")
    .orderBy("sites.id")
    .execute();
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    packages: r.packages ?? null,
    at: r.at ?? null,
  }));
}

/** The site_health stamps a nightly step writes. */
export const COVERAGE_STAMPS = [
  "security_audit_at",
  "lighthouse_at",
  "domain_checked_at",
  "browser_checked_at",
  "deploy_checked_at",
  "function_health_checked_at",
  "url_checked_at",
  "last_smoke_at",
  "form_e2e_checked_at",
  "prismic_models_checked_at",
  "deps_behind_packages_at",
] as const;

/** Per stamp column: how many sites it stamped at or after `sinceIso`. */
export async function readCoverage(db: Db, sinceIso: string): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const col of COVERAGE_STAMPS) {
    const r = await db
      .selectFrom("site_health")
      .select(sql<number>`count(*)`.as("n"))
      .where(col, ">=", sinceIso)
      .executeTakeFirstOrThrow();
    out[col] = Number(r.n);
  }
  return out;
}
