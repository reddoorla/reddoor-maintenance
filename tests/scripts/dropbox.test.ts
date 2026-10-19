import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createHash } from "node:crypto";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  BLOCK,
  CHUNK,
  SIMPLE_LIMIT,
  MAX_ATTEMPTS,
  MAX_WAIT_S,
  PROBE_ID,
  DropboxError,
  missingScope,
  parseArgs,
  contentHash,
  contentHasher,
  contentHashFile,
  headerJson,
  dropboxPath,
  missingEnv,
  rootHeader,
  mintToken,
  connect,
  accountLine,
  uploadFile,
  closeRequest,
  run,
  proxyReexecEnv,
  type Ctx,
  type FetchLike,
  type RequestInitLike,
  type ResponseLike,
} from "../../scripts/dropbox.mjs";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "../../scripts/dropbox.mjs");
const ENV = {
  DROPBOX_APP_KEY: "k3y",
  DROPBOX_APP_SECRET: "s3cret",
  DROPBOX_REFRESH_TOKEN: "r3fresh",
};
const ROOT = "1111111111";
const ACCOUNT = {
  name: { display_name: "Ada Example" },
  email: "ada@example.com",
  team: { name: "Example Team" },
  root_info: { root_namespace_id: ROOT, home_namespace_id: "2222222222" },
};

type Call = { url: string; init: RequestInitLike };
type Reply = { status?: number; body?: unknown; headers?: Record<string, string> };

function respond(r: Reply): ResponseLike {
  const h = Object.fromEntries(
    Object.entries(r.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]),
  );
  return {
    status: r.status ?? 200,
    headers: { get: (n: string) => h[n.toLowerCase()] ?? null },
    text: async () => (typeof r.body === "string" ? r.body : JSON.stringify(r.body ?? {})),
  };
}

function fake(route: (endpoint: string, call: Call, calls: Call[]) => Reply) {
  const calls: Call[] = [];
  const fetch: FetchLike = async (url, init) => {
    const call = { url, init };
    calls.push(call);
    const endpoint = url.replace(/^https:\/\/[^/]+\/(2\/)?/, "");
    return respond(route(endpoint, call, calls));
  };
  return { fetch, calls };
}

function argOf(call: Call) {
  return JSON.parse(call.init.headers["Dropbox-API-Arg"]!);
}

function bytes(call: Call) {
  return Buffer.from(call.init.body as Uint8Array);
}

function pattern(n: number) {
  const b = Buffer.alloc(n);
  for (let i = 0; i < n; i++) b[i] = i % 251;
  return b;
}

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "dropbox-test-"));
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

function file(name: string, data: Buffer) {
  const p = join(dir, name);
  writeFileSync(p, data);
  return p;
}

function ctxWith(fetch: FetchLike, sleep?: (ms: number) => Promise<void>): Ctx {
  return {
    fetch,
    env: ENV,
    ...(sleep ? { sleep } : {}),
    token: "tok",
    root: ROOT,
    account: ACCOUNT,
  };
}

describe("contentHash", () => {
  it("matches vectors whose algorithm was proven against Dropbox's own content_hash", () => {
    expect(contentHash(Buffer.alloc(0))).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
    expect(contentHash(pattern(1))).toBe(
      "1406e05881e299367766d313e26c05564ec91bf721d31726bd6e46e60689539a",
    );
    expect(contentHash(pattern(BLOCK))).toBe(
      "b9654428408015906b44a00935b70af33830aa344b780b0eabd535a133150d04",
    );
    expect(contentHash(pattern(BLOCK + 1))).toBe(
      "4a6cc0a344febaa07772e7c974834b2fb1d24594d4ba15f27c97a54699709f44",
    );
    expect(contentHash(pattern(2 * BLOCK + 5))).toBe(
      "ca8fd9d4e4569dded35738038c5a4ff54a8463680059e32fb2ccf1c1019b79d5",
    );
  });

  it("is the SHA-256 of the raw block digests, not of the file", () => {
    const one = pattern(1000);
    const blockDigest = createHash("sha256").update(one).digest();
    expect(contentHash(one)).toBe(createHash("sha256").update(blockDigest).digest("hex"));
    expect(contentHash(one)).not.toBe(createHash("sha256").update(one).digest("hex"));
  });

  it("gives the same answer whatever the update boundaries", () => {
    const data = pattern(2 * BLOCK + 8);
    const expected = contentHash(data);
    for (const cuts of [[3, BLOCK], [1, 1, BLOCK - 2, 7], [BLOCK + 1], [0, 5, 0]]) {
      const h = contentHasher();
      let at = 0;
      for (const n of cuts) {
        h.update(data.subarray(at, at + n));
        at += n;
      }
      h.update(data.subarray(at));
      expect(h.digest()).toBe(expected);
    }
  });

  it("gives the same answer streaming from disk as from memory", async () => {
    for (const n of [0, 1, BLOCK - 1, BLOCK, BLOCK + 1, 2 * BLOCK + 5]) {
      const data = pattern(n);
      expect(await contentHashFile(file(`h${n}.bin`, data))).toBe(contentHash(data));
    }
  });
});

