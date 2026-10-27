import { describe, it, expect } from "vitest";

import { validateExtraSlots } from "../../../src/blux/freeze/extra-slots.js";
import { EXTRA_SLOT_PREFIX, type Slot } from "../../../src/blux/freeze/types.js";

const derived: Slot[] = [
  { key: "s2.i1", kind: "image", url: "https://cdn/x.png", section: "s2" },
  { key: "h.t4", kind: "text", text: "Contact Us", section: "h" },
];

describe("validateExtraSlots", () => {
  it("returns nothing when a site declares nothing", () => {
    expect(validateExtraSlots(undefined, derived)).toEqual([]);
    expect(validateExtraSlots(null, derived)).toEqual([]);
  });

  it("accepts text and image slots and normalises the section", () => {
    const out = validateExtraSlots(
      {
        comment: "ignored",
        slots: [
          { key: "x.poster", kind: "image", url: "https://cdn/cover.jpg" },
          { key: "x.total", kind: "text", text: "480,000 SF", section: "avail" },
        ],
      },
      derived,
    );
    expect(out).toEqual([
      { key: "x.poster", kind: "image", url: "https://cdn/cover.jpg", section: "x" },
      { key: "x.total", kind: "text", text: "480,000 SF", section: "avail" },
    ]);
  });

  // Each of these ships a live CMS field, so a bad declaration must stop the
  // freeze rather than be silently dropped or half-applied.
  const bad: [string, unknown, RegExp][] = [
    ["a non-object root", ["nope"], /root/],
    ["a missing slots array", { slots: "no" }, /slots/],
    ["a non-object slot", { slots: ["no"] }, /slots\[0\]/],
    ["a missing key", { slots: [{ kind: "text", text: "x" }] }, /slots\[0\]\.key/],
    [
      "a key without the reserved prefix",
      { slots: [{ key: "poster", kind: "image", url: "u" }] },
      /must start with "x\."/,
    ],
    ["an unknown kind", { slots: [{ key: "x.a", kind: "video", url: "u" }] }, /slots\[0\]\.kind/],
    ["a text slot with no text", { slots: [{ key: "x.a", kind: "text" }] }, /slots\[0\]\.text/],
    ["an image slot with no url", { slots: [{ key: "x.a", kind: "image" }] }, /slots\[0\]\.url/],
    [
      "an empty-string value",
      { slots: [{ key: "x.a", kind: "text", text: "   " }] },
      /slots\[0\]\.text/,
    ],
    [
      "the same key twice",
      {
        slots: [
          { key: "x.a", kind: "text", text: "1" },
          { key: "x.a", kind: "text", text: "2" },
        ],
      },
      /declared twice/,
    ],
  ];

  for (const [label, value, match] of bad) {
    it(`rejects ${label}`, () => {
      expect(() => validateExtraSlots(value, derived)).toThrow(match);
    });
  }

  it("rejects a key that shadows a real derived slot", () => {
    // The prefix guard makes this unreachable in practice; assert the collision
    // check itself so the second line of defence is not silently dead.
    const shadowing = [{ key: `${EXTRA_SLOT_PREFIX}dup`, kind: "text", text: "v" }];
    const clash: Slot[] = [
      { key: `${EXTRA_SLOT_PREFIX}dup`, kind: "text", text: "real", section: "s1" },
    ];
    expect(() => validateExtraSlots({ slots: shadowing }, clash)).toThrow(/collides/);
  });
});
