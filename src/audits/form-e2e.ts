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
  /** Absent = this run had no FORM verdict (the testMode-undeclared skip), which
   *  leaves `Form E2E OK` and its stamp untouched. */
  ok?: "pass" | "fail" | null;
  formPresent?: boolean;
  checkedAt: string;
  /** The Turnstile widget verdict this run earned, written to the same Websites
   *  row and gated by the same `Form E2E checked at` stamp. Absent = this run had
   *  no opinion, which PRESERVES whatever verdict is already there rather than
   *  clearing it. See `turnstileVerdict`. */
  turnstileWidget?: "pass" | "fail" | null;
};

/** Outcome of driving one site's contact form. `formPresent:false` ⇒ n/a
 *  (persisted). `testModeUndeclared` ⇒ the site's /health does not declare
 *  `forms.testMode`, so the probe refused to submit — a plain skip, prior
 *  verdict preserved. `elapsedMs` times the submit itself (click → success
 *  banner) and feeds the budget-headroom check; absent means "not measured",
 *  which never manufactures a verdict. */
export type FormSubmitOutcome =
  | { formPresent: false; formsHealth?: FormsHealth }
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
      /** The probe's filled values were wiped by a client re-render (2026-08-31:
       *  a hydration mismatch on reddoor's /contact recreated the form subtree,
       *  discarding the fills AND the injected hidden fields, so the click hit an
       *  empty form and native `required` validation blocked the submit) and were
       *  re-filled once before the click. On a pass this is production proof the
       *  wipe happens; on a failure it says one refill wasn't enough. */
      refilled?: boolean;
      /** What the site's REAL Turnstile widget did while the probe was on the
       *  page. The probe does NOT swap the sitekey — `testSitekey` only names the
       *  fake token VALUE it injects — so the real widget renders with the real
       *  `PUBLIC_TURNSTILE_SITE_KEY` on every run, and this records what it did.
       *  Undefined = not observed (an older runner, or the page never loaded). */
      turnstile?: TurnstileObservation;
      /** The `forms` block the preflight already read. Carried out rather than
       *  re-fetched so the verdict cannot disagree with the gate that admitted
       *  the probe. Undefined = an older runner that did not report it. */
      formsHealth?: FormsHealth;
    }
  | { testModeUndeclared: true };

/**
 * What a browser saw the site's own Turnstile widget do. Only two of Cloudflare's
 * failure modes are BROWSER-INDEPENDENT, and the distinction is the whole point:
 *
 * - `110200` is a domain-binding rejection, emitted before any challenge is
 *   attempted. It means this hostname is not on the widget's allowlist, the widget
 *   mints NO token, and on a `Require Turnstile` site every real lead is bucketed
 *   as spam. It fires identically for a human and for automation, so a probe can
 *   assert on it.
 * - `600010` is a challenge failure, and Cloudflare returns it to ANY driven
 *   browser whatever the configuration — measured 2026-09-04 against the
 *   known-good reddoorla.com canary and against Playwright headed and headless,
 *   while the same page in an ordinary Chrome window minted a token siteverify
 *   accepted. It carries NO information about the site and must never be a verdict.
 *
 * A "pass" therefore needs POSITIVE evidence — the mount point AND Cloudflare's
 * script — never merely the absence of an error string. The SSR'd container alone
 * proves only that the env var is set.
 */
