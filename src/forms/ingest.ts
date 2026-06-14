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
    ...(n.phone !== undefined ? { phone: n.phone } : {}),
    ...(n.message !== undefined ? { message: n.message } : {}),
    ...(n.extraFields !== undefined ? { extraFields: n.extraFields } : {}),
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
  return { status: "accepted", submissionId: row.id, notifyStatus: notify.status };
}
