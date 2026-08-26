// Coverage for the --email wiring in runProspectAuditCommand: does the flag
// reach src/prospect/email.ts, and does a failure there behave exactly like
// the existing --out/persist failures (a warning, never a lost audit and
// never a changed exit code)? Mirrors prospect-audit-persistence.test.ts's
// structure and its `forcePersistFailure` mocking pattern, one level up: this
// file mocks src/prospect/email.js's sendAuditEmail (the boundary
// runProspectAuditCommand actually calls through a dynamic import), while
// src/prospect/email.ts's OWN sending mechanics — the injected ResendClient,
// escaping, the attachment — are covered offline in tests/prospect/email.test.ts.
import { describe, it, expect, afterEach, vi } from "vitest";
import { runProspectAuditCommand } from "../../src/cli/commands/prospect-audit.js";
import type { PipelineDeps } from "../../src/prospect/pipeline.js";
import type { SendAuditEmailResult } from "../../src/prospect/email.js";

let emailOverride: "actual" | "throw" | SendAuditEmailResult = "actual";

// Hoisted above every import (vi.mock semantics), so this is active before
// runProspectAuditCommand's own dynamic `await import("../../prospect/email.js")`
// ever resolves — same reasoning prospect-audit-persistence.test.ts documents
// for its db/prospect-audits.js mock.
vi.mock("../../src/prospect/email.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/prospect/email.js")>();
  return {
    ...actual,
    sendAuditEmail: vi.fn(async (...args: Parameters<typeof actual.sendAuditEmail>) => {
      if (emailOverride === "throw") throw new Error("simulated resend outage");
      if (emailOverride !== "actual") return emailOverride;
      return actual.sendAuditEmail(...args);
    }),
  };
});

const ORIGINAL_ENV = { ...process.env };

/** Same offline crawl/analyze/lighthouse stubs the sibling prospect-audit test
 *  files use, trimmed to what this file needs. */
function stubDeps(): PipelineDeps {
  return {
    crawl: {
      async fetchUrl(url: string) {
        if (url === "https://acme.example/")
          return {
            status: 200,
            body: "<html><head><title>Acme</title></head><body><h1>Acme</h1><p>Roofing in Boise.</p></body></html>",
            headers: {},
          };
        return { status: 404, body: "", headers: {} };
      },
      async renderPages() {
        return new Map<string, string>();
      },
      maxPages: 2,
      delayMs: 0,
    },
    analyze: {
      run: async () => ({
        businessName: "Acme Roofing",
        business: "A residential roofing company operating in Boise, Idaho.",
        entityClarity: { score: 50, missing: [] },
        categoryQueries: [
          "roof repair contractor Boise",
          "roof replacement cost",
          "flat roof repair Idaho",
        ],
        buyerQuestions: [
          { question: "cost?", answered: "no", quotable: false, page: null, evidence: null },
        ],
        fixes: [],
        narrative: { findability: "a", readability: "b", answers: "c" },
      }),
    },
    lighthouse: async () => {
      throw new Error("skipped in test");
    },
    probeDelayMs: 0,
  };
}

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  emailOverride = "actual";
  vi.clearAllMocks();
});

