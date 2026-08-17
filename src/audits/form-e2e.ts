import type { AuditResult } from "../types.js";
import type { AuditContext } from "./util/inject.js";
import { siteLabel } from "../util/site.js";
import { INGEST_TIMEOUT_MS } from "../forms/client.js";

/** Cloudflare's PUBLIC test sitekey — always issues a passing client token with no
 *  real challenge, so the probe can satisfy a site's Turnstile widget without any
 *  secret. The central `testMode` ingest branch (src/forms/ingest.ts, health-gate
 *  plan3 Task 5) skips Turnstile enforcement for testMode submissions, making the
 *  token's validity moot — it exists to get past the CLIENT widget only. */
export const CF_TEST_SITEKEY = "1x00000000000000000000AA";

/** Routes probed, in order, for a submittable contact form. `/contact` is the
 *  canonical reddoor-starter route and stays first so the common case still costs a
 *  single navigation. `/` catches one-page sites whose only form lives on the
 *  homepage (1836dig) — before this, `/contact` 404'd there and the site was
 *  silently recorded as "no contact form", so its only conversion path went
 *  unmonitored while the cockpit looked clean. */
export const CONTACT_PATHS: readonly string[] = ["/contact", "/"];

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
 *  verdict preserved. `elapsedMs` times the submit itself (click → success
 *  banner) and feeds the budget-headroom check; absent means "not measured",
 *  which never manufactures a verdict. */
export type FormSubmitOutcome =
  | { formPresent: false }
  | {
      formPresent: true;
      success: boolean;
      detail?: string;
      /** Click → success banner VISIBLE. A user-experience number: it includes the
       *  browser's own render of the banner, which no server budget governs. */
      elapsedMs?: number;
      /** Click → the action's POST response arrives. This is the span the site's
       *  `INGEST_TIMEOUT_MS` abort budget actually governs (it wraps the
       *  site→central fetch, which is nested inside this POST), so it — not
       *  `elapsedMs` — is what the budget check must compare against. Undefined
       *  when no POST was observed. */
      postElapsedMs?: number;
    }
  | { testModeUndeclared: true };

/**
 * Work a REAL submission does that a `testMode` probe never reaches. The marker
 * short-circuits in `ingestSubmission` right after site resolution, BEFORE the
 * spam classifier, the repeat-sender/duplicate scans and the row insert — so a
 * probe's elapsed time is a LOWER BOUND on what a visitor's submission costs,
 * and a green probe says nothing about the rest.
 *
 * That gap is exactly how 1836dig read `Form E2E OK: pass` at 13:24 on
 * 2026-08-03 while real submissions at 18:23 were being reported to the visitor
 * as failures: the probe never paid the sink work that pushed the real call
 * past the site's abort budget.
 *
 * Sized from the live fleet on 2026-08-03: scans ~0.4s + insert ~0.3s. Notify
 * (~0.8s) and the stamp (~0.3s) are NOT counted — `ingestSubmission` now hands
 * that tail to `deps.defer` (the handler's `context.waitUntil`), so it lands
 * after the response and costs the visitor nothing. Should the deferral ever be
 * removed, this constant has to grow back with it, or the projection
 * under-reports.
 *
 * Deliberately an ESTIMATE rather than a measurement: making testMode do the
 * real work would either persist bot-triggerable rows or send real email, which
 * is the whole reason the short-circuit sits where it does.
 */
export const TESTMODE_SKIPPED_WORK_MS = 1_000;

/** Fraction of the site's abort budget a projected real submission may consume
 *  before the probe warns. Half leaves a 2x margin for cold starts and provider
 *  jitter — this is a leading indicator, so it must fire while submissions still
 *  succeed, not once visitors are already seeing errors. */
export const BUDGET_WARN_RATIO = 0.5;

/** What a real submission would have cost, given a testMode probe's elapsed time. PURE. */
export function projectRealSubmissionMs(probeElapsedMs: number): number {
  return probeElapsedMs + TESTMODE_SKIPPED_WORK_MS;
}

/** Whether a probe of this duration leaves too little of the client abort budget
 *  (`INGEST_TIMEOUT_MS`, the site-side budget in forms/client.ts) for the real
 *  submission it stands in for. PURE — `budgetMs` is injectable for tests. */
export function isIngestBudgetThin(
  probeElapsedMs: number,
  budgetMs: number = INGEST_TIMEOUT_MS,
): boolean {
  return projectRealSubmissionMs(probeElapsedMs) > budgetMs * BUDGET_WARN_RATIO;
}

/** Operator-facing budget line. `BUDGET_THIN` is a stable grep token — the
 *  nightly fleet-form-e2e workflow raises it as a GitHub warning. */
