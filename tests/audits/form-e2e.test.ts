import { describe, it, expect, vi, afterEach } from "vitest";
import {
  formE2eAudit,
  declaresTestModeForwarding,
  findFormPath,
  isSameSitePost,
  noBannerDetail,
  CONTACT_PATHS,
  BUDGET_WARN_RATIO,
  TESTMODE_SKIPPED_WORK_MS,
  isIngestBudgetThin,
  projectRealSubmissionMs,
  type FormRunner,
  type FormProbePage,
} from "../../src/audits/form-e2e.js";
import { INGEST_TIMEOUT_MS } from "../../src/forms/client.js";

const NOW = new Date("2026-07-06T00:00:00.000Z");
const site = { path: "/tmp/acme", name: "acme", deployedUrl: "https://acme.example.com" };

function runner(over: Partial<FormRunner> = {}): FormRunner {
  return {
    submit: async () => ({ formPresent: true, success: true }),
    ...over,
  };
}

describe("audits/form-e2e", () => {
  it("skips (no details) a site with no deployed URL", async () => {
    const r = await formE2eAudit({ site: { path: "/tmp/acme", name: "acme" }, now: NOW });
    expect(r.status).toBe("skip");
    expect(r.details).toBeUndefined();
  });

  it("skips (no details) a deployed site when no runner is injected and the live gate is off", async () => {
    const originalEnv = process.env.REDDOOR_FORM_E2E_LIVE;
    delete process.env.REDDOOR_FORM_E2E_LIVE;
    try {
      const r = await formE2eAudit({ site, now: NOW });
      expect(r.status).toBe("skip");
      expect(r.details).toBeUndefined();
      expect(r.summary).toMatch(/live form-e2e disabled/);
      expect(r.summary).toMatch(/REDDOOR_FORM_E2E_LIVE/);
    } finally {
      if (originalEnv === undefined) delete process.env.REDDOOR_FORM_E2E_LIVE;
      else process.env.REDDOOR_FORM_E2E_LIVE = originalEnv;
    }
  });

  it("does NOT consult the live gate when a formRunner is injected (tests always run)", async () => {
    const originalEnv = process.env.REDDOOR_FORM_E2E_LIVE;
    delete process.env.REDDOOR_FORM_E2E_LIVE;
    try {
      const r = await formE2eAudit({ site, now: NOW, formRunner: runner() });
      expect(r.status).toBe("pass");
    } finally {
      if (originalEnv === undefined) delete process.env.REDDOOR_FORM_E2E_LIVE;
      else process.env.REDDOOR_FORM_E2E_LIVE = originalEnv;
    }
  });

  it("passes when the synthetic submission succeeds", async () => {
    const r = await formE2eAudit({ site, now: NOW, formRunner: runner() });
    expect(r.status).toBe("pass");
    expect(r.details).toEqual({ ok: "pass", formPresent: true, checkedAt: NOW.toISOString() });
  });

  it("warns + records ok:fail when the submission does not succeed", async () => {
    const r = await formE2eAudit({
      site,
      now: NOW,
      formRunner: runner({
        submit: async () => ({ formPresent: true, success: false, detail: "no success banner" }),
      }),
    });
    expect(r.status).toBe("warn");
    expect(r.details).toMatchObject({ ok: "fail", formPresent: true });
    expect(r.summary).toMatch(/no success banner/);
  });

  it("records n/a (ok:null + fresh checkedAt) when the site has no contact form", async () => {
    const r = await formE2eAudit({
      site,
      now: NOW,
      formRunner: runner({ submit: async () => ({ formPresent: false }) }),
    });
    // Skip STATUS (nothing to assert on the CLI), but WITH details so the writer
    // persists the n/a signal: null verdict + fresh checkedAt (Plan 4 reads that as n/a).
    expect(r.status).toBe("skip");
    expect(r.details).toEqual({ ok: null, formPresent: false, checkedAt: NOW.toISOString() });
  });

  it("skips (no details) when the runner reports the site does not declare testMode forwarding", async () => {
    const r = await formE2eAudit({
      site,
      now: NOW,
      formRunner: runner({ submit: async () => ({ testModeUndeclared: true }) }),
    });
    // Plain skip, NO details: this is "not yet rolled out here", not n/a — the
    // prior verdict (or unknown) must be preserved, never overwritten.
    expect(r.status).toBe("skip");
    expect(r.details).toBeUndefined();
    expect(r.summary).toMatch(/does not declare/);
    expect(r.summary).toMatch(/testMode/);
  });

  describe("the Turnstile widget verdict (#689)", () => {
    /** Run the audit against a fake runner reporting one widget observation. */
    async function verdictFor(
      extra: Record<string, unknown>,
    ): Promise<"pass" | "fail" | null | undefined> {
      const r = await formE2eAudit({
        site,
        now: NOW,
        formRunner: {
          submit: async () => ({ formPresent: true, success: true, ...extra }),
        },
      });
      return (r.details as { turnstileWidget?: "pass" | "fail" | null } | undefined)
        ?.turnstileWidget;
    }

    it("earns the pass only from a browser that saw the real widget un-rejected", async () => {
      expect(
        await verdictFor({
          formsHealth: { testMode: true, turnstile: true },
          turnstile: { rendered: true, hostnameRejected: false },
        }),
      ).toBe("pass");
    });

    it("fails on 110200 — the hostname is not on the widget's allowlist", async () => {
      // The state that silently loses 100% of leads on a Require Turnstile site,
      // and the one thing nothing in the fleet observed before this change.
      expect(
        await verdictFor({
          formsHealth: { testMode: true, turnstile: true },
          turnstile: { rendered: false, hostnameRejected: true },
        }),
      ).toBe("fail");
    });

    it("fails when the deployed site has no sitekey at all", async () => {
      expect(
        await verdictFor({
          formsHealth: { testMode: true, turnstile: false },
          turnstile: { rendered: false, hostnameRejected: false },
        }),
      ).toBe("fail");
    });

    it("clears to null when a key is set but no widget was on the page", async () => {
      expect(
        await verdictFor({
          formsHealth: { testMode: true, turnstile: true },
          turnstile: { rendered: false, hostnameRejected: false },
        }),
      ).toBeNull();
    });

    it("OMITS the key entirely when the runner observed nothing — preserve, not clear", async () => {
      // A runner older than this change, or an injected fake. Absent means "no
      // opinion" and leaves the existing verdict alone; null would CLEAR it. The
      // two must never collapse, or a probe that cannot see Turnstile erases a
      // real verdict.
      expect(await verdictFor({})).toBeUndefined();
      const r = await formE2eAudit({
        site,
        now: NOW,
        formRunner: { submit: async () => ({ formPresent: true, success: true }) },
      });
      expect(Object.keys(r.details as object)).not.toContain("turnstileWidget");
    });

    it("never lets a Turnstile observation change the FORM verdict", async () => {
      // The form probe's own pass/fail is what the health gate reads. A broken
      // widget is a Turnstile problem, not a form problem, and must not red it.
      const r = await formE2eAudit({
        site,
        now: NOW,
        formRunner: {
          submit: async () => ({
            formPresent: true,
            success: true,
            formsHealth: { testMode: true, turnstile: true },
            turnstile: { rendered: true, hostnameRejected: true },
          }),
        },
      });
      const d = r.details as { ok: string; turnstileWidget: string };
      expect(d.ok).toBe("pass");
      expect(d.turnstileWidget).toBe("fail");
      expect(r.status).not.toBe("fail");
    });
  });

  it("passes the CF public test sitekey + testMode marker to the runner", async () => {
    let seen: { baseUrl: string; testMode: boolean; testSitekey: string } | undefined;
    await formE2eAudit({
      site,
      now: NOW,
      formRunner: {
        submit: async (opts) => {
          seen = opts;
          return { formPresent: true, success: true };
        },
      },
    });
    expect(seen).toEqual({
      baseUrl: "https://acme.example.com",
      testMode: true,
      testSitekey: "1x00000000000000000000AA",
    });
  });
});