describe("prospect-audit CLI — --email", () => {
  it("without --email, never attempts a send", async () => {
    process.env.TURSO_DATABASE_URL = ":memory:";
    process.env.PROSPECT_AUDIT_RECIPIENTS = "tucker@reddoorla.com";
    const { sendAuditEmail } = await import("../../src/prospect/email.js");
    const { code } = await runProspectAuditCommand("https://acme.example/", {
      probes: false,
      deps: stubDeps(),
    });
    expect(code).toBe(0);
    expect(sendAuditEmail).not.toHaveBeenCalled();
  });

  it("with --email but PROSPECT_AUDIT_RECIPIENTS unset, warns instead of crashing and keeps the audit delivered", async () => {
    process.env.TURSO_DATABASE_URL = ":memory:";
    delete process.env.PROSPECT_AUDIT_RECIPIENTS;
    const { output, code } = await runProspectAuditCommand("https://acme.example/", {
      probes: false,
      email: true,
      json: true,
      deps: stubDeps(),
    });
    // The report is still fully delivered (a real Turso link) — a missing
    // recipients var must not touch delivery success.
    expect(code).toBe(0);
    const payload = JSON.parse(output) as {
      link: string | null;
      warnings: string[];
      email: SendAuditEmailResult | null;
    };
    expect(payload.link).toMatch(/\/audit\/[A-Za-z0-9_-]{22}$/);
    expect(payload.email).toEqual({
      sent: false,
      reason: "no recipients configured (PROSPECT_AUDIT_RECIPIENTS is unset or empty)",
    });
    expect(payload.warnings.some((w) => /email/i.test(w) && /recipient/i.test(w))).toBe(true);
  });

  it("a throwing send is a warning, not a crash — exit code and persistence are unaffected", async () => {
    process.env.TURSO_DATABASE_URL = ":memory:";
    process.env.PROSPECT_AUDIT_RECIPIENTS = "tucker@reddoorla.com";
    emailOverride = "throw";
    const { output, code } = await runProspectAuditCommand("https://acme.example/", {
      probes: false,
      email: true,
      json: true,
      deps: stubDeps(),
    });
    expect(code).toBe(0);
    const payload = JSON.parse(output) as {
      link: string | null;
      warnings: string[];
      email: SendAuditEmailResult | null;
    };
    // The audit is still persisted (a real link) despite the email failure.
    expect(payload.link).toMatch(/\/audit\/[A-Za-z0-9_-]{22}$/);
    expect(payload.email).toBeNull();
    expect(
      payload.warnings.some((w) => /email/i.test(w) && /simulated resend outage/.test(w)),
    ).toBe(true);
  });

  it("a successful send is reflected in both the JSON payload and the text summary", async () => {
    process.env.TURSO_DATABASE_URL = ":memory:";
    process.env.PROSPECT_AUDIT_RECIPIENTS = "tucker@reddoorla.com, tim@reddoorla.com";
    emailOverride = {
      sent: true,
      messageId: "msg_stub_123",
      recipients: ["tucker@reddoorla.com", "tim@reddoorla.com"],
    };
    const jsonRun = await runProspectAuditCommand("https://acme.example/", {
      probes: false,
      email: true,
      json: true,
      deps: stubDeps(),
    });
    expect(jsonRun.code).toBe(0);
    const payload = JSON.parse(jsonRun.output) as { email: SendAuditEmailResult | null };
    expect(payload.email).toEqual(emailOverride);

    const textRun = await runProspectAuditCommand("https://acme.example/", {
      probes: false,
      email: true,
      deps: stubDeps(),
    });
    expect(textRun.output).toContain("Emailed to tucker@reddoorla.com, tim@reddoorla.com");
    expect(textRun.output).toContain("msg_stub_123");
  });

  it("still persists the audit and returns code 0 when the email step is skipped by an unrelated --out failure elsewhere", async () => {
    // Sanity: --email doesn't interfere with the pre-existing --out/persist
    // independence (a bad --out path must not block the email attempt, nor
    // vice versa).
    process.env.TURSO_DATABASE_URL = ":memory:";
    process.env.PROSPECT_AUDIT_RECIPIENTS = "tucker@reddoorla.com";
    emailOverride = { sent: true, messageId: "msg_ok", recipients: ["tucker@reddoorla.com"] };
    const { output, code } = await runProspectAuditCommand("https://acme.example/", {
      probes: false,
      email: true,
      out: "/nonexistent-dir-xyz/out.html",
      json: true,
      deps: stubDeps(),
    });
    expect(code).toBe(0);
    const payload = JSON.parse(output) as {
      link: string | null;
      email: SendAuditEmailResult | null;
    };
    expect(payload.link).toMatch(/\/audit\/[A-Za-z0-9_-]{22}$/);
    expect(payload.email).toEqual(emailOverride);
  });
});
