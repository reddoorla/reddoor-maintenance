import type { SubmissionRow } from "../../../../src/reports/submission-row.js";
import { relativeTimeFromNow } from "../../../../src/dashboard/relative-time.js";
import { fanoutFailures } from "../../../../src/dashboard/submission-rules.js";
import { safeUrl } from "../../../../src/util/html.js";

/**
 * One submission row, every derived string computed on the server (#582), so
 * the row component holds markup and behaviour only. Mirrors
 * `renderSubmissionRowInner` in src/dashboard/submission-view.ts field for field.
 */
export type SubmissionDetail =
  | { kind: "kv"; label: string; value: string }
  | { kind: "message"; text: string }
  | { kind: "source"; href: string; text: string }
  | { kind: "raw-extra"; raw: string };

export type SubmissionStatusButton =
  { label: string; status: string } | { label: string; ack: string };

export type SubmissionRowView = {
  id: string;
  url: string;
  formType: string;
  who: string;
  email: string;
  status: string;
  when: string;
  /** Auto-spam provenance (only a scored `spam_auto` row): the badge and its reason chip. */
  provenance: { title: string; score: string; reasons: string | null } | null;
  bounce: { acked: boolean; title: string; text: string } | null;
  fanout: string | null;
  details: SubmissionDetail[];
  buttons: SubmissionStatusButton[];
};

function spamReasonTokens(reason: string | null | undefined): string[] {
  return (reason ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t !== "");
}

/** The inline chip shows at most this many reason tokens; the full list stays
 *  in the badge tooltip and the expanded Spam row. */
const REASON_CHIP_MAX_TOKENS = 3;

function reasonChipText(tokens: string[]): string {
  const shown = tokens.slice(0, REASON_CHIP_MAX_TOKENS).join(" · ");
  const more = tokens.length - REASON_CHIP_MAX_TOKENS;
  return more > 0 ? `${shown} +${more} more` : shown;
}

function extraFields(raw: string | null): SubmissionDetail[] {
  if (!raw || raw.trim() === "") return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [{ kind: "raw-extra", raw }];
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return [{ kind: "raw-extra", raw }];
  }
  return Object.entries(parsed as Record<string, unknown>).map(([k, v]) => ({
    kind: "kv" as const,
    label: k,
    value: String(v),
  }));
}

export function buildSubmissionRowView(
  s: SubmissionRow,
  now: Date = new Date(),
): SubmissionRowView {
  const reasonTokens = spamReasonTokens(s.spamReason);
  const provenance =
    s.status === "spam_auto" && s.spamScore !== null && s.spamScore !== undefined
      ? {
          title: s.spamReason ?? "",
          score: String(s.spamScore),
          reasons: reasonTokens.length > 0 ? reasonChipText(reasonTokens) : null,
        }
      : null;

  const bouncePermanent = (s.bounceType ?? "").toLowerCase() === "permanent";
  const bounceAcked = typeof s.bounceAckAt === "string" && s.bounceAckAt !== "";
  const bounceLabel = s.bounceSubType ?? s.bounceType ?? null;
  const bounceTitle = bouncePermanent
    ? "The lead notification email bounced — the point-of-contact address may be dead"
    : bounceLabel !== null
      ? "The receiving server refused this message — the client's mail filter is rejecting lead notifications, which is not the same as a dead address"
      : "The lead notification email bounced — Resend recorded no classification for it";
  const bounce =
    s.notifyStatus === "bounced"
      ? {
          acked: bounceAcked,
          title: bounceTitle,
          text: `notify bounced${bounceLabel !== null ? ` · ${bounceLabel}` : ""}${
            bounceAcked ? " · acknowledged" : ""
          }`,
        }
      : null;

  const fanoutBad = fanoutFailures(s.fanoutStatus);

  const details: SubmissionDetail[] = [];
  const kv = (label: string, value: string | number | null) => {
    if (value === null || value === "") return;
    details.push({ kind: "kv", label, value: String(value) });
  };
  const hasScore = s.spamScore !== null && s.spamScore !== undefined;
  const spamDetail = hasScore
    ? reasonTokens.length > 0
      ? `score ${s.spamScore} — ${reasonTokens.join(", ")}`
      : `score ${s.spamScore}`
    : reasonTokens.join(", ");
  kv("Phone", s.phone);
  if (s.message) details.push({ kind: "message", text: s.message });
  if (s.sourceUrl) details.push({ kind: "source", href: safeUrl(s.sourceUrl), text: s.sourceUrl });
  kv("UTM", s.utm);
  details.push(...extraFields(s.extraFields));
  kv("Spam", spamDetail);
  kv("Notify", s.notifyStatus);
  kv("Bounce", [s.bounceType, s.bounceSubType].filter((x) => !!x).join(" / "));
  kv("Bounce message", s.bounceMessage ?? null);
  kv("Bounce acknowledged", s.bounceAckAt ?? null);
  kv("Fan-out", s.fanoutStatus ?? null);
  kv("Resend ID", s.resendMessageId);
  kv("Submission #", s.submissionId);

  const buttons: SubmissionStatusButton[] = [];
  if (s.status === "spam_auto") buttons.push({ label: "Not spam → new", status: "new" });
  // The bounce acknowledge is offered ONLY on an unacknowledged bounce, so it can
  // never become a general-purpose way to quiet a row (#783).
  if (s.notifyStatus === "bounced" && !bounceAcked) {
    buttons.push({ label: "Not dead — acknowledge", ack: "notify-bounce" });
  }
  buttons.push(
    { label: "Read", status: "read" },
    { label: "Archive", status: "archived" },
    { label: "Spam", status: "spam" },
  );

  return {
    id: s.id,
    url: `/api/submissions/${encodeURIComponent(s.id)}/status`,
    formType: s.formType,
    who: s.name || "(no name)",
    email: s.email || "",
    status: s.status,
    when: s.submittedAt ? relativeTimeFromNow(s.submittedAt, now) : "—",
    provenance,
    bounce,
    fanout: fanoutBad.length > 0 ? fanoutBad.join(" · ") : null,
    details,
    buttons,
  };
}
