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

/**
 * Ceiling on the REQUEST BODY, in UTF-8 bytes of the body as this handler reads
 * it — `Buffer.byteLength(await req.text())`, which is the DECODED body, not
 * whatever arrived on the socket. The two are the same under identity encoding,
 * which is everything the website proxy sends. They are not the same under
 * `content-encoding: gzip`, where the declared `content-length` is a compressed
 * size being checked against a decompressed budget. That is a mismatch rather
 * than a hole: undici does not decompress request bodies, so such a body reaches
 * `JSON.parse` still compressed and is refused as `bad-json`.
 *
 * This is the limit `setProspectAuditOverrides` says belongs here and nowhere
 * else. Its own `OVERRIDES_MAX_LEN` bounds the string that gets STORED, and its
 * comment is explicit that this leaves the body unbounded: "a POST carrying
 * megabytes of junk in keys nobody reads is parsed in full and walked in full,
 * and then stores 33 bytes and answers `updated`. Bounding the body is the HTTP
 * route's job, with a body limit there — not a second check here." Until this
 * existed, that paragraph described a guard that did not.
 *
 * The number is reasoned from the storage cap rather than picked: a body gate
 * that refuses a map the storage layer would have accepted fails a legitimate
 * save with a 413 that looks like a broken editor. The two count different
 * things — `OVERRIDES_MAX_LEN` is 512 000 UTF-16 code units of the constructed
 * JSON, this is UTF-8 bytes on the wire — and the worst-case ratio between them
 * is 3, at a BMP character outside Latin-1 (CJK is one code unit and three
 * bytes; an astral character is two units and four bytes, so only 2). So the
 * largest storable map can weigh 512 000 x 3 = 1 536 000 bytes, and 2 MiB clears
 * it with 561 152 bytes left over for the `{"overrides":...}` wrapper and any
 * whitespace a pretty-printing caller sends.
 *
 * That headroom is stated for the body a caller ACTUALLY SENDS TODAY: the
 * canonical `JSON.stringify` of the map, which is what the website proxy
 * forwards. It is not a guarantee for every body that could store legally, and
 * the difference was measured rather than assumed. A client that escapes
 * non-ASCII as `\uXXXX` sends six bytes per stored unit, not three, and a
 * maximal CJK map written that way runs to roughly 3 MB — the exact figure moves
 * with the shape of the map, so treat it as an order of magnitude, not a
 * constant — which is refused here and accepted by the storage layer. And because `buildOverrideMap` DROPS unknown keys per
 * entry (deliberately, so a future editor sending a field this schema has not
 * learned still saves what was typed), a body can be arbitrarily large relative
 * to what it stores. Neither is reachable from the only caller that exists. If
 * a second one ever appears, this is the number to revisit.
 *
 * Written as a literal and NOT computed from OVERRIDES_MAX_LEN, deliberately: a
 * derived cap would silently follow the storage limit up to 15 MiB if someone
 * ever raised it to 5 MB, which is exactly the size decision a human should be
 * made to look at. Instead the relationship is asserted in
 * tests/dashboard/audit-report-overrides.test.ts, so raising OVERRIDES_MAX_LEN
 * without revisiting this number reds a test rather than either refusing
 * legitimate saves or quietly widening what this route will read.
 */
