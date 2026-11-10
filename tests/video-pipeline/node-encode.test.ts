import { describe, it, expect } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SpawnFn, SpawnOptions } from "../../src/audits/util/spawn.js";
import { runPipelineEncode } from "../../src/video-pipeline/node/encode.js";
import { parseManifest } from "../../src/video-pipeline/manifest.js";

const PRISMIC = "https://reddoor-la.cdn.prismic.io/reddoor-la/Offer%20Hero.mp4";
const R2 = "https://r2.test";
const env = {
  R2_ACCOUNT_ID: "acct",
  R2_ACCESS_KEY_ID: "AK",
  R2_SECRET_ACCESS_KEY: "SK",
  R2_ENDPOINT: R2,
  CF_AI_TOKEN: "cf",
};

type Call = { cmd?: string; url?: string; method?: string; args?: string[]; body?: unknown };

/** Writes the file ffmpeg would write: its last argv entry. */
function spawnWritesOutputs(calls: Call[]): SpawnFn {
  return async (cmd: string, args: readonly string[], _opts?: SpawnOptions) => {
    calls.push({ cmd, args: [...args] });
    if (cmd === "ffprobe") {
      const sel = args[args.indexOf("-select_streams") + 1];
      if (sel === "a") return { code: 0, stdout: "1\n", stderr: "" };
      const entries = args[args.indexOf("-show_entries") + 1] ?? "";
      const json = entries.includes("format=size")
        ? { streams: [{ width: 1920, height: 1080 }], format: { size: "100", bit_rate: "1000" } }
        : {
            streams: [{ width: 1920, height: 1080, duration: "2.0" }],
            format: { duration: "2.0" },
          };
      return { code: 0, stdout: JSON.stringify(json), stderr: "" };
    }
    if (cmd === "ffmpeg") await writeFile(args[args.length - 1]!, "x");
    return { code: 0, stdout: "", stderr: "" };
  };
}

function fakeFetch(calls: Call[], putFails: (url: string) => boolean = () => false) {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({ url, method, body: init?.body });
    if (url.startsWith("https://api.cloudflare.com/")) {
      return new Response(
        JSON.stringify({
          success: true,
          result: { vtt: "WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nhi\n\n" },
        }),
        { status: 200 },
      );
    }
    if (url.startsWith(R2)) {
      return new Response(null, { status: putFails(url) ? 500 : 200 });
    }
    return new Response("master-bytes", { status: 200 });
  }) as unknown as typeof globalThis.fetch;
}

const bodyText = (b: unknown) =>
  typeof b === "string" ? b : new TextDecoder().decode(b as Uint8Array);

describe("node encode: validation", () => {
  it("missing env names every missing variable", async () => {
    const r = await runPipelineEncode(
      { url: PRISMIC, class: "background", site: "s" },
      { env: {} },
    );
    expect(r.code).toBe(2);
    for (const name of ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"]) {
      expect(r.output).toContain(name);
    }
  });

  it("a non-Prismic host is code 2", async () => {
    const r = await runPipelineEncode(
      { url: "https://example.com/a.mp4", class: "background", site: "s" },
      { env },
    );
    expect(r.code).toBe(2);
    expect(r.output).toContain("--url must be an https Prismic file URL");
  });

  it("player without CF_AI_TOKEN is code 2", async () => {
    const { CF_AI_TOKEN: _drop, ...noCf } = env;
    const r = await runPipelineEncode({ url: PRISMIC, class: "player", site: "s" }, { env: noCf });
    expect(r.code).toBe(2);
    expect(r.output).toContain("CF_AI_TOKEN");
  });

  it("background without CF_AI_TOKEN passes validation", async () => {
    const { CF_AI_TOKEN: _drop, ...noCf } = env;
    const failingFetch = (async () =>
      new Response(null, { status: 500 })) as unknown as typeof globalThis.fetch;
    const tmp = await mkdtemp(join(tmpdir(), "enc-val-"));
    const r = await runPipelineEncode(
      { url: PRISMIC, class: "background", site: "s" },
      { env: noCf, fetch: failingFetch, tmpDir: tmp },
    );
    expect(r.code).toBe(1);
    expect(r.output).toContain("FAILED download");
  });
});

