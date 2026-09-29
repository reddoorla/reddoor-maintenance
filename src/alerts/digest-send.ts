export const DIGEST_HEARTBEAT_DAYS = 7;

export type SentItem = { metric: number; asks?: string[] };

export type DigestSendLog = {
  sentOn: string | null;
  sent: Record<string, SentItem>;
  readySince: Record<string, string>;
};

export const EMPTY_SEND_LOG: DigestSendLog = { sentOn: null, sent: {}, readySince: {} };

export type DigestLine = { key: string; metric: number; asks?: readonly string[] };

export type SendDecision =
  | { send: true; reason: "first" | "added" | "worse" | "new-ask" | "heartbeat" }
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
  lines: readonly DigestLine[],
  log: DigestSendLog,
  today: string,
): SendDecision {
  if (log.sentOn === null) return { send: true, reason: "first" };
  if (lines.some((l) => !(l.key in log.sent))) return { send: true, reason: "added" };
  if (lines.some((l) => l.metric > log.sent[l.key]!.metric)) return { send: true, reason: "worse" };
  const newAsk = lines.some((l) => {
    const before = new Set(log.sent[l.key]!.asks ?? []);
    return (l.asks ?? []).some((a) => !before.has(a));
  });
  if (newAsk) return { send: true, reason: "new-ask" };
  if (daysBetween(log.sentOn, today) >= DIGEST_HEARTBEAT_DAYS) {
    return { send: true, reason: "heartbeat" };
  }
  return { send: false, reason: "unchanged" };
}

export function nextSendLog(
  lines: readonly DigestLine[],
  log: DigestSendLog,
  today: string,
  didSend: boolean,
  readySince: Record<string, string>,
): DigestSendLog {
  const sent: Record<string, SentItem> = {};
  for (const l of lines) {
    const was = log.sent[l.key];
    if (!was && !didSend) continue;
    const metric = was ? Math.max(was.metric, l.metric) : l.metric;
    const told = new Set(was?.asks ?? []);
    const asks = (l.asks ?? []).filter((a) => didSend || told.has(a));
    sent[l.key] = asks.length > 0 ? { metric, asks } : { metric };
  }
  return { sentOn: didSend ? today : log.sentOn, sent, readySince };
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

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function coerceSendLog(raw: unknown): DigestSendLog {
  if (!isRecord(raw)) return EMPTY_SEND_LOG;
  const sentOn = typeof raw.sentOn === "string" ? raw.sentOn : null;
  const sent: Record<string, SentItem> = {};
  if (isRecord(raw.sent)) {
    for (const [k, v] of Object.entries(raw.sent)) {
      if (!isRecord(v) || typeof v.metric !== "number" || !Number.isFinite(v.metric)) continue;
      const asks = Array.isArray(v.asks)
        ? v.asks.filter((a): a is string => typeof a === "string")
        : [];
      sent[k] = asks.length > 0 ? { metric: v.metric, asks } : { metric: v.metric };
    }
  }
  const readySince: Record<string, string> = {};
  if (isRecord(raw.readySince)) {
    for (const [k, v] of Object.entries(raw.readySince)) {
      if (typeof v === "string") readySince[k] = v;
    }
  }
  return { sentOn, sent, readySince };
}
