import { describe, it, expect } from "vitest";
import { listAssetsByFilename } from "../../src/prismic/asset-api.js";

describe("asset-api: listAssetsByFilename", () => {
  it("reads a two-page library whole, carrying the encoded cursor on the second GET", async () => {
    const urls: string[] = [];
    const fetchImpl: typeof fetch = async (url) => {
      const u = String(url);
      urls.push(u);
      const page = u.includes("cursor=")
        ? { items: [{ id: "b", filename: "two.mp4", url: "https://cdn/two.mp4", size: 2 }] }
        : {
            items: [{ id: "a", filename: "one.mp4", url: "https://cdn/one.mp4", size: 1 }],
            cursor: "abc def",
          };
      return new Response(JSON.stringify(page), { status: 200 });
    };
    const map = await listAssetsByFilename("repo", "tok", fetchImpl);
    expect(urls).toEqual([
      "https://asset-api.prismic.io/assets?limit=500",
      "https://asset-api.prismic.io/assets?limit=500&cursor=abc%20def",
    ]);
    expect([...map.entries()]).toEqual([
      ["one.mp4", { id: "a", url: "https://cdn/one.mp4", size: 1 }],
      ["two.mp4", { id: "b", url: "https://cdn/two.mp4", size: 2 }],
    ]);
  });
});
