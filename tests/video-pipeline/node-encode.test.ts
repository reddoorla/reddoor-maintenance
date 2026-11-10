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

describe("node encode: end to end with fakes", () => {
  it("a player job uploads renditions and captions, manifest last, and the manifest parses", async () => {
    const calls: Call[] = [];
    const tmp = await mkdtemp(join(tmpdir(), "enc-e2e-"));
    const r = await runPipelineEncode(
      { url: PRISMIC, class: "player", site: "reddoor-website" },
      {
        env,
        fetch: fakeFetch(calls),
        spawn: spawnWritesOutputs(calls),
        tmpDir: tmp,
        now: () => new Date("2026-11-10T00:00:00Z"),
        stderr: { write: () => true },
      },
    );
    expect(r.code, r.output).toBe(0);
    const puts = calls.filter((c) => c.method === "PUT");
    expect(puts.at(-1)!.url).toBe(`${R2}/reddoor-video/reddoor-website/offer-hero/manifest.json`);
    const putUrls = puts.map((c) => c.url!);
    for (const file of [
      "offer-hero-1080.mp4",
      "offer-hero-720.mp4",
      "offer-hero-poster.jpg",
      "offer-hero.vtt",
    ]) {
      expect(putUrls).toContain(`${R2}/reddoor-video/reddoor-website/offer-hero/${file}`);
    }
    const manifest = parseManifest(JSON.parse(bodyText(puts.at(-1)!.body)));
    expect(manifest).not.toBeNull();
    expect(manifest!.key).toBe("reddoor-website/offer-hero");
    expect(manifest!.source).toBe("/reddoor-la/Offer%20Hero.mp4");
    expect(manifest!.files.captions).toBe("offer-hero.vtt");
    expect(manifest!.files.mobileMp4).toBe("offer-hero-720.mp4");
    expect(r.output).toContain("MANIFEST reddoor-website/offer-hero/manifest.json");
  });

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
