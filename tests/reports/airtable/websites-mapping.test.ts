import { describe, it, expect } from "vitest";
import { mapRow } from "../../../src/reports/airtable/websites.js";

function row(fields: Record<string, unknown>) {
  return mapRow({
    id: "recTEST",
    fields: {
      Name: "Acme",
      ...fields,
    },
  });
}

describe("websites/mapRow → dashboardToken", () => {
  it("maps a non-empty Dashboard Token to dashboardToken", () => {
    expect(row({ "Dashboard Token": "abc123xyz" }).dashboardToken).toBe("abc123xyz");
  });

  it("returns null when the Dashboard Token field is absent", () => {
    expect(row({}).dashboardToken).toBeNull();
  });

  it("returns null when the Dashboard Token field is the empty string", () => {
    expect(row({ "Dashboard Token": "" }).dashboardToken).toBeNull();
  });

  it("trims surrounding whitespace (operators occasionally paste with newlines)", () => {
    expect(row({ "Dashboard Token": "  tok  \n" }).dashboardToken).toBe("tok");
  });
});
