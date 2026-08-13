import { describe, it, expect } from "vitest";
import { canon, sameModel } from "../../../src/prismic/models/canon.js";

describe("canon", () => {
  it("ignores key order", () => {
    // toEqual is recursive structural equality, which is ALREADY key-order-
    // insensitive — asserting canon(...).toEqual(canon(...)) would pass even
    // with `.sort()` deleted from canon.ts. Going through sameModel, which
    // compares JSON.stringify output, is what actually depends on the sort.
    expect(sameModel({ b: 1, a: 2 }, { a: 2, b: 1 })).toBe(true);
  });

  it("drops null values (Prismic injects `select: null` into Link fields)", () => {
    expect(sameModel({ type: "Link" }, { type: "Link", select: null })).toBe(true);
  });

  it("drops imageUrl (the slice preview screenshot lives only in Prismic)", () => {
    expect(
      sameModel({ id: "hero", imageUrl: "" }, { id: "hero", imageUrl: "https://x/y.png" }),
    ).toBe(true);
  });

  it("drops imageUrl at any depth, by key name alone — not just on variations", () => {
    // Pins the tradeoff recorded in canon.ts's header: dropping by key name
    // with no shape check means a field literally named `imageUrl` anywhere
    // in the tree would also vanish from comparison. Accepted because fleet
    // field IDs are snake_case and the real key only ever appears at
    // variations[].imageUrl (verified: 232/232 occurrences fleet-wide).
    expect(
      sameModel(
        { primary: { imageUrl: "" } },
        { primary: { imageUrl: "https://images.prismic.io/whatever.png" } },
      ),
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

  it("retains empty containers instead of collapsing them (they round-trip through Prismic unchanged)", () => {
    expect(sameModel({ items: {} }, {})).toBe(false);
    expect(sameModel({ config: { constraint: {} } }, { config: {} })).toBe(false);
    expect(sameModel({ config: { thumbnails: [] } }, { config: {} })).toBe(false);
  });

  it("does not filter array elements, unlike object keys (would shift indices)", () => {
    // If the array branch dropped null/""/undefined elements the way the
    // object branch drops noise keys, [1, null] would wrongly canon-equal [1].
    expect(sameModel({ thumbnails: [1, null] }, { thumbnails: [1] })).toBe(false);
  });

  it("is idempotent: canon(canon(x)) deep-equals canon(x)", () => {
    const x = {
      b: 1,
      imageUrl: "https://drop-me",
      a: { z: null, y: "", w: [1, null, { q: undefined, p: 2 }] },
    };
    expect(canon(canon(x))).toEqual(canon(x));
  });

  // Trimmed from a real fleet model: gallerysonder's ImageGallery/model.json
  // (~/Documents/GitHub/gallerysonder/src/lib/slices/ImageGallery/model.json,
  // read-only reference, not modified). `local` keeps the on-disk shape;
  // `remote` simulates what Prismic hands back after ingest — imageUrl
  // replaced with a real screenshot URL, and a named thumbnail's height:""
  // (the file on disk has no configured thumbnails, so this one entry is
  // added to exercise that path) coerced away entirely.
  it("matches a real fleet model against its Prismic-serialized twin", () => {
    const local = {
      id: "image_gallery",
      type: "SharedSlice",
      name: "ImageGallery",
      variations: [
        {
          id: "default",
          imageUrl: "",
          primary: {
            button_bottom_link: {
              type: "Link",
              config: { label: "button bottom link", placeholder: "", select: null },
            },
          },
          items: {
            image: {
              type: "Image",
              config: {
                label: "image",
                constraint: {},
                thumbnails: [{ name: "Square", width: 500, height: "" }],
              },
            },
          },
        },
      ],
    };
    const remote = {
      id: "image_gallery",
      type: "SharedSlice",
      name: "ImageGallery",
      variations: [
        {
          id: "default",
          imageUrl: "https://images.prismic.io/slice-machine/deadbeef_default.png",
          primary: {
            button_bottom_link: {
              type: "Link",
              config: { label: "button bottom link", placeholder: "", select: null },
            },
          },
          items: {
            image: {
              type: "Image",
              config: {
                label: "image",
                constraint: {},
                thumbnails: [{ name: "Square", width: 500 }],
              },
            },
          },
        },
      ],
    };
    expect(sameModel(local, remote)).toBe(true);
  });
});
