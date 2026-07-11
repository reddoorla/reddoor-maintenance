import { describe, it, expect, vi } from "vitest";
import {
  submitToIngest,
  screenSubmission,
  MIN_FILL_MS,
  INGEST_TIMEOUT_MS,
} from "../../src/forms/client.js";

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
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(401, { ok: false, error: "unauthorized" }));
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

  /** A fetch that never settles until its abort signal fires — models a central
   *  ingest hung mid-deploy. Without a bounded budget the site action awaits
   *  until Netlify kills the function (espada's 2026-07-10 form-e2e warns). */
  function hungFetch() {
    return vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("This operation was aborted", "AbortError")),
          );
        }),
    );
  }

  it("passes an abort signal to fetch (the timeout budget's hook)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true, id: "recX" }));
    await submitToIngest({
      url: "https://dash/api/forms/reddoor",
      token: "tok",
      payload: { email: "a@b.co" },
      fetch: fetchMock,
    });
    const [, init] = fetchMock.mock.calls[0]!;
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("aborts a hung ingest call once timeoutMs elapses, with a friendly error", async () => {
    const fetchMock = hungFetch();
    const pending = submitToIngest({
      url: "https://dash/api/forms/reddoor",
      token: "tok",
      payload: { email: "a@b.co" },
      fetch: fetchMock as unknown as typeof fetch,
      timeoutMs: 50,
    });
    // Real-time sentinel so a regression (no abort budget) fails instead of
    // wedging the suite on a never-settling promise. Generous margin over the
    // 50ms budget — it only fires when the abort never happens at all.
    const out = await Promise.race([
      pending,
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error("submitToIngest never aborted — no timeout budget exists")),
          10_000,
        ),
      ),
    ]);
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.status).toBe(0);
      expect(out.error).toMatch(/abort/i);
    }
  });

  it("defaults the budget to 8s (bounded well inside a 10s Netlify sync function)", () => {
    expect(INGEST_TIMEOUT_MS).toBe(8000);
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

  it("uses an 800ms threshold so realistic-but-quick human fills are not dropped", () => {
    // Tuned down from 2000ms: a fill that takes ~0.8s+ (page render → fill →
    // click → network) is a plausible fast human and must NOT be silently lost.
    // Only sub-threshold, effectively-instant submits read as a bot.
    expect(MIN_FILL_MS).toBe(800);
    expect(screenSubmission({ elapsedMs: 1000 })).toEqual({ ok: true });
    expect(screenSubmission({ elapsedMs: MIN_FILL_MS })).toEqual({ ok: true }); // boundary: == is OK
    expect(screenSubmission({ elapsedMs: MIN_FILL_MS - 1 })).toEqual({
      ok: false,
      reason: "too-fast",
    });
  });

  it("treats a forged FUTURE timestamp (negative elapsedMs) as too-fast, not a pass", () => {
    // A bot that posts a future `ts` makes elapsedMs go negative. The old `>= 0`
    // guard let that skip the too-fast branch and return ok — silently bypassing the
    // timing gate. A negative elapsed time is impossible for a real fill, so any
    // numeric elapsed below the floor (negatives included) must screen as too-fast.
    expect(screenSubmission({ elapsedMs: -1000 })).toEqual({ ok: false, reason: "too-fast" });
    expect(screenSubmission({ elapsedMs: -1 })).toEqual({ ok: false, reason: "too-fast" });
  });
});
