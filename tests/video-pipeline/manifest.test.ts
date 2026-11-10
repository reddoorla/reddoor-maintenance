import { describe, it, expect, vi } from "vitest";
import {
  needsEncode,
  parseManifest,
  renditionsFrom,
  resolveVideo,
} from "../../src/video-pipeline/manifest.js";
import type { VideoManifest } from "../../src/video-pipeline/manifest.js";

const URL_ = "https://reddoor-la.cdn.prismic.io/reddoor-la/aBc123_Brand%20Film.mp4";
const SOURCE = "/reddoor-la/aBc123_Brand%20Film.mp4";
const KEY = "reddoor-website/abc123-brand-film-446e58126a";
const DIR = "player-20261110T000000Z";
const BASE = "https://media.example";

const good = (): VideoManifest => ({
  version: 1,
  source: SOURCE,
  class: "player",
  key: KEY,
  dir: DIR,
  encodedAt: "2026-11-10T00:00:00.000Z",
  files: {
    mp4: "abc123-brand-film-1080.mp4",
    mobileMp4: "abc123-brand-film-720.mp4",
    poster: "abc123-brand-film-poster.jpg",
    captions: "abc123-brand-film.vtt",
  },
});

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("manifest: parseManifest", () => {
  it("accepts a good manifest", () => {
    expect(parseManifest(good())).not.toBeNull();
  });

  it("rejects version 2", () => {
    expect(parseManifest({ ...good(), version: 2 })).toBeNull();
  });

  it("rejects a file name with a slash", () => {
    const m = good();
    m.files.mp4 = "sub/abc.mp4";
    expect(parseManifest(m)).toBeNull();
  });

  it("rejects a bad class", () => {
    expect(parseManifest({ ...good(), class: "loop" })).toBeNull();
  });

  it("rejects a manifest with no dir", () => {
    const { dir: _drop, ...noDir } = good();
    expect(parseManifest(noDir)).toBeNull();
  });

  it.each([
    ["a dir with no timestamp", "player"],
    ["a dir with the wrong class", "loop-20261110T000000Z"],
    ["a dir with a short timestamp", "player-2026111T000000Z"],
    ["a dir with a slash", "player-20261110T000000Z/x"],
    ["a non-string dir", 5],
  ])("rejects %s", (_label, dir) => {
    expect(parseManifest({ ...good(), dir })).toBeNull();
  });
});

