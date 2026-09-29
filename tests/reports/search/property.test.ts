import { describe, it, expect } from "vitest";
import { normalizeSearchConsoleProperty } from "../../../src/reports/search/property.js";

describe("normalizeSearchConsoleProperty", () => {
  it.each([
    ["sc-domain:acme.com", "sc-domain:acme.com"],
    ["  SC-Domain:Acme.COM ", "sc-domain:acme.com"],
    ["sc-domain:shop.acme.co.uk", "sc-domain:shop.acme.co.uk"],
    ["https://www.acme.com/", "https://www.acme.com/"],
    ["https://www.acme.com", "https://www.acme.com/"],
    ["http://acme.com/blog", "http://acme.com/blog/"],
    ["https://ACME.com/", "https://acme.com/"],
  ])("accepts %j as %j", (raw, want) => {
    expect(normalizeSearchConsoleProperty(raw)).toBe(want);
  });

  it.each([
    "acme.com",
    "none",
    "sc-domain:",
    "sc-domain:acme",
    "sc-domain:https://acme.com",
    "sc-domain:acme.com/",
    "ftp://acme.com/",
    "https://acme.com/?q=1",
    "https://acme.com/#top",
    "https://user:pw@acme.com/",
    "https://localhost/",
  ])("refuses %j", (raw) => {
    expect(normalizeSearchConsoleProperty(raw)).toBeNull();
  });
});