export type TurnstileObservation = {
  /** A `.cf-turnstile` mount point was in the DOM on the route the probe settled
   *  on. NOT sufficient on its own: the starter server-renders that div from
   *  `{#if turnstileSiteKey}`, so it is present whenever the env var is set —
   *  including when the widget never initialises. Pairing it with `scriptLoaded`
   *  is what makes "pass" positive evidence rather than the absence of a string. */
  containerPresent: boolean;
  /** Cloudflare's `api.js` was actually fetched and answered 2xx. Without it
   *  `window.turnstile` never exists, no widget is created and no token is ever
   *  minted — while the SSR'd container sits there looking healthy. */
  scriptLoaded: boolean;
  /** An uncaught (or logged) `110200` — this hostname is not on the widget. */
  hostnameRejected: boolean;
  /** The page reported the widget could not render. The starter catches a
   *  `loadTurnstile()` rejection and logs `[turnstile] widget did not render` at
   *  console.WARN — not error — so this is deliberately matched across every
   *  console level, not just errors. */
  initFailed: boolean;
  /** Cloudflare raised some OTHER error against the widget — an invalid, deleted,
   *  rotated or disabled sitekey (110100, 110110, 400020, 400070), or another
   *  `110xxx`. Its whole job is to deny the green: without it, a widget deleted at
   *  Cloudflare scores "pass", because api.js still answers 2xx (its URL carries no
   *  sitekey), the mount point is still server-rendered, and the pass arm's negative
   *  half was the absence of one six-digit string.
   *
   *  Never a fail. This fleet has MEASURED only 110200 and 600010 verbatim, and an
   *  unmeasured code does not get the authority to raise a red on a gated site — it
   *  lands as `null`, "looked, cannot tell", which the cockpit already renders as
   *  the amber `turnstile-unverified` watch. That asymmetry is what makes it safe to
   *  match a family by prefix rather than a list by measurement. */
  widgetError: boolean;
};

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

/**
 * The site's `/health` `forms` block, read once in the preflight. `testMode` gates
 * whether the probe may submit at all; `turnstile` is `!!PUBLIC_TURNSTILE_SITE_KEY`
 * on the deployed site — it says a sitekey is CONFIGURED and nothing more, since
 * /health never contacts Cloudflare. Null = absent or malformed (an older site
 * package whose /health has no such key).
 */
export type FormsHealth = { testMode: boolean; turnstile: boolean | null };

/**
 * The `Turnstile widget` verdict, from the two things one form-e2e run knows: what
 * the deployed site's /health declares, and what a real browser saw the real widget
 * do. PURE.
 *
 * Asymmetric on purpose, and each arm is a claim the evidence actually supports:
 *
 *   turnstile:false           → "fail"  no sitekey deployed. /health is CONCLUSIVE
 *                                       here — an empty env var cannot mint a token.
 *   hostnameRejected          → "fail"  a browser saw 110200 on the live hostname.
 *                                       The widget mints nothing; under Require
 *                                       Turnstile that is 100% lead loss.
 *   container + script, no widget → "pass"  a browser loaded Cloudflare's script and
 *   error                                the real mount point on the real hostname,
 *                                       and Cloudflare raised no error against the
 *                                       sitekey (see TURNSTILE_WIDGET_ERROR for
 *                                       exactly which codes that covers).
 *   container but no script   → null    the widget could never initialise. NOT a
 *                                       fail: a blocked runner looks identical.
 *   any other widget error    → null    the sitekey is invalid, deleted, rotated or
 *                                       disabled (110100 / 110110 / 400020 / 400070
 *                                       / any other 110xxx). Denies the green; not a
 *                                       red, because unlike 110200 this fleet has
 *                                       never measured one verbatim.
 *   turnstile:true, no browser→ null    a key is set and nothing looked. UNVERIFIED —
 *                                       never "pass", which is the whole lesson of
 *                                       #689.
 *   key set but no container  → null    the page carries no `.cf-turnstile` mount.
 *                                       Could be a form the widget isn't on; not
 *                                       evidence either way.
 *
 * What "pass" DOES NOT mean: that a human can solve the challenge. No automated
 * browser can establish that — Cloudflare answers automation with 600010 whatever
 * the config — so `pass` is precisely "the widget is deployed and is not
 * mis-hostnamed", which is the failure mode that silently loses leads. The runbook
 * (docs/runbooks/turnstile-widgets.md) states the same limit.
 */
