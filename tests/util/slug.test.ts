import { describe, it, expect } from "vitest";
import { filenameSlug } from "../../src/util/slug.js";

describe("filenameSlug", () => {
  it("lowercases and collapses runs outside [a-z0-9.-] to one dash, keeping dots", () => {
    expect(filenameSlug("Acme Plumbing.com")).toBe("acme-plumbing.com");
    expect(filenameSlug("  //Joe's   Bar//  ")).toBe("joe-s-bar");
  });

  it("falls back to 'prospect' when nothing usable is left", () => {
    expect(filenameSlug("///")).toBe("prospect");
    expect(filenameSlug("")).toBe("prospect");
  });
});