describe("headerJson", () => {
  it("escapes every non-ASCII character so the Dropbox-API-Arg header is legal", () => {
    const arg = { path: "/Clients/Résumé — Q4 📄.pdf", mode: "add" };
    const h = headerJson(arg);
    expect(h).toMatch(/^[\x20-\x7e]+$/);
    expect(h).toContain("\\u00e9");
    expect(h).toContain("\\u2014");
    expect(JSON.parse(h)).toEqual(arg);
  });
});

describe("parseArgs", () => {
  it("reads each command", () => {
    expect(parseArgs(["check"])).toEqual({ cmd: "check" });
    expect(parseArgs(["upload", "/Design Resources/X", "a.pdf", "b.png"])).toEqual({
      cmd: "upload",
      folder: "/Design Resources/X",
      files: ["a.pdf", "b.png"],
      overwrite: true,
    });
    expect(parseArgs(["upload", "/X", "a.pdf", "--no-overwrite"])).toMatchObject({
      overwrite: false,
    });
    expect(parseArgs(["close-request", "abc", "def"])).toEqual({
      cmd: "close-request",
      ids: ["abc", "def"],
    });
    expect(parseArgs(["hash", "a.pdf"])).toEqual({ cmd: "hash", files: ["a.pdf"] });
  });

  it("refuses what it cannot run", () => {
    expect(() => parseArgs([])).toThrow(/no command/);
    expect(() => parseArgs(["nope"])).toThrow(/unknown command/);
    expect(() => parseArgs(["upload", "/X"])).toThrow(/at least one file/);
    expect(() => parseArgs(["upload", "X", "a.pdf"])).toThrow(/must start with "\/"/);
    expect(() => parseArgs(["close-request", "--no-overwrite", "abc"])).toThrow(/unknown option/);
    expect(() => parseArgs(["check", "extra"])).toThrow(/no arguments/);
  });

  it("refuses two files that would land on the same Dropbox path", () => {
    expect(() => parseArgs(["upload", "/X", "a/deck.pdf", "b/deck.pdf"])).toThrow(
      "a/deck.pdf and b/deck.pdf would both upload to /X/deck.pdf",
    );
    expect(() => parseArgs(["upload", "/X", "shots/Logo.png", "export/logo.png"])).toThrow(
      "shots/Logo.png and export/logo.png would both upload to /X/logo.png",
    );
    expect(parseArgs(["upload", "/X", "a/deck.pdf", "b/deck-2.pdf"])).toMatchObject({
      files: ["a/deck.pdf", "b/deck-2.pdf"],
    });
  });
});

describe("small helpers", () => {
  it("joins a Dropbox folder and a local file's name", () => {
    expect(dropboxPath("/Design Resources/X/", "/tmp/a/b.pdf")).toBe("/Design Resources/X/b.pdf");
    expect(dropboxPath("/", "b.pdf")).toBe("/b.pdf");
  });

  it("names missing variables and never their values", () => {
    expect(missingEnv({ DROPBOX_APP_KEY: "x" })).toEqual([
      "DROPBOX_APP_SECRET",
      "DROPBOX_REFRESH_TOKEN",
    ]);
    expect(missingEnv(ENV)).toEqual([]);
  });

  it("builds the team path-root header", () => {
    expect(JSON.parse(rootHeader(ROOT))).toEqual({ ".tag": "root", root: ROOT });
  });

  it("reads the missing scope from each shape Dropbox uses", () => {
    expect(
      missingScope({ error: { ".tag": "missing_scope", required_scope: "files.content.write" } }),
    ).toBe("files.content.write");
    expect(
      missingScope(
        "Error in call to API function \"file_requests/update\": Your app (ID: 1) is not permitted to access this endpoint because it does not have the required scope 'file_requests.write'.",
      ),
    ).toBe("file_requests.write");
    expect(
      missingScope({
        error: { ".tag": "other" },
        user_message: { text: "has the required scope 'files.content.write'" },
      }),
    ).toBe("files.content.write");
    expect(missingScope({ error_summary: "path/not_found/" })).toBeNull();
  });

  it("re-executes through the proxy only when one is set and not yet enabled", () => {
    expect(proxyReexecEnv({})).toBeNull();
    expect(proxyReexecEnv({ HTTPS_PROXY: "http://p", NODE_USE_ENV_PROXY: "1" })).toBeNull();
    expect(proxyReexecEnv({ HTTPS_PROXY: "http://p" })).toMatchObject({ NODE_USE_ENV_PROXY: "1" });
  });
});

