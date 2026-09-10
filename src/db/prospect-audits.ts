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
 * EXTRA KEYS ON AN ENTRY ARE DROPPED — stated here because "validate, then
 * serialise the caller's object" left it undefined, and it silently stored them.
 * Only `original` and `text` mean anything downstream (the website matches
 * `original` against the generated string before it substitutes `text`), so a
 * third key is at best noise re-served on every fetch of the report. Dropping
 * rather than rejecting also keeps the cheap forward-compatible case working: an
 * editor that starts sending a field this schema has not learned yet still saves
 * the operator's words. It is the entry's OWN keys that are dropped; an unknown
 * top-level key is a whole override and is validated like any other.
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
 * A `__proto__` KEY is rejected rather than stripped. `JSON.parse` makes it an
 * ordinary own property, and stored verbatim a consumer doing
 * `Object.assign({}, parsed)` does get its prototype replaced — the consumer
 * here is the website, a separate codebase, and this function's whole premise is
 * that nothing downstream will check. Stripping it silently would be a second
 * way to report success for something that was not stored.
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
 * caller's object can throw on an input that is otherwise well-formed: a
 * throwing getter throws in `Object.entries`, or in the destructuring of an
 * entry, before anything has been validated. `setProspectAuditOverrides` is
 * typed to return one of three statuses, and an escaping TypeError is a fourth
 * outcome its callers have no branch for. A value that cannot be read is
 * malformed input, not an exceptional condition — and the caller already has a
 * branch for malformed input.
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
 * Record that a report was opened by someone who is not editing it.
 *
 * Best effort by contract: the caller must not let a failure here fail the
 * response. Knowing when a prospect last looked is useful; it is not worth
 * turning a read route into one that can 500.
 */
export async function touchProspectAuditOpened(db: Db, token: string): Promise<void> {
  await db
    .updateTable("prospect_audits")
    .set({ opened_at: new Date().toISOString() })
    .where("token", "=", token)
    .execute();
}
