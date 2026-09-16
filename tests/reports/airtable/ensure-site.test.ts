import { describe, it, expect } from "vitest";
import { ensureSite } from "../../../src/reports/airtable/ensure-site.js";
import { makeFakeBase, type FakeRecord } from "../_helpers/fake-airtable-base.js";

function existingSite(over: Partial<FakeRecord["fields"]> = {}): FakeRecord {
  return {
    id: "recEXIST",
    fields: {
      Name: "Acme Co",
      url: "https://acme.example.com",
      Status: "maintenance",
      ...over,
    },
  };
}

describe("ensureSite", () => {
  it("creates a row with building defaults when the slug is unknown", async () => {
    const base = makeFakeBase({ Websites: [] });
    const result = await ensureSite(base, {
      slug: "roalson",
      url: "https://roalson.netlify.app",
      pointOfContact: "owner@roalson.com",
    });
    expect(result.status).toBe("created");
    const create = base.__calls.find((c) => c.kind === "create" && c.table === "Websites");
    expect(create).toBeDefined();
    const fields = (create as { records: Array<{ fields: Record<string, unknown> }> }).records[0]!
      .fields;
    expect(fields).toMatchObject({
      Name: "roalson",
      Status: "building",
      url: "https://roalson.netlify.app",
      "point of contact": "owner@roalson.com",
      "Git repo": "reddoorla/roalson",
    });
  });

  it("matches an existing row by slug (Name slugifies to the input) and does NOT create", async () => {
    const base = makeFakeBase({ Websites: [existingSite()] });
    const result = await ensureSite(base, { slug: "acme-co" });
    expect(result.status).toBe("exists");
    expect(base.__calls.some((c) => c.kind === "create")).toBe(false);
  });

  it("fills ONLY blank fields on an existing row — never overwrites operator data", async () => {
    const base = makeFakeBase({
      Websites: [existingSite({ url: undefined, "point of contact": "kept@client.com" })],
    });
    const result = await ensureSite(base, {
      slug: "acme-co",
      url: "https://acme.example.com",
      pointOfContact: "IGNORED@example.com",
    });
    expect(result.status).toBe("exists");
    expect(result.updatedFields).toEqual(["url"]);
    const update = base.__calls.find((c) => c.kind === "update");
    expect(update).toBeDefined();
    const fields = (update as { records: Array<{ fields: Record<string, unknown> }> }).records[0]!
      .fields;
    expect(fields).toEqual({ url: "https://acme.example.com" });
  });

  it("is a no-op update when nothing is blank", async () => {
    const base = makeFakeBase({
      Websites: [
        existingSite({
          "point of contact": "kept@client.com",
          "Git repo": "reddoorla/acme-co",
        }),
      ],
    });
    const result = await ensureSite(base, {
      slug: "acme-co",
      url: "https://elsewhere.example.com",
      pointOfContact: "x@y.com",
      gitRepo: "reddoorla/other",
    });
    expect(result.updatedFields).toEqual([]);
    expect(base.__calls.some((c) => c.kind === "update")).toBe(false);
  });

  it("re-running after create finds the row as exists — exactly one create ever happens", async () => {
    const base = makeFakeBase({ Websites: [] });
    const first = await ensureSite(base, { slug: "roalson" });
    expect(first.status).toBe("created");
    const second = await ensureSite(base, { slug: "roalson" });
    expect(second.status).toBe("exists");
    expect(second.updatedFields).toEqual([]);
    expect(base.__calls.filter((c) => c.kind === "create")).toHaveLength(1);
  });

  it("bare create writes EXACTLY the three defaults — no frequencies, no extras", async () => {
    const base = makeFakeBase({ Websites: [] });
    await ensureSite(base, { slug: "roalson" });
    const create = base.__calls.find((c) => c.kind === "create")!;
    const fields = (create as { records: Array<{ fields: Record<string, unknown> }> }).records[0]!
      .fields;
    expect(fields).toEqual({
      Name: "roalson",
      Status: "building",
      "Git repo": "reddoorla/roalson",
    });
  });

  it("slugifies a messy input for Name and the Git repo default", async () => {
    const base = makeFakeBase({ Websites: [] });
    await ensureSite(base, { slug: "Roalson.TX" });
    const create = base.__calls.find((c) => c.kind === "create")!;
    const fields = (create as { records: Array<{ fields: Record<string, unknown> }> }).records[0]!
      .fields;
    expect(fields["Name"]).toBe("roalson-tx");
    expect(fields["Git repo"]).toBe("reddoorla/roalson-tx");
  });

  it("writes the display name on create and rejects one that slugifies elsewhere", async () => {
    const base = makeFakeBase({ Websites: [] });
    await ensureSite(base, { slug: "roalson", displayName: "Roalson" });
    const create = base.__calls.find((c) => c.kind === "create")!;
    const fields = (create as { records: Array<{ fields: Record<string, unknown> }> }).records[0]!
      .fields;
    expect(fields["Name"]).toBe("Roalson");
    await expect(
      ensureSite(makeFakeBase({ Websites: [] }), { slug: "roalson", displayName: "Acme" }),
    ).rejects.toThrow(/slugifies/);
  });

  it("fills a blank Git repo on the exists path", async () => {
    const base = makeFakeBase({ Websites: [existingSite()] });
    const result = await ensureSite(base, { slug: "acme-co", gitRepo: "reddoorla/acme-co" });
    expect(result.updatedFields).toEqual(["Git repo"]);
  });

  it("reports differing non-blank inputs as skipped mismatches, untouched", async () => {
    const base = makeFakeBase({
      Websites: [existingSite({ "point of contact": "kept@client.com" })],
    });
    const result = await ensureSite(base, {
      slug: "acme-co",
      url: "https://DIFFERENT.example.com",
      pointOfContact: "other@client.com",
    });
    expect(result.skippedMismatches).toEqual(["url", "point of contact"]);
    expect(base.__calls.some((c) => c.kind === "update")).toBe(false);
  });

  it("rejects an empty/unslugifiable slug", async () => {
    const base = makeFakeBase({ Websites: [] });
    await expect(ensureSite(base, { slug: "  " })).rejects.toThrow(/slug/i);
  });
});