describe("audits/form-e2e findFormPath", () => {
  /** Fake page: `routes` maps a pathname to what that route renders. Absent ⇒ 404. */
  function page(routes: Record<string, { forms: number; emails: number }>): {
    probe: FormProbePage;
    visited: string[];
  } {
    const visited: string[] = [];
    let current: { forms: number; emails: number } | null = null;
    const probe: FormProbePage = {
      goto: async (url) => {
        visited.push(new URL(url).pathname);
        current = routes[new URL(url).pathname] ?? null;
        return current ? { ok: () => true } : { ok: () => false };
      },
      locator: (selector) => ({
        count: async () => {
          if (!current) return 0;
          return selector === "form" ? current.forms : current.emails;
        },
      }),
    };
    return { probe, visited };
  }

  const FORM = { forms: 1, emails: 1 };

  it("prefers /contact and does not probe further once it finds a form", async () => {
    const { probe, visited } = page({ "/contact": FORM, "/": FORM });
    await expect(findFormPath(probe, "https://acme.example.com")).resolves.toBe(
      "https://acme.example.com/contact",
    );
    expect(visited).toEqual(["/contact"]);
  });

  it("falls back to the homepage when /contact 404s (the one-page-site case)", async () => {
    const { probe, visited } = page({ "/": FORM });
    await expect(findFormPath(probe, "https://1836dig.com/")).resolves.toBe("https://1836dig.com/");
    expect(visited).toEqual(["/contact", "/"]);
  });

  it("falls back when /contact renders but carries no form", async () => {
    const { probe } = page({ "/contact": { forms: 0, emails: 0 }, "/": FORM });
    await expect(findFormPath(probe, "https://acme.example.com")).resolves.toBe(
      "https://acme.example.com/",
    );
  });

  it("rejects a form with no email field — that is not a contact form", async () => {
    const { probe } = page({ "/contact": { forms: 1, emails: 0 } });
    await expect(findFormPath(probe, "https://acme.example.com")).resolves.toBeNull();
  });

  it("returns null when no candidate route has a form (n/a, not a failure)", async () => {
    const { probe, visited } = page({});
    await expect(findFormPath(probe, "https://acme.example.com")).resolves.toBeNull();
    expect(visited).toEqual([...CONTACT_PATHS]);
  });

  it("treats a navigation throw as a miss and keeps probing", async () => {
    const visited: string[] = [];
    const probe: FormProbePage = {
      goto: async (url) => {
        const p = new URL(url).pathname;
        visited.push(p);
        if (p === "/contact") throw new Error("ERR_CONNECTION_REFUSED");
        return { ok: () => true };
      },
      locator: () => ({ count: async () => 1 }),
    };
    await expect(findFormPath(probe, "https://acme.example.com")).resolves.toBe(
      "https://acme.example.com/",
    );
    expect(visited).toEqual(["/contact", "/"]);
  });
});

