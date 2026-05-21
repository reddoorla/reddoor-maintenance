import { describe, it, expect } from "vitest";
import { localPath } from "../../src/inventory/local.js";

describe("inventory/localPath", () => {
  it("returns a Site[] of length 1 with the given path", async () => {
    const provider = localPath("/abs/path");
    const sites = await provider();
    expect(sites).toHaveLength(1);
    expect(sites[0]?.path).toBe("/abs/path");
  });

  it("infers name from the basename", async () => {
    const provider = localPath("/abs/foo/bar");
    const [site] = await provider();
    expect(site?.name).toBe("bar");
  });

  it("respects an explicit name override", async () => {
    const provider = localPath("/abs/foo/bar", { name: "explicit" });
    const [site] = await provider();
    expect(site?.name).toBe("explicit");
  });
});
