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
  /** The operator's edits as stored JSON, or null when this report has never
   *  been edited. Deliberately NOT parsed here: the JSON route will place this
   *  string into its response body as-is, exactly as it already does with
   *  `result_json`, so the row hands back what was validated on the way in. */
  overrides_json: string | null;
  edited_at: string | null;
  opened_at: string | null;
};

export async function getProspectAuditByToken(
  db: Db,
  token: string,
): Promise<ProspectAuditRow | null> {
  const row = await db
    .selectFrom("prospect_audits")
    .select([
      "id",
      "url",
      "business",
      "created_at",
      "status",
      "result_json",
      "overrides_json",
      "edited_at",
      "opened_at",
    ])
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
  /** Whether an operator has edited this report, and when someone last opened
   *  it — both cheap TEXT columns, and the two facts the listing needs to show
   *  an "edited" marker without reading `overrides_json`. */
  edited_at: string | null;
  opened_at: string | null;
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
    .select(["id", "token", "url", "business", "status", "created_at", "edited_at", "opened_at"])
    .orderBy("created_at", "desc")
    .limit(clampLimit(limit))
    .execute();
}

/** One replaced string and the generated text it replaced. */
export type Override = { original: string; text: string };
export type OverrideMap = Record<string, Override>;

/**
 * Ceiling on one report's override map, measured on the SERIALISED JSON rather
 * than on the entry count — one entry holding a megabyte is the case that
 * matters, and the string is what actually gets stored and re-served.
 *
 * The arithmetic, not a round number: the report carries roughly 227 editable
 * strings (the check battery alone, before fixes, claims and goal copy). An
 * operator who replaced every one of them, at around 300 characters of
 * `original` plus 300 of `text` each, writes on the order of 136 KB. This is
 * about four times that worst realistic case, which leaves the honest editor
 * unbounded in practice while still bounding a hand-crafted POST.
 *
 * The bound matters more here than it does for the sibling `setReportCommentary`
 * (2 000 characters): commentary is read when a report is composed, whereas this
 * value is served back inline on every fetch of the report, out of a metered
 * store. 2 288 891 characters were accepted in a single write before this cap.
 */
export const OVERRIDES_MAX_LEN = 512_000;

export type SetOverridesResult =
  | { status: "updated"; token: string }
  | { status: "invalid"; token: string }
  | { status: "not-found"; token: string };

