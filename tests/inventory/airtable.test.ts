import { describe, it, expect, beforeEach } from "vitest";
import { fromAirtableBase } from "../../src/inventory/airtable.js";
import { makeFakeBase } from "../reports/_helpers/fake-airtable-base.js";

beforeEach(() => {
  delete process.env.REDDOOR_FLEET_WORKDIR;
});

describe("fromAirtableBase", () => {
  it("throws if no workdir is provided and REDDOOR_FLEET_WORKDIR isn't set", async () => {
    const base = makeFakeBase({
      Websites: [
        {
          id: "rec_1",
          fields: { Name: "Acme", url: "https://acme.example.com", "maintenence freq": "Monthly" },
        },
      ],
    });
    const provider = fromAirtableBase(base);
    await expect(provider()).rejects.toThrow(/workdir/);
  });

  it("returns one Site per active Websites row", async () => {
    const base = makeFakeBase({
      Websites: [
        {
          id: "rec_1",
          fields: {
            Name: "Acme Co",
            url: "https://acme.example.com",
            "maintenence freq": "Monthly",
          },
        },
        {
          id: "rec_2",
          fields: {
            Name: "Beta Corp",
            url: "https://beta.example.com",
            "maintenence freq": "Quarterly",
          },
        },
      ],
    });
    const provider = fromAirtableBase(base, { workdir: "/tmp/sites" });
    const sites = await provider();
    expect(sites).toHaveLength(2);
    expect(sites[0]!.name).toBe("acme-co");
    expect(sites[0]!.path).toBe("/tmp/sites/acme-co");
    expect(sites[0]!.meta?.airtableRowId).toBe("rec_1");
    expect(sites[0]!.meta?.displayName).toBe("Acme Co");
    expect(sites[0]!.repoUrl).toBe("https://acme.example.com");
  });

  it("excludes sites with both frequencies = None", async () => {
    const base = makeFakeBase({
      Websites: [
        {
          id: "rec_active",
          fields: {
            Name: "Active",
            url: "x",
            "maintenence freq": "Monthly",
            "testing freq": "None",
          },
        },
        {
          id: "rec_inactive",
          fields: {
            Name: "Inactive",
            url: "y",
            "maintenence freq": "None",
            "testing freq": "None",
          },
        },
      ],
    });
    const provider = fromAirtableBase(base, { workdir: "/tmp" });
    const sites = await provider();
    expect(sites.map((s) => s.name)).toEqual(["active"]);
  });

  it("includes sites whose ONLY active frequency is testing", async () => {
    const base = makeFakeBase({
      Websites: [
        {
          id: "rec_test_only",
          fields: {
            Name: "TestOnly",
            url: "z",
            "maintenence freq": "None",
            "testing freq": "Yearly",
          },
        },
      ],
    });
    const sites = await fromAirtableBase(base, { workdir: "/tmp" })();
    expect(sites.map((s) => s.name)).toEqual(["testonly"]);
  });

  it("reads workdir from REDDOOR_FLEET_WORKDIR env when no explicit option", async () => {
    process.env.REDDOOR_FLEET_WORKDIR = "/tmp/env-workdir";
    const base = makeFakeBase({
      Websites: [
        {
          id: "r",
          fields: { Name: "x", url: "y", "maintenence freq": "Monthly" },
        },
      ],
    });
    const sites = await fromAirtableBase(base)();
    expect(sites[0]!.path).toBe("/tmp/env-workdir/x");
  });

  it("explicit workdir wins over env", async () => {
    process.env.REDDOOR_FLEET_WORKDIR = "/tmp/env-workdir";
    const base = makeFakeBase({
      Websites: [
        {
          id: "r",
          fields: { Name: "x", url: "y", "maintenence freq": "Monthly" },
        },
      ],
    });
    const sites = await fromAirtableBase(base, { workdir: "/tmp/explicit" })();
    expect(sites[0]!.path).toBe("/tmp/explicit/x");
  });

  it("omits repoUrl when Websites.url is empty", async () => {
    const base = makeFakeBase({
      Websites: [
        {
          id: "r",
          fields: { Name: "Foo", "maintenence freq": "Monthly" },
        },
      ],
    });
    const sites = await fromAirtableBase(base, { workdir: "/tmp" })();
    expect(sites[0]!.repoUrl).toBeUndefined();
  });
});
