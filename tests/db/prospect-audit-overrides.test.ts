import { describe, it, expect } from "vitest";
import { openDb, readDbConfig } from "../../src/db/client.js";
import {
  createProspectAudit,
  getProspectAuditByToken,
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

  it("preserves key order, so a round trip is stable and a diff stays legible", async () => {
    const { db, token } = await seed();
    const keys = ["z", "a", "m", "b"];
    const map: OverrideMap = {};
    for (const k of keys) map[k] = { original: `o-${k}`, text: `t-${k}` };
    const res = await setProspectAuditOverrides(db, token, map);
    expect(res.status).toBe("updated");
    const row = await getProspectAuditByToken(db, token);
    expect(Object.keys(JSON.parse(row!.overrides_json!) as OverrideMap)).toEqual(keys);
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
    // prototype replaced. Rejected, not stripped — a silent strip is a second
    // way to report success for something that was not stored.
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
