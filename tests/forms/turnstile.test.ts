import { describe, it, expect, vi } from "vitest";
import { verifyTurnstile } from "../../src/forms/turnstile.js";

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("verifyTurnstile", () => {
  it("returns 'pass' and posts a form-encoded secret/response/remoteip body on success", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { success: true }));
    const out = await verifyTurnstile({
      secret: "sk",
      token: "tok",
      remoteip: "1.2.3.4",
      fetch: fetchMock,
    });
    expect(out).toBe("pass");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(SITEVERIFY_URL);
    expect(init.method).toBe("POST");
    const params = init.body as URLSearchParams;
    expect(params).toBeInstanceOf(URLSearchParams);
    expect(params.get("secret")).toBe("sk");
    expect(params.get("response")).toBe("tok");
    expect(params.get("remoteip")).toBe("1.2.3.4");
  });

  it("omits remoteip from the body when not provided", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { success: true }));
    await verifyTurnstile({ secret: "sk", token: "tok", fetch: fetchMock });
    const [, init] = fetchMock.mock.calls[0]!;
    const params = init.body as URLSearchParams;
    expect(params.has("remoteip")).toBe(false);
  });

  it("returns 'fail' only on invalid-input-response (bad/forged token)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(200, { success: false, "error-codes": ["invalid-input-response"] }),
      );
    const out = await verifyTurnstile({ secret: "sk", token: "tok", fetch: fetchMock });
    expect(out).toBe("fail");
  });

  it("returns 'fail' when invalid-input-response co-occurs with a benign code", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        success: false,
        "error-codes": ["timeout-or-duplicate", "invalid-input-response"],
      }),
    );
    const out = await verifyTurnstile({ secret: "sk", token: "tok", fetch: fetchMock });
    expect(out).toBe("fail");
  });

  it("returns 'unverifiable' on timeout-or-duplicate (expired 300s TTL / double-submit — real humans)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(200, { success: false, "error-codes": ["timeout-or-duplicate"] }),
      );
    const out = await verifyTurnstile({ secret: "sk", token: "tok", fetch: fetchMock });
    expect(out).toBe("unverifiable");
  });

  it("returns 'unverifiable' on internal-error (Cloudflare-side condition)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { success: false, "error-codes": ["internal-error"] }));
    const out = await verifyTurnstile({ secret: "sk", token: "tok", fetch: fetchMock });
    expect(out).toBe("unverifiable");
  });

  it("returns 'unverifiable' on secret/config error codes (operational, not the visitor's fault)", async () => {
    for (const code of [
      "missing-input-secret",
      "invalid-input-secret",
      "bad-request",
      "missing-input-response",
    ]) {
      const fetchMock = vi
        .fn()
        .mockResolvedValue(jsonResponse(200, { success: false, "error-codes": [code] }));
      const out = await verifyTurnstile({ secret: "sk", token: "tok", fetch: fetchMock });
      expect(out, `error code ${code}`).toBe("unverifiable");
    }
  });

  it("returns 'unverifiable' on success:false with no error-codes array", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { success: false }));
    const out = await verifyTurnstile({ secret: "sk", token: "tok", fetch: fetchMock });
    expect(out).toBe("unverifiable");
  });

  it("returns 'unverifiable' on an unknown error code", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(200, { success: false, "error-codes": ["some-future-code"] }),
      );
    const out = await verifyTurnstile({ secret: "sk", token: "tok", fetch: fetchMock });
    expect(out).toBe("unverifiable");
  });

  it("returns 'unverifiable' when fetch throws (network error) — and never throws", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    await expect(verifyTurnstile({ secret: "sk", token: "tok", fetch: fetchMock })).resolves.toBe(
      "unverifiable",
    );
  });

  it("returns 'unverifiable' when fetch throws synchronously (never throws)", async () => {
    const fetchMock = vi.fn(() => {
      throw new Error("boom");
    }) as unknown as typeof fetch;
    await expect(verifyTurnstile({ secret: "sk", token: "tok", fetch: fetchMock })).resolves.toBe(
      "unverifiable",
    );
  });

  it("returns 'unverifiable' on timeout (abort fires)", async () => {
    const fetchMock = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
    ) as unknown as typeof fetch;
    const out = await verifyTurnstile({
      secret: "sk",
      token: "tok",
      fetch: fetchMock,
      timeoutMs: 5,
    });
    expect(out).toBe("unverifiable");
  });

  it("returns 'unverifiable' and never calls fetch when the secret is unset", async () => {
    const fetchMock = vi.fn();
    const out = await verifyTurnstile({ secret: undefined, token: "tok", fetch: fetchMock });
    expect(out).toBe("unverifiable");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 'unverifiable' and never calls fetch when the secret is blank", async () => {
    const fetchMock = vi.fn();
    const out = await verifyTurnstile({ secret: "   ", token: "tok", fetch: fetchMock });
    expect(out).toBe("unverifiable");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 'unverifiable' and never calls fetch when the token is absent or blank", async () => {
    const fetchMock = vi.fn();
    expect(await verifyTurnstile({ secret: "sk", token: undefined, fetch: fetchMock })).toBe(
      "unverifiable",
    );
    expect(await verifyTurnstile({ secret: "sk", token: null, fetch: fetchMock })).toBe(
      "unverifiable",
    );
    expect(await verifyTurnstile({ secret: "sk", token: "   ", fetch: fetchMock })).toBe(
      "unverifiable",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 'unverifiable' on a non-JSON / malformed body", async () => {
    const nonJson = new Response("<html>gateway timeout</html>", {
      status: 502,
      headers: { "content-type": "text/html" },
    });
    const fetchMock = vi.fn().mockResolvedValue(nonJson);
    const out = await verifyTurnstile({ secret: "sk", token: "tok", fetch: fetchMock });
    expect(out).toBe("unverifiable");
  });

  it("returns 'unverifiable' when the JSON body lacks a boolean success field", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { message: "unexpected" }));
    const out = await verifyTurnstile({ secret: "sk", token: "tok", fetch: fetchMock });
    expect(out).toBe("unverifiable");
  });
});
