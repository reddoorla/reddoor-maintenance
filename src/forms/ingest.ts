import type { WebsiteRow } from "../reports/airtable/websites.js";
import type {
  SubmissionRow,
  SubmissionInput,
  NotifyStatus,
  SubmissionStatus,
} from "../reports/submission-row.js";
import { normalizeSubmission, type NormalizedSubmission } from "./payload.js";
import type { TurnstileOutcome } from "./turnstile.js";
import { SPAM_THRESHOLD, type SpamVerdict } from "./spam-classifier.js";

export type IngestDeps = {
  getWebsiteBySlug: (slug: string) => Promise<WebsiteRow | null>;
  createSubmission: (input: SubmissionInput) => Promise<SubmissionRow>;
  notify: (
    site: WebsiteRow,
    submission: SubmissionRow,
  ) => Promise<{ status: NotifyStatus; messageId: string | null }>;
  stampNotified: (id: string, status: NotifyStatus, messageId: string | null) => Promise<void>;
  now: () => Date;
  /** Optional spam classifier. When present, its verdict drives the stored
   *  status/score/reason; absent → every submission scores 0 (fail-open, clean).
   *  Injected so the classifier stays a pure, transport-agnostic leaf. */
  classifySpam?: (n: NormalizedSubmission, turnstile: TurnstileOutcome) => SpamVerdict;
  /** Optional: POST a newsletter submission to the site's configured webhook
   *  (best-effort). Omitted in tests/handlers that don't need it. */
  forwardNewsletter?: (
    webhookUrl: string,
    submission: SubmissionRow,
    site: WebsiteRow,
  ) => Promise<{ ok: boolean; status: number }>;
  /** Optional: add a newsletter submitter to the site's Mailchimp audience
   *  (best-effort). Omitted where unused. */
  addToMailchimp?: (
    site: WebsiteRow,
    submission: SubmissionRow,
  ) => Promise<{ ok: boolean; status: number }>;
};

export type IngestResult =
  | { status: "accepted"; submissionId: string; notifyStatus: NotifyStatus }
  | { status: "rejected"; reason: "invalid-payload"; errors: string[] }
  | { status: "unknown-site"; slug: string };

export type ScreenOutDeps = {
  getWebsiteBySlug: (slug: string) => Promise<WebsiteRow | null>;
  recordScreenOut: (siteId: string, reason: "honeypot" | "too-fast") => Promise<void>;
};

export type ScreenOutResult =
  | { status: "recorded"; slug: string }
  | { status: "unknown-site"; slug: string };

/** Extract the screen-out reason from a beacon body, or null if it isn't one. */
export function parseScreenOut(payload: unknown): "honeypot" | "too-fast" | null {
  if (!payload || typeof payload !== "object") return null;
  const v = (payload as Record<string, unknown>)["screenOut"];
  return v === "honeypot" || v === "too-fast" ? v : null;
}

/** Resolve the site and record a caught screen-out. Best-effort: a record failure is
 *  the caller's to swallow — a missed count must never error a screened bot. */
export async function ingestScreenOut(
  deps: ScreenOutDeps,
  slug: string,
  reason: "honeypot" | "too-fast",
): Promise<ScreenOutResult> {
  const site = await deps.getWebsiteBySlug(slug);
  if (!site) return { status: "unknown-site", slug };
  await deps.recordScreenOut(site.id, reason);
  return { status: "recorded", slug };
}

/**
 * Normalize → resolve site → persist → notify → stamp. The order is load-bearing:
 * the row is written BEFORE notify, and notify/stamp failures are swallowed (logged)
 * so a Resend or Airtable-write-back hiccup can never turn an accepted lead into a 502.
 */
