import { describe, it, expect } from "vitest";
import { openDb, readDbConfig } from "../../src/db/client.js";
import {
  createProspectAudit,
  getProspectAuditByToken,
  OPENED_AT_COALESCE_MS,
  OVERRIDES_MAX_LEN,
  setProspectAuditOverrides,
  touchProspectAuditOpened,
} from "../../src/db/prospect-audits.js";
import type { OverrideMap } from "../../src/db/prospect-audits.js";

async function seed() {
  process.env.TURSO_DATABASE_URL = ":memory:";
  const db = await openDb(readDbConfig());
  const { token } = await createProspectAudit(db, {
    url: "https://acme.test/",
    business: "Acme",
    resultJson: JSON.stringify({ url: "https://acme.test/" }),
  });
  return { db, token };
}

describe("prospect_audits — override columns", () => {
  it("has overrides_json, edited_at and opened_at after migration", async () => {
    process.env.TURSO_DATABASE_URL = ":memory:";
    const db = await openDb(readDbConfig());
    const rows = await db.introspection.getTables();
    const table = rows.find((t) => t.name === "prospect_audits");
    const names = (table?.columns ?? []).map((c) => c.name);
    expect(names).toContain("overrides_json");
    expect(names).toContain("edited_at");
    expect(names).toContain("opened_at");
  });
});

