import type { WebsiteRow } from "../reports/airtable/websites.js";
import type { SubmissionRow, NotifyStatus } from "../reports/airtable/submissions.js";
import type { ResendSendInput } from "../reports/send/resend.js";
import { escapeHtml } from "../util/html.js";

const FORMS_FROM = "forms@reddoorla.com";
const FALLBACK_REPLY_TO = "info@reddoorla.com";

/** Strip characters that would break an RFC 5322 display name. */
function displayName(raw: string): string {
  return raw.replace(/["\r\n]/g, "").trim() || "Reddoor";
}

function pocAddress(site: WebsiteRow): string | null {
  return site.pointOfContact ?? site.reportRecipientsTo ?? null;
}

function fieldsTable(submission: SubmissionRow): string {
  const rows: Array<[string, string]> = [
    ["Form", submission.formType],
    ["Name", submission.name || "—"],
    ["Email", submission.email || "—"],
  ];
  if (submission.phone) rows.push(["Phone", submission.phone]);
  if (submission.sourceUrl) rows.push(["Page", submission.sourceUrl]);
  if (submission.utm) rows.push(["UTM", submission.utm]);
  const body = rows
    .map(([k, v]) => `<tr><td><strong>${escapeHtml(k)}</strong></td><td>${escapeHtml(v)}</td></tr>`)
    .join("");
  const message = submission.message
    ? `<p style="white-space:pre-wrap">${escapeHtml(submission.message)}</p>`
    : "";
  return `<table>${body}</table>${message}`;
}

/** POC notification — the primary email; null when the site has no contact address. */
export function buildPocNotification(
  site: WebsiteRow,
  submission: SubmissionRow,
): ResendSendInput | null {
  const to = pocAddress(site);
  if (!to) return null;
  const input: ResendSendInput = {
    from: `${displayName(site.name)} Forms <${FORMS_FROM}>`,
    to: [to],
    subject: `New ${submission.formType} from ${site.name}`,
    html: `<h2>New ${escapeHtml(submission.formType)} submission — ${escapeHtml(
      site.name,
    )}</h2>${fieldsTable(submission)}`,
  };
  // Reply straight to the lead.
  if (submission.email) input.replyTo = submission.email;
  return input;
}

/** Autoresponder to the submitter — null when there's no submitter email. */
export function buildAutoresponder(
  site: WebsiteRow,
  submission: SubmissionRow,
): ResendSendInput | null {
  if (!submission.email) return null;
  const intro = site.copyIntro ?? `Thanks for reaching out to ${site.name}.`;
  const contact = site.copyContact ?? "We've received your message and will be in touch soon.";
  const footer = site.copyFooter ?? site.name;
  return {
    from: `${displayName(site.name)} <${FORMS_FROM}>`,
    to: [submission.email],
    replyTo: pocAddress(site) ?? FALLBACK_REPLY_TO,
    subject: "We got your message",
    html: `<p>${escapeHtml(intro)}</p><p>${escapeHtml(contact)}</p><p>${escapeHtml(footer)}</p>`,
  };
}

export type NotifyDeps = {
  send: (input: ResendSendInput) => Promise<{ messageId: string }>;
};

export type NotifyOutcome = { status: NotifyStatus; messageId: string | null };

/**
 * Send the POC notification (primary — drives notifyStatus) then the submitter
 * autoresponder (best-effort — logged, never changes the outcome). The submission
 * is already persisted before this runs, so a Resend outage degrades to
 * notifyStatus="failed", never a lost lead.
 */
export async function notifySubmission(
  deps: NotifyDeps,
  site: WebsiteRow,
  submission: SubmissionRow,
): Promise<NotifyOutcome> {
  const poc = buildPocNotification(site, submission);
  let outcome: NotifyOutcome;
  if (!poc) {
    outcome = { status: "skipped", messageId: null };
  } else {
    try {
      const { messageId } = await deps.send(poc);
      outcome = { status: "sent", messageId };
    } catch (err) {
      console.error(`[submissions] POC notification failed: ${String(err)}`);
      outcome = { status: "failed", messageId: null };
    }
  }
  const auto = buildAutoresponder(site, submission);
  if (auto) {
    try {
      await deps.send(auto);
    } catch (err) {
      console.error(`[submissions] autoresponder failed: ${String(err)}`);
    }
  }
  return outcome;
}
