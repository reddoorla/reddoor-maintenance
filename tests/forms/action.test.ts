import { describe, it, expect, vi } from "vitest";
import type { RequestEvent } from "@sveltejs/kit";
import { createIngestAction } from "../../src/forms/action.js";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

// Build a fake RequestEvent the factory can consume. `entries` are the submitted
// form fields; `fetchImpl` is the injected fetch.
function fakeEvent(entries: Record<string, string>, fetchImpl: typeof fetch): RequestEvent {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.set(k, v);
  return {
    request: { formData: async () => fd },
    fetch: fetchImpl,
    url: new URL("https://site.test/contact"),
  } as unknown as RequestEvent;
}

const okConfig = () => ({ url: "https://dash/api/forms/acme", token: "tok" });
// A clock 10s ahead of the planted ts so the timing screen passes.
const now = () => 1_000_000 + 10_000;
const goodTs = String(1_000_000);

describe("createIngestAction", () => {
  it("forwards a clean submission and returns success", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true, id: "recX" }));
    const action = createIngestAction({
      formType: "contact",
      getConfig: okConfig,
      buildPayload: (form, event) => ({
        name: form.get("name")?.toString(),
        email: form.get("email")?.toString(),
        sourceUrl: `${event.url.origin}${event.url.pathname}`,
      }),
      now,
    });
    const result = await action(fakeEvent({ name: "Ada", email: "a@b.co", ts: goodTs }, fetchMock));
    expect(result).toEqual({ success: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://dash/api/forms/acme");
    expect((init.headers as Record<string, string>)["x-forms-token"]).toBe("tok");
    expect(JSON.parse(init.body as string)).toEqual({
      formType: "contact",
      name: "Ada",
      email: "a@b.co",
      sourceUrl: "https://site.test/contact",
    });
  });

  it("silently accepts a filled honeypot without forwarding", async () => {
    const fetchMock = vi.fn();
    const action = createIngestAction({
      formType: "contact",
      getConfig: okConfig,
      buildPayload: () => ({}),
      now,
    });
    const result = await action(
      fakeEvent({ email: "a@b.co", ts: goodTs, "bot-field": "i am a bot" }, fetchMock),
    );
    expect(result).toEqual({ success: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("silently accepts a too-fast fill without forwarding", async () => {
    const fetchMock = vi.fn();
    const action = createIngestAction({
      formType: "contact",
      getConfig: okConfig,
      buildPayload: () => ({}),
      now: () => 1_000_500, // 500ms after the planted ts → under MIN_FILL_MS
    });
    const result = await action(fakeEvent({ email: "a@b.co", ts: goodTs }, fetchMock));
    expect(result).toEqual({ success: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns fail(500) when env config is missing", async () => {
    const fetchMock = vi.fn();
    const action = createIngestAction({
      formType: "contact",
      getConfig: () => ({}),
      buildPayload: () => ({}),
      now,
    });
    const result = await action(fakeEvent({ email: "a@b.co", ts: goodTs }, fetchMock));
    expect((result as { status?: number }).status).toBe(500);
    expect((result as { data?: { error: string } }).data?.error).toMatch(/unavailable/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns fail(502) when the ingest endpoint rejects", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(401, { ok: false, error: "unauthorized" }));
    const action = createIngestAction({
      formType: "contact",
      getConfig: okConfig,
      buildPayload: (form) => ({ email: form.get("email")?.toString() }),
      now,
    });
    const result = await action(fakeEvent({ email: "a@b.co", ts: goodTs }, fetchMock));
    expect((result as { status?: number }).status).toBe(502);
  });

  it("does not treat a missing ts as too-fast (honeypot remains primary)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true, id: "recY" }));
    const action = createIngestAction({
      formType: "newsletter",
      getConfig: okConfig,
      buildPayload: (form) => ({ email: form.get("email")?.toString() }),
      now,
    });
    const result = await action(fakeEvent({ email: "a@b.co" }, fetchMock)); // no ts
    expect(result).toEqual({ success: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body as string).formType).toBe("newsletter");
  });

  it("uses the injected formType even when buildPayload tries to override it", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true, id: "recZ" }));
    const action = createIngestAction({
      formType: "contact",
      getConfig: okConfig,
      buildPayload: () => ({ formType: "evil", email: "a@b.co" }),
      now,
    });
    const result = await action(fakeEvent({ email: "a@b.co", ts: goodTs }, fetchMock));
    expect(result).toEqual({ success: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body as string).formType).toBe("contact");
  });

  it("does not screen out a whitespace-only honeypot (still forwards)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true, id: "recW" }));
    const action = createIngestAction({
      formType: "contact",
      getConfig: okConfig,
      buildPayload: (form) => ({ email: form.get("email")?.toString() }),
      now,
    });
    const result = await action(
      fakeEvent({ email: "a@b.co", ts: goodTs, "bot-field": "   " }, fetchMock),
    );
    expect(result).toEqual({ success: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("redirects on success when redirectTo is set", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true, id: "recX" }));
    const action = createIngestAction({
      formType: "contact",
      getConfig: okConfig,
      buildPayload: (form) => ({ email: form.get("email")?.toString() }),
      redirectTo: "/thank-you",
      now,
    });
    await expect(action(fakeEvent({ email: "a@b.co", ts: goodTs }, fetchMock))).rejects.toMatchObject(
      { status: 303, location: "/thank-you" },
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("redirects a bot-screened submission too (no signal to bots)", async () => {
    const fetchMock = vi.fn();
    const action = createIngestAction({
      formType: "contact",
      getConfig: okConfig,
      buildPayload: () => ({}),
      redirectTo: "/thank-you",
      now,
    });
    await expect(
      action(fakeEvent({ email: "a@b.co", ts: goodTs, "bot-field": "bot" }, fetchMock)),
    ).rejects.toMatchObject({ status: 303, location: "/thank-you" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does NOT redirect on ingest failure (stays on page with the error)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(502, { ok: false, error: "down" }));
    const action = createIngestAction({
      formType: "contact",
      getConfig: okConfig,
      buildPayload: (form) => ({ email: form.get("email")?.toString() }),
      redirectTo: "/thank-you",
      now,
    });
    const result = await action(fakeEvent({ email: "a@b.co", ts: goodTs }, fetchMock));
    expect((result as { status?: number }).status).toBe(502);
  });
});
