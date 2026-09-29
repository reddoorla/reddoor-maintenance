import type { AttentionItem } from "./attention.js";

export const DIGEST_HEARTBEAT_DAYS = 7;

export type DigestSendLog = {
  sentOn: string | null;
  keys: string[];
  readySince: Record<string, string>;
};

export const EMPTY_SEND_LOG: DigestSendLog = { sentOn: null, keys: [], readySince: {} };

export type SendDecision =
  | { send: true; reason: "first" | "changed" | "new" | "worse" | "heartbeat" }
  | { send: false; reason: "unchanged" };

export function daysBetween(fromDay: string, toDay: string): number {
  const from = Date.parse(`${fromDay.slice(0, 10)}T00:00:00Z`);
  const to = Date.parse(`${toDay.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return 0;
  return Math.max(0, Math.round((to - from) / 86_400_000));
}

export function ageLabel(days: number | undefined): string {
  if (days === undefined || days < 1) return "";
  return days === 1 ? "1 day" : `${days} days`;
}

export function decideDigestSend(
  keys: readonly string[],
  needsAttention: readonly AttentionItem[],
  log: DigestSendLog,
  today: string,
): SendDecision {
  if (log.sentOn === null) return { send: true, reason: "first" };
  const now = new Set(keys);
  const then = new Set(log.keys);
  if (now.size !== then.size || [...now].some((k) => !then.has(k))) {
    return { send: true, reason: "changed" };
  }
  if (needsAttention.some((it) => it.status === "new")) return { send: true, reason: "new" };
  if (needsAttention.some((it) => it.status === "worse")) return { send: true, reason: "worse" };
  if (daysBetween(log.sentOn, today) >= DIGEST_HEARTBEAT_DAYS) {
    return { send: true, reason: "heartbeat" };
  }
  return { send: false, reason: "unchanged" };
}

export function nextReadySince(
  readyKeys: readonly string[],
  prior: Record<string, string>,
  today: string,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of readyKeys) out[k] = prior[k] ?? today;
  return out;
}

export function coerceSendLog(raw: unknown): DigestSendLog {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return EMPTY_SEND_LOG;
  const o = raw as Record<string, unknown>;
  const sentOn = typeof o.sentOn === "string" ? o.sentOn : null;
  const keys = Array.isArray(o.keys)
    ? o.keys.filter((k): k is string => typeof k === "string")
    : [];
  const readySince: Record<string, string> = {};
  if (typeof o.readySince === "object" && o.readySince !== null && !Array.isArray(o.readySince)) {
    for (const [k, v] of Object.entries(o.readySince as Record<string, unknown>)) {
      if (typeof v === "string") readySince[k] = v;
    }
  }
  return { sentOn, keys, readySince };
}
