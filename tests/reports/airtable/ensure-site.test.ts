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
  it("creates a row with in-development defaults when the slug is unknown", async () => {
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
      Status: "in development",
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

  it("rejects an empty/unslugifiable slug", async () => {
    const base = makeFakeBase({ Websites: [] });
    await expect(ensureSite(base, { slug: "  " })).rejects.toThrow(/slug/i);
  });
});
