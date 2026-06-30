import { describe, it, expect, afterEach } from "vitest";
import {
  checkNetlifyDeploy,
  netlifyDeployAudit,
  defaultNetlifyDeployDeps,
  type NetlifyDeployDeps,
  type NetlifyDeployFetch,
} from "../../src/audits/netlify-deploy.js";
import { hasNetlifyDeployResult } from "../../src/audits/netlify-deploy-airtable.js";

const NOW = new Date("2026-06-18T00:00:00.000Z");

function deps(over: Partial<NetlifyDeployDeps> = {}): NetlifyDeployDeps {
  return {
    fetchLatestProductionDeploy: async (): Promise<NetlifyDeployFetch> => ({
      ok: true,
      deploy: {
        state: "ready",
        deployedAt: "2026-06-17T12:00:00.000Z",
        logUrl: "https://app.netlify.com/sites/acme/deploys/abc",
        errorMessage: null,
      },
    }),
    now: NOW,
    ...over,
  };
}

const site = { path: "/tmp/acme", name: "acme", netlifyId: "site-123" };

describe("checkNetlifyDeploy", () => {
  it("returns { ok: true, deploy } when a deploy is present", async () => {
    const r = await checkNetlifyDeploy("site-123", deps());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.deploy.state).toBe("ready");
      expect(r.deploy.deployedAt).toBe("2026-06-17T12:00:00.000Z");
    }
  });

  it("propagates a genuine no-deploy read as { ok: true, deploy: all-null }", async () => {
    const r = await checkNetlifyDeploy(
      "site-123",
      deps({
        fetchLatestProductionDeploy: async () => ({
          ok: true,
          deploy: { state: null, deployedAt: null, logUrl: null, errorMessage: null },
        }),
      }),
    );
    expect(r).toEqual({
      ok: true,
      deploy: { state: null, deployedAt: null, logUrl: null, errorMessage: null },
    });
  });

  it("returns { ok: false } when the fetch reports it couldn't read", async () => {
    const r = await checkNetlifyDeploy(
      "site-123",
      deps({ fetchLatestProductionDeploy: async () => ({ ok: false }) }),
    );
    expect(r).toEqual({ ok: false });
  });

  it("treats a deps throw as { ok: false } (couldn't read — never propagates)", async () => {
    const r = await checkNetlifyDeploy(
      "site-123",
      deps({
        fetchLatestProductionDeploy: async () => {
          throw new Error("network down");
        },
      }),
    );
    expect(r).toEqual({ ok: false });
  });
});

describe("netlifyDeployAudit", () => {
  const PRIOR = process.env.NETLIFY_PAT;
  afterEach(() => {
    if (PRIOR === undefined) delete process.env.NETLIFY_PAT;
    else process.env.NETLIFY_PAT = PRIOR;
  });

  it("skips a site with no netlify id", async () => {
    process.env.NETLIFY_PAT = "tok";
    const r = await netlifyDeployAudit({ site: { path: "/tmp/acme", name: "acme" }, now: NOW });
    expect(r.status).toBe("skip");
    expect(r.summary).toBe("no netlify id");
    expect(r.details).toBeUndefined();
  });

  it("skips when no NETLIFY_PAT is set (degrades gracefully fleet-wide)", async () => {
    delete process.env.NETLIFY_PAT;
    const r = await netlifyDeployAudit({ site, now: NOW });
    expect(r.status).toBe("skip");
    expect(r.summary).toBe("no NETLIFY_PAT");
    expect(r.details).toBeUndefined();
  });

  it("passes when the latest production deploy is ready", async () => {
    process.env.NETLIFY_PAT = "tok";
    const r = await netlifyDeployAudit({ site, now: NOW, netlifyDeployDeps: deps() });
    expect(r.status).toBe("pass");
    expect(r.details).toMatchObject({
      state: "ready",
      deployedAt: "2026-06-17T12:00:00.000Z",
      logUrl: "https://app.netlify.com/sites/acme/deploys/abc",
    });
    expect((r.details as { checkedAt: string }).checkedAt).toBe(NOW.toISOString());
  });

  it("fails (needs attention) when the latest deploy errored, surfacing the message", async () => {
    process.env.NETLIFY_PAT = "tok";
    const r = await netlifyDeployAudit({
      site,
      now: NOW,
      netlifyDeployDeps: deps({
        fetchLatestProductionDeploy: async () => ({
          ok: true,
          deploy: {
            state: "error",
            deployedAt: "2026-06-17T12:00:00.000Z",
            logUrl: "https://app.netlify.com/sites/acme/deploys/abc",
            errorMessage: "Build script returned non-zero exit code: 1",
          },
        }),
      }),
    });
    expect(r.status).toBe("fail");
    expect(r.summary).toContain("error");
    expect(r.summary).toContain("Build script returned non-zero exit code");
    expect(r.details).toMatchObject({ state: "error" });
  });

  it("is neutral (warn) for an in-progress build", async () => {
    process.env.NETLIFY_PAT = "tok";
    const r = await netlifyDeployAudit({
      site,
      now: NOW,
      netlifyDeployDeps: deps({
        fetchLatestProductionDeploy: async () => ({
          ok: true,
          deploy: {
            state: "building",
            deployedAt: "2026-06-17T12:00:00.000Z",
            logUrl: null,
            errorMessage: null,
          },
        }),
      }),
    });
    expect(r.status).toBe("warn");
    expect(r.details).toMatchObject({ state: "building" });
  });

  it("is neutral (warn) with 'no deploy found' + a persistable null verdict for a site with no deploys", async () => {
    process.env.NETLIFY_PAT = "tok";
    const r = await netlifyDeployAudit({
      site,
      now: NOW,
      netlifyDeployDeps: deps({
        fetchLatestProductionDeploy: async () => ({
          ok: true,
          deploy: { state: null, deployedAt: null, logUrl: null, errorMessage: null },
        }),
      }),
    });
    expect(r.status).toBe("warn");
    expect(r.summary).toBe("no deploy found");
    expect(r.details).toMatchObject({ state: null });
    // A genuine "no deploys" read IS a real verdict — it must persist (clear the cell).
    expect(hasNetlifyDeployResult(r)).toBe(true);
  });

  it("does NOT persist a verdict when Netlify couldn't be read — leaves the prior alarm intact", async () => {
    process.env.NETLIFY_PAT = "tok";
    const r = await netlifyDeployAudit({
      site,
      now: NOW,
      netlifyDeployDeps: deps({ fetchLatestProductionDeploy: async () => ({ ok: false }) }),
    });
    expect(r.status).toBe("warn");
    expect(r.summary).toBe("deploy status unavailable (Netlify API unreachable)");
    // The crux of the fix: no details → hasNetlifyDeployResult false → the writer
    // skips, so a real `error` already on the row survives a transient read failure.
    expect(r.details).toBeUndefined();
    expect(hasNetlifyDeployResult(r)).toBe(false);
  });

  it("does NOT persist a verdict when the fetch throws (treated as couldn't-read)", async () => {
    process.env.NETLIFY_PAT = "tok";
    const r = await netlifyDeployAudit({
      site,
      now: NOW,
      netlifyDeployDeps: deps({
        fetchLatestProductionDeploy: async () => {
          throw new Error("ECONNRESET");
        },
      }),
    });
    expect(r.status).toBe("warn");
    expect(r.details).toBeUndefined();
    expect(hasNetlifyDeployResult(r)).toBe(false);
  });
});

