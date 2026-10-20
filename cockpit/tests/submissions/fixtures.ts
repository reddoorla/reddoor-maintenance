import type {
  SubmissionsPageModel,
  SubmissionView,
} from "../../../src/dashboard/submissions-page.js";
import { makeSubmissionRow } from "../../../tests/_helpers/submission-row.js";

/** Shared /submissions inputs for the parity and DOM tests: one row of every
 *  shape the row renderer branches on. */
export function view(over: Partial<SubmissionView> = {}): SubmissionView {
  return { ...makeSubmissionRow(), siteName: "Site A", slug: "site-a", ...over };
}

export const ROWS: SubmissionView[] = [
  view({ id: "sub_plain", notifyStatus: "sent", message: null }),
  view({
    id: "sub_full",
    phone: "+1 555 0100",
    message: "Line one\nLine two <b>bold</b> & 'quoted'",
    sourceUrl: "https://acme.example/contact?x=1&y=2",
    utm: "utm_source=google",
    extraFields: JSON.stringify({ budget: "10k", "<k>": 'v"1' }),
    resendMessageId: "re_123",
    submissionId: 42,
    status: "read",
    notifyStatus: "sent",
  }),
  view({ id: "sub_badjson", extraFields: "{not json", status: "archived" }),
  view({ id: "sub_arrayjson", extraFields: "[1,2]" }),
  view({
    id: "sub_auto",
    status: "spam_auto",
    spamScore: 7,
    spamReason: "turnstile-required-absent, keywords:4, link-heavy, caps",
  }),
  view({ id: "sub_auto_noreason", status: "spam_auto", spamScore: 3, spamReason: null }),
  view({ id: "sub_scored", status: "new", spamScore: 2, spamReason: "short" }),
  view({ id: "sub_reason_only", status: "spam", spamScore: null, spamReason: "manual" }),
  view({
    id: "sub_bounce_perm",
    notifyStatus: "bounced",
    bounceType: "Permanent",
    bounceSubType: "Suppressed",
    bounceMessage: "550 mailbox unavailable",
  }),
  view({ id: "sub_bounce_trans", notifyStatus: "bounced", bounceType: "Transient" }),
  view({ id: "sub_bounce_none", notifyStatus: "bounced" }),
  view({
    id: "sub_bounce_acked",
    notifyStatus: "bounced",
    bounceType: "Permanent",
    bounceAckAt: "2026-10-01T00:00:00.000Z",
  }),
  view({
    id: "sub_fanout",
    formType: "newsletter",
    fanoutStatus: "webhook:ok,mailchimp:error,crm:timeout",
  }),
  view({ id: "sub_fanout_ok", formType: "newsletter", fanoutStatus: "webhook:ok" }),
  view({ id: "sub_noname", name: "", email: "", submittedAt: null }),
  view({
    id: "sub_hostile",
    name: "<img src=x onerror=alert(1)>",
    siteName: "<script>x</script>",
    slug: "x",
  }),
  view({ id: "sub_noslug", siteName: "recGONE", slug: "" }),
  view({ id: "sub/odd id", sourceUrl: "javascript:alert(1)" }),
];

export function model(over: Partial<SubmissionsPageModel> = {}): SubmissionsPageModel {
  return {
    rows: ROWS,
    sites: [
      { slug: "site-a", name: "Site A" },
      { slug: "site-b", name: 'Site <B> & "co"' },
    ],
    filter: { site: "", type: "", status: "", q: "", from: "", to: "", reason: "" },
    page: 1,
    pageSize: 50,
    total: ROWS.length,
    facetReasons: [],
    markableNewCount: 0,
    ...over,
  };
}
