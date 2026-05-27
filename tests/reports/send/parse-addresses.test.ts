import { describe, it, expect } from "vitest";
import { parseAddresses, isProbablyEmail } from "../../../src/reports/send/orchestrate.js";

describe("parseAddresses", () => {
  it("returns null on null or empty input", () => {
    expect(parseAddresses(null)).toBeNull();
    expect(parseAddresses("")).toBeNull();
    expect(parseAddresses("   ")).toBeNull();
    expect(parseAddresses(",,,")).toBeNull();
  });

  it("splits on commas", () => {
    expect(parseAddresses("a@x.com, b@y.com")).toEqual(["a@x.com", "b@y.com"]);
  });

  it("splits on newlines", () => {
    expect(parseAddresses("a@x.com\nb@y.com")).toEqual(["a@x.com", "b@y.com"]);
  });

  it("splits on mixed commas and newlines", () => {
    expect(parseAddresses("a@x.com, b@y.com\nc@z.com")).toEqual(["a@x.com", "b@y.com", "c@z.com"]);
  });

  it("trims whitespace from each entry", () => {
    expect(parseAddresses("  a@x.com  ,   b@y.com  ")).toEqual(["a@x.com", "b@y.com"]);
  });

  it("lowercases (case-insensitive dedupe)", () => {
    expect(parseAddresses("A@X.com, a@x.com, B@y.com")).toEqual(["a@x.com", "b@y.com"]);
  });

  it("dedupes exact repeats", () => {
    expect(parseAddresses("a@x.com, a@x.com, a@x.com")).toEqual(["a@x.com"]);
  });

  it("returns null when every entry is whitespace", () => {
    expect(parseAddresses("  ,  ,  ")).toBeNull();
  });
});

describe("isProbablyEmail", () => {
  it("accepts plain valid addresses", () => {
    expect(isProbablyEmail("a@x.com")).toBe(true);
    expect(isProbablyEmail("ops@acme.example.com")).toBe(true);
    expect(isProbablyEmail("contact+reports@tuckerlemos.com")).toBe(true);
  });

  it("rejects strings without @", () => {
    expect(isProbablyEmail("not-an-email")).toBe(false);
    expect(isProbablyEmail("ops at acme dot com")).toBe(false);
  });

  it("rejects multiple @s", () => {
    expect(isProbablyEmail("a@b@c.com")).toBe(false);
  });

  it("rejects missing local or domain", () => {
    expect(isProbablyEmail("@x.com")).toBe(false);
    expect(isProbablyEmail("a@")).toBe(false);
  });

  it("rejects domain without a dot", () => {
    expect(isProbablyEmail("a@localhost")).toBe(false);
  });

  it("rejects whitespace anywhere", () => {
    expect(isProbablyEmail("a @x.com")).toBe(false);
    expect(isProbablyEmail("a@ x.com")).toBe(false);
    expect(isProbablyEmail("a@x .com")).toBe(false);
  });
});
