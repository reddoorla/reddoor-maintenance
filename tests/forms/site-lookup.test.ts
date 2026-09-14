import { describe, it, expect, vi } from "vitest";
import { makeSiteLookup, makeLazySiteLookup } from "../../src/forms/site-lookup.js";
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

/**
 * #645 item 3. `db replay-deadletters` resolved its sites against the FROZEN
 * Airtable while the live ingest path resolved against Turso — the recovery tool
 * and the thing it recovers disagreed about what the fleet is. Post-#643 that is
 * backwards in both directions: a site created since the freeze is invisible to
 * the replay, and a row Airtable still holds and Turso does not would attach a
 * recovered lead to a site the system no longer believes in.
 *
 * Both callers now build the lookup HERE, so they cannot drift. Laziness is the
 * other half of the fix and it is load-bearing, not tidiness: `readAirtableConfig()`
 * THROWS when the PAT is unset, and the CLI called it at the top of the replay
 * branch — so a replay that (post-freeze) never consults Airtable was still
 * refused outright by a missing Airtable credential, with real client leads
 * sitting in the queue.
 */
describe("makeLazySiteLookup (#645)", () => {
  const row = makeWebsiteRow({ id: "recSITE" });

  it("answers from Turso and never opens Airtable", async () => {
    const openAirtable = vi.fn(() => ({}) as object);
    const lookup = makeLazySiteLookup(
      {
        fromDb: async () => row,
        openAirtable,
        fromAirtable: async () => null,
      },
      false,
    );

    await expect(lookup("acme")).resolves.toBe(row);
    expect(openAirtable).not.toHaveBeenCalled();
  });

  it("under the freeze, a Turso miss opens NOTHING — not even to be told null", async () => {
    // The whole 08-17 outage class: the Airtable layer must not sit in front of
    // a lead, or in front of a lead's recovery.
    const openAirtable = vi.fn(() => {
      throw new Error("AIRTABLE_PAT is not set");
    });
    const lookup = makeLazySiteLookup(
      { fromDb: async () => null, openAirtable, fromAirtable: async () => row },
      true,
    );

    await expect(lookup("acme")).resolves.toBeNull();
    expect(openAirtable).not.toHaveBeenCalled();
  });

  it("opens Airtable lazily, once, only on the unfrozen fallback", async () => {
    const base = { tag: "base" };
    const openAirtable = vi.fn(() => base);
    const fromAirtable = vi.fn(async () => row);
    const lookup = makeLazySiteLookup(
      { fromDb: async () => null, openAirtable, fromAirtable },
      false,
    );

    await expect(lookup("acme")).resolves.toBe(row);
    expect(openAirtable).toHaveBeenCalledTimes(1);
    expect(fromAirtable).toHaveBeenCalledWith(base, "acme");
  });
});
