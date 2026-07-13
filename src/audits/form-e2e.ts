import type { AuditResult } from "../types.js";
import type { AuditContext } from "./util/inject.js";
import { siteLabel } from "../util/site.js";

/** Cloudflare's PUBLIC test sitekey — always issues a passing client token with no
 *  real challenge, so the probe can satisfy a site's Turnstile widget without any
 *  secret. The central `testMode` ingest branch (src/forms/ingest.ts, health-gate
 *  plan3 Task 5) skips Turnstile enforcement for testMode submissions, making the
 *  token's validity moot — it exists to get past the CLIENT widget only. */
export const CF_TEST_SITEKEY = "1x00000000000000000000AA";

/** The canonical starter contact route. Sites built from reddoor-starter serve the
 *  form here; route discovery for bespoke paths is a follow-up (see Open items). */
const CONTACT_PATH = "/contact";

/** Persisted form-e2e verdict. `ok` is the single-select value: "pass"/"fail" when a
 *  form was found + submitted; null when NO contact form exists (n/a — paired with a
 *  fresh checkedAt so the writer stores "checked, no form" distinctly from "never ran"). */
export type FormE2eDetails = {
  ok: "pass" | "fail" | null;
  formPresent: boolean;
  checkedAt: string;
};

/** Outcome of driving one site's contact form. `formPresent:false` ⇒ n/a
 *  (persisted). `testModeUndeclared` ⇒ the site's /health does not declare
 *  `forms.testMode`, so the probe refused to submit — a plain skip, prior
 *  verdict preserved. */
export type FormSubmitOutcome =
  | { formPresent: false }
  | { formPresent: true; success: boolean; detail?: string }
  | { testModeUndeclared: true };

/** Injected browser IO. The real impl drives Playwright; tests pass a fake. */
export type FormRunner = {
  submit: (opts: {
    baseUrl: string;
    testMode: boolean;
    testSitekey: string;
  }) => Promise<FormSubmitOutcome>;
  close?: () => Promise<void>;
};

/** Opt-in gate for the live Playwright fallback. `defaultFormRunner` drives a REAL
 *  browser against `site.deployedUrl` and submits the REAL production contact form.
 *  Both central prerequisites HAVE landed: ingest's `testMode` short-circuit
 *  (health-gate plan3 Task 5, `src/forms/ingest.ts`) and the starter's
 *  `buildPayload` forwarding (Task 6, `reddoor-starter/src/routes/contact/
 *  +page.server.ts`). But forwarding is PER-SITE — a site built before Task 6
 *  ignores the injected marker and would deliver the probe as a REAL lead. Two
 *  layers keep that impossible: (1) this env gate keeps the runner inert in any
 *  unfiltered `runAudits` call (e.g. the `init` recipe's final step) unless the
 *  operator/producer explicitly arms it (`REDDOOR_FORM_E2E_LIVE=1` — the nightly
 *  fleet-form-e2e workflow does); (2) even armed, the runner preflights the
 *  site's /health and refuses to submit unless it DECLARES `forms.testMode`
 *  (see `declaresTestModeForwarding`) — the declaration ships in the same deploy
 *  as the forwarding, so it is always truthful. */
const LIVE_ENV_VAR = "REDDOOR_FORM_E2E_LIVE";

function liveRunnerEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[LIVE_ENV_VAR] === "1" || env[LIVE_ENV_VAR] === "true";
}

/**
 * Submit the REAL production contact form against `site.deployedUrl` in test-mode
 * and reduce the outcome to a verdict. Checkout-free (drives the deployed URL, like
 * browser.ts). The submission carries a `testMode` marker that central ingest is
 * INTENDED to recognize and route away from every real sink (no inbox/DB/webhook,
 * Turnstile enforcement bypassed) once that branch exists — see `liveRunnerEnabled`
 * above for why the live Playwright fallback stays gated off until then. Tests that
 * inject `ctx.formRunner` bypass the gate entirely (it only guards the real,
 * dynamically-imported Playwright runner).
 *
 * - no deployedUrl → skip, NO details → writer preserves the prior verdict.
 * - no injected runner + live gate off → skip, NO details (not yet safe to run live).
 * - no contact form → skip WITH details (ok:null + fresh checkedAt) → persisted as n/a.
 * - form submitted, success → pass (ok:"pass"); not success → warn (ok:"fail").
 */
