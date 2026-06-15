import type { WebsiteRow } from "../reports/airtable/websites.js";
import type {
  SubmissionRow,
  SubmissionInput,
  NotifyStatus,
} from "../reports/airtable/submissions.js";
import { normalizeSubmission } from "./payload.js";

export type IngestDeps = {
  getWebsiteBySlug: (slug: string) => Promise<WebsiteRow | null>;
  createSubmission: (input: SubmissionInput) => Promise<SubmissionRow>;
  notify: (
    site: WebsiteRow,
    submission: SubmissionRow,
  ) => Promise<{ status: NotifyStatus; messageId: string | null }>;
  stampNotified: (id: string, status: NotifyStatus, messageId: string | null) => Promise<void>;
  now: () => Date;
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

/**
 * Normalize → resolve site → persist → notify → stamp. The order is load-bearing:
 * the row is written BEFORE notify, and notify/stamp failures are swallowed (logged)
 * so a Resend or Airtable-write-back hiccup can never turn an accepted lead into a 502.
 */
export async function ingestSubmission(
  deps: IngestDeps,
  slug: string,
  rawPayload: unknown,
): Promise<IngestResult> {
  const normalized = normalizeSubmission(rawPayload);
  if (!normalized.ok) {
    return { status: "rejected", reason: "invalid-payload", errors: normalized.errors };
  }
  const site = await deps.getWebsiteBySlug(slug);
  if (!site) return { status: "unknown-site", slug };

  const n = normalized.value;
  const row = await deps.createSubmission({
    siteId: site.id,
    formType: n.formType,
    name: n.name,
    email: n.email,
    extraFields: n.extraFields,
    // Optional fields spread only when present — exactOptionalPropertyTypes
    // forbids assigning `undefined` to an optional `phone?: string` etc.
    ...(n.phone !== undefined ? { phone: n.phone } : {}),
    ...(n.message !== undefined ? { message: n.message } : {}),
    ...(n.sourceUrl !== undefined ? { sourceUrl: n.sourceUrl } : {}),
    ...(n.utm !== undefined ? { utm: n.utm } : {}),
    submittedAt: deps.now(),
  });

  let notify: { status: NotifyStatus; messageId: string | null };
  try {
    notify = await deps.notify(site, row);
  } catch (err) {
    console.error(`[ingest] notify threw: ${String(err)}`);
    notify = { status: "failed", messageId: null };
  }
  try {
    await deps.stampNotified(row.id, notify.status, notify.messageId);
  } catch (err) {
    console.error(`[ingest] stampNotified failed: ${String(err)}`);
  }

  // Newsletter fan-out: each configured destination fires best-effort and is
  // swallowed+logged — the lead is already persisted; never turn it into a 502.
  if (n.formType === "newsletter") {
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
