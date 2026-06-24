import { describe, it, expect } from "vitest";
import {
  setSiteDetail,
  EDITABLE_SITE_FIELDS,
  type SiteDetailDeps,
} from "../../src/dashboard/site-details.js";
import { makeWebsiteRow } from "../_helpers/website-row.js";

function harness(over: Partial<SiteDetailDeps> = {}) {
  const writes: Array<{ id: string; column: string; value: string }> = [];
  const deps: SiteDetailDeps = {
    getSite: async () => makeWebsiteRow({ id: "recA", name: "Acme" }),
    updateField: async (id, column, value) => {
      writes.push({ id, column, value });
    },
    ...over,
  };
  return { deps, writes };
}

describe("setSiteDetail", () => {
  it("rejects an unknown field BEFORE any read (bad-field)", async () => {
    let read = false;
    const r = await setSiteDetail(
      {
        getSite: async () => {
          read = true;
          return makeWebsiteRow({ id: "r", name: "X" });
        },
        updateField: async () => {},
      },
      "acme",
      "DNS password",
      "hax",
    );
    expect(r.status).toBe("bad-field");
    expect(read).toBe(false);
  });

  it("writes an enum field to its exact Airtable column", async () => {
    const { deps, writes } = harness();
    const r = await setSiteDetail(deps, "acme", "status", "hosting");
    expect(r.status).toBe("updated");
    expect(writes).toEqual([{ id: "recA", column: "Status", value: "hosting" }]);
  });

  it("rejects an enum value not in the options (invalid, no write)", async () => {
    const { deps, writes } = harness();
    const r = await setSiteDetail(deps, "acme", "maintenanceFreq", "Weekly");
    expect(r.status).toBe("invalid");
    expect(writes).toEqual([]);
  });

  it("writes maintenanceFreq to the misspelled Airtable column", async () => {
    const { deps, writes } = harness();
    await setSiteDetail(deps, "acme", "maintenanceFreq", "Monthly");
    expect(writes[0]!.column).toBe("maintenence freq");
  });

  it("validates an email field and rejects a malformed address", async () => {
    const { deps, writes } = harness();
    expect((await setSiteDetail(deps, "acme", "pointOfContact", "not-an-email")).status).toBe(
      "invalid",
    );
    expect(writes).toEqual([]);
    expect((await setSiteDetail(deps, "acme", "pointOfContact", "a@b.com")).status).toBe("updated");
  });

  it("normalizes an emails list (split, trim, rejoin) and rejects a bad member", async () => {
    const { deps, writes } = harness();
    await setSiteDetail(deps, "acme", "reportRecipientsTo", "a@b.com,\n c@d.com ");
    expect(writes[0]).toEqual({
      id: "recA",
      column: "Report recipients (To)",
      value: "a@b.com, c@d.com",
    });
    expect((await setSiteDetail(deps, "acme", "reportRecipientsTo", "a@b.com, nope")).status).toBe(
      "invalid",
    );
  });

  it("validates a git repo shape (owner/repo)", async () => {
    const { deps } = harness();
    expect((await setSiteDetail(deps, "acme", "gitRepo", "not a repo")).status).toBe("invalid");
    expect((await setSiteDetail(deps, "acme", "gitRepo", "reddoorla/acme")).status).toBe("updated");
  });

  it("allows clearing a text/email field to empty", async () => {
    const { deps, writes } = harness();
    expect((await setSiteDetail(deps, "acme", "searchQuery", "  ")).status).toBe("updated");
    expect(writes[0]!.value).toBe("");
  });

  it("returns not-found when the slug resolves to no site", async () => {
    const r = await setSiteDetail(
      { getSite: async () => null, updateField: async () => {} },
      "ghost",
      "status",
      "hosting",
    );
    expect(r.status).toBe("not-found");
  });

  it("EDITABLE_SITE_FIELDS column strings match the Airtable mapRow columns", () => {
    expect(EDITABLE_SITE_FIELDS.status!.column).toBe("Status");
    expect(EDITABLE_SITE_FIELDS.pointOfContact!.column).toBe("point of contact");
    expect(EDITABLE_SITE_FIELDS.copyIntro!.column).toBe("Copy — Intro");
  });
});