export async function formE2eAudit(ctx: AuditContext): Promise<AuditResult> {
  const { site } = ctx;
  const label = siteLabel(site);
  if (!site.deployedUrl) {
    return { audit: "form-e2e", site: label, status: "skip", summary: "no deployed URL" };
  }
  if (!ctx.formRunner && !liveRunnerEnabled()) {
    return {
      audit: "form-e2e",
      site: label,
      status: "skip",
      summary:
        "live form-e2e disabled (central testMode ingest suppression not yet wired — " +
        `set ${LIVE_ENV_VAR}=1 once it is)`,
    };
  }
  const now = ctx.now ?? new Date();
  const checkedAt = now.toISOString();
  const runner = ctx.formRunner ?? (await defaultFormRunner());
  try {
    const outcome = await runner.submit({
      baseUrl: site.deployedUrl,
      testMode: true,
      testSitekey: CF_TEST_SITEKEY,
    });
    if ("testModeUndeclared" in outcome) {
      // Not n/a — the site may well have a form; it just hasn't rolled out
      // testMode forwarding, so probing it would submit a real lead. Plain
      // skip with NO details preserves the prior verdict.
      return {
        audit: "form-e2e",
        site: label,
        status: "skip",
        summary:
          "site /health does not declare forms.testMode — probe refused " +
          "(testMode forwarding not yet rolled out here)",
      };
    }
    if (!outcome.formPresent) {
      return {
        audit: "form-e2e",
        site: label,
        status: "skip",
        summary: "no contact form (n/a)",
        details: { ok: null, formPresent: false, checkedAt } satisfies FormE2eDetails,
      };
    }
    const ok: "pass" | "fail" = outcome.success ? "pass" : "fail";
    return {
      audit: "form-e2e",
      site: label,
      status: outcome.success ? "pass" : "warn",
      summary: outcome.success
        ? "form-e2e: synthetic submission succeeded"
        : `form-e2e: synthetic submission failed${outcome.detail ? ` — ${outcome.detail}` : ""}`,
      details: { ok, formPresent: true, checkedAt } satisfies FormE2eDetails,
    };
  } finally {
    await runner.close?.();
  }
}

/** Minimum plausible fill time the site's bot-timing screen enforces (client.ts
 *  MIN_FILL_MS = 800). A too-fast submit is silently dropped (success shown, ingest
 *  never reached), so the probe waits past this before submitting. */
const FILL_SETTLE_MS = 1200;
const PAGE_TIMEOUT_MS = 30_000;
const HEALTH_TIMEOUT_MS = 10_000;

/**
 * GET `{baseUrl}/health` and report whether the site DECLARES that its contact
 * form forwards the `testMode` marker (`forms.testMode === true`, strict
 * boolean). The starter sets the flag in the same deploy whose `buildPayload`
 * forwards the marker, so a declaration is proof the injected field round-trips
 * to central ingest's short-circuit instead of landing as a real lead.
 * Fail-closed: unreachable /health, non-2xx, unparseable body, or a missing/
 * non-boolean flag all return false — the probe then refuses to submit.
 */
export async function declaresTestModeForwarding(baseUrl: string): Promise<boolean> {
  try {
    const res = await fetch(new URL("/health", baseUrl), {
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
    });
    if (!res.ok) return false;
    const body: unknown = await res.json();
    if (typeof body !== "object" || body === null) return false;
    const forms = (body as Record<string, unknown>).forms;
    if (typeof forms !== "object" || forms === null) return false;
    return (forms as Record<string, unknown>).testMode === true;
  } catch {
    return false;
  }
}

/**
 * Real Playwright form runner. Lazily imports @playwright/test so unit tests (which
 * inject a fake runner) never load it — and so the audit's static import graph stays
 * central-dep-free for `test:dist`. Every failure degrades to `success:false` (never
 * throws past the audit), so a flaky run yields a non-pass (box stays manual), not a
 * false green.
 */