/**
 * #539 Phase 5. `ensure-site` is the only path that CREATES a Websites row, and
 * every other site mirror is an UPDATE — which does nothing at all for a row
 * that does not exist yet. Without the create hook a bootstrapped site is
 * invisible to Turso until the next hourly sync, and every mirror the rest of
 * the bootstrap fires reports `mirrored=missed` with no row to update.
 */
describe("ensureSite → the Turso mirror", () => {
  const stub = (opts: { hasRow?: boolean } = {}) => {
    const created: Array<{ id: string; fields: Record<string, unknown> }> = [];
    const updated: Array<{ id: string; fields: Record<string, unknown> }> = [];
    /** Call order across the mirror ops — the heal must precede `site`. */
    const ops: string[] = [];
    const mirror: {
      created: (rec: { id: string; fields: Record<string, unknown> }) => Promise<void>;
      site: (id: string, fields: Record<string, unknown>) => Promise<void>;
      hasRow?: (siteId: string) => Promise<boolean>;
    } = {
      created: async (rec: { id: string; fields: Record<string, unknown> }) => {
        ops.push("created");
        created.push(rec);
      },
      site: async (id: string, fields: Record<string, unknown>) => {
        ops.push("site");
        updated.push({ id, fields });
      },
    };
    if (opts.hasRow !== undefined) {
      mirror.hasRow = async () => {
        ops.push("hasRow");
        return opts.hasRow!;
      };
    }
    return { created, updated, ops, mirror };
  };

  it("hands the created record — as Airtable echoed it — to mirror.created", async () => {
    // What Airtable STORED, not the payload we sent: parity diffs against the
    // stored record, so mapping our own fields would diverge the moment
    // Airtable normalised a value.
    const base = makeFakeBase({ Websites: [] });
    const s = stub();

    const result = await ensureSite(base, { slug: "roalson" }, s.mirror);

    expect(s.created).toHaveLength(1);
    expect(s.created[0]!.id).toBe(result.siteId);
    expect(s.created[0]!.fields).toMatchObject({ Name: "roalson", Status: "building" });
    expect(s.updated).toHaveLength(0);
  });

  it("mirrors the fill-blanks path too", async () => {
    const base = makeFakeBase({
      Websites: [existingSite({ url: undefined })],
    });
    const s = stub();

    await ensureSite(base, { slug: "acme-co", url: "https://acme.example.com" }, s.mirror);

    expect(s.created).toHaveLength(0);
    expect(s.updated).toEqual([{ id: "recEXIST", fields: { url: "https://acme.example.com" } }]);
  });

  it("writes nothing to the mirror when nothing was written to Airtable", async () => {
    const base = makeFakeBase({ Websites: [existingSite()] });
    const s = stub();

    await ensureSite(base, { slug: "acme-co" }, s.mirror);

    expect(s.created).toHaveLength(0);
    expect(s.updated).toHaveLength(0);
  });

  it("#664: exists + a differing --name updates Name in BOTH stores and reports it", async () => {
    // The first real /new-site run created the row before the display name was
    // settled, so Name was the bare slug — the value client-facing copy uses
    // VERBATIM. Re-running with --name printed `exists` and silently dropped
    // the flag: it was read on the create path only. Name is the one field the
    // flag explicitly targets, so a differing value is the operator's
    // correction, not a fill-blanks candidate.
    const base = makeFakeBase({ Websites: [existingSite({ Name: "acme-co" })] });
    const s = stub({ hasRow: true });
    const result = await ensureSite(base, { slug: "acme-co", displayName: "Acme Co" }, s.mirror);

    expect(result.status).toBe("exists");
    expect(result.updatedFields).toContain("Name");
    const updates = base.__calls.filter((c) => c.kind === "update");
    expect(updates).toHaveLength(1);
    expect(updates[0]!.kind === "update" && updates[0]!.records[0]!.fields).toMatchObject({
      Name: "Acme Co",
    });
    // Turso must get the new name too, through the same site-mirror path.
    expect(s.updated).toEqual([
      { id: "recEXIST", fields: expect.objectContaining({ Name: "Acme Co" }) },
    ]);
  });

  it("#664: exists + the SAME --name writes nothing (idempotent re-run)", async () => {
    const base = makeFakeBase({ Websites: [existingSite({ Name: "Acme Co" })] });
    const s = stub({ hasRow: true });
    const result = await ensureSite(base, { slug: "acme-co", displayName: "Acme Co" }, s.mirror);
    expect(result.updatedFields).toEqual([]);
    expect(base.__calls.filter((c) => c.kind === "update")).toHaveLength(0);
    expect(s.updated).toEqual([]);
  });

  it("still works with no mirror injected (the pre-Phase-5 callers)", async () => {
    const base = makeFakeBase({ Websites: [] });
    await expect(ensureSite(base, { slug: "roalson" })).resolves.toMatchObject({
      status: "created",
    });
  });
});