describe("mintToken and connect", () => {
  it("trades the refresh token for an access token with the app key and secret as basic auth", async () => {
    const { fetch, calls } = fake(() => ({ body: { access_token: "sl.abc", expires_in: 14400 } }));
    expect(await mintToken({ fetch, env: ENV })).toBe("sl.abc");
    expect(calls[0]!.url).toBe("https://api.dropboxapi.com/oauth2/token");
    expect(calls[0]!.init.headers.authorization).toBe(
      "Basic " + Buffer.from("k3y:s3cret").toString("base64"),
    );
    const form = new URLSearchParams(calls[0]!.init.body as string);
    expect(form.get("grant_type")).toBe("refresh_token");
    expect(form.get("refresh_token")).toBe("r3fresh");
  });

  it("refuses a missing variable by name before calling anything", async () => {
    const { fetch, calls } = fake(() => ({}));
    await expect(mintToken({ fetch, env: { DROPBOX_APP_KEY: "k3y" } })).rejects.toThrow(
      "missing environment variables: DROPBOX_APP_SECRET, DROPBOX_REFRESH_TOKEN",
    );
    expect(calls).toHaveLength(0);
  });

  it("reports a refused refresh token without echoing any credential", async () => {
    const { fetch } = fake(() => ({
      status: 400,
      body: { error: "invalid_grant", error_description: "refresh token is invalid or revoked" },
    }));
    const err = (await mintToken({ fetch, env: ENV }).then(
      () => new Error("resolved"),
      (e: Error) => e,
    )) as Error;
    expect(err.message).toBe(
      "oauth2/token: HTTP 400 invalid_grant: refresh token is invalid or revoked",
    );
    for (const v of Object.values(ENV)) expect(err.message).not.toContain(v);
    expect(err.message).not.toContain(Buffer.from("k3y:s3cret").toString("base64"));
  });

  it("names the endpoint when the response body cannot be read", async () => {
    const fetch: FetchLike = async () => ({
      status: 200,
      text: async () => {
        throw new TypeError("terminated");
      },
    });
    await expect(closeRequest(ctxWith(fetch), "a")).rejects.toThrow(
      "file_requests/update: reading the response failed: terminated",
    );
  });

  it("names the endpoint and the cause of a network failure, and no credential", async () => {
    const local = file("net.pdf", pattern(3));
    const fetch: FetchLike = async () => {
      throw new TypeError("fetch failed", {
        cause: Object.assign(new Error("x"), { code: "ECONNRESET" }),
      });
    };
    const err = (await uploadFile(ctxWith(fetch), local, "/X").then(
      () => new Error("resolved"),
      (e: Error) => e,
    )) as Error;
    expect(err.message).toBe("files/upload: fetch failed (ECONNRESET)");
    expect(err.message).not.toContain("tok");
  });

  it("takes the path root from the account's root namespace", async () => {
    const { fetch, calls } = fake((ep) =>
      ep === "oauth2/token" ? { body: { access_token: "sl.abc" } } : { body: ACCOUNT },
    );
    const ctx = await connect({ fetch, env: ENV });
    expect(ctx.root).toBe(ROOT);
    expect(ctx.token).toBe("sl.abc");
    expect(calls[1]!.url).toBe("https://api.dropboxapi.com/2/users/get_current_account");
    expect(calls[1]!.init.headers.authorization).toBe("Bearer sl.abc");
  });
});