function budgetThinSummary(probeElapsedMs: number): string {
  const s = (ms: number) => `${(ms / 1000).toFixed(1)}s`;
  return (
    `BUDGET_THIN: probe ${s(probeElapsedMs)} + ~${s(TESTMODE_SKIPPED_WORK_MS)} of sink work ` +
    `the probe skips ≈ ${s(projectRealSubmissionMs(probeElapsedMs))} projected against a ` +
    `${s(INGEST_TIMEOUT_MS)} abort budget — a real submission may be reported to the ` +
    `visitor as failed while central still captures the lead`
  );
}

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
    const details = { ok, formPresent: true, checkedAt } satisfies FormE2eDetails;
    if (!outcome.success) {
      return {
        audit: "form-e2e",
        site: label,
        status: "warn",
        summary: `form-e2e: synthetic submission failed${outcome.detail ? ` — ${outcome.detail}` : ""}`,
        details,
      };
    }
    // The submission worked, but a probe that already eats the abort budget means
    // real submissions — which pay the sink work this one skipped — are close to
    // being reported as failures. Warn on the RUN while leaving the persisted
    // verdict at "pass": the form does work, and flipping the cockpit to "fail"
    // would report a working form as broken.
    // Measured against the POST span, NOT click→banner. `INGEST_TIMEOUT_MS` aborts
    // the site→central fetch and nothing else, so comparing it to a window that
    // also contains Turnstile's token round-trip and the browser's render of the
    // success banner over-warns: the claim "may be reported to the visitor as
    // failed" is only true if the FETCH overruns. On 2026-08-17 vineyard-custom-homes
    // warned at 16.9s click→banner while its own function answered in 0.25s warm
    // / 2.0s cold — the warning was reporting page-render time as abort risk.
    // No POST observed → no claim to make.
    const thin =
      typeof outcome.postElapsedMs === "number" && isIngestBudgetThin(outcome.postElapsedMs)
        ? budgetThinSummary(outcome.postElapsedMs)
        : null;
    return {
      audit: "form-e2e",
      site: label,
      status: thin ? "warn" : "pass",
      summary: thin
        ? `form-e2e: synthetic submission succeeded — ${thin}`
        : "form-e2e: synthetic submission succeeded",
      details,
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

/** The slice of a Playwright page the route probe needs. Declared structurally so
 *  the discovery loop is unit-testable without launching a browser; the real
 *  `Page` satisfies it. */
export type FormProbePage = {
  goto: (
    url: string,
    opts?: { waitUntil?: string; timeout?: number },
  ) => Promise<{ ok: () => boolean } | null>;
  locator: (selector: string) => { count: () => Promise<number> };
};

/**
 * Navigate `paths` in order and return the URL of the first that renders a contact
 * form — a `<form>` carrying an email field. `null` means no candidate route has
 * one, which the caller reports as n/a (never a failure).
 *
 * A form without an email input does not count: several sites put a search or
 * newsletter `<form>` on the homepage, and submitting one as a "contact form"
 * would report a false pass. Navigation errors are misses, not aborts, so one dead
 * route cannot mask a form on the next.
 */
export async function findFormPath(
  page: FormProbePage,
  baseUrl: string,
  paths: readonly string[] = CONTACT_PATHS,
): Promise<string | null> {
  for (const path of paths) {
    const url = new URL(path, baseUrl).toString();
    const resp = await page
      .goto(url, { waitUntil: "domcontentloaded", timeout: PAGE_TIMEOUT_MS })
      .catch(() => null);
    if (!resp || !resp.ok()) continue;
    const forms = await page
      .locator("form")
      .count()
      .catch(() => 0);
    if (forms === 0) continue;
    const emails = await page
      .locator('input[name="email"], input[type="email"]')
      .count()
      .catch(() => 0);
    if (emails === 0) continue;
    return url;
  }
  return null;
}

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
        // Probe each candidate route; none carrying a form ⇒ no contact form (n/a).
        // findFormPath leaves the page on the route it selected, so the fills below
        // act on the form it found.
        const found = await findFormPath(page as unknown as FormProbePage, baseUrl);
        if (!found) return { formPresent: false };

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
        // Stamped as a side-effect rather than awaited here on purpose: awaiting
        // the POST before the banner would serialize two 30s timeouts in the
        // no-POST case and double the worst-case run. `startedAt` is assigned at
        // the click below, which always happens before this can resolve.
        let startedAt = 0;
        let postElapsedMs: number | undefined;
        const postResponse = page
          .waitForResponse((r) => r.request().method() === "POST", {
            timeout: PAGE_TIMEOUT_MS,
          })
          .then((r) => {
            postElapsedMs = Date.now() - startedAt;
            return r;
          })
          .catch(() => null);
        // Both standard submit controls: reddoor-website uses `<input type="submit">`
        // (its first enrolled run timed out matching button-only and false-failed).
        // Timed from the click so `elapsedMs` measures what a visitor waits for —
        // the site action plus its central ingest call — and not the page load,
        // the fills, or the deliberate FILL_SETTLE_MS pause.
        startedAt = Date.now();
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
        const elapsedMs = Date.now() - startedAt;
        if (ok)
          return {
            formPresent: true,
            success: true,
            elapsedMs,
            ...(postElapsedMs !== undefined ? { postElapsedMs } : {}),
          };
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
