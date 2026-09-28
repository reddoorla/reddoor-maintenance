import { describe, it, expect, vi, afterEach } from "vitest";
import {
  applyThrottle,
  RATE_LIMIT_RETRY_DELAYS_MS,
} from "../../../src/reports/airtable/throttle.js";
import { openBase, REQUEST_TIMEOUT_MS } from "../../../src/reports/airtable/client.js";
import {
  fetchAttachmentBytes,
  uploadAttachment,
} from "../../../src/reports/airtable/attachments.js";

type Callback = (err: unknown, resp?: unknown, body?: unknown) => void;
type Scripted = { err: unknown; resp?: unknown; body?: unknown } | "throw";

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

const QUOTA_BODY = {
  errors: [
    {
      error: "PUBLIC_API_BILLING_LIMIT_EXCEEDED",
      message:
        "API billing plan limit exceeded. You've reached the maximum number of requests allowed for this month.",
    },
  ],
};
const RATE_BODY = { errors: [{ error: "RATE_LIMIT_REACHED", message: "Rate limit exceeded." }] };
const tooMany = () => ({
  error: "TOO_MANY_REQUESTS",
  message: "You have made too many requests in a short period of time.",
  statusCode: 429,
});

function scriptedBase(script: Scripted[]) {
  const hits: unknown[][] = [];
  const base = {
    _base: {
      runAction: (...args: unknown[]) => {
        hits.push(args.slice(0, 4));
        const step = script[Math.min(hits.length - 1, script.length - 1)]!;
        if (step === "throw") throw new Error("sync boom");
        (args[4] as Callback)(step.err, step.resp, step.body);
      },
    },
  };
  const waits: number[] = [];
  applyThrottle(base, {
    minIntervalMs: 0,
    now: () => 0,
    delay: async (ms) => {
      waits.push(ms);
    },
  });
  const call = () =>
    new Promise<{ err: unknown; resp: unknown; body: unknown }>((resolve) => {
      (base._base.runAction as (...a: unknown[]) => void)(
        "get",
        "/Websites",
        {},
        null,
        (err: unknown, resp: unknown, body: unknown) => resolve({ err, resp, body }),
      );
    });
  return { base, hits, waits, call };
}

describe("applyThrottle: a 429 fails fast instead of hanging", () => {
  it("passes a 200 through untouched after exactly one request (known-good control)", async () => {
    const resp = { statusCode: 200 };
    const body = { records: [] };
    const { hits, waits, call } = scriptedBase([{ err: null, resp, body }]);
    const out = await call();
    expect(out).toEqual({ err: null, resp, body });
    expect(hits).toEqual([["get", "/Websites", {}, null]]);
    expect(waits).toEqual([]);
  });

  it("fails the monthly-quota 429 on the first response with a real Error, no retry", async () => {
    const { hits, waits, call } = scriptedBase([{ err: tooMany(), body: QUOTA_BODY }]);
    const { err } = await call();
    expect(hits).toHaveLength(1);
    expect(waits).toEqual([]);
    expect(err).toBeInstanceOf(Error);
    expect(err).toMatchObject({ code: "AIRTABLE_QUOTA_EXHAUSTED", statusCode: 429 });
    expect((err as Error).message).toContain("PUBLIC_API_BILLING_LIMIT_EXCEEDED");
  });

  it("retries a transient 429 on the bounded schedule and resolves when it clears", async () => {
    const resp = { statusCode: 200 };
    const { hits, waits, call } = scriptedBase([
      { err: tooMany(), body: RATE_BODY },
      { err: tooMany(), body: RATE_BODY },
      { err: null, resp, body: { records: [] } },
    ]);
    const out = await call();
    expect(out.err).toBeNull();
    expect(out.resp).toBe(resp);
    expect(hits).toHaveLength(3);
    expect(waits).toEqual(RATE_LIMIT_RETRY_DELAYS_MS.slice(0, 2));
  });

  it("gives up on a persistent transient 429 after the last retry", async () => {
    const { hits, waits, call } = scriptedBase([{ err: tooMany(), body: RATE_BODY }]);
    const { err } = await call();
    expect(hits).toHaveLength(RATE_LIMIT_RETRY_DELAYS_MS.length + 1);
    expect(waits).toEqual([...RATE_LIMIT_RETRY_DELAYS_MS]);
    expect(err).toBeInstanceOf(Error);
    expect(err).toMatchObject({ code: "AIRTABLE_RATE_LIMITED", statusCode: 429 });
  });

  it("treats a 429 with no parseable body as transient", async () => {
    const { hits, call } = scriptedBase([{ err: tooMany() }]);
    const { err } = await call();
    expect(hits).toHaveLength(RATE_LIMIT_RETRY_DELAYS_MS.length + 1);
    expect(err).toMatchObject({ code: "AIRTABLE_RATE_LIMITED" });
  });

  it("passes a non-429 error through unchanged", async () => {
    const notFound = { error: "NOT_FOUND", statusCode: 404 };
    const { hits, call } = scriptedBase([{ err: notFound }]);
    const { err } = await call();
    expect(hits).toHaveLength(1);
    expect(err).toBe(notFound);
  });

  it("names a request timeout instead of reporting an aborted request", async () => {
    const abort = Object.assign(new Error("The user aborted a request."), { name: "AbortError" });
    const { call } = scriptedBase([{ err: abort }]);
    const { err } = await call();
    expect(err).toBeInstanceOf(Error);
    expect(err).toMatchObject({ code: "AIRTABLE_TIMEOUT" });
  });

  it("hands a synchronous throw to the callback rather than swallowing it", async () => {
    const { call } = scriptedBase(["throw"]);
    const settled = await Promise.race([
      call(),
      flush()
        .then(() => flush())
        .then(() => "hung"),
    ]);
    expect(settled).not.toBe("hung");
    expect((settled as { err: Error }).err.message).toBe("sync boom");
  });
});

