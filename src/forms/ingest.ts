import type { WebsiteRow } from "../reports/airtable/websites.js";
import type {
  SubmissionRow,
  SubmissionInput,
  NotifyStatus,
  SubmissionStatus,
} from "../reports/submission-row.js";
import { normalizeSubmission, type NormalizedSubmission } from "./payload.js";
import type { TurnstileOutcome, TurnstileVerification } from "./turnstile.js";
import { SPAM_THRESHOLD, type SpamVerdict } from "./spam-classifier.js";

/** How far back the duplicate-spray AND repeat-sender lookups scan. Sprays arrive in
 *  bursts but bots also re-run for weeks; 30 days catches repeats without an unbounded
 *  table scan. */
const DUPLICATE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

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
  /** Optional: fleet-wide duplicate/near-duplicate body lookup since `since`. Drives
   *  the duplicate-spray signal — the same pitch blasted to many sites shows up as
   *  identical (`exact`) or template-substituted (`similar`, token-set Jaccard) bodies.
   *  Statuses let the retro re-bucket pick still-'new' prior copies. Absent → the
   *  check is skipped (fail-open clean). */
  findRecentDuplicates?: (
    message: string,
    since: Date,
  ) => Promise<{
    exact: Array<{ id: string; status: string }>;
    similar: Array<{ id: string; status: string }>;
  }>;
  /** Optional: recent non-newsletter submissions from the same email since `since`.
   *  Drives the cross-site repeat-sender signal — the fleet's sites are unrelated
   *  businesses, so one address contacting 2+ of them within the window is a
   *  solicitation tell. Absent → the check is skipped (fail-open clean). */
  listRecentSubmissionsForEmail?: (
    email: string,
    since: Date,
  ) => Promise<Array<{ id: string; siteId: string; status: string }>>;
  /** Optional: retroactively re-bucket prior still-'new' rows once a later copy
   *  identifies a spray (the first copy is delivered by design). Implementations
   *  must only touch status='new' rows. Best-effort — failures are swallowed. */
  retroBucket?: (ids: string[], reason: string) => Promise<void>;
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

/** Extract the screen-out reason from a beacon body, or null if it isn't one.
 *  The beacon key is the reserved `_screenOut` (underscore-namespaced like `_meta`,
 *  see payload.ts). The bare `screenOut` key is the DEPRECATED pre-namespacing wire
 *  shape — sites run older package versions for a while, so the central receiver
 *  keeps accepting it. `_screenOut` wins when both are present. */
