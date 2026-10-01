import { describe, it, expect } from "vitest";
import {
  NETLIFY_SITE_NOT_FOUND,
  PROBE_TIMEOUT_MS,
  isTransportFailure,
  probeRosterUrl,
  type UrlFetch,
} from "../../src/fleet/roster-url-probe.js";

const SITE_NOT_FOUND_BODY =
  "Not Found - Request ID: 01K6A0000000000000000000ZZ\n\nBuild and deploy your own site for free: https://netlify.new/?utm_campaign=loops&utm_content=site-not-found-text&utm_source=netlify";

function respond(status: number, body: string, headers: Record<string, string> = {}): UrlFetch {
  return async () => new Response(body, { status, headers });
}

describe("probeRosterUrl classification", () => {
  it("a final 2xx passes with the code", async () => {
    expect(await probeRosterUrl("https://ok.example.com/", respond(200, "<html>"))).toEqual({
      resolves: "pass",
      status: "200",
    });
    expect(
      await probeRosterUrl(
        "https://ok.example.com/",
        async () => new Response(null, { status: 204 }),
      ),
    ).toEqual({
      resolves: "pass",
      status: "204",
    });
  });

  it("Netlify's site-not-found page is its own status (the-pointe-burbank)", async () => {
    const f = respond(404, SITE_NOT_FOUND_BODY, {
      server: "Netlify",
      "content-type": "text/plain",
    });
    expect(await probeRosterUrl("https://the-pointe-burbank.netlify.app", f)).toEqual({
      resolves: "fail",
      status: "404 netlify-site-not-found",
    });
  });

  it("the server header matches case-insensitively", async () => {
    const f = respond(404, SITE_NOT_FOUND_BODY, { server: "NETLIFY" });
    expect((await probeRosterUrl("https://x.netlify.app", f)).status).toBe(
      "404 netlify-site-not-found",
    );
  });

  it("a deployed site's own 404 on Netlify is a plain 404, not site-not-found", async () => {
    const f = respond(404, "<!doctype html><html><body>Page not found</body></html>", {
      server: "Netlify",
      "content-type": "text/html",
    });
    expect(await probeRosterUrl("https://the-tower-burbank-rd.netlify.app/", f)).toEqual({
      resolves: "fail",
      status: "404",
    });
  });

  it("the site-not-found body behind a non-Netlify server is a plain 404", async () => {
    const f = respond(404, SITE_NOT_FOUND_BODY, { server: "nginx" });
    expect(await probeRosterUrl("https://x.example.com", f)).toEqual({
      resolves: "fail",
      status: "404",
    });
  });

  it("any other status fails with its code, including 401/403 and 3xx that were not followed", async () => {
    for (const code of [301, 401, 403, 500, 503]) {
      expect(await probeRosterUrl("https://x.example.com", respond(code, ""))).toEqual({
        resolves: "fail",
        status: String(code),
      });
    }
  });

  it("a network error fails with its cause code", async () => {
    const f: UrlFetch = async () => {
      throw Object.assign(new TypeError("fetch failed"), {
        cause: Object.assign(new Error("getaddrinfo ENOTFOUND x"), { code: "ENOTFOUND" }),
      });
    };
    expect(await probeRosterUrl("https://x.example.com", f)).toEqual({
      resolves: "fail",
      status: "error: ENOTFOUND",
    });
  });

  it("a timeout fails with the error name", async () => {
    const f: UrlFetch = async () => {
      throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
    };
    expect(await probeRosterUrl("https://x.example.com", f)).toEqual({
      resolves: "fail",
      status: "error: TimeoutError",
    });
  });

  it("a non-http(s) url fails without a request", async () => {
    let calls = 0;
    const f: UrlFetch = async () => {
      calls++;
      return new Response("", { status: 200 });
    };
    for (const url of ["ftp://x.example.com", "the-pointe-burbank.netlify.app", "javascript:1"]) {
      expect(await probeRosterUrl(url, f)).toEqual({
        resolves: "fail",
        status: "not an http(s) url",
      });
    }
    expect(calls).toBe(0);
  });

  it("a blank url is no verdict, not a failure, and makes no request", async () => {
    let calls = 0;
    const f: UrlFetch = async () => {
      calls++;
      return new Response("", { status: 200 });
    };
    expect(await probeRosterUrl("", f)).toEqual({ resolves: null, status: "no url" });
    expect(await probeRosterUrl("   ", f)).toEqual({ resolves: null, status: "no url" });
    expect(calls).toBe(0);
  });

  it("asks for one GET that follows redirects under a timeout signal", async () => {
    const seen: { url: string; init: RequestInit | undefined }[] = [];
    const f: UrlFetch = async (url, init) => {
      seen.push({ url, init });
      return new Response("", { status: 200 });
    };
    await probeRosterUrl("  https://x.example.com/  ", f);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.url).toBe("https://x.example.com/");
    expect(seen[0]!.init?.method ?? "GET").toBe("GET");
    expect(seen[0]!.init?.redirect).toBe("follow");
    expect(seen[0]!.init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("2xx means exactly 200-299", async () => {
    expect(await probeRosterUrl("https://x.example.com", respond(299, ""))).toEqual({
      resolves: "pass",
      status: "299",
    });
    expect(await probeRosterUrl("https://x.example.com", respond(300, ""))).toEqual({
      resolves: "fail",
      status: "300",
    });
  });

  it("a Netlify 404 page that says Not Found but not site-not-found is a plain 404", async () => {
    const f = respond(404, "<html><title>404 Not Found</title>Not Found</html>", {
      server: "Netlify",
    });
    expect((await probeRosterUrl("https://x.netlify.app", f)).status).toBe("404");
  });

  it("the server header must be Netlify itself, not a name containing it", async () => {
    const f = respond(404, SITE_NOT_FOUND_BODY, { server: "netlify-edge" });
    expect((await probeRosterUrl("https://x.example.com", f)).status).toBe("404");
  });

  it("prefers the cause's code, and falls back to 'unknown' for a nameless throw", async () => {
    const both: UrlFetch = async () => {
      throw Object.assign(new TypeError("fetch failed"), {
        code: "OUTER",
        cause: { code: "ECONNRESET" },
      });
    };
    expect((await probeRosterUrl("https://x.example.com", both)).status).toBe("error: ECONNRESET");
    const bare: UrlFetch = async () => {
      throw {};
    };
    expect((await probeRosterUrl("https://x.example.com", bare)).status).toBe("error: unknown");
  });

  it("gives up after its timeout (15 s by default)", async () => {
    expect(PROBE_TIMEOUT_MS).toBe(15_000);
    const hang: UrlFetch = (_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal!.reason));
      });
    expect(await probeRosterUrl("https://x.example.com", hang, 20)).toEqual({
      resolves: "fail",
      status: "error: TimeoutError",
    });
  });
});

