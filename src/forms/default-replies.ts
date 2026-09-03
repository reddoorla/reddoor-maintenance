/**
 * What a confirmation email says when nobody has authored anything.
 *
 * Before this, every form type on every site sent one string — "We got your
 * message" over "Thanks for reaching out to {site}." A newsletter signup and a
 * price-list inquiry are not the same event, and reading as though they are is
 * the tell that nothing behind the form is paying attention.
 *
 * These are the floor, not the ceiling: a site that authors copy in its CMS
 * overrides them, and a site with the legacy per-site columns set still uses
 * those. The aim is that a fleet site with NO configuration at all still sends
 * something a person would recognise as a real reply.
 *
 * Deliberately plain and brand-neutral — they stand in for a client's voice
 * without impersonating it, and they must read acceptably for a law firm, a
 * gallery and a dentist alike.
 */
import type { FormType } from "./types.js";

export type DefaultReply = {
  subject: string;
  /** Plain paragraphs. Our own text, so no formatting and nothing to sanitize
   *  beyond the escaping every body gets. */
  paragraphs: [string, string];
};

const REPLIES: Record<FormType, (site: string) => DefaultReply> = {
  contact: (site) => ({
    subject: "We got your message",
    paragraphs: [
      `Thanks for getting in touch with ${site}.`,
      "We've received your message and someone will reply as soon as we can.",
    ],
  }),
  inquiry: (site) => ({
    subject: "Thanks for your inquiry",
    paragraphs: [
      `Thanks for your interest — your inquiry has reached the team at ${site}.`,
      "Someone will be in touch shortly with the details you asked about.",
    ],
  }),
  newsletter: (site) => ({
    // "Subscribed", not "on the list" — that phrasing belongs to the RSVP, and
    // a subject line that could mean either is worse than a plain one. Accurate
    // for single opt-in, which is what the Mailchimp fan-out does today.
    subject: "You're subscribed",
    paragraphs: [
      `Thanks for subscribing to updates from ${site}.`,
      "You'll hear from us when there's something worth sharing, and you can unsubscribe from any email.",
    ],
  }),
  rsvp: (site) => ({
    // The event name, when the submission carries one, beats this in notify.ts.
    subject: "You're on the list",
    paragraphs: [
      `Thanks for your RSVP — ${site} has you down.`,
      "We'll be in touch if anything changes before the day.",
    ],
  }),
  reserve: (site) => ({
    subject: "We've got your reservation request",
    paragraphs: [
      `Thanks — ${site} has received your reservation request.`,
      "We'll confirm the details with you shortly.",
    ],
  }),
};

/** The default reply for a form type. An unrecognized type gets the contact
 *  copy, which is the one wording that is true of any form: we received it. */
export function defaultReply(formType: string, siteName: string): DefaultReply {
  const build = REPLIES[formType as FormType] ?? REPLIES.contact;
  return build(siteName);
}
