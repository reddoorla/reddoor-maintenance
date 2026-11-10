import { describe, it, expect } from "vitest";
import { findStuck, stuckIssueBody, STUCK_LABEL } from "../../src/video-pipeline/stuck.js";
import type { FoundVideo } from "../../src/video-pipeline/classify.js";
import type { Renditions } from "../../src/video-pipeline/manifest.js";

const NOW = new Date("2026-11-10T12:00:00Z");
const onR2: Renditions = {
  mp4: "m",
  mobileMp4: null,
  webm: null,
  poster: null,
  captions: null,
  onR2: true,
  class: "player",
};
const onR2Background: Renditions = { ...onR2, class: "background" };
const found = (url: string, publishedAt: string | null): FoundVideo => ({
  url,
  class: "player",
  documentId: "d",
  sliceType: "hero",
  field: "video",
  publishedAt,
});

describe("stuck: findStuck", () => {
  it("published 2 h ago and not on R2 is stuck", () => {
    const v = found("https://a.prismic.io/a.mp4", "2026-11-10T10:00:00Z");
    const stuck = findStuck([v], new Map(), NOW);
    expect(stuck).toHaveLength(1);
    expect(stuck[0]!.ageMs).toBe(2 * 60 * 60 * 1000);
  });

  it("published 30 min ago is not stuck", () => {
    const v = found("https://a.prismic.io/a.mp4", "2026-11-10T11:30:00Z");
    expect(findStuck([v], new Map(), NOW)).toEqual([]);
  });

  it("on R2 two hours ago is not stuck", () => {
    const v = found("https://a.prismic.io/a.mp4", "2026-11-10T10:00:00Z");
    expect(findStuck([v], new Map([[v.url, onR2]]), NOW)).toEqual([]);
  });

  it("a background on R2 for a player video, published 2 h ago, is stuck", () => {
    const v = found("https://a.prismic.io/a.mp4", "2026-11-10T10:00:00Z");
    const stuck = findStuck([v], new Map([[v.url, onR2Background]]), NOW);
    expect(stuck).toHaveLength(1);
    expect(stuck[0]!.ageMs).toBe(2 * 60 * 60 * 1000);
  });

  it("a background on R2 for a background video is not stuck", () => {
    const v = {
      ...found("https://a.prismic.io/a.mp4", "2026-11-10T10:00:00Z"),
      class: "background" as const,
    };
    expect(findStuck([v], new Map([[v.url, onR2Background]]), NOW)).toEqual([]);
  });

  it("null publishedAt is stuck with an unknown age", () => {
    const v = found("https://a.prismic.io/a.mp4", null);
    const stuck = findStuck([v], new Map(), NOW);
    expect(stuck).toHaveLength(1);
    expect(stuck[0]!.ageMs).toBeNull();
  });
});

describe("stuck: stuckIssueBody", () => {
  it("names each url and the label", () => {
    const a = found("https://a.prismic.io/a.mp4", "2026-11-10T10:00:00Z");
    const b = found("https://b.prismic.io/b.mp4", null);
    const body = stuckIssueBody(
      [
        { ...a, ageMs: 2 * 60 * 60 * 1000 },
        { ...b, ageMs: null },
      ],
      NOW,
      "reddoor-website",
    );
    expect(body).toContain(a.url);
    expect(body).toContain(b.url);
    expect(body).toContain(STUCK_LABEL);
    expect(body).toContain("120 min");
    expect(body).toContain("unknown");
  });
});