const STEM = "offer-hero-2394de2bb3"; // videoKey("reddoor-website", PRISMIC) → reddoor-website/offer-hero-2394de2bb3
const KEY = `reddoor-website/${STEM}`;
const NOW = new Date("2026-11-10T00:00:00Z");

/** Serves the Prismic master as `body`; every other URL goes to the normal fakes. */
function masterFetch(body: Response, calls: Call[]) {
  const inner = fakeFetch(calls);
  return (async (input: string | URL | Request, init?: RequestInit) => {
    if (String(input) === PRISMIC) return body;
    return inner(input, init);
  }) as unknown as typeof globalThis.fetch;
}

/** ffprobe reports no audio stream; ffmpeg and the rest behave as in spawnWritesOutputs. */
function spawnNoAudio(calls: Call[]): SpawnFn {
  const base = spawnWritesOutputs(calls);
  return async (cmd, args, opts) => {
    if (cmd === "ffprobe" && args[args.indexOf("-select_streams") + 1] === "a") {
      calls.push({ cmd, args: [...args] });
      return { code: 0, stdout: "", stderr: "" };
    }
    return base(cmd, args, opts);
  };
}

/** ffmpeg exits 1 on the first call. */
function spawnFfmpegFails(calls: Call[]): SpawnFn {
  const base = spawnWritesOutputs(calls);
  return async (cmd, args, opts) => {
    if (cmd === "ffmpeg") {
      calls.push({ cmd, args: [...args] });
      return { code: 1, stdout: "", stderr: "boom" };
    }
    return base(cmd, args, opts);
  };
}

