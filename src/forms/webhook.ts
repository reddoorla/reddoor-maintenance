import type { SubmissionRow } from "../reports/submission-row.js";
import type { WebsiteRow } from "../reports/airtable/websites.js";
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
 * allowed (the URL is operator-set in Airtable, but this is a server-side egress
 * — so an internal/loopback/private host is refused as an SSRF guard).
 */
export async function forwardNewsletterToWebhook(
  url: string,
  submission: SubmissionRow,
  site: WebsiteRow,
  fetchImpl: typeof fetch = fetch,
): Promise<WebhookForwardResult> {
  if (!isPublicHttpsUrl(url)) {
    console.error(`[newsletter-webhook] refusing non-public/non-https url for site=${site.name}`);
    return { ok: false, status: 0 };
  }
  try {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(buildNewsletterWebhookBody(submission, site)),
    });
    return { ok: res.ok, status: res.status };
  } catch (err) {
    console.error(`[newsletter-webhook] forward failed for site=${site.name}: ${String(err)}`);
    return { ok: false, status: 0 };
  }
}