/**
 * Matches ONLY Cloudflare's own domain-binding rejection. Anchored on the
 * `[Cloudflare Turnstile]` prefix on purpose: a bare `/110200/` would match any
 * page that happens to print those six digits (an order id, a phone number, a
 * stack offset), and this feeds a RED alarm on a gated site — a false positive
 * here reads as "your form is losing every lead". Verbatim sample, from
 * vida-legacy-foundation's live /contact on 2026-09-04:
 *
 *   TurnstileError: [Cloudflare Turnstile] Error: 110200.
 *
 * 600010 deliberately does NOT match: Cloudflare returns it to every driven
 * browser regardless of configuration, so it is the harness's signature, not the
 * site's. See TurnstileObservation.
 */
export const TURNSTILE_HOSTNAME_REJECTED = /\[Cloudflare Turnstile\][^\n]*?\b110200\b/;

/**
 * Every widget error that is NOT the hostname rejection above and NOT the harness's
 * own signature. Read off Cloudflare's published client-side error table, which is
 * NOT tidy by prefix — the two codes that mean "this sitekey is dead" live in two
 * different families:
 *
 *   110100 invalid sitekey        400020 invalid sitekey
 *   110110 sitekey not found      400070 sitekey DISABLED
 *   110420 invalid action
 *   110600 challenge timed out    ← retryable, and challenge-time rather than
 *   110620 interaction timed out    lookup-time. Matched anyway; see below.
 *
 * So the rest of `110xxx` by prefix (future configuration codes fail SAFE — the
 * previous draft matched only what had been measured, and a dead widget scored a
 * green one code along) plus those two 4000xx by exact value. NOT the whole
 * `4xxxxx`/`3xxxxx`/`2xxxxx` families, which are network and challenge conditions
 * rather than statements about the sitekey.
 *
 * Two codes above are timeouts, not configuration, and matching them is a
 * deliberate accepted cost: this arm only ever DENIES a green, never raises a red,
 * so its failure mode is one empty cell for a night. Their alternative — narrowing
 * to the four codes measured somewhere — is the failure mode that costs leads.
 * Neither is reachable here in any case: the fleet's widgets are invisible mode, so
 * nothing waits on a visitor to click (110620), and Cloudflare refuses a driven
 * browser with 600010 immediately rather than letting its challenge stall (110600).
 *
 * Deliberately NOT extended to `6xxxxx`: 600010 is Cloudflare's answer to every
 * driven browser (see TurnstileObservation), so matching it would set this flag on
 * EVERY nightly run and make "pass" unreachable — the audit would go inert with
 * nothing to show for it. That one exclusion is load-bearing; the rest is scope.
 *
 * Anchored on the `[Cloudflare Turnstile]` prefix for the same reason
 * TURNSTILE_HOSTNAME_REJECTED is: six loose digits are an order id on somebody's
 * page.
 */
export const TURNSTILE_WIDGET_ERROR =
  /\[Cloudflare Turnstile\][^\n]*?\b(?:110(?!200\b)\d{3}|400020|400070)\b/;

/** The starter's own tell that `loadTurnstile()` rejected — CSP, offline, a
 *  blocked host. Logged at console.WARN, not error, which is why the console
 *  channel below is not filtered to errors: narrowing it to `msg.type() ===
 *  "error"` is exactly how the first draft of this change let a widget that never
 *  initialised report a healthy `pass`. */
export const TURNSTILE_INIT_FAILED = /\[turnstile\] widget did not render/;

/** Cloudflare's challenge script. A 2xx for it is the difference between a mount
 *  point that becomes a widget and one that just sits in the DOM. */
export const TURNSTILE_API_JS = /challenges\.cloudflare\.com\/turnstile\/v0\/api\.js/;