export async function ingestSubmission(
  deps: IngestDeps,
  slug: string,
  rawPayload: unknown,
  turnstile: TurnstileOutcome = "unverifiable",
): Promise<IngestResult> {
  const normalized = normalizeSubmission(rawPayload);
  if (!normalized.ok) {
    return { status: "rejected", reason: "invalid-payload", errors: normalized.errors };
  }
  const site = await deps.getWebsiteBySlug(slug);
  if (!site) return { status: "unknown-site", slug };

  // Synthetic end-to-end probe (the `form-e2e` fleet audit). A central-only marker
  // on the payload routes the submission away from EVERY real sink: no row is
  // persisted, no spam classification, no operator/autoresponder email, no
  // newsletter fan-out — and Turnstile enforcement is bypassed (the short-circuit
  // sits before that check). The marker therefore grants a bot NO benefit: it
  // reaches no inbox/DB/webhook, so skipping Turnstile costs nothing. This
  // suppression MUST be central — the submitting site alone cannot stop the real
  // inbox firing. Validity + site resolution are still enforced above (a junk body
  // is rejected, an unknown slug is unknown-site), so the marker can't smuggle
  // anything through. Return accepted+skipped so the probe asserts success.
  if (isTestMode(rawPayload)) {
    return { status: "accepted", submissionId: "test-mode", notifyStatus: "skipped" };
  }

  const n = normalized.value;

  // Fold the content signals + the Turnstile verdict into ONE spam decision.
  // Absent classifier → treat as clean (fail-open). A throwing classifier is
  // swallowed the same way — a bug in the heuristic must never turn an
  // otherwise-good lead into a 500; it just scores clean. A `requireTurnstile`
  // site escalates an ACTUAL "fail" to auto-spam regardless of score (never an
  // absent token or an "unverifiable" error — those stay neutral).
  let verdict: SpamVerdict = { score: 0, reasons: [] };
  if (deps.classifySpam) {
    try {
      verdict = deps.classifySpam(n, turnstile);
    } catch (err) {
      console.error(`[ingest] classifySpam threw: ${String(err)}`);
    }
  }
  const reasons = [...verdict.reasons];
  let status: SubmissionStatus = verdict.score >= SPAM_THRESHOLD ? "spam_auto" : "new";
  if (site.requireTurnstile && turnstile === "fail") {
    status = "spam_auto";
    if (!reasons.includes("turnstile-required-failed")) reasons.push("turnstile-required-failed");
  }
  const spamReason = reasons.length > 0 ? reasons.join(",") : null;

  const row = await deps.createSubmission({
    siteId: site.id,
    formType: n.formType,
    name: n.name,
    email: n.email,
    extraFields: n.extraFields,
    status,
    spamScore: verdict.score,
    spamReason,
    // Optional fields spread only when present — exactOptionalPropertyTypes
    // forbids assigning `undefined` to an optional `phone?: string` etc.
    ...(n.phone !== undefined ? { phone: n.phone } : {}),
    ...(n.message !== undefined ? { message: n.message } : {}),
    ...(n.sourceUrl !== undefined ? { sourceUrl: n.sourceUrl } : {}),
    ...(n.utm !== undefined ? { utm: n.utm } : {}),
    submittedAt: deps.now(),
  });

  // Auto-spam (and operator-marked spam) is captured but silent: no operator
  // email, no autoresponder, no newsletter fan-out. Skip notify entirely and
  // record the honest "skipped" stamp. notify.ts also nulls both builders for
  // these statuses (defense in depth), but short-circuiting here means the
  // injected notify dep is never even invoked for a spam row.
  const isSpam = row.status === "spam_auto" || row.status === "spam";
  let notify: { status: NotifyStatus; messageId: string | null };
  if (isSpam) {
    notify = { status: "skipped", messageId: null };
  } else {
    try {
      notify = await deps.notify(site, row);
    } catch (err) {
      console.error(`[ingest] notify threw: ${String(err)}`);
      notify = { status: "failed", messageId: null };
    }
  }
  try {
    await deps.stampNotified(row.id, notify.status, notify.messageId);
  } catch (err) {
    console.error(`[ingest] stampNotified failed: ${String(err)}`);
  }

  // Newsletter fan-out: each configured destination fires best-effort and is
  // swallowed+logged — the lead is already persisted; never turn it into a 502.
  // Guarded on the row status so a spam signup is never forwarded to a site
  // webhook or added to a Mailchimp audience.
  if (n.formType === "newsletter" && !isSpam) {
    if (site.newsletterWebhook && deps.forwardNewsletter) {
      try {
        const fwd = await deps.forwardNewsletter(site.newsletterWebhook, row, site);
        if (!fwd.ok) console.error(`[ingest] newsletter webhook → ${fwd.status} for ${site.name}`);
      } catch (err) {
        console.error(`[ingest] newsletter webhook threw: ${String(err)}`);
      }
    }
    if (site.mailchimpApiKey && site.mailchimpAudienceId && deps.addToMailchimp) {
      try {
        const mc = await deps.addToMailchimp(site, row);
        if (!mc.ok) console.error(`[ingest] mailchimp add → ${mc.status} for ${site.name}`);
      } catch (err) {
        console.error(`[ingest] mailchimp add threw: ${String(err)}`);
      }
    }
  }
  return { status: "accepted", submissionId: row.id, notifyStatus: notify.status };
}

/** True when an untrusted ingest payload carries the synthetic-probe marker
 *  (top-level `testMode: true`). Read from the RAW payload so the branch never
 *  depends on normalization internals; any non-`true` value is ignored (a real
 *  visitor's form never sets it — the starter only forwards it when the submitted
 *  form field `testMode` equals "true"). */
export function isTestMode(rawPayload: unknown): boolean {
  if (!rawPayload || typeof rawPayload !== "object") return false;
  return (rawPayload as Record<string, unknown>).testMode === true;
}
