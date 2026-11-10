import { describe, it, expect, vi } from "vitest";
import {
  WHISPER_MODEL,
  segmentsToVtt,
  transcribe,
} from "../../src/video-pipeline/node/captions.js";

const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const audio = new Uint8Array([1, 2, 3, 4]);
const opts = (fetch: unknown) => ({
  accountId: "acct",
  token: "tok",
  fetch: fetch as typeof globalThis.fetch,
});

describe("node captions: transcribe", () => {
  it("uses result.vtt when present", async () => {
    const vtt = "WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nhi\n\n";
    const fetch = vi.fn(async () => reply(200, { success: true, result: { vtt, text: "hi" } }));
    expect(await transcribe(audio, opts(fetch))).toBe(vtt);
  });

  it("builds VTT from segments when there is no vtt", async () => {
    const fetch = vi.fn(async () =>
      reply(200, {
        success: true,
        result: { text: "hello", segments: [{ start: 1.5, end: 3, text: " Hello " }] },
      }),
    );
    const vtt = await transcribe(audio, opts(fetch));
    expect(vtt).toContain("00:00:01.500 --> 00:00:03.000");
    expect(vtt.startsWith("WEBVTT\n\n")).toBe(true);
  });

  it("success:false throws", async () => {
    const fetch = vi.fn(async () => reply(200, { success: false, errors: [{ message: "nope" }] }));
    await expect(transcribe(audio, opts(fetch))).rejects.toThrow("nope");
  });

  it("the request names the model and carries base64 audio as JSON", async () => {
    const fetch = vi.fn(async () => reply(200, { success: true, result: { vtt: "WEBVTT\n" } }));
    await transcribe(audio, opts(fetch));
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain(WHISPER_MODEL);
    expect(url).toContain("/accounts/acct/ai/run/");
    const body = JSON.parse(init.body as string);
    expect(body.audio).toBe(Buffer.from(audio).toString("base64"));
    expect(body.task).toBe("transcribe");
  });
});

describe("node captions: segmentsToVtt", () => {
  it("skips empty text and formats timestamps", () => {
    const vtt = segmentsToVtt([
      { start: 0, end: 1, text: "  " },
      { start: 3661.25, end: 3662, text: "late" },
    ]);
    expect(vtt).toBe("WEBVTT\n\n01:01:01.250 --> 01:01:02.000\nlate\n\n");
  });
});

describe("node captions: segmentsToVtt escaping and timing", () => {
  it("a longer run of dashes before > never leaves --> in cue text", () => {
    const vtt = segmentsToVtt([{ start: 0, end: 1, text: "a ---> b ----> c" }]);
    expect(vtt).toBe("WEBVTT\n\n00:00:00.000 --> 00:00:01.000\na -> b -> c\n\n");
  });

  it("escapes & and <, and replaces --> in cue text", () => {
    const vtt = segmentsToVtt([{ start: 0, end: 1, text: "Tom & Jerry <3 --> go" }]);
    expect(vtt).toBe("WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nTom &amp; Jerry &lt;3 -> go\n\n");
  });

  it("skips a segment with a non-finite start or end, or an end not after its start", () => {
    const vtt = segmentsToVtt([
      { start: Number.NaN, end: 1, text: "nan start" },
      { start: 0, end: Number.POSITIVE_INFINITY, text: "inf end" },
      { start: 2, end: 2, text: "zero length" },
      { start: 3, end: 1, text: "backwards" },
      { start: 4, end: 5, text: "ok" },
    ]);
    expect(vtt).toBe("WEBVTT\n\n00:00:04.000 --> 00:00:05.000\nok\n\n");
  });
});
