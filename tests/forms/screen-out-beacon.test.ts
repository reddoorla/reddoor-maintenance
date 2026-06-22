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
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ screenOut: "honeypot" });
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
});
