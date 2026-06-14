import { describe, it, expect, vi } from "vitest";
import { submitToIngest, screenSubmission, MIN_FILL_MS } from "../../src/forms/client.js";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("submitToIngest", () => {
  it("returns ok + id and sends the token header + JSON body on success", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true, id: "recX" }));
    const out = await submitToIngest({
      url: "https://dash/api/forms/reddoor",
      token: "tok",
      payload: { formType: "contact", email: "a@b.co" },
      fetch: fetchMock,
    });
    expect(out).toEqual({ ok: true, id: "recX" });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://dash/api/forms/reddoor");
    expect((init.headers as Record<string, string>)["x-forms-token"]).toBe("tok");
    expect(JSON.parse(init.body as string)).toEqual({ formType: "contact", email: "a@b.co" });
  });

  it("returns an error result for a non-2xx response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(401, { ok: false, error: "unauthorized" }));
    const out = await submitToIngest({
      url: "https://dash/api/forms/reddoor",
      token: "bad",
      payload: { email: "a@b.co" },
      fetch: fetchMock,
    });
    expect(out).toEqual({ ok: false, status: 401, error: "unauthorized" });
  });

  it("returns a status-0 error when fetch throws (network failure)", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    const out = await submitToIngest({
      url: "https://dash/api/forms/reddoor",
      token: "tok",
      payload: { email: "a@b.co" },
      fetch: fetchMock,
    });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.status).toBe(0);
  });
});

describe("screenSubmission", () => {
  it("passes a clean submission", () => {
    expect(screenSubmission({ botField: "", elapsedMs: MIN_FILL_MS + 1 })).toEqual({ ok: true });
    expect(screenSubmission({})).toEqual({ ok: true });
    expect(screenSubmission({ elapsedMs: null })).toEqual({ ok: true });
  });

  it("rejects a filled honeypot", () => {
    expect(screenSubmission({ botField: "i am a bot" })).toEqual({ ok: false, reason: "honeypot" });
  });

  it("rejects a too-fast fill", () => {
    expect(screenSubmission({ elapsedMs: 500 })).toEqual({ ok: false, reason: "too-fast" });
  });
});
