import { describe, it, expect, vi } from "vitest";
import type { Context } from "@netlify/functions";

// The database is mocked purely to PROVE it is never opened. This route used to
// read a row and render it; now it is a redirect and should touch nothing.
const openDb = vi.fn();
vi.mock("../../src/db/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/db/client.js")>();
  return { ...actual, openDb };
});

import prospectReport, { config } from "../../netlify/functions/prospect-report.mjs";

const ctx = (token?: string): Context => ({ params: token ? { token } : {} }) as unknown as Context;
const req = (method = "GET"): Request => new Request("https://dash.reddoor.test/r/abc", { method });

const TOKEN = "aB3-_xY9zQ1rS2tU4vW6xY";

/**
 * The report moved to reddoorla.com/audit/{token}. This route stays as a
 * permanent redirect and is deliberately NOT deleted: links already sent are
 * sitting in prospects' inboxes and will be opened months from now.
 */
describe("prospect-report — the redirect to the website", () => {
  it("301s a valid token to the report's new home", async () => {
    const res = await prospectReport(req(), ctx(TOKEN));
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe(`https://reddoorla.com/audit/${TOKEN}`);
  });

  it("carries the same token, so the link lands on the same document", async () => {
    const res = await prospectReport(req(), ctx(TOKEN));
    expect(res.headers.get("location")).toContain(TOKEN);
  });

  // Cheap by construction: a redirect that queried the database would spend a
  // round trip to learn something the destination checks anyway.
  it("never opens the database", async () => {
    openDb.mockClear();
    await prospectReport(req(), ctx(TOKEN));
    expect(openDb).not.toHaveBeenCalled();
  });

  // A dead token now redirects and the WEBSITE 404s it, rather than being
  // resolved here. That is deliberate: the destination is the source of truth
  // for whether a report exists, and duplicating that check would let the two
  // disagree.
  it("does not try to decide whether the report still exists", async () => {
    // Well-formed (exactly 22 base64url chars, per isValidToken) but certainly
    // not in the database.
    const res = await prospectReport(req(), ctx("aaaaaaaaaaaaaaaaaaaaaa"));
    expect(res.status).toBe(301);
  });

  it("stays out of search results", async () => {
    const res = await prospectReport(req(), ctx(TOKEN));
    expect(res.headers.get("x-robots-tag")).toContain("noindex");
    expect(res.headers.get("cache-control")).toContain("no-store");
  });
});

describe("prospect-report — refusals", () => {
  // The one that matters most here. Without the shape check this route would
  // bounce an arbitrary path segment onto reddoorla.com: an open redirect
  // wearing our own domain.
  it("refuses to redirect anything that is not a token", async () => {
    for (const bad of ["../../etc/passwd", "//evil.example", "short", "has space", ""]) {
      const res = await prospectReport(req(), ctx(bad));
      expect(res.status).toBe(404);
      expect(res.headers.get("location")).toBeNull();
    }
  });

  it("404s a missing token", async () => {
    const res = await prospectReport(req(), ctx());
    expect(res.status).toBe(404);
  });

  it("rejects a non-GET", async () => {
    const res = await prospectReport(req("POST"), ctx(TOKEN));
    expect(res.status).toBe(405);
  });

  // Unchanged and still load-bearing: a prospect opens this from a cold email,
  // so there is no operator to authenticate. The token is the credential.
  it("never asks for basic auth", async () => {
    const res = await prospectReport(req(), ctx(TOKEN));
    expect(res.headers.get("www-authenticate")).toBeNull();
  });
});

describe("prospect-report — routing", () => {
  it("still claims /r/:token, so old links keep resolving", () => {
    expect(config.path).toContain("/r/:token");
  });
});
