// src/alerts/digest-state.ts
import type { AttentionItem } from "../reports/digest.js";

/**
 * The persisted prior-run snapshot: stable item `key` → its last metric + the
 * date it was FIRST flagged. Lives as JSON in the single "Digest State" Airtable
 * row (the IO that loads/stores it — readDigestState/writeDigestState — is added
 * in component 2). `next` from diffAttention is what gets written back.
 */
export type DigestSnapshot = Record<string, { metric: number; firstFlaggedAt: string }>;

/**
 * PURE diff — the testable core of the hybrid "snapshot now, mark what's new".
 * For each current item vs the prior snapshot:
 *   - key absent from prior            → NEW      (firstFlaggedAt = today)
 *   - present and metric > prior.metric → WORSE    (keep the original firstFlaggedAt)
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
    let status: AttentionItem["status"];
    let firstFlaggedAt: string;
    if (!was) {
      status = "new";
      firstFlaggedAt = today;
    } else if (it.metric > was.metric) {
      status = "worse";
      firstFlaggedAt = was.firstFlaggedAt;
    } else {
      status = "standing";
      firstFlaggedAt = was.firstFlaggedAt;
    }
    tagged.push({ ...it, status });
    next[it.key] = { metric: it.metric, firstFlaggedAt };
  }
  return { tagged, next };
}
