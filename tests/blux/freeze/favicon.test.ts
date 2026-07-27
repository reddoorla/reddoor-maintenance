import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pickIconUrl, emitFavicon } from "../../../src/blux/freeze/favicon.js";

const HEAD =
  `<link rel="icon" type="image/png" sizes="32x32" href="//cdn.example.net/a/icon-32.png">` +
  `<link rel="icon" type="image/png" sizes="192x192" href="//cdn.example.net/a/icon-192.png">` +
  `<link rel="apple-touch-icon" href="//cdn.example.net/a/icon-180.png">` +
  `<link rel="stylesheet" href="https://fonts.googleapis.com/css?family=X">`;

describe("pickIconUrl", () => {
  it("picks the largest icon by sizes attribute", () => {
    expect(pickIconUrl(HEAD)).toBe("//cdn.example.net/a/icon-192.png");
  });

  it("falls back to a filename size hint when sizes is absent", () => {
    const html =
      `<link rel="icon" href="/img/icon-48.png">` +
      `<link rel="apple-touch-icon" href="/img/icon-180.png">`;
    expect(pickIconUrl(html)).toBe("/img/icon-180.png");
  });

  it("returns null when the head links no icon", () => {
    expect(pickIconUrl(`<link rel="stylesheet" href="x.css">`)).toBeNull();
  });
});

describe("emitFavicon", () => {
  it("fetches a protocol-relative CDN icon over https and writes favicon.png", async () => {
    const outDir = mkdtempSync(join(tmpdir(), "fav-"));
    const bytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47]);
    let fetched = "";
    const fetchFn = (async (url: string | URL | Request) => {
      fetched = String(url);
      return new Response(bytes, { status: 200 });
    }) as typeof fetch;

    const path = await emitFavicon(HEAD, "/nowhere", outDir, fetchFn);
    expect(fetched).toBe("https://cdn.example.net/a/icon-192.png");
    expect(path).toBe(join(outDir, "favicon.png"));
    expect([...readFileSync(path!)]).toEqual([...bytes]);
  });

  it("reads a file-local icon href from the export dir", async () => {
    const exportDir = mkdtempSync(join(tmpdir(), "exp-"));
    const outDir = mkdtempSync(join(tmpdir(), "fav-"));
    mkdirSync(join(exportDir, "img"), { recursive: true });
    writeFileSync(join(exportDir, "img", "icon-180.png"), "local-bytes");

    const html = `<link rel="apple-touch-icon" href="/img/icon-180.png">`;
    const path = await emitFavicon(html, exportDir, outDir);
    expect(readFileSync(path!, "utf-8")).toBe("local-bytes");
  });

  it("rejects a local href that escapes the export dir (public-artifact containment)", async () => {
    const exportDir = mkdtempSync(join(tmpdir(), "exp-"));
    const outDir = mkdtempSync(join(tmpdir(), "fav-"));
    const html = `<link rel="icon" href="/../../../etc/hosts">`;
    await expect(emitFavicon(html, exportDir, outDir)).rejects.toThrow("escapes the export dir");
  });

  it("returns null (writes nothing) when the export links no icon", async () => {
    const outDir = mkdtempSync(join(tmpdir(), "fav-"));
    expect(await emitFavicon("<html></html>", "/nowhere", outDir)).toBeNull();
  });

  it("throws on a failed fetch so the caller can warn", async () => {
    const outDir = mkdtempSync(join(tmpdir(), "fav-"));
    const fetchFn = (async () => new Response("nope", { status: 404 })) as typeof fetch;
    await expect(emitFavicon(HEAD, "/nowhere", outDir, fetchFn)).rejects.toThrow(
      "favicon fetch 404",
    );
  });
});
