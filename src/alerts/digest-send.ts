export const DIGEST_HEARTBEAT_DAYS = 7;

export const LIGHTHOUSE_WORSE_POINTS = 5;

export type SentItem = { metric: number; gone?: string };

export type DigestSendLog = {
  sentOn: string | null;
  sent: Record<string, SentItem>;
  readySince: Record<string, string>;
};

export const EMPTY_SEND_LOG: DigestSendLog = { sentOn: null, sent: {}, readySince: {} };

export type DigestLine = {
  key: string;
  metric: number;
  asks?: readonly string[];
  tolerance?: number;
};

export type SendDecision =
  | { send: true; reason: "first" | "added" | "worse" | "heartbeat" }
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

type Flat = { metric: number; tolerance: number };

export function flattenLines(lines: readonly DigestLine[]): Map<string, Flat> {
  const out = new Map<string, Flat>();
  for (const l of lines) {
    out.set(l.key, { metric: l.metric, tolerance: l.tolerance ?? 0 });
    for (const a of l.asks ?? []) out.set(`${l.key}#${a}`, { metric: 1, tolerance: 0 });
  }
  return out;
}

export function decideDigestSend(
  lines: readonly DigestLine[],
  log: DigestSendLog,
  today: string,
): SendDecision {
  if (log.sentOn === null) return { send: true, reason: "first" };
  const now = flattenLines(lines);
  for (const k of now.keys()) {
    if (!(k in log.sent)) return { send: true, reason: "added" };
  }
  for (const [k, f] of now) {
    if (f.metric > log.sent[k]!.metric + f.tolerance) return { send: true, reason: "worse" };
  }
  if (daysBetween(log.sentOn, today) >= DIGEST_HEARTBEAT_DAYS) {
    return { send: true, reason: "heartbeat" };
  }
  return { send: false, reason: "unchanged" };
}

export function nextSent(
  prior: Record<string, SentItem>,
  lines: readonly DigestLine[],
  today: string,
): Record<string, SentItem> {
  const now = flattenLines(lines);
  const out: Record<string, SentItem> = {};
  for (const [k, f] of now) {
    const was = prior[k];
    out[k] = { metric: was ? Math.max(was.metric, f.metric) : f.metric };
  }
  for (const [k, was] of Object.entries(prior)) {
    if (now.has(k)) continue;
    if (was.gone === undefined || was.gone === today) out[k] = { metric: was.metric, gone: today };
  }
  return out;
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
      sent[k] =
        typeof v.gone === "string" ? { metric: v.metric, gone: v.gone } : { metric: v.metric };
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
