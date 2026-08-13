// Canonical form for comparing a model on disk against the copy REGISTERED in
// Prismic. Prismic hands its copy back through its own serializer, so it differs
// from the file on disk in ways that mean NOTHING: key order, an explicit
// `"select": null` added to Link fields, `imageUrl` (the slice preview
// screenshot, which lives in Prismic and is `""` in every file on disk), and —
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

/** Recursively normalise a model for comparison. Pure. */
export function canon(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canon);
  if (v !== null && typeof v === "object") {
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>)
        .filter(([k, x]) => x !== null && x !== undefined && x !== "" && k !== "imageUrl")
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([k, x]) => [k, canon(x)]),
    );
  }
  return v;
}

/** True when two models are the same MODEL, ignoring serializer noise. */
export function sameModel(a: unknown, b: unknown): boolean {
  return JSON.stringify(canon(a)) === JSON.stringify(canon(b));
}
