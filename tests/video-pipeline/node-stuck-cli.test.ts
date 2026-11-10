import { describe, it, expect } from "vitest";
import { runPipelineStuck } from "../../src/video-pipeline/node/stuck-cli.js";

const PRISMIC_URL = "https://reddoor-la.cdn.prismic.io/reddoor-la/Offer%20Hero.mp4";
const MEDIA = "https://media.example";
const NOW = new Date("2026-11-10T12:00:00Z");
const RULES = { offer_hero: [{ field: "video_mp4", class: "player" }] };
const DOC = {
  id: "d1",
  last_publication_date: "2026-11-10T10:00:00Z",
  data: {
    body: [
      {
        slice_type: "offer_hero",
        primary: {
          video_mp4: {
            link_type: "Media",
            url: PRISMIC_URL,
            name: "Offer Hero.mp4",
            kind: "document",
          },
        },
      },
    ],
  },
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

type Call = { url: string; method: string; body?: string };

function harness(opts: { manifest?: boolean; issues?: { number: number; body?: string }[] }) {
  const calls: Call[] = [];
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({ url, method, ...(init?.body ? { body: String(init.body) } : {}) });
    if (url.includes("/documents/search")) return json({ results: [DOC], page: 1, total_pages: 1 });
    if (url.startsWith("https://reddoor-la.cdn.prismic.io/api/v2")) {
      return json({ refs: [{ ref: "R", isMasterRef: true }] });
    }
    if (url.startsWith(MEDIA)) {
      if (!opts.manifest) return new Response(null, { status: 404 });
      return json({
        version: 1,
        source: "/reddoor-la/Offer%20Hero.mp4",
        class: "player",
        key: "reddoor-website/offer-hero",
        encodedAt: "2026-11-10T11:00:00Z",
        files: { mp4: "offer-hero-1080.mp4", poster: "offer-hero-poster.jpg" },
      });
    }
    if (url.startsWith("https://api.github.com/") && method === "GET")
      return json(opts.issues ?? []);
    if (url === "https://api.github.com/repos/o/r/issues" && method === "POST")
      return json({ number: 7 }, 201);
    if (url === "https://api.github.com/repos/o/r/issues/5" && method === "PATCH")
      return json({ number: 5 });
    return new Response(null, { status: 500 });
  }) as unknown as typeof globalThis.fetch;
  return { calls, fetch };
}

const opts = {
  site: "reddoor-website",
  prismic: "reddoor-la",
  mediaBase: MEDIA,
  rules: "/rules.json",
  repo: "o/r",
  openIssue: true,
};
const deps = (
  fetch: typeof globalThis.fetch,
  env: Record<string, string | undefined> = { GITHUB_TOKEN: "gh" },
) => ({
  fetch,
  env,
  now: () => NOW,
  readFile: async () => JSON.stringify(RULES),
});

describe("node stuck CLI", () => {
  it("stuck with no existing issue opens one labelled video-pipeline", async () => {
    const h = harness({ manifest: false, issues: [] });
    const r = await runPipelineStuck(opts, deps(h.fetch));
    expect(r.code).toBe(1);
    expect(r.output).toContain("stuck: 1 of 1 video(s)");
    expect(r.output).toContain("OPENED #7");
    const post = h.calls.find((c) => c.method === "POST")!;
    expect(JSON.parse(post.body!).labels).toEqual(["video-pipeline"]);
  });

  it("stuck with an existing open issue updates it", async () => {
    const h = harness({ manifest: false, issues: [{ number: 5, body: "old" }] });
    const r = await runPipelineStuck(opts, deps(h.fetch));
    expect(r.code).toBe(1);
    expect(r.output).toContain("UPDATED #5");
    expect(h.calls.some((c) => c.method === "PATCH" && c.url.endsWith("/issues/5"))).toBe(true);
    expect(h.calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("a manifest present means code 0 and no issue calls", async () => {
    const h = harness({ manifest: true });
    const r = await runPipelineStuck(opts, deps(h.fetch));
    expect(r.code).toBe(0);
    expect(r.output).toContain("stuck: 0 of 1 video(s)");
    expect(h.calls.some((c) => c.url.startsWith("https://api.github.com/"))).toBe(false);
  });

  it("missing GITHUB_TOKEN with --open-issue and a stuck video is code 2", async () => {
    const h = harness({ manifest: false });
    const r = await runPipelineStuck(opts, deps(h.fetch, {}));
    expect(r.code).toBe(2);
    expect(r.output).toContain("GITHUB_TOKEN");
  });
});
