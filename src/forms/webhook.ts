import type { SubmissionRow } from "../reports/submission-row.js";
import type { WebsiteRow } from "../fleet/site-row.js";
import { isPublicHttpsUrl } from "../util/url.js";

export type WebhookForwardResult = { ok: boolean; status: number };

/** The JSON body POSTed to a site's newsletter webhook (e.g. a Zapier Catch
 *  Hook). Lean, newsletter-relevant fields; the Zap maps them downstream. */
export function buildNewsletterWebhookBody(
  submission: SubmissionRow,
  site: WebsiteRow,
): Record<string, unknown> {
  return {
    email: submission.email,
    name: submission.name,
    formType: submission.formType,
    site: site.name,
    sourceUrl: submission.sourceUrl,
    utm: submission.utm,
    submittedAt: submission.submittedAt,
  };
}

/**
 * POST a newsletter submission to a site-configured webhook. NEVER throws — a
 * disallowed URL, non-2xx response, or network error returns `{ ok: false }` so
 * the caller treats it as a swallowed side-effect. Only PUBLIC https URLs are
 * allowed (the URL is operator-set in the site details, but this is a server-side egress
 * — so an internal/loopback/private host is refused as an SSRF guard), and a
 * redirect is refused rather than followed (see {@link postJson}).
 */
export async function forwardNewsletterToWebhook(
  url: string,
  submission: SubmissionRow,
  site: WebsiteRow,
  fetchImpl: typeof fetch = fetch,
): Promise<WebhookForwardResult> {
  return postJson(
    url,
    buildNewsletterWebhookBody(submission, site),
    site,
    "newsletter-webhook",
    fetchImpl,
  );
}

/**
 * The JSON body POSTed to a site's FORM webhook (`sites.form_webhook`): the
 * whole submission, for a client who builds their own CRM side (Gallery Sonder's
 * Salesforce, via a Zapier/Make hook, 2026-11-09). Unlike the lean newsletter
 * body above, it carries everything ingest stored: phone, message, and the
 * site's own fields (`fields`, e.g. an inquiry's `piece`/`artist`/`role`, an
 * RSVP's `event`/`guests`, an appointment's `company`/`appointment_date`/
 * `appointment_time`), plus the UTM tags both as the stored query string and
 * split into `utm_*` keys, so a campaign field maps without parsing.
 *
 * Every key is always present. phone, message, sourceUrl, utm and the utm_*
 * keys are `null` when absent; name and email are as stored, so a form that did
 * not ask for one sends "". `fields` leaves out ingest's own bookkeeping (keys
 * starting with `_`, such as the autoresponder copy `_reply`, and the composed-
 * message flags `composedMessage`/`visitorText`), which is not the visitor's
 * data and must not become a client contract. The newsletter body is deliberately NOT
 * changed: sites already wired to it keep receiving exactly what they map today.
 */
export function buildFormWebhookBody(
  submission: SubmissionRow,
  site: WebsiteRow,
): Record<string, unknown> {
  const utm = parseUtm(submission.utm);
  return {
    id: submission.id,
    formType: submission.formType,
    site: site.name,
    name: submission.name,
    email: submission.email,
    phone: submission.phone ?? null,
    message: submission.message ?? null,
    fields: parseExtraFields(submission.extraFields),
    sourceUrl: submission.sourceUrl ?? null,
    utm: submission.utm ?? null,
    utm_source: utm.get("utm_source"),
    utm_medium: utm.get("utm_medium"),
    utm_campaign: utm.get("utm_campaign"),
    utm_term: utm.get("utm_term"),
    utm_content: utm.get("utm_content"),
    submittedAt: submission.submittedAt,
  };
}

/** Keys ingest itself writes into `extra_fields` (ingest.ts storedExtraFields). */
const INTERNAL_FIELD_KEYS: ReadonlySet<string> = new Set(["composedMessage", "visitorText"]);

/** The stored `extra_fields` JSON as an object, minus ingest's bookkeeping; `{}` for null or anything that
 *  is not a JSON object (a malformed cell must never stop the forward). PURE. */
function parseExtraFields(raw: string | null): Record<string, unknown> {
  if (raw === null || raw.trim() === "") return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter(
        ([k]) => !k.startsWith("_") && !INTERNAL_FIELD_KEYS.has(k),
      ),
    );
  } catch {
    return {};
  }
}

/** The stored `utm` query string, read one key at a time (null when absent). */
function parseUtm(raw: string | null): { get: (key: string) => string | null } {
  const params = new URLSearchParams(raw ?? "");
  return { get: (key) => params.get(key) };
}

/** POST a submission of any opted-in form type to the site's form webhook. Same
 *  contract as {@link forwardNewsletterToWebhook}: never throws, and the same
 *  public-https SSRF guard. */
export async function forwardFormToWebhook(
  url: string,
  submission: SubmissionRow,
  site: WebsiteRow,
  fetchImpl: typeof fetch = fetch,
): Promise<WebhookForwardResult> {
  return postJson(url, buildFormWebhookBody(submission, site), site, "form-webhook", fetchImpl);
}

/**
 * The one POST every webhook forwarder goes through. `isPublicHttpsUrl` judges
 * only the URL it is given, so a redirect is REFUSED, never followed: with
 * fetch's default `redirect: "follow"` a public https host answering 307/308
 * with `Location: http://169.254.169.254/…` gets the whole body re-POSTed to an
 * address the guard never saw (#1970). `"manual"` returns the 3xx itself, which
 * the caller records as `webhook:<3xx>` / `form-webhook:<3xx>`. It lives here,
 * not in each forwarder, so no forwarder can follow by leaving it out.
 *
 * Refusing rather than walking the chain with the guard on each hop (as the
 * prospect crawler's GETs do) because a forward has nothing to gain from a
 * follow: a 301/302/303 turns the POST into a body-less GET, and only a 307/308
 * carries the body on, which is exactly the case the guard exists for.
 */
async function postJson(
  url: string,
  body: Record<string, unknown>,
  site: WebsiteRow,
  label: string,
  fetchImpl: typeof fetch,
): Promise<WebhookForwardResult> {
  if (!isPublicHttpsUrl(url)) {
    console.error(`[${label}] refusing non-public/non-https url for site=${site.name}`);
    return { ok: false, status: 0 };
  }
  try {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      redirect: "manual",
    });
    return { ok: res.ok, status: res.status };
  } catch (err) {
    console.error(`[${label}] forward failed for site=${site.name}: ${String(err)}`);
    return { ok: false, status: 0 };
  }
}
