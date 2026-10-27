import { describe, it, expect, vi } from "vitest";
import { submitScreenOut } from "../../src/forms/client.js";

describe("submitScreenOut", () => {
  it("POSTs the reason with the token header to the ingest URL", async () => {
    const fetch = vi.fn(
      async (_url: string | URL | Request, _init?: RequestInit) =>
        new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    const res = await submitScreenOut({
      url: "https://dash/api/forms/acme",
      token: "T",
      reason: "honeypot",
      fetch: fetch as unknown as typeof globalThis.fetch,
    });
    expect(res.ok).toBe(true);
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe("https://dash/api/forms/acme");
    expect((init as RequestInit).method).toBe("POST");
    expect((init as RequestInit).headers).toMatchObject({ "x-forms-token": "T" });
    // The reserved beacon key is namespaced (`_screenOut`, matching `_meta`) so a
    // site's real form field named "screenOut" can never be mistaken for a beacon.
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ _screenOut: "honeypot" });
  });

  it("never throws on a network error", async () => {
    const fetch = vi.fn(async () => {
      throw new Error("boom");
    });
    const res = await submitScreenOut({
      url: "https://dash/api/forms/acme",
      token: "T",
      reason: "too-fast",
      fetch: fetch as unknown as typeof globalThis.fetch,
    });
    expect(res.ok).toBe(false);
  });

  it("aborts a hung fetch at the timeout and resolves to {ok:false} (can't delay the response)", async () => {
    vi.useFakeTimers();
    try {
      // A fetch that never settles on its own — it only rejects when the abort
      // signal fires. This is the one guarantee the AbortController exists for.
      const fetch = vi.fn(
        (_url: string | URL | Request, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
          }),
      );
      const p = submitScreenOut({
        url: "https://dash/api/forms/acme",
        token: "T",
        reason: "honeypot",
        fetch: fetch as unknown as typeof globalThis.fetch,
        timeoutMs: 1000,
      });
      await vi.advanceTimersByTimeAsync(1000); // fire the timeout → abort → reject → catch
      const res = await p;
      expect(res.ok).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
