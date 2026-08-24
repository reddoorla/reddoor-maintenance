import { describe, it, expect, vi } from "vitest";
import { makeSiteLookup } from "../../src/forms/site-lookup.js";
import { makeWebsiteRow } from "../_helpers/website-row.js";

const SITE = makeWebsiteRow({ id: "recA", name: "Acme" });

describe("makeSiteLookup (Turso-primary, Airtable only for unknown slugs)", () => {
  it("a Turso hit is returned WITHOUT touching Airtable — the hot path is Airtable-free", async () => {
    const fromAirtable = vi.fn();
    const lookup = makeSiteLookup({ fromDb: async () => SITE, fromAirtable });
    expect(await lookup("acme")).toBe(SITE);
    expect(fromAirtable).not.toHaveBeenCalled();
  });

  it("a Turso miss falls back to Airtable (the new-site window)", async () => {
    const lookup = makeSiteLookup({
      fromDb: async () => null,
      fromAirtable: async () => SITE,
    });
    expect(await lookup("acme")).toBe(SITE);
  });

  it("both misses → null (unknown-site 404 upstream)", async () => {
    const lookup = makeSiteLookup({
      fromDb: async () => null,
      fromAirtable: async () => null,
    });
    expect(await lookup("nope")).toBeNull();
  });

  it("an Airtable failure during the fallback PROPAGATES — the dead-letter's contract", async () => {
    const lookup = makeSiteLookup({
      fromDb: async () => null,
      fromAirtable: async () => {
        throw new Error("airtable down");
      },
    });
    await expect(lookup("new-site")).rejects.toThrow("airtable down");
  });

  it("a Turso failure propagates WITHOUT trying Airtable — the store is down, a row would be wasted", async () => {
    const fromAirtable = vi.fn();
    const lookup = makeSiteLookup({
      fromDb: async () => {
        throw new Error("turso down");
      },
      fromAirtable,
    });
    await expect(lookup("acme")).rejects.toThrow("turso down");
    expect(fromAirtable).not.toHaveBeenCalled();
  });
});
