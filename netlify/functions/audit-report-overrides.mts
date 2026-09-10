import type { Context, Config } from "@netlify/functions";
import { createHash, timingSafeEqual } from "node:crypto";
import { openDb, readDbConfig } from "../../src/db/client.js";
import {
  isValidToken,
  setProspectAuditOverrides,
  type OverrideMap,
} from "../../src/db/prospect-audits.js";
import { handlerError } from "../../src/dashboard/handler-helpers.js";

// Where an operator's edits to one prospect report land.
//
// NOT operator-gated, and not CSRF-gated, because neither applies: the caller
// is the marketing site's SERVER, which has already checked the operator's edit
// cookie before forwarding. There is no browser session here to protect. What
// guards this route is a shared token, and it FAILS CLOSED — an unset
// PROSPECT_EDIT_TOKEN refuses everything rather than falling back to open.
//
// Note the asymmetry with the read route beside it: reading a report needs only
// the 128-bit URL token, because anyone holding the link is the intended
// audience. WRITING to somebody's report is not something a link should permit.
export const config: Config = {
  path: ["/api/audit-report/:token/overrides"],
  rateLimit: { windowSize: 60, windowLimit: 30, aggregateBy: ["ip"] },
};

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "x-robots-tag": "noindex" },
  });
}

/**
 * The bearer token from an Authorization header, or "" for anything else.
 *
 * Case-insensitive on the SCHEME, because RFC 7235 says the scheme is
 * case-insensitive and a caller sending `bearer ` is not an attacker. The token
 * itself is matched exactly, by `tokenMatches` below.
 */
function bearerToken(header: string | null): string {
  const m = /^bearer[ \t]+(.+)$/i.exec((header ?? "").trim());
  return m ? m[1]!.trim() : "";
}

/**
 * Constant-time compare of the presented shared token against the configured
 * one, with respect to BOTH content and length.
 *
 * The SHA-256 is there to EQUALISE LENGTH, and for nothing else. It is not
 * protecting the token at rest — both operands are already secrets held in
 * memory, and a plain digest is not a MAC. The problem it solves is that
 * `timingSafeEqual` throws a RangeError on buffers of different lengths, so a
 * raw-buffer compare has to guard with `if (a.length !== b.length) return false`
 * — an early return that leaks the expected token's length to anyone who can
 * time it, which is the one thing a constant-time compare is supposed to hide.
 * Digesting first makes both operands 32 bytes always: the guard is unnecessary,
 * `timingSafeEqual` can never throw, and no length is observable.
 *
 * This deliberately mirrors `verifyFormsToken` in src/forms/token.ts, which
 * guards the fleet's other shared-token route by the same reasoning. The two are
 * not shared today only because that one's contract names FORMS_INGEST_TOKEN;
 * if a third such route appears, lift one neutral helper rather than write it
 * a third time.
 */
function tokenMatches(given: string, expected: string): boolean {
  const digest = (s: string) => createHash("sha256").update(s, "utf8").digest();
  return timingSafeEqual(digest(given), digest(expected));
}

export default async (req: Request, ctx: Context): Promise<Response> => {
  if (req.method !== "POST") return json({ ok: false, error: "method-not-allowed" }, 405);

  const expected = process.env.PROSPECT_EDIT_TOKEN;
  if (!expected) {
    console.error("[audit-report-overrides] PROSPECT_EDIT_TOKEN not set — refusing");
    return json({ ok: false, error: "unconfigured" }, 503);
  }

  const given = bearerToken(req.headers.get("authorization"));
  // The same answer as a missing report. An authorised caller always arrives
  // with the token, so nobody legitimate sees this.
  if (!given || !tokenMatches(given, expected)) return json({ ok: false, error: "not-found" }, 404);

  const token = ctx.params?.token;
  // Shape-check before the database, exactly as the read route does: anything
  // else is a scanner, not a caller.
  if (!token || !isValidToken(token)) return json({ ok: false, error: "not-found" }, 404);

  if (!process.env.TURSO_DATABASE_URL) {
    console.error("[audit-report-overrides] TURSO_DATABASE_URL missing");
    return json({ ok: false, error: "unconfigured" }, 503);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "bad-json" }, 400);
  }

  // Handed on unvalidated ON PURPOSE. `setProspectAuditOverrides` validates and
  // BUILDS the stored map in one pass, and its own comment explains why that has
  // to be the only gate: a second shape check here would be a different object
  // from the one that gets serialised, which is the exact defect that let a
  // `toJSON` entry through before. So the cast is a type-level convenience, not
  // a claim about the value, and `invalid` below is the real answer.
  const overrides = (body as { overrides?: unknown })?.overrides;

  try {
    const db = await openDb(readDbConfig());
    const res = await setProspectAuditOverrides(db, token, overrides as OverrideMap);
    if (res.status === "invalid") return json({ ok: false, error: "bad-overrides" }, 400);
    if (res.status === "not-found") return json({ ok: false, error: "not-found" }, 404);
    return json({ ok: true }, 200);
  } catch (err) {
    return handlerError("audit-report-overrides", err);
  }
};