describe("manifest: renditionsFrom and resolveVideo", () => {
  it("renditionsFrom builds absolute R2 URLs under the version directory", () => {
    const r = renditionsFrom(good(), `${BASE}/`);
    expect(r.mp4).toBe(`${BASE}/${KEY}/${DIR}/abc123-brand-film-1080.mp4`);
    expect(r.mobileMp4).toBe(`${BASE}/${KEY}/${DIR}/abc123-brand-film-720.mp4`);
    expect(r.poster).toBe(`${BASE}/${KEY}/${DIR}/abc123-brand-film-poster.jpg`);
    expect(r.captions).toBe(`${BASE}/${KEY}/${DIR}/abc123-brand-film.vtt`);
    expect(r.webm).toBeNull();
    expect(r.onR2).toBe(true);
    expect(r.class).toBe("player");
  });

  it("a 200 good manifest resolves to R2 URLs", async () => {
    const fetch = vi.fn(async () => json(200, good()));
    const r = await resolveVideo(URL_, {
      site: "reddoor-website",
      mediaBase: BASE,
      fetch: fetch as unknown as typeof globalThis.fetch,
    });
    expect(r.onR2).toBe(true);
    expect(r.mp4).toBe(`${BASE}/${KEY}/${DIR}/abc123-brand-film-1080.mp4`);
    expect(fetch).toHaveBeenCalledWith(`${BASE}/${KEY}/manifest.json`);
  });

  it("a 404 falls back to prismicOnly", async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 404 }));
    const r = await resolveVideo(URL_, {
      site: "reddoor-website",
      mediaBase: BASE,
      fetch: fetch as unknown as typeof globalThis.fetch,
    });
    expect(r).toEqual({
      mp4: URL_,
      mobileMp4: null,
      webm: null,
      poster: null,
      captions: null,
      onR2: false,
      class: null,
    });
  });

  it("a network error falls back to prismicOnly and never throws", async () => {
    const fetch = vi.fn(async () => {
      throw new Error("ECONNRESET");
    });
    const r = await resolveVideo(URL_, {
      site: "reddoor-website",
      mediaBase: BASE,
      fetch: fetch as unknown as typeof globalThis.fetch,
    });
    expect(r.onR2).toBe(false);
    expect(r.mp4).toBe(URL_);
  });

  it("a manifest with a different source is treated as invalid", async () => {
    const fetch = vi.fn(async () => json(200, { ...good(), source: "/other/clip.mp4" }));
    const r = await resolveVideo(URL_, {
      site: "reddoor-website",
      mediaBase: BASE,
      fetch: fetch as unknown as typeof globalThis.fetch,
    });
    expect(r.onR2).toBe(false);
  });

  it("a manifest whose key differs from videoKey(site, url) is treated as invalid", async () => {
    const fetch = vi.fn(async () => json(200, { ...good(), key: "reddoor-website/other-000000" }));
    const r = await resolveVideo(URL_, {
      site: "reddoor-website",
      mediaBase: BASE,
      fetch: fetch as unknown as typeof globalThis.fetch,
    });
    expect(r.onR2).toBe(false);
  });

  it("no mediaBase falls back and never fetches", async () => {
    const fetch = vi.fn(async () => json(200, good()));
    const r = await resolveVideo(URL_, {
      site: "reddoor-website",
      mediaBase: undefined,
      fetch: fetch as unknown as typeof globalThis.fetch,
    });
    expect(r.onR2).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("two resolves of the same url fetch once", async () => {
    const fetch = vi.fn(async () => json(200, good()));
    const cache = new Map();
    const opts = {
      site: "reddoor-website",
      mediaBase: BASE,
      fetch: fetch as unknown as typeof globalThis.fetch,
      cache,
    };
    const [a, b] = await Promise.all([resolveVideo(URL_, opts), resolveVideo(URL_, opts)]);
    await resolveVideo(URL_, opts);
    expect(a.onR2).toBe(true);
    expect(b).toEqual(a);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe("manifest: needsEncode", () => {
  const onR2 = (cls: "background" | "player") => renditionsFrom({ ...good(), class: cls }, BASE);
  const offR2 = { ...renditionsFrom(good(), BASE), onR2: false, class: null };

  it("nothing on R2 needs an encode, whatever the class", () => {
    expect(needsEncode({ class: "background" }, offR2)).toBe(true);
    expect(needsEncode({ class: "player" }, offR2)).toBe(true);
  });

  it("a background on R2 is enough for a background request", () => {
    expect(needsEncode({ class: "background" }, onR2("background"))).toBe(false);
  });

  it("a background on R2 needs an encode for a player request (the class upgrade)", () => {
    expect(needsEncode({ class: "player" }, onR2("background"))).toBe(true);
  });

  it("a player on R2 is enough for either request", () => {
    expect(needsEncode({ class: "player" }, onR2("player"))).toBe(false);
    expect(needsEncode({ class: "background" }, onR2("player"))).toBe(false);
  });
});

describe("manifest: the version dir with milliseconds", () => {
  it("accepts a dir with a three-digit millisecond suffix, and still accepts the old exact form", () => {
    expect(parseManifest({ ...good(), dir: "player-20261110T000000Z-500" })).not.toBeNull();
    expect(parseManifest({ ...good(), dir: "background-20261110T000000Z" })).not.toBeNull();
  });

  it("rejects a suffix that is not exactly three digits", () => {
    expect(parseManifest({ ...good(), dir: "player-20261110T000000Z-5" })).toBeNull();
    expect(parseManifest({ ...good(), dir: "player-20261110T000000Z-5000" })).toBeNull();
  });
});