describe("uploadFile", () => {
  it("uploads a small file in one call into the team space and verifies the hash", async () => {
    const data = pattern(5000);
    const local = file("small.pdf", data);
    const { fetch, calls } = fake(() => ({
      body: {
        path_display: "/Design Resources/X/small.pdf",
        size: data.length,
        content_hash: contentHash(data),
      },
    }));
    const r = await uploadFile(ctxWith(fetch), local, "/Design Resources/X");
    expect(r.ok).toBe(true);
    expect(calls).toHaveLength(1);
    const c = calls[0]!;
    expect(c.url).toBe("https://content.dropboxapi.com/2/files/upload");
    expect(c.init.headers["Dropbox-API-Path-Root"]).toBe(rootHeader(ROOT));
    expect(argOf(c)).toEqual({
      path: "/Design Resources/X/small.pdf",
      mode: "overwrite",
      autorename: false,
      mute: false,
    });
    expect(bytes(c).equals(data)).toBe(true);
  });

  it("asks Dropbox not to overwrite when told so", async () => {
    const data = pattern(10);
    const local = file("keep.pdf", data);
    const { fetch, calls } = fake(() => ({ body: { size: 10, content_hash: contentHash(data) } }));
    await uploadFile(ctxWith(fetch), local, "/X", { overwrite: false });
    expect(argOf(calls[0]!).mode).toBe("add");
  });

  it("fails verification when Dropbox stored different bytes", async () => {
    const data = pattern(10);
    const local = file("bad.pdf", data);
    const other = pattern(11).subarray(1);
    const { fetch } = fake(() => ({ body: { size: 10, content_hash: contentHash(other) } }));
    const r = await uploadFile(ctxWith(fetch), local, "/X");
    expect(r.ok).toBe(false);
    expect(r.localHash).toBe(contentHash(data));
    expect(r.remoteHash).toBe(contentHash(other));
  });

  it("keeps a file at the limit in one call and moves one byte more to a session", async () => {
    const at = file("at-limit.bin", pattern(64));
    const over = file("over-limit.bin", pattern(65));
    const reply = (ep: string): Reply =>
      ep === "files/upload_session/start"
        ? { body: { session_id: "s" } }
        : { body: { size: 0, content_hash: "" } };
    const one = fake(reply);
    await uploadFile(ctxWith(one.fetch), at, "/X", { simpleLimit: 64, chunk: 64 });
    expect(one.calls.map((c) => c.url.split("/2/")[1])).toEqual(["files/upload"]);
    const two = fake(reply);
    await uploadFile(ctxWith(two.fetch), over, "/X", { simpleLimit: 64, chunk: 64 });
    expect(two.calls.map((c) => c.url.split("/2/")[1])).toEqual([
      "files/upload_session/start",
      "files/upload_session/finish",
    ]);
  });

  it("never sends one request larger than a chunk by default", () => {
    expect(SIMPLE_LIMIT).toBe(CHUNK);
    expect(CHUNK % BLOCK).toBe(0);
  });

  it("sends a non-ASCII file name as an ASCII header that decodes to the same path", async () => {
    const local = file("Résumé — Q4.pdf", pattern(5));
    const { fetch, calls } = fake(() => ({
      body: { size: 5, content_hash: contentHash(pattern(5)) },
    }));
    await uploadFile(ctxWith(fetch), local, "/Clients/Café");
    const raw = calls[0]!.init.headers["Dropbox-API-Arg"]!;
    expect(raw).toMatch(/^[\x20-\x7e]+$/);
    expect(JSON.parse(raw).path).toBe("/Clients/Café/Résumé — Q4.pdf");
  });

  it("refuses a 200 that carries no file metadata", async () => {
    const local = file("empty-reply.pdf", pattern(5));
    const { fetch } = fake(() => ({ body: "null" }));
    await expect(uploadFile(ctxWith(fetch), local, "/X")).rejects.toThrow(
      "files/upload: no file metadata in the response",
    );
  });

  it("advances the cursor on every append", async () => {
    const data = pattern(100);
    const local = file("many-chunks.bin", data);
    const { fetch, calls } = fake((ep) =>
      ep === "files/upload_session/start"
        ? { body: { session_id: "s" } }
        : { body: { size: 100, content_hash: contentHash(data) } },
    );
    const r = await uploadFile(ctxWith(fetch), local, "/X", { simpleLimit: 10, chunk: 30 });
    expect(r.ok).toBe(true);
    expect(calls.map((c) => argOf(c).cursor?.offset)).toEqual([undefined, 30, 60, 90]);
    expect(calls.map((c) => bytes(c).length)).toEqual([30, 30, 30, 10]);
    expect(Buffer.concat(calls.map(bytes)).equals(data)).toBe(true);
  });

  it("fails verification when the size differs even if a hash were to agree", async () => {
    const data = pattern(10);
    const local = file("size.pdf", data);
    const { fetch } = fake(() => ({ body: { size: 9, content_hash: contentHash(data) } }));
    expect((await uploadFile(ctxWith(fetch), local, "/X")).ok).toBe(false);
  });

  it("streams a large file through an upload session with the right offsets", async () => {
    const data = pattern(2 * BLOCK + 5);
    const local = file("big.bin", data);
    const { fetch, calls } = fake((ep) =>
      ep === "files/upload_session/start"
        ? { body: { session_id: "sess1" } }
        : ep === "files/upload_session/finish"
          ? {
              body: {
                path_display: "/X/big.bin",
                size: data.length,
                content_hash: contentHash(data),
              },
            }
          : { body: null },
    );
    const r = await uploadFile(ctxWith(fetch), local, "/X", {
      simpleLimit: BLOCK,
      chunk: BLOCK,
      overwrite: false,
    });
    expect(r.ok).toBe(true);
    expect(calls.map((c) => c.url.replace("https://content.dropboxapi.com/2/", ""))).toEqual([
      "files/upload_session/start",
      "files/upload_session/append_v2",
      "files/upload_session/finish",
    ]);
    expect(argOf(calls[0]!)).toEqual({ close: false });
    expect(argOf(calls[1]!)).toEqual({
      cursor: { session_id: "sess1", offset: BLOCK },
      close: false,
    });
    expect(argOf(calls[2]!)).toEqual({
      cursor: { session_id: "sess1", offset: 2 * BLOCK },
      commit: { path: "/X/big.bin", mode: "add", autorename: false, mute: false },
    });
    for (const c of calls) expect(c.init.headers["Dropbox-API-Path-Root"]).toBe(rootHeader(ROOT));
    expect(Buffer.concat(calls.map(bytes)).equals(data)).toBe(true);
  });

  it("uses a session above the limit even when one chunk holds the whole file", async () => {
    const data = pattern(100);
    const local = file("tiny-session.bin", data);
    const { fetch, calls } = fake((ep) =>
      ep === "files/upload_session/start"
        ? { body: { session_id: "s" } }
        : { body: { size: 100, content_hash: contentHash(data) } },
    );
    const r = await uploadFile(ctxWith(fetch), local, "/X", { simpleLimit: 50, chunk: 1000 });
    expect(r.ok).toBe(true);
    expect(calls).toHaveLength(2);
    expect(argOf(calls[1]!).cursor).toEqual({ session_id: "s", offset: 100 });
    expect(bytes(calls[1]!)).toHaveLength(0);
  });
});

