/** The reserved wire envelope a fleet site forwards alongside the lead fields. */
export type SubmissionMeta = {
  turnstileToken?: string;
  clientIp?: string;
  userAgent?: string;
};

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/**
 * Defensively read the reserved `_meta` envelope off an untrusted ingest payload
 * (CENTRAL side, used by the ingest handler). Keeps only non-blank string fields,
 * dropping the rest, so a bot cannot smuggle a non-string clientIp/userAgent into
 * the transient scoring path. The token/IP/UA read here are used transiently
 * (Turnstile `remoteip` + scoring) and are NEVER persisted; the token is never
 * stored. The SITE-side writer (`buildSubmissionMeta`) is added by the
 * site-factory task; `readMeta` is the single reader (there is no `parseMeta`).
 */
export function readMeta(payload: unknown): SubmissionMeta {
  const meta: SubmissionMeta = {};
  if (typeof payload !== "object" || payload === null) return meta;
  const raw = (payload as Record<string, unknown>)._meta;
  if (typeof raw !== "object" || raw === null) return meta;
  const m = raw as Record<string, unknown>;
  const token = str(m.turnstileToken);
  if (token) meta.turnstileToken = token;
  const ip = str(m.clientIp);
  if (ip) meta.clientIp = ip;
  const ua = str(m.userAgent);
  if (ua) meta.userAgent = ua;
  return meta;
}
