import { describe, it, expect } from "vitest";
import { parseAllowedEmails, isAllowedEmail } from "../../../src/dashboard/auth/allowlist.js";

describe("parseAllowedEmails", () => {
  it("splits on commas and trims", () => {
    expect(parseAllowedEmails("a@x.com, b@y.com ,c@z.com")).toEqual([
      "a@x.com",
      "b@y.com",
      "c@z.com",
    ]);
  });

  it("lowercases", () => {
    expect(parseAllowedEmails("Tim@ReddoorLA.com")).toEqual(["tim@reddoorla.com"]);
  });

  it("de-duplicates, including across casing", () => {
    expect(parseAllowedEmails("a@x.com,A@X.com")).toEqual(["a@x.com"]);
  });

  it("drops entries that are not address-shaped", () => {
    expect(parseAllowedEmails("tucker, tim, erik@reddoorla.com")).toEqual(["erik@reddoorla.com"]);
    expect(parseAllowedEmails("no-at-sign, a@nodot, @x.com, a@x.com")).toEqual(["a@x.com"]);
  });

  it("returns an empty list for unset, empty and separator-only values", () => {
    expect(parseAllowedEmails(undefined)).toEqual([]);
    expect(parseAllowedEmails(null)).toEqual([]);
    expect(parseAllowedEmails("")).toEqual([]);
    expect(parseAllowedEmails("   ")).toEqual([]);
    expect(parseAllowedEmails(",,,")).toEqual([]);
  });
});

describe("isAllowedEmail", () => {
  const allowed = parseAllowedEmails("tucker@reddoorla.com,tim@reddoorla.com");

  it("matches regardless of casing or surrounding space", () => {
    expect(isAllowedEmail("Tucker@ReddoorLA.com", allowed)).toBe(true);
    expect(isAllowedEmail("  tim@reddoorla.com  ", allowed)).toBe(true);
  });

  it("rejects an address that is not listed", () => {
    expect(isAllowedEmail("attacker@evil.com", allowed)).toBe(false);
  });

  it("matches nobody when the list is empty — the fail-closed case", () => {
    expect(isAllowedEmail("tucker@reddoorla.com", [])).toBe(false);
  });

  it("rejects missing addresses", () => {
    expect(isAllowedEmail(null, allowed)).toBe(false);
    expect(isAllowedEmail(undefined, allowed)).toBe(false);
    expect(isAllowedEmail("", allowed)).toBe(false);
  });
});
