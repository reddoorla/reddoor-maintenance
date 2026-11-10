import { describe, it, expect } from "vitest";
import { findVideos, mergeFound } from "../../src/video-pipeline/classify.js";
import type { DocLike, VideoRules } from "../../src/video-pipeline/classify.js";

const media = (url: string, extra: Record<string, unknown> = {}) => ({
  link_type: "Media",
  url,
  name: url.split("/").pop(),
  kind: "document",
  ...extra,
});
const image = (url: string) => ({ link_type: "Media", url, name: "pic.jpg", kind: "image" });

const U1 = "https://h.prismic.io/r/loop.mp4";
const U2 = "https://h.prismic.io/r/offer.mp4";
const U3 = "https://h.prismic.io/r/group-player.mov";
const U4 = "https://h.prismic.io/r/unknown.mp4";
const BOOKED = "https://h.prismic.io/r/booked.mp4";

const doc: DocLike = {
  id: "doc1",
  last_publication_date: "2026-11-10T10:00:00Z",
  data: {
    body: [
      { slice_type: "screen_width_media", primary: { video_mp4: media(U1), loopvideo: true } },
      { slice_type: "offer_hero", primary: { video_mp4: media(U2) } },
      {
        slice_type: "content_width_media",
        primary: {
          items_group: [
            { video_mp4: media(U3), loopvideo: false },
            { video_mp4: image("https://h.prismic.io/r/pic.jpg") },
          ],
        },
      },
      { slice_type: "unknown_slice", primary: { video_mp4: media(U4) } },
    ],
  },
};

const rules: VideoRules = {
  screen_width_media: [
    {
      field: "video_mp4",
      class: { flag: "loopvideo", whenTrue: "background", whenFalse: "player" },
    },
  ],
  offer_hero: [{ field: "video_mp4", class: "player" }],
  content_width_media: [
    {
      field: "video_mp4",
      class: { flag: "loopvideo", whenTrue: "background", whenFalse: "player" },
    },
  ],
};

describe("classify: findVideos", () => {
  it("assigns exact classes per url, ignores the image link and the unknown slice", () => {
    const found = findVideos(doc, rules);
    expect(found.map((f) => [f.url, f.class, f.sliceType])).toEqual([
      [U1, "background", "screen_width_media"],
      [U2, "player", "offer_hero"],
      [U3, "player", "content_width_media"],
    ]);
    expect(found[0]!.documentId).toBe("doc1");
    expect(found[0]!.publishedAt).toBe("2026-11-10T10:00:00Z");
  });

  it("a $document rule classifies a document-level video field", () => {
    const d: DocLike = { id: "booked", data: { booked_video_mp4: media(BOOKED) } };
    const found = findVideos(d, { $document: [{ field: "booked_video_mp4", class: "player" }] });
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      url: BOOKED,
      class: "player",
      sliceType: "$document",
      field: "booked_video_mp4",
    });
  });

  it("without a $document rule, a document-level video field yields nothing", () => {
    const d: DocLike = { id: "booked", data: { booked_video_mp4: media(BOOKED) } };
    expect(findVideos(d, {})).toEqual([]);
  });

  it("a $document rule does not walk arrays inside doc.data", () => {
    const d: DocLike = {
      id: "x",
      data: { body: [{ slice_type: "s", primary: { v: media(U1) } }] },
    };
    expect(findVideos(d, { $document: [{ field: "v", class: "player" }] })).toEqual([]);
  });
});

describe("classify: mergeFound", () => {
  it("one url found as background then player is one entry, player", () => {
    const base = { documentId: "d", sliceType: "s", field: "f", publishedAt: null };
    const merged = mergeFound([
      { url: U1, class: "background", ...base },
      { url: U2, class: "background", ...base },
      { url: U1, class: "player", ...base },
    ]);
    expect(merged.map((m) => [m.url, m.class])).toEqual([
      [U1, "player"],
      [U2, "background"],
    ]);
  });
});
