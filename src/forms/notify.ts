import type { WebsiteRow } from "../reports/airtable/websites.js";
import type { SubmissionRow, NotifyStatus } from "../reports/airtable/submissions.js";
import type { ResendSendInput } from "../reports/send/resend.js";
import { escapeHtml } from "../util/html.js";

const FORMS_FROM = "forms@reddoorla.com";
const FALLBACK_REPLY_TO = "info@reddoorla.com";

// Single-operator fleet fallback when OPERATOR_EMAIL is unset. Deliberately the
// monitored personal inbox (not the digest's info@ alias) — a missed pre-launch
// LEAD is higher-stakes than a missed digest, so it should land somewhere watched.
const OPERATOR_FALLBACK = "tucker@reddoorla.com";

function operatorEmail(): string {
  return process.env.OPERATOR_EMAIL?.trim() || OPERATOR_FALLBACK;
}

/** Strip characters that would break an RFC 5322 display name. */
function displayName(raw: string): string {
  return raw.replace(/["\r\n]/g, "").trim() || "Reddoor";
}

function pocAddress(site: WebsiteRow): string | null {
  return site.pointOfContact ?? site.reportRecipientsTo ?? null;
}

/**
 * Where a submission notification goes. Pre-launch sites (anything not yet in
 * "maintenance") route to the operator, who is monitoring them; once a site is in
 * maintenance, leads go to its client POC (null → notify skips).
 */
function notifyRecipient(site: WebsiteRow): string | null {
  if (site.status !== "maintenance") return operatorEmail();
  return pocAddress(site);
}

/** Humanize an extraFields key for display: "appointment_date" → "Appointment date". */
function humanizeKey(k: string): string {
  const spaced = k.replace(/[_-]+/g, " ").trim();
  return spaced ? spaced.charAt(0).toUpperCase() + spaced.slice(1) : k;
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return JSON.stringify(v);
}

/**
 * Parse the stored `extraFields` JSON into label/value pairs for the email. This
 * is the site-specific context a recipient most needs — the artwork an inquiry is
 * about, the event an rsvp is for, the company on a contact — which would
 * otherwise only live in the Airtable record. Bad JSON or a non-object yields no
 * rows (never throws); empty-string values are dropped.
 */
function extraFieldRows(raw: string | null): Array<[string, string]> {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [];
  return Object.entries(parsed as Record<string, unknown>)
    .filter(([, v]) => !(typeof v === "string" && v.trim() === ""))
    .map(([k, v]) => [humanizeKey(k), formatValue(v)] as [string, string]);
}

function fieldsTable(submission: SubmissionRow): string {
  const rows: Array<[string, string]> = [
    ["Form", submission.formType],
    ["Name", submission.name || "—"],
    ["Email", submission.email || "—"],
  ];
  if (submission.phone) rows.push(["Phone", submission.phone]);
  // Site-specific context (the artwork an inquiry is about, the event an rsvp is
  // for, etc.) lives in extraFields — surface it so the recipient sees what the
  // submitter was looking at, not just their name and email.
  rows.push(...extraFieldRows(submission.extraFields));
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
  const to = notifyRecipient(site);
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
    replyTo: notifyRecipient(site) ?? FALLBACK_REPLY_TO,
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

/**
 * Build the ingest `notify` dependency from a Resend send fn — or `null` when the
 * Resend client couldn't even be constructed (e.g. `RESEND_API_KEY` unset). A null
 * send marks the notification `failed` WITHOUT attempting it, so a Resend
 * misconfiguration degrades to a captured-but-unemailed lead rather than aborting
 * ingest and losing it. Mirrors the in-flight failure isolation in notifySubmission.
 */
export function makeNotify(
  send: NotifyDeps["send"] | null,
): (site: WebsiteRow, submission: SubmissionRow) => Promise<NotifyOutcome> {
  return (site, submission) =>
    send
      ? notifySubmission({ send }, site, submission)
      : Promise.resolve({ status: "failed", messageId: null });
}
