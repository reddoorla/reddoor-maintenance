#!/usr/bin/env node
import { createHash } from "node:crypto";
import { open, readFile, stat } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { basename } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const BLOCK = 4 * 1024 * 1024;
export const CHUNK = 16 * 1024 * 1024;
export const SIMPLE_LIMIT = CHUNK;
export const ENV_VARS = ["DROPBOX_APP_KEY", "DROPBOX_APP_SECRET", "DROPBOX_REFRESH_TOKEN"];
export const MAX_ATTEMPTS = 4;
export const MAX_WAIT_S = 60;
export const PROBE_ID = "dropbox-mjs-scope-probe";

const API = "https://api.dropboxapi.com";
const CONTENT = "https://content.dropboxapi.com";

export const USAGE = `usage:
  node scripts/dropbox.mjs check
  node scripts/dropbox.mjs upload <dropbox-folder> <file> [<file> …] [--no-overwrite]
  node scripts/dropbox.mjs close-request <id> [<id> …]
  node scripts/dropbox.mjs hash <file> [<file> …]`;

export class DropboxError extends Error {
  constructor(endpoint, status, body) {
    const scope = missingScope(body);
    const fix =
      status === 401
        ? "The app has it but this refresh token was authorized before it was added: redo the one-time authorization and replace DROPBOX_REFRESH_TOKEN."
        : "Tick it on the app's Permissions tab in the Dropbox App Console, then redo the one-time authorization and replace DROPBOX_REFRESH_TOKEN.";
    super(
      scope
        ? `${endpoint}: missing_scope ${scope}. ${fix}`
        : `${endpoint}: HTTP ${status} ${summary(body)}`,
    );
    this.endpoint = endpoint;
    this.status = status;
    this.body = body;
    this.scope = scope;
  }
}

export function summary(body) {
  if (body && typeof body === "object") {
    if (typeof body.error_summary === "string") return body.error_summary;
    if (typeof body.error === "string") {
      return typeof body.error_description === "string"
        ? `${body.error}: ${body.error_description}`
        : body.error;
    }
    return JSON.stringify(body).slice(0, 300);
  }
  return String(body ?? "").slice(0, 300);
}

export function missingScope(body) {
  if (body && typeof body === "object") {
    const e = body.error;
    if (e && e[".tag"] === "missing_scope" && typeof e.required_scope === "string") {
      return e.required_scope;
    }
    body = JSON.stringify(body);
  }
  return /required scope '([^']+)'/.exec(String(body ?? ""))?.[1] ?? null;
}

export function parseArgs(argv) {
  const [cmd, ...rest] = argv;
  const flags = rest.filter((a) => a.startsWith("--"));
  const args = rest.filter((a) => !a.startsWith("--"));
  for (const f of flags) {
    if (!(cmd === "upload" && f === "--no-overwrite")) throw new Error(`unknown option: ${f}`);
  }
  if (cmd === "check") {
    if (args.length) throw new Error("check takes no arguments");
    return { cmd };
  }
  if (cmd === "upload") {
    const [folder, ...files] = args;
    if (!folder || !files.length)
      throw new Error("upload needs a Dropbox folder and at least one file");
    if (!folder.startsWith("/"))
      throw new Error(`the Dropbox folder must start with "/", got ${folder}`);
    const seen = new Map();
    for (const f of files) {
      const name = basename(f).normalize("NFC").toLowerCase();
      if (seen.has(name))
        throw new Error(
          `${seen.get(name)} and ${f} would both upload to ${dropboxPath(folder, f)}`,
        );
      seen.set(name, f);
    }
    return { cmd, folder, files, overwrite: !flags.includes("--no-overwrite") };
  }
  if (cmd === "close-request") {
    if (!args.length) throw new Error("close-request needs at least one file request id");
    return { cmd, ids: args };
  }
  if (cmd === "hash") {
    if (!args.length) throw new Error("hash needs at least one file");
    return { cmd, files: args };
  }
  throw new Error(cmd ? `unknown command: ${cmd}` : "no command given");
}

