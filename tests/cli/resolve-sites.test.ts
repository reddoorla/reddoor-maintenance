import { describe, it, expect, vi } from "vitest";
import { sanitizeDynamicSites } from "../../src/cli/fleet/resolve-sites.js";
import type { Site } from "../../src/types.js";

describe("sanitizeDynamicSites", () => {
  it("keeps an http(s) deployedUrl untouched", () => {
    const sites: Site[] = [
      { path: "/tmp/a", name: "A", deployedUrl: "https://a.example.com" },
      { path: "/tmp/b", name: "B", deployedUrl: "http://localhost:5173" },
    ];
    expect(sanitizeDynamicSites(sites)).toEqual(sites);
  });

  it("drops a non-http(s) deployedUrl (the file:// / SSRF vector) and warns", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const out = sanitizeDynamicSites([
        { path: "/tmp/a", name: "Evil", deployedUrl: "file:///etc/passwd" },
        { path: "/tmp/b", name: "Ok", deployedUrl: "https://ok.example.com" },
      ]);
      expect(out[0]).toEqual({ path: "/tmp/a", name: "Evil" }); // deployedUrl stripped
      expect("deployedUrl" in out[0]!).toBe(false);
      expect(out[1]?.deployedUrl).toBe("https://ok.example.com");
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });

  it("leaves a site with no deployedUrl alone", () => {
    const sites: Site[] = [{ path: "/tmp/a", name: "A" }];
    expect(sanitizeDynamicSites(sites)).toEqual(sites);
  });
});