export function parseScreenOut(payload: unknown): "honeypot" | "too-fast" | null {
  if (!payload || typeof payload !== "object") return null;
  const body = payload as Record<string, unknown>;
  const v = "_screenOut" in body ? body["_screenOut"] : body["screenOut"];
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
  turnstileInput: TurnstileOutcome | TurnstileVerification = "unverifiable",
): Promise<IngestResult> {
  // Accept either the full verification (the production handler) or a bare outcome
  // string (older callers and virtually every test) — a string simply has no solved-
  // hostname to check. Normalized once so the body has a single shape to reason about.
  const verification: TurnstileVerification =
    typeof turnstileInput === "string"
      ? { outcome: turnstileInput, hostname: null }
      : turnstileInput;
  const turnstile = verification.outcome;
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
  // otherwise-good lead into a 500; it just scores clean. On a `requireTurnstile`
  // site, both an ACTUAL "fail" (forged token) AND an "absent" token escalate to
  // auto-spam regardless of score — a real browser that renders the widget ALWAYS
  // sends a token, so a completely missing one is the direct-POST-bot signature. A
  // present-but-"unverifiable" token (expired/duplicate — a real browser DID render
  // the widget) stays neutral, as does anything on a site that hasn't opted in.
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
  if (site.requireTurnstile && (turnstile === "fail" || turnstile === "absent")) {
    status = "spam_auto";
    const reason = turnstile === "fail" ? "turnstile-required-failed" : "turnstile-required-absent";
    if (!reasons.includes(reason)) reasons.push(reason);
  } else if (
    site.requireTurnstile &&
    turnstile === "pass" &&
    verification.hostname !== null &&
    !turnstileHostnameAcceptable(verification.hostname, site.url)
  ) {
    // Defense-in-depth vs token farming: the token PASSED, but Cloudflare says it was
    // solved on a host unrelated to this site. Cloudflare domain-binds sitekeys, so
    // this only trips on a loose widget allowlist — still, a passing token from a
    // foreign host accompanying a gated site's submission is not a real visitor. A
    // null hostname (older responses) or an unparseable site.url skips the check
    // entirely (fail-open); subdomains of the site's host (www., previews) match.
    status = "spam_auto";
    if (!reasons.includes("turnstile-required-hostname"))
      reasons.push("turnstile-required-hostname");
  }

  // Cross-site repeat-sender signal: the fleet's sites are UNRELATED businesses
  // (art gallery, realtor, home builder…), so the same email writing to 2+ different
  // sites within the window is a solicitation tell no single-message scan can see.
  // Same-site repeats alone must NOT trigger — those are genuine follow-ups. The
  // operator explicitly accepts overblocking here (spam_auto is recoverable). Prior
  // still-'new' rows on OTHER sites are retro-bucketed too: the first copy of a
  // spray is delivered by design, so the copy that identifies it also cleans the
  // queue. Best-effort — a lookup failure never blocks a lead.
  if (status !== "spam_auto" && n.formType !== "newsletter" && deps.listRecentSubmissionsForEmail) {
    try {
      const since = new Date(deps.now().getTime() - DUPLICATE_WINDOW_MS);
      const prior = await deps.listRecentSubmissionsForEmail(n.email, since);
      const otherSites = prior.filter((p) => p.siteId !== site.id);
      if (otherSites.length > 0) {
        status = "spam_auto";
        if (!reasons.includes("repeat-sender")) reasons.push("repeat-sender");
        const retroIds = otherSites.filter((p) => p.status === "new").map((p) => p.id);
        if (deps.retroBucket && retroIds.length > 0) {
          try {
            await deps.retroBucket(retroIds, "retro:repeat-sender");
          } catch (err) {
            console.error(`[ingest] retroBucket (repeat-sender) threw: ${String(err)}`);
          }
        }
      }
    } catch (err) {
      console.error(`[ingest] listRecentSubmissionsForEmail threw: ${String(err)}`);
    }
  }

  // Duplicate/spray signal: the same pitch blasted across the fleet (or repeated) is
  // a bot tell a lone content scan can't see. An identical body ('exact') OR a
  // template-substituted near-copy ('similar' — the live dog-harness spray differed
  // only in greeting; SEO sprays swap the target domain per site) → auto-spam
  // (recoverable). Prior still-'new' copies are retro-bucketed for the same reason
  // as above. Guarded: only for non-newsletter forms with a real body, only when not
  // already spam, and the db helper ignores short bodies / small token sets.
  // Best-effort — a lookup failure never blocks a lead.
  if (
    status !== "spam_auto" &&
    n.formType !== "newsletter" &&
    n.message !== undefined &&
    deps.findRecentDuplicates
  ) {
    try {
      const since = new Date(deps.now().getTime() - DUPLICATE_WINDOW_MS);
      const dupes = await deps.findRecentDuplicates(n.message, since);
      const reason =
        dupes.exact.length > 0
          ? "duplicate-body"
          : dupes.similar.length > 0
            ? "similar-body"
            : null;
      if (reason !== null) {
        status = "spam_auto";
        if (!reasons.includes(reason)) reasons.push(reason);
        const retroIds = [...dupes.exact, ...dupes.similar]
          .filter((m) => m.status === "new")
          .map((m) => m.id);
        if (deps.retroBucket && retroIds.length > 0) {
          try {
            await deps.retroBucket(retroIds, "retro:duplicate-body");
          } catch (err) {
            console.error(`[ingest] retroBucket (duplicate-body) threw: ${String(err)}`);
          }
        }
      }
    } catch (err) {
      console.error(`[ingest] findRecentDuplicates threw: ${String(err)}`);
    }
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

/** True when `a` and `b` are the same host or one is a subdomain of the other
 *  (case-insensitive): `www.reddoorla.com` vs `reddoorla.com` matches both ways.
 *  Exported for tests. PURE. */
export function hostsMatch(a: string, b: string): boolean {
  const ha = a.trim().toLowerCase();
  const hb = b.trim().toLowerCase();
  if (ha.length === 0 || hb.length === 0) return false;
  return ha === hb || ha.endsWith(`.${hb}`) || hb.endsWith(`.${ha}`);
}

/** Whether a passing token's solved-hostname is acceptable for the site at `siteUrl`.
 *  An unparseable/hostless `siteUrl` returns TRUE — the check self-disables rather
 *  than punishing a possibly-real visitor for an operator data problem (fail-open,
 *  same philosophy as verifyTurnstile). PURE. */
export function turnstileHostnameAcceptable(tokenHostname: string, siteUrl: string): boolean {
  let siteHost: string;
  try {
    siteHost = new URL(siteUrl).hostname;
  } catch {
    return true;
  }
  if (!siteHost) return true;
  return hostsMatch(tokenHostname, siteHost);
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
