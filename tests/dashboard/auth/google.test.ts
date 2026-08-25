import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import {
  createPkcePair,
  randomState,
  buildAuthorizeUrl,
  exchangeCodeForTokens,
  fetchVerifiedEmail,
  GOOGLE_AUTHORIZATION_ENDPOINT,
  GOOGLE_TOKEN_ENDPOINT,
  GOOGLE_USERINFO_ENDPOINT,
} from "../../../src/dashboard/auth/google.js";

/** A fetch stand-in that records its calls. Every test here runs offline. */
function fakeFetch(handler: (url: string, init?: RequestInit) => Response) {
  const calls: Array<{ url: string; init?: RequestInit | undefined }> = [];
  const fn = ((url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return Promise.resolve(handler(String(url), init));
  }) as unknown as typeof fetch;
  return { fetch: fn, calls };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("createPkcePair", () => {
  it("produces a challenge that is the base64url SHA-256 of the verifier", () => {
    const { verifier, challenge } = createPkcePair();
    expect(challenge).toBe(createHash("sha256").update(verifier).digest("base64url"));
  });

  it("produces a verifier within RFC 7636's 43-128 character range", () => {
    const { verifier } = createPkcePair();
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(verifier.length).toBeLessThanOrEqual(128);
  });

  it("produces a fresh pair each time", () => {
    expect(createPkcePair().verifier).not.toBe(createPkcePair().verifier);
    expect(randomState()).not.toBe(randomState());
  });
});

describe("buildAuthorizeUrl", () => {
  const base = {
    clientId: "client-123",
    redirectUri: "https://dash.example/auth/callback",
    state: "st4te",
    challenge: "ch4llenge",
  };

  it("carries every parameter Google's code flow requires", () => {
    const url = new URL(buildAuthorizeUrl(base));
    expect(`${url.origin}${url.pathname}`).toBe(GOOGLE_AUTHORIZATION_ENDPOINT);
    expect(url.searchParams.get("client_id")).toBe("client-123");
    expect(url.searchParams.get("redirect_uri")).toBe("https://dash.example/auth/callback");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("scope")).toBe("openid email");
    expect(url.searchParams.get("state")).toBe("st4te");
    expect(url.searchParams.get("code_challenge")).toBe("ch4llenge");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  });

  it("does not request the profile scope", () => {
    expect(new URL(buildAuthorizeUrl(base)).searchParams.get("scope")).not.toContain("profile");
  });

  it("omits prompt by default and sets select_account on request", () => {
    expect(new URL(buildAuthorizeUrl(base)).searchParams.get("prompt")).toBeNull();
    const forced = new URL(buildAuthorizeUrl({ ...base, selectAccount: true }));
    expect(forced.searchParams.get("prompt")).toBe("select_account");
  });
});

describe("exchangeCodeForTokens", () => {
  const opts = {
    code: "auth-code",
    verifier: "v3rifier",
    clientId: "client-123",
    clientSecret: "s3cret",
    redirectUri: "https://dash.example/auth/callback",
  };

  it("posts the verifier, secret and grant type to the token endpoint", async () => {
    const { fetch, calls } = fakeFetch(() => json({ access_token: "at-1" }));
    const result = await exchangeCodeForTokens(opts, { fetch });
    expect(result).toEqual({ ok: true, accessToken: "at-1" });

    expect(calls[0]!.url).toBe(GOOGLE_TOKEN_ENDPOINT);
    const body = new URLSearchParams(String(calls[0]!.init?.body));
    expect(body.get("code_verifier")).toBe("v3rifier");
    expect(body.get("client_secret")).toBe("s3cret");
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("redirect_uri")).toBe("https://dash.example/auth/callback");
  });

  it("reports a rejected code as a failure rather than throwing", async () => {
    const { fetch } = fakeFetch(() => json({ error: "invalid_grant" }, 400));
    const result = await exchangeCodeForTokens(opts, { fetch });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toContain("400");
  });

  it("reports a network failure as a failure rather than throwing", async () => {
    const fetch = (() =>
      Promise.reject(new Error("ECONNRESET"))) as unknown as typeof globalThis.fetch;
    const result = await exchangeCodeForTokens(opts, { fetch });
    expect(result).toEqual({ ok: false, error: "ECONNRESET" });
  });

  it("rejects a 200 that carries no access_token", async () => {
    const { fetch } = fakeFetch(() => json({ id_token: "only-this" }));
    const result = await exchangeCodeForTokens(opts, { fetch });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toContain("no access_token");
  });

  it("rejects a non-JSON body", async () => {
    const { fetch } = fakeFetch(() => new Response("<html>oops</html>", { status: 200 }));
    const result = await exchangeCodeForTokens(opts, { fetch });
    expect(result.ok).toBe(false);
  });
});

describe("fetchVerifiedEmail", () => {
  it("returns the lowercased address on a verified account", async () => {
    const { fetch, calls } = fakeFetch(() =>
      json({ email: "Tim@ReddoorLA.com", email_verified: true }),
    );
    expect(await fetchVerifiedEmail("at-1", { fetch })).toEqual({
      ok: true,
      email: "tim@reddoorla.com",
    });
    expect(calls[0]!.url).toBe(GOOGLE_USERINFO_ENDPOINT);
    expect((calls[0]!.init?.headers as Record<string, string>).authorization).toBe("Bearer at-1");
  });

  it("refuses an unverified address", async () => {
    // An unverified address is not proof of controlling that mailbox, so
    // matching it against the allowlist would match something the holder chose.
    const { fetch } = fakeFetch(() => json({ email: "a@b.com", email_verified: false }));
    const result = await fetchVerifiedEmail("at-1", { fetch });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toContain("unverified");
  });

  it("refuses a response with email_verified absent entirely", async () => {
    const { fetch } = fakeFetch(() => json({ email: "a@b.com" }));
    expect((await fetchVerifiedEmail("at-1", { fetch })).ok).toBe(false);
  });

  it("refuses a response with no email", async () => {
    const { fetch } = fakeFetch(() => json({ email_verified: true }));
    expect((await fetchVerifiedEmail("at-1", { fetch })).ok).toBe(false);
  });

  it("reports a non-200 and a network failure as failures", async () => {
    const { fetch } = fakeFetch(() => new Response("nope", { status: 401 }));
    expect((await fetchVerifiedEmail("at-1", { fetch })).ok).toBe(false);

    const boom = (() =>
      Promise.reject(new Error("EAI_AGAIN"))) as unknown as typeof globalThis.fetch;
    expect(await fetchVerifiedEmail("at-1", { fetch: boom })).toEqual({
      ok: false,
      error: "EAI_AGAIN",
    });
  });
});
