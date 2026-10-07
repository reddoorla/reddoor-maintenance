export const DIGEST_HEARTBEAT_DAYS = 7;

export const LIGHTHOUSE_WORSE_POINTS = 5;

export const NOISY_MEMORY_DAYS = 28;

export type SentItem = { metric: number; gone?: string; critical?: boolean; tolerance?: number };

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
  critical?: boolean;
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

type Flat = { metric: number; tolerance: number; critical: boolean };

export function flattenLines(lines: readonly DigestLine[]): Map<string, Flat> {
  const out = new Map<string, Flat>();
  for (const l of lines) {
    out.set(l.key, {
      metric: l.metric,
      tolerance: l.tolerance ?? 0,
      critical: l.critical ?? false,
    });
    for (const a of l.asks ?? []) {
      out.set(`${l.key}#${a}`, { metric: 1, tolerance: 0, critical: false });
    }
  }
  return out;
}

export type DigestChanges = { added: string[]; worse: string[] };

export function digestChanges(lines: readonly DigestLine[], log: DigestSendLog): DigestChanges {
  const added: string[] = [];
  const worse: string[] = [];
  for (const [k, f] of flattenLines(lines)) {
    const was = log.sent[k];
    if (was === undefined) added.push(k);
    else if (f.metric > was.metric + f.tolerance) worse.push(k);
  }
  return { added, worse };
}

export function decideDigestSend(
  lines: readonly DigestLine[],
  log: DigestSendLog,
  today: string,
): SendDecision {
  if (log.sentOn === null) return { send: true, reason: "first" };
  const changes = digestChanges(lines, log);
  if (changes.added.length > 0) return { send: true, reason: "added" };
  if (changes.worse.length > 0) return { send: true, reason: "worse" };
  if (daysBetween(log.sentOn, today) >= DIGEST_HEARTBEAT_DAYS) {
    return { send: true, reason: "heartbeat" };
  }
  return { send: false, reason: "unchanged" };
}

function baseline(was: SentItem, f: Flat, sending: boolean): number {
  if (sending) return Math.max(was.metric, f.metric);
  return f.critical ? Math.min(was.metric, f.metric) : was.metric;
}

function stillRemembered(was: SentItem, today: string): boolean {
  if (was.critical) return false;
  if (was.gone === undefined || was.gone === today) return true;
  return (was.tolerance ?? 0) > 0 && daysBetween(was.gone, today) < NOISY_MEMORY_DAYS;
}

export function nextSent(
  prior: Record<string, SentItem>,
  lines: readonly DigestLine[],
  today: string,
  sending: boolean,
): Record<string, SentItem> {
  const now = flattenLines(lines);
  const out: Record<string, SentItem> = {};
  for (const [k, f] of now) {
    const was = prior[k];
    out[k] = {
      metric: was ? baseline(was, f, sending) : f.metric,
      ...(f.critical ? { critical: true } : {}),
      ...(f.tolerance > 0 ? { tolerance: f.tolerance } : {}),
    };
  }
  for (const [k, was] of Object.entries(prior)) {
    if (now.has(k) || !stillRemembered(was, today)) continue;
    out[k] = { ...was, gone: was.gone ?? today };
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
      sent[k] = {
        metric: v.metric,
        ...(typeof v.gone === "string" ? { gone: v.gone } : {}),
        ...(v.critical === true ? { critical: true } : {}),
        ...(typeof v.tolerance === "number" && Number.isFinite(v.tolerance) && v.tolerance > 0
          ? { tolerance: v.tolerance }
          : {}),
      };
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
