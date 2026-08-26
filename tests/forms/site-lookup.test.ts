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
    const lookup = makeSiteLookup(
      { fromDb: async () => null, fromAirtable: async () => SITE },
      false,
    );
    expect(await lookup("acme")).toBe(SITE);
  });

  it("both misses → null (unknown-site 404 upstream)", async () => {
    const lookup = makeSiteLookup(
      { fromDb: async () => null, fromAirtable: async () => null },
      false,
    );
    expect(await lookup("nope")).toBeNull();
  });

  it("an Airtable failure during the fallback PROPAGATES — the dead-letter's contract", async () => {
    const lookup = makeSiteLookup(
      {
        fromDb: async () => null,
        fromAirtable: async () => {
          throw new Error("airtable down");
        },
      },
      false,
    );
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

/**
 * #612: after the freeze, form ingest reads ONE store.
 *
 * The fallback existed for a site created directly in the Airtable UI before the
 * next hourly import. Nothing hand-creates rows after the freeze, and
 * `ensure-site` inserts straight into Turso (#608), so that window is gone — and
 * consulting a frozen base would resolve a lead against a row the system no
 * longer believes in.
 */
describe("makeSiteLookup — frozen", () => {
  it("does not consult Airtable at all on a Turso miss", async () => {
    const fromAirtable = vi.fn();
    const lookup = makeSiteLookup({ fromDb: async () => null, fromAirtable }, true);
    expect(await lookup("nope")).toBeNull();
    expect(fromAirtable).not.toHaveBeenCalled();
  });

  it("still returns a Turso hit (positive control)", async () => {
    const fromAirtable = vi.fn();
    const lookup = makeSiteLookup({ fromDb: async () => SITE, fromAirtable }, true);
    expect(await lookup("acme")).toBe(SITE);
    expect(fromAirtable).not.toHaveBeenCalled();
  });
});
