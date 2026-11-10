import { describe, it, expect } from "vitest";
import {
  fileNameOf,
  isPrismicFileUrl,
  manifestUrl,
  relayRefusal,
  sourceOf,
  videoKey,
} from "../../src/video-pipeline/key.js";

describe("video-pipeline relayRefusal", () => {
  it("a parenthesised file name is refused, with the unsafe-characters reason", () => {
    const reason = relayRefusal("https://reddoor-la.cdn.prismic.io/reddoor-la/Hero(1).mp4");
    expect(reason).toContain("refused by the relay");
    expect(reason).toContain("unsafe characters");
  });

  it("a plain https Prismic URL is allowed (null)", () => {
    expect(
      relayRefusal("https://reddoor-la.cdn.prismic.io/reddoor-la/Offer%20Hero.mp4"),
    ).toBeNull();
  });

  it("a URL that does not parse is refused", () => {
    expect(relayRefusal("not a url")).not.toBeNull();
  });
});

describe("video-pipeline key", () => {
  it("videoKey: site slug, file-stem slug, and a 10-hex hash of the source path", () => {
    expect(
      videoKey(
        "reddoor-website",
        "https://reddoor-la.cdn.prismic.io/reddoor-la/aBc123_Brand%20Film.mp4",
      ),
    ).toBe("reddoor-website/abc123-brand-film-446e58126a");
  });

  it("videoKey: My%20Clip.mp4 and my-clip.MOV get different keys", () => {
    const a = videoKey("site", "https://x.prismic.io/r/My%20Clip.mp4");
    const b = videoKey("site", "https://x.prismic.io/r/my-clip.MOV");
    expect(a).toBe("site/my-clip-54af7ecd2c");
    expect(b).toBe("site/my-clip-76f6a27078");
    expect(a).not.toBe(b);
  });

  it("videoKey: a name with no ASCII slug is site/video-<hash>", () => {
    const k = videoKey("site", "https://x.prismic.io/r/%E6%97%A5%E6%9C%AC.mp4");
    expect(k).toBe("site/video-8e0b7a9d58");
    expect(k).toMatch(/^site\/video-[0-9a-f]{10}$/);
  });

  it("videoKey: a non-video extension is null", () => {
    expect(videoKey("site", "https://x.cdn.prismic.io/r/brochure.pdf")).toBeNull();
  });

  it("videoKey: http (not https) is null", () => {
    expect(videoKey("site", "http://x.cdn.prismic.io/r/a.mp4")).toBeNull();
  });

  it("videoKey: an empty site slug is null", () => {
    expect(videoKey("!!!", "https://x.cdn.prismic.io/r/a.mp4")).toBeNull();
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

describe("video-pipeline isPrismicFileUrl", () => {
  it("accepts an https *.prismic.io host", () => {
    expect(isPrismicFileUrl("https://reddoor-la.cdn.prismic.io/reddoor-la/a.mp4")).toBe(true);
    expect(isPrismicFileUrl("https://images.prismic.io/x/a.mp4")).toBe(true);
  });

  it("refuses http, other hosts, the bare apex and look-alike hosts", () => {
    expect(isPrismicFileUrl("http://x.prismic.io/a.mp4")).toBe(false);
    expect(isPrismicFileUrl("https://example.com/a.mp4")).toBe(false);
    expect(isPrismicFileUrl("https://prismic.io/a.mp4")).toBe(false);
    expect(isPrismicFileUrl("https://prismic.io.evil.com/a.mp4")).toBe(false);
    expect(isPrismicFileUrl("https://evilprismic.io/a.mp4")).toBe(false);
  });

  it("refuses an unparsable string", () => {
    expect(isPrismicFileUrl("not a url")).toBe(false);
  });
});