export function contentHasher() {
  const outer = createHash("sha256");
  let block = createHash("sha256");
  let filled = 0;
  return {
    update(buf) {
      for (let i = 0; i < buf.length;) {
        const n = Math.min(BLOCK - filled, buf.length - i);
        block.update(buf.subarray(i, i + n));
        filled += n;
        i += n;
        if (filled === BLOCK) {
          outer.update(block.digest());
          block = createHash("sha256");
          filled = 0;
        }
      }
      return this;
    },
    digest() {
      if (filled) outer.update(block.digest());
      return outer.digest("hex");
    },
  };
}

export function contentHash(buf) {
  return contentHasher().update(buf).digest();
}

export async function contentHashFile(path) {
  const fh = await open(path, "r");
  try {
    const h = contentHasher();
    const buf = Buffer.alloc(BLOCK);
    for (;;) {
      const { bytesRead } = await fh.read(buf, 0, BLOCK, null);
      if (!bytesRead) break;
      h.update(buf.subarray(0, bytesRead));
    }
    return h.digest();
  } finally {
    await fh.close();
  }
}

export function headerJson(value) {
  return JSON.stringify(value).replace(
    /[^\x20-\x7e]/g,
    (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"),
  );
}

export function dropboxPath(folder, file) {
  return `${folder.replace(/\/+$/, "")}/${basename(file)}`;
}

export function missingEnv(env) {
  return ENV_VARS.filter((v) => !env[v]);
}

export function rootHeader(rootNamespaceId) {
  return JSON.stringify({ ".tag": "root", root: rootNamespaceId });
}

async function parseBody(res) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function send(deps, endpoint, url, init) {
  const sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  for (let attempt = 1; ; attempt++) {
    let res;
    try {
      res = await deps.fetch(url, init);
    } catch (e) {
      const cause = e?.cause?.code ?? e?.cause?.message;
      throw new Error(`${endpoint}: ${e?.message ?? e}${cause ? ` (${cause})` : ""}`, {
        cause: e,
      });
    }
    if (res.status === 429 && attempt < MAX_ATTEMPTS) {
      await res.body?.cancel().catch(() => undefined);
      const after = Number(res.headers?.get?.("retry-after"));
      await sleep(Math.min(Number.isFinite(after) && after > 0 ? after : 1, MAX_WAIT_S) * 1000);
      continue;
    }
    let body;
    try {
      body = await parseBody(res);
    } catch (e) {
      throw new Error(`${endpoint}: reading the response failed: ${e?.message ?? e}`, { cause: e });
    }
    if (res.status !== 200) throw new DropboxError(endpoint, res.status, body);
    return body;
  }
}

export async function mintToken(deps) {
  const missing = missingEnv(deps.env);
  if (missing.length) throw new Error(`missing environment variables: ${missing.join(", ")}`);
  const {
    DROPBOX_APP_KEY: key,
    DROPBOX_APP_SECRET: secret,
    DROPBOX_REFRESH_TOKEN: refresh,
  } = deps.env;
  const body = await send(deps, "oauth2/token", `${API}/oauth2/token`, {
    method: "POST",
    headers: {
      authorization: "Basic " + Buffer.from(`${key}:${secret}`).toString("base64"),
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refresh }).toString(),
  });
  if (typeof body?.access_token !== "string")
    throw new Error("oauth2/token: no access_token in the response");
  return body.access_token;
}

export async function connect(deps) {
  const token = await mintToken(deps);
  const account = await send(
    deps,
    "users/get_current_account",
    `${API}/2/users/get_current_account`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
    },
  );
  const root = account?.root_info?.root_namespace_id;
  if (!root) throw new Error("users/get_current_account: no root_info.root_namespace_id");
  return { ...deps, token, root, account };
}

export function accountLine(ctx) {
  const a = ctx.account;
  const team = a?.team?.name ? `, team ${a.team.name}` : "";
  const space =
    ctx.root === a?.root_info?.home_namespace_id
      ? "personal space: the root is the home folder"
      : "team space";
  return `account: ${a?.name?.display_name} <${a?.email}>${team}, root namespace ${ctx.root} (${space})`;
}

