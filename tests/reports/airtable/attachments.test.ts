import { describe, it, expect, afterEach, vi } from "vitest";
import { fetchAttachmentBytes } from "../../../src/reports/airtable/attachments.js";

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
