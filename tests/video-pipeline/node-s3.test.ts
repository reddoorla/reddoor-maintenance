import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { getObject, putObject, signV4 } from "../../src/video-pipeline/node/s3.js";

const EMPTY = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

describe("node s3: SigV4", () => {
  it("get-vanilla known-good vector: exact authorization string", () => {
    const { authorization } = signV4({
      method: "GET",
      url: new URL("https://example.amazonaws.com/"),
      headers: { host: "example.amazonaws.com", "x-amz-date": "20150830T123600Z" },
      payloadHash: EMPTY,
      accessKeyId: "AKIDEXAMPLE",
      secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
      region: "us-east-1",
      service: "service",
      amzDate: "20150830T123600Z",
    });
    expect(authorization).toBe(
      "AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, SignedHeaders=host;x-amz-date, Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31",
    );
  });
});

describe("node s3: SigV4 AWS docs GET Object vector", () => {
  it("GET Object with a Range header: exact signature from the AWS SigV4 examples", () => {
    const { authorization, canonicalRequest } = signV4({
      method: "GET",
      url: new URL("https://examplebucket.s3.amazonaws.com/test.txt"),
      headers: {
        host: "examplebucket.s3.amazonaws.com",
        range: "bytes=0-9",
        "x-amz-content-sha256": EMPTY,
        "x-amz-date": "20130524T000000Z",
      },
      payloadHash: EMPTY,
      accessKeyId: "AKIAIOSFODNN7EXAMPLE",
      secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      region: "us-east-1",
      service: "s3",
      amzDate: "20130524T000000Z",
    });
    const signature = /Signature=([0-9a-f]+)$/.exec(authorization)![1];
    expect(canonicalRequest.split("\n")[1]).toBe("/test.txt");
    expect(signature).toBe("f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41");
  });

  it("the canonical URI of a key with a space is the percent-encoded path", () => {
    const { canonicalRequest } = signV4({
      method: "PUT",
      url: new URL("https://acct.r2.cloudflarestorage.com/bucket/a/b%20c.mp4"),
      headers: { host: "acct.r2.cloudflarestorage.com", "x-amz-date": "20130524T000000Z" },
      payloadHash: EMPTY,
      accessKeyId: "AK",
      secretAccessKey: "SK",
      region: "auto",
      service: "s3",
      amzDate: "20130524T000000Z",
    });
    expect(canonicalRequest.split("\n")[1]).toBe("/bucket/a/b%20c.mp4");
  });
});

describe("node s3: putObject", () => {
  const cfg = {
    endpoint: "https://acct.r2.cloudflarestorage.com",
    bucket: "reddoor-video",
    accessKeyId: "AKID",
    secretAccessKey: "secret",
  };

  it("PUTs path-style to the encoded key with the body hash and a SigV4 header", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fakeFetch = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(null, { status: 200 });
    }) as unknown as typeof fetch;
    const body = new TextEncoder().encode("hello");
    await putObject(cfg, "a/b c.mp4", body, {
      contentType: "video/mp4",
      fetch: fakeFetch,
      now: new Date("2026-11-10T12:00:00Z"),
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://acct.r2.cloudflarestorage.com/reddoor-video/a/b%20c.mp4");
    expect(calls[0]!.init.method).toBe("PUT");
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers["x-amz-content-sha256"]).toBe(createHash("sha256").update(body).digest("hex"));
    expect(headers.authorization!.startsWith("AWS4-HMAC-SHA256 Credential=")).toBe(true);
  });

  it("a 403 response throws with the status", async () => {
    const fakeFetch = (async () =>
      new Response("AccessDenied", { status: 403 })) as unknown as typeof fetch;
    await expect(
      putObject(cfg, "x.mp4", new Uint8Array([1]), { contentType: "video/mp4", fetch: fakeFetch }),
    ).rejects.toThrow("403");
  });
});

describe("node s3: getObject", () => {
  const cfg = {
    endpoint: "https://acct.r2.cloudflarestorage.com",
    bucket: "reddoor-video",
    accessKeyId: "AKID",
    secretAccessKey: "secret",
  };

  it("a 404 is null", async () => {
    const fakeFetch = (async () => new Response(null, { status: 404 })) as unknown as typeof fetch;
    const got = await getObject(cfg, "k/manifest.json", {
      fetch: fakeFetch,
      now: new Date("2026-11-10T12:00:00Z"),
    });
    expect(got).toBeNull();
  });

  it("a 200 is the body bytes, signed as a GET to the encoded key", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fakeFetch = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response('{"a":1}', { status: 200 });
    }) as unknown as typeof fetch;
    const got = await getObject(cfg, "a/b c/manifest.json", {
      fetch: fakeFetch,
      now: new Date("2026-11-10T12:00:00Z"),
    });
    expect(new TextDecoder().decode(got!)).toBe('{"a":1}');
    expect(calls[0]!.url).toBe(
      "https://acct.r2.cloudflarestorage.com/reddoor-video/a/b%20c/manifest.json",
    );
    expect(calls[0]!.init.method).toBe("GET");
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers.authorization!.startsWith("AWS4-HMAC-SHA256 Credential=AKID/")).toBe(true);
  });

  it("a 500 throws with the status", async () => {
    const fakeFetch = (async () =>
      new Response("boom", { status: 500 })) as unknown as typeof fetch;
    await expect(getObject(cfg, "x/manifest.json", { fetch: fakeFetch })).rejects.toThrow("500");
  });
});

describe("node s3: putObject's signature round-trips", () => {
  it("the authorization header equals a fresh signV4 over the captured method, URL and headers, plus host", async () => {
    const cfg = {
      endpoint: "https://acct.r2.cloudflarestorage.com",
      bucket: "reddoor-video",
      accessKeyId: "AKID",
      secretAccessKey: "secret",
    };
    const now = new Date("2026-11-10T12:00:00Z");
    let captured: { url: string; init: RequestInit } | undefined;
    const fakeFetch = (async (url: string, init: RequestInit) => {
      captured = { url, init };
      return new Response(null, { status: 200 });
    }) as unknown as typeof fetch;
    const body = new TextEncoder().encode("hello");
    await putObject(cfg, "a/b.mp4", body, {
      contentType: "video/mp4",
      cacheControl: "public, max-age=60",
      fetch: fakeFetch,
      now,
    });
    const sent = captured!.init.headers as Record<string, string>;
    const url = new URL(captured!.url);
    const { authorization: _sent, ...signed } = sent;
    const { authorization } = signV4({
      method: "PUT",
      url,
      headers: { host: url.host, "x-amz-date": "20261110T120000Z", ...signed },
      payloadHash: sent["x-amz-content-sha256"]!,
      accessKeyId: "AKID",
      secretAccessKey: "secret",
      region: "auto",
      service: "s3",
      amzDate: "20261110T120000Z",
    });
    expect(sent.authorization).toBe(authorization);
  });
});