/**
 * The map that will actually be stored — a fresh `{ original, text }` pair per
 * entry, built out of the validated strings themselves — or null for anything
 * that is not a flat map of `{ original, text }` string pairs.
 *
 * Validating and BUILDING are one step deliberately, and this function returns
 * the map rather than a type guard for that reason. Every defect this code has
 * had was the same shape: one object was checked and a different one was handed
 * to `JSON.stringify`. `stringify` honours a `toJSON` method, so the entry
 * `{ original: "a", text: "b", toJSON: () => 5 }` validated as a pair and stored
 * `{"k":5}` — bytes this function never saw, in the one place that claims to be
 * the only gate they can be caught at. Reading each field once and keeping what
 * was read closes the gap by construction: what is stored IS what was approved,
 * and a getter that would answer differently on a second read has no second
 * read. Key order comes straight from `Object.entries`, which is the order
 * `JSON.stringify` would have used, so a round trip is stable and diffs stay
 * legible.
 *
 * EXTRA KEYS ON AN ENTRY ARE DROPPED, and that is a POLICY, not something
 * building the map here forces. A third design satisfies both halves at once:
 * build from the validated fields AND reject any entry carrying a key other than
 * `original` and `text`. Under it the `toJSON` gap, the double-read gap and the
 * extra keys all close by construction exactly as they do now, and a cycle or a
 * BigInt in a third key comes back `invalid` — because the third key is itself
 * the rejection reason, not because `JSON.stringify` threw on it. Dropping and
 * rejecting are therefore independent of building; the choice is DROP, and this
 * is the argument for it rather than a consequence of the rewrite.
 *
 * The consumer reads `original` and `text` and nothing else — the website
 * matches `original` against the generated string before it substitutes `text`.
 * An entry key nobody reads is dead weight re-served on every fetch of the
 * report out of a metered store, which is the same cost `OVERRIDES_MAX_LEN`
 * exists to bound; so the answer to a third key is to stop storing it, not to
 * refuse the operator's words over it. Dropping also keeps the cheap
 * forward-compatible case working: an editor that starts sending a field this
 * schema has not learned yet still saves what was typed.
 *
 * The line that drop stops at is the one this file already draws: it is the
 * ENTRY's own keys that are dropped. An unknown TOP-LEVEL key is a whole
 * override — operator content — and is validated like any other, never silently
 * discarded. The `__proto__` rule below is that same distinction reaching the
 * opposite verdict, for the same reason.
 *
 * The drop IS silent, and that is the cost being accepted: a map is stored that
 * is not byte-identical to the one sent, and the caller is told `updated` all
 * the same. It is acceptable only because what differs is always fields nobody
 * reads — it would not be acceptable for anything a reader could miss.
 *
 * This runs BEFORE the read, the same order `setReportCommentary` uses, so a
 * malformed body costs no round trip.
 *
 * It is also the ONLY place a malformed value can be caught. The JSON route
 * never parses what it serves — today it returns `result_json` untouched, and
 * once it carries overrides too it will place this string into the body the
 * same way, for the reason its own comment gives: parsing and re-serialising
 * there would add a failure mode between the database and the consumer for no
 * gain. Nothing downstream will notice a non-JSON value here; it would simply
 * break every subsequent fetch of that report. So: validate on the way in,
 * once, and never store anything this function has not approved.
 *
 * "Only place" is about MALFORMEDNESS, and is not a claim that no other limit is
 * needed. `OVERRIDES_MAX_LEN` bounds the string that gets STORED, never the
 * request body: a POST carrying megabytes of junk in keys nobody reads is parsed
 * in full and walked in full, and then stores 33 bytes and answers `updated`.
 * Bounding the body is the HTTP route's job, with a body limit there — not a
 * second check here.
 *
 * Both null guards are load-bearing, because `typeof null === "object"`: the
 * outer one keeps `Object.entries(null)` from throwing, and the inner one keeps
 * a null ENTRY from being read for `.original` — the exact input that crashed
 * the website's own override layer during its review.
 *
 * The PROTOTYPE check is the one that stops this function passing vacuously.
 * `Object.entries()` on a Map, a Set or a Date returns `[]`, so an entry walk
 * never runs its body and approved all three: a Map stored `{}` and silently
 * discarded every override in it, and a Date stored a bare JSON string where a
 * map belongs — each reporting "updated" and stamping `edited_at`.
 * Arrays fall out of the same check (`Array.prototype !== Object.prototype`), so
 * there is no separate `Array.isArray` guard on the outer value.
 *
 * `Object.create(null)` IS accepted: a null-prototype object serialises exactly
 * like `{}`, which is the only property this validator's consumer cares about,
 * and refusing it would reject a legitimate map for a reason invisible in JSON.
 *
 * A CROSS-REALM plain object is rejected, though, because its prototype is the
 * OTHER realm's `Object.prototype` and an identity comparison sees a stranger.
 * Nothing produces one today — a route handler's `JSON.parse` builds its objects
 * in this realm — and rejecting is the safe direction, but it would be a mystery
 * to a future worker-thread or `vm` consumer handed a map across the boundary.
 *
 * A `__proto__` KEY is rejected rather than stripped. `JSON.parse` makes it an
 * ordinary own property, and stored verbatim a consumer doing
 * `Object.assign({}, parsed)` does get its prototype replaced — the consumer
 * here is the website, a separate codebase, and this function's whole premise is
 * that nothing downstream will check.
 *
 * It is rejected rather than stripped for the distinction above, not for any
 * general rule against silent drops — such a rule would condemn the entry-key
 * drop in the same breath. `__proto__` at the TOP level is a whole override, so
 * stripping it would discard operator content and still report `updated`, on a
 * report that quietly lost an edit. An entry key is read by nobody, so dropping
 * one loses nothing. One rule, applied consistently, with opposite outcomes for
 * a stated reason.
 */
function buildOverrideMap(v: unknown): OverrideMap | null {
  if (v === null || typeof v !== "object") return null;
  const proto = Object.getPrototypeOf(v) as unknown;
  if (proto !== Object.prototype && proto !== null) return null;
  if (Object.hasOwn(v, "__proto__")) return null;
  const built: OverrideMap = {};
  for (const [key, entry] of Object.entries(v as Record<string, unknown>)) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) return null;
    // One read each, and the values that were read are the values that are kept.
    const { original, text } = entry as Partial<Override>;
    if (typeof original !== "string" || typeof text !== "string") return null;
    built[key] = { original, text };
  }
  return built;
}

