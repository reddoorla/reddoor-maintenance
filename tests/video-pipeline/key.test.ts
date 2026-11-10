import { describe, it, expect } from "vitest";
import { fileNameOf, manifestUrl, sourceOf, videoKey } from "../../src/video-pipeline/key.js";

describe("video-pipeline key", () => {
  it("videoKey: site slug and file-stem slug", () => {
    expect(
      videoKey(
        "reddoor-website",
        "https://reddoor-la.cdn.prismic.io/reddoor-la/aBc123_Brand%20Film.mp4",
      ),
    ).toBe("reddoor-website/abc123-brand-film");
  });

  it("videoKey: a non-video extension is null", () => {
    expect(videoKey("site", "https://x.cdn.prismic.io/r/brochure.pdf")).toBeNull();
  });

  it("videoKey: http (not https) is null", () => {
    expect(videoKey("site", "http://x.cdn.prismic.io/r/a.mp4")).toBeNull();
  });

  it("fileNameOf decodes %20", () => {
    expect(fileNameOf("https://x.prismic.io/r/Brand%20Film.mp4?v=1#h")).toBe("Brand Film.mp4");
  });

  it("manifestUrl strips a trailing slash from the base", () => {
    expect(manifestUrl("https://media.example/", "site/clip")).toBe(
      "https://media.example/site/clip/manifest.json",
    );
    expect(manifestUrl("https://media.example///", "site/clip")).toBe(
      "https://media.example/site/clip/manifest.json",
    );
  });

  it("sourceOf drops the query", () => {
    expect(sourceOf("https://h.prismic.io/r/a.mp4?x=1")).toBe("/r/a.mp4");
  });
});