describe("retries", () => {
  it("waits out a 429 for as long as Retry-After says, then succeeds", async () => {
    const waits: number[] = [];
    const { fetch, calls } = fake((_ep, _c, all) =>
      all.length === 1
        ? { status: 429, headers: { "Retry-After": "3" }, body: {} }
        : { body: { is_open: false, id: "a" } },
    );
    const r = await closeRequest(
      ctxWith(fetch, async (ms) => {
        waits.push(ms);
      }),
      "a",
    );
    expect(r.ok).toBe(true);
    expect(calls).toHaveLength(2);
    expect(waits).toEqual([3000]);
  });

  it("caps a long Retry-After and waits a second when there is none", async () => {
    const waits: number[] = [];
    const { fetch } = fake((_ep, _c, all) =>
      all.length === 1
        ? { status: 429, headers: { "Retry-After": "600" } }
        : all.length === 2
          ? { status: 429 }
          : { body: { is_open: false, id: "a" } },
    );
    await closeRequest(
      ctxWith(fetch, async (ms) => {
        waits.push(ms);
      }),
      "a",
    );
    expect(waits).toEqual([MAX_WAIT_S * 1000, 1000]);
  });

  it("resends the same offset and bytes when an append is rate-limited", async () => {
    const data = pattern(100);
    const local = file("retry-append.bin", data);
    let appends = 0;
    const { fetch, calls } = fake((ep) => {
      if (ep === "files/upload_session/start") return { body: { session_id: "s" } };
      if (ep === "files/upload_session/append_v2" && appends++ === 0) return { status: 429 };
      if (ep === "files/upload_session/append_v2") return { body: null };
      return { body: { size: 100, content_hash: contentHash(data) } };
    });
    const r = await uploadFile(
      ctxWith(fetch, async () => {}),
      local,
      "/X",
      { simpleLimit: 10, chunk: 40 },
    );
    expect(r.ok).toBe(true);
    const sent = calls.filter((c) => c.url.endsWith("append_v2"));
    expect(sent.map((c) => argOf(c).cursor.offset)).toEqual([40, 40]);
    expect(bytes(sent[0]!).equals(bytes(sent[1]!))).toBe(true);
    expect(argOf(calls.at(-1)!).cursor.offset).toBe(80);
  });

  it("gives up after its last attempt", async () => {
    const { fetch, calls } = fake(() => ({
      status: 429,
      body: { error_summary: "too_many_requests/" },
    }));
    await expect(
      closeRequest(
        ctxWith(fetch, async () => {}),
        "a",
      ),
    ).rejects.toThrow(/HTTP 429/);
    expect(calls).toHaveLength(MAX_ATTEMPTS);
  });
});