export function rpc(ctx, endpoint, arg) {
  return send(ctx, endpoint, `${API}/2/${endpoint}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${ctx.token}`,
      "Dropbox-API-Path-Root": rootHeader(ctx.root),
      "content-type": "application/json",
    },
    body: JSON.stringify(arg),
  });
}

export function contentCall(ctx, endpoint, arg, data) {
  return send(ctx, endpoint, `${CONTENT}/2/${endpoint}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${ctx.token}`,
      "Dropbox-API-Path-Root": rootHeader(ctx.root),
      "Dropbox-API-Arg": headerJson(arg),
      "content-type": "application/octet-stream",
    },
    body: data,
  });
}

export async function probeScopes(ctx) {
  const probes = [
    [
      "files.content.write",
      () => contentCall(ctx, "files/upload_session/start", { close: true }, Buffer.alloc(0)),
    ],
    ["file_requests.write", () => rpc(ctx, "file_requests/update", { id: PROBE_ID })],
  ];
  const out = [];
  for (const [scope, call] of probes) {
    try {
      await call();
      out.push({ scope, state: "granted", detail: "" });
    } catch (e) {
      if (e instanceof DropboxError && e.scope)
        out.push({ scope, state: "MISSING", detail: e.message });
      else if (e instanceof DropboxError && e.status === 409) {
        const s = summary(e.body);
        out.push({
          scope,
          state: "granted",
          detail: /^not_found\//.test(s) ? "" : `HTTP 409 ${s}`,
        });
      } else out.push({ scope, state: "UNKNOWN", detail: e.message });
    }
  }
  return out;
}

async function readChunk(fh, position, length) {
  const buf = Buffer.alloc(length);
  let n = 0;
  while (n < length) {
    const { bytesRead } = await fh.read(buf, n, length - n, position + n);
    if (!bytesRead)
      throw new Error(`file shrank while uploading: expected ${length} bytes at ${position}`);
    n += bytesRead;
  }
  return buf;
}

function fileMeta(endpoint, meta) {
  if (!meta || typeof meta !== "object")
    throw new Error(`${endpoint}: no file metadata in the response`);
  return meta;
}

export async function uploadFile(ctx, local, folder, opts = {}) {
  const simpleLimit = opts.simpleLimit ?? SIMPLE_LIMIT;
  const chunk = opts.chunk ?? CHUNK;
  const path = dropboxPath(folder, local);
  const commit = {
    path,
    mode: opts.overwrite === false ? "add" : "overwrite",
    autorename: false,
    mute: false,
  };
  const { size } = await stat(local);
  const hash = contentHasher();
  let meta;
  if (size <= simpleLimit) {
    const data = await readFile(local);
    if (data.length !== size) throw new Error(`${local} changed size while being read`);
    hash.update(data);
    meta = fileMeta("files/upload", await contentCall(ctx, "files/upload", commit, data));
  } else {
    const fh = await open(local, "r");
    try {
      const first = await readChunk(fh, 0, Math.min(chunk, size));
      hash.update(first);
      const started = await contentCall(ctx, "files/upload_session/start", { close: false }, first);
      const session_id = started?.session_id;
      if (!session_id) throw new Error("files/upload_session/start: no session_id in the response");
      let offset = first.length;
      while (size - offset > chunk) {
        const part = await readChunk(fh, offset, chunk);
        hash.update(part);
        await contentCall(
          ctx,
          "files/upload_session/append_v2",
          { cursor: { session_id, offset }, close: false },
          part,
        );
        offset += part.length;
      }
      const last = await readChunk(fh, offset, size - offset);
      hash.update(last);
      meta = fileMeta(
        "files/upload_session/finish",
        await contentCall(
          ctx,
          "files/upload_session/finish",
          { cursor: { session_id, offset }, commit },
          last,
        ),
      );
    } finally {
      await fh.close();
    }
  }
  const localHash = hash.digest();
  return {
    local,
    path: meta.path_display ?? path,
    size,
    remoteSize: meta.size,
    localHash,
    remoteHash: meta.content_hash,
    ok: meta.content_hash === localHash && meta.size === size,
  };
}

