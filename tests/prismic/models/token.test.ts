// tests/prismic/models/token.test.ts
import { describe, it, expect } from "vitest";
import { prismicTokenEnvName, resolvePrismicToken } from "../../../src/prismic/models/token.js";

describe("prismicTokenEnvName", () => {
  it("upper-snakes the repository name", () => {
    expect(prismicTokenEnvName("the-pointe-burbank")).toBe("PRISMIC_TOKEN_THE_POINTE_BURBANK");
  });

  it("handles a name with no separators", () => {
    expect(prismicTokenEnvName("gallerysonder")).toBe("PRISMIC_TOKEN_GALLERYSONDER");
  });

  it("collapses any non-alphanumeric run to a single underscore", () => {
    expect(prismicTokenEnvName("beach.front--dentistry")).toBe(
      "PRISMIC_TOKEN_BEACH_FRONT_DENTISTRY",
    );
  });
});

describe("resolvePrismicToken", () => {
  it("prefers the canonical per-repo env var", () => {
    const env = { PRISMIC_TOKEN_ESPADA: "canonical", PRISMIC_WRITE_TOKEN: "generic" };
    expect(resolvePrismicToken("espada", env, { allowGeneric: true })).toEqual({
      token: "canonical",
      source: "PRISMIC_TOKEN_ESPADA",
    });
  });

  // In-repo (CI) mode: the site's own Actions secret is the generic name, which
  // is what every site's code already reads. Fleet mode must NOT fall back to it —
  // one generic token pointed at 18 different repositories is a footgun.
  it("falls back to PRISMIC_WRITE_TOKEN only when generic is allowed", () => {
    const env = { PRISMIC_WRITE_TOKEN: "generic" };
    expect(resolvePrismicToken("espada", env, { allowGeneric: true })).toEqual({
      token: "generic",
      source: "PRISMIC_WRITE_TOKEN",
    });
    expect(resolvePrismicToken("espada", env, { allowGeneric: false })).toBeNull();
  });

  it("returns null when nothing is set", () => {
    expect(resolvePrismicToken("espada", {}, { allowGeneric: true })).toBeNull();
  });

  it("treats a whitespace-only value as absent", () => {
    expect(
      resolvePrismicToken("espada", { PRISMIC_TOKEN_ESPADA: "   " }, { allowGeneric: false }),
    ).toBeNull();
  });

  it("trims the token (a trailing newline from a secret paste 403s)", () => {
    expect(
      resolvePrismicToken("espada", { PRISMIC_TOKEN_ESPADA: "abc\n" }, { allowGeneric: false })
        ?.token,
    ).toBe("abc");
  });
});
