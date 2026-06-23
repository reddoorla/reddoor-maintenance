import { describe, it, expect } from "vitest";
import { isHttpUrl, isNetlifyAppUrl, isPublicHttpsUrl } from "../../src/util/url.js";

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

describe("isPublicHttpsUrl", () => {
  it("accepts a public https URL (the legitimate webhook target)", () => {
    expect(isPublicHttpsUrl("https://hooks.zapier.com/hooks/catch/123/abc")).toBe(true);
    expect(isPublicHttpsUrl("https://api.mailchimp.com/3.0/")).toBe(true);
    expect(isPublicHttpsUrl("https://8.8.8.8/path")).toBe(true); // public IP literal
  });

  it("rejects non-https schemes", () => {
    expect(isPublicHttpsUrl("http://hooks.zapier.com/x")).toBe(false);
    expect(isPublicHttpsUrl("file:///etc/passwd")).toBe(false);
    expect(isPublicHttpsUrl("ftp://example.com/")).toBe(false);
  });

  it("rejects loopback / localhost", () => {
    expect(isPublicHttpsUrl("https://localhost/x")).toBe(false);
    expect(isPublicHttpsUrl("https://api.localhost/x")).toBe(false);
    expect(isPublicHttpsUrl("https://127.0.0.1/x")).toBe(false);
    expect(isPublicHttpsUrl("https://127.255.0.1/x")).toBe(false);
    expect(isPublicHttpsUrl("https://[::1]/x")).toBe(false);
  });

  it("rejects private IPv4 ranges (the SSRF targets)", () => {
    expect(isPublicHttpsUrl("https://10.0.0.5/x")).toBe(false);
    expect(isPublicHttpsUrl("https://172.16.0.1/x")).toBe(false);
    expect(isPublicHttpsUrl("https://172.31.255.255/x")).toBe(false);
    expect(isPublicHttpsUrl("https://192.168.1.1/x")).toBe(false);
    expect(isPublicHttpsUrl("https://169.254.169.254/latest/meta-data")).toBe(false); // cloud metadata
    expect(isPublicHttpsUrl("https://100.64.0.1/x")).toBe(false); // CGNAT
    expect(isPublicHttpsUrl("https://0.0.0.0/x")).toBe(false);
  });

  it("does NOT over-block a public IPv4 that merely starts with a private-looking octet", () => {
    expect(isPublicHttpsUrl("https://172.15.0.1/x")).toBe(true); // just below 172.16/12
    expect(isPublicHttpsUrl("https://172.32.0.1/x")).toBe(true); // just above
    expect(isPublicHttpsUrl("https://192.169.0.1/x")).toBe(true);
    expect(isPublicHttpsUrl("https://100.63.0.1/x")).toBe(true); // just below CGNAT
  });

  it("rejects IPv6 link-local / unique-local literals", () => {
    expect(isPublicHttpsUrl("https://[fe80::1]/x")).toBe(false);
    expect(isPublicHttpsUrl("https://[fd00::1]/x")).toBe(false);
    expect(isPublicHttpsUrl("https://[fc00::1]/x")).toBe(false);
  });

  it("rejects IPv4-mapped IPv6 + NAT64 that embed an internal v4 (the dotted-quad block can't see them)", () => {
    expect(isPublicHttpsUrl("https://[::ffff:169.254.169.254]/x")).toBe(false); // cloud metadata
    expect(isPublicHttpsUrl("https://[::ffff:10.0.0.1]/x")).toBe(false); // RFC1918
    expect(isPublicHttpsUrl("https://[::ffff:127.0.0.1]/x")).toBe(false); // loopback
    expect(isPublicHttpsUrl("https://[64:ff9b::a00:1]/x")).toBe(false); // NAT64 → 10.0.0.1
  });

  it("returns false for empty / unparseable input", () => {
    expect(isPublicHttpsUrl("")).toBe(false);
    expect(isPublicHttpsUrl("   ")).toBe(false);
    expect(isPublicHttpsUrl("notaurl")).toBe(false);
  });
});
