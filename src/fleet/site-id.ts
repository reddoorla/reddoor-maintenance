/**
 * Site ids (#646 step 3, operator decision 2026-09-17).
 *
 * Two shapes coexist PERMANENTLY:
 *
 *   - `rec…`          every site that existed before the Turso-native creator. The
 *                     imported record id is the primary key (design D1), and it
 *                     is never rewritten: `submissions.site_id`,
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

/** A site id minted by {@link mintSiteId}. */
export function isMintedSiteId(id: string): boolean {
  return /^site_[0-9A-HJKMNP-TV-Z]{26}$/.test(id);
}
