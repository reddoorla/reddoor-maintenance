import { describe, it, expect, vi } from "vitest";
import {
  triggerProspectAudit,
  respondToProspectAuditTrigger,
  basicAuthUsername,
  resolveRequestedBy,
  prospectAuditRecipientsLabel,
  makeWorkflowDispatchDispatcher,
  PROSPECT_AUDIT_DUPLICATE_WINDOW_MS,
  DEFAULT_PROSPECT_AUDIT_RECIPIENTS_LABEL,
  type ProspectAuditTriggerDeps,
  type ProspectAuditDispatchResult,
  type ProspectAuditDispatchTarget,
} from "../../src/dashboard/prospect-audit-trigger.js";
import type { ProspectAuditListItem } from "../../src/db/prospect-audits.js";

function recentItem(over: Partial<ProspectAuditListItem> = {}): ProspectAuditListItem {
  return {
    id: "pa_1",
    token: "A".repeat(22),
    url: "https://acme.example/",
    business: "Acme Roofing",
    status: "complete",
    created_at: "2026-08-25T12:00:00.000Z",
    ...over,
  };
}

function deps(over: Partial<ProspectAuditTriggerDeps> = {}): ProspectAuditTriggerDeps {
  return {
    listRecent: async () => [],
    dispatch: async () => ({ ok: true }),
    now: () => new Date("2026-08-25T12:10:00.000Z"),
    ...over,
  };
}

const TARGET = { repo: "reddoorla/prospect-audit-private", workflowFile: "prospect-audit.yml" };

