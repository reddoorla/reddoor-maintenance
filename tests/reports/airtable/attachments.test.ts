import { describe, it, expect, afterEach, vi } from "vitest";
import {
  fetchAttachmentBytes,
  uploadAttachment,
} from "../../../src/reports/airtable/attachments.js";

/** Build a minimal Response-like stub for the global fetch mock. */
function fetchStub(opts: {
  ok?: boolean;
  status?: number;
  statusText?: string;
  contentType?: string | null;
  body: Uint8Array | string;
}) {
  const bytes = typeof opts.body === "string" ? new TextEncoder().encode(opts.body) : opts.body;
  return {
    ok: opts.ok ?? true,
    status: opts.status ?? 200,
    statusText: opts.statusText ?? "OK",
    headers: {
      get: (name: string) =>
        name.toLowerCase() === "content-type" ? (opts.contentType ?? null) : null,
    },
    arrayBuffer: async () =>
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  } as unknown as Response;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("fetchAttachmentBytes", () => {
  it("returns the bytes + content-type for a real image response", async () => {
    const img = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]); // JPEG SOI marker
    global.fetch = vi
      .fn()
      .mockResolvedValue(fetchStub({ contentType: "image/jpeg", body: img })) as typeof fetch;
    const out = await fetchAttachmentBytes("https://example.com/header.jpg");
    expect(out.contentType).toBe("image/jpeg");
    expect(Array.from(out.bytes)).toEqual([0xff, 0xd8, 0xff, 0xe0]);
  });

  it("throws on a non-ok response (existing behavior)", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(
        fetchStub({ ok: false, status: 403, statusText: "Forbidden", body: "" }),
      ) as typeof fetch;
    await expect(fetchAttachmentBytes("https://example.com/x.jpg")).rejects.toThrow(
      /403 Forbidden/,
    );
  });

  it("rejects a 200 that is actually an HTML error/login page (expired signed URL)", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      fetchStub({
        contentType: "text/html; charset=utf-8",
        body: "<!doctype html><html><head><title>Sign in</title></head></html>",
      }),
    ) as typeof fetch;
    await expect(fetchAttachmentBytes("https://example.com/expired.jpg")).rejects.toThrow(
      /did not return image data|HTML page/,
    );
  });

  it("rejects an HTML page even when the content-type header is missing", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      fetchStub({
        contentType: null,
        body: "<html><body>Not found</body></html>",
      }),
    ) as typeof fetch;
    await expect(fetchAttachmentBytes("https://example.com/missing.jpg")).rejects.toThrow(
      /did not return image data|HTML page/,
    );
  });

  it("accepts an image/* content-type even if the bytes are opaque (real image data)", async () => {
    // PNG signature — definitely not HTML, and the content-type is image/png.
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    global.fetch = vi
      .fn()
      .mockResolvedValue(fetchStub({ contentType: "image/png", body: png })) as typeof fetch;
    const out = await fetchAttachmentBytes("https://example.com/header.png");
    expect(out.contentType).toBe("image/png");
    expect(out.bytes.length).toBe(8);
  });
});

