import { randomBytes } from "node:crypto";
import type { Db } from "./client.js";

/** 16 random bytes → 22-char base64url string: unguessable, URL-safe. */
export function generateToken(): string {
  return randomBytes(16).toString("base64url");
}

/** Anything not exactly generateToken()-shaped is a probe, not a report. */
export function isValidToken(s: string): boolean {
  return /^[A-Za-z0-9_-]{22}$/.test(s);
}

/** Opaque, collision-free id (mirrors newSubmissionId / newDeadLetterId).
 *  crypto is a Node 20 global — no new dep. Nothing reads this format; `token`
 *  is the public handle. */
export function newProspectAuditId(): string {
  return `pa_${crypto.randomUUID()}`;
}

/** "complete" when every pipeline stage succeeded; "partial" when any stage
 *  failed or was deliberately skipped (StageResult's `ok: false` covers
 *  both — the pipeline doesn't distinguish them at this layer). The report
 *  itself already degrades each failed section to "not measured"; this is
 *  what lets a future dashboard tell complete from partial without
 *  deserializing the whole result_json. */
export type ProspectAuditStatus = "complete" | "partial";

/**
 * The lineage handle for a site: one key for every way of writing its address.
 *
 * `url` is kept exactly as it was given, because what we audited is a fact
 * about the run. It is the wrong thing to group by, though, and the corpus
 * already proves it — `beachfrontdentistry.com` and `beachfrontdentistry.com/`
 * are two separate histories in the table today, as are the two spellings of
 * ludlowkingsley.com. Nothing has broken only because nothing yet compares two
 * audits of one site. The moment the report offers a before and an after, a
 * trailing slash turns a returning client into a stranger.
 *
 * Scheme, a leading "www.", a trailing slash, a query string and a fragment all
 * go: none of them distinguish one site from another. The path stays, because a
 * site living in a subdirectory genuinely is a different site.
 *
 * Never throws. A key we cannot compute must not take an audit down with it —
 * an unparseable input falls back to its trimmed self, which groups nothing and
 * so is no worse than having no key at all.
 */
export function siteKey(url: string): string {
  const raw = url.trim();
  if (raw === "") return "";
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    const path = u.pathname.replace(/\/+$/, "");
    return `${host}${path}`;
  } catch {
    return raw;
  }
}

export type NewProspectAudit = {
  url: string;
  business: string | null;
  resultJson: string;
  /** Defaults to "complete" — the column's own SQL default — for callers
   *  (tests, ad-hoc scripts) that don't track per-stage outcomes. The
   *  prospect-audit CLI, the only real writer, always computes and passes
   *  this explicitly. */
  status?: ProspectAuditStatus;
};

export async function createProspectAudit(
  db: Db,
  audit: NewProspectAudit,
): Promise<{ id: string; token: string }> {
  const id = newProspectAuditId();
  const token = generateToken();
  await db
    .insertInto("prospect_audits")
    .values({
      id,
      token,
      url: audit.url,
      site_key: siteKey(audit.url),
      business: audit.business,
      created_at: new Date().toISOString(),
      status: audit.status ?? "complete",
      result_json: audit.resultJson,
    })
    .execute();
  return { id, token };
}

export type ProspectAuditRow = {
  id: string;
  url: string;
  business: string | null;
  created_at: string;
  status: string;
  result_json: string;
};

export async function getProspectAuditByToken(
  db: Db,
  token: string,
): Promise<ProspectAuditRow | null> {
  const row = await db
    .selectFrom("prospect_audits")
    .select(["id", "url", "business", "created_at", "status", "result_json"])
    .where("token", "=", token)
    .executeTakeFirst();
  return row ?? null;
}

/** The columns the cockpit's /audits listing page shows. Deliberately NOT
 *  `result_json` — large, and useless to a list — but `token` IS selected:
 *  the listing needs it to build each row's `/r/{token}` link, so it's
 *  rendered only into an href, never displayed as a raw value. */
export type ProspectAuditListItem = {
  id: string;
  token: string;
  url: string;
  business: string | null;
  status: string;
  created_at: string;
};

/** Ceiling on `listRecentProspectAudits`' `limit`, enforced defensively (a
 *  caller passing 10_000 must not get 10_000 rows) — well past anything a
 *  listing page would ever render on one screen. */
export const MAX_RECENT_PROSPECT_AUDITS = 100;

/** Clamp a caller-supplied limit into [1, MAX_RECENT_PROSPECT_AUDITS], with a
 *  safe fallback of 1 for anything non-finite (NaN, ±Infinity) rather than
 *  letting a bad input reach the query unclamped. */
function clampLimit(limit: number): number {
  const n = Number.isFinite(limit) ? Math.trunc(limit) : 1;
  return Math.min(Math.max(n, 1), MAX_RECENT_PROSPECT_AUDITS);
}

/** Newest-first audits for the cockpit's /audits listing page, capped both
 *  defensively (see clampLimit) and by an index (migration 0010) so the
 *  ORDER BY never falls back to a raw scan + a temp b-tree sort — see the
 *  EXPLAIN-query-plan gate, tests/db/query-plans.test.ts. */
export async function listRecentProspectAudits(
  db: Db,
  limit: number,
): Promise<ProspectAuditListItem[]> {
  return db
    .selectFrom("prospect_audits")
    .select(["id", "token", "url", "business", "status", "created_at"])
    .orderBy("created_at", "desc")
    .limit(clampLimit(limit))
    .execute();
}
