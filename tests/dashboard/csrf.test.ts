import { describe, it, expect } from "vitest";
import { isCsrfAllowed, requestHost, originHost } from "../../src/dashboard/csrf.js";

/** Build a minimal CsrfRequestLike from a header bag + url. */
function req(headers: Record<string, string> = {}, url = "https://dash.reddoor.test/x") {
  const lower: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = v;
  return { headers: { get: (n: string) => lower[n.toLowerCase()] ?? null }, url };
}

describe("originHost", () => {
  it("returns the lowercased host of an absolute URL", () => {
    expect(originHost("https://Dash.Reddoor.TEST/s/acme")).toBe("dash.reddoor.test");
  });
  it("returns null for a missing or unparseable value", () => {
    expect(originHost(null)).toBeNull();
    expect(originHost("not a url")).toBeNull();
  });
});

describe("requestHost", () => {
  it("prefers the Host header (lowercased)", () => {
    expect(requestHost(req({ host: "Real.Host" }, "https://parsed.host/x"))).toBe("real.host");
  });
  it("falls back to the host parsed from req.url when no Host header", () => {
    expect(requestHost(req({}, "https://Parsed.Host/x"))).toBe("parsed.host");
  });
  it("returns null when neither a Host header nor a parseable url is present", () => {
    expect(requestHost(req({}, "garbage"))).toBeNull();
  });
});

describe("isCsrfAllowed", () => {
  it("allows when Sec-Fetch-Site is same-origin", () => {
    expect(isCsrfAllowed(req({ "sec-fetch-site": "same-origin" }))).toBe(true);
  });
  it("allows when Sec-Fetch-Site is none (address-bar load)", () => {
    expect(isCsrfAllowed(req({ "sec-fetch-site": "none" }))).toBe(true);
  });
  it("rejects when Sec-Fetch-Site is cross-site", () => {
    expect(isCsrfAllowed(req({ "sec-fetch-site": "cross-site" }))).toBe(false);
  });
  it("rejects when Sec-Fetch-Site is same-site (a sibling subdomain is not same-origin)", () => {
    expect(isCsrfAllowed(req({ "sec-fetch-site": "same-site" }))).toBe(false);
  });

  it("falls back to Origin host comparison when Sec-Fetch-Site is absent", () => {
    expect(
      isCsrfAllowed(req({ origin: "https://dash.reddoor.test", host: "dash.reddoor.test" })),
    ).toBe(true);
    expect(isCsrfAllowed(req({ origin: "https://evil.example", host: "dash.reddoor.test" }))).toBe(
      false,
    );
  });

  it("falls back to Referer host when Origin is absent", () => {
    expect(
      isCsrfAllowed(
        req({ referer: "https://dash.reddoor.test/s/acme", host: "dash.reddoor.test" }),
      ),
    ).toBe(true);
    expect(
      isCsrfAllowed(req({ referer: "https://evil.example/x", host: "dash.reddoor.test" })),
    ).toBe(false);
  });

  it("allows a request with no cross-site signal at all (legacy/non-browser client)", () => {
    expect(isCsrfAllowed(req({ host: "dash.reddoor.test" }))).toBe(true);
  });

  it("rejects an Origin-present request when the request's own host can't be determined", () => {
    // Origin present but no Host header and an unparseable url → ownHost null → reject.
    expect(isCsrfAllowed(req({ origin: "https://dash.reddoor.test" }, "garbage"))).toBe(false);
  });
});
