import { describe, it, expect, vi } from "vitest";
import { parseManifest, renditionsFrom, resolveVideo } from "../../src/video-pipeline/manifest.js";
import type { VideoManifest } from "../../src/video-pipeline/manifest.js";

const URL_ = "https://reddoor-la.cdn.prismic.io/reddoor-la/aBc123_Brand%20Film.mp4";
const SOURCE = "/reddoor-la/aBc123_Brand%20Film.mp4";
const KEY = "reddoor-website/abc123-brand-film";
const BASE = "https://media.example";

const good = (): VideoManifest => ({
  version: 1,
  source: SOURCE,
  class: "player",
  key: KEY,
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
});

describe("manifest: renditionsFrom and resolveVideo", () => {
  it("renditionsFrom builds absolute R2 URLs", () => {
    const r = renditionsFrom(good(), `${BASE}/`);
    expect(r.mp4).toBe(`${BASE}/${KEY}/abc123-brand-film-1080.mp4`);
    expect(r.mobileMp4).toBe(`${BASE}/${KEY}/abc123-brand-film-720.mp4`);
    expect(r.poster).toBe(`${BASE}/${KEY}/abc123-brand-film-poster.jpg`);
    expect(r.captions).toBe(`${BASE}/${KEY}/abc123-brand-film.vtt`);
    expect(r.webm).toBeNull();
    expect(r.onR2).toBe(true);
  });

  it("a 200 good manifest resolves to R2 URLs", async () => {
    const fetch = vi.fn(async () => json(200, good()));
    const r = await resolveVideo(URL_, {
      site: "reddoor-website",
      mediaBase: BASE,
      fetch: fetch as unknown as typeof globalThis.fetch,
    });
    expect(r.onR2).toBe(true);
    expect(r.mp4).toBe(`${BASE}/${KEY}/abc123-brand-film-1080.mp4`);
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