export function turnstileVerdict(
  health: FormsHealth,
  observed: TurnstileObservation | undefined,
): "pass" | "fail" | null {
  // No key deployed — conclusive from /health alone, no browser needed. Checked
  // FIRST so it still lands on a site the probe never opened a browser for.
  if (health.turnstile === false) return "fail";
  if (!observed) return null;
  // The only browser-independent defect. Everything below it is either positive
  // evidence or an absence of evidence — never a fail, because the remaining ways
  // a widget can look broken to a PROBE are indistinguishable from the probe's own
  // environment (a runner with blocked egress, a transient 5xx on api.js). A red
  // alarm manufactured by our own network is worse than no alarm.
  if (observed.hostnameRejected) return "fail";
  // "pass" requires POSITIVE evidence of a live widget: the mount point AND the
  // script that turns it into one. The container alone is server-rendered from
  // the env var, so accepting it would let a site whose api.js never loads —
  // hand-edited CSP, a 5xx, blocked egress — report a healthy widget that mints
  // no token at all. That is #689's exact shape, and this arm is where the first
  // draft of this change reintroduced it.
  if (!observed.containerPresent) return null;
  if (!observed.scriptLoaded || observed.initFailed) return null;
  // ...and the negative half has to be more than "no 110200". A widget deleted,
  // rotated or DISABLED at Cloudflare still serves api.js (2xx — the URL carries no
  // sitekey) and still SSRs its mount point, so without this the first draft's
  // defect survives one code along: a dead widget scoring green while a gated site
  // buckets every real lead. Denies the pass, never manufactures a fail.
  if (observed.widgetError) return null;
  return "pass";
}

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
 * - /health does not declare testMode → skip WITH details, but NO stamp: the form
 *   verdict is preserved and only `turnstileWidget` is written (null, clearing the
 *   value function-health used to keep alive in that column).
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
      // testMode forwarding, so probing it would submit a real lead. The FORM
      // verdict and its stamp are left untouched, which preserves them.
      //
      // The Turnstile verdict is explicitly CLEARED to null, and that is
      // load-bearing rather than tidy-mindedness. function-health used to rewrite
      // this cell nightly; now that it does not, a legacy "fail" on a site the
      // probe can never browse would be frozen there with nothing able to correct
      // it — and if that site were ever gated it would emit a CRITICAL, un-mutable
      // digest item every morning, forever. Writing null defuses that on the first
      // run and states the truth: nothing verified this widget.
      return {
        audit: "form-e2e",
        site: label,
        status: "skip",
        summary:
          "site /health does not declare forms.testMode — probe refused " +
          "(testMode forwarding not yet rolled out here)",
        details: { checkedAt, turnstileWidget: null } satisfies FormE2eDetails,
      };
    }
    if (!outcome.formPresent) {
      return {
        audit: "form-e2e",
        site: label,
        status: "skip",
        summary: "no contact form (n/a)",
        details: {
          ok: null,
          formPresent: false,
          checkedAt,
          // Written here too: this path DOES refresh `Form E2E checked at`, and
          // the verdict must never be older than the stamp that ages it.
          turnstileWidget: turnstileVerdict(
            outcome.formsHealth ?? { testMode: true, turnstile: null },
            undefined,
          ),
        } satisfies FormE2eDetails,
      };
    }
    const ok: "pass" | "fail" = outcome.success ? "pass" : "fail";
    // ALWAYS defined on this path, never omitted — because this path refreshes
    // `Form E2E checked at`, which is the clock the CRITICAL alarm ages the verdict
    // against. Omitting the verdict here would preserve an older one beside a fresh
    // stamp, i.e. present months-old evidence as current: the exact staleness bug
    // that made the column untrustworthy in the first place. A runner that reported
    // nothing (an injected fake) knows nothing, so it writes null — "looked, cannot
    // tell" — which is honest and cannot produce a red.
    //
    // The absent-means-preserve case is real, but it belongs to the exits that
    // return no `details` at all (no deployedUrl, the live gate off). The
    // testMode-undeclared skip above is a THIRD shape: it writes the verdict as
    // null without stamping, deliberately clearing the legacy value function-health
    // left in that column — which no writer could correct now that the column has
    // moved — while leaving `Form E2E checked at` alone so a stale form verdict
    // never looks fresh to auto-tick.ts's `formsEvidence`.
    const turnstileWidget = turnstileVerdict(
      outcome.formsHealth ?? { testMode: true, turnstile: null },
      outcome.turnstile,
    );
    const details = { ok, formPresent: true, checkedAt, turnstileWidget } satisfies FormE2eDetails;
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
    // Surfaced on a PASS too: a wiped-then-refilled run is the production
    // evidence that the re-render race exists on this site, and the nightly log
    // is where that evidence has to land for anyone to see it.
    const refillNote = outcome.refilled
      ? " — fields were wiped by a client re-render and re-filled once"
      : "";
    return {
      audit: "form-e2e",
      site: label,
      status: thin ? "warn" : "pass",
      summary: thin
        ? `form-e2e: synthetic submission succeeded — ${thin}${refillNote}`
        : `form-e2e: synthetic submission succeeded${refillNote}`,
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
  return (await readFormsHealth(baseUrl)).testMode;
}

