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

// Like fakeEvent, but also exposes getClientAddress + request headers so the
// _meta threading can pick up an IP / user-agent.
function fakeEventWithMeta(
  entries: Record<string, string>,
  fetchImpl: typeof fetch,
  meta: { ip?: string | (() => string); userAgent?: string } = {},
): RequestEvent {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.set(k, v);
  const headers = new Headers();
  if (meta.userAgent) headers.set("user-agent", meta.userAgent);
  const getClientAddress =
    typeof meta.ip === "function" ? meta.ip : meta.ip ? () => meta.ip as string : undefined;
  return {
    request: { formData: async () => fd, headers },
    fetch: fetchImpl,
    url: new URL("https://site.test/contact"),
    getClientAddress,
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

  it("silently accepts a filled honeypot without forwarding the submission", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { ok: true })) as unknown as typeof fetch;
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
    // No submission is forwarded — only the no-PII screen-out beacon may fire.
    const forwarded = (fetchMock as ReturnType<typeof vi.fn>).mock.calls.some(
      ([, init]) => init && !("screenOut" in JSON.parse((init as RequestInit).body as string)),
    );
    expect(forwarded).toBe(false);
  });

  it("silently accepts a too-fast fill without forwarding the submission", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { ok: true })) as unknown as typeof fetch;
    const action = createIngestAction({
      formType: "contact",
      getConfig: okConfig,
      buildPayload: () => ({}),
      now: () => 1_000_500, // 500ms after the planted ts → under MIN_FILL_MS
    });
    const result = await action(fakeEvent({ email: "a@b.co", ts: goodTs }, fetchMock));
    expect(result).toEqual({ success: true });
    const forwarded = (fetchMock as ReturnType<typeof vi.fn>).mock.calls.some(
      ([, init]) => init && !("screenOut" in JSON.parse((init as RequestInit).body as string)),
    );
    expect(forwarded).toBe(false);
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
    await expect(
      action(fakeEvent({ email: "a@b.co", ts: goodTs }, fetchMock)),
    ).rejects.toMatchObject({ status: 303, location: "/thank-you" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("redirects a bot-screened submission too (no signal to bots)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { ok: true })) as unknown as typeof fetch;
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
    // The submission is not forwarded — only the no-PII screen-out beacon may fire.
    const forwarded = (fetchMock as ReturnType<typeof vi.fn>).mock.calls.some(
      ([, init]) => init && !("screenOut" in JSON.parse((init as RequestInit).body as string)),
    );
    expect(forwarded).toBe(false);
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

  it("does NOT redirect when redirectTo is set but env config is missing (returns fail 500)", async () => {
    const fetchMock = vi.fn();
    const action = createIngestAction({
      formType: "contact",
      getConfig: () => ({}),
      buildPayload: () => ({}),
      redirectTo: "/thank-you",
      now,
    });
    const result = await action(fakeEvent({ email: "a@b.co", ts: goodTs }, fetchMock));
    expect((result as { status?: number }).status).toBe(500);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("beacons a screen-out (and still succeeds) when the honeypot is filled", async () => {
    const fetch = vi.fn(
      async (_url: string | URL | Request, _init?: RequestInit) =>
        new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    const action = createIngestAction({
      formType: "contact",
      getConfig: () => ({ url: "https://dash/api/forms/acme", token: "T" }),
      buildPayload: () => ({}),
    });
    const res = await action(
      fakeEvent({ "bot-field": "i am a bot" }, fetch as unknown as typeof fetch),
    );
    expect(res).toEqual({ success: true });
    const screenBeacon = fetch.mock.calls.find(
      ([, init]) =>
        init && JSON.parse((init as RequestInit).body as string).screenOut === "honeypot",
    );
    expect(screenBeacon).toBeTruthy();
  });

  it("does not beacon a screen-out for a clean submit", async () => {
    const fetch = vi.fn(
      async (_url: string | URL | Request, _init?: RequestInit) =>
        new Response(JSON.stringify({ ok: true, id: "x" }), { status: 200 }),
    );
    const action = createIngestAction({
      formType: "contact",
      getConfig: () => ({ url: "https://dash/api/forms/acme", token: "T" }),
      buildPayload: () => ({ name: "Jane" }),
      now: () => 10_000,
    });
    const res = await action(
      fakeEvent({ ts: "0" }, fetch as unknown as typeof fetch), // elapsed huge → not too-fast
    );
    expect(res).toEqual({ success: true });
    const anyScreen = fetch.mock.calls.some(
      ([, init]) => init && "screenOut" in JSON.parse((init as RequestInit).body as string),
    );
    expect(anyScreen).toBe(false);
  });

  it("auto-threads _meta (turnstileToken/clientIp/userAgent) into the forwarded payload", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true, id: "recM" }));
    const action = createIngestAction({
      formType: "contact",
      getConfig: okConfig,
      buildPayload: (form) => ({ email: form.get("email")?.toString() }),
      now,
    });
    const result = await action(
      fakeEventWithMeta(
        { email: "a@b.co", ts: goodTs, "cf-turnstile-response": "TOKEN123" },
        fetchMock,
        { ip: "203.0.113.7", userAgent: "Mozilla/5.0 (X)" },
      ),
    );
    expect(result).toEqual({ success: true });
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
    expect(body._meta).toEqual({
      turnstileToken: "TOKEN123",
      clientIp: "203.0.113.7",
      userAgent: "Mozilla/5.0 (X)",
    });
    // buildPayload output is still forwarded intact alongside _meta.
    expect(body.email).toBe("a@b.co");
    expect(body.formType).toBe("contact");
  });

  it("omits _meta entirely when no token/IP/UA are present", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true, id: "recN" }));
    const action = createIngestAction({
      formType: "contact",
      getConfig: okConfig,
      buildPayload: (form) => ({ email: form.get("email")?.toString() }),
      now,
    });
    await action(fakeEvent({ email: "a@b.co", ts: goodTs }, fetchMock));
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
    expect("_meta" in body).toBe(false);
  });

  it("reads the turnstile token from a custom turnstileFieldName", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true, id: "recC" }));
    const action = createIngestAction({
      formType: "contact",
      getConfig: okConfig,
      buildPayload: (form) => ({ email: form.get("email")?.toString() }),
      turnstileFieldName: "my-token",
      now,
    });
    await action(fakeEventWithMeta({ email: "a@b.co", ts: goodTs, "my-token": "T9" }, fetchMock));
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
    expect(body._meta).toEqual({ turnstileToken: "T9" });
  });

  it("still screens out a filled honeypot even when a turnstile token is present", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { ok: true })) as unknown as typeof fetch;
    const action = createIngestAction({
      formType: "contact",
      getConfig: okConfig,
      buildPayload: () => ({}),
      now,
    });
    const result = await action(
      fakeEventWithMeta(
        { email: "a@b.co", ts: goodTs, "bot-field": "i am a bot", "cf-turnstile-response": "T" },
        fetchMock,
        { ip: "203.0.113.7" },
      ),
    );
    expect(result).toEqual({ success: true });
    // Honeypot tier is unchanged: the real submission is never forwarded.
    const forwarded = (fetchMock as ReturnType<typeof vi.fn>).mock.calls.some(
      ([, init]) => init && !("screenOut" in JSON.parse((init as RequestInit).body as string)),
    );
    expect(forwarded).toBe(false);
  });

  it("still forwards (with just the token) when getClientAddress throws", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true, id: "recT" }));
    const action = createIngestAction({
      formType: "contact",
      getConfig: okConfig,
      buildPayload: (form) => ({ email: form.get("email")?.toString() }),
      now,
    });
    await action(
      fakeEventWithMeta(
        { email: "a@b.co", ts: goodTs, "cf-turnstile-response": "TOK" },
        fetchMock,
        {
          ip: () => {
            throw new Error("no address");
          },
        },
      ),
    );
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
    expect(body._meta).toEqual({ turnstileToken: "TOK" });
  });
});