describe("the raw Airtable fetches carry a timeout", () => {
  const realFetch = global.fetch;
  const saved = { pat: process.env.AIRTABLE_PAT, base: process.env.AIRTABLE_BASE_ID };
  afterEach(() => {
    global.fetch = realFetch;
    process.env.AIRTABLE_PAT = saved.pat;
    process.env.AIRTABLE_BASE_ID = saved.base;
    if (saved.pat === undefined) delete process.env.AIRTABLE_PAT;
    if (saved.base === undefined) delete process.env.AIRTABLE_BASE_ID;
  });

  function recordingFetch() {
    const inits: Array<RequestInit | undefined> = [];
    global.fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      inits.push(init);
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        headers: new Headers({ "content-type": "image/png" }),
        arrayBuffer: async () => new Uint8Array([137, 80, 78, 71]).buffer,
        text: async () => "",
        json: async () => ({ fields: { fldX: [{ id: "att1" }, { id: "att2" }] } }),
      } as unknown as Response;
    }) as unknown as typeof fetch;
    return inits;
  }

  it("fetchAttachmentBytes", async () => {
    const inits = recordingFetch();
    await fetchAttachmentBytes("https://example.com/header.png");
    expect(inits).toHaveLength(1);
    expect(inits[0]?.signal).toBeInstanceOf(AbortSignal);
  });

  it("uploadAttachment's upload and its prune", async () => {
    process.env.AIRTABLE_PAT = "pat_test";
    process.env.AIRTABLE_BASE_ID = "app_test";
    const inits = recordingFetch();
    await uploadAttachment("recEXIST", "Header image", "x", "h.png", "image/png", {
      replaceIn: "Websites",
    });
    expect(inits.map((i) => i?.method)).toEqual(["POST", "PATCH"]);
    for (const init of inits) expect(init?.signal).toBeInstanceOf(AbortSignal);
  });
});

describe("every Airtable client is built by openBase", () => {
  it("finds no `new Airtable(` outside client.ts", async () => {
    const { readdir, readFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const root = join(__dirname, "../../..");
    const hits: string[] = [];
    async function walk(dir: string): Promise<void> {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) await walk(path);
        else if (/\.(m?ts|mjs)$/.test(entry.name)) {
          const text = await readFile(path, "utf8");
          if (/new\s+Airtable\s*\(/.test(text)) hits.push(path.slice(root.length + 1));
        }
      }
    }
    for (const dir of ["src", "netlify", "scripts"]) await walk(join(root, dir));
    expect(hits).toContain("src/reports/airtable/client.ts");
    expect(hits.filter((p) => p !== "src/reports/airtable/client.ts")).toEqual([]);
  });
});

describe("openBase", () => {
  it("builds a client that never retries a 429 itself and bounds each request", () => {
    const base = openBase({ apiKey: "patFAKE", baseId: "appFAKE" }) as unknown as {
      _base: { _airtable: { _noRetryIfRateLimited: boolean; _requestTimeout: number } };
    };
    expect(base._base._airtable._noRetryIfRateLimited).toBe(true);
    expect(base._base._airtable._requestTimeout).toBe(REQUEST_TIMEOUT_MS);
    expect(REQUEST_TIMEOUT_MS).toBe(30_000);
  });
});
