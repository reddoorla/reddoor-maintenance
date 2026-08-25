/**
 * Cookie header parsing and `Set-Cookie` serialization.
 *
 * Deliberately crypto-free: signing lives in signing.ts, and what a cookie
 * *means* lives in session.ts / oauth-state.ts. This module only knows the
 * wire format.
 */

export type CookieOptions = {
  /** Cookie lifetime. 0 clears the cookie. */
  maxAgeSeconds: number;
  path: string;
  /** Always true in production. Settable only so tests can assert both forms. */
  secure?: boolean;
  sameSite?: "Lax" | "Strict" | "None";
  httpOnly?: boolean;
};

/**
 * Read one cookie out of a `Cookie` request header. Null when the header is
 * absent, the name is not present, or the value fails to decode.
 *
 * Values are percent-decoded to mirror {@link serializeCookie}'s encoding.
 * `decodeURIComponent` throws on malformed input (a stray "%zz"), which a
 * hostile or merely broken client can send at will — so a decode failure is an
 * ordinary miss, never a 500.
 */
export function readCookie(header: string | null | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    const raw = part.slice(eq + 1).trim();
    try {
      return decodeURIComponent(raw);
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Build a `Set-Cookie` value. The value is percent-encoded so a payload
 * containing a separator (";", ",", whitespace) cannot forge extra attributes.
 */
export function serializeCookie(name: string, value: string, opts: CookieOptions): string {
  const bits = [`${name}=${encodeURIComponent(value)}`, `Path=${opts.path}`];
  bits.push(`Max-Age=${Math.max(0, Math.floor(opts.maxAgeSeconds))}`);
  if (opts.httpOnly !== false) bits.push("HttpOnly");
  if (opts.secure !== false) bits.push("Secure");
  bits.push(`SameSite=${opts.sameSite ?? "Lax"}`);
  return bits.join("; ");
}

/** A `Set-Cookie` that expires the named cookie immediately. The path must
 *  match the one it was set with or the browser keeps the original. */
export function clearCookie(name: string, path: string): string {
  return serializeCookie(name, "", { maxAgeSeconds: 0, path });
}
