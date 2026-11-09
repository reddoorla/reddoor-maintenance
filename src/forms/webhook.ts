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
 * — so an internal/loopback/private host is refused as an SSRF guard).
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
 * Absent values are `null`, never missing, so a hook's field mapping sees a
 * stable shape whichever form fired. The newsletter body is deliberately NOT
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

/** The stored `extra_fields` JSON as an object; `{}` for null or anything that
 *  is not a JSON object (a malformed cell must never stop the forward). PURE. */
function parseExtraFields(raw: string | null): Record<string, unknown> {
  if (raw === null || raw.trim() === "") return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
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
    });
    return { ok: res.ok, status: res.status };
  } catch (err) {
    console.error(`[${label}] forward failed for site=${site.name}: ${String(err)}`);
    return { ok: false, status: 0 };
  }
}
