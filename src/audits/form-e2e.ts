import type { AuditResult } from "../types.js";
import type { AuditContext } from "./util/inject.js";
import { siteLabel } from "../util/site.js";

/** Cloudflare's PUBLIC test sitekey — always issues a passing client token with no
 *  real challenge, so the probe can satisfy a site's Turnstile widget without any
 *  secret. Once the central `testMode` ingest branch lands (health-gate plan3
 *  Task 5), it will skip Turnstile enforcement for testMode submissions anyway,
 *  making the token's validity moot — but until then, treat this as a live token
 *  that must actually pass. */
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

/** Outcome of driving one site's contact form. `formPresent:false` ⇒ n/a. */
export type FormSubmitOutcome =
  | { formPresent: false }
  | { formPresent: true; success: boolean; detail?: string };

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
 *  browser against `site.deployedUrl` and submits the REAL production contact form;
 *  the `testMode` marker it injects is only safe to send once TWO other things
 *  exist — central ingest's `testMode` short-circuit (health-gate plan3 Task 5,
 *  `src/forms/ingest.ts`) and the starter's `buildPayload` forwarding it (Task 6,
 *  `reddoor-starter/src/routes/contact/+page.server.ts`). Neither has landed yet
 *  (verified: no `testMode` handling anywhere in `src/forms/`). Until they do, a
 *  live run submits fake lead data through the exact path a real visitor uses, with
 *  zero suppression on either end. This audit is wired into the default
 *  registry/checkout-free set and is therefore reachable from any unfiltered
 *  `runAudits` call (e.g. the `init` recipe's final step, or the `audit` CLI without
 *  `--only`) — this gate is what keeps that reachability inert. Flip via
 *  `REDDOOR_FORM_E2E_LIVE=1` only once Tasks 5+6 land. */
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
        // Once the central testMode ingest branch exists, the marker will route the
        // submission away from every real sink and central verify's fail-open +
        // testMode skip will make the token's value inconsequential — the CF public
        // test sitekey documents that intended zero-secret path. Until that branch
        // lands, `liveRunnerEnabled` (see above) keeps this whole runner unreachable
        // by default, so this comment describes the target behavior, not a live
        // guarantee. String-form evaluate
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
        await page.locator('button[type="submit"]').first().click({ timeout: PAGE_TIMEOUT_MS });
        const ok = await page
          .locator('[role="status"]')
          .first()
          .waitFor({ state: "visible", timeout: PAGE_TIMEOUT_MS })
          .then(() => true)
          .catch(() => false);
        return ok
          ? { formPresent: true, success: true }
          : { formPresent: true, success: false, detail: "no success banner after submit" };
      } catch (err) {
        return { formPresent: true, success: false, detail: String(err).slice(0, 120) };
      } finally {
        await browser.close().catch(() => {});
      }
    },
  };
}
