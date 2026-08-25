import { describe, it, expect } from "vitest";
import { escapeHtml, safeUrl } from "../../src/util/html.js";

describe("escapeHtml", () => {
  it("escapes the strict-XML set: & < > \" '", () => {
    expect(escapeHtml(`& < > " '`)).toBe("&amp; &lt; &gt; &quot; &#39;");
  });

  it("leaves ordinary text untouched", () => {
    expect(escapeHtml("Brown & Co — roofing, repair, and inspection")).toBe(
      "Brown &amp; Co — roofing, repair, and inspection",
    );
  });

  it("neutralizes a script-tag injection payload", () => {
    const evil = '<script>alert("x")</script>';
    const escaped = escapeHtml(evil);
    expect(escaped).not.toContain("<script>");
    expect(escaped).toBe("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
  });
});

describe("safeUrl", () => {
  it("passes through a well-formed https URL as its parsed href", () => {
    expect(safeUrl("https://acme.example/path?q=1")).toBe("https://acme.example/path?q=1");
  });

  it("passes through a well-formed http URL", () => {
    expect(safeUrl("http://localhost:5173/")).toBe("http://localhost:5173/");
  });

  it("collapses a non-http(s) scheme to '#' (javascript:, data:, file:)", () => {
    expect(safeUrl("javascript:alert(1)")).toBe("#");
    expect(safeUrl("data:text/html,<script>alert(1)</script>")).toBe("#");
    expect(safeUrl("file:///etc/passwd")).toBe("#");
  });

  it("collapses a value that isn't a URL at all to '#'", () => {
    expect(safeUrl("notaurl")).toBe("#");
    expect(safeUrl("")).toBe("#");
    expect(safeUrl("/relative/path")).toBe("#");
  });

  it("normalizes a bare origin to carry a trailing slash", () => {
    // new URL(...).href always resolves an empty path to "/" — a caller
    // pinning the exact string must expect this, not the origin verbatim.
    expect(safeUrl("https://acme.example")).toBe("https://acme.example/");
  });

  // The bug this test guards: safeUrl used to validate the scheme with
  // `new URL(raw)` and then return the caller's ORIGINAL `raw` string. That
  // parse is lenient — a well-formed https URL carrying a quote-breakout
  // payload passes the scheme check fine — so the raw, unencoded payload
  // came back out verbatim. A caller that interpolates safeUrl's result
  // into `<a href="${...}">` without an additional escapeHtml pass got a
  // live, executable injection. Returning the parsed `u.href` instead means
  // the URL parser itself percent-encodes `"`, `<`, `>` in the path/query,
  // so the breakout can never reach the href attribute literally.
  it("returns the PARSED href, not the raw string — a quote-breakout payload comes back percent-encoded", () => {
    const evil = 'https://acme.example/"><script>alert(1)</script>';
    const safe = safeUrl(evil);
    expect(safe).not.toBe(evil);
    expect(safe).not.toContain('"');
    expect(safe).not.toContain("<");
    expect(safe).not.toContain(">");
    expect(safe).toBe("https://acme.example/%22%3E%3Cscript%3Ealert(1)%3C/script%3E");
    // Proves the fix end-to-end in an actual attribute-interpolation context,
    // the way every real call site uses it.
    const rendered = `<a href="${safe}">link</a>`;
    expect(rendered).not.toContain("<script>");
  });

  it("percent-encodes a quote-breakout in the query string the same way", () => {
    const evil = 'https://acme.example/?q="><img src=x onerror=alert(1)>';
    const safe = safeUrl(evil);
    expect(safe).not.toContain('"');
    expect(safe).not.toContain("<img");
  });
});
