import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import type { Context } from "@netlify/functions";

// Airtable client is mocked so importing the handler (via src/dashboard/index.js,
// which re-exports the whole dashboard module graph) never reaches a live base —
// same defensive convention as the other *-adapter tests. This endpoint never
// calls it; the mock only guards against an accidental future call.
vi.mock("../../src/reports/airtable/client.js", () => ({
  openBase: vi.fn(() => ({}) as unknown),
}));

// Shared in-memory Turso instance across openDb() calls within one test — see
// the identical workaround (and its rationale) in prospect-report.test.ts /
// prospect-audits-page-adapter.test.ts.
import type { Db } from "../../src/db/client.js";
import { mintSession, SESSION_COOKIE } from "../../src/dashboard/auth/session.js";

/** Signing secret for the session-backed requested_by test. */
const SESSION_SECRET = "test-session-secret";
let sharedDb: Db | null = null;
vi.mock("../../src/db/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/db/client.js")>();
  return {
    ...actual,
    openDb: vi.fn(async (cfg: Parameters<typeof actual.openDb>[0]) => {
      sharedDb ??= await actual.openDb(cfg);
      return sharedDb;
    }),
  };
});

// The fake dispatcher: the module under test's real triggerProspectAudit /
// respondToProspectAuditTrigger / resolveRequestedBy / env wiring all stay
// real (spread through `actual`) — only the seam that would otherwise reach
// GitHub over the network is swapped out. This is the "inject a fake
// dispatcher" the task calls for, applied at the module boundary the .mts
// handler actually imports through (src/dashboard/index.js re-exports this
// module, same pattern as approve-report-adapter.test.ts mocking approve.js).
type DispatchInputs = { url: string; business: string; requested_by: string };
type DispatchCall = { repo: string; workflowFile: string; inputs: DispatchInputs };
let dispatchCalls: DispatchCall[] = [];
let dispatchResult: { ok: true } | { ok: false; error: string } = { ok: true };
vi.mock("../../src/dashboard/prospect-audit-trigger.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/dashboard/prospect-audit-trigger.js")>();
  return {
    ...actual,
    makeWorkflowDispatchDispatcher: vi.fn(() => async (target: DispatchCall) => {
      dispatchCalls.push(target);
      return dispatchResult;
    }),
  };
});

import { openDb, readDbConfig } from "../../src/db/client.js";
import { createProspectAudit } from "../../src/db/prospect-audits.js";
import prospectAuditRun, { config } from "../../netlify/functions/prospect-audit-run.mjs";

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  dispatchCalls = [];
  dispatchResult = { ok: true };
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  sharedDb = null;
});

const ctx = {} as unknown as Context;

/** Every test that reaches the business logic needs the same three env vars;
 *  set them all here and let individual tests delete the one they're probing. */
function configureEnv(): void {
  process.env.DASHBOARD_PASSWORD = "s3cret";
  process.env.TURSO_DATABASE_URL = ":memory:";
  process.env.PROSPECT_AUDIT_DISPATCH_REPO = "reddoorla/prospect-audit-private";
  process.env.RENOVATE_TOKEN = "gh_token_x";
}

function authHeader(user: string, password: string): Record<string, string> {
  return { authorization: `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}` };
}

