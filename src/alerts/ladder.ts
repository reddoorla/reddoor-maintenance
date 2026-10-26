/**
 * P1-78b: the severity ladder (workspace plans/2026-10-26-cockpit-for-the-team/plan.md,
 * "The severity ladder", answered by the operator on 10-26). One pure function
 * places every alarm item, so the cockpit, the triage feed, pm-cockpit and (from
 * P1-78d) the digest read the same level:
 *
 * - **Broken**: someone outside Reddoor is affected on a live site right now.
 * - **Attention**: fix this week. Nobody outside sees it yet, but it will get worse
 *   or it blocks something.
 * - **Watch**: housekeeping. The machinery is handling it, or it is slow drift.
 *
 * Setup is not a level: it never moves a site's verdict.
 */
import type { AttentionItem } from "./attention.js";

export type Level = "broken" | "attention" | "watch";

/** Worst first. */
export const LEVEL_RANK: Record<Level, number> = { broken: 0, attention: 1, watch: 2 };

/** A Renovate PR red this many days or more rises from Watch to Attention. */
export const RENOVATE_ATTENTION_DAYS = 7;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Whole calendar days from `firstFlaggedAt` (a `YYYY-MM-DD` day, or an ISO time)
 *  to `now`'s UTC day. Undated reads as 0: a signal with no record is new today. */
export function daysFlagged(firstFlaggedAt: string | undefined, now: Date): number {
  if (firstFlaggedAt === undefined) return 0;
  const start = Date.parse(firstFlaggedAt.slice(0, 10));
  if (!Number.isFinite(start)) return 0;
  const today = Date.parse(now.toISOString().slice(0, 10));
  return Math.max(0, Math.floor((today - start) / MS_PER_DAY));
}

/**
 * The item's place on the ladder. `firstFlaggedAt` is the digest snapshot's (via
 * `diffAttention`'s `next`), the only clock an item has; only Renovate reads it.
 * PURE.
 */
export function levelOf(
  it: Pick<AttentionItem, "kind" | "key">,
  firstFlaggedAt: string | undefined,
  now: Date,
): Level {
  switch (it.kind) {
    case "deploy":
    case "deadletter":
    case "notify-bounce":
    case "turnstile":
      return "broken";
    case "url":
      // `url-unresolved:<id>` is a dead roster url; the fleet-wide `url-probe-stale`
      // is the probe itself falling behind, which silently stales every one of them.
      return it.key === "url-probe-stale" ? "attention" : "broken";
    case "vuln":
    case "preflight":
    case "delivery":
    case "ci":
    case "lighthouse":
    case "analytics":
      return "attention";
    case "prismic-drift":
      // Three flavours share the kind: a real divergence is Attention; the check
      // that could not run, or has gone stale, is monitor health.
      return it.key.startsWith("prismic-drift:") ? "attention" : "watch";
    case "renovate":
      return daysFlagged(firstFlaggedAt, now) >= RENOVATE_ATTENTION_DAYS ? "attention" : "watch";
  }
}

/** The worst level among items, or null for none. */
export function worstLevel(items: ReadonlyArray<{ level?: Level }>): Level | null {
  let worst: Level | null = null;
  for (const it of items) {
    const l = it.level ?? null;
    if (l !== null && (worst === null || LEVEL_RANK[l] < LEVEL_RANK[worst])) worst = l;
  }
  return worst;
}

/** Set each item's `level`, and its `firstFlaggedAt` (its age on the triage page),
 *  from the diff's next snapshot. */
export function withLevels<T extends AttentionItem>(
  items: readonly T[],
  next: Readonly<Record<string, { firstFlaggedAt: string }>>,
  now: Date,
): T[] {
  return items.map((it) => {
    const first = next[it.key]?.firstFlaggedAt;
    return {
      ...it,
      level: levelOf(it, first, now),
      ...(first !== undefined ? { firstFlaggedAt: first } : {}),
    };
  });
}
