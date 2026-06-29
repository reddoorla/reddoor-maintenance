import { describe, it, expect } from "vitest";
import { makeGitHubRest } from "../../src/github/gh-rest.js";

type Call = {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | null;
  signal: AbortSignal | null;
};

/**
 * A fake `fetch` that records every call and returns a scripted Response.
 * The dashboard's request-path Renovate trigger runs in the Netlify (Lambda)
 * runtime, where the `gh` CLI does not exist — so this client must hit the
 * GitHub REST API directly. These tests pin that wire behavior.
 *
 * Each scripted response may carry `headers` (e.g. a `link` header for cursor
 * pagination); the returned Response exposes them via `headers.get(name)`.
 */
function fakeFetch(
  responses: Array<{
    status: number;
    body?: unknown;
    throwsJson?: boolean;
    headers?: Record<string, string>;
  }>,
) {
  const calls: Call[] = [];
  let i = 0;
  const fn = (async (url: string, init?: RequestInit) => {
    const h: Record<string, string> = {};
    const raw = (init?.headers ?? {}) as Record<string, string>;
    for (const [k, v] of Object.entries(raw)) h[k.toLowerCase()] = v;
    calls.push({
      url: String(url),
      method: init?.method ?? "GET",
      headers: h,
      body: (init?.body as string | undefined) ?? null,
      signal: (init?.signal as AbortSignal | undefined) ?? null,
    });
    const r = responses[i++] ?? { status: 200, body: {} };
    const respHeaders: Record<string, string> = {};
    for (const [k, v] of Object.entries(r.headers ?? {})) respHeaders[k.toLowerCase()] = v;
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      headers: { get: (k: string) => respHeaders[k.toLowerCase()] ?? null },
      // Mirror a real Response: an HTML/garbage 200 body makes .json() throw a SyntaxError.
      json: async () => {
        if (r.throwsJson) throw new SyntaxError("Unexpected token < in JSON");
        return r.body;
      },
      text: async () => (typeof r.body === "string" ? r.body : JSON.stringify(r.body ?? "")),
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return { fn, calls };
}

describe("makeGitHubRest.defaultBranch", () => {
  it("GETs the repo and returns default_branch", async () => {
    const { fn, calls } = fakeFetch([{ status: 200, body: { default_branch: "main" } }]);
    const gh = makeGitHubRest({ token: "tok", fetch: fn });
    expect(await gh.defaultBranch("reddoorla/acme")).toBe("main");
    expect(calls[0]!.url).toBe("https://api.github.com/repos/reddoorla/acme");
    expect(calls[0]!.method).toBe("GET");
    expect(calls[0]!.headers["authorization"]).toBe("Bearer tok");
    expect(calls[0]!.headers["accept"]).toBe("application/vnd.github+json");
    expect(calls[0]!.headers["x-github-api-version"]).toBe("2022-11-28");
    expect(calls[0]!.headers["user-agent"]).toBeTruthy();
  });

  it("throws (with status) when the GET is non-2xx", async () => {
    const { fn } = fakeFetch([{ status: 404, body: { message: "Not Found" } }]);
    const gh = makeGitHubRest({ token: "tok", fetch: fn });
    await expect(gh.defaultBranch("reddoorla/ghost")).rejects.toThrow(/404/);
  });

  it("rejects a non owner/repo shape", async () => {
    const { fn } = fakeFetch([]);
    const gh = makeGitHubRest({ token: "tok", fetch: fn });
    await expect(gh.defaultBranch("not-a-repo")).rejects.toThrow(/owner\/repo/);
  });

  it("throws a clear error on a 200 whose body has no default_branch", async () => {
    const { fn } = fakeFetch([{ status: 200, body: {} }]);
    const gh = makeGitHubRest({ token: "tok", fetch: fn });
    await expect(gh.defaultBranch("reddoorla/acme")).rejects.toThrow(/default_branch/);
  });

  it("throws a clear error (not a raw SyntaxError) when a 200 body is not JSON", async () => {
    const { fn } = fakeFetch([{ status: 200, throwsJson: true }]);
    const gh = makeGitHubRest({ token: "tok", fetch: fn });
    await expect(gh.defaultBranch("reddoorla/acme")).rejects.toThrow(/reddoorla\/acme/);
  });
});

describe("makeGitHubRest.dispatchWorkflow", () => {
  it("POSTs the workflow_dispatch with the ref in the JSON body", async () => {
    const { fn, calls } = fakeFetch([{ status: 204 }]);
    const gh = makeGitHubRest({ token: "tok", fetch: fn });
    await gh.dispatchWorkflow("reddoorla/acme", "renovate.yml", "main");
    expect(calls[0]!.url).toBe(
      "https://api.github.com/repos/reddoorla/acme/actions/workflows/renovate.yml/dispatches",
    );
    expect(calls[0]!.method).toBe("POST");
    expect(calls[0]!.headers["authorization"]).toBe("Bearer tok");
    expect(JSON.parse(calls[0]!.body!)).toEqual({ ref: "main" });
  });

  it("resolves on 204 (No Content)", async () => {
    const { fn } = fakeFetch([{ status: 204 }]);
    const gh = makeGitHubRest({ token: "tok", fetch: fn });
    await expect(
      gh.dispatchWorkflow("reddoorla/acme", "renovate.yml", "main"),
    ).resolves.toBeUndefined();
  });

  it("throws (with status) when the dispatch is non-2xx (e.g. 403 missing actions:write)", async () => {
    const { fn } = fakeFetch([{ status: 403, body: { message: "Resource not accessible" } }]);
    const gh = makeGitHubRest({ token: "tok", fetch: fn });
    await expect(gh.dispatchWorkflow("reddoorla/acme", "renovate.yml", "main")).rejects.toThrow(
      /403/,
    );
  });

  it("rejects a traversal/structural ref before any fetch (defense in depth)", async () => {
    const { fn, calls } = fakeFetch([{ status: 204 }]);
    const gh = makeGitHubRest({ token: "tok", fetch: fn });
    await expect(
      gh.dispatchWorkflow("reddoorla/acme", "renovate.yml", "../../etc"),
    ).rejects.toThrow();
    expect(calls).toEqual([]);
  });
});

describe("makeGitHubRest.listWorkflowRuns", () => {
  const SINCE = "2026-06-24T21:28:00.000Z";

  it("GETs the workflow's runs with created/event/per_page filters and maps the fields", async () => {
    const { fn, calls } = fakeFetch([
      {
        status: 200,
        body: {
          total_count: 1,
          workflow_runs: [
            {
              id: 42,
              status: "in_progress",
              conclusion: null,
              created_at: "2026-06-24T21:28:09Z",
              html_url: "https://github.com/reddoorla/acme/actions/runs/42",
            },
          ],
        },
      },
    ]);
    const gh = makeGitHubRest({ token: "tok", fetch: fn });
    const runs = await gh.listWorkflowRuns("reddoorla/acme", "fleet-security.yml", {
      since: SINCE,
      event: "workflow_dispatch",
      perPage: 1,
    });
    expect(runs).toEqual([
      {
        id: 42,
        status: "in_progress",
        conclusion: null,
        createdAt: "2026-06-24T21:28:09Z",
        htmlUrl: "https://github.com/reddoorla/acme/actions/runs/42",
      },
    ]);
    expect(calls[0]!.url).toContain(
      "https://api.github.com/repos/reddoorla/acme/actions/workflows/fleet-security.yml/runs?",
    );
    const decoded = decodeURIComponent(calls[0]!.url);
    expect(decoded).toContain("created=>=" + SINCE);
    expect(decoded).toContain("event=workflow_dispatch");
    expect(decoded).toContain("per_page=1");
    expect(calls[0]!.method).toBe("GET");
    expect(calls[0]!.headers["authorization"]).toBe("Bearer tok");
  });

  it("returns [] when the response has no workflow_runs array (and defaults per_page=1)", async () => {
    const { fn, calls } = fakeFetch([{ status: 200, body: { total_count: 0 } }]);
    const gh = makeGitHubRest({ token: "tok", fetch: fn });
    expect(
      await gh.listWorkflowRuns("reddoorla/acme", "fleet-security.yml", { since: SINCE }),
    ).toEqual([]);
    // perPage omitted above → the `?? 1` default must be on the wire.
    expect(decodeURIComponent(calls[0]!.url)).toContain("per_page=1");
  });

  it("throws (with status) when the list call is non-2xx", async () => {
    const { fn } = fakeFetch([{ status: 404, body: { message: "Not Found" } }]);
    const gh = makeGitHubRest({ token: "tok", fetch: fn });
    await expect(
      gh.listWorkflowRuns("reddoorla/ghost", "fleet-security.yml", { since: SINCE }),
    ).rejects.toThrow(/404/);
  });

  it("rejects a traversal workflow name before any fetch", async () => {
    const { fn, calls } = fakeFetch([{ status: 200, body: { workflow_runs: [] } }]);
    const gh = makeGitHubRest({ token: "tok", fetch: fn });
    await expect(
      gh.listWorkflowRuns("reddoorla/acme", "../../etc", { since: SINCE }),
    ).rejects.toThrow();
    expect(calls).toEqual([]);
  });
});

describe("makeGitHubRest.currentRunStep", () => {
  it("returns the in-progress step name of the in-progress job", async () => {
    const { fn, calls } = fakeFetch([
      {
        status: 200,
        body: {
          total_count: 1,
          jobs: [
            {
              id: 7,
              status: "in_progress",
              steps: [
                { name: "Set up job", status: "completed", number: 1 },
                { name: "pnpm build", status: "completed", number: 2 },
                {
                  name: "Fleet Lighthouse + domain + browser audit",
                  status: "in_progress",
                  number: 3,
                },
              ],
            },
          ],
        },
      },
    ]);
    const gh = makeGitHubRest({ token: "tok", fetch: fn });
    expect(await gh.currentRunStep("reddoorla/acme", 42)).toBe(
      "Fleet Lighthouse + domain + browser audit",
    );
    expect(calls[0]!.url).toBe("https://api.github.com/repos/reddoorla/acme/actions/runs/42/jobs");
    expect(calls[0]!.method).toBe("GET");
    expect(calls[0]!.headers["authorization"]).toBe("Bearer tok");
  });

  it("returns null when no step is in progress", async () => {
    const { fn } = fakeFetch([
      {
        status: 200,
        body: {
          jobs: [
            { id: 1, status: "completed", steps: [{ name: "x", status: "completed", number: 1 }] },
          ],
        },
      },
    ]);
    const gh = makeGitHubRest({ token: "tok", fetch: fn });
    expect(await gh.currentRunStep("reddoorla/acme", 42)).toBeNull();
  });

  it("returns null when there are no jobs", async () => {
    const { fn } = fakeFetch([{ status: 200, body: { jobs: [] } }]);
    const gh = makeGitHubRest({ token: "tok", fetch: fn });
    expect(await gh.currentRunStep("reddoorla/acme", 42)).toBeNull();
  });

  it("throws (with status) when the jobs call is non-2xx", async () => {
    const { fn } = fakeFetch([{ status: 500, body: { message: "boom" } }]);
    const gh = makeGitHubRest({ token: "tok", fetch: fn });
    await expect(gh.currentRunStep("reddoorla/acme", 42)).rejects.toThrow(/500/);
  });

  it("rejects a non-integer runId before any fetch", async () => {
    const { fn, calls } = fakeFetch([{ status: 200, body: { jobs: [] } }]);
    const gh = makeGitHubRest({ token: "tok", fetch: fn });
    await expect(gh.currentRunStep("reddoorla/acme", 1.5 as number)).rejects.toThrow();
    expect(calls).toEqual([]);
  });
});

describe("makeGitHubRest.listDependabotAlerts", () => {
  it("GETs open alerts and maps package / severity / summary / cves / url / scope", async () => {
    const { fn, calls } = fakeFetch([
      {
        status: 200,
        body: [
          {
            html_url: "https://github.com/reddoorla/acme/security/dependabot/1",
            dependency: {
              package: { ecosystem: "npm", name: "shell-quote" },
              scope: "development",
            },
            security_advisory: {
              severity: "critical",
              summary: "shell-quote escape bug",
              cve_id: "CVE-2021-42740",
            },
          },
        ],
      },
    ]);
    const gh = makeGitHubRest({ token: "tok", fetch: fn });
    const alerts = await gh.listDependabotAlerts("reddoorla/acme", { state: "open" });
    expect(alerts).toEqual([
      {
        package: "shell-quote",
        severity: "critical", // raw GitHub vocabulary; the audit maps medium→moderate
        summary: "shell-quote escape bug",
        cves: ["CVE-2021-42740"],
        url: "https://github.com/reddoorla/acme/security/dependabot/1",
        scope: "development",
      },
    ]);
    expect(calls[0]!.url).toContain(
      "https://api.github.com/repos/reddoorla/acme/dependabot/alerts?",
    );
    const decoded = decodeURIComponent(calls[0]!.url);
    expect(decoded).toContain("state=open");
    expect(decoded).toContain("per_page=100");
    expect(calls[0]!.headers["authorization"]).toBe("Bearer tok");
    expect(calls[0]!.method).toBe("GET");
  });

  it("follows the Link rel=next cursor across pages (the endpoint has no numeric page param)", async () => {
    const page1 = Array.from({ length: 100 }, (_, i) => ({
      html_url: `https://x/${i}`,
      dependency: { package: { name: `p${i}` }, scope: "runtime" },
      security_advisory: { severity: "low", summary: "s" },
    }));
    const page2 = [
      {
        html_url: "https://x/last",
        dependency: { package: { name: "last" }, scope: "runtime" },
        security_advisory: { severity: "high", summary: "s" },
      },
    ];
    const nextUrl =
      "https://api.github.com/repositories/1/dependabot/alerts?per_page=100&after=CURSOR2";
    const { fn, calls } = fakeFetch([
      { status: 200, body: page1, headers: { link: `<${nextUrl}>; rel="next"` } },
      { status: 200, body: page2 }, // no Link header → this is the last page
    ]);
    const gh = makeGitHubRest({ token: "tok", fetch: fn });
    const alerts = await gh.listDependabotAlerts("reddoorla/acme");
    expect(alerts).toHaveLength(101);
    expect(calls).toHaveLength(2);
    // Page 1 hits the alerts endpoint; page 2 follows the cursor URL from the Link header verbatim.
    expect(calls[0]!.url).toContain("/repos/reddoorla/acme/dependabot/alerts?");
    expect(calls[1]!.url).toBe(nextUrl);
    // The unsupported numeric `page` param must never appear as its own query key (it would
    // silently re-fetch page 1). Matched as `?page=`/`&page=` so it doesn't false-hit `per_page=`.
    expect(decodeURIComponent(calls[0]!.url)).not.toMatch(/[?&]page=/);
  });

  it("stops after one request on a full page with no rel=next (no duplicate-append loop)", async () => {
    const fullPage = Array.from({ length: 100 }, (_, i) => ({
      html_url: `https://x/${i}`,
      dependency: { package: { name: `p${i}` }, scope: "runtime" },
      security_advisory: { severity: "low", summary: "s" },
    }));
    const { fn, calls } = fakeFetch([{ status: 200, body: fullPage }]); // exactly 100, no Link
    const gh = makeGitHubRest({ token: "tok", fetch: fn });
    const alerts = await gh.listDependabotAlerts("reddoorla/acme");
    expect(alerts).toHaveLength(100);
    expect(calls).toHaveLength(1);
  });

  it("attaches an abort timeout signal to each request (a hang must reject, not stall)", async () => {
    const { fn, calls } = fakeFetch([{ status: 200, body: [] }]);
    const gh = makeGitHubRest({ token: "tok", fetch: fn });
    await gh.listDependabotAlerts("reddoorla/acme");
    expect(calls[0]!.signal).toBeInstanceOf(AbortSignal);
  });

  it("defaults severity/summary/cves when an alert has no security_advisory object", async () => {
    const { fn } = fakeFetch([
      {
        status: 200,
        body: [
          {
            html_url: "https://x/1",
            dependency: { package: { name: "p" }, scope: "runtime" },
            // no security_advisory key at all
          },
        ],
      },
    ]);
    const gh = makeGitHubRest({ token: "tok", fetch: fn });
    const alerts = await gh.listDependabotAlerts("reddoorla/acme");
    expect(alerts).toEqual([
      { package: "p", severity: "", summary: "", cves: [], url: "https://x/1", scope: "runtime" },
    ]);
  });

  it("defaults state to open and scope to null when the alert omits it", async () => {
    const { fn, calls } = fakeFetch([
      {
        status: 200,
        body: [
          {
            html_url: "https://x/1",
            dependency: { package: { name: "protobufjs" } }, // no scope
            security_advisory: { severity: "medium", summary: "shadowing" },
          },
        ],
      },
    ]);
    const gh = makeGitHubRest({ token: "tok", fetch: fn });
    const alerts = await gh.listDependabotAlerts("reddoorla/acme");
    expect(alerts).toEqual([
      {
        package: "protobufjs",
        severity: "medium",
        summary: "shadowing",
        cves: [],
        url: "https://x/1",
        scope: null,
      },
    ]);
    expect(decodeURIComponent(calls[0]!.url)).toContain("state=open");
  });

  it("drops alerts missing a package name (fail-soft)", async () => {
    const { fn } = fakeFetch([
      {
        status: 200,
        body: [
          {
            html_url: "https://x/a",
            dependency: { scope: "runtime" },
            security_advisory: { severity: "high", summary: "s" },
          },
          {
            html_url: "https://x/b",
            dependency: { package: { name: "ok" }, scope: "runtime" },
            security_advisory: { severity: "high", summary: "s" },
          },
        ],
      },
    ]);
    const gh = makeGitHubRest({ token: "tok", fetch: fn });
    const alerts = await gh.listDependabotAlerts("reddoorla/acme");
    expect(alerts).toEqual([
      {
        package: "ok",
        severity: "high",
        summary: "s",
        cves: [],
        url: "https://x/b",
        scope: "runtime",
      },
    ]);
  });

  it("throws (with status) when the list call is non-2xx (e.g. 403 missing security_events)", async () => {
    const { fn } = fakeFetch([
      { status: 403, body: { message: "Resource not accessible by personal access token" } },
    ]);
    const gh = makeGitHubRest({ token: "tok", fetch: fn });
    await expect(gh.listDependabotAlerts("reddoorla/acme")).rejects.toThrow(/403/);
  });

  it("rejects a non owner/repo shape before any fetch", async () => {
    const { fn, calls } = fakeFetch([]);
    const gh = makeGitHubRest({ token: "tok", fetch: fn });
    await expect(gh.listDependabotAlerts("not-a-repo")).rejects.toThrow(/owner\/repo/);
    expect(calls).toEqual([]);
  });
});
