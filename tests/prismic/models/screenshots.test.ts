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

  // On an insert there is no remote to defer to at all, but the local value
  // is still not safe to send verbatim — ten real fleet repos carry a stale
  // on-disk URL, and sending it on a fresh insert is the exact damage this
  // function exists to prevent, just on the one path with no remote to fall
  // back on. `""` is normalised in instead: it's what Slice Machine writes
  // normally, and what the overwhelming majority of the fleet's 232
  // variations already carry, so it's proven acceptable to the Types API.
  it('normalises every variation\'s imageUrl to "" on an insert, instead of sending the local value verbatim', () => {
    const stale: PrismicModel = {
      id: "rich_text",
      variations: [{ id: "default", imageUrl: "https://images.prismic.io/STALE.png" }],
    };
    const sent = withRemoteScreenshots(stale, undefined) as unknown as {
      variations: Array<Record<string, unknown>>;
    };
    expect(sent.variations[0]!.imageUrl).toBe("");
    // The key stays present, never deleted — an absent `imageUrl` is
    // unproven against the Types API.
    expect(Object.hasOwn(sent.variations[0]!, "imageUrl")).toBe(true);
    // And the original stale object is untouched.
    expect((stale.variations as Array<Record<string, unknown>>)[0]!.imageUrl).toBe(
      "https://images.prismic.io/STALE.png",
    );
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

  // Remote `""` is live truth: Prismic currently has no screenshot for this
  // variation. A push REPLACES the model, so deferring to the local value here
  // would WRITE a stale URL onto a variation that has none — the precise damage
  // this function exists to prevent, on exactly the nine RichText models that
  // carry stale on-disk URLs. Presence, not truthiness.
  it("sends the remote's empty imageUrl rather than a stale local one", () => {
    const stale: PrismicModel = {
      id: "rich_text",
      variations: [{ id: "default", imageUrl: "https://images.prismic.io/STALE.png" }],
    };
    const remote: PrismicModel = {
      id: "rich_text",
      variations: [{ id: "default", imageUrl: "" }],
    };
    const sent = withRemoteScreenshots(stale, remote) as unknown as {
      variations: Array<Record<string, unknown>>;
    };
    expect(sent.variations[0]!.imageUrl).toBe("");
  });

  // An id MATCH alone is not proof the matched remote variation carries the
  // `imageUrl` key at all — it could be genuinely absent (not `""`,
  // ABSENT). `shots.has(id)` used to be true in this case too (the id was
  // found), so the old code would overwrite a real local URL with
  // `undefined`. The check has to be presence of the KEY on the matched
  // variation, not presence of the id in the map.
  it("leaves local untouched when the matched remote variation has no imageUrl key at all", () => {
    const withValue: PrismicModel = {
      id: "hero",
      variations: [{ id: "default", imageUrl: "https://img/hero-default.png" }],
    };
    const remote: PrismicModel = {
      id: "hero",
      variations: [{ id: "default" }], // matched by id, but no `imageUrl` key
    };
    const sent = withRemoteScreenshots(withValue, remote) as unknown as {
      variations: Array<Record<string, unknown>>;
    };
    expect(sent.variations[0]!.imageUrl).toBe("https://img/hero-default.png");
  });
});
