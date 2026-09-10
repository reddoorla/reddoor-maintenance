import { describe, it, expect, afterEach, vi } from "vitest";
import type { Context } from "@netlify/functions";

vi.mock("../../src/reports/airtable/client.js", () => ({ openBase: vi.fn(() => ({}) as unknown) }));

let sharedDb: Awaited<ReturnType<typeof import("../../src/db/client.js").openDb>> | null = null;
vi.mock("../../src/db/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/db/client.js")>();
  return {
    ...actual,
    openDb: vi.fn(async (cfg: Parameters<typeof actual.openDb>[0]) => {
      sharedDb ??= await actual.openDb(cfg);
      return sharedDb;
    }),
  };
});

import { openDb, readDbConfig } from "../../src/db/client.js";
import {
  createProspectAudit,
  getProspectAuditByToken,
  OVERRIDES_MAX_LEN,
} from "../../src/db/prospect-audits.js";
import saveOverrides, { MAX_BODY_BYTES } from "../../netlify/functions/audit-report-overrides.mjs";

const ORIGINAL_ENV = { ...process.env };
afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  sharedDb = null;
});

const ctxFor = (token: string) => ({ params: { token } }) as unknown as Context;

function post(body: unknown, token?: string): Request {
  return new Request("https://ops.reddoor.test/api/audit-report/x/overrides", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

async function seed() {
  process.env.TURSO_DATABASE_URL = ":memory:";
  process.env.PROSPECT_EDIT_TOKEN = "s3cret";
  const db = await openDb(readDbConfig());
  const { token } = await createProspectAudit(db, {
    url: "https://acme.test/",
    business: "Acme",
    resultJson: JSON.stringify({ url: "https://acme.test/" }),
  });
  return { db, token };
}

const MAP = { "composed:headlineFinding": { original: "a", text: "b" } };

describe("audit-report-overrides", () => {
  it("stores the map for a correct token", async () => {
    const { db, token } = await seed();
    const res = await saveOverrides(post({ overrides: MAP }, "s3cret"), ctxFor(token));
    expect(res.status).toBe(200);
    const row = await getProspectAuditByToken(db, token);
    expect(JSON.parse(row!.overrides_json!)).toEqual(MAP);
  });

  it("fails closed when PROSPECT_EDIT_TOKEN is unset", async () => {
    const { db, token } = await seed();
    delete process.env.PROSPECT_EDIT_TOKEN;
    const res = await saveOverrides(post({ overrides: MAP }, "s3cret"), ctxFor(token));
    expect(res.status).toBe(503);
    const row = await getProspectAuditByToken(db, token);
    expect(row!.overrides_json).toBeNull();
  });

  it("refuses a wrong shared token, and says nothing about the report", async () => {
    const { db, token } = await seed();
    const res = await saveOverrides(post({ overrides: MAP }, "wrong"), ctxFor(token));
    expect(res.status).toBe(404);
    const row = await getProspectAuditByToken(db, token);
    expect(row!.overrides_json).toBeNull();
  });

  it("refuses a missing authorization header", async () => {
    const { token } = await seed();
    const res = await saveOverrides(post({ overrides: MAP }), ctxFor(token));
    expect(res.status).toBe(404);
  });

  it("rejects a malformed override map with 400", async () => {
    const { db, token } = await seed();
    const res = await saveOverrides(
      post({ overrides: { k: { original: 1, text: "b" } } }, "s3cret"),
      ctxFor(token),
    );
    expect(res.status).toBe(400);
    const row = await getProspectAuditByToken(db, token);
    expect(row!.overrides_json).toBeNull();
  });

  it("refuses GET", async () => {
    const { token } = await seed();
    const res = await saveOverrides(
      new Request("https://ops.reddoor.test/x", { method: "GET" }),
      ctxFor(token),
    );
    expect(res.status).toBe(405);
  });

  it("404s a malformed report token", async () => {
    await seed();
    const res = await saveOverrides(post({ overrides: MAP }, "s3cret"), ctxFor("nope"));
    expect(res.status).toBe(404);
  });
});

/**
 * A raw-text POST, so a test can control the body's exact bytes and its
 * `content-length` independently of each other.
 *
 * Measured, not assumed: undici's `Request` does NOT compute a `content-length`
 * for a string body — `new Request(url, { method: "POST", body: "x".repeat(100)
 * }).headers.get("content-length")` is `null` on Node 24.16.0. So the DEFAULT
 * here is the absent-header case, and the read-side byte check is the only thing
 * that can refuse it. A declared length only exists when a test passes one.
 */
function postRaw(bodyText: string, token: string, contentLength?: string): Request {
  return new Request("https://ops.reddoor.test/api/audit-report/x/overrides", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
      ...(contentLength ? { "content-length": contentLength } : {}),
    },
    body: bodyText,
  });
}