describe("defaultNetlifyDeployDeps (real-shape, injected fetch — no network)", () => {
  it("calls the production-deploys endpoint with a bearer token and maps the first deploy", async () => {
    let calledUrl = "";
    let authHeader = "";
    const fakeFetch = (async (url: string, init?: { headers?: Record<string, string> }) => {
      calledUrl = String(url);
      authHeader = init?.headers?.Authorization ?? "";
      return {
        ok: true,
        json: async () => [
          {
            state: "Ready", // exercise the lower-casing
            published_at: "2026-06-17T12:00:00.000Z",
            created_at: "2026-06-17T11:50:00.000Z",
            deploy_ssl_url: "https://acme.netlify.app",
            admin_url: "https://app.netlify.com/sites/acme",
            error_message: null,
          },
        ],
      };
    }) as unknown as typeof fetch;

    const d = defaultNetlifyDeployDeps("secret-tok", NOW, fakeFetch);
    const r = await d.fetchLatestProductionDeploy("site-123");
    expect(calledUrl).toContain("/api/v1/sites/site-123/deploys");
    expect(calledUrl).toContain("per_page=1");
    expect(calledUrl).toContain("production=true");
    expect(authHeader).toBe("Bearer secret-tok");
    expect(r).toEqual({
      ok: true,
      deploy: {
        state: "ready",
        deployedAt: "2026-06-17T12:00:00.000Z",
        logUrl: "https://acme.netlify.app",
        errorMessage: null,
      },
    });
  });

  it("reports { ok: false } on a non-2xx response (no throw) — couldn't read", async () => {
    const fakeFetch = (async () => ({
      ok: false,
      json: async () => [],
    })) as unknown as typeof fetch;
    const d = defaultNetlifyDeployDeps("tok", NOW, fakeFetch);
    expect(await d.fetchLatestProductionDeploy("site-123")).toEqual({ ok: false });
  });

  it("reports { ok: false } when fetch rejects (network failure)", async () => {
    const fakeFetch = (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    const d = defaultNetlifyDeployDeps("tok", NOW, fakeFetch);
    expect(await d.fetchLatestProductionDeploy("site-123")).toEqual({ ok: false });
  });

  it("reports { ok: false } when the body isn't the expected array shape (malformed)", async () => {
    const fakeFetch = (async () => ({
      ok: true,
      json: async () => ({ message: "Not Found" }),
    })) as unknown as typeof fetch;
    const d = defaultNetlifyDeployDeps("tok", NOW, fakeFetch);
    expect(await d.fetchLatestProductionDeploy("site-123")).toEqual({ ok: false });
  });

  it("reports { ok: true, deploy: all-null } for an empty deploy list (read OK, genuinely none)", async () => {
    const fakeFetch = (async () => ({ ok: true, json: async () => [] })) as unknown as typeof fetch;
    const d = defaultNetlifyDeployDeps("tok", NOW, fakeFetch);
    expect(await d.fetchLatestProductionDeploy("site-123")).toEqual({
      ok: true,
      deploy: { state: null, deployedAt: null, logUrl: null, errorMessage: null },
    });
  });
});
