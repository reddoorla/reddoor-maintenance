import { describe, it, expect, vi } from "vitest";
import {
  resolveDashboardBaseUrl,
  resolveSlug,
  handlerError,
} from "../../src/dashboard/handler-helpers.js";

describe("resolveDashboardBaseUrl", () => {
  it("falls back to the canonical Netlify URL when unset", () => {
    expect(resolveDashboardBaseUrl(undefined)).toBe("https://reddoor-maintenance.netlify.app");
  });
  it("falls back when the value is blank/whitespace", () => {
    expect(resolveDashboardBaseUrl("   ")).toBe("https://reddoor-maintenance.netlify.app");
  });
  it("trims and strips a single trailing slash from a custom value", () => {
    expect(resolveDashboardBaseUrl("  https://ops.reddoor.test/  ")).toBe(
      "https://ops.reddoor.test",
    );
  });
  it("leaves a no-trailing-slash value unchanged", () => {
    expect(resolveDashboardBaseUrl("https://ops.reddoor.test")).toBe("https://ops.reddoor.test");
  });
});

describe("resolveSlug", () => {
  it("prefers the path param", () => {
    expect(resolveSlug("acme", "ignored")).toBe("acme");
  });
  it("falls back to the query slug when no path param", () => {
    expect(resolveSlug(undefined, "acme")).toBe("acme");
  });
  it("returns null when neither is present (→ health check)", () => {
    expect(resolveSlug(undefined, null)).toBeNull();
  });
});

describe("handlerError", () => {
  it("returns a generic 502 that does NOT leak the error message/stack", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const secret = "Airtable 500: token=SECRET_xyz at /internal/path";
    const res = handlerError("site-dashboard", new Error(secret));
    const body = await res.text();

    expect(res.status).toBe(502);
    expect(res.headers.get("content-type")).toMatch(/text\/plain/);
    expect(body).not.toContain(secret); // no detail leaked to the client
    expect(body).not.toMatch(/SECRET_xyz|Airtable|stack/i);
    expect(body).toMatch(/temporarily unavailable/i);
    // but the real detail IS logged server-side for the operator
    expect(spy).toHaveBeenCalledOnce();
    expect(spy.mock.calls[0]![0]).toContain(secret);
    expect(spy.mock.calls[0]![0]).toContain("site-dashboard");
    spy.mockRestore();
  });

  it("handles a non-Error throw without crashing", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = handlerError("approve-report", "string failure");
    expect(res.status).toBe(502);
    expect(await res.text()).toMatch(/temporarily unavailable/i);
    spy.mockRestore();
  });
});
