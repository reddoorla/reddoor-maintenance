import { describe, it, expect, afterEach, vi } from "vitest";
import {
  ensureSite,
  type LegacyAirtableSites,
  type SiteIdentityPatch,
  type SiteStore,
} from "../../src/fleet/ensure-site.js";

vi.mock("../../src/db/freeze.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/db/freeze.js")>()),
  AIRTABLE_SHADOW_WRITES: true,
}));

const QUOTA = "Airtable monthly API call quota exhausted";
const PATCH = { url: "https://acme.example.com", pointOfContact: "owner@acme.example.com" };

afterEach(() => vi.restoreAllMocks());

function stores(fail: boolean) {
  const log: string[] = [];
  const turso: Array<{ id: string; patch: SiteIdentityPatch }> = [];
  const airtable: Array<{ id: string; patch: SiteIdentityPatch }> = [];
  const store: SiteStore = {
    findBySlug: async () => ({
      id: "recEXIST",
      name: "acme-co",
      url: null,
      pointOfContact: null,
      gitRepo: "reddoorla/acme-co",
    }),
    create: async () => {
      throw new Error("create must not run on the exists path");
    },
    updateIdentity: async (id, patch) => {
      log.push(`turso:${id}`);
      turso.push({ id, patch });
      return true;
    },
  };
  const legacy: LegacyAirtableSites = {
    findBySlug: async () => null,
    adopt: async () => {},
    update: async (id, patch) => {
      log.push(`airtable:${id}`);
      airtable.push({ id, patch });
      if (fail) throw Object.assign(new Error(QUOTA), { code: "AIRTABLE_QUOTA_EXHAUSTED" });
    },
  };
  return { log, turso, airtable, deps: { store, airtable: legacy } };
}

describe("ensureSite writes a rec site's fill to Turso before the Airtable shadow", () => {
  it("Turso first, then the identical patch to Airtable (known-good control)", async () => {
    const { log, turso, airtable, deps } = stores(false);
    const result = await ensureSite({ slug: "acme-co", ...PATCH }, deps);
    expect(log).toEqual(["turso:recEXIST", "airtable:recEXIST"]);
    expect(turso).toEqual([{ id: "recEXIST", patch: PATCH }]);
    expect(airtable).toEqual(turso);
    expect(result).toMatchObject({ status: "exists", airtableShadow: "written" });
  });

  it("a failed Airtable shadow still lands the Turso fill, and still rejects", async () => {
    const { turso, deps } = stores(true);
    await expect(ensureSite({ slug: "acme-co", ...PATCH }, deps)).rejects.toThrow(QUOTA);
    expect(turso).toEqual([{ id: "recEXIST", patch: PATCH }]);
  });
});
