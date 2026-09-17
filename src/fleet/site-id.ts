/**
 * Site ids after Airtable (#646 step 3, operator decision 2026-09-17).
 *
 * Two shapes coexist PERMANENTLY:
 *
 *   - `rec…`          every site that existed before the Turso-native creator. The
 *                     Airtable record id became the Turso primary key at import
 *                     (design D1), and it is never rewritten: `submissions.site_id`,
 *                     `reports.site_id`, `fleet_events`, `spam_screenouts`,
 *                     `digest_state` keys and event ids all hold it by convention.
 *   - `site_<ULID>`   every site created since, minted here.
 *
 * Neither is the external handle. The stored unique `sites.slug` is — URLs,
 * `/api/forms/:slug` and deployed sites all use it — so the id is free to be
 * whatever sorts and stays unique.
 *
 * ## Why a local ULID and not a dependency
 *
 * Nothing in the dependency tree implements ULID (checked 2026-09-17: the only
 * id-ish package is a transitive `nanoid`, which is not time-sortable and is not
 * ours to import). The encoding is 30 lines of arithmetic over a spec that has
 * not changed since 2016, this package is published to fleet sites, and adding a
 * runtime dependency for it would cost every consumer an install. The random
 * half comes from `globalThis.crypto` (Web Crypto, present in Node 20+ and in
 * Netlify functions), so the module needs no `node:` import either.
 *
 * Not monotonic within a millisecond: two ids minted in the same ms order by
 * their random half. Sites are created by hand, one command at a time; nothing
 * needs a strict order finer than the millisecond.
 */

/** Crockford base32, the ULID alphabet (no I, L, O, U). */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const MAX_TIME = 2 ** 48 - 1;

/**
 * Encode a ULID from a millisecond timestamp and 10 random bytes: 10 chars of
 * big-endian time, then 16 chars of the 80 random bits. Pure, so tests can pin it.
 */
export function encodeUlid(timeMs: number, random: Uint8Array): string {
  if (!Number.isInteger(timeMs) || timeMs < 0 || timeMs > MAX_TIME) {
    throw new Error(`encodeUlid: time ${timeMs} is not a 48-bit millisecond timestamp`);
  }
  if (random.length !== 10) {
    throw new Error(`encodeUlid: needs exactly 10 random bytes, got ${random.length}`);
  }
  let time = "";
  let t = timeMs;
  for (let i = 0; i < 10; i++) {
    time = ALPHABET[t % 32]! + time;
    t = Math.floor(t / 32);
  }
  // 80 bits → 16 five-bit groups. Accumulate MSB-first; the buffer never holds
  // more than 12 bits, so plain numbers stay exact.
  let rand = "";
  let buffer = 0;
  let bits = 0;
  for (const byte of random) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      rand += ALPHABET[(buffer >> bits) & 31]!;
    }
    buffer &= (1 << bits) - 1;
  }
  return time + rand;
}

/** Mint a new site id: `site_<ULID>`. */
export function mintSiteId(now: number = Date.now()): string {
  const random = new Uint8Array(10);
  globalThis.crypto.getRandomValues(random);
  return `site_${encodeUlid(now, random)}`;
}

/** A `rec…` id — the only shape Airtable can address. Deliberately a PREFIX test,
 *  the decision's own wording ("skip non-`rec` ids"): real Airtable ids are
 *  `rec` + 14 alphanumerics, but the suite's fixtures use readable ones like
 *  `rec_site_acme`, and in production the only other shape that exists is
 *  `site_<ULID>`, which this rejects either way. */
export function isAirtableRecordId(id: string): boolean {
  return id.length > 3 && id.startsWith("rec");
}

/** A site id minted by {@link mintSiteId}. */
export function isMintedSiteId(id: string): boolean {
  return /^site_[0-9A-HJKMNP-TV-Z]{26}$/.test(id);
}

/**
 * The one decision every Airtable SHADOW writer makes before touching Airtable:
 * is this a record Airtable could possibly hold? A `site_` id never is — the site
 * was created in Turso and Airtable has never heard of it — so the write is
 * skipped ON PURPOSE rather than sent to 404.
 *
 * Returns `true` when the caller must skip, after logging exactly one stable,
 * greppable line:
 *
 *     AIRTABLE_SHADOW skipped=non-rec-id writer=<name> id=<id>
 *
 * Logged rather than silent because a skip is a decision someone may need to
 * audit: "why does Airtable not have this site's scores" should be one grep away.
 * Lives outside `src/reports/airtable/` so the Turso-native creator can use it
 * without importing the layer Phase 6 deletes.
 */
export function skipsAirtableShadow(writer: string, id: string): boolean {
  if (isAirtableRecordId(id)) return false;
  console.log(`AIRTABLE_SHADOW skipped=non-rec-id writer=${writer} id=${id}`);
  return true;
}
