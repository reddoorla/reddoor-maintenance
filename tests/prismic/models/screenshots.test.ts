// tests/prismic/models/screenshots.test.ts
import { describe, it, expect } from "vitest";
import { withRemoteScreenshots } from "../../../src/prismic/models/diff.js";
import type { PrismicModel } from "../../../src/prismic/models/types.js";

const local: PrismicModel = {
  id: "hero",
  variations: [
    { id: "default", imageUrl: "" },
    { id: "wide", imageUrl: "" },
  ],
};

describe("withRemoteScreenshots", () => {
  // A push REPLACES the model. Sending the local imageUrl — `""` on most models,
  // a stale URL on the nine RichText ones — would blank or rot every slice
  // preview in the editor UI as a side effect of adding one field.
  it("carries the remote imageUrl onto the model being sent", () => {
    const remote: PrismicModel = {
      id: "hero",
      variations: [{ id: "default", imageUrl: "https://img/hero-default.png" }],
    };
    // `PrismicModel`'s `variations` is `unknown` (from its index signature),
    // not a known array type — TS's "sufficient overlap" check on a direct
    // `as` rejects narrowing to a shape requiring an array there, so this
    // needs the standard `as unknown as X` two-step.
    const sent = withRemoteScreenshots(local, remote) as unknown as {
      variations: Array<Record<string, unknown>>;
    };
    expect(sent.variations[0]!.imageUrl).toBe("https://img/hero-default.png");
  });

  it("leaves a variation with no remote screenshot untouched", () => {
    const remote: PrismicModel = {
      id: "hero",
      variations: [{ id: "default", imageUrl: "https://img/hero-default.png" }],
    };
    // `PrismicModel`'s `variations` is `unknown` (from its index signature),
    // not a known array type — TS's "sufficient overlap" check on a direct
    // `as` rejects narrowing to a shape requiring an array there, so this
    // needs the standard `as unknown as X` two-step.
    const sent = withRemoteScreenshots(local, remote) as unknown as {
      variations: Array<Record<string, unknown>>;
    };
    expect(sent.variations[1]!.imageUrl).toBe("");
  });

  it("returns the local model unchanged when there is no remote (an insert)", () => {
    expect(withRemoteScreenshots(local, undefined)).toBe(local);
  });

  it("returns the local model unchanged for a custom type (no variations)", () => {
    const ct: PrismicModel = { id: "page", json: { Main: {} } };
    expect(withRemoteScreenshots(ct, { id: "page", json: { Main: {} } })).toBe(ct);
  });

  it("does not mutate the local model", () => {
    const remote: PrismicModel = {
      id: "hero",
      variations: [{ id: "default", imageUrl: "https://x.png" }],
    };
    withRemoteScreenshots(local, remote);
    expect((local.variations as Array<Record<string, unknown>>)[0]!.imageUrl).toBe("");
  });
});
