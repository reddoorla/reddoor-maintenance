/**
 * Report addressing: the pure helpers the send pipeline and the dashboard
 * share. A leaf module on purpose. `orchestrate.ts` pulls in Playwright (the
 * header-image capture) and Resend's React email renderer, so importing these
 * from there put about 11 MB into every dashboard function that only wanted to
 * check an address (maintenance#1642). Keep this file's imports empty.
 */

/** Operations inbox CC'd on every outgoing report so there's always an internal
 *  copy on file alongside the client recipients. */
export const GLOBAL_REPORT_CC = "info@reddoorla.com";

/**
 * Append {@link GLOBAL_REPORT_CC} to a site's per-site CC list. The per-site CC is
 * passed through unchanged (preserving prior behavior); the global address is added
 * only when it isn't already present in the CC or To lists (case-insensitive), so a
 * report is never double-addressed to the ops inbox. Returns the final CC list (may
 * be empty if the global address is already the sole To recipient — the caller omits
 * an empty CC).
 */
export function withGlobalCc(perSiteCc: string[] | null, to: string[]): string[] {
  const cc = [...(perSiteCc ?? [])];
  const present = new Set([...cc, ...to].map((a) => a.toLowerCase()));
  if (!present.has(GLOBAL_REPORT_CC.toLowerCase())) cc.push(GLOBAL_REPORT_CC);
  return cc;
}

/**
 * Split a comma/newline-separated address field into a clean array.
 * Lowercases (case-insensitive dedupe) and removes empty entries. Returns
 * null if nothing survives. Does NOT understand `Display Name <email>` —
 * operators should put a bare address in the field, or use multiple
 * lines if needing multiple recipients.
 */
export function parseAddresses(field: string | null): string[] | null {
  if (!field) return null;
  const seen = new Set<string>();
  const list: string[] = [];
  for (const raw of field.split(/[,\n]/)) {
    const trimmed = raw.trim().toLowerCase();
    if (!trimmed) continue;
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    list.push(trimmed);
  }
  return list.length > 0 ? list : null;
}

/**
 * Cheap email shape check — must contain exactly one @, with non-empty
 * local and domain parts and at least one dot in the domain. We're not
 * trying to be a full RFC validator; we're trying to catch operator
 * mistakes like "ops at acme dot com" or a missing @ before they 422
 * at Resend.
 */
export function isProbablyEmail(s: string): boolean {
  const at = s.indexOf("@");
  if (at < 1 || at !== s.lastIndexOf("@")) return false;
  const local = s.slice(0, at);
  const domain = s.slice(at + 1);
  if (!local || !domain) return false;
  if (!domain.includes(".")) return false;
  if (/\s/.test(s)) return false;
  return true;
}
