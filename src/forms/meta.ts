/** The reserved wire envelope a fleet site forwards alongside the lead fields.
 *  (Older package versions also sent a `userAgent` — central never consumed it,
 *  so it is no longer forwarded; `readMeta` simply ignores it from old senders.) */
export type SubmissionMeta = {
  turnstileToken?: string;
  clientIp?: string;
};

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/**
 * Defensively read the reserved `_meta` envelope off an untrusted ingest payload
 * (CENTRAL side, used by the ingest handler). Keeps only non-blank string fields
 * among the KNOWN keys, dropping everything else — a bot cannot smuggle a
 * non-string clientIp in, and unknown fields (e.g. the `userAgent` older package
 * versions still send) are silently ignored. The token/IP read here are used
 * transiently (Turnstile verify + `remoteip`) and are NEVER persisted; the token
 * is never stored. The SITE-side writer (`buildSubmissionMeta`) is added by the
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
  return meta;
}

/**
 * SITE-side event shape `buildSubmissionMeta` reads. Structural (not SvelteKit's
 * `RequestEvent`) so this leaf stays SDK-free; a real `RequestEvent` is
 * structurally assignable (`getClientAddress: () => string`).
 */
type MetaEvent = {
  getClientAddress?: () => string;
};

/**
 * Build the transient `_meta` envelope a site forwards to central ingest:
 * `{ turnstileToken?, clientIp? }`. Returns `undefined` when no field yields a
 * value so callers can attach it unconditionally without polluting the payload
 * (an `undefined` value is dropped by `JSON.stringify`). `getClientAddress` is
 * guarded (some adapters lack a client address and can throw). The visitor's
 * user-agent is deliberately NOT forwarded — central never consumed it, so
 * shipping it was pure transient-PII surface. None of this is ever persisted.
 */
export function buildSubmissionMeta(
  event: MetaEvent,
  turnstileToken: string | null | undefined,
): SubmissionMeta | undefined {
  const meta: SubmissionMeta = {};

  const token = typeof turnstileToken === "string" ? turnstileToken.trim() : "";
  if (token) meta.turnstileToken = token;

  if (typeof event.getClientAddress === "function") {
    try {
      const ip = event.getClientAddress();
      if (typeof ip === "string" && ip.trim()) meta.clientIp = ip.trim();
    } catch {
      // Some adapters have no client address and throw; drop clientIp silently.
    }
  }

  return Object.keys(meta).length > 0 ? meta : undefined;
}
