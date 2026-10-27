import { describe, it, expect, vi } from "vitest";
import { verifyTurnstile, verifyTurnstileWithSecrets } from "../../src/forms/turnstile.js";

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
    expect(out.outcome).toBe("pass");
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
    expect(out.outcome).toBe("fail");
  });

  it("returns 'fail' when invalid-input-response co-occurs with a benign code", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        success: false,
        "error-codes": ["timeout-or-duplicate", "invalid-input-response"],
      }),
    );
    const out = await verifyTurnstile({ secret: "sk", token: "tok", fetch: fetchMock });
    expect(out.outcome).toBe("fail");
  });

  it("returns 'unverifiable' on timeout-or-duplicate (expired 300s TTL / double-submit — real humans)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(200, { success: false, "error-codes": ["timeout-or-duplicate"] }),
      );
    const out = await verifyTurnstile({ secret: "sk", token: "tok", fetch: fetchMock });
    expect(out.outcome).toBe("unverifiable");
  });

  it("returns 'unverifiable' on internal-error (Cloudflare-side condition)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { success: false, "error-codes": ["internal-error"] }));
    const out = await verifyTurnstile({ secret: "sk", token: "tok", fetch: fetchMock });
    expect(out.outcome).toBe("unverifiable");
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
      expect(out.outcome, `error code ${code}`).toBe("unverifiable");
    }
  });

  it("returns 'unverifiable' on success:false with no error-codes array", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { success: false }));
    const out = await verifyTurnstile({ secret: "sk", token: "tok", fetch: fetchMock });
    expect(out.outcome).toBe("unverifiable");
  });

  it("returns 'unverifiable' on an unknown error code", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(200, { success: false, "error-codes": ["some-future-code"] }),
      );
    const out = await verifyTurnstile({ secret: "sk", token: "tok", fetch: fetchMock });
    expect(out.outcome).toBe("unverifiable");
  });

  it("returns 'unverifiable' when fetch throws (network error) — and never throws", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    await expect(
      verifyTurnstile({ secret: "sk", token: "tok", fetch: fetchMock }),
    ).resolves.toEqual({ outcome: "unverifiable", hostname: null });
  });

  it("returns 'unverifiable' when fetch throws synchronously (never throws)", async () => {
    const fetchMock = vi.fn(() => {
      throw new Error("boom");
    }) as unknown as typeof fetch;
    await expect(
      verifyTurnstile({ secret: "sk", token: "tok", fetch: fetchMock }),
    ).resolves.toEqual({ outcome: "unverifiable", hostname: null });
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
    expect(out.outcome).toBe("unverifiable");
  });

  it("returns 'unverifiable' and never calls fetch when the secret is unset", async () => {
    const fetchMock = vi.fn();
    const out = await verifyTurnstile({ secret: undefined, token: "tok", fetch: fetchMock });
    expect(out.outcome).toBe("unverifiable");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 'unverifiable' and never calls fetch when the secret is blank", async () => {
    const fetchMock = vi.fn();
    const out = await verifyTurnstile({ secret: "   ", token: "tok", fetch: fetchMock });
    expect(out.outcome).toBe("unverifiable");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 'absent' (not 'unverifiable') and never calls fetch when the secret IS set but the token is missing/blank", async () => {
    // A real browser that renders the widget ALWAYS forwards a token; a completely
    // missing one on a configured site is the direct-POST-bot tell, so it gets its
    // own outcome that a requireTurnstile site can escalate (see ingest.ts).
    const fetchMock = vi.fn();
    expect(
      (await verifyTurnstile({ secret: "sk", token: undefined, fetch: fetchMock })).outcome,
    ).toBe("absent");
    expect((await verifyTurnstile({ secret: "sk", token: null, fetch: fetchMock })).outcome).toBe(
      "absent",
    );
    expect((await verifyTurnstile({ secret: "sk", token: "   ", fetch: fetchMock })).outcome).toBe(
      "absent",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 'unverifiable' (secret wins) when the secret is unset AND the token is also missing", async () => {
    // Precedence: an unconfigured central secret can't distinguish absent from
    // anything, so it collapses to unverifiable before the token is even inspected.
    const fetchMock = vi.fn();
    expect(
      (await verifyTurnstile({ secret: undefined, token: undefined, fetch: fetchMock })).outcome,
    ).toBe("unverifiable");
    expect((await verifyTurnstile({ secret: "", token: null, fetch: fetchMock })).outcome).toBe(
      "unverifiable",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("carries the solved-hostname through on a pass, null when absent/non-string", async () => {
    const withHost = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { success: true, hostname: "reddoorla.com" }));
    expect(await verifyTurnstile({ secret: "sk", token: "tok", fetch: withHost })).toEqual({
      outcome: "pass",
      hostname: "reddoorla.com",
    });

    const noHost = vi.fn().mockResolvedValue(jsonResponse(200, { success: true }));
    expect(await verifyTurnstile({ secret: "sk", token: "tok", fetch: noHost })).toEqual({
      outcome: "pass",
      hostname: null,
    });

    // non-string / empty hostname degrades to null, never a junk value
    const junkHost = vi.fn().mockResolvedValue(jsonResponse(200, { success: true, hostname: 42 }));
    expect((await verifyTurnstile({ secret: "sk", token: "tok", fetch: junkHost })).hostname).toBe(
      null,
    );
  });

  it("hostname is null on every non-pass outcome (fail carries no trustworthy origin)", async () => {
    const fail = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        success: false,
        "error-codes": ["invalid-input-response"],
        hostname: "attacker.example",
      }),
    );
    expect(await verifyTurnstile({ secret: "sk", token: "tok", fetch: fail })).toEqual({
      outcome: "fail",
      hostname: null,
    });
  });

  it("returns 'unverifiable' on a non-JSON / malformed body", async () => {
    const nonJson = new Response("<html>gateway timeout</html>", {
      status: 502,
      headers: { "content-type": "text/html" },
    });
    const fetchMock = vi.fn().mockResolvedValue(nonJson);
    const out = await verifyTurnstile({ secret: "sk", token: "tok", fetch: fetchMock });
    expect(out.outcome).toBe("unverifiable");
  });

  it("returns 'unverifiable' when the JSON body lacks a boolean success field", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { message: "unexpected" }));
    const out = await verifyTurnstile({ secret: "sk", token: "tok", fetch: fetchMock });
    expect(out.outcome).toBe("unverifiable");
  });

  it("marks invalid-input-secret as wrongSecret (still 'unverifiable'), other config codes not", async () => {
    const wrong = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(200, { success: false, "error-codes": ["invalid-input-secret"] }),
      );
    const out = await verifyTurnstile({ secret: "sk", token: "tok", fetch: wrong });
    expect(out.outcome).toBe("unverifiable");
    expect(out.wrongSecret).toBe(true);

    const other = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { success: false, "error-codes": ["bad-request"] }));
    const out2 = await verifyTurnstile({ secret: "sk", token: "tok", fetch: other });
    expect(out2.outcome).toBe("unverifiable");
    expect(out2.wrongSecret).toBeUndefined();
  });
});

