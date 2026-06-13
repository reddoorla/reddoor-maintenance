import { describe, it, expect } from "vitest";
import { isHttpUrl } from "../../src/util/url.js";

describe("isHttpUrl", () => {
  it("accepts http and https URLs", () => {
    expect(isHttpUrl("https://acme.example.com")).toBe(true);
    expect(isHttpUrl("http://localhost:5173/")).toBe(true);
    expect(isHttpUrl("https://example.com/path?q=1#frag")).toBe(true);
  });

  it("rejects non-http schemes (the SSRF / local-file vectors)", () => {
    expect(isHttpUrl("file:///etc/passwd")).toBe(false);
    expect(isHttpUrl("gopher://internal-host/")).toBe(false);
    expect(isHttpUrl("data:text/html,<script>")).toBe(false);
    expect(isHttpUrl("ftp://example.com/")).toBe(false);
  });

  it("rejects values that aren't a URL at all", () => {
    expect(isHttpUrl("notaurl")).toBe(false);
    expect(isHttpUrl("")).toBe(false);
    expect(isHttpUrl("   ")).toBe(false);
    expect(isHttpUrl("/relative/path")).toBe(false);
  });
});
