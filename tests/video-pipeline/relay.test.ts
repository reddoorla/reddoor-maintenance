import { describe, it, expect, vi } from "vitest";
import { handlePrismicWebhook } from "../../src/video-pipeline/relay.js";
import type { RelayConfig } from "../../src/video-pipeline/relay.js";
import type { VideoRules } from "../../src/video-pipeline/classify.js";
import { videoKey } from "../../src/video-pipeline/key.js";

const SITE = "reddoor-website";
const PLAYER_URL = "https://reddoor-la.cdn.prismic.io/reddoor-la/Offer%20Hero.mp4";
const BG_URL = "https://reddoor-la.cdn.prismic.io/reddoor-la/loop.mp4";
const MEDIA = "https://media.example";

const rules: VideoRules = {
  offer_hero: [{ field: "video_mp4", class: "player" }],
  screen_width_media: [
    {
      field: "video_mp4",
      class: { flag: "loopvideo", whenTrue: "background", whenFalse: "player" },
    },
  ],
};

const doc = {
  id: "d1",
  last_publication_date: "2026-11-10T10:00:00Z",
  data: {
    body: [
      {
        slice_type: "offer_hero",
        primary: {
          video_mp4: {
            link_type: "Media",
            url: PLAYER_URL,
            name: "Offer Hero.mp4",
            kind: "document",
          },
        },
      },
      {
        slice_type: "screen_width_media",
        primary: {
          video_mp4: { link_type: "Media", url: BG_URL, name: "loop.mp4", kind: "document" },
          loopvideo: true,
        },
      },
    ],
  },
};

type Call = { url: string; method: string; body?: string };

function harness(opts: { secret?: string; fetchImpl?: (call: Call) => Response } = {}) {
  const calls: Call[] = [];
  const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const call: Call = {
      url,
      method: init?.method ?? "GET",
      ...(init?.body ? { body: String(init.body) } : {}),
    };
    calls.push(call);
    if (opts.fetchImpl) return opts.fetchImpl(call);
    if (url.startsWith(MEDIA)) return new Response(null, { status: 404 });
    if (url.startsWith("https://api.github.com/")) return new Response(null, { status: 204 });
    return new Response(null, { status: 500 });
  });
  const getDocuments = vi.fn(async () => [doc]);
  const cfg: RelayConfig = {
    secret: opts.secret ?? "s3cret",
    site: SITE,
    repo: "reddoorla/reddoor-website",
    dispatchToken: "tok",
    mediaBase: MEDIA,
    rules,
    getDocuments,
    fetch: fetch as unknown as typeof globalThis.fetch,
  };
  return { cfg, calls, fetch, getDocuments };
}

/** A relay config whose fetch answers the manifest URL for `key` with `manifest`; other media paths 404. */
const manifestFor = (key: string, manifest: unknown) => (call: Call) => {
  if (call.url === `${MEDIA}/${key}/manifest.json`) {
    return new Response(JSON.stringify(manifest), { status: 200 });
  }
  if (call.url.startsWith("https://api.github.com/")) return new Response(null, { status: 204 });
  return new Response(null, { status: 404 });
};

const docWith = (url: string) => ({
  id: "d2",
  last_publication_date: "2026-11-10T10:00:00Z",
  data: {
    body: [
      {
        slice_type: "offer_hero",
        primary: {
          video_mp4: { link_type: "Media", url, name: "Clip.mp4", kind: "document" },
        },
      },
    ],
  },
});

const hook = (over: Record<string, unknown> = {}) =>
  JSON.stringify({ secret: "s3cret", type: "api-update", documents: ["d1"], ...over });