describe("verifyTurnstileWithSecrets", () => {
  const wrongSecretBody = { success: false, "error-codes": ["invalid-input-secret"] };

  it("passes on the first secret without trying the second", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { success: true, hostname: "reddoorla.com" }));
    const out = await verifyTurnstileWithSecrets({
      secrets: ["sk1", "sk2"],
      token: "tok",
      fetch: fetchMock,
    });
    expect(out).toEqual({ outcome: "pass", hostname: "reddoorla.com" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0]!;
    expect((init.body as URLSearchParams).get("secret")).toBe("sk1");
  });

  it("retries the next secret on invalid-input-secret (wrong widget) and passes", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, wrongSecretBody))
      .mockResolvedValueOnce(jsonResponse(200, { success: true, hostname: "1836dig.com" }));
    const out = await verifyTurnstileWithSecrets({
      secrets: ["sk1", "sk2"],
      token: "tok",
      fetch: fetchMock,
    });
    expect(out).toEqual({ outcome: "pass", hostname: "1836dig.com" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect((fetchMock.mock.calls[0]![1].body as URLSearchParams).get("secret")).toBe("sk1");
    expect((fetchMock.mock.calls[1]![1].body as URLSearchParams).get("secret")).toBe("sk2");
  });

  it("collapses to 'unverifiable' (fail-open) when every secret is some other widget's", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, wrongSecretBody));
    const out = await verifyTurnstileWithSecrets({
      secrets: ["sk1", "sk2"],
      token: "tok",
      fetch: fetchMock,
    });
    expect(out.outcome).toBe("unverifiable");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does NOT retry on a definite 'fail' (forged token is forged under every widget)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(200, { success: false, "error-codes": ["invalid-input-response"] }),
      );
    const out = await verifyTurnstileWithSecrets({
      secrets: ["sk1", "sk2"],
      token: "tok",
      fetch: fetchMock,
    });
    expect(out.outcome).toBe("fail");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does NOT retry on a network-error 'unverifiable' (no wrong-widget evidence)", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    const out = await verifyTurnstileWithSecrets({
      secrets: ["sk1", "sk2"],
      token: "tok",
      fetch: fetchMock,
    });
    expect(out.outcome).toBe("unverifiable");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("skips blank/undefined secrets; none left → 'unverifiable' without touching the network", async () => {
    const fetchMock = vi.fn();
    expect(
      await verifyTurnstileWithSecrets({
        secrets: [undefined, "   ", ""],
        token: "tok",
        fetch: fetchMock,
      }),
    ).toEqual({ outcome: "unverifiable", hostname: null });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 'absent' on a missing token with configured secrets, without retrying", async () => {
    const fetchMock = vi.fn();
    const out = await verifyTurnstileWithSecrets({
      secrets: ["sk1", "sk2"],
      token: null,
      fetch: fetchMock,
    });
    expect(out.outcome).toBe("absent");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
