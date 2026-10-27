// src/alerts/digest-state.ts
import type { AttentionItem } from "./attention.js";

/**
 * The persisted prior-run snapshot: stable item `key` → its last metric + the
 * date it was FIRST flagged. Lives as JSON in Turso's digest_state row (see
 * src/db/digest-state.ts). `next` from diffAttention is what gets written back.
 * `exhausted` is carried only for vuln keys whose Renovate auto-fix has been
 * exhausted (absent = not exhausted; older snapshots without the field read the
 * same way).
 */
export type DigestSnapshot = Record<
  string,
  { metric: number; firstFlaggedAt: string; exhausted?: boolean }
>;

/**
 * PURE diff — the testable core of the hybrid "snapshot now, mark what's new".
 * For each current item vs the prior snapshot:
 *   - key absent from prior            → NEW      (firstFlaggedAt = today)
 *   - present and metric > prior.metric → WORSE    (keep the original firstFlaggedAt)
 *   - present and autoFixExhausted flipped on → WORSE (the count didn't move, but
 *     "Renovate gave up" is an escalation — without this the digest's first mention
 *     of a vuln, which is gated on exhaustion, would arrive unbadged)
 *   - otherwise (equal or dropped)      → STANDING (keep the original firstFlaggedAt)
 * `next` contains EXACTLY the current items' keys: resolved keys drop out, so a
 * fixed-then-recurring problem re-news correctly. Neither input is mutated.
 */
export function diffAttention(
  items: AttentionItem[],
  prior: DigestSnapshot,
  today: string,
): { tagged: AttentionItem[]; next: DigestSnapshot } {
  const tagged: AttentionItem[] = [];
  const next: DigestSnapshot = {};
  for (const it of items) {
    const was = prior[it.key];
    const exhaustedFlip = it.autoFixExhausted === true && was?.exhausted !== true;
    let status: AttentionItem["status"];
    let firstFlaggedAt: string;
    if (!was) {
      status = "new";
      firstFlaggedAt = today;
    } else if (it.metric > was.metric || exhaustedFlip) {
      status = "worse";
      firstFlaggedAt = was.firstFlaggedAt;
    } else {
      status = "standing";
      firstFlaggedAt = was.firstFlaggedAt;
    }
    tagged.push({ ...it, status });
    next[it.key] = {
      metric: it.metric,
      firstFlaggedAt,
      ...(it.autoFixExhausted === true ? { exhausted: true } : {}),
    };
  }
  return { tagged, next };
}