describe("audits/form-e2e declaresTestModeForwarding", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubHealth(response: { ok: boolean; body?: unknown } | "throw") {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: URL | string) => {
        expect(String(url)).toBe("https://acme.example.com/health");
        if (response === "throw") throw new Error("network down");
        return {
          ok: response.ok,
          json: async () => response.body,
        } as Response;
      }),
    );
  }

  it("true only when /health declares forms.testMode === true", async () => {
    stubHealth({ ok: true, body: { ok: true, forms: { ingestUrl: true, testMode: true } } });
    expect(await declaresTestModeForwarding("https://acme.example.com")).toBe(true);
  });

  it("false when the flag is absent (a rolled-out /health without forwarding)", async () => {
    stubHealth({ ok: true, body: { ok: true, forms: { ingestUrl: true, ingestToken: true } } });
    expect(await declaresTestModeForwarding("https://acme.example.com")).toBe(false);
  });

  it('false when the flag is a non-boolean truthy (string "true" is NOT a declaration)', async () => {
    stubHealth({ ok: true, body: { forms: { testMode: "true" } } });
    expect(await declaresTestModeForwarding("https://acme.example.com")).toBe(false);
  });

  it("false (fail-closed) on a non-2xx /health", async () => {
    stubHealth({ ok: false, body: {} });
    expect(await declaresTestModeForwarding("https://acme.example.com")).toBe(false);
  });

  it("false (fail-closed) when the fetch throws", async () => {
    stubHealth("throw");
    expect(await declaresTestModeForwarding("https://acme.example.com")).toBe(false);
  });

  it("false (fail-closed) on a non-object body", async () => {
    stubHealth({ ok: true, body: "ok" });
    expect(await declaresTestModeForwarding("https://acme.example.com")).toBe(false);
  });
});