export async function closeRequest(ctx, id) {
  const fr = await rpc(ctx, "file_requests/update", { id, open: false });
  return { id: fr?.id ?? id, title: fr?.title, is_open: fr?.is_open, ok: fr?.is_open === false };
}

export async function run(o, deps) {
  const lines = [];
  const say = (line) => {
    lines.push(line);
    deps.emit?.(line);
  };
  let code = 0;
  if (o.cmd === "hash") {
    for (const f of o.files) say(`${await contentHashFile(f)}  ${f}`);
    return { code, lines };
  }
  const ctx = await connect(deps);
  say(accountLine(ctx));
  if (o.cmd === "check") {
    for (const p of await probeScopes(ctx)) {
      if (p.state !== "granted") code = 1;
      say(`${p.scope}: ${p.state}${p.detail ? ` (${p.detail})` : ""}`);
    }
  } else if (o.cmd === "upload") {
    for (const f of o.files) {
      try {
        const r = await uploadFile(ctx, f, o.folder, { overwrite: o.overwrite });
        if (r.ok) say(`ok ${r.path} ${r.size} bytes content_hash ${r.remoteHash} matches local`);
        else {
          code = 1;
          say(
            `MISMATCH ${r.path}: local ${r.size} bytes ${r.localHash}, Dropbox ${r.remoteSize} bytes ${r.remoteHash}`,
          );
        }
      } catch (e) {
        code = 1;
        const conflict =
          !o.overwrite &&
          e instanceof DropboxError &&
          /^path\/conflict\/file\//.test(summary(e.body));
        say(
          conflict
            ? `exists, not overwritten (--no-overwrite): ${dropboxPath(o.folder, f)}`
            : `FAILED ${f}: ${e.message}`,
        );
      }
    }
  } else if (o.cmd === "close-request") {
    for (const id of o.ids) {
      try {
        const r = await closeRequest(ctx, id);
        if (!r.ok) code = 1;
        say(`${r.ok ? "closed" : "STILL OPEN"} ${r.id} "${r.title}" is_open: ${r.is_open}`);
      } catch (e) {
        code = 1;
        say(`FAILED ${id}: ${e.message}`);
      }
    }
  }
  return { code, lines };
}

export function proxyReexecEnv(env) {
  const proxy = env.HTTPS_PROXY || env.https_proxy;
  if (!proxy || env.NODE_USE_ENV_PROXY === "1") return null;
  return { ...env, NODE_USE_ENV_PROXY: "1" };
}

async function main() {
  let o;
  try {
    o = parseArgs(process.argv.slice(2));
  } catch (e) {
    process.stderr.write(`dropbox: ${e.message}\n${USAGE}\n`);
    process.exitCode = 2;
    return;
  }
  const env = proxyReexecEnv(process.env);
  if (env) {
    const child = spawnSync(
      process.execPath,
      [...process.execArgv, fileURLToPath(import.meta.url), ...process.argv.slice(2)],
      { stdio: "inherit", env },
    );
    if (child.error) process.stderr.write(`dropbox: re-exec failed: ${child.error.message}\n`);
    else if (child.signal) process.stderr.write(`dropbox: re-exec killed by ${child.signal}\n`);
    process.exitCode = child.status ?? 1;
    return;
  }
  const r = await run(o, {
    fetch,
    env: process.env,
    emit: (line) => process.stdout.write(line + "\n"),
  });
  process.exitCode = r.code;
}

const self = (p) => {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
};
if (process.argv[1] && self(process.argv[1]) === self(fileURLToPath(import.meta.url))) {
  main().catch((e) => {
    process.stderr.write(`dropbox: ${e?.message ?? e}\n`);
    process.exitCode = 1;
  });
}