/**
 * #645 item 1 — the `exists` path had no idea whether Turso held a row.
 *
 * Post-flip that is the fleet's only silent lead-loser: an Airtable row with no
 * Turso row resolves to nothing in `getSiteBySlug`, so every lead for that site
 * is answered `unknown-site`. `ensure-site` is the one command an operator
 * already re-runs to fix a half-created site, so it is where the heal belongs —
 * and it is the ONLY place in the fleet that both knows a site is real and can
 * insert it (`mirrorSiteInsert` is an upsert, so healing is idempotent).
 */
describe("ensureSite → healing a missing Turso row (#645)", () => {
  const stub = (opts: { hasRow?: boolean } = {}) => {
    const created: Array<{ id: string; fields: Record<string, unknown> }> = [];
    const updated: Array<{ id: string; fields: Record<string, unknown> }> = [];
    const ops: string[] = [];
    const mirror: {
      created: (rec: { id: string; fields: Record<string, unknown> }) => Promise<void>;
      site: (id: string, fields: Record<string, unknown>) => Promise<void>;
      hasRow?: (siteId: string) => Promise<boolean>;
    } = {
      created: async (rec) => {
        ops.push("created");
        created.push(rec);
      },
      site: async (id, fields) => {
        ops.push("site");
        updated.push({ id, fields });
      },
    };
    if (opts.hasRow !== undefined) {
      mirror.hasRow = async () => {
        ops.push("hasRow");
        return opts.hasRow!;
      };
    }
    return { created, updated, ops, mirror };
  };

  it("inserts the stored Airtable record when Turso has NO row for the site", async () => {
    const base = makeFakeBase({ Websites: [existingSite()] });
    const s = stub({ hasRow: false });

    const result = await ensureSite(base, { slug: "acme-co" }, s.mirror);

    expect(result.status).toBe("exists");
    expect(result.healedDbRow).toBe(true);
    // The record as AIRTABLE STORED it, exactly like the create path — parity
    // diffs Turso against the stored record.
    expect(s.created).toEqual([
      { id: "recEXIST", fields: expect.objectContaining({ Name: "Acme Co" }) },
    ]);
  });

  it("does nothing when Turso already holds the row", async () => {
    const base = makeFakeBase({ Websites: [existingSite()] });
    const s = stub({ hasRow: true });

    const result = await ensureSite(base, { slug: "acme-co" }, s.mirror);

    expect(result.healedDbRow).toBe(false);
    expect(s.created).toHaveLength(0);
  });

  it("heals BEFORE the fill-blanks mirror update, so that UPDATE has a row to match", async () => {
    // Order is load-bearing: `mirror.site` is an UPDATE, and under the freeze a
    // no-match THROWS (`SITE_MIRROR … no such row in Turso`). Healing second
    // would abort ensure-site on exactly the site it exists to repair.
    const base = makeFakeBase({ Websites: [existingSite({ url: undefined })] });
    const s = stub({ hasRow: false });

    await ensureSite(base, { slug: "acme-co", url: "https://acme.example.com" }, s.mirror);

    expect(s.ops).toEqual(["hasRow", "created", "site"]);
  });

  it("never checks, and never heals, on the CREATE path", async () => {
    const base = makeFakeBase({ Websites: [] });
    const s = stub({ hasRow: false });

    const result = await ensureSite(base, { slug: "roalson" }, s.mirror);

    expect(result.status).toBe("created");
    expect(result.healedDbRow).toBe(false);
    expect(s.ops).toEqual(["created"]);
  });

  it("is inert for a mirror with no hasRow (every pre-#645 caller)", async () => {
    const base = makeFakeBase({ Websites: [existingSite()] });
    const s = stub();

    const result = await ensureSite(base, { slug: "acme-co" }, s.mirror);

    expect(result.healedDbRow).toBe(false);
    expect(s.ops).toEqual([]);
  });
});
