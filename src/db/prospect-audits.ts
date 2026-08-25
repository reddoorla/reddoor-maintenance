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
