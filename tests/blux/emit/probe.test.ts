import { describe, it, expect } from "vitest";
import { probeAssetUrls } from "../../../src/blux/emit/probe.js";

const ok = { ok: true } as Response;
const miss = { ok: false } as Response;

describe("probeAssetUrls", () => {
  it("tries name-ext first on the image host and returns the hit", async () => {
    const tried: string[] = [];
    const fetchImpl = (async (url: string) => {
      tried.push(url);
      return url.endsWith("u1.jpg") && url.includes("d3syaxnfm3oj0e") ? ok : miss;
    }) as unknown as typeof fetch;
    const map = await probeAssetUrls([{ id: "u1", name: "Photo.jpg", mime: "image/jpeg" }], "site-1", fetchImpl);
    expect(map.get("u1")).toBe("https://d3syaxnfm3oj0e.cloudfront.net/site-1/u1.jpg");
    expect(tried[0]).toContain("/site-1/u1.jpg");
  });

  it("falls back through mime ext and common exts across both hosts, null when nothing hits", async () => {
    const fetchImpl = (async () => miss) as unknown as typeof fetch;
    const map = await probeAssetUrls([{ id: "u2", name: "x", mime: "" }], "site-1", fetchImpl);
    expect(map.get("u2")).toBeNull();
  });

  it("keeps probing past thrown network errors on individual candidates", async () => {
    const fetchImpl = (async (url: string) => {
      if (url.endsWith("u3.jpg")) throw new Error("ECONNRESET");
      return url.endsWith("u3.png") ? ok : miss;
    }) as unknown as typeof fetch;
    const map = await probeAssetUrls([{ id: "u3", name: "pic.jpg", mime: "" }], "site-1", fetchImpl);
    expect(map.get("u3")).toContain("u3.png");
  });
});