describe("closeRequest", () => {
  it("closes by id and confirms is_open is false", async () => {
    const { fetch, calls } = fake(() => ({ body: { id: "rwq", title: "T", is_open: false } }));
    const r = await closeRequest(ctxWith(fetch), "rwq");
    expect(r).toEqual({ id: "rwq", title: "T", is_open: false, ok: true });
    expect(calls[0]!.url).toBe("https://api.dropboxapi.com/2/file_requests/update");
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({ id: "rwq", open: false });
    expect(calls[0]!.init.headers["Dropbox-API-Path-Root"]).toBe(rootHeader(ROOT));
  });

  it("does not call a request closed while Dropbox still says it is open", async () => {
    const { fetch } = fake(() => ({ body: { id: "rwq", title: "T", is_open: true } }));
    expect((await closeRequest(ctxWith(fetch), "rwq")).ok).toBe(false);
  });
});

describe("run", () => {
  function session(handler: (ep: string, c: Call) => Reply) {
    return fake((ep, c) =>
      ep === "oauth2/token"
        ? { body: { access_token: "sl.abc" } }
        : ep === "users/get_current_account"
          ? { body: ACCOUNT }
          : handler(ep, c),
    );
  }

  it("check names the account and proves each write scope without changing anything", async () => {
    const { fetch, calls } = session((ep) =>
      ep === "files/upload_session/start"
        ? { body: { session_id: "s" } }
        : { status: 409, body: { error_summary: "not_found/", error: { ".tag": "not_found" } } },
    );
    const r = await run({ cmd: "check" }, { fetch, env: ENV });
    expect(r.code).toBe(0);
    expect(r.lines).toEqual([
      "account: Ada Example <ada@example.com>, team Example Team, root namespace 1111111111 (team space)",
      "files.content.write: granted",
      "file_requests.write: granted",
    ]);
    const start = calls.find((c) => c.url.endsWith("upload_session/start"))!;
    expect(argOf(start)).toEqual({ close: true });
    expect(bytes(start)).toHaveLength(0);
    const update = calls.find((c) => c.url.endsWith("file_requests/update"))!;
    expect(JSON.parse(update.init.body as string)).toEqual({ id: PROBE_ID });
  });

  it("check fails on a missing scope and on an answer it cannot read", async () => {
    const { fetch } = session((ep) =>
      ep === "files/upload_session/start"
        ? {
            status: 401,
            body: { error: { ".tag": "missing_scope", required_scope: "files.content.write" } },
          }
        : { status: 400, body: "Error in call to API function: bad id" },
    );
    const r = await run({ cmd: "check" }, { fetch, env: ENV });
    expect(r.code).toBe(1);
    expect(r.lines[1]).toMatch(
      /^files\.content\.write: MISSING \(files\/upload_session\/start: missing_scope files\.content\.write\. The app has it/,
    );
    expect(r.lines[2]).toBe(
      "file_requests.write: UNKNOWN (file_requests/update: HTTP 400 Error in call to API function: bad id)",
    );
  });

  it("check shows a 409 other than not_found beside the granted scope", async () => {
    const { fetch } = session((ep) =>
      ep === "files/upload_session/start"
        ? { body: { session_id: "s" } }
        : { status: 409, body: { error_summary: "disabled_for_team/" } },
    );
    const r = await run({ cmd: "check" }, { fetch, env: ENV });
    expect(r.lines[2]).toBe("file_requests.write: granted (HTTP 409 disabled_for_team/)");
  });

  it("says when the root is only the personal home folder", () => {
    const personal = {
      ...ACCOUNT,
      team: {},
      root_info: { root_namespace_id: "1", home_namespace_id: "1" },
    };
    expect(accountLine({ ...ctxWith(async () => respond({})), root: "1", account: personal })).toBe(
      "account: Ada Example <ada@example.com>, root namespace 1 (personal space: the root is the home folder)",
    );
  });

  it("emits each line as it happens", async () => {
    const data = pattern(4);
    const local = file("emit.png", data);
    const seen: string[] = [];
    const { fetch, calls } = session(() => ({
      body: { path_display: "/X/emit.png", size: 4, content_hash: contentHash(data) },
    }));
    const r = await run(
      { cmd: "upload", folder: "/X", files: [local], overwrite: true },
      { fetch, env: ENV, emit: (l) => seen.push(`${calls.length} ${l}`) },
    );
    expect(seen).toEqual([`2 ${r.lines[0]}`, `3 ${r.lines[1]}`]);
  });

  it("prints a match line per file and exits 0", async () => {
    const data = pattern(64);
    const local = file("ok.png", data);
    const { fetch } = session(() => ({
      body: { path_display: "/X/ok.png", size: 64, content_hash: contentHash(data) },
    }));
    const r = await run(
      { cmd: "upload", folder: "/X", files: [local], overwrite: true },
      { fetch, env: ENV },
    );
    expect(r.code).toBe(0);
    expect(r.lines[1]).toBe(
      `ok /X/ok.png 64 bytes content_hash ${contentHash(data)} matches local`,
    );
  });

  it("exits 1 on a mismatch and keeps going through the other files", async () => {
    const a = file("a.png", pattern(8));
    const b = file("b.png", pattern(9));
    const { fetch } = session((_ep, c) => {
      const p = argOf(c).path as string;
      return p.endsWith("a.png")
        ? { body: { path_display: p, size: 8, content_hash: "0".repeat(64) } }
        : { body: { path_display: p, size: 9, content_hash: contentHash(pattern(9)) } };
    });
    const r = await run(
      { cmd: "upload", folder: "/X", files: [a, b], overwrite: true },
      { fetch, env: ENV },
    );
    expect(r.code).toBe(1);
    expect(r.lines[1]).toMatch(
      /^MISMATCH \/X\/a\.png: local 8 bytes [0-9a-f]{64}, Dropbox 8 bytes 0{64}$/,
    );
    expect(r.lines[2]).toMatch(/^ok \/X\/b\.png/);
  });

  it("says plainly when --no-overwrite met an existing file", async () => {
    const local = file("exists.pdf", pattern(3));
    const { fetch } = session(() => ({
      status: 409,
      body: { error_summary: "path/conflict/file/..", error: { ".tag": "path" } },
    }));
    const r = await run(
      { cmd: "upload", folder: "/X", files: [local], overwrite: false },
      { fetch, env: ENV },
    );
    expect(r.code).toBe(1);
    expect(r.lines[1]).toBe("exists, not overwritten (--no-overwrite): /X/exists.pdf");
  });

  it("reports a conflict in overwrite mode as a failure, not as a kept file", async () => {
    const local = file("folder-there.pdf", pattern(3));
    const { fetch } = session(() => ({
      status: 409,
      body: { error_summary: "path/conflict/folder/..", error: { ".tag": "path" } },
    }));
    const r = await run(
      { cmd: "upload", folder: "/X", files: [local], overwrite: true },
      { fetch, env: ENV },
    );
    expect(r.code).toBe(1);
    expect(r.lines[1]).toMatch(
      /^FAILED .*folder-there\.pdf: files\/upload: HTTP 409 path\/conflict\/folder\/\.\.$/,
    );
  });

  it("only calls a file conflict a kept file when --no-overwrite asked for it", async () => {
    const local = file("guard.pdf", pattern(3));
    const { fetch } = session(() => ({
      status: 409,
      body: { error_summary: "path/conflict/file/..", error: { ".tag": "path" } },
    }));
    const r = await run(
      { cmd: "upload", folder: "/X", files: [local], overwrite: true },
      { fetch, env: ENV },
    );
    expect(r.lines[1]).toMatch(
      /^FAILED .*guard\.pdf: files\/upload: HTTP 409 path\/conflict\/file\/\.\.$/,
    );
  });

  it("does not call a file in the folder path an existing file", async () => {
    const local = file("ancestor.pdf", pattern(3));
    const { fetch } = session(() => ({
      status: 409,
      body: { error_summary: "path/conflict/file_ancestor/..", error: { ".tag": "path" } },
    }));
    const r = await run(
      { cmd: "upload", folder: "/X", files: [local], overwrite: false },
      { fetch, env: ENV },
    );
    expect(r.code).toBe(1);
    expect(r.lines[1]).toMatch(
      /^FAILED .*ancestor\.pdf: files\/upload: HTTP 409 path\/conflict\/file_ancestor\/\.\.$/,
    );
  });

  it("turns a missing scope into the fix", async () => {
    const local = file("scope.pdf", pattern(3));
    const { fetch } = session(() => ({
      status: 401,
      body: {
        error: { ".tag": "missing_scope", required_scope: "files.content.write" },
        error_summary: "missing_scope/",
      },
    }));
    const r = await run(
      { cmd: "upload", folder: "/X", files: [local], overwrite: true },
      { fetch, env: ENV },
    );
    expect(r.code).toBe(1);
    expect(r.lines[1]).toBe(
      "FAILED " +
        local +
        ": files/upload: missing_scope files.content.write. The app has it but this refresh token was authorized before it was added: redo the one-time authorization and replace DROPBOX_REFRESH_TOKEN.",
    );
  });

  it("sends a scope the app itself lacks to the Permissions tab", async () => {
    const { fetch } = session(() => ({
      status: 400,
      body: "Error in call to API function \"file_requests/update\": Your app (ID: 1) is not permitted to access this endpoint because it does not have the required scope 'file_requests.write'.",
    }));
    const r = await run({ cmd: "close-request", ids: ["rwq"] }, { fetch, env: ENV });
    expect(r.code).toBe(1);
    expect(r.lines[1]).toBe(
      "FAILED rwq: file_requests/update: missing_scope file_requests.write. Tick it on the app's Permissions tab in the Dropbox App Console, then redo the one-time authorization and replace DROPBOX_REFRESH_TOKEN.",
    );
  });

  it("closes requests and exits 1 if any stays open", async () => {
    const { fetch } = session((_ep, c) => {
      const { id } = JSON.parse(c.init.body as string);
      return { body: { id, title: id, is_open: id === "stuck" } };
    });
    const r = await run({ cmd: "close-request", ids: ["rwq", "stuck"] }, { fetch, env: ENV });
    expect(r.code).toBe(1);
    expect(r.lines.slice(1)).toEqual([
      'closed rwq "rwq" is_open: false',
      'STILL OPEN stuck "stuck" is_open: true',
    ]);
  });

  it("hashes without credentials or network", async () => {
    const data = pattern(BLOCK + 1);
    const local = file("hash.bin", data);
    const r = await run(
      { cmd: "hash", files: [local] },
      {
        fetch: async () => {
          throw new Error("no network");
        },
        env: {},
      },
    );
    expect(r).toEqual({ code: 0, lines: [`${contentHash(data)}  ${local}`] });
  });
});

describe("DropboxError", () => {
  it("keeps the endpoint, status and scope", () => {
    const e = new DropboxError("files/upload", 401, {
      error: { ".tag": "missing_scope", required_scope: "x.y" },
    });
    expect(e.scope).toBe("x.y");
    expect(e.status).toBe(401);
    expect(e.endpoint).toBe("files/upload");
  });
});

describe("CLI", () => {
  const bare = { PATH: process.env.PATH ?? "", HOME: dir };

  it("prints usage and exits 2 on a bad command", () => {
    const r = spawnSync(process.execPath, [SCRIPT, "frobnicate"], { encoding: "utf8", env: bare });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("unknown command: frobnicate");
    expect(r.stderr).toContain("usage:");
  });

  it("hashes a file end to end", () => {
    const data = pattern(3 * BLOCK);
    const local = file("cli.bin", data);
    const r = spawnSync(process.execPath, [SCRIPT, "hash", local], { encoding: "utf8", env: bare });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe(`${contentHash(data)}  ${local}\n`);
  });

  it("re-executes through HTTPS_PROXY and reports why the connection failed", () => {
    const r = spawnSync(process.execPath, [SCRIPT, "check"], {
      encoding: "utf8",
      env: { ...bare, ...ENV, HTTPS_PROXY: "http://127.0.0.1:9" },
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toBe("dropbox: oauth2/token: fetch failed (ECONNREFUSED)\n");
  });

  it("names missing credentials and exits 1 without touching the network", () => {
    const r = spawnSync(process.execPath, [SCRIPT, "check"], { encoding: "utf8", env: bare });
    expect(r.status).toBe(1);
    expect(r.stderr).toBe(
      "dropbox: missing environment variables: DROPBOX_APP_KEY, DROPBOX_APP_SECRET, DROPBOX_REFRESH_TOKEN\n",
    );
  });
});
