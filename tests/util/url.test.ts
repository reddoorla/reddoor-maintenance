import { describe, it, expect } from "vitest";
import { isHttpUrl, isNetlifyAppUrl } from "../../src/util/url.js";

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

describe("isNetlifyAppUrl", () => {
  it("matches a *.netlify.app host (the default no-custom-domain deploy URL)", () => {
    expect(isNetlifyAppUrl("https://vineyard-custom-homes.netlify.app")).toBe(true);
    expect(isNetlifyAppUrl("https://branch--site.netlify.app/path")).toBe(true);
    expect(isNetlifyAppUrl("https://netlify.app")).toBe(true);
  });

  it("does NOT match a real custom domain", () => {
    expect(isNetlifyAppUrl("https://acme.example.com")).toBe(false);
    expect(isNetlifyAppUrl("https://lahomelessnessawareness.org/")).toBe(false);
  });

  it("is not fooled by a netlify.app substring in a different domain", () => {
    expect(isNetlifyAppUrl("https://foo.netlify.app.evil.com")).toBe(false);
    expect(isNetlifyAppUrl("https://netlify.app.evil.com")).toBe(false);
  });

  it("returns false for a missing or unparseable URL", () => {
    expect(isNetlifyAppUrl("")).toBe(false);
    expect(isNetlifyAppUrl("   ")).toBe(false);
    expect(isNetlifyAppUrl("notaurl")).toBe(false);
  });
});
