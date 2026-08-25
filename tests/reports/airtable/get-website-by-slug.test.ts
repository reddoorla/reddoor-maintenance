import { describe, it, expect } from "vitest";
import { getWebsiteBySlug } from "../../../src/reports/airtable/websites.js";
import { makeFakeBase, type CapturedCall } from "../_helpers/fake-airtable-base.js";

function seed(names: string[]) {
  return makeFakeBase({
    Websites: names.map((name, i) => ({
      id: `rec${i}`,
      fields: { Name: name, Status: "maintenance" },
    })),
  });
}

const firstSelect = (calls: CapturedCall[]) =>
  calls.find((c): c is Extract<CapturedCall, { kind: "select" }> => c.kind === "select");

describe("getWebsiteBySlug", () => {
  // MEDIUM-H (2026-06-10 brief): was an unbounded full-table scan per request.
  it("narrows the fetch with filterByFormula + maxRecords instead of scanning the table", async () => {
    const base = seed(["Acme Co", "Beta Corp"]);
    await getWebsiteBySlug(base, "beta-corp");
    const select = firstSelect(base.__calls);
    expect(select).toBeDefined();
    // The formula replicates siteSlug() on {Name}; verified against live Airtable.
    expect(typeof select?.opts.filterByFormula).toBe("string");
    expect(select?.opts.filterByFormula as string).toContain("beta-corp");
    expect(select?.opts.maxRecords).toBe(1);
  });

  it("returns the matching row (confirmed in JS even when the fake ignores the formula)", async () => {
    const base = seed(["Acme Co", "Beta Corp"]);
    const row = await getWebsiteBySlug(base, "beta-corp");
    expect(row?.name).toBe("Beta Corp");
  });

  it("returns null when no row matches the slug", async () => {
    const base = seed(["Acme Co"]);
    expect(await getWebsiteBySlug(base, "nope")).toBeNull();
  });

  // REGRESSION (2026-08-24): mapRow took `attachments[0]`, but Airtable's
  // uploadAttachment APPENDS — so the newest file is the TAIL. Any field that ever held
  // more than one served its OLDEST image forever, which is how a pre-clean-plate header
  // reached a live announcement and got a second headline stamped over it (#574/#577).
  it("maps the NEWEST Header image attachment, not the first ever uploaded", async () => {
    const base = makeFakeBase({
      Websites: [
        {
          id: "rec0",
          fields: {
            Name: "Acme Co",
            Status: "maintenance",
            "Header image": [
              { url: "https://x/old.jpg", filename: "old.jpg", type: "image/jpeg" },
              { url: "https://x/new.jpg", filename: "new.jpg", type: "image/jpeg" },
            ],
          },
        },
      ],
    });
    const row = await getWebsiteBySlug(base, "acme-co");
    expect(row?.headerImage?.filename).toBe("new.jpg");
  });

  it("rejects non-slug input without querying Airtable (formula-injection guard)", async () => {
    const base = seed(["Acme Co"]);
    const row = await getWebsiteBySlug(base, 'x") = 1 OR ""="');
    expect(row).toBeNull();
    expect(firstSelect(base.__calls)).toBeUndefined();
  });
});
