import { describe, it, expect } from "vitest";
import { fromAirtableBase } from "../../src/inventory/airtable.js";
import { makeFakeBase } from "../reports/_helpers/fake-airtable-base.js";

describe("fromAirtableBase gitRepo", () => {
  it("threads the Git repo field onto the Site", async () => {
    const base = makeFakeBase({
      Websites: [
        {
          id: "rec1",
          fields: {
            Name: "ERP",
            url: "https://erpfunds.com",
            "maintenence freq": "Monthly",
            "Git repo": "tucksravin/erpfunds",
            Status: "maintenance",
          },
        },
      ],
    });
    const sites = await fromAirtableBase(base, { workdir: "/tmp/sites" })();
    expect(sites[0]!.gitRepo).toBe("tucksravin/erpfunds");
  });

  it("leaves gitRepo undefined when the Git repo field is absent", async () => {
    const base = makeFakeBase({
      Websites: [
        {
          id: "rec2",
          fields: {
            Name: "NoRepo",
            url: "https://norepo.example.com",
            "maintenence freq": "Monthly",
            Status: "maintenance",
          },
        },
      ],
    });
    const sites = await fromAirtableBase(base, { workdir: "/tmp/sites" })();
    expect(sites[0]!.gitRepo).toBeUndefined();
  });
});
