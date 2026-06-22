import { describe, it, expect, vi } from "vitest";
import type { RequestEvent } from "@sveltejs/kit";
import { createIngestEndpoint } from "../../src/forms/endpoint.js";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

// Build a fake RequestEvent whose request.json() resolves to `body`, or throws
// when `body` is the BAD_JSON sentinel (simulating a non-JSON request body).
const BAD_JSON = Symbol("bad-json");
function fakeEvent(body: unknown, fetchImpl: typeof fetch): RequestEvent {
  return {
    request: {
      json: async () => {
        if (body === BAD_JSON) throw new SyntaxError("Unexpected token < in JSON");
        return body;
      },
    },
    fetch: fetchImpl,
    url: new URL("https://site.test/api/forms"),
  } as unknown as RequestEvent;
}

const okConfig = () => ({ url: "https://dash/api/forms/sonder", token: "tok" });

describe("createIngestEndpoint", () => {
  it("forwards a clean multi-type submission and returns ok", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true, id: "recX" }));
    const endpoint = createIngestEndpoint({
      getConfig: okConfig,
      buildPayload: (body) => ({
        formType: body.formType as string,
        name: body.name as string,
        email: body.email as string,
      }),
    });
    const res = await endpoint(
      fakeEvent({ formType: "inquiry", name: "Ada", email: "a@b.co" }, fetchMock),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://dash/api/forms/sonder");
    expect((init.headers as Record<string, string>)["x-forms-token"]).toBe("tok");
    expect(JSON.parse(init.body as string)).toEqual({
      formType: "inquiry",
      name: "Ada",
      email: "a@b.co",
    });
  });

  it("silently accepts a filled honeypot without forwarding the submission", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { ok: true })) as unknown as typeof fetch;
    const endpoint = createIngestEndpoint({
      getConfig: okConfig,
      buildPayload: (body) => ({ formType: body.formType as string, email: body.email as string }),
    });
    const res = await endpoint(
      fakeEvent({ formType: "contact", email: "a@b.co", "bot-field": "i am a bot" }, fetchMock),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    // No submission is forwarded — only the no-PII screen-out beacon may fire.
    const forwarded = (fetchMock as ReturnType<typeof vi.fn>).mock.calls.some(
      ([, init]) => init && !("screenOut" in JSON.parse((init as RequestInit).body as string)),
    );
    expect(forwarded).toBe(false);
  });

  it("returns 400 on a non-JSON / unparseable body", async () => {
    const fetchMock = vi.fn();
    const endpoint = createIngestEndpoint({
      getConfig: okConfig,
      buildPayload: () => ({ formType: "contact" }),
    });
    const res = await endpoint(fakeEvent(BAD_JSON, fetchMock));
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 400 when formType is missing", async () => {
    const fetchMock = vi.fn();
    const endpoint = createIngestEndpoint({
      getConfig: okConfig,
      buildPayload: (body) => ({ email: body.email as string }),
    });
    const res = await endpoint(fakeEvent({ email: "a@b.co" }, fetchMock));
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 400 when formType is not a known submission type", async () => {
    const fetchMock = vi.fn();
    const endpoint = createIngestEndpoint({
      getConfig: okConfig,
      buildPayload: (body) => ({ formType: body.formType as string, email: "a@b.co" }),
    });
    const res = await endpoint(fakeEvent({ formType: "evil" }, fetchMock));
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses the fixed formType even when the body carries another", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true, id: "recZ" }));
    const endpoint = createIngestEndpoint({
      formType: "contact",
      getConfig: okConfig,
      buildPayload: (body) => ({ formType: body.formType as string, email: "a@b.co" }),
    });
    const res = await endpoint(fakeEvent({ formType: "evil", email: "a@b.co" }, fetchMock));
    expect(res.status).toBe(200);
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body as string).formType).toBe("contact");
  });

  it("returns 500 when env config is missing", async () => {
    const fetchMock = vi.fn();
    const endpoint = createIngestEndpoint({
      getConfig: () => ({}),
      buildPayload: (body) => ({ formType: body.formType as string, email: "a@b.co" }),
    });
    const res = await endpoint(fakeEvent({ formType: "contact" }, fetchMock));
    expect(res.status).toBe(500);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 502 when the ingest endpoint rejects", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(401, { ok: false, error: "no" }));
    const endpoint = createIngestEndpoint({
      getConfig: okConfig,
      buildPayload: (body) => ({ formType: body.formType as string, email: "a@b.co" }),
    });
    const res = await endpoint(fakeEvent({ formType: "contact" }, fetchMock));
    expect(res.status).toBe(502);
  });

  it("bundles a buildPayload `extra` object into the forwarded payload", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true, id: "recE" }));
    const endpoint = createIngestEndpoint({
      getConfig: okConfig,
      buildPayload: (body) => ({
        formType: body.formType as string,
        email: "a@b.co",
        extra: { piece: "Untitled", guests: "2" },
      }),
    });
    await endpoint(fakeEvent({ formType: "rsvp" }, fetchMock));
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body as string).extra).toEqual({
      piece: "Untitled",
      guests: "2",
    });
  });

  it("returns 400 on a parseable-but-non-object body (e.g. a bare number)", async () => {
    const fetchMock = vi.fn();
    const endpoint = createIngestEndpoint({
      getConfig: okConfig,
      buildPayload: () => ({ formType: "contact" }),
    });
    const res = await endpoint(fakeEvent(42, fetchMock));
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 400 (not 500) when buildPayload throws on malformed input", async () => {
    const fetchMock = vi.fn();
    const endpoint = createIngestEndpoint({
      getConfig: okConfig,
      // A careless mapping that assumes `name` is present and a string.
      buildPayload: (body) => ({ formType: "contact", name: (body.name as string).trim() }),
    });
    const res = await endpoint(fakeEvent({ formType: "contact" }, fetchMock));
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("beacons a screen-out (and still returns ok) when the honeypot is filled", async () => {
    const fetch = vi.fn(
      async (_url: string | URL | Request, _init?: RequestInit) =>
        new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    const endpoint = createIngestEndpoint({
      getConfig: okConfig,
      buildPayload: (body) => ({ formType: body.formType as string, email: body.email as string }),
    });
    const res = await endpoint(
      fakeEvent(
        { formType: "contact", email: "a@b.co", "bot-field": "i am a bot" },
        fetch as unknown as typeof fetch,
      ),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
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
    const endpoint = createIngestEndpoint({
      getConfig: okConfig,
      buildPayload: (body) => ({ formType: body.formType as string, email: body.email as string }),
    });
    const res = await endpoint(
      fakeEvent({ formType: "contact", email: "a@b.co" }, fetch as unknown as typeof fetch),
    );
    expect(res.status).toBe(200);
    const anyScreen = fetch.mock.calls.some(
      ([, init]) => init && "screenOut" in JSON.parse((init as RequestInit).body as string),
    );
    expect(anyScreen).toBe(false);
  });
});
