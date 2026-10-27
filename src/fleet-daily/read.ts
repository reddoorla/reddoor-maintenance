/**
 * P1-78a: the Turso half of the nightly `fleet_daily` writer. Nightly only, never
 * on a request path, so the all-time counts here may scan their tables (the
 * EXPLAIN gate covers `src/db/`, the request path's modules). The overview reads
 * the row this writes, not these queries. The one exception is `readLatestDeps`,
 * which the cockpit calls: a week of rows by primary key, newest first.
 */
import { sql } from "kysely";
import type { Db } from "../db/client.js";
import type { FleetDailyCounts, Measured } from "./types.js";
import type { DepsReading, StoredRow } from "./core.js";
import type { LatestDeps } from "../alerts/production-signals.js";

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

/** The dependency readings for the deps alarm (P1-78c): the newest row that holds one,
 *  aged to the newest night. A night whose deps measure failed (`value: null`) carries the
 *  run, as the writer does (`runningTotal`), rather than dropping every deps item for a
 *  night and re-dating it the next (review round 2); each site's own `at` still gates
 *  staleness. A week of rows by primary key, so it stays cheap on the request path. Null
 *  before the first reading. */
export async function readLatestDeps(db: Db): Promise<LatestDeps | null> {
  const rows = await readRecentRows(db, 7);
  const withReading = rows.find((r) => r.counts.deps?.value != null);
  const deps = withReading?.counts.deps?.value;
  return deps ? { night: rows[0]!.night, sites: deps.sites } : null;
}

/** P1-78g: one night as the overview reads it: the row without its per-site package
 *  lists (the deps alarm reads those through `readLatestDeps`), so a month of nights
 *  costs the snapshot about 1.5 KB each instead of about 7 KB. */
export type OverviewNight = {
  night: string;
  counts: Omit<FleetDailyCounts, "deps"> & { deps: Measured<{ behind: number }> };
};

/** How many nights the overview reads: 30 for its windows, and the one before them
 *  that their first delta is taken from. */
export const OVERVIEW_NIGHTS = 31;

/** The overview's nights, newest first: `OVERVIEW_NIGHTS` rows by primary key, so it
 *  stays cheap on the request path, as `readLatestDeps` does. */
export async function readOverviewNights(db: Db): Promise<OverviewNight[]> {
  const rows = await readRecentRows(db, OVERVIEW_NIGHTS);
  return rows.map(({ night, counts }) => {
    const { deps, ...rest } = counts;
    return {
      night,
      counts: {
        ...rest,
        deps: deps.value === null ? deps : { value: { behind: deps.value.behind } },
      },
    };
  });
}

/** One night's row, or null. */
export async function readRow(db: Db, night: string): Promise<StoredRow | null> {
  const r = await db
    .selectFrom("fleet_daily")
    .select(["night", "counts", "written_at"])
    .where("night", "=", night)
    .executeTakeFirst();
  return r
    ? { night: r.night, counts: JSON.parse(r.counts) as FleetDailyCounts, writtenAt: r.written_at }
    : null;
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

/** `fleet_events` recorded after `sinceIso` (or all it still holds) and no later
 *  than `untilIso`, the row's own `written_at`, so the next night's window starts
 *  exactly where this one ended and nothing is counted twice. */
export async function readEventsSince(
  db: Db,
  sinceIso: string | null,
  untilIso: string,
): Promise<Record<string, number>> {
  let q = db
    .selectFrom("fleet_events")
    .select(["type", sql<number>`count(*)`.as("n")])
    .where("created_at", "<=", untilIso);
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

/** Per stamp column: how many maintained sites it stamped at or after `sinceIso`
 *  (the same set as the deps lists, so the row agrees with itself). */
export async function readCoverage(db: Db, sinceIso: string): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  // Stamps are `toISOString()` (milliseconds); a run start may come without them, and
  // "…:12Z" sorts after "…:12.500Z" as text. Compare like with like.
  const at = new Date(sinceIso).toISOString();
  for (const col of COVERAGE_STAMPS) {
    const r = await db
      .selectFrom("site_health")
      .innerJoin("sites", "sites.id", "site_health.site_id")
      .select(sql<number>`count(*)`.as("n"))
      .where("sites.status", "=", "maintained")
      .where(`site_health.${col}`, ">=", at)
      .executeTakeFirstOrThrow();
    out[col] = Number(r.n);
  }
  return out;
}