export const MAX_BODY_BYTES = 2 * 1024 * 1024;

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
 * case-insensitive and a caller sending `bearer ` is not an attacker.
 *
 * Whitespace AROUND the token is stripped too — the header is trimmed, and so is
 * the captured value — so `Bearer   s3cret  ` presents as `s3cret` and is
 * accepted. Measured, not assumed: that request returns 200. What survives the
 * strip is then compared byte for byte by `tokenMatches`, against a
 * `PROSPECT_EDIT_TOKEN` trimmed the same way, so both sides agree on what
 * surrounding whitespace means. Interior whitespace is part of the secret and is
 * never touched.
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

  // TRIMMED, and that is not cosmetic. The presented token arrives trimmed (see
  // `bearerToken`), so comparing it against an untrimmed environment value made
  // a single stray newline unsurvivable: with `PROSPECT_EDIT_TOKEN="s3cret\n"`,
  // `Bearer s3cret` 404s AND so does `Bearer s3cret\n`, because the presented
  // side is trimmed either way. Both directions fail, the response is
  // byte-identical to a wrong token and to a missing report, and there is no log
  // on that path — so the operator sees an editor where every save 404s, with
  // nothing in the function logs to say why. `openssl rand -base64 32` pasted
  // into Netlify's environment UI is exactly how that newline arrives.
  const configuredRaw = process.env.PROSPECT_EDIT_TOKEN ?? "";
  const configured = configuredRaw.trim();
  // A whitespace-only value is treated as unset rather than as a secret nothing
  // can match: it fails closed loudly here instead of silently 404ing forever.
  if (!configured) {
    console.error("[audit-report-overrides] PROSPECT_EDIT_TOKEN not set or blank — refusing");
    return json({ ok: false, error: "unconfigured" }, 503);
  }

  const given = bearerToken(req.headers.get("authorization"));
  // The same answer as a missing report. An authorised caller always arrives
  // with the token, so nobody legitimate sees this.
  if (!given || !tokenMatches(given, configured))
    return json({ ok: false, error: "not-found" }, 404);

  // Deliberately AFTER the token check, not before it.
  //
  // The CONDITION is a property of the deployment — the environment value, which
  // no caller can influence — so this reports a misconfiguration, never anything
  // about a request. The PLACEMENT is what keeps it that way: sitting before the
  // check, any unauthenticated POST could drive it, handing a stranger a lever on
  // this deploy's logs and burying the one line the operator needs under noise
  // from whoever is scanning today. Behind the check, only a caller holding the
  // shared secret can emit it.
  //
  // Nothing is lost by waiting, because the trim above means whitespace can no
  // longer be the REASON auth fails. A 404 here is now a genuinely different
  // secret, which this line would not explain anyway; a 200 with stray
  // whitespace is the case that needs saying out loud, and that is the case it
  // fires on.
  if (configuredRaw !== configured) {
    console.warn(
      "[audit-report-overrides] PROSPECT_EDIT_TOKEN has leading or trailing whitespace; " +
        "it was trimmed before comparing and this request was accepted. Re-paste the value " +
        "in the environment without the stray whitespace.",
    );
  }

  const token = ctx.params?.token;
  // Shape-check before the database, exactly as the read route does: anything
  // else is a scanner, not a caller.
  if (!token || !isValidToken(token)) return json({ ok: false, error: "not-found" }, 404);

  if (!process.env.TURSO_DATABASE_URL) {
    console.error("[audit-report-overrides] TURSO_DATABASE_URL missing");
    return json({ ok: false, error: "unconfigured" }, 503);
  }

  // Both halves of the body cap, and neither is sufficient alone.
  //
  // The declared length first, because it is the cheap one: it refuses to buffer
  // a large upload INTO THIS FUNCTION. The upload itself has already been
  // accepted by the platform by the time this handler runs, so nothing here
  // spares the network — what it spares is this invocation's memory. It is only
  // ever a hint, too: `content-length` is absent under chunked transfer
  // encoding, and a hostile caller can simply state a number that is not true.
  const declared = req.headers.get("content-length");
  if (declared !== null) {
    const n = Number(declared);
    if (Number.isFinite(n) && n > MAX_BODY_BYTES) {
      return json({ ok: false, error: "body-too-large" }, 413);
    }
  }

  // So the bytes actually read are measured too, and that is the check doing the
  // real work. BYTE length, not `String.length`: this guards against what
  // arrives on the wire, where a CJK character is three bytes and a
  // `.length`-based cap would admit three times the intended payload.
  let text: string;
  try {
    text = await req.text();
  } catch {
    return json({ ok: false, error: "bad-json" }, 400);
  }
  if (Buffer.byteLength(text, "utf8") > MAX_BODY_BYTES) {
    return json({ ok: false, error: "body-too-large" }, 413);
  }

  let body: unknown;
  try {
    body = JSON.parse(text) as unknown;
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
