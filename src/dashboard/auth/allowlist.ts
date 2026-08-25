/**
 * The operator allowlist: a comma-separated `DASHBOARD_ALLOWED_EMAILS`.
 *
 * This is read on *every* request, not only at sign-in, which is what lets the
 * scheme revoke access without a session table — see session.ts.
 */

/**
 * Parse the env value into lowercased addresses.
 *
 * Entries that are not address-shaped are dropped rather than kept. A stray
 * word left in the variable ("tucker, tim") would otherwise sit in the list as
 * a value nothing can ever match, which is harmless — but so is dropping it,
 * and dropping it means `parseAllowedEmails` never reports a list that is
 * larger than the set of people who can actually get in.
 */
export function parseAllowedEmails(raw: string | undefined | null): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  for (const part of raw.split(",")) {
    const email = part.trim().toLowerCase();
    if (!isAddressShaped(email)) continue;
    seen.add(email);
  }
  return [...seen];
}

/** Minimal shape check — something, an "@", something with a dot. Not an
 *  RFC 5322 validator, and not trying to be: the address still has to match one
 *  Google actually verified, so this only filters obvious junk. */
function isAddressShaped(value: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value);
}

/**
 * Is this verified address on the list?
 *
 * An empty list matches nobody. That is the fail-closed case and it is load
 * bearing: an unset or blank `DASHBOARD_ALLOWED_EMAILS` must lock everyone out
 * rather than let everyone in.
 */
export function isAllowedEmail(email: string | null | undefined, allowed: string[]): boolean {
  if (!email) return false;
  if (allowed.length === 0) return false;
  return allowed.includes(email.trim().toLowerCase());
}