/**
 * The exact string that will be stored, or null when the input is malformed.
 *
 * Building and serialising are one step, inside one try, because READING the
 * caller's object can throw on an input that is otherwise well-formed. There are
 * three such paths through `buildOverrideMap`, and the try covers all of them:
 *
 *   1. `Object.entries(v)` — an enumerable getter on the map itself, or a
 *      Proxy's `ownKeys` / `getOwnPropertyDescriptor` trap.
 *   2. `const { original, text } = entry` — a getter on the ENTRY, which throws
 *      after the map has been walked and before either field is validated.
 *   3. `built[key] = { original, text }` — `built` starts as `{}`, so the
 *      assignment walks `Object.prototype`, and a setter poisoned there under
 *      that key name throws on the WRITE rather than on any read.
 *
 * `Object.getPrototypeOf(v)` and `Object.hasOwn(v, "__proto__")` are two more,
 * both trappable on a Proxy and both ahead of the walk.
 *
 * `setProspectAuditOverrides` is typed to return one of three statuses, and an
 * escaping TypeError is a fourth outcome its callers have no branch for. A value
 * that cannot be read is malformed input, not an exceptional condition — and the
 * caller already has a branch for malformed input.
 *
 * `JSON.stringify` itself can no longer throw here: it is handed a plain object
 * of plain `{ original, text }` string pairs, which has no cycle, no BigInt and
 * no `toJSON` to honour. That used to be the other half of this try — a circular
 * reference or a BigInt in a valid-looking entry threw — and both are now simply
 * dropped with the rest of the entry's extra keys. The try stays wrapped around
 * the whole thing anyway: the day a field that is not a string is added, this
 * still returns `invalid` rather than throwing past the return type.
 *
 * The size cap is measured HERE, on the CONSTRUCTED string: that is the string
 * that gets stored and re-served, an entry count says nothing about it, and the
 * caller's object may be arbitrarily larger than the pairs taken out of it.
 * Which is also what it is NOT: a request-body limit. An oversized body is
 * parsed and walked in full before 33 bytes are stored and `updated` returned,
 * so whoever writes the HTTP route still owes it a body limit of its own.
 */
function serialiseOverrides(overrides: OverrideMap): string | null {
  let json: string;
  try {
    const built = buildOverrideMap(overrides);
    if (built === null) return null;
    json = JSON.stringify(built);
  } catch {
    return null;
  }
  return json.length > OVERRIDES_MAX_LEN ? null : json;
}

/**
 * Replace one report's override map wholesale and stamp `edited_at`.
 *
 * Whole-map rather than per-key: the caller always holds the complete map, and
 * a partial write has no way to express a deletion. An empty map is legitimate
 * and clears every override — an editor that can set but not unset traps the
 * operator in whatever they first typed.
 *
 * What is stored is REBUILT from the validated strings, not the object passed
 * in, so an entry keeps its `original` and its `text` and nothing else: any
 * other key on it is dropped rather than written through. See
 * `buildOverrideMap` for why that is the contract.
 *
 * LAST WRITE WINS, and two writers silently clobber each other: the second
 * write replaces the first's whole map, with nothing to tell either of them it
 * happened. That is accepted rather than overlooked — there is one operator
 * team, and an editor is open for minutes, so the window is small and the cost
 * of losing it is a paragraph retyped. If a second editor ever exists, the
 * column an optimistic check would key on is `edited_at`: read it with the
 * report, send it back with the write, refuse the write if it moved.
 *
 * `result_json` stays untouched. There is still no way to write it.
 */
export async function setProspectAuditOverrides(
  db: Db,
  token: string,
  overrides: OverrideMap,
): Promise<SetOverridesResult> {
  const serialised = serialiseOverrides(overrides);
  if (serialised === null) return { status: "invalid", token };

  const existing = await getProspectAuditByToken(db, token);
  if (!existing) return { status: "not-found", token };

  await db
    .updateTable("prospect_audits")
    .set({ overrides_json: serialised, edited_at: new Date().toISOString() })
    .where("token", "=", token)
    .execute();
  return { status: "updated", token };
}

/**
 * How stale `opened_at` must be before an open rewrites it.
 *
 * The operator signal is "has the prospect read this, and roughly when" — a
 * question five-minute resolution answers exactly as well as per-request
 * resolution does. Everything below the window is refresh noise.
 */
export const OPENED_AT_COALESCE_MS = 5 * 60 * 1000;

/**
 * Record that a report was opened by someone who is not editing it.
 *
 * Best effort by contract: the caller must not let a failure here fail the
 * response. Knowing when a prospect last looked is useful; it is not worth
 * turning a read route into one that can 500.
 *
 * COALESCED, and that is a safety property rather than an optimisation. The
 * route that calls this is unauthenticated and rate-limited at 120 req/min per
 * IP, so without the window one token holder can drive ~172 000 writes a day
 * from a single address — into a Turso project shared by the entire fleet,
 * configured `overages: false`, where crossing quota BLOCKS READS AND WRITES
 * for every site at once and where capacity is not alarmed. A read route that
 * amplifies into unbounded writes against that is an outage vector, not a
 * billing detail. With the window, a refresh costs nothing and the amplifier
 * is gone.
 *
 * The window lives in the WHERE clause, not in a read-then-write in the caller:
 * one round trip, and two concurrent opens cannot both decide to write.
 */
export async function touchProspectAuditOpened(db: Db, token: string): Promise<void> {
  const now = new Date();
  const staleBefore = new Date(now.getTime() - OPENED_AT_COALESCE_MS).toISOString();
  await db
    .updateTable("prospect_audits")
    .set({ opened_at: now.toISOString() })
    .where("token", "=", token)
    .where((eb) => eb.or([eb("opened_at", "is", null), eb("opened_at", "<", staleBefore)]))
    .execute();
}
