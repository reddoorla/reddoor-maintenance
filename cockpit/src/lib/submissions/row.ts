import type { SubmissionRow } from "../../../../src/reports/submission-row.js";

/**
 * The pure parts of one submission row, ported from
 * src/dashboard/submission-view.ts (#582) so the row component computes exactly
 * what the string renderer did. Client-safe: no server-only imports.
 */

/** The inline chip shows at most this many reason tokens; a long classifier trail
 *  must not blow up the summary line. The full list stays in the badge tooltip and
 *  the expanded Spam row. */
const REASON_CHIP_MAX_TOKENS = 3;

/** Split a comma-joined spam_reason string into its reason tokens. */
export function spamReasonTokens(reason: string | null | undefined): string[] {
  return (reason ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t !== "");
}

export function reasonChipText(tokens: string[]): string {
  const shown = tokens.slice(0, REASON_CHIP_MAX_TOKENS).join(" · ");
  const more = tokens.length - REASON_CHIP_MAX_TOKENS;
  return more > 0 ? `${shown} +${more} more` : shown;
}

/** The fan-out tokens that did NOT succeed: one `<destination>:<outcome>` token
 *  per attempt, `ok` being the only good outcome. */
export function fanoutFailures(fanoutStatus: string | null | undefined): string[] {
  return (fanoutStatus ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t !== "" && !t.endsWith(":ok"));
}

/** `extraFields` JSON as key/value pairs; on a parse failure (or a non-object)
 *  the raw string, rather than dropping it. Null when blank. */
export type ExtraFields =
  { kind: "pairs"; pairs: Array<[string, string]> } | { kind: "raw"; raw: string };
export function extraFields(raw: string | null): ExtraFields | null {
  if (!raw || raw.trim() === "") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { kind: "raw", raw };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { kind: "raw", raw };
  return {
    kind: "pairs",
    pairs: Object.entries(parsed as Record<string, unknown>).map(([k, v]) => [k, String(v)]),
  };
}

export type BounceView = { acked: boolean; title: string; text: string };

/** The bounce chip on the summary line (#783: it carries Resend's own
 *  classification). Null unless the notification bounced. */
export function bounceView(s: SubmissionRow): BounceView | null {
  if (s.notifyStatus !== "bounced") return null;
  const permanent = (s.bounceType ?? "").toLowerCase() === "permanent";
  const acked = typeof s.bounceAckAt === "string" && s.bounceAckAt !== "";
  const label = s.bounceSubType ?? s.bounceType ?? null;
  const title = permanent
    ? "The lead notification email bounced — the point-of-contact address may be dead"
    : label !== null
      ? "The receiving server refused this message — the client's mail filter is rejecting lead notifications, which is not the same as a dead address"
      : "The lead notification email bounced — Resend recorded no classification for it";
  const text = `notify bounced${label !== null ? ` · ${label}` : ""}${acked ? " · acknowledged" : ""}`;
  return { acked, title, text };
}

/** The Spam detail row's text, for ANY scored row (not just spam_auto). */
export function spamDetail(s: SubmissionRow): string {
  const tokens = spamReasonTokens(s.spamReason);
  const hasScore = s.spamScore !== null && s.spamScore !== undefined;
  return hasScore
    ? tokens.length > 0
      ? `score ${s.spamScore} — ${tokens.join(", ")}`
      : `score ${s.spamScore}`
    : tokens.join(", ");
}

/** What a triage button POSTs to `/api/submissions/:id/status`. */
export type StatusAction = { ack: string } | { status: string };

export function statusUrl(id: string): string {
  return `/api/submissions/${encodeURIComponent(id)}/status`;
}