/**
 * The site's `/health` `forms` block. One fetch answers BOTH questions the probe
 * needs: may it submit (`testMode`), and does the site claim a Turnstile sitekey
 * (`turnstile`). Split out from `declaresTestModeForwarding` — which stays as the
 * safety predicate it always was — so the turnstile verdict costs no extra request
 * and cannot disagree with the gate that let the probe run.
 *
 * Everything unreachable degrades to the SAFE side of each field independently:
 * `testMode:false` refuses the submit, `turnstile:null` means "unknown", never
 * "no key" — a network blip must not manufacture a `fail`.
 */
export async function readFormsHealth(baseUrl: string): Promise<FormsHealth> {
  const unknown: FormsHealth = { testMode: false, turnstile: null };
  try {
    const res = await fetch(new URL("/health", baseUrl), {
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
    });
    if (!res.ok) return unknown;
    const body: unknown = await res.json();
    if (typeof body !== "object" || body === null) return unknown;
    const forms = (body as Record<string, unknown>).forms;
    if (typeof forms !== "object" || forms === null) return unknown;
    const f = forms as Record<string, unknown>;
    return {
      testMode: f.testMode === true,
      // Strictly boolean. A missing or malformed key is unknown, NOT false —
      // "no sitekey" is a conclusive fail downstream and must be earned.
      turnstile: typeof f.turnstile === "boolean" ? f.turnstile : null,
    };
  } catch {
    return unknown;
  }
}

/**
 * Whether a POST landed on the SITE's own host (the form action, or the apex/www
 * twin it redirects to) rather than a third party. PURE. The runner's failure
 * lines used to name whatever POST happened first: on 2026-08-31 that was
 * Google Analytics' collect beacon ("POST 204") and Cloudflare Turnstile
 * telemetry ("POST 200"), and both warn lines sent triage chasing the wrong
 * component while the real story was "the submission never left the page".
 * `www.` is stripped because at least one site (beachfront-dentistry) is probed
 * at `www.` while its action lands on the apex.
 */
export function isSameSitePost(postUrl: string, baseUrl: string): boolean {
  try {
    const host = (u: string) => new URL(u).hostname.replace(/^www\./, "");
    return host(postUrl) === host(baseUrl);
  } catch {
    return false;
  }
}

/** What the probe could still see about the form once the banner failed to show. */
export type NoBannerFormState = {
  formPresent: boolean;
  /** null when the form is gone (nothing left to validate). */
  checkValidity: boolean | null;
  /** Names of `required` fields that were empty at inspection time — empty
   *  required fields mean native validation blocked the submit client-side. */
  emptyRequired: string[];
};

/** Evidence gathered when the success banner never appeared. */
export type NoBannerEvidence = {
  /** The same-site action POST, if one happened. null ⇒ the submission never
   *  left the page — the failure is client-side, before the network. */
  post: { status: number; bodyBit?: string } | null;
  alertText: string | null;
  formState: NoBannerFormState | null;
  /** A Svelte hydration-mismatch warning was logged — the tell that the
   *  framework recreated the DOM under the probe's feet. */
  hydrationMismatch: boolean;
  refilled: boolean;
};

