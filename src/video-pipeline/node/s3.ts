import { createHash, createHmac } from "node:crypto";

// Minimal AWS SigV4 for Cloudflare R2's S3-compatible API: path-style PUT and
// HEAD only. Node-only; not part of the light video-pipeline subpath.

export type S3Config = {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  region?: string; // default "auto"
};

const sha256Hex = (data: string | Uint8Array): string =>
  createHash("sha256").update(data).digest("hex");

const hmac = (key: Buffer | string, data: string): Buffer =>
  createHmac("sha256", key).update(data, "utf8").digest();

/** RFC 3986 unreserved set: everything else, including !'()*, is percent-encoded. */
export const encodeRfc3986 = (s: string): string =>
  encodeURIComponent(s).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );

const encodeKey = (key: string): string => key.split("/").map(encodeRfc3986).join("/");

export function signV4(input: {
  method: string;
  url: URL;
  headers: Record<string, string>;
  payloadHash: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  service: string;
  amzDate: string;
}): {
  authorization: string;
  signedHeaders: string;
  canonicalRequest: string;
  stringToSign: string;
} {
  const date = input.amzDate.slice(0, 8);
  const names = Object.keys(input.headers)
    .map((n) => n.toLowerCase())
    .sort();
  const byLower = new Map(
    Object.entries(input.headers).map(([k, v]) => [k.toLowerCase(), v.trim()]),
  );
  const canonicalHeaders = names.map((n) => `${n}:${byLower.get(n)}\n`).join("");
  const signedHeaders = names.join(";");
  const query = [...input.url.searchParams.entries()]
    .map(([k, v]) => [encodeRfc3986(k), encodeRfc3986(v)] as const)
    .sort(([ak, av], [bk, bv]) => (ak === bk ? (av < bv ? -1 : av > bv ? 1 : 0) : ak < bk ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  const canonicalRequest = [
    input.method,
    input.url.pathname,
    query,
    canonicalHeaders,
    signedHeaders,
    input.payloadHash,
  ].join("\n");
  const scope = `${date}/${input.region}/${input.service}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", input.amzDate, scope, sha256Hex(canonicalRequest)].join(
    "\n",
  );
  const kDate = hmac(`AWS4${input.secretAccessKey}`, date);
  const kRegion = hmac(kDate, input.region);
  const kService = hmac(kRegion, input.service);
  const kSigning = hmac(kService, "aws4_request");
  const signature = createHmac("sha256", kSigning).update(stringToSign, "utf8").digest("hex");
  const authorization = `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return { authorization, signedHeaders, canonicalRequest, stringToSign };
}

const amzDateOf = (d: Date): string => d.toISOString().replace(/[:-]|\.\d{3}/g, "");

const EMPTY_SHA256 = sha256Hex("");

async function signedRequest(
  cfg: S3Config,
  method: string,
  key: string,
  headers: Record<string, string>,
  payloadHash: string,
  now: Date,
  fetchImpl: typeof fetch,
  body?: Uint8Array,
): Promise<Response> {
  const url = new URL(`${cfg.endpoint.replace(/\/+$/, "")}/${cfg.bucket}/${encodeKey(key)}`);
  const amzDate = amzDateOf(now);
  const region = cfg.region ?? "auto";
  const signHeaders = { host: url.host, "x-amz-date": amzDate, ...headers };
  const { authorization } = signV4({
    method,
    url,
    headers: signHeaders,
    payloadHash,
    accessKeyId: cfg.accessKeyId,
    secretAccessKey: cfg.secretAccessKey,
    region,
    service: "s3",
    amzDate,
  });
  // The host header is signed but left to fetch, which sends the URL's host.
  const { host: _host, ...sent } = signHeaders;
  return fetchImpl(url.toString(), {
    method,
    headers: { ...sent, authorization },
    ...(body !== undefined ? { body: body as BodyInit } : {}),
  });
}

export async function putObject(
  cfg: S3Config,
  key: string,
  body: Uint8Array,
  opts: { contentType: string; cacheControl?: string; fetch?: typeof fetch; now?: Date },
): Promise<void> {
  const headers: Record<string, string> = {
    "x-amz-content-sha256": sha256Hex(body),
    "content-type": opts.contentType,
  };
  if (opts.cacheControl !== undefined) headers["cache-control"] = opts.cacheControl;
  const res = await signedRequest(
    cfg,
    "PUT",
    key,
    headers,
    headers["x-amz-content-sha256"]!,
    opts.now ?? new Date(),
    opts.fetch ?? fetch,
    body,
  );
  if (res.status < 200 || res.status > 299) {
    const text = await res.text().catch(() => "");
    throw new Error(`PUT ${key}: HTTP ${res.status} ${text.slice(0, 200)}`);
  }
}

export async function headObject(
  cfg: S3Config,
  key: string,
  opts?: { fetch?: typeof fetch; now?: Date },
): Promise<boolean> {
  const res = await signedRequest(
    cfg,
    "HEAD",
    key,
    {
      "x-amz-content-sha256": EMPTY_SHA256,
    },
    EMPTY_SHA256,
    opts?.now ?? new Date(),
    opts?.fetch ?? fetch,
  );
  if (res.status === 200) return true;
  if (res.status === 404) return false;
  throw new Error(`HEAD ${key}: HTTP ${res.status}`);
}

/** The object's bytes; null on a 404; throws on any other non-2xx. */
export async function getObject(
  cfg: S3Config,
  key: string,
  opts?: { fetch?: typeof fetch; now?: Date },
): Promise<Uint8Array | null> {
  const res = await signedRequest(
    cfg,
    "GET",
    key,
    { "x-amz-content-sha256": EMPTY_SHA256 },
    EMPTY_SHA256,
    opts?.now ?? new Date(),
    opts?.fetch ?? fetch,
  );
  if (res.status === 404) return null;
  if (res.status < 200 || res.status > 299) {
    throw new Error(`GET ${key}: HTTP ${res.status}`);
  }
  return new Uint8Array(await res.arrayBuffer());
}
