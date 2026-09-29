import { describe, it, expect, vi } from "vitest";
import {
  triggerProspectAudit,
  respondToProspectAuditTrigger,
  resolveRequestedBy,
  prospectAuditRecipientsLabel,
  makeWorkflowDispatchDispatcher,
  PROSPECT_AUDIT_DUPLICATE_WINDOW_MS,
  DEFAULT_PROSPECT_AUDIT_RECIPIENTS_LABEL,
  type ProspectAuditTriggerDeps,
  type ProspectAuditDispatchResult,
  type ProspectAuditDispatchTarget,
  PROSPECT_AUDIT_DAILY_CAP,
} from "../../src/dashboard/prospect-audit-trigger.js";
import {
  generateToken,
  listRecentProspectAudits,
  releaseProspectAuditReservation,
  reserveProspectAudit,
  type ProspectAuditListItem,
} from "../../src/db/prospect-audits.js";
import { openDb, type Db } from "../../src/db/client.js";

function recentItem(over: Partial<ProspectAuditListItem> = {}): ProspectAuditListItem {
  return {
    id: "pa_1",
    token: "A".repeat(22),
    url: "https://acme.example/",
    business: "Acme Roofing",
    status: "complete",
    created_at: "2026-08-25T12:00:00.000Z",
    edited_at: null,
    opened_at: null,
    chosen_terms: null,
    ...over,
  };
}

