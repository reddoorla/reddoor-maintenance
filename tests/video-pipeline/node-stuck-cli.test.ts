import { describe, it, expect } from "vitest";
import { runPipelineStuck } from "../../src/video-pipeline/node/stuck-cli.js";
import { videoKey } from "../../src/video-pipeline/key.js";

const PRISMIC_URL = "https://reddoor-la.cdn.prismic.io/reddoor-la/Offer%20Hero.mp4";
const MEDIA = "https://media.example";
const NOW = new Date("2026-11-10T12:00:00Z");
const RULES = { offer_hero: [{ field: "video_mp4", class: "player" }] };
const KEY = videoKey("reddoor-website", PRISMIC_URL)!;

const docWith = (url: string, id = "d1") => ({
  id,
  last_publication_date: "2026-11-10T10:00:00Z",
  data: {
    body: [
      {
        slice_type: "offer_hero",
        primary: {
          video_mp4: { link_type: "Media", url, name: "Offer Hero.mp4", kind: "document" },
        },
      },
    ],
  },
});
const DOC = docWith(PRISMIC_URL);

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

type Call = { url: string; method: string; body?: string };
type Respond = (url: string, method: string) => Response | undefined;

/** Default answers: a one-page search with DOC, a master ref, no manifest on R2, and an empty issue list. */
function harness(opts: { manifest?: boolean; issues?: unknown[]; respond?: Respond } = {}) {
  const calls: Call[] = [];
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({ url, method, ...(init?.body ? { body: String(init.body) } : {}) });
    const custom = opts.respond?.(url, method);
    if (custom) return custom;
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
        key: KEY,
        dir: "player-20261110T000000Z",
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
  rulesText: string = JSON.stringify(RULES),
) => ({
  fetch,
  env,
  now: () => NOW,
  readFile: async () => rulesText,
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

  it("prints documents and videos counts before the stuck summary", async () => {
    const h = harness({ manifest: false, issues: [] });
    const r = await runPipelineStuck({ ...opts, openIssue: false }, deps(h.fetch));
    expect(r.output).toContain("documents: 1, videos: 1");
    expect(r.output.indexOf("documents: 1")).toBeLessThan(r.output.indexOf("stuck: 1 of 1"));
  });

  it("a video whose url is not a Prismic file is printed as cannot be encoded, and still counts as stuck", async () => {
    const url = "https://example.com/x/Offer%20Hero.mp4";
    const h = harness({
      manifest: false,
      respond: (u) =>
        u.includes("/documents/search") ? json({ results: [docWith(url)] }) : undefined,
    });
    const r = await runPipelineStuck({ ...opts, openIssue: false }, deps(h.fetch));
    expect(r.code).toBe(1);
    expect(r.output).toContain(`cannot be encoded (not a Prismic file URL): ${url}`);
    expect(r.output).toContain("stuck: 1 of 1 video(s)");
  });

  it("a 401 from the search is code 2 with the HTTP status", async () => {
    const h = harness({
      respond: (u) =>
        u.includes("/documents/search") ? new Response("denied", { status: 401 }) : undefined,
    });
    const r = await runPipelineStuck(opts, deps(h.fetch));
    expect(r.code).toBe(2);
    expect(r.output).toContain("FAILED prismic: HTTP 401 denied");
  });

  it("a non-2xx master-ref call is code 2", async () => {
    const h = harness({
      respond: (u) => (u.endsWith("/api/v2") ? new Response("nope", { status: 503 }) : undefined),
    });
    const r = await runPipelineStuck(opts, deps(h.fetch));
    expect(r.code).toBe(2);
    expect(r.output).toContain("FAILED prismic: HTTP 503");
  });

  it("a search body with no results array is code 2, not an empty green run", async () => {
    const h = harness({
      respond: (u) => (u.includes("/documents/search") ? json({ oops: true }) : undefined),
    });
    const r = await runPipelineStuck(opts, deps(h.fetch));
    expect(r.code).toBe(2);
    expect(r.output).toContain("FAILED prismic");
  });

  it("zero documents fetched is code 2 FAILED prismic: no documents", async () => {
    const h = harness({
      respond: (u) => (u.includes("/documents/search") ? json({ results: [] }) : undefined),
    });
    const r = await runPipelineStuck(opts, deps(h.fetch));
    expect(r.code).toBe(2);
    expect(r.output).toContain("FAILED prismic: no documents");
  });

  it("pagination fetches every page, and finds a video that only page 2 holds", async () => {
    const h = harness({
      manifest: false,
      issues: [],
      respond: (u) => {
        if (!u.includes("/documents/search")) return undefined;
        if (u.includes("page=2")) return json({ results: [DOC], page: 2, total_pages: 2 });
        return json({ results: [{ id: "d0", data: {} }], page: 1, total_pages: 2 });
      },
    });
    const r = await runPipelineStuck({ ...opts, openIssue: false }, deps(h.fetch));
    const searches = h.calls.filter((c) => c.url.includes("/documents/search"));
    expect(searches).toHaveLength(2);
    expect(r.output).toContain("documents: 2, videos: 1");
    expect(r.output).toContain("stuck: 1 of 1 video(s)");
  });

  it("every search URL asks for all languages with lang=*", async () => {
    const h = harness({ manifest: true });
    await runPipelineStuck({ ...opts, openIssue: false }, deps(h.fetch));
    const searches = h.calls.filter((c) => c.url.includes("/documents/search"));
    expect(searches.length).toBeGreaterThan(0);
    for (const c of searches) expect(c.url).toContain("lang=*");
  });

  it("a rules JSON array is code 2 with --rules: in the message", async () => {
    const h = harness({ manifest: false });
    const r = await runPipelineStuck(opts, deps(h.fetch, undefined, "[]"));
    expect(r.code).toBe(2);
    expect(r.output).toMatch(/^--rules: /);
  });

  it("a missing --media-base is code 2 before any fetch", async () => {
    const h = harness({ manifest: false });
    const r = await runPipelineStuck(
      { ...opts, mediaBase: undefined, openIssue: false },
      deps(h.fetch),
    );
    expect(r.code).toBe(2);
    expect(r.output).toContain("--media-base");
    expect(h.calls).toHaveLength(0);
  });

  it("a --repo that is not owner/name is code 2 and no issue call is made", async () => {
    const h = harness({ manifest: false, issues: [] });
    const r = await runPipelineStuck({ ...opts, repo: "not a repo" }, deps(h.fetch));
    expect(r.code).toBe(2);
    expect(h.calls.some((c) => c.url.startsWith("https://api.github.com/"))).toBe(false);
  });

  it("a pull request in the issue list is not updated; a new issue is opened", async () => {
    const h = harness({
      manifest: false,
      issues: [{ number: 5, body: "old", pull_request: { url: "https://api.github.com/x" } }],
    });
    const r = await runPipelineStuck(opts, deps(h.fetch));
    expect(r.output).toContain("OPENED #7");
    expect(h.calls.some((c) => c.method === "PATCH")).toBe(false);
  });
});