describe("setProspectAuditOverrides", () => {
  it("stores the map and stamps edited_at", async () => {
    const { db, token } = await seed();
    const res = await setProspectAuditOverrides(db, token, {
      "composed:headlineFinding": { original: "a", text: "b" },
    });
    expect(res.status).toBe("updated");
    const row = await getProspectAuditByToken(db, token);
    expect(JSON.parse(row!.overrides_json!)).toEqual({
      "composed:headlineFinding": { original: "a", text: "b" },
    });
    expect(row!.edited_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("refuses a map that is not an object of {original,text} strings", async () => {
    const { db, token } = await seed();
    const res = await setProspectAuditOverrides(db, token, {
      bad: { original: 1, text: "b" } as unknown as { original: string; text: string },
    });
    expect(res.status).toBe("invalid");
    const row = await getProspectAuditByToken(db, token);
    expect(row!.overrides_json).toBeNull();
  });

  it("refuses an entry whose text is not a string", async () => {
    const { db, token } = await seed();
    const res = await setProspectAuditOverrides(db, token, {
      bad: { original: "a", text: 2 } as unknown as { original: string; text: string },
    });
    expect(res.status).toBe("invalid");
    const row = await getProspectAuditByToken(db, token);
    expect(row!.overrides_json).toBeNull();
  });

  it("refuses an ARRAY, which is an object but not a map", async () => {
    const { db, token } = await seed();
    // `typeof [] === "object"` and an empty array's `Object.values` is empty, so a
    // validator that only walked the entries would accept this and store `[]` —
    // valid JSON the website's override layer would then index by string key.
    const res = await setProspectAuditOverrides(db, token, [] as unknown as OverrideMap);
    expect(res.status).toBe("invalid");
    const row = await getProspectAuditByToken(db, token);
    expect(row!.overrides_json).toBeNull();
  });

  it("refuses a null map", async () => {
    const { db, token } = await seed();
    const res = await setProspectAuditOverrides(db, token, null as unknown as OverrideMap);
    expect(res.status).toBe("invalid");
    const row = await getProspectAuditByToken(db, token);
    expect(row!.overrides_json).toBeNull();
  });

  it("refuses an entry that is null without throwing", async () => {
    // `typeof null === "object"`, so an entry check that forgets the null guard
    // reads `.original` off null and throws — this is the input that crashed the
    // website's own override layer during its review.
    const { db, token } = await seed();
    const res = await setProspectAuditOverrides(db, token, {
      bad: null as unknown as { original: string; text: string },
    });
    expect(res.status).toBe("invalid");
    const row = await getProspectAuditByToken(db, token);
    expect(row!.overrides_json).toBeNull();
  });

  it("reports not-found for an absent token without writing", async () => {
    const { db } = await seed();
    const res = await setProspectAuditOverrides(db, "aB3-_xY9zQ1rS2tU4vW6xY", {});
    expect(res.status).toBe("not-found");
  });

  it("an empty map clears the overrides", async () => {
    const { db, token } = await seed();
    await setProspectAuditOverrides(db, token, { k: { original: "a", text: "b" } });
    await setProspectAuditOverrides(db, token, {});
    const row = await getProspectAuditByToken(db, token);
    expect(JSON.parse(row!.overrides_json!)).toEqual({});
  });

  it("leaves result_json and opened_at alone", async () => {
    // `result_json` stays write-once, and `opened_at` means "last read by someone
    // who was NOT editing" — an edit must not look like a prospect opening it.
    const { db, token } = await seed();
    const before = await getProspectAuditByToken(db, token);
    await setProspectAuditOverrides(db, token, { k: { original: "a", text: "b" } });
    const after = await getProspectAuditByToken(db, token);
    expect(after!.result_json).toBe(before!.result_json);
    expect(after!.opened_at).toBeNull();
  });
});

describe("touchProspectAuditOpened", () => {
  it("stamps opened_at", async () => {
    const { db, token } = await seed();
    await touchProspectAuditOpened(db, token);
    const row = await getProspectAuditByToken(db, token);
    expect(row!.opened_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("is a no-op on an absent token, and does not throw", async () => {
    // Best effort by contract: the read route must not be turned into one that
    // can 500 by a token nobody has a row for.
    const { db, token } = await seed();
    await expect(touchProspectAuditOpened(db, "aB3-_xY9zQ1rS2tU4vW6xY")).resolves.toBeUndefined();
    const row = await getProspectAuditByToken(db, token);
    expect(row!.opened_at).toBeNull();
  });

  it("does not stamp edited_at", async () => {
    const { db, token } = await seed();
    await touchProspectAuditOpened(db, token);
    const row = await getProspectAuditByToken(db, token);
    expect(row!.edited_at).toBeNull();
  });

  it("leaves result_json, overrides_json and edited_at alone", async () => {
    // The mirror of setProspectAuditOverrides' own "leaves result_json and
    // opened_at alone": an open is a read by someone who is NOT editing, so it
    // must not touch the report, the operator's edits, or when they were made.
    const { db, token } = await seed();
    await setProspectAuditOverrides(db, token, { k: { original: "a", text: "b" } });
    const before = await getProspectAuditByToken(db, token);

    await touchProspectAuditOpened(db, token);

    const after = await getProspectAuditByToken(db, token);
    expect(after!.result_json).toBe(before!.result_json);
    expect(after!.overrides_json).toBe(before!.overrides_json);
    expect(after!.edited_at).toBe(before!.edited_at);
  });
});

/** Backdate opened_at by hand. Cheaper and far steadier than sleeping or
 *  injecting a clock: the window lives in a SQL comparison against a stored
 *  string, so moving the stored value is the same experiment as moving time. */
async function backdateOpenedAt(
  db: Awaited<ReturnType<typeof openDb>>,
  token: string,
  msAgo: number,
): Promise<string> {
  const when = new Date(Date.now() - msAgo).toISOString();
  await db
    .updateTable("prospect_audits")
    .set({ opened_at: when })
    .where("token", "=", token)
    .execute();
  return when;
}

describe("touchProspectAuditOpened — coalescing", () => {
  // Not an optimisation. The route calling this is unauthenticated and rate
  // limited at 120 req/min/IP, so an uncoalesced stamp lets one token holder
  // drive ~172 000 writes a day into a Turso project the whole fleet shares,
  // with `overages: false` — where crossing quota blocks reads AND writes for
  // every site at once. These tests are what keep that closed.
  it("does not rewrite opened_at on an immediate second open", async () => {
    const { db, token } = await seed();
    await touchProspectAuditOpened(db, token);
    expect((await getProspectAuditByToken(db, token))!.opened_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    // Backdated one second — still deep inside the window, so nothing about
    // what is being tested changes, but far enough that a write WOULD move the
    // value by a visible amount. Without this the calls below can all land in
    // the same millisecond, and then the assertion compares a timestamp to
    // itself and passes against an UNCOALESCED function. It did red under
    // mutation without the backdate, but by luck rather than by design, and a
    // check that needs luck to fail is not evidence.
    const first = await backdateOpenedAt(db, token, 1000);

    await touchProspectAuditOpened(db, token);
    await touchProspectAuditOpened(db, token);
    await touchProspectAuditOpened(db, token);

    expect((await getProspectAuditByToken(db, token))!.opened_at).toBe(first);
  });

  it("still stamps once the window has passed", async () => {
    const { db, token } = await seed();
    // One second the far side of the window, so the test asserts the boundary
    // rather than some comfortable multiple of it.
    const stale = await backdateOpenedAt(db, token, OPENED_AT_COALESCE_MS + 1000);

    await touchProspectAuditOpened(db, token);

    const after = (await getProspectAuditByToken(db, token))!.opened_at;
    expect(after).not.toBe(stale);
    expect(Date.parse(after!)).toBeGreaterThan(Date.parse(stale));
  });

  it("holds an open that is inside the window, right up to the edge", async () => {
    // The other side of the same boundary: a value one second INSIDE the window
    // must not move. Without this the "still stamps" test above is satisfied by
    // a function that always writes.
    const { db, token } = await seed();
    const recent = await backdateOpenedAt(db, token, OPENED_AT_COALESCE_MS - 1000);

    await touchProspectAuditOpened(db, token);

    expect((await getProspectAuditByToken(db, token))!.opened_at).toBe(recent);
  });

  it("always stamps a report nobody has opened yet", async () => {
    // The NULL arm of the condition, which is the one that matters most: a
    // report's first open must never be lost to the window.
    const { db, token } = await seed();
    expect((await getProspectAuditByToken(db, token))!.opened_at).toBeNull();
    await touchProspectAuditOpened(db, token);
    expect((await getProspectAuditByToken(db, token))!.opened_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("coalescing is scoped to the token, and does not shield another report", async () => {
    // A window keyed on the wrong thing would let one busy report suppress
    // another's first open entirely.
    const { db, token } = await seed();
    const other = await createProspectAudit(db, {
      url: "https://other.test/",
      business: null,
      resultJson: "{}",
    });

    await touchProspectAuditOpened(db, token);
    await touchProspectAuditOpened(db, other.token);

    expect((await getProspectAuditByToken(db, other.token))!.opened_at).toMatch(
      /^\d{4}-\d{2}-\d{2}T/,
    );
  });
});

describe("setProspectAuditOverrides — last write wins", () => {
  it("a second write replaces the first wholesale rather than merging it", async () => {
    // Pinned as a DECISION, not left as an accident: two concurrent operators
    // silently clobber each other, and this is the test that would fail if
    // someone later added a merge or an optimistic check without saying so.
    const { db, token } = await seed();
    await setProspectAuditOverrides(db, token, { a: { original: "1", text: "one" } });
    const first = await getProspectAuditByToken(db, token);

    await setProspectAuditOverrides(db, token, { b: { original: "2", text: "two" } });

    const second = await getProspectAuditByToken(db, token);
    const stored = JSON.parse(second!.overrides_json!) as Record<string, unknown>;
    expect(stored).toEqual({ b: { original: "2", text: "two" } });
    expect(stored).not.toHaveProperty("a");
    // `edited_at` is the column an optimistic check would key on if a second
    // editor ever exists: it moves forward on every write, including this one.
    expect(Date.parse(second!.edited_at!)).toBeGreaterThanOrEqual(Date.parse(first!.edited_at!));
  });
});

describe("setProspectAuditOverrides — inputs that are not plain objects", () => {
  // `Object.values()` on a Map, a Set or a Date returns [], and `[].every(...)`
  // is vacuously true — so a validator that only walks the values approves all
  // three, reports "updated", and stamps edited_at over a value the caller
  // never meant to store. Measured before the fix: the Map and the Set stored
  // `{}`, and the Date stored a JSON STRING where the map should be.
  it("refuses a Map without storing the empty object it serialises to", async () => {
    const { db, token } = await seed();
    const res = await setProspectAuditOverrides(
      db,
      token,
      new Map([["k", { original: "a", text: "b" }]]) as unknown as OverrideMap,
    );
    expect(res.status).toBe("invalid");
    const row = await getProspectAuditByToken(db, token);
    expect(row!.overrides_json).toBeNull();
    expect(row!.edited_at).toBeNull();
  });

  it("refuses a Set", async () => {
    const { db, token } = await seed();
    const res = await setProspectAuditOverrides(
      db,
      token,
      new Set([{ original: "a", text: "b" }]) as unknown as OverrideMap,
    );
    expect(res.status).toBe("invalid");
    const row = await getProspectAuditByToken(db, token);
    expect(row!.overrides_json).toBeNull();
    expect(row!.edited_at).toBeNull();
  });

  it("refuses a Date, which would be stored as a bare JSON string", async () => {
    const { db, token } = await seed();
    const res = await setProspectAuditOverrides(
      db,
      token,
      new Date("2026-01-01T00:00:00.000Z") as unknown as OverrideMap,
    );
    expect(res.status).toBe("invalid");
    const row = await getProspectAuditByToken(db, token);
    expect(row!.overrides_json).toBeNull();
    expect(row!.edited_at).toBeNull();
  });

  it("accepts a null-prototype object, which is a plain object for JSON purposes", async () => {
    // `Object.create(null)` stringifies exactly like `{}` — the prototype check
    // must not turn a legitimate map into a rejection.
    const { db, token } = await seed();
    const map = Object.create(null) as OverrideMap;
    map.k = { original: "a", text: "b" };
    const res = await setProspectAuditOverrides(db, token, map);
    expect(res.status).toBe("updated");
    const row = await getProspectAuditByToken(db, token);
    expect(JSON.parse(row!.overrides_json!)).toEqual({ k: { original: "a", text: "b" } });
  });
});

describe("setProspectAuditOverrides — the stored map is the map that was validated", () => {
  // Every entry here goes through the gap between "what was checked" and "what
  // was serialised": the validator approved one object and `JSON.stringify` was
  // handed a different one. The stored map is now BUILT from the validated
  // strings, so the two cannot differ.
  const PAIR = '{"k":{"original":"a","text":"b"}}';

  it("does not let an entry's toJSON choose the stored bytes", async () => {
    // `JSON.stringify` honours `toJSON`, so this pair validated and stored
    // `{"k":5}` — bytes the validator never saw, in the one place that claims to
    // be the only gate a malformed value can be caught at.
    const { db, token } = await seed();
    const res = await setProspectAuditOverrides(db, token, {
      k: { original: "a", text: "b", toJSON: () => 5 },
    } as unknown as OverrideMap);
    expect(res.status).toBe("updated");
    const row = await getProspectAuditByToken(db, token);
    expect(row!.overrides_json).toBe(PAIR);
  });

  it("drops extra keys on an entry rather than storing them", async () => {
    const { db, token } = await seed();
    const res = await setProspectAuditOverrides(db, token, {
      k: { original: "a", text: "b", note: "no override means this" },
    } as unknown as OverrideMap);
    expect(res.status).toBe("updated");
    const row = await getProspectAuditByToken(db, token);
    expect(row!.overrides_json).toBe(PAIR);
  });

  it("reads each field once, so a getter cannot answer differently the second time", async () => {
    // The narrow form of the same defect: validate on read one, serialise on
    // read two, store a number where a string was approved.
    const { db, token } = await seed();
    let reads = 0;
    const entry = { text: "b" };
    Object.defineProperty(entry, "original", {
      enumerable: true,
      get: () => (reads++ === 0 ? "a" : 999),
    });
    const res = await setProspectAuditOverrides(db, token, { k: entry } as unknown as OverrideMap);
    expect(res.status).toBe("updated");
    const row = await getProspectAuditByToken(db, token);
    expect(row!.overrides_json).toBe(PAIR);
    expect(reads).toBe(1);
  });

  it("preserves PROPERTY order, not insertion order, so a round trip is stable", async () => {
    // Property order is what `Object.entries` and `JSON.stringify` both use, and
    // it is not the order the keys were written: an integer-like key sorts ahead
    // of every string key, so "2" comes back FIRST however late it went in. This
    // is identical to the previous implementation and moot for the real key
    // space (`composed:headlineFinding` and its siblings are never integer-like)
    // — but a fixture of four string keys cannot tell the two orders apart, so
    // it was asserting insertion order and only ever seeing property order
    // agree. One integer-like key separates them.
    const { db, token } = await seed();
    const inserted = ["z", "a", "2", "m", "b"];
    const map: OverrideMap = {};
    for (const k of inserted) map[k] = { original: `o-${k}`, text: `t-${k}` };
    const res = await setProspectAuditOverrides(db, token, map);
    expect(res.status).toBe("updated");
    const row = await getProspectAuditByToken(db, token);
    expect(Object.keys(JSON.parse(row!.overrides_json!) as OverrideMap)).toEqual([
      "2",
      "z",
      "a",
      "m",
      "b",
    ]);
  });

  it("drops a circular reference in an extra key instead of refusing the write", async () => {
    // This was `invalid` while the caller's own object was serialised, because
    // the cycle threw in `JSON.stringify`. It lives in a key that is not part of
    // an override; the validated pair is two strings and always serialises.
    const { db, token } = await seed();
    const entry: Record<string, unknown> = { original: "a", text: "b" };
    entry.self = entry;
    const res = await setProspectAuditOverrides(db, token, { k: entry } as unknown as OverrideMap);
    expect(res.status).toBe("updated");
    const row = await getProspectAuditByToken(db, token);
    expect(row!.overrides_json).toBe(PAIR);
  });

  it("drops a BigInt in an extra key instead of refusing the write", async () => {
    const { db, token } = await seed();
    const res = await setProspectAuditOverrides(db, token, {
      k: { original: "a", text: "b", n: 1n },
    } as unknown as OverrideMap);
    expect(res.status).toBe("updated");
    const row = await getProspectAuditByToken(db, token);
    expect(row!.overrides_json).toBe(PAIR);
  });
});

describe("setProspectAuditOverrides — the extra-key policy is DROP, not reject", () => {
  it("an unknown key on an entry is accepted and dropped, never refused", async () => {
    // The policy pinned AS a policy, rather than left to be inferred from the
    // incidental cases that happen to exercise it (the cycle and the BigInt,
    // whose statuses flipped with the rewrite). Dropping is NOT forced by
    // building the stored map out of the validated fields: a validator that
    // built the same way and REJECTED any entry key other than `original` and
    // `text` would close every one of the same gaps. Drop was chosen because
    // nothing downstream reads a third key, and this is the test that fails if
    // someone later turns the choice into a rejection without saying so.
    const { db, token } = await seed();
    const res = await setProspectAuditOverrides(db, token, {
      k: { original: "a", text: "b", futureField: "a field this schema has not learned yet" },
    } as unknown as OverrideMap);
    expect(res.status).toBe("updated");
    const row = await getProspectAuditByToken(db, token);
    expect(row!.overrides_json).toBe('{"k":{"original":"a","text":"b"}}');
    expect(row!.edited_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe("setProspectAuditOverrides — inputs that throw while they are read", () => {
  it("refuses a throwing getter, whose error escapes validation itself", async () => {
    const { db, token } = await seed();
    const map = {};
    Object.defineProperty(map, "k", {
      enumerable: true,
      get() {
        throw new Error("getter boom");
      },
    });
    const res = await setProspectAuditOverrides(db, token, map as OverrideMap);
    expect(res.status).toBe("invalid");
    const row = await getProspectAuditByToken(db, token);
    expect(row!.overrides_json).toBeNull();
  });
});

describe("setProspectAuditOverrides — the size cap", () => {
  /** A map whose serialised JSON is EXACTLY `target` characters long: every
   *  added "x" adds one character to the string, so the padding is the target
   *  minus the length of the same map with an empty `text`. */
  function mapOfSerialisedLength(target: number): OverrideMap {
    const base = JSON.stringify({ k: { original: "", text: "" } }).length;
    return { k: { original: "", text: "x".repeat(target - base) } };
  }

  it("refuses a map one character over the cap", async () => {
    const { db, token } = await seed();
    const map = mapOfSerialisedLength(OVERRIDES_MAX_LEN + 1);
    expect(JSON.stringify(map).length).toBe(OVERRIDES_MAX_LEN + 1);
    const res = await setProspectAuditOverrides(db, token, map);
    expect(res.status).toBe("invalid");
    const row = await getProspectAuditByToken(db, token);
    expect(row!.overrides_json).toBeNull();
    expect(row!.edited_at).toBeNull();
  });

  it("accepts a map exactly at the cap", async () => {
    const { db, token } = await seed();
    const map = mapOfSerialisedLength(OVERRIDES_MAX_LEN);
    expect(JSON.stringify(map).length).toBe(OVERRIDES_MAX_LEN);
    const res = await setProspectAuditOverrides(db, token, map);
    expect(res.status).toBe("updated");
    const row = await getProspectAuditByToken(db, token);
    expect(row!.overrides_json!.length).toBe(OVERRIDES_MAX_LEN);
  });

  it("measures the cap on the constructed string, not on the caller's object", async () => {
    // Both maps above serialise identically either way, so neither says WHICH
    // string the cap is measured on. This one does: the caller's object is over
    // the cap and the pair that gets stored is 33 characters.
    const { db, token } = await seed();
    const map = {
      k: { original: "a", text: "b", junk: "x".repeat(OVERRIDES_MAX_LEN) },
    } as unknown as OverrideMap;
    expect(JSON.stringify(map).length).toBeGreaterThan(OVERRIDES_MAX_LEN);
    const res = await setProspectAuditOverrides(db, token, map);
    expect(res.status).toBe("updated");
    const row = await getProspectAuditByToken(db, token);
    expect(row!.overrides_json).toBe('{"k":{"original":"a","text":"b"}}');
  });
});

describe("setProspectAuditOverrides — __proto__", () => {
  it("refuses a map carrying a __proto__ key rather than storing or stripping it", async () => {
    // Built through JSON.parse, exactly as the route's body arrives: that makes
    // `__proto__` an ordinary own key rather than a prototype assignment. Stored
    // verbatim, a consumer doing `Object.assign({}, parsed)` DOES get its
    // prototype replaced. Rejected rather than stripped for the distinction the
    // validator draws, not for a general rule against silent drops — a rule like
    // that would condemn the entry-key drop above. A TOP-LEVEL key is a whole
    // override, so stripping one would discard operator content and still say
    // `updated`; an entry key is read by nobody, so dropping one loses nothing.
    const { db, token } = await seed();
    const map = JSON.parse(
      '{"__proto__":{"original":"a","text":"b"},"ok":{"original":"c","text":"d"}}',
    ) as OverrideMap;
    const res = await setProspectAuditOverrides(db, token, map);
    expect(res.status).toBe("invalid");
    const row = await getProspectAuditByToken(db, token);
    expect(row!.overrides_json).toBeNull();
    expect(row!.edited_at).toBeNull();
  });
});