function deps(over: Partial<ProspectAuditTriggerDeps> = {}): ProspectAuditTriggerDeps {
  return {
    listRecent: async () => [],
    reserve: async () => ({ kind: "reserved", id: "pa_reserved", token: "R".repeat(22) }),
    release: async () => {},
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
      {
        url: "https://prospect.example/",
        business: "Prospect Co",
        requestedBy: "tucker",
        goal: "enquire",
      },
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
        goal: "enquire",
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
      {
        url: "  https://prospect.example/  ",
        business: "   ",
        requestedBy: "cockpit",
        goal: "enquire",
      },
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
      goal: "enquire",
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
      goal: "enquire",
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
      goal: "enquire",
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
      goal: "enquire",
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
      { url: "https://prospect.example/", business: null, requestedBy: "cockpit", goal: "enquire" },
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
      { url: "https://prospect.example/", business: null, requestedBy: "cockpit", goal: "enquire" },
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
      { url: "https://prospect.example/", business: null, requestedBy: "cockpit", goal: "enquire" },
    );
    expect(r).toEqual({ status: "dispatched" });
  });

  it("reports a dispatch failure without throwing", async () => {
    const r = await triggerProspectAudit(
      deps({ dispatch: async () => ({ ok: false, error: "403 no actions:write" }) }),
      TARGET,
      { url: "https://prospect.example/", business: null, requestedBy: "cockpit", goal: "enquire" },
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

describe("resolveRequestedBy", () => {
  it("records the operator's verified address", () => {
    expect(resolveRequestedBy("tim@reddoorla.com")).toBe("tim@reddoorla.com");
  });

  it("falls back to 'cockpit' when there is no identity to record", () => {
    // The shared-password fallback. It genuinely has no person behind it, and
    // inventing one would restore the exact lie Google sign-in removed: the old
    // helper read the Basic username, which verifyBasicAuth never validates, so
    // any operator could type any name into the audit log.
    expect(resolveRequestedBy(null)).toBe("cockpit");
    expect(resolveRequestedBy(undefined)).toBe("cockpit");
    expect(resolveRequestedBy("")).toBe("cockpit");
    expect(resolveRequestedBy("   ")).toBe("cockpit");
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
      inputs: {
        url: "https://prospect.example/",
        business: "Prospect Co",
        requested_by: "tucker",
        goal: "enquire",
      },
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
      inputs: {
        url: "https://prospect.example/",
        business: "Prospect Co",
        requested_by: "tucker",
        goal: "enquire",
      },
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
      inputs: { url: "https://x.example/", business: "", requested_by: "cockpit", goal: "enquire" },
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
      inputs: { url: "https://x.example/", business: "", requested_by: "cockpit", goal: "enquire" },
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
      inputs: { url: "https://x.example/", business: "", requested_by: "cockpit", goal: "enquire" },
    });
    expect(result).toEqual({ ok: false, error: expect.stringContaining("network down") });
  });
});

describe("the default recipients label", () => {
  it("names nobody, because this endpoint cannot read the real list", () => {
    // The authoritative recipients live in the PRIVATE dispatch repo's workflow
    // secrets. A message here that confidently lists people would drift silently
    // the day someone is added, and be wrong with no way to notice.
    expect(DEFAULT_PROSPECT_AUDIT_RECIPIENTS_LABEL).not.toMatch(/tucker|tim|erik|@/i);
  });
});

/**
 * #612 review: the duplicate window stops the SAME url being re-run; nothing
 * stopped DISTINCT urls. One authenticated session could dispatch ~30/minute
 * against 30 hostnames indefinitely, and one audit is structurally an Opus call
 * plus up to 28 Sonnet calls with up to 112 billed web searches, a 20-page
 * double crawl, a 3-pass Lighthouse and a PDF render in a billed Actions job.
 *
 * This is a runaway brake, not a quota — it should never bind in normal use.
 */
describe("the 24h daily cap", () => {
  const NEW_URL = {
    url: "https://brand-new.example/",
    business: null,
    requestedBy: "op@reddoorla.com",
    goal: "enquire",
  };

  it("refuses once the reservation is capped, and never dispatches", async () => {
    let dispatched = 0;
    const r = await triggerProspectAudit(
      deps({
        reserve: async () => ({ kind: "capped", count: PROSPECT_AUDIT_DAILY_CAP }),
        dispatch: async () => {
          dispatched++;
          return { ok: true };
        },
      }),
      TARGET,
      NEW_URL,
    );
    expect(r).toEqual({
      status: "daily-cap",
      count: PROSPECT_AUDIT_DAILY_CAP,
      cap: PROSPECT_AUDIT_DAILY_CAP,
    });
    expect(dispatched).toBe(0);
  });

  it("reserves BEFORE it dispatches, with what the listing needs", async () => {
    const order: string[] = [];
    const reserve = vi.fn(async () => {
      order.push("reserve");
      return { kind: "reserved" as const, id: "pa_1", token: "T".repeat(22) };
    });
    const r = await triggerProspectAudit(
      deps({
        reserve,
        dispatch: async () => {
          order.push("dispatch");
          return { ok: true };
        },
      }),
      TARGET,
      { ...NEW_URL, business: " Acme ", terms: ["a", " "], questions: [] },
    );
    expect(r.status).toBe("dispatched");
    expect(order).toEqual(["reserve", "dispatch"]);
    expect(reserve).toHaveBeenCalledWith(
      {
        url: "https://brand-new.example/",
        business: "Acme",
        chosenTerms: ["a"],
        chosenQuestions: null,
        // The dispatched job's CLI claims this row, so it is NOT claimed here.
        claimed: false,
      },
      new Date("2026-08-25T12:10:00.000Z"),
    );
  });

  it("gives the slot back when the dispatch fails — nothing will ever run to finish it", async () => {
    const release = vi.fn(async () => {});
    const r = await triggerProspectAudit(
      deps({
        reserve: async () => ({ kind: "reserved", id: "pa_9", token: "T".repeat(22) }),
        release,
        dispatch: async () => ({ ok: false, error: "403" }),
      }),
      TARGET,
      NEW_URL,
    );
    expect(r).toEqual({ status: "dispatch-failed", error: "403" });
    expect(release).toHaveBeenCalledWith("pa_9");
  });

  it("a release that throws still reports the dispatch failure, not a 500", async () => {
    const r = await triggerProspectAudit(
      deps({
        release: async () => {
          throw new Error("turso blip");
        },
        dispatch: async () => ({ ok: false, error: "403" }),
      }),
      TARGET,
      NEW_URL,
    );
    expect(r).toEqual({ status: "dispatch-failed", error: "403" });
  });

  it("reports a repeat of the SAME url as duplicate, not as cap, and reserves nothing", async () => {
    // Order matters: a second click on one url is truthfully a duplicate, and
    // must not consume the day's budget or report a confusing limit.
    const reserve = vi.fn(async () => ({ kind: "capped" as const, count: 25 }));
    const dup = recentItem({ url: "https://acme.example/" });
    const r = await triggerProspectAudit(deps({ listRecent: async () => [dup], reserve }), TARGET, {
      ...NEW_URL,
      url: "https://acme.example/",
    });
    expect(r.status).toBe("duplicate");
    expect(reserve).not.toHaveBeenCalled();
  });

  it("answers 429 with both numbers, not a bare refusal", () => {
    const out = respondToProspectAuditTrigger(
      { status: "daily-cap", count: 25, cap: 25 },
      { recipientsLabel: "the team" },
    );
    expect(out.status).toBe(429);
    expect(String(out.body.message)).toContain("25");
  });
});

/**
 * #907, through the real SQL. The cockpit counted, then dispatched, and wrote
 * no row at all — the row only appeared when the dispatched job finished — so
 * a burst of clicks against distinct hostnames all passed the same count.
 */
describe("the 24h daily cap — a burst against the real reservation (#907)", () => {
  const NOW = new Date("2026-08-25T12:10:00.000Z");

  async function seeded(k: number): Promise<Db> {
    const db = await openDb({ url: ":memory:" });
    for (let i = 0; i < k; i++) {
      await db
        .insertInto("prospect_audits")
        .values({
          id: `pa_seed_${i}`,
          token: generateToken(),
          url: `https://seed-${i}.example/`,
          business: null,
          created_at: "2026-08-25T09:00:00.000Z",
          status: "complete",
          result_json: "{}",
        })
        .execute();
    }
    return db;
  }

  function sqlDeps(db: Db, dispatched: string[]): ProspectAuditTriggerDeps {
    return {
      listRecent: (limit) => listRecentProspectAudits(db, limit),
      reserve: (req, now) => reserveProspectAudit(db, req, { now }),
      release: (id) => releaseProspectAuditReservation(db, id),
      dispatch: async (t) => {
        dispatched.push(t.inputs.url);
        return { ok: true };
      },
      now: () => NOW,
    };
  }

  it("N concurrent clicks on distinct urls against cap C with K existing rows dispatch exactly C − K", async () => {
    const K = PROSPECT_AUDIT_DAILY_CAP - 4;
    const N = 12;
    const db = await seeded(K);
    const dispatched: string[] = [];
    const results = await Promise.all(
      Array.from({ length: N }, (_, i) =>
        triggerProspectAudit(sqlDeps(db, dispatched), TARGET, {
          url: `https://click-${i}.example/`,
          business: null,
          requestedBy: "op@reddoorla.com",
          goal: "enquire",
        }),
      ),
    );
    expect(dispatched).toHaveLength(4);
    expect(results.filter((r) => r.status === "daily-cap")).toHaveLength(N - 4);
  });

  it("a click on a url whose run is still going is a duplicate with NO report link", async () => {
    const db = await seeded(0);
    const dispatched: string[] = [];
    const input = {
      url: "https://acme.example/",
      business: null,
      requestedBy: "op@reddoorla.com",
      goal: "enquire",
    };
    expect((await triggerProspectAudit(sqlDeps(db, dispatched), TARGET, input)).status).toBe(
      "dispatched",
    );
    const again = await triggerProspectAudit(sqlDeps(db, dispatched), TARGET, input);
    expect(again.status).toBe("duplicate");
    const body = respondToProspectAuditTrigger(again, { recipientsLabel: "x" }).body;
    // The row has no report yet, so a link would open a 404.
    expect(body.reportUrl).toBeUndefined();
    expect(String(body.message)).toMatch(/still running/i);
    expect(dispatched).toHaveLength(1);
  });
});

describe("Gate B: a client-facing audit needs a goal", () => {
  // The cockpit is the client path. Inference is for internal runs; a report
  // Tim shows a prospect grades the site against a goal a person chose.
  it("refuses a run with no goal", async () => {
    const dispatch = vi.fn(async () => ({ ok: true as const }));
    const r = await triggerProspectAudit(deps({ dispatch }), TARGET, {
      url: "https://acme.example/",
      business: null,
      requestedBy: "x",
      goal: "",
    });
    expect(r).toEqual({ status: "missing-goal" });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("refuses a goal outside the operator set — 'unknown' is a finding, not a choice", async () => {
    const r = await triggerProspectAudit(deps(), TARGET, {
      url: "https://acme.example/",
      business: null,
      requestedBy: "x",
      goal: "unknown",
    });
    expect(r).toEqual({ status: "missing-goal" });
  });

  it("forwards the goal to the dispatcher", async () => {
    const dispatch = vi.fn(async () => ({ ok: true as const }));
    await triggerProspectAudit(deps({ dispatch }), TARGET, {
      url: "https://acme.example/",
      business: null,
      requestedBy: "x",
      goal: "enquire",
    });
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ inputs: expect.objectContaining({ goal: "enquire" }) }),
    );
  });

  it("explains a missing goal to the operator as a 400", () => {
    const { status, body } = respondToProspectAuditTrigger(
      { status: "missing-goal" },
      { recipientsLabel: "x" },
    );
    expect(status).toBe(400);
    expect(JSON.stringify(body)).toMatch(/what the site should get a visitor to do/i);
  });
});