describe("node encode: end to end with fakes", () => {
  it("a player job uploads renditions and captions under a player- version directory, manifest last", async () => {
    const calls: Call[] = [];
    const tmp = await mkdtemp(join(tmpdir(), "enc-e2e-"));
    const r = await runPipelineEncode(
      { url: PRISMIC, class: "player", site: "reddoor-website" },
      {
        env,
        fetch: fakeFetch(calls),
        spawn: spawnWritesOutputs(calls),
        tmpDir: tmp,
        now: () => NOW,
        stderr: { write: () => true },
      },
    );
    expect(r.code, r.output).toBe(0);
    const puts = calls.filter((c) => c.method === "PUT");
    expect(puts.at(-1)!.url).toBe(`${R2}/reddoor-video/${KEY}/manifest.json`);
    const putUrls = puts.map((c) => c.url!);
    const dir = `${R2}/reddoor-video/${KEY}/player-20261110T000000Z`;
    for (const file of [
      `${STEM}-1080.mp4`,
      `${STEM}-720.mp4`,
      `${STEM}-poster.jpg`,
      `${STEM}.vtt`,
    ]) {
      expect(putUrls).toContain(`${dir}/${file}`);
    }
    const manifest = parseManifest(JSON.parse(bodyText(puts.at(-1)!.body)));
    expect(manifest).not.toBeNull();
    expect(manifest!.key).toBe(KEY);
    expect(manifest!.dir).toBe("player-20261110T000000Z");
    expect(manifest!.source).toBe("/reddoor-la/Offer%20Hero.mp4");
    expect(manifest!.files.captions).toBe(`${STEM}.vtt`);
    expect(manifest!.files.mobileMp4).toBe(`${STEM}-720.mp4`);
    expect(r.output).toContain(`MANIFEST ${KEY}/manifest.json`);
  });

  it("a background job maps webm and the -phone-720 mp4, and uploads under a background- directory", async () => {
    const calls: Call[] = [];
    const tmp = await mkdtemp(join(tmpdir(), "enc-bg-"));
    const r = await runPipelineEncode(
      { url: PRISMIC, class: "background", site: "reddoor-website" },
      {
        env,
        fetch: fakeFetch(calls),
        spawn: spawnWritesOutputs(calls),
        tmpDir: tmp,
        now: () => NOW,
        stderr: { write: () => true },
      },
    );
    expect(r.code, r.output).toBe(0);
    const puts = calls.filter((c) => c.method === "PUT");
    const dir = `${R2}/reddoor-video/${KEY}/background-20261110T000000Z`;
    expect(puts.map((c) => c.url!)).toContain(`${dir}/${STEM}-1080.webm`);
    expect(puts.map((c) => c.url!)).toContain(`${dir}/${STEM}-phone-720.mp4`);
    const manifest = parseManifest(JSON.parse(bodyText(puts.at(-1)!.body)));
    expect(manifest!.class).toBe("background");
    expect(manifest!.dir).toBe("background-20261110T000000Z");
    expect(manifest!.files.webm).toBe(`${STEM}-1080.webm`);
    expect(manifest!.files.mobileMp4).toBe(`${STEM}-phone-720.mp4`);
    expect(manifest!.files.captions).toBeUndefined();
    expect(calls.some((c) => c.url?.startsWith("https://api.cloudflare.com/"))).toBe(false);
  });

  it("a failed upload of the last rendition (the vtt) is code 1 and no manifest is written", async () => {
    const calls: Call[] = [];
    const tmp = await mkdtemp(join(tmpdir(), "enc-vtt-"));
    const r = await runPipelineEncode(
      { url: PRISMIC, class: "player", site: "reddoor-website" },
      {
        env,
        fetch: fakeFetch(calls, (u) => u.endsWith(".vtt")),
        spawn: spawnWritesOutputs(calls),
        tmpDir: tmp,
        now: () => NOW,
        stderr: { write: () => true },
      },
    );
    expect(r.code).toBe(1);
    expect(r.output).toContain(`FAILED ${KEY}/player-20261110T000000Z/${STEM}.vtt`);
    const puts = calls.filter((c) => c.method === "PUT").map((c) => c.url!);
    expect(puts.some((u) => u.endsWith("manifest.json"))).toBe(false);
  });

  it("a Whisper 500 is a WARN, the manifest is still written without captions, and code stays 0", async () => {
    const calls: Call[] = [];
    const tmp = await mkdtemp(join(tmpdir(), "enc-warn-"));
    const inner = fakeFetch(calls);
    const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).startsWith("https://api.cloudflare.com/")) {
        calls.push({ url: String(input), method: "POST" });
        return new Response("nope", { status: 500 });
      }
      return inner(input, init);
    }) as unknown as typeof globalThis.fetch;
    const r = await runPipelineEncode(
      { url: PRISMIC, class: "player", site: "reddoor-website" },
      {
        env,
        fetch,
        spawn: spawnWritesOutputs(calls),
        tmpDir: tmp,
        now: () => NOW,
        stderr: { write: () => true },
      },
    );
    expect(r.code, r.output).toBe(0);
    expect(r.output).toContain("WARN captions");
    const puts = calls.filter((c) => c.method === "PUT");
    const manifest = parseManifest(JSON.parse(bodyText(puts.at(-1)!.body)));
    expect(puts.at(-1)!.url).toMatch(/manifest\.json$/);
    expect(manifest!.files.captions).toBeUndefined();
    expect(puts.some((c) => c.url!.endsWith(".vtt"))).toBe(false);
  });

  it("a player with no audio stream makes no Whisper call, no captions, and code 0", async () => {
    const calls: Call[] = [];
    const tmp = await mkdtemp(join(tmpdir(), "enc-silent-"));
    const r = await runPipelineEncode(
      { url: PRISMIC, class: "player", site: "reddoor-website" },
      {
        env,
        fetch: fakeFetch(calls),
        spawn: spawnNoAudio(calls),
        tmpDir: tmp,
        now: () => NOW,
        stderr: { write: () => true },
      },
    );
    expect(r.code, r.output).toBe(0);
    expect(r.output).toContain("no audio stream; no captions");
    expect(r.output).not.toContain("WARN captions");
    expect(calls.some((c) => c.url?.startsWith("https://api.cloudflare.com/"))).toBe(false);
    expect(calls.some((c) => c.cmd === "ffmpeg" && c.args?.includes("libmp3lame"))).toBe(false);
    const manifest = parseManifest(
      JSON.parse(bodyText(calls.filter((c) => c.method === "PUT").at(-1)!.body)),
    );
    expect(manifest!.files.captions).toBeUndefined();
  });

  it("a failing ffmpeg keeps the 'downloaded' line in the output and is code 1", async () => {
    const calls: Call[] = [];
    const tmp = await mkdtemp(join(tmpdir(), "enc-ff-"));
    const r = await runPipelineEncode(
      { url: PRISMIC, class: "background", site: "reddoor-website" },
      {
        env,
        fetch: fakeFetch(calls),
        spawn: spawnFfmpegFails(calls),
        tmpDir: tmp,
        now: () => NOW,
        stderr: { write: () => true },
      },
    );
    expect(r.code).toBe(1);
    expect(r.output).toContain("downloaded ");
    expect(r.output).toContain("ffmpeg exited 1");
  });

  it("a numeric site (cac passes numbers) is coerced, not a TypeError", async () => {
    const failingFetch = (async () =>
      new Response(null, { status: 500 })) as unknown as typeof globalThis.fetch;
    const tmp = await mkdtemp(join(tmpdir(), "enc-num-"));
    const r = await runPipelineEncode(
      { url: PRISMIC, class: "background", site: 123 as unknown as string },
      { env, fetch: failingFetch, tmpDir: tmp },
    );
    expect(r.code).toBe(1);
    expect(r.output).toContain("FAILED download");
  });

  it("a master whose declared content-length is over 120 MiB is code 1 before its body is read", async () => {
    let pulls = 0;
    // highWaterMark 0: the stream asks its source for nothing until something reads it.
    const body = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          pulls += 1;
          controller.enqueue(new Uint8Array(1024));
        },
      },
      { highWaterMark: 0 },
    );
    const master = new Response(body, {
      status: 200,
      headers: { "content-length": String(120 * 1024 * 1024 + 1) },
    });
    const tmp = await mkdtemp(join(tmpdir(), "enc-cap-decl-"));
    const r = await runPipelineEncode(
      { url: PRISMIC, class: "background", site: "reddoor-website" },
      { env, fetch: masterFetch(master, []), tmpDir: tmp, now: () => NOW },
    );
    expect(r.code).toBe(1);
    expect(r.output).toContain("larger than");
    expect(pulls).toBe(0);
  });

  it("a streamed master over 120 MiB with no content-length is code 1", async () => {
    const chunk = new Uint8Array(1024 * 1024);
    let sent = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent >= 121) return controller.close();
        sent += 1;
        controller.enqueue(chunk);
      },
    });
    const tmp = await mkdtemp(join(tmpdir(), "enc-cap-stream-"));
    const r = await runPipelineEncode(
      { url: PRISMIC, class: "background", site: "reddoor-website" },
      {
        env,
        fetch: masterFetch(new Response(body, { status: 200 }), []),
        tmpDir: tmp,
        now: () => NOW,
      },
    );
    expect(r.code).toBe(1);
    expect(r.output).toContain("larger than");
  }, 60_000);

  it("a rendition PUT failure is code 1 and no manifest is written", async () => {
    const calls: Call[] = [];
    const tmp = await mkdtemp(join(tmpdir(), "enc-fail-"));
    const r = await runPipelineEncode(
      { url: PRISMIC, class: "player", site: "reddoor-website" },
      {
        env,
        fetch: fakeFetch(calls, (u) => u.includes("-1080.mp4")),
        spawn: spawnWritesOutputs(calls),
        tmpDir: tmp,
        stderr: { write: () => true },
      },
    );
    expect(r.code).toBe(1);
    expect(r.output).toContain("FAILED");
    const puts = calls.filter((c) => c.method === "PUT").map((c) => c.url!);
    expect(puts.some((u) => u.endsWith("manifest.json"))).toBe(false);
  });
});
