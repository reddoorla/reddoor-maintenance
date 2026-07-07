import { describe, it, expect } from "vitest";
import {
  parseHealthBody,
  functionHealthAudit,
  defaultFunctionHealthDeps,
  type FunctionHealthDeps,
  type HealthFetch,
} from "../../src/audits/function-health.js";

const NOW = new Date("2026-07-06T00:00:00.000Z");

function deps(over: Partial<FunctionHealthDeps> = {}): FunctionHealthDeps {
  return {
    fetchHealth: async (): Promise<HealthFetch> => ({
      present: true,
      body: {
        ok: true,
        prismic: "ok",
        forms: { ingestUrl: true, ingestToken: true, turnstile: false },
      },
    }),
    now: NOW,
    ...over,
  };
}

const site = { path: "/tmp/acme", name: "acme", deployedUrl: "https://acme.example.com" };

describe("parseHealthBody", () => {
  it("accepts a well-formed body", () => {
    expect(
      parseHealthBody({
        ok: true,
        prismic: "ok",
        forms: { ingestUrl: true, ingestToken: false, turnstile: true },
      }),
    ).toEqual({
      present: true,
      body: {
        ok: true,
        prismic: "ok",
        forms: { ingestUrl: true, ingestToken: false, turnstile: true },
      },
    });
  });

  it("coerces an unknown prismic value and a missing forms object to null", () => {
    expect(parseHealthBody({ ok: false, prismic: "weird" })).toEqual({
      present: true,
      body: { ok: false, prismic: null, forms: null },
    });
  });

  it("rejects a non-object / missing-ok body as not-present", () => {
    expect(parseHealthBody(null)).toEqual({ present: false });
    expect(parseHealthBody("nope")).toEqual({ present: false });
    expect(parseHealthBody({ prismic: "ok" })).toEqual({ present: false });
    expect(parseHealthBody({ ok: "yes" })).toEqual({ present: false });
  });
});

describe("functionHealthAudit", () => {
  it("skips a site with no deployed URL (no details)", async () => {
    const r = await functionHealthAudit({ site: { path: "/tmp/acme", name: "acme" }, now: NOW });
    expect(r.status).toBe("skip");
    expect(r.summary).toBe("no deployed URL");
    expect(r.details).toBeUndefined();
  });

  it("passes + records details when /health is ok:true", async () => {
    const r = await functionHealthAudit({ site, now: NOW, functionHealthDeps: deps() });
    expect(r.status).toBe("pass");
    expect(r.details).toMatchObject({ ok: true, prismic: "ok" });
    expect((r.details as { checkedAt: string }).checkedAt).toBe(NOW.toISOString());
  });

  it("fails (records details) when /health answers ok:false", async () => {
    const r = await functionHealthAudit({
      site,
      now: NOW,
      functionHealthDeps: deps({
        fetchHealth: async () => ({
          present: true,
          body: { ok: false, prismic: "error", forms: null },
        }),
      }),
    });
    expect(r.status).toBe("fail");
    expect(r.details).toMatchObject({ ok: false, prismic: "error" });
  });

  it("self-skips with NO details when there is no usable report (preserve prior)", async () => {
    const r = await functionHealthAudit({
      site,
      now: NOW,
      functionHealthDeps: deps({ fetchHealth: async () => ({ present: false }) }),
    });
    expect(r.status).toBe("skip");
    expect(r.summary).toBe("health endpoint unreachable / not JSON");
    expect(r.details).toBeUndefined();
  });

  it("treats a deps throw as a self-skip (never propagates past the audit)", async () => {
    const r = await functionHealthAudit({
      site,
      now: NOW,
      functionHealthDeps: deps({
        fetchHealth: async () => {
          throw new Error("boom");
        },
      }),
    });
    expect(r.status).toBe("skip");
    expect(r.details).toBeUndefined();
  });
});

describe("defaultFunctionHealthDeps (real-shape, injected fetch — no network)", () => {
  it("GETs {deployedUrl}/health with a timeout signal and parses the body", async () => {
    let calledUrl = "";
    let hadSignal = false;
    const fakeFetch = (async (url: string, init?: { signal?: AbortSignal }) => {
      calledUrl = String(url);
      hadSignal = init?.signal instanceof AbortSignal;
      return { ok: true, status: 200, json: async () => ({ ok: true, prismic: "ok", forms: null }) };
    }) as unknown as typeof fetch;
    const d = defaultFunctionHealthDeps(NOW, fakeFetch);
    const r = await d.fetchHealth("https://acme.example.com");
    expect(calledUrl).toBe("https://acme.example.com/health");
    expect(hadSignal).toBe(true);
    expect(r).toEqual({ present: true, body: { ok: true, prismic: "ok", forms: null } });
  });

  // R2.1: 404 means "not adopted yet" — skip (amber), not fail.
  it("returns {present:false} on a 404 (not yet adopted)", async () => {
    const fakeFetch = (async () => ({
      ok: false,
      status: 404,
      json: async () => ({}),
    })) as unknown as typeof fetch;
    expect(await defaultFunctionHealthDeps(NOW, fakeFetch).fetchHealth("https://a.com")).toEqual({
      present: false,
    });
  });

  // R2.1: any OTHER non-2xx (5xx, 403, …) means "deployed but erroring" — fail (red).
  it("returns a fail body on a 500 (deployed but erroring)", async () => {
    const fakeFetch = (async () => ({
      ok: false,
      status: 500,
      json: async () => ({}),
    })) as unknown as typeof fetch;
    expect(await defaultFunctionHealthDeps(NOW, fakeFetch).fetchHealth("https://a.com")).toEqual({
      present: true,
      body: { ok: false, prismic: null, forms: null },
    });
  });

  it("returns {present:false} when fetch rejects (network error / timeout)", async () => {
    const fakeFetch = (async () => {
      throw new Error("ETIMEDOUT");
    }) as unknown as typeof fetch;
    expect(await defaultFunctionHealthDeps(NOW, fakeFetch).fetchHealth("https://a.com")).toEqual({
      present: false,
    });
  });

  // R2.1: a 200 non-JSON body means "deployed but erroring" — fail (red), not skip.
  it("returns a fail body on a 200 non-JSON response (deployed but erroring)", async () => {
    const fakeFetch = (async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error("not json");
      },
    })) as unknown as typeof fetch;
    expect(await defaultFunctionHealthDeps(NOW, fakeFetch).fetchHealth("https://a.com")).toEqual({
      present: true,
      body: { ok: false, prismic: null, forms: null },
    });
  });
});
