import { describe, it, expect } from "vitest";
import { openDb, readDbConfig } from "../../src/db/client.js";
import {
  createProspectAudit,
  getProspectAuditByToken,
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
});
