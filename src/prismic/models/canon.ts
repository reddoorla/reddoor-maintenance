// Canonical form for comparing a model on disk against the copy REGISTERED in
// Prismic. Prismic hands its copy back through its own serializer, so it differs
// from the file on disk in ways that mean NOTHING: key order, an explicit
// `"select": null` added to Link fields, `imageUrl` (the slice preview
// screenshot — Prismic owns it, so its value is meaningless for comparison; on
// disk it is usually `""` but sometimes a stale URL: nine fleet repos'
// RichText/model.json carry a real `https://…` value — caltex-landing,
// data-dynamiq, erp-industrial, espada, gallerysonder, hedloc,
// medical-solutions-of-texas, reddoor-website, vineyard-custom-homes), and —
// the one beachfront's original did not handle — EMPTY STRINGS.
//
// The empty-string rule is load-bearing, not cosmetic. Slice Machine writes
// image thumbnails to disk as {"name":"desktop","width":1200,"height":""}.
// Prismic coerces that "" to null on ingest and returns a model with the key
// absent. Filtering null but keeping "" made the two copies unequal FOREVER: a
// push sends "", Prismic stores null, the next scan diffs again. The nightly
// drift check would have alarmed on hedloc every night for a divergence that
// never existed. Proven by round-tripping a thumbnail through the Types API on
// the-pinnacle: sent height:"", read back height:null.
//
// Safe because the only comparison it collapses is `"" vs absent`, which IS the
// non-difference. `"" vs "something"` still differs (one side keeps the key),
// and `0`/`false` are untouched — they are not `""`.
//
// `imageUrl` is dropped by key name alone, at ANY depth — not just on
// variations. That's a chosen tradeoff, not an oversight: narrowing it to
// "variation-shaped objects" would trade this hole for a shape heuristic that
// could itself be wrong. The risk it accepts: a Prismic field whose literal API
// ID is `imageUrl` would go invisible to comparison on both sides — the exact
// silent-drop failure class this module exists to prevent. Not currently live:
// fleet field API IDs are snake_case (`background_image`, `meta_image`, …),
// and all 232 current occurrences of the key sit at `variations[].imageUrl`.

/** Recursively normalise a model for comparison. Pure. */
export function canon(v: unknown): unknown {
  // Elements are NOT filtered here — only object keys are, below. Dropping a
  // null/""/undefined element would shift array indices, so [1, null] would
  // wrongly canon-equal [1]. An empty array stays `[]`, not dropped: e.g.
  // `thumbnails: []` round-trips through Prismic unchanged, so "empty" has to
  // stay distinguishable from "absent".
  if (Array.isArray(v)) return v.map(canon);
  if (v !== null && typeof v === "object") {
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>)
        // Only the VALUE of a noise key is filtered out — an object left with
        // zero keys collapses to `{}`, which is exactly what `constraint: {}`
        // already is on disk. Nothing here treats "now empty" as "absent".
        .filter(([k, x]) => x !== null && x !== undefined && x !== "" && k !== "imageUrl")
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([k, x]) => [k, canon(x)]),
    );
  }
  return v;
}

/** True when two models are the same MODEL, ignoring serializer noise.
 *  Precondition: callers pass models (plain objects/arrays read from JSON),
 *  never `undefined` — this performs no defensive check for that case. */
export function sameModel(a: unknown, b: unknown): boolean {
  return JSON.stringify(canon(a)) === JSON.stringify(canon(b));
}
