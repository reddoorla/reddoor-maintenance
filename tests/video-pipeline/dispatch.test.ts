import { describe, it, expect, vi } from "vitest";
import { dispatchEncode } from "../../src/video-pipeline/dispatch.js";

const job = { url: "https://h.prismic.io/r/a.mp4", class: "player" as const, key: "site/a" };

describe("dispatch: dispatchEncode", () => {
  it("resolves on 204 and posts a workflow dispatch with the inputs", async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 204 }));
    await dispatchEncode(job, {
      repo: "reddoorla/site",
      token: "t",
      fetch: fetch as unknown as typeof globalThis.fetch,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(
      "https://api.github.com/repos/reddoorla/site/actions/workflows/video-encode.yml/dispatches",
    );
    expect(JSON.parse(init.body as string)).toEqual({
      ref: "main",
      inputs: { url: job.url, class: job.class, key: job.key },
    });
  });

  it("a custom ref and workflow are used in the URL and the body", async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 204 }));
    await dispatchEncode(job, {
      repo: "reddoorla/site",
      token: "t",
      fetch: fetch as unknown as typeof globalThis.fetch,
      ref: "release/2026.11",
      workflow: "encode-two.yaml",
    });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(
      "https://api.github.com/repos/reddoorla/site/actions/workflows/encode-two.yaml/dispatches",
    );
    expect(JSON.parse(init.body as string)).toEqual({
      ref: "release/2026.11",
      inputs: { url: job.url, class: job.class, key: job.key },
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

  it("any 2xx is success: 200 resolves", async () => {
    const fetch = vi.fn(async () => new Response("{}", { status: 200 }));
    await expect(
      dispatchEncode(job, {
        repo: "reddoorla/site",
        token: "t",
        fetch: fetch as unknown as typeof globalThis.fetch,
      }),
    ).resolves.toBeUndefined();
  });

  it("a 422 is a failure, with its status in the message", async () => {
    const fetch = vi.fn(async () => new Response("{}", { status: 422 }));
    await expect(
      dispatchEncode(job, {
        repo: "reddoorla/site",
        token: "t",
        fetch: fetch as unknown as typeof globalThis.fetch,
      }),
    ).rejects.toThrow("HTTP 422");
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

  it("a bad workflow throws without fetching", async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 204 }));
    await expect(
      dispatchEncode(job, {
        repo: "reddoorla/site",
        token: "t",
        fetch: fetch as unknown as typeof globalThis.fetch,
        workflow: "../x.yml",
      }),
    ).rejects.toThrow("bad workflow");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("a bad ref throws without fetching", async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 204 }));
    await expect(
      dispatchEncode(job, {
        repo: "reddoorla/site",
        token: "t",
        fetch: fetch as unknown as typeof globalThis.fetch,
        ref: "a..b",
      }),
    ).rejects.toThrow("bad ref");
    expect(fetch).not.toHaveBeenCalled();
  });
});
