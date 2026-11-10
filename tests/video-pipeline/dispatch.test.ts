import { describe, it, expect, vi } from "vitest";
import { dispatchEncode } from "../../src/video-pipeline/dispatch.js";

const job = { url: "https://h.prismic.io/r/a.mp4", class: "player" as const, key: "site/a" };

describe("dispatch: dispatchEncode", () => {
  it("resolves on 204 and posts the event", async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 204 }));
    await dispatchEncode(job, {
      repo: "reddoorla/site",
      token: "t",
      fetch: fetch as unknown as typeof globalThis.fetch,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.github.com/repos/reddoorla/site/dispatches");
    expect(JSON.parse(init.body as string)).toEqual({
      event_type: "video-encode",
      client_payload: job,
    });
  });

  it("throws with the status on 404", async () => {
    const fetch = vi.fn(async () => new Response("Not Found", { status: 404 }));
    await expect(
      dispatchEncode(job, {
        repo: "reddoorla/site",
        token: "t",
        fetch: fetch as unknown as typeof globalThis.fetch,
      }),
    ).rejects.toThrow("HTTP 404");
  });

  it("a bad repo string throws without fetching", async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 204 }));
    await expect(
      dispatchEncode(job, {
        repo: "not a repo",
        token: "t",
        fetch: fetch as unknown as typeof globalThis.fetch,
      }),
    ).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
});
