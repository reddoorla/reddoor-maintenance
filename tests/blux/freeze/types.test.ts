import { describe, expect, it } from "vitest";
import { tokenFor, slotKey, TOKEN_RE } from "../../../src/blux/freeze/types.js";

describe("freeze token contract", () => {
  it("builds text and image tokens", () => {
    expect(tokenFor("text", "s1.t0")).toBe("⟦t:s1.t0⟧");
    expect(tokenFor("image", "s1.i0")).toBe("⟦i:s1.i0⟧");
  });

  it("builds keys grouped by section and kind", () => {
    expect(slotKey("s1", "text", 0)).toBe("s1.t0");
    expect(slotKey("h", "image", 3)).toBe("h.i3");
  });

  it("TOKEN_RE round-trips kind + key", () => {
    const hits = [...`x ⟦t:s1.t0⟧ y ⟦i:s2.i5⟧`.matchAll(TOKEN_RE())];
    expect(hits.map((m) => [m[1], m[2]])).toEqual([
      ["t", "s1.t0"],
      ["i", "s2.i5"],
    ]);
  });

  it("TOKEN_RE() returns a fresh instance (no lastIndex bleed)", () => {
    expect(TOKEN_RE().test("⟦t:a⟧")).toBe(true);
    expect(TOKEN_RE().test("⟦t:a⟧")).toBe(true);
  });
});
