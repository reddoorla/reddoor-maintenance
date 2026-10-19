import { describe, it, expect } from "vitest";
import { pathDepth } from "../../src/util/path-depth.js";

describe("pathDepth", () => {
  it("counts non-empty path segments", () => {
    expect(pathDepth("https://acme.test/")).toBe(0);
    expect(pathDepth("https://acme.test/services")).toBe(1);
    expect(pathDepth("https://acme.test/blog/2019/05/a-post/")).toBe(4);
  });

  it("sorts a malformed URL last instead of throwing", () => {
    expect(pathDepth("not a url")).toBe(Number.MAX_SAFE_INTEGER);
  });
});
