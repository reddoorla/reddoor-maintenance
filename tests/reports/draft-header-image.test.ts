import { describe, it, expect, vi } from "vitest";
import { refreshHeaderImage } from "../../src/reports/draft.js";
import type { WebsiteRow } from "../../src/reports/airtable/websites.js";

const site = { id: "rec1", name: "Acme", url: "https://acme.com/" } as WebsiteRow;

describe("reports/draft refreshHeaderImage", () => {
  it("uploads a freshly generated header", async () => {
    const upload = vi.fn(async () => {});
    const generate = vi.fn(async () => ({
      bytes: new Uint8Array([1]),
      domain: "acme.com",
      filename: "acmeHeader.jpg",
      contentType: "image/jpeg" as const,
    }));
    const ok = await refreshHeaderImage(site, { generate, upload });
    expect(ok).toBe(true);
    expect(upload).toHaveBeenCalledWith(
      "rec1",
      "Header image",
      new Uint8Array([1]),
      "acmeHeader.jpg",
      "image/jpeg",
    );
  });

  it("returns false and does NOT throw when capture fails — the draft continues", async () => {
    const upload = vi.fn(async () => {});
    const generate = vi.fn(async () => {
      throw new Error("net::ERR_TIMED_OUT");
    });
    await expect(refreshHeaderImage(site, { generate, upload })).resolves.toBe(false);
    expect(upload).not.toHaveBeenCalled();
  });

  it("returns false when the upload fails, leaving the stored header intact", async () => {
    const generate = vi.fn(async () => ({
      bytes: new Uint8Array([1]),
      domain: "acme.com",
      filename: "acmeHeader.jpg",
      contentType: "image/jpeg" as const,
    }));
    const upload = vi.fn(async () => {
      throw new Error("airtable 503");
    });
    await expect(refreshHeaderImage(site, { generate, upload })).resolves.toBe(false);
  });

  it("skips a site with no URL", async () => {
    const generate = vi.fn();
    const upload = vi.fn();
    const ok = await refreshHeaderImage({ ...site, url: "" } as WebsiteRow, { generate, upload });
    expect(ok).toBe(false);
    expect(generate).not.toHaveBeenCalled();
  });
});