/** Compose the failure detail line. PURE — the line must say WHY nothing
 *  happened, not just that it didn't; "no success banner — POST 204" cost the
 *  2026-08-31 triage a detour through two components that weren't involved. */
export function noBannerDetail(e: NoBannerEvidence): string {
  const bits: string[] = [
    e.post
      ? `POST ${e.post.status}${e.post.status >= 400 && e.post.bodyBit ? ` ${e.post.bodyBit}` : ""}`
      : "no same-site POST: the submission never left the page",
  ];
  if (e.alertText?.trim()) bits.push(`alert: ${e.alertText.trim().slice(0, 80)}`);
  if (e.formState) {
    if (!e.formState.formPresent) bits.push("the form is gone from the page");
    else if (e.formState.emptyRequired.length > 0)
      bits.push(`empty required: ${e.formState.emptyRequired.join(", ")}`);
    else if (e.formState.checkValidity === false) bits.push("form fails validation");
  }
  if (e.hydrationMismatch) bits.push("hydration mismatch warning seen");
  if (e.refilled) bits.push("fields were wiped and re-filled once");
  return `no success banner after submit — ${bits.join("; ")}`;
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
      const formsHealth = await readFormsHealth(baseUrl);
      if (!formsHealth.testMode) {
        return { testModeUndeclared: true };
      }
      // Hoisted above the try: the catch below reports what the widget did, and
      // the listener that sets this is attached inside.
      let turnstileHostnameRejected = false;
      let turnstileScriptLoaded = false;
      let turnstileInitFailed = false;
      let turnstileWidgetError = false;
      // Hoisted for the same reason as the flags, not merely for tidiness: this is
      // the ONE signal the verdict short-circuits on, so a throw AFTER the sample
      // used to discard a container the run had already seen and hand back
      // "looked, cannot tell" — clearing a verdict it had positively earned.
      let containerPresent = false;
      const browser = await chromium.launch();
      try {
        const ctx = await browser.newContext();
        const page = await ctx.newPage();
        // The tell that the framework recreated the DOM under the probe (Svelte 5
        // logs a svelte.dev/e/hydration_mismatch warning when it does). Recorded
        // for the failure detail — on 2026-08-31 this was the discriminator
        // between reddoor's failing probe and its passing ones.
        let hydrationMismatch = false;
        // The site's REAL Turnstile widget renders here — the probe never swaps
        // the sitekey (see the note on TurnstileObservation), so this is the one
        // place in the fleet that sees a production widget on its production
        // hostname. Attached at page creation, BEFORE any navigation: api.js
        // throws during load, so a listener added later misses it entirely.
        // Both channels, because Cloudflare surfaces the rejection as an uncaught
        // error AND (separately) as a console error next to the 400 from
        // challenges.cloudflare.com; either alone is enough, and the flag is
        // monotonic so a double report is harmless.
        const noteTurnstile = (text: string) => {
          if (TURNSTILE_HOSTNAME_REJECTED.test(text)) turnstileHostnameRejected = true;
          if (TURNSTILE_INIT_FAILED.test(text)) turnstileInitFailed = true;
          if (TURNSTILE_WIDGET_ERROR.test(text)) turnstileWidgetError = true;
        };
        page.on("pageerror", (err) => noteTurnstile(String(err?.message ?? err)));
        page.on("console", (msg) => {
          if (msg.text().includes("hydration_mismatch")) hydrationMismatch = true;
          // EVERY level, not just errors: the starter reports a failed widget load
          // at console.warn, and narrowing this to errors is how a widget that
          // never initialised earned a "pass" in the first draft. The regexes are
          // the guard, not the log level.
          noteTurnstile(msg.text());
        });
        // Did Cloudflare's script actually arrive? A 2xx here is what turns the
        // server-rendered mount point into a real widget; without it `window
        // .turnstile` never exists and no token is ever minted, while the div sits
        // in the DOM looking exactly like a healthy site.
        page.on("response", (res) => {
          if (TURNSTILE_API_JS.test(res.url()) && res.status() >= 200 && res.status() < 300) {
            turnstileScriptLoaded = true;
          }
        });
        // Probe each candidate route; none carrying a form ⇒ no contact form (n/a).
        // findFormPath leaves the page on the route it selected, so the fills below
        // act on the form it found.
        const found = await findFormPath(page as unknown as FormProbePage, baseUrl);
        if (!found) return { formPresent: false, formsHealth };

        // Sampled on the route findFormPath SETTLED on, so a `.cf-turnstile` seen
        // on `/contact` is never attributed to a `/` probe or vice versa. The
        // container is server-rendered by the starter's TurnstileWidget (its
        // `{#if turnstileSiteKey}` runs during SSR), so it is present at
        // domcontentloaded and needs no wait — unlike the iframe, which invisible
        // mode never leaves behind and which is therefore NOT a health signal.
        containerPresent = await page
          .locator(".cf-turnstile")
          .count()
          .then((n) => n > 0)
          .catch(() => false);
        // Read at the END of the run, not here: api.js is async and the response
        // may land after this point, whereas the container is server-rendered and
        // must be sampled on the settled route.
        const turnstileSeen = (): TurnstileObservation => ({
          containerPresent,
          scriptLoaded: turnstileScriptLoaded,
          hostnameRejected: turnstileHostnameRejected,
          initFailed: turnstileInitFailed,
          widgetError: turnstileWidgetError,
        });

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
        const tokenValue = `testmode-${testSitekey}`;
        const injectExpr = `
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
            add("cf-turnstile-response", ${JSON.stringify(tokenValue)});
          })();
        `;
        // Fills are per-field best-effort (a site may lack a phone field), but
        // WHICH fills landed is tracked so the pre-click verification below knows
        // exactly what to expect. The whole sequence is re-runnable on purpose.
        const fills = [
          { selector: '[name="name"]', value: "Reddoor Monitor" },
          { selector: '[name="email"]', value: "monitor+e2e@reddoorla.com" },
          { selector: '[name="phone"]', value: "5555550123" },
          {
            selector: '[name="message"]',
            value: "Synthetic end-to-end health check — please ignore.",
          },
        ];
        const filled: { selector: string; value: string }[] = [];
        const fillAll = async () => {
          for (const f of fills) {
            const landed = await page
              .fill(f.selector, f.value)
              .then(() => true)
              .catch(() => false);
            if (landed && !filled.some((s) => s.selector === f.selector)) filled.push(f);
          }
          await page.evaluate(injectExpr);
        };
        await fillAll();

        // Beat the bot-timing screen, then submit and wait for the success banner
        // (role="status") the starter renders on a successful action.
        await page.waitForTimeout(FILL_SETTLE_MS);

        // Verify the fills survived the settle, and refill once if not. A client
        // re-render during the settle discards everything fillAll did — seen live
        // on 2026-08-31, when a hydration mismatch on reddoor's /contact recreated
        // the form: the click then hit empty `required` fields, native validation
        // blocked the submit, and the night's warn line ("no success banner —
        // POST 200") pointed at a Turnstile telemetry POST instead. The race is
        // widest on slow runners (hydration lands late), which is exactly where
        // the nightly runs.
        // `cf-turnstile-response` is deliberately NOT verified: the Turnstile
        // widget inserts its OWN input with that name while it renders (an
        // erroring widget included), and a first-match lookup then reads the
        // widget's value — the 2026-08-31 live check false-positived "wiped" on
        // every run because of it. `testMode` only ever exists because this
        // probe added it, so it is the sound canary for a re-render wipe.
        const expected = [...filled, { selector: 'input[name="testMode"]', value: "true" }];
        const wipedCount = (await page
          .evaluate(
            `
          (function () {
            const expected = ${JSON.stringify(expected)};
            let wiped = 0;
            for (const { selector, value } of expected) {
              const el = document.querySelector(selector);
              if (!el || el.value !== value) wiped++;
            }
            return wiped;
          })();
        `,
          )
          .catch(() => 0)) as number;
        const refilled = wipedCount > 0;
        if (refilled) await fillAll();
        // Capture the action POST so a failure names the real server response
        // (espada 2026-07-10: three "no success banner" warns were undiagnosable
        // without it — the POST status/alert text is the evidence). SAME-SITE
        // only: an any-POST predicate matched Google Analytics' beacon and
        // Turnstile telemetry first, so the 2026-08-31 warn lines ("POST 204",
        // "POST 200") named third parties while the action POST never fired —
        // and BUDGET_THIN could time a beacon instead of the action.
        // Stamped as a side-effect rather than awaited here on purpose: awaiting
        // the POST before the banner would serialize two 30s timeouts in the
        // no-POST case and double the worst-case run. `startedAt` is assigned at
        // the click below — a same-site POST before the click is unlikely but
        // free to happen, and `Date.now() - 0` would be the epoch — an absurd
        // "elapsed" that would trip BUDGET_THIN, the exact false warn this
        // measurement exists to kill. Un-clicked → leave it undefined; the
        // audit treats absent timing as "no claim to make".
        let startedAt = 0;
        let postElapsedMs: number | undefined;
        const postResponse = page
          .waitForResponse(
            (r) => r.request().method() === "POST" && isSameSitePost(r.url(), baseUrl),
            {
              timeout: PAGE_TIMEOUT_MS,
            },
          )
          .then((r) => {
            if (startedAt > 0) postElapsedMs = Date.now() - startedAt;
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
            ...(refilled ? { refilled } : {}),
            turnstile: turnstileSeen(),
            formsHealth,
          };
        const actionResp = await postResponse;
        const alertText = await page
          .locator('[role="alert"]')
          .first()
          .textContent({ timeout: 1000 })
          .catch(() => null);
        // What is the form's state NOW? Empty required fields mean native
        // validation blocked the submit client-side — the one answer "POST
        // status alone" can never give.
        const formState = (await page
          .evaluate(
            `
          (function () {
            const f = document.querySelector("form");
            if (!f) return { formPresent: false, checkValidity: null, emptyRequired: [] };
            const emptyRequired = [];
            for (const el of f.querySelectorAll("input, textarea, select")) {
              if (el.required && !String(el.value).trim())
                emptyRequired.push(el.name || el.id || el.type);
            }
            return { formPresent: true, checkValidity: f.checkValidity(), emptyRequired };
          })();
        `,
          )
          .catch(() => null)) as NoBannerFormState | null;
        const post = actionResp
          ? {
              status: actionResp.status(),
              ...(actionResp.status() >= 400
                ? { bodyBit: (await actionResp.text().catch(() => "")).slice(0, 80) }
                : {}),
            }
          : null;
        return {
          formPresent: true,
          success: false,
          ...(refilled ? { refilled } : {}),
          detail: noBannerDetail({ post, alertText, formState, hydrationMismatch, refilled }),
          turnstile: turnstileSeen(),
          formsHealth,
        };
      } catch (err) {
        // A thrown probe still carries whatever the widget did — every signal is
        // hoisted above the try and monotonic, so evidence gathered before the
        // throw is real and must not be discarded. That includes the container:
        // the submit `.click()` has a 30s timeout and can throw long after the
        // sample, and reporting a hard `false` there sent the verdict down its
        // `!containerPresent` short-circuit and CLEARED a "pass" the same run had
        // just earned. A throw before the sample still reports false, which is the
        // honest answer for a run that never looked.
        return {
          formPresent: true,
          success: false,
          detail: String(err).slice(0, 120),
          turnstile: {
            containerPresent,
            scriptLoaded: turnstileScriptLoaded,
            hostnameRejected: turnstileHostnameRejected,
            initFailed: turnstileInitFailed,
            widgetError: turnstileWidgetError,
          },
          formsHealth,
        };
      } finally {
        await browser.close().catch(() => {});
      }
    },
  };
}