function post(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("https://dash.reddoor.test/api/prospect-audit/run", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

const GOOD_BODY = { url: "https://prospect.example/", goal: "enquire", business: "Prospect Co" };

describe("prospect-audit-run adapter — method + CSRF + auth gating", () => {
  it("405s a non-GET/non-POST method (DELETE)", async () => {
    configureEnv();
    const res = await prospectAuditRun(
      new Request("https://dash.reddoor.test/api/prospect-audit/run", {
        method: "DELETE",
        headers: authHeader("tucker", "s3cret"),
      }),
      ctx,
    );
    expect(res.status).toBe(405);
    expect(dispatchCalls).toHaveLength(0);
  });

  it("rejects a cross-site POST with 403 BEFORE the auth check (no DASHBOARD_PASSWORD even set)", async () => {
    delete process.env.DASHBOARD_PASSWORD;
    process.env.TURSO_DATABASE_URL = ":memory:";
    const res = await prospectAuditRun(
      post(GOOD_BODY, {
        "sec-fetch-site": "cross-site",
        authorization: `Basic ${Buffer.from("t:s3cret").toString("base64")}`,
      }),
      ctx,
    );
    expect(res.status).toBe(403);
    expect(dispatchCalls).toHaveLength(0);
  });

  it("rejects a cross-site POST even with fully correct credentials (CSRF precedes auth)", async () => {
    configureEnv();
    const res = await prospectAuditRun(
      post(GOOD_BODY, { "sec-fetch-site": "cross-site", ...authHeader("tucker", "s3cret") }),
      ctx,
    );
    expect(res.status).toBe(403);
    expect(dispatchCalls).toHaveLength(0);
  });

  it("401s an unauthenticated POST as JSON, and never dispatches", async () => {
    configureEnv();
    const res = await prospectAuditRun(post(GOOD_BODY), ctx);
    expect(res.status).toBe(401);
    // Fired by fetch() from /audits, so the refusal has to be a status the page
    // can act on — never a redirect, and never a challenge header that would
    // pop a native dialog mid-fetch.
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
    expect(res.headers.get("www-authenticate")).toBeNull();
    expect(dispatchCalls).toHaveLength(0);
  });

  it("401s a POST with the wrong password", async () => {
    configureEnv();
    const res = await prospectAuditRun(post(GOOD_BODY, authHeader("tucker", "nope")), ctx);
    expect(res.status).toBe(401);
    expect(dispatchCalls).toHaveLength(0);
  });
});

describe("prospect-audit-run adapter — dispatch-repo configuration", () => {
  it("503s when PROSPECT_AUDIT_DISPATCH_REPO is missing, and never dispatches", async () => {
    configureEnv();
    delete process.env.PROSPECT_AUDIT_DISPATCH_REPO;
    const res = await prospectAuditRun(post(GOOD_BODY, authHeader("tucker", "s3cret")), ctx);
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("unconfigured");
    expect(dispatchCalls).toHaveLength(0);
  });
});

describe("prospect-audit-run adapter — input validation (each rejection is distinct, none dispatch)", () => {
  it("400s a non-http(s) url", async () => {
    configureEnv();
    const res = await prospectAuditRun(
      post({ url: "not-a-url" }, authHeader("tucker", "s3cret")),
      ctx,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; message: string };
    expect(body.error).toBe("invalid-url");
    expect(dispatchCalls).toHaveLength(0);
  });

  it("400s a private/loopback-host url with a DIFFERENT message than a bad url", async () => {
    configureEnv();
    const res = await prospectAuditRun(
      post({ url: "http://127.0.0.1:8080/", goal: "enquire" }, authHeader("tucker", "s3cret")),
      ctx,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; message: string };
    expect(body.error).toBe("private-host");
    expect(dispatchCalls).toHaveLength(0);

    const badUrlRes = await prospectAuditRun(
      post({ url: "not-a-url" }, authHeader("tucker", "s3cret")),
      ctx,
    );
    const badUrlBody = (await badUrlRes.json()) as { message: string };
    expect(badUrlBody.message).not.toBe(body.message);
  });

  it("409s a repeat of the same url audited within the last 10 minutes, with the existing report's link, and never dispatches", async () => {
    configureEnv();
    const db = await openDb(readDbConfig());
    const { token } = await createProspectAudit(db, {
      url: "https://prospect.example/",
      business: "Prospect Co",
      resultJson: "{}",
    });

    const res = await prospectAuditRun(post(GOOD_BODY, authHeader("tucker", "s3cret")), ctx);
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string; message: string; reportUrl: string };
    expect(body.error).toBe("duplicate");
    expect(body.reportUrl).toBe(`/r/${token}`);
    expect(dispatchCalls).toHaveLength(0);
  });
});

describe("prospect-audit-run adapter — a good request", () => {
  it("dispatches exactly once with the right repo/workflow/inputs and returns 202", async () => {
    configureEnv();
    const res = await prospectAuditRun(post(GOOD_BODY, authHeader("tucker", "s3cret")), ctx);

    expect(res.status).toBe(202);
    const body = (await res.json()) as { ok: boolean; message: string };
    expect(body.ok).toBe(true);
    expect(body.message).toMatch(/email/i);

    expect(dispatchCalls).toHaveLength(1);
    expect(dispatchCalls[0]).toEqual({
      repo: "reddoorla/prospect-audit-private",
      workflowFile: "prospect-audit.yml",
      inputs: {
        url: "https://prospect.example/",
        goal: "enquire",
        business: "Prospect Co",
        // The shared-password fallback has no identity behind it, so the audit
        // log says so rather than naming whoever the Basic username claimed.
        requested_by: "cockpit",
      },
    });
  });

  it("records the signed-in operator's verified address as requested_by", async () => {
    // The point of the whole exercise: with a real session the audit log names
    // a person Google verified, not a string someone typed into a password box.
    configureEnv();
    process.env.DASHBOARD_SESSION_SECRET = SESSION_SECRET;
    process.env.DASHBOARD_ALLOWED_EMAILS = "tim@reddoorla.com";
    process.env.GOOGLE_OAUTH_CLIENT_ID = "client-123";
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = "client-secret";

    const token = mintSession("tim@reddoorla.com", SESSION_SECRET, new Date());
    await prospectAuditRun(
      post(GOOD_BODY, { cookie: `${SESSION_COOKIE}=${encodeURIComponent(token)}` }),
      ctx,
    );
    expect(dispatchCalls[0]?.inputs.requested_by).toBe("tim@reddoorla.com");
  });

  it("uses PROSPECT_AUDIT_WORKFLOW_FILE when set, instead of the default", async () => {
    configureEnv();
    process.env.PROSPECT_AUDIT_WORKFLOW_FILE = "custom-audit.yml";
    await prospectAuditRun(post(GOOD_BODY, authHeader("tucker", "s3cret")), ctx);
    expect(dispatchCalls[0]?.workflowFile).toBe("custom-audit.yml");
  });

  it("reports requested_by as 'cockpit' for any shared-password caller", async () => {
    // Whatever username is supplied — one, none, or a lie — Basic carries no
    // verified identity, so none of it reaches the audit log.
    configureEnv();
    await prospectAuditRun(post(GOOD_BODY, authHeader("", "s3cret")), ctx);
    expect(dispatchCalls[0]?.inputs.requested_by).toBe("cockpit");

    dispatchCalls.length = 0;
    await prospectAuditRun(post(GOOD_BODY, authHeader("definitely-erik", "s3cret")), ctx);
    expect(dispatchCalls[0]?.inputs.requested_by).toBe("cockpit");
  });

  it("treats a missing business name as an empty workflow input, not literal 'null'", async () => {
    configureEnv();
    await prospectAuditRun(
      post({ url: "https://prospect.example/", goal: "enquire" }, authHeader("tucker", "s3cret")),
      ctx,
    );
    expect(dispatchCalls[0]?.inputs.business).toBe("");
  });

  it("502s and reports the underlying error when the dispatcher itself fails", async () => {
    configureEnv();
    dispatchResult = { ok: false, error: "403 no actions:write" };
    const res = await prospectAuditRun(post(GOOD_BODY, authHeader("tucker", "s3cret")), ctx);
    expect(res.status).toBeGreaterThanOrEqual(500);
    const body = (await res.json()) as { message: string };
    expect(body.message).toContain("403 no actions:write");
  });
});

describe("prospect-audit-run adapter — health check + routing", () => {
  it("GET returns a presence-only health check that never leaks the password value", async () => {
    configureEnv();
    process.env.DASHBOARD_PASSWORD = "should_not_leak";
    const res = await prospectAuditRun(
      new Request("https://dash.reddoor.test/api/prospect-audit/run", {
        method: "GET",
        headers: authHeader("tucker", "should_not_leak"),
      }),
      ctx,
    );
    expect(res.status).toBe(200);
    const raw = await res.text();
    expect(raw).not.toContain("should_not_leak");
    expect(dispatchCalls).toHaveLength(0);
  });

  it("GET is behind the operator gate — it told strangers the password fallback was live", async () => {
    // #612 review. The body leaks no VALUES, but `DASHBOARD_PASSWORD: true` is
    // exactly the reconnaissance step for using that fallback. A health check
    // whose entire audience is the operator has no reason to answer anyone else.
    process.env.DASHBOARD_PASSWORD = "should_not_leak";
    const res = await prospectAuditRun(
      new Request("https://dash.reddoor.test/api/prospect-audit/run", { method: "GET" }),
      ctx,
    );
    expect(res.status).toBe(401);
    expect(await res.text()).not.toContain("DASHBOARD_PASSWORD");
  });

  it("claims /api/prospect-audit/run as well as the raw function path", () => {
    expect(config.path).toContain("/api/prospect-audit/run");
    expect(config.path).toContain("/.netlify/functions/prospect-audit-run");
  });
});