describe("node stuck CLI: keys, flags and rules", () => {
  it("a Prismic video whose key cannot be computed is printed as cannot be encoded, not as a re-runnable STUCK line", async () => {
    const h = harness({ manifest: false });
    const r = await runPipelineStuck({ ...opts, site: "!!!", openIssue: false }, deps(h.fetch));
    expect(r.code).toBe(1);
    expect(r.output).toContain(`cannot be encoded (no video key for this site): ${PRISMIC_URL}`);
    expect(r.output).not.toContain(`STUCK ${PRISMIC_URL}`);
    expect(r.output).toContain("stuck: 1 of 1 video(s)");
  });

  it("--prismic with a slash or a host-like value is code 2 before any fetch, naming the flag", async () => {
    const h = harness({ manifest: false });
    const r = await runPipelineStuck(
      { ...opts, prismic: "evil.example/", openIssue: false },
      deps(h.fetch),
    );
    expect(r.code).toBe(2);
    expect(r.output).toContain("--prismic");
    expect(h.calls).toHaveLength(0);
  });

  it("a valid --prismic slug passes the check", async () => {
    const h = harness({ manifest: true });
    const r = await runPipelineStuck(
      { ...opts, prismic: "reddoor-la", openIssue: false },
      deps(h.fetch),
    );
    expect(r.code).toBe(0);
  });

  it("a rules key that matches no slice in any document is a WARN line; the exit code is unchanged", async () => {
    const h = harness({ manifest: true });
    const rules = { ...RULES, ghost_slice: [{ field: "video_mp4", class: "player" }] };
    const r = await runPipelineStuck(
      { ...opts, openIssue: false },
      deps(h.fetch, { GITHUB_TOKEN: "gh" }, JSON.stringify(rules)),
    );
    expect(r.code).toBe(0);
    expect(r.output).toContain("WARN rules: ghost_slice matched no slice in 1 documents");
    expect(r.output).not.toContain("WARN rules: offer_hero");
  });

  it("$document is never warned about, even when no document has the field", async () => {
    const h = harness({ manifest: true });
    const rules = { ...RULES, $document: [{ field: "hero_video", class: "player" }] };
    const r = await runPipelineStuck(
      { ...opts, openIssue: false },
      deps(h.fetch, { GITHUB_TOKEN: "gh" }, JSON.stringify(rules)),
    );
    expect(r.output).not.toContain("WARN rules: $document");
  });
});