describe("isTransportFailure (#1103)", () => {
  it("is true only for a fail with no HTTP answer behind it", () => {
    expect(isTransportFailure({ resolves: "fail", status: "error: TimeoutError" })).toBe(true);
    expect(isTransportFailure({ resolves: "fail", status: "error: ENOTFOUND" })).toBe(true);
    for (const status of ["404", "503", NETLIFY_SITE_NOT_FOUND, "not an http(s) url"]) {
      expect(isTransportFailure({ resolves: "fail", status })).toBe(false);
    }
    expect(isTransportFailure({ resolves: "fail", status: "error-page" })).toBe(false);
    expect(isTransportFailure({ resolves: "fail", status: "502 error: upstream" })).toBe(false);
    expect(isTransportFailure({ resolves: "pass", status: "error: odd" })).toBe(false);
    expect(isTransportFailure({ resolves: "pass", status: "200" })).toBe(false);
    expect(isTransportFailure({ resolves: null, status: "no url" })).toBe(false);
  });

  it("classifies what probeRosterUrl actually returns for a thrown timeout", async () => {
    const p = await probeRosterUrl("https://slow.example.com/", async () => {
      throw Object.assign(new Error("aborted"), { name: "TimeoutError" });
    });
    expect(p).toEqual({ resolves: "fail", status: "error: TimeoutError" });
    expect(isTransportFailure(p)).toBe(true);
  });
});