describe("relay: handlePrismicWebhook", () => {
  it("GET is 405", async () => {
    const h = harness();
    const r = await handlePrismicWebhook({ method: "GET", body: "" }, h.cfg);
    expect(r.status).toBe(405);
  });

  it("bad JSON is 400", async () => {
    const h = harness();
    const r = await handlePrismicWebhook({ method: "POST", body: "{nope" }, h.cfg);
    expect(r.status).toBe(400);
  });

  it("a wrong secret is 401 and nothing else runs", async () => {
    const h = harness();
    const r = await handlePrismicWebhook(
      { method: "POST", body: hook({ secret: "wrong" }) },
      h.cfg,
    );
    expect(r.status).toBe(401);
    expect(h.getDocuments).not.toHaveBeenCalled();
    expect(h.fetch).not.toHaveBeenCalled();
  });

  it("a right secret dispatches one player and one background video", async () => {
    const h = harness();
    const r = await handlePrismicWebhook({ method: "POST", body: hook() }, h.cfg);
    expect(r.status).toBe(200);
    const dispatches = h.calls.filter((c) => c.url.startsWith("https://api.github.com/"));
    expect(dispatches).toHaveLength(2);
    const bodies = dispatches.map((c) => JSON.parse(c.body!));
    expect(bodies).toEqual([
      {
        event_type: "video-encode",
        client_payload: { url: PLAYER_URL, class: "player", key: videoKey(SITE, PLAYER_URL) },
      },
      {
        event_type: "video-encode",
        client_payload: { url: BG_URL, class: "background", key: videoKey(SITE, BG_URL) },
      },
    ]);
    const out = JSON.parse(r.body);
    expect(out.dispatched).toEqual([videoKey(SITE, PLAYER_URL), videoKey(SITE, BG_URL)]);
    expect(out.refused).toEqual([]);
  });

  it("a video whose manifest is valid is skipped, not dispatched", async () => {
    const source = "/reddoor-la/Offer%20Hero.mp4";
    const key = videoKey(SITE, PLAYER_URL)!;
    const h = harness({
      fetchImpl: (call) => {
        if (call.url === `${MEDIA}/${key}/manifest.json`) {
          return new Response(
            JSON.stringify({
              version: 1,
              source,
              class: "player",
              key,
              dir: "player-20261110T000000Z",
              encodedAt: "2026-11-10T00:00:00Z",
              files: { mp4: "offer-hero-1080.mp4", poster: "offer-hero-poster.jpg" },
            }),
            { status: 200 },
          );
        }
        if (call.url.startsWith("https://api.github.com/"))
          return new Response(null, { status: 204 });
        return new Response(null, { status: 404 });
      },
    });
    const r = await handlePrismicWebhook({ method: "POST", body: hook() }, h.cfg);
    expect(r.status).toBe(200);
    const out = JSON.parse(r.body);
    expect(out.skipped).toEqual([key]);
    expect(out.dispatched).toEqual([videoKey(SITE, BG_URL)]);
  });

  it("a dispatch returning 500 is 502 and the other video is still dispatched", async () => {
    const h = harness({
      fetchImpl: (call) => {
        if (call.url.startsWith("https://api.github.com/")) {
          return JSON.parse(call.body!).client_payload.url === PLAYER_URL
            ? new Response("boom", { status: 500 })
            : new Response(null, { status: 204 });
        }
        return new Response(null, { status: 404 });
      },
    });
    const r = await handlePrismicWebhook({ method: "POST", body: hook() }, h.cfg);
    expect(r.status).toBe(502);
    const out = JSON.parse(r.body);
    expect(out.dispatched).toEqual([videoKey(SITE, BG_URL)]);
    expect(out.failed).toHaveLength(1);
    expect(out.failed[0]).toContain("HTTP 500");
  });

  it("a background manifest for a player-class video is dispatched (the class upgrade)", async () => {
    const key = videoKey(SITE, PLAYER_URL)!;
    const h = harness({
      fetchImpl: manifestFor(key, {
        version: 1,
        source: "/reddoor-la/Offer%20Hero.mp4",
        class: "background",
        key,
        dir: "background-20261110T000000Z",
        encodedAt: "2026-11-10T00:00:00Z",
        files: { mp4: "offer-hero-1080.mp4", poster: "offer-hero-poster.jpg" },
      }),
    });
    const r = await handlePrismicWebhook({ method: "POST", body: hook() }, h.cfg);
    expect(r.status).toBe(200);
    const out = JSON.parse(r.body);
    expect(out.dispatched).toContain(key);
    expect(out.skipped).not.toContain(key);
  });

  it("no VIDEO_MEDIA_BASE is a 500 after the secret check, and nothing runs", async () => {
    const h = harness();
    h.cfg.mediaBase = undefined;
    const bad = await handlePrismicWebhook({ method: "POST", body: hook({ secret: "x" }) }, h.cfg);
    expect(bad.status).toBe(401);
    const r = await handlePrismicWebhook({ method: "POST", body: hook() }, h.cfg);
    expect(r.status).toBe(500);
    expect(r.body).toBe("VIDEO_MEDIA_BASE is not set");
    expect(h.getDocuments).not.toHaveBeenCalled();
  });

  it("a video not on a prismic.io host is refused, listed, and not dispatched", async () => {
    const url = "https://example.com/x/Clip.mp4";
    const h = harness();
    h.cfg.getDocuments = async () => [docWith(url)];
    const r = await handlePrismicWebhook({ method: "POST", body: hook() }, h.cfg);
    expect(r.status).toBe(200);
    const out = JSON.parse(r.body);
    expect(out.refused).toEqual([url]);
    expect(h.calls.some((c) => c.url.startsWith("https://api.github.com/"))).toBe(false);
  });

  it("a URL whose path carries shell syntax is refused, not dispatched", async () => {
    const url = "https://reddoor-la.cdn.prismic.io/reddoor-la/$(id).mp4";
    const h = harness();
    h.cfg.getDocuments = async () => [docWith(url)];
    const r = await handlePrismicWebhook({ method: "POST", body: hook() }, h.cfg);
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body).refused).toEqual([url]);
    expect(h.calls.some((c) => c.url.startsWith("https://api.github.com/"))).toBe(false);
  });

  it("the dispatched url is the WHATWG href (a raw space comes out as %20)", async () => {
    const raw = "https://reddoor-la.cdn.prismic.io/reddoor-la/Offer Hero.mp4";
    const h = harness();
    h.cfg.getDocuments = async () => [docWith(raw)];
    const r = await handlePrismicWebhook({ method: "POST", body: hook() }, h.cfg);
    expect(r.status).toBe(200);
    const dispatch = h.calls.find((c) => c.url.startsWith("https://api.github.com/"))!;
    expect(JSON.parse(dispatch.body!).client_payload.url).toBe(
      "https://reddoor-la.cdn.prismic.io/reddoor-la/Offer%20Hero.mp4",
    );
  });

  it("type test-trigger is 200 ignored with no dispatch", async () => {
    const h = harness();
    const r = await handlePrismicWebhook(
      { method: "POST", body: hook({ type: "test-trigger" }) },
      h.cfg,
    );
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toEqual({ ignored: "test-trigger" });
    expect(h.fetch).not.toHaveBeenCalled();
  });
});
