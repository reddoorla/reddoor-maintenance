import { describe, it, expect } from "vitest";
import { sign, verify } from "../../../src/dashboard/auth/signing.js";

const SECRET = "test-secret-value";

describe("sign/verify", () => {
  it("round-trips a payload", () => {
    const token = sign('{"email":"a@b.com"}', SECRET);
    expect(verify(token, SECRET)).toBe('{"email":"a@b.com"}');
  });

  it("round-trips payloads with characters that are not URL- or base64-safe", () => {
    const payload = '{"note":"a+b/c=d & e — ünïcode"}';
    expect(verify(sign(payload, SECRET), SECRET)).toBe(payload);
  });

  it("stamps the version prefix", () => {
    expect(sign("x", SECRET).startsWith("v1.")).toBe(true);
  });

  it("rejects a tampered payload", () => {
    const token = sign('{"email":"a@b.com"}', SECRET);
    const [version, , signature] = token.split(".");
    const forged = Buffer.from('{"email":"attacker@evil.com"}', "utf-8").toString("base64url");
    expect(verify(`${version}.${forged}.${signature}`, SECRET)).toBeNull();
  });

  it("rejects a tampered signature", () => {
    const [version, payload, signature] = sign("x", SECRET).split(".");
    // Flip one character of the signature, keeping its length.
    const flipped = (signature![0] === "A" ? "B" : "A") + signature!.slice(1);
    expect(verify(`${version}.${payload}.${flipped}`, SECRET)).toBeNull();
  });

  it("rejects a token signed with a different secret (secret rotation)", () => {
    expect(verify(sign("x", SECRET), "rotated-secret")).toBeNull();
  });

  it("rejects an unknown version prefix", () => {
    const [, payload, signature] = sign("x", SECRET).split(".");
    expect(verify(`v2.${payload}.${signature}`, SECRET)).toBeNull();
  });

  it("rejects the wrong number of segments", () => {
    expect(verify("v1.onlytwo", SECRET)).toBeNull();
    expect(verify("v1.a.b.c", SECRET)).toBeNull();
    expect(verify("", SECRET)).toBeNull();
  });

  it("returns null (does not throw) for a signature of the wrong byte length", () => {
    // timingSafeEqual throws RangeError on a length mismatch. This arrives in a
    // cookie, so it must be an ordinary rejection rather than a 500.
    const [version, payload] = sign("x", SECRET).split(".");
    const short = Buffer.from([1, 2, 3]).toString("base64url");
    expect(() => verify(`${version}.${payload}.${short}`, SECRET)).not.toThrow();
    expect(verify(`${version}.${payload}.${short}`, SECRET)).toBeNull();
  });

  it("rejects null/undefined tokens and an empty secret", () => {
    expect(verify(null, SECRET)).toBeNull();
    expect(verify(undefined, SECRET)).toBeNull();
    expect(verify(sign("x", SECRET), "")).toBeNull();
  });

  it("refuses to sign with an empty secret rather than issuing a forgeable token", () => {
    expect(() => sign("x", "")).toThrow(/empty secret/);
  });
});
