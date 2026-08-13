import { describe, it, expect } from "vitest";
import { canon, sameModel } from "../../../src/prismic/models/canon.js";

describe("canon", () => {
  it("ignores key order", () => {
    expect(canon({ b: 1, a: 2 })).toEqual(canon({ a: 2, b: 1 }));
  });

  it("drops null values (Prismic injects `select: null` into Link fields)", () => {
    expect(sameModel({ type: "Link" }, { type: "Link", select: null })).toBe(true);
  });

  it("drops imageUrl (the slice preview screenshot lives only in Prismic)", () => {
    expect(
      sameModel({ id: "hero", imageUrl: "" }, { id: "hero", imageUrl: "https://x/y.png" }),
    ).toBe(true);
  });

  // THE TRAP. Slice Machine writes thumbnails as {"height":""}; Prismic coerces
  // that empty string to null on ingest and hands back a model with the key GONE.
  // Keeping "" while dropping null made the two copies permanently unequal — a
  // push sent "", Prismic stored null, and the next scan diffed again forever.
  // Verified by round-tripping a thumbnail through the Types API on the-pinnacle:
  // sent height:"", read back height:null.
  it("drops empty-string values, so a thumbnail height:'' equals a remote with no height", () => {
    const local = { name: "desktop", width: 1200, height: "" };
    const remote = { name: "desktop", width: 1200 };
    expect(sameModel(local, remote)).toBe(true);
  });

  it("still reports a real difference between '' and a non-empty value", () => {
    expect(sameModel({ placeholder: "" }, { placeholder: "Enter name" })).toBe(false);
  });

  it("recurses into arrays and nested objects", () => {
    const a = { variations: [{ id: "default", primary: { b: 1, a: null } }] };
    const b = { variations: [{ id: "default", primary: { a: undefined, b: 1 } }] };
    expect(sameModel(a, b)).toBe(true);
  });

  it("leaves primitives alone", () => {
    expect(canon(0)).toBe(0);
    expect(canon(false)).toBe(false);
    expect(canon("x")).toBe("x");
  });

  it("does not treat 0 or false as empty", () => {
    expect(sameModel({ n: 0 }, {})).toBe(false);
    expect(sameModel({ b: false }, {})).toBe(false);
  });
});