/** A syntactically valid overrides body padded out to at least `bytes`. */
function oversizedBody(bytes: number, padChar = "x"): string {
  const shell = `{"overrides":{"composed:headlineFinding":{"original":"a","text":""}}}`;
  return shell.replace('"text":""', `"text":"${padChar.repeat(bytes)}"`);
}

describe("audit-report-overrides — the request body is bounded", () => {
  it("refuses a body over the cap with 413, and stores nothing", async () => {
    const { db, token } = await seed();
    const res = await saveOverrides(
      postRaw(oversizedBody(MAX_BODY_BYTES + 1_000), "s3cret"),
      ctxFor(token),
    );
    expect(res.status).toBe(413);
    const row = await getProspectAuditByToken(db, token);
    expect(row!.overrides_json).toBeNull();
  });

  it("refuses an oversized body whose content-length LIES about its size", async () => {
    const { db, token } = await seed();
    // The header claims 42 bytes; the body is megabytes. A guard that trusts the
    // declared length lets this through, which is why the bytes actually read
    // have to be measured too. (Verified that a manually-set content-length IS
    // preserved on the Request — it reads back as "42".)
    const req = postRaw(oversizedBody(MAX_BODY_BYTES + 1_000), "s3cret", "42");
    expect(req.headers.get("content-length")).toBe("42");
    const res = await saveOverrides(req, ctxFor(token));
    expect(res.status).toBe(413);
    const row = await getProspectAuditByToken(db, token);
    expect(row!.overrides_json).toBeNull();
  });

  it("refuses on a declared content-length over the cap, without reading the body", async () => {
    const { db, token } = await seed();
    // The mirror image of the test above: a small, perfectly good body behind a
    // huge declared length. Only the cheap header check can refuse this one —
    // the bytes read are tiny — so this is what proves that check exists.
    const res = await saveOverrides(
      postRaw(JSON.stringify({ overrides: MAP }), "s3cret", String(MAX_BODY_BYTES + 1)),
      ctxFor(token),
    );
    expect(res.status).toBe(413);
    const row = await getProspectAuditByToken(db, token);
    expect(row!.overrides_json).toBeNull();
  });

  it("still accepts a normal, small body", async () => {
    // The control. Without it a cap of zero would satisfy every test above.
    const { db, token } = await seed();
    const res = await saveOverrides(
      postRaw(JSON.stringify({ overrides: MAP }), "s3cret"),
      ctxFor(token),
    );
    expect(res.status).toBe(200);
    const row = await getProspectAuditByToken(db, token);
    expect(JSON.parse(row!.overrides_json!)).toEqual(MAP);
  });

  it("measures the cap in BYTES, not characters", async () => {
    const { db, token } = await seed();
    // CJK: one UTF-16 code unit, three UTF-8 bytes. This body is comfortably
    // under the cap by `String.length` and well over it on the wire, so a guard
    // written against `.length` accepts it and a byte-measuring one refuses it.
    const padChars = Math.ceil(MAX_BODY_BYTES / 2);
    const body = oversizedBody(padChars, "一");
    expect(body.length).toBeLessThan(MAX_BODY_BYTES);
    expect(Buffer.byteLength(body, "utf8")).toBeGreaterThan(MAX_BODY_BYTES);
    const res = await saveOverrides(postRaw(body, "s3cret"), ctxFor(token));
    expect(res.status).toBe(413);
    const row = await getProspectAuditByToken(db, token);
    expect(row!.overrides_json).toBeNull();
  });

  it("leaves room for a canonically-serialised map at the storage limit", async () => {
    // The invariant behind the number, asserted rather than left in a comment.
    // OVERRIDES_MAX_LEN counts UTF-16 code units of the STORED string; this cap
    // counts UTF-8 bytes on the wire, and the worst-case ratio between them is
    // 3 (a BMP character outside Latin-1 — CJK — is one code unit and three
    // bytes; an astral character is two units and four bytes, so only 2). If
    // OVERRIDES_MAX_LEN is ever raised without this moving, the body gate would
    // start refusing saves the storage layer would have accepted, and the 413
    // would look like a bug in the editor. This reds first instead.
    expect(MAX_BODY_BYTES).toBeGreaterThanOrEqual(OVERRIDES_MAX_LEN * 3 + 1_024);
  });
});