describe("audits/form-e2e ingest budget headroom", () => {
  /** A successful run with both spans stamped. `postElapsedMs` (click → POST
   *  response, the span `INGEST_TIMEOUT_MS` actually governs) defaults to the
   *  click→banner span, since post ≤ banner in any real run. */
  const timed = (elapsedMs: number, postElapsedMs: number = elapsedMs): FormRunner => ({
    submit: async () => ({ formPresent: true, success: true, elapsedMs, postElapsedMs }),
  });

  it("projects the sink work a testMode probe never reaches", () => {
    // A testMode submission short-circuits in ingestSubmission before the
    // classifier, the insert, the Resend call and the stamp, so the probe's own
    // elapsed time is a LOWER BOUND on what a real submission costs.
    expect(projectRealSubmissionMs(4_000)).toBe(4_000 + TESTMODE_SKIPPED_WORK_MS);
  });

  it("passes a submission that leaves real headroom", async () => {
    const r = await formE2eAudit({ site, now: NOW, formRunner: timed(1_500) });
    expect(r.status).toBe("pass");
    expect(r.summary).not.toMatch(/BUDGET_THIN/);
  });

  it("warns when the projected real submission eats the abort budget", async () => {
    const thin = INGEST_TIMEOUT_MS * BUDGET_WARN_RATIO - TESTMODE_SKIPPED_WORK_MS + 500;
    const r = await formE2eAudit({ site, now: NOW, formRunner: timed(thin) });
    expect(r.status).toBe("warn");
    expect(r.summary).toMatch(/BUDGET_THIN/);
    // …but the form DOES work, so the persisted cockpit verdict stays "pass".
    // Flipping it to "fail" would report a working form as broken.
    expect(r.details).toEqual({ ok: "pass", formPresent: true, checkedAt: NOW.toISOString() });
  });

  it("leaves the verdict alone when the runner reports no timing", async () => {
    // Injected fakes and any runner predating the measurement omit elapsedMs;
    // absent timing must never manufacture a warn.
    const r = await formE2eAudit({ site, now: NOW, formRunner: runner() });
    expect(r.status).toBe("pass");
    expect(r.summary).not.toMatch(/BUDGET_THIN/);
  });

  it("does NOT warn when only click→banner is slow — the budget governs the POST", async () => {
    // THE OVER-WARN THIS BRANCH FIXES. 2026-08-17: vineyard-custom-homes warned at
    // 16.9s click→banner while its own function answered in 0.25s warm / 2.0s cold.
    // `INGEST_TIMEOUT_MS` aborts the site→central fetch (inside the POST) and
    // nothing else — Turnstile's token round-trip and the browser's render of the
    // banner are outside it, so a slow banner is not abort risk and must not warn.
    const slowBanner = 30_000; // would trip the old elapsedMs-keyed check outright
    const fastPost = 1_000;
    const r = await formE2eAudit({ site, now: NOW, formRunner: timed(slowBanner, fastPost) });
    expect(r.status).toBe("pass");
    expect(r.summary).not.toMatch(/BUDGET_THIN/);
  });

  it("does NOT fall back to elapsedMs when no POST was observed", async () => {
    // No POST span → no claim about the abort budget, however slow the banner was.
    // Falling back to click→banner would quietly reintroduce the over-warn for
    // exactly the runs where attribution is least knowable.
    const noPost: FormRunner = {
      submit: async () => ({ formPresent: true, success: true, elapsedMs: 30_000 }),
    };
    const r = await formE2eAudit({ site, now: NOW, formRunner: noPost });
    expect(r.status).toBe("pass");
    expect(r.summary).not.toMatch(/BUDGET_THIN/);
  });

  it("still warns when the POST span itself is thin", async () => {
    // The counterweight to the two tests above: keying on the POST must not
    // un-arm the check. A genuinely slow POST is exactly the 1836dig failure
    // mode and still warns, with the POST span (not the banner span) reported.
    const thinPost = INGEST_TIMEOUT_MS * BUDGET_WARN_RATIO - TESTMODE_SKIPPED_WORK_MS + 500;
    const r = await formE2eAudit({
      site,
      now: NOW,
      formRunner: timed(thinPost + 4_000, thinPost),
    });
    expect(r.status).toBe("warn");
    expect(r.summary).toMatch(/BUDGET_THIN/);
    expect(r.summary).toContain(`probe ${(thinPost / 1000).toFixed(1)}s`);
  });

  it("would have caught the 1836dig regression the pass/fail verdict missed", () => {
    // 2026-08-03: real submissions ran ~5-7s against an 8s budget and were
    // reported to visitors as failures, while this audit recorded a clean pass
    // (its testMode path skipped the slow work). A ~5s probe against that
    // budget is thin; against the 20s budget that replaced it, it is not.
    expect(isIngestBudgetThin(5_000, 8_000)).toBe(true);
    expect(isIngestBudgetThin(5_000, 20_000)).toBe(false);
  });
});