describe("uploadAttachment", () => {
  /** Airtable's upload endpoint APPENDS, so its response carries the field's
   *  full post-append list — keyed by FIELD ID, which is what the live API does
   *  (see the field-id test below). `key` overrides that for the name-keyed and
   *  malformed cases. */
  function uploadStubs(existingIds: string[], key = "fldBUAW180p8MIpvh") {
    const calls: Array<{ url: string; method: string; body: unknown }> = [];
    global.fetch = vi.fn(async (url: string, init: RequestInit) => {
      calls.push({
        url: String(url),
        method: init.method ?? "GET",
        body: init.body ? JSON.parse(String(init.body)) : undefined,
      });
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        text: async () => "",
        json: async () => ({ fields: { [key]: existingIds.map((id) => ({ id })) } }),
      } as unknown as Response;
    }) as unknown as typeof fetch;
    return calls;
  }

  const env = { AIRTABLE_PAT: "pat_test", AIRTABLE_BASE_ID: "app_test" };

  it("prunes back to the newest attachment when replace is set", async () => {
    Object.assign(process.env, env);
    // Four stacked headers — exactly the state that made beachfront send a
    // stale [0] header on 2026-08-24.
    const calls = uploadStubs(["attOld1", "attOld2", "attOld3", "attNew"]);

    await uploadAttachment("recX", "Header image", new Uint8Array([1, 2]), "h.jpg", "image/jpeg", {
      replaceIn: "Websites",
    });

    expect(calls).toHaveLength(2);
    expect(calls[0]?.url).toContain("uploadAttachment");
    expect(calls[1]?.method).toBe("PATCH");
    // Only the just-uploaded attachment survives.
    expect(calls[1]?.body).toEqual({ fields: { "Header image": [{ id: "attNew" }] } });
  });

  // REGRESSION (2026-08-24): the prune PATCHed /v0/{baseId}/{recordId}, omitting the
  // TABLE segment Airtable's update endpoint requires. Every call answered 403
  // Forbidden — which reads like a token-scope problem, not a malformed URL, and cost
  // a detour before the real cause was found. Pin the full path shape.
  it("PATCHes /v0/{base}/{table}/{record} — the table segment is required", async () => {
    Object.assign(process.env, env);
    const calls = uploadStubs(["attOld", "attNew"]);
    await uploadAttachment("recX", "Header image", new Uint8Array([1]), "h.jpg", "image/jpeg", {
      replaceIn: "Websites",
    });
    expect(calls[1]?.url).toBe("https://api.airtable.com/v0/app_test/Websites/recX");
  });

  // REGRESSION (2026-08-24): the prune looked the list up by FIELD NAME, but the live
  // uploadAttachment response keys `fields` by FIELD ID. The lookup returned undefined,
  // the empty list hit the `length <= 1` guard, and the prune no-opped SILENTLY on every
  // real call — while the original stub, keyed by name, asserted the assumption instead
  // of the API. Eleven site header fields stacked before it surfaced.
  it("prunes when the response is keyed by field ID, as the live API keys it", async () => {
    Object.assign(process.env, env);
    const calls = uploadStubs(["attOld", "attNew"], "fldBUAW180p8MIpvh");
    await uploadAttachment("recX", "Header image", new Uint8Array([1]), "h.jpg", "image/jpeg", {
      replaceIn: "Websites",
    });
    expect(calls).toHaveLength(2);
    expect(calls[1]?.method).toBe("PATCH");
    expect(calls[1]?.body).toEqual({ fields: { "Header image": [{ id: "attNew" }] } });
  });

  it("still prunes a name-keyed response, if Airtable ever switches", async () => {
    Object.assign(process.env, env);
    const calls = uploadStubs(["attOld", "attNew"], "Header image");
    await uploadAttachment("recX", "Header image", new Uint8Array([1]), "h.jpg", "image/jpeg", {
      replaceIn: "Websites",
    });
    expect(calls).toHaveLength(2);
    expect(calls[1]?.body).toEqual({ fields: { "Header image": [{ id: "attNew" }] } });
  });

  it("warns rather than returning quietly when no attachment list can be found", async () => {
    Object.assign(process.env, env);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: "OK",
      text: async () => "",
      json: async () => ({ fields: {} }),
    })) as unknown as typeof fetch;

    await uploadAttachment("recX", "Header image", new Uint8Array([1]), "h.jpg", "image/jpeg", {
      replaceIn: "Websites",
    });
    // Silence is exactly what let the no-op ship unnoticed.
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("prune skipped"));
  });

  it("leaves the field alone without replace (history-keeping fields)", async () => {
    Object.assign(process.env, env);
    const calls = uploadStubs(["attOld", "attNew"]);
    await uploadAttachment("recX", "Rendered HTML", "<p>x</p>", "r.html", "text/html");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toContain("uploadAttachment");
  });

  it("does not prune when the upload left a single attachment", async () => {
    Object.assign(process.env, env);
    const calls = uploadStubs(["attOnly"]);
    await uploadAttachment("recX", "Header image", new Uint8Array([1]), "h.jpg", "image/jpeg", {
      replaceIn: "Websites",
    });
    expect(calls).toHaveLength(1);
  });

  it("does not fail the upload when the prune request fails", async () => {
    Object.assign(process.env, env);
    let n = 0;
    global.fetch = vi.fn(async () => {
      n += 1;
      return {
        ok: n === 1,
        status: n === 1 ? 200 : 422,
        statusText: n === 1 ? "OK" : "Unprocessable",
        text: async () => "",
        json: async () => ({ fields: { "Header image": [{ id: "a" }, { id: "b" }] } }),
      } as unknown as Response;
    }) as unknown as typeof fetch;

    // The file is already uploaded by then — a prune failure must not throw.
    await expect(
      uploadAttachment("recX", "Header image", new Uint8Array([1]), "h.jpg", "image/jpeg", {
        replaceIn: "Websites",
      }),
    ).resolves.toBeUndefined();
  });
});