export async function defaultFormRunner(): Promise<FormRunner> {
  const { chromium } = await import("@playwright/test");
  return {
    async submit({ baseUrl, testSitekey }) {
      // Per-site safety preflight — refuse before a browser even launches.
      if (!(await declaresTestModeForwarding(baseUrl))) {
        return { testModeUndeclared: true };
      }
      const browser = await chromium.launch();
      try {
        const ctx = await browser.newContext();
        const page = await ctx.newPage();
        const url = new URL(CONTACT_PATH, baseUrl).toString();
        const resp = await page
          .goto(url, { waitUntil: "domcontentloaded", timeout: PAGE_TIMEOUT_MS })
          .catch(() => null);
        // No page, non-2xx, or no <form> with the expected fields ⇒ no contact form (n/a).
        const form = page.locator("form").first();
        const hasForm =
          !!resp &&
          resp.ok() &&
          (await form.count().catch(() => 0)) > 0 &&
          (await page
            .locator('input[name="email"], input[type="email"]')
            .count()
            .catch(() => 0)) > 0;
        if (!hasForm) return { formPresent: false };

        await page.fill('[name="name"]', "Reddoor Monitor").catch(() => {});
        await page.fill('[name="email"]', "monitor+e2e@reddoorla.com").catch(() => {});
        await page.fill('[name="phone"]', "5555550123").catch(() => {});
        await page
          .fill('[name="message"]', "Synthetic end-to-end health check — please ignore.")
          .catch(() => {});

        // Inject the testMode marker + a Turnstile token into the submitted form.
        // The site declared forwarding (preflight above), so the marker routes the
        // submission away from every real sink via central ingest's testMode
        // short-circuit; that branch also skips Turnstile enforcement, making the
        // token's value inconsequential — the CF public test sitekey documents the
        // zero-secret path past the client widget. String-form evaluate
        // (mirrors browser.ts) so the browser-context code isn't type-checked
        // against the Node lib (no DOM globals in this project's tsconfig). The
        // token value is a hardcoded constant (never user input), so inlining it
        // via JSON.stringify into the expression string is safe.
        await page.evaluate(`
          (function () {
            const f = document.querySelector("form");
            if (!f) return;
            const add = (name, value) => {
              let el = f.querySelector('input[name="' + name + '"]');
              if (!el) {
                el = document.createElement("input");
                el.type = "hidden";
                el.name = name;
                f.appendChild(el);
              }
              el.value = value;
            };
            add("testMode", "true");
            add("cf-turnstile-response", ${JSON.stringify(`testmode-${testSitekey}`)});
          })();
        `);

        // Beat the bot-timing screen, then submit and wait for the success banner
        // (role="status") the starter renders on a successful action.
        await page.waitForTimeout(FILL_SETTLE_MS);
        // Capture the action POST so a failure names the real server response
        // (espada 2026-07-10: three "no success banner" warns were undiagnosable
        // without it — the POST status/alert text is the evidence).
        const postResponse = page
          .waitForResponse((r) => r.request().method() === "POST", {
            timeout: PAGE_TIMEOUT_MS,
          })
          .catch(() => null);
        // Both standard submit controls: reddoor-website uses `<input type="submit">`
        // (its first enrolled run timed out matching button-only and false-failed).
        await page
          .locator('button[type="submit"], input[type="submit"]')
          .first()
          .click({ timeout: PAGE_TIMEOUT_MS });
        const ok = await page
          .locator('[role="status"]')
          .first()
          .waitFor({ state: "visible", timeout: PAGE_TIMEOUT_MS })
          .then(() => true)
          .catch(() => false);
        if (ok) return { formPresent: true, success: true };
        const actionResp = await postResponse;
        const alertText = await page
          .locator('[role="alert"]')
          .first()
          .textContent({ timeout: 1000 })
          .catch(() => null);
        const respBit = actionResp
          ? `POST ${actionResp.status()}${actionResp.status() >= 400 ? ` ${(await actionResp.text().catch(() => "")).slice(0, 80)}` : ""}`
          : "no POST observed";
        return {
          formPresent: true,
          success: false,
          detail: `no success banner after submit — ${respBit}${alertText ? `; alert: ${alertText.trim().slice(0, 80)}` : ""}`,
        };
      } catch (err) {
        return { formPresent: true, success: false, detail: String(err).slice(0, 120) };
      } finally {
        await browser.close().catch(() => {});
      }
    },
  };
}