describe("audits/form-e2e isSameSitePost", () => {
  const base = "https://acme.example.com";

  it("rejects the two third-party POSTs that polluted the 2026-08-31 warn lines", () => {
    // The nightly reported "POST 204" (Google Analytics' collect beacon) and
    // "POST 200" (Cloudflare Turnstile telemetry) as if they were the form
    // action's response — both must never be mistaken for the site's own POST.
    expect(isSameSitePost("https://www.google-analytics.com/g/collect?v=2", base)).toBe(false);
    expect(
      isSameSitePost("https://challenges.cloudflare.com/cdn-cgi/challenge-platform/h/b/fo/x", base),
    ).toBe(false);
  });

  it("accepts the site's own action POST", () => {
    expect(isSameSitePost("https://acme.example.com/contact?/default", base)).toBe(true);
  });

  it("treats www and apex as the same site, in both directions", () => {
    // beachfront-dentistry is probed at www. but its action lands on the apex.
    expect(
      isSameSitePost(
        "https://beachfrontdentistry.com/contact-us",
        "https://www.beachfrontdentistry.com/",
      ),
    ).toBe(true);
    expect(isSameSitePost("https://www.acme.example.com/contact", base)).toBe(true);
  });

  it("rejects a sibling subdomain — that is not the form action", () => {
    expect(isSameSitePost("https://api.acme.example.com/collect", base)).toBe(false);
  });

  it("false on an unparseable URL", () => {
    expect(isSameSitePost("not a url", base)).toBe(false);
  });
});

describe("audits/form-e2e noBannerDetail", () => {
  const clean = {
    post: null,
    alertText: null,
    formState: null,
    hydrationMismatch: false,
    refilled: false,
  };

  it("names a submission that never left the page — the 2026-08-31 reddoor signature", () => {
    const d = noBannerDetail({
      ...clean,
      formState: { formPresent: true, checkValidity: false, emptyRequired: ["name", "email"] },
      hydrationMismatch: true,
    });
    expect(d).toMatch(/^no success banner after submit — /);
    expect(d).toMatch(/no same-site POST/);
    expect(d).toMatch(/never left the page/);
    expect(d).toMatch(/empty required: name, email/);
    expect(d).toMatch(/hydration mismatch/);
  });

  it("reports the same-site POST status when one WAS observed", () => {
    const d = noBannerDetail({ ...clean, post: { status: 200 } });
    expect(d).toContain("POST 200");
    expect(d).not.toMatch(/never left the page/);
  });

  it("appends the response body only on an error status", () => {
    expect(noBannerDetail({ ...clean, post: { status: 502, bodyBit: "upstream sad" } })).toContain(
      "POST 502 upstream sad",
    );
    // A 2xx body says nothing about why the banner is missing — keep the line short.
    expect(noBannerDetail({ ...clean, post: { status: 200, bodyBit: "ignored" } })).not.toContain(
      "ignored",
    );
  });

  it("includes the visible alert text when the site rendered an error", () => {
    const d = noBannerDetail({ ...clean, post: { status: 200 }, alertText: "  Something broke  " });
    expect(d).toContain("alert: Something broke");
  });

  it("says so when the form itself is gone (a navigation or teardown ate it)", () => {
    const d = noBannerDetail({
      ...clean,
      formState: { formPresent: false, checkValidity: null, emptyRequired: [] },
    });
    expect(d).toMatch(/form is gone/);
  });

  it("flags a validation failure even when no required field is empty (pattern mismatch)", () => {
    const d = noBannerDetail({
      ...clean,
      post: null,
      formState: { formPresent: true, checkValidity: false, emptyRequired: [] },
    });
    expect(d).toMatch(/fails validation/);
  });

  it("notes a refill that happened but still did not save the run", () => {
    const d = noBannerDetail({ ...clean, refilled: true });
    expect(d).toMatch(/re-filled/);
  });
});

describe("audits/form-e2e refill surfacing", () => {
  it("appends the wipe evidence to a PASSING summary — production proof the race exists", async () => {
    const r = await formE2eAudit({
      site,
      now: NOW,
      formRunner: runner({
        submit: async () => ({ formPresent: true, success: true, refilled: true }),
      }),
    });
    expect(r.status).toBe("pass");
    expect(r.summary).toMatch(/re-filled/);
    // The verdict and persisted details stay a clean pass — the form works.
    expect(r.details).toEqual({ ok: "pass", formPresent: true, checkedAt: NOW.toISOString() });
  });

  it("keeps a plain pass summary when nothing was wiped", async () => {
    const r = await formE2eAudit({ site, now: NOW, formRunner: runner() });
    expect(r.summary).not.toMatch(/re-filled/);
  });
});
