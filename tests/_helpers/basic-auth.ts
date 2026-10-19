/** A valid Basic header for the given password (the dashboard gate ignores the username). */
export function authHeader(password: string, user = "x"): Record<string, string> {
  return { authorization: `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}` };
}