describe("triggerProspectAudit", () => {
  it("dispatches exactly once with the right inputs and reports success", async () => {
    const calls: ProspectAuditDispatchTarget[] = [];
    const r = await triggerProspectAudit(
      deps({
        dispatch: async (t) => {
          calls.push(t);
          return { ok: true };
        },
      }),
      TARGET,
      { url: "https://prospect.example/", business: "Prospect Co", requestedBy: "tucker" },
    );
    expect(r).toEqual({ status: "dispatched" });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      repo: TARGET.repo,
      workflowFile: TARGET.workflowFile,
      inputs: {
        url: "https://prospect.example/",
        business: "Prospect Co",
        requested_by: "tucker",
      },
    });
  });

  it("trims the url and treats a blank business as empty, not a literal 'null'", async () => {
    const calls: ProspectAuditDispatchTarget[] = [];
    await triggerProspectAudit(
      deps({
        dispatch: async (t) => {
          calls.push(t);
          return { ok: true };
        },
      }),
      TARGET,
      { url: "  https://prospect.example/  ", business: "   ", requestedBy: "cockpit" },
    );
    expect(calls[0]!.inputs.url).toBe("https://prospect.example/");
    expect(calls[0]!.inputs.business).toBe("");
  });

  it("rejects a non-http(s) url before touching the database or the dispatcher", async () => {
    const listRecent = vi.fn(async () => []);
    const dispatch = vi.fn(async () => ({ ok: true }) as ProspectAuditDispatchResult);
    const r = await triggerProspectAudit(deps({ listRecent, dispatch }), TARGET, {
      url: "not-a-url",
      business: null,
      requestedBy: "cockpit",
    });
    expect(r).toEqual({ status: "invalid-url" });
    expect(listRecent).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("rejects an empty url as invalid (a malformed/absent request body)", async () => {
    const dispatch = vi.fn(async () => ({ ok: true }) as ProspectAuditDispatchResult);
    const r = await triggerProspectAudit(deps({ dispatch }), TARGET, {
      url: "",
      business: null,
      requestedBy: "cockpit",
    });
    expect(r).toEqual({ status: "invalid-url" });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("rejects a private/loopback host without dispatching — the SSRF guard", async () => {
    const listRecent = vi.fn(async () => []);
    const dispatch = vi.fn(async () => ({ ok: true }) as ProspectAuditDispatchResult);
    const r = await triggerProspectAudit(deps({ listRecent, dispatch }), TARGET, {
      url: "http://127.0.0.1:8080/admin",
      business: null,
      requestedBy: "cockpit",
    });
    expect(r).toEqual({ status: "private-host" });
    expect(listRecent).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("rejects a link-local host too", async () => {
    const dispatch = vi.fn(async () => ({ ok: true }) as ProspectAuditDispatchResult);
    const r = await triggerProspectAudit(deps({ dispatch }), TARGET, {
      url: "http://169.254.169.254/latest/meta-data",
      business: null,
      requestedBy: "cockpit",
    });
    expect(r).toEqual({ status: "private-host" });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("refuses a repeat of the SAME url within the 10-minute window, without dispatching", async () => {
    const dispatch = vi.fn(async () => ({ ok: true }) as ProspectAuditDispatchResult);
    const existing = recentItem({
      url: "https://prospect.example/",
      created_at: "2026-08-25T12:05:00.000Z",
    });
    const r = await triggerProspectAudit(
      deps({ listRecent: async () => [existing], dispatch }),
      TARGET,
      { url: "https://prospect.example/", business: null, requestedBy: "cockpit" },
    );
    expect(r).toEqual({ status: "duplicate", existing });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("allows the SAME url again once the window has fully elapsed", async () => {
    const dispatch = vi.fn(async () => ({ ok: true }) as ProspectAuditDispatchResult);
    const justOutsideWindow = new Date(
      new Date("2026-08-25T12:10:00.000Z").getTime() - PROSPECT_AUDIT_DUPLICATE_WINDOW_MS - 1000,
    ).toISOString();
    const stale = recentItem({ url: "https://prospect.example/", created_at: justOutsideWindow });
    const r = await triggerProspectAudit(
      deps({ listRecent: async () => [stale], dispatch }),
      TARGET,
      { url: "https://prospect.example/", business: null, requestedBy: "cockpit" },
    );
    expect(r).toEqual({ status: "dispatched" });
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it("does not treat a DIFFERENT url as a duplicate even inside the window", async () => {
    const dispatch = vi.fn(async () => ({ ok: true }) as ProspectAuditDispatchResult);
    const other = recentItem({ url: "https://someone-else.example/" });
    const r = await triggerProspectAudit(
      deps({ listRecent: async () => [other], dispatch }),
      TARGET,
      { url: "https://prospect.example/", business: null, requestedBy: "cockpit" },
    );
    expect(r).toEqual({ status: "dispatched" });
  });

  it("reports a dispatch failure without throwing", async () => {
    const r = await triggerProspectAudit(
      deps({ dispatch: async () => ({ ok: false, error: "403 no actions:write" }) }),
      TARGET,
      { url: "https://prospect.example/", business: null, requestedBy: "cockpit" },
    );
    expect(r).toEqual({ status: "dispatch-failed", error: "403 no actions:write" });
  });
});

describe("respondToProspectAuditTrigger", () => {
  const recipients = { recipientsLabel: "Tucker, Tim and Erik" };

  it("maps invalid-url to 400 with a distinct message", () => {
    const { status, body } = respondToProspectAuditTrigger({ status: "invalid-url" }, recipients);
    expect(status).toBe(400);
    expect(body.error).toBe("invalid-url");
    expect(String(body.message)).toMatch(/valid http/i);
  });

  it("maps private-host to 400 with a distinct message", () => {
    const { status, body } = respondToProspectAuditTrigger({ status: "private-host" }, recipients);
    expect(status).toBe(400);
    expect(body.error).toBe("private-host");
    expect(String(body.message)).toMatch(/internal|private/i);
  });

  it("maps duplicate to 409 with a distinct message and the existing report's link", () => {
    const existing = recentItem();
    const { status, body } = respondToProspectAuditTrigger(
      { status: "duplicate", existing },
      recipients,
    );
    expect(status).toBe(409);
    expect(body.error).toBe("duplicate");
    expect(String(body.message)).toMatch(/already audited/i);
    expect(body.reportUrl).toBe(`/r/${existing.token}`);
  });

  it("maps dispatch-failed to a non-2xx with the underlying error folded in", () => {
    const { status, body } = respondToProspectAuditTrigger(
      { status: "dispatch-failed", error: "boom" },
      recipients,
    );
    expect(status).toBeGreaterThanOrEqual(500);
    expect(String(body.message)).toContain("boom");
  });

  it("maps dispatched to 202 and names who gets the email", () => {
    const { status, body } = respondToProspectAuditTrigger({ status: "dispatched" }, recipients);
    expect(status).toBe(202);
    expect(body.ok).toBe(true);
    expect(String(body.message)).toContain("Tucker, Tim and Erik");
  });

  it("every rejection message is distinct from every other", () => {
    const existing = recentItem();
    const messages = [
      respondToProspectAuditTrigger({ status: "invalid-url" }, recipients).body.message,
      respondToProspectAuditTrigger({ status: "private-host" }, recipients).body.message,
      respondToProspectAuditTrigger({ status: "duplicate", existing }, recipients).body.message,
    ];
    expect(new Set(messages).size).toBe(messages.length);
  });
});

describe("basicAuthUsername / resolveRequestedBy", () => {
  function basic(user: string, pass: string): string {
    return "Basic " + Buffer.from(`${user}:${pass}`).toString("base64");
  }

  it("extracts the username from a well-formed Basic header", () => {
    expect(basicAuthUsername(basic("tucker", "s3cret"))).toBe("tucker");
  });

  it("returns null for a missing header", () => {
    expect(basicAuthUsername(null)).toBeNull();
    expect(basicAuthUsername(undefined)).toBeNull();
  });

  it("returns null for a non-Basic scheme", () => {
    expect(basicAuthUsername("Bearer abc123")).toBeNull();
  });

  it("returns null for garbage base64 with no colon", () => {
    expect(basicAuthUsername("Basic " + Buffer.from("nocolon").toString("base64"))).toBeNull();
  });

  it("resolveRequestedBy uses the username when present", () => {
    expect(resolveRequestedBy(basic("tim", "x"))).toBe("tim");
  });

  it("resolveRequestedBy falls back to 'cockpit' when absent/malformed", () => {
    expect(resolveRequestedBy(null)).toBe("cockpit");
    expect(resolveRequestedBy("Bearer abc")).toBe("cockpit");
  });
});

describe("prospectAuditRecipientsLabel", () => {
  it("falls back to the default label when unset", () => {
    expect(prospectAuditRecipientsLabel(undefined)).toBe(DEFAULT_PROSPECT_AUDIT_RECIPIENTS_LABEL);
    expect(prospectAuditRecipientsLabel("")).toBe(DEFAULT_PROSPECT_AUDIT_RECIPIENTS_LABEL);
  });

  it("formats a comma-separated env value into a human list", () => {
    expect(prospectAuditRecipientsLabel("tucker@x.com, tim@x.com,erik@x.com")).toBe(
      "tucker@x.com, tim@x.com, erik@x.com",
    );
  });
});

describe("makeWorkflowDispatchDispatcher", () => {
  function fetchSequence(...responses: Array<Partial<Response> & { ok: boolean }>) {
    let i = 0;
    return vi.fn(async () => {
      const r = responses[i]!;
      i++;
      return r as unknown as Response;
    });
  }

  it("resolves the default branch, then POSTs a workflow_dispatch carrying ref + inputs", async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const fakeFetch = vi.fn(async (url: string | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      if (String(url).endsWith("/repos/reddoorla/private-audits")) {
        return new Response(JSON.stringify({ default_branch: "main" }), { status: 200 });
      }
      return new Response(null, { status: 204 });
    });
    const dispatcher = makeWorkflowDispatchDispatcher({
      token: "gh_x",
      fetch: fakeFetch as unknown as typeof fetch,
    });
    const result = await dispatcher({
      repo: "reddoorla/private-audits",
      workflowFile: "prospect-audit.yml",
      inputs: { url: "https://prospect.example/", business: "Prospect Co", requested_by: "tucker" },
    });
    expect(result).toEqual({ ok: true });
    expect(calls).toHaveLength(2);
    const dispatchCall = calls[1]!;
    expect(dispatchCall.url).toBe(
      "https://api.github.com/repos/reddoorla/private-audits/actions/workflows/prospect-audit.yml/dispatches",
    );
    const sentBody = JSON.parse(String(dispatchCall.init?.body));
    expect(sentBody).toEqual({
      ref: "main",
      inputs: { url: "https://prospect.example/", business: "Prospect Co", requested_by: "tucker" },
    });
  });

  it("never throws — a bad repo shape resolves to ok:false", async () => {
    const dispatcher = makeWorkflowDispatchDispatcher({
      token: "gh_x",
      fetch: vi.fn() as unknown as typeof fetch,
    });
    const result = await dispatcher({
      repo: "not-owner-slash-repo",
      workflowFile: "prospect-audit.yml",
      inputs: { url: "https://x.example/", business: "", requested_by: "cockpit" },
    });
    expect(result.ok).toBe(false);
  });

  it("never throws — a non-ok GitHub response resolves to ok:false with the status in the message", async () => {
    const fakeFetch = fetchSequence(
      { ok: true, json: async () => ({ default_branch: "main" }) } as unknown as Response,
      { ok: false, status: 403, text: async () => "no actions:write" } as unknown as Response,
    );
    const dispatcher = makeWorkflowDispatchDispatcher({
      token: "gh_x",
      fetch: fakeFetch as unknown as typeof fetch,
    });
    const result = await dispatcher({
      repo: "reddoorla/private-audits",
      workflowFile: "prospect-audit.yml",
      inputs: { url: "https://x.example/", business: "", requested_by: "cockpit" },
    });
    expect(result).toEqual({ ok: false, error: expect.stringContaining("403") });
  });

  it("never throws — defaultBranch rejecting resolves to ok:false", async () => {
    const fakeFetch = vi.fn(async () => {
      throw new Error("network down");
    });
    const dispatcher = makeWorkflowDispatchDispatcher({
      token: "gh_x",
      fetch: fakeFetch as unknown as typeof fetch,
    });
    const result = await dispatcher({
      repo: "reddoorla/private-audits",
      workflowFile: "prospect-audit.yml",
      inputs: { url: "https://x.example/", business: "", requested_by: "cockpit" },
    });
    expect(result).toEqual({ ok: false, error: expect.stringContaining("network down") });
  });
});
