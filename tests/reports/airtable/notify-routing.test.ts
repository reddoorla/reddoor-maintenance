import { describe, it, expect } from "vitest";
import { parseNotifyRouting } from "../../../src/reports/airtable/websites.js";

describe("parseNotifyRouting", () => {
  it("parses a valid routing config", () => {
    const r = parseNotifyRouting(
      JSON.stringify({
        field: "interest",
        routes: { Leasing: "a@x.com", Both: ["a@x.com", "b@x.com"] },
        default: "d@x.com",
        cc: ["c@x.com"],
      }),
    );
    expect(r).toEqual({
      field: "interest",
      routes: { Leasing: "a@x.com", Both: ["a@x.com", "b@x.com"] },
      default: "d@x.com",
      cc: ["c@x.com"],
    });
  });

  it("returns null for non-strings, blanks, and malformed JSON", () => {
    expect(parseNotifyRouting(null)).toBeNull();
    expect(parseNotifyRouting(undefined)).toBeNull();
    expect(parseNotifyRouting(42)).toBeNull();
    expect(parseNotifyRouting("   ")).toBeNull();
    expect(parseNotifyRouting("{not json")).toBeNull();
  });

  it("returns null when the shape is wrong (missing field/routes, blank field, arrays)", () => {
    expect(parseNotifyRouting(JSON.stringify({ routes: {} }))).toBeNull(); // no field
    expect(parseNotifyRouting(JSON.stringify({ field: "interest" }))).toBeNull(); // no routes
    expect(parseNotifyRouting(JSON.stringify({ field: "", routes: {} }))).toBeNull(); // blank field
    expect(parseNotifyRouting(JSON.stringify(["interest"]))).toBeNull(); // top-level array
    expect(parseNotifyRouting(JSON.stringify({ field: "i", routes: ["x"] }))).toBeNull(); // routes array
  });

  it("drops non-string cc entries and omits absent optionals", () => {
    const r = parseNotifyRouting(
      JSON.stringify({ field: "interest", routes: { A: "a@x.com" }, cc: ["ok@x.com", 5, null] }),
    );
    expect(r).toEqual({ field: "interest", routes: { A: "a@x.com" }, cc: ["ok@x.com"] });
    expect(r?.default).toBeUndefined();
  });
});
