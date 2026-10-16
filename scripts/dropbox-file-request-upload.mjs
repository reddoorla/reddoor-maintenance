#!/usr/bin/env node
import { readFileSync, realpathSync, statSync } from "node:fs";
import { basename } from "node:path";
import { fileURLToPath } from "node:url";
import { contentHash } from "./dropbox.mjs";

export const BATCH = 5;
export const MAX_BATCH_BYTES = 128 * 1024 * 1024;
const REQUEST = /^https:\/\/www\.dropbox\.com\/request\/[A-Za-z0-9]+\/?$/;

export const USAGE = `usage: node scripts/dropbox-file-request-upload.mjs [--dry-run] <file-request-url> <uploader-name> <file>...

Puts binary files into Dropbox through a file request's public upload page, driven by headless Chromium.
It is the fallback: when "node scripts/dropbox.mjs check" passes, upload with scripts/dropbox.mjs instead.
Create the request first with the Dropbox connector's create_file_request, with a deadline and no
deadline_allow_late_uploads, so it closes itself. UPLOADER_EMAIL must be set: use the Dropbox account's
own address (the connector's who_am_i). --dry-run prints each file's size, content_hash and expected
name, and uploads nothing.
Runbook: docs/runbooks/dropbox-file-request-upload.md`;

export const VERIFY = `verify: list the destination with the Dropbox connector's list_folder (recursive: false), then call
its download_link on each new file and on each file already named as a row's expected name. Never fetch the
URL it returns, and do not paste it anywhere. Each row's size and content_hash must equal a file's. Match by
content_hash, not by name: when the expected name is already taken, Dropbox stores the file as
"<uploader-name> - YYYY-MM-DD HH.MM.SS - <file>", and bytes identical to the file already there add nothing.
A row that no file in the folder matches did not arrive.
rename: then move each file to its "rename to" name with the connector's move, polling check_job_status
while it answers in_progress. A move onto a name that exists fails; move the old file aside first.`;

export function parseArgs(argv, env = process.env) {
  const flags = argv.filter((a) => a.startsWith("--"));
  const pos = argv.filter((a) => !a.startsWith("--"));
  for (const f of flags) if (f !== "--dry-run") throw new Error(`unknown option ${f}`);
  const dryRun = flags.includes("--dry-run");
  const [url, name, ...files] = pos;
  if (!url || !REQUEST.test(url)) {
    throw new Error(`not a Dropbox file request URL: ${url ?? "(none)"}`);
  }
  if (!name?.trim()) throw new Error("the uploader name is empty");
  if (/[\\/]/.test(name) || statSync(name, { throwIfNoEntry: false })) {
    throw new Error(
      `the uploader name "${name}" looks like a file; the name comes before the files`,
    );
  }
  if (files.length === 0) throw new Error("no files given");
  const seen = new Set();
  for (const f of files) {
    const key = basename(f).normalize("NFC").toLowerCase();
    if (seen.has(key)) throw new Error(`two files are both named ${basename(f)} in Dropbox`);
    seen.add(key);
  }
  if (!dryRun && !env.UPLOADER_EMAIL?.trim()) {
    throw new Error("UPLOADER_EMAIL is not set; use the Dropbox account's own address");
  }
  return { url, name: name.trim(), files, dryRun };
}

export function uploadedName(name, file) {
  return `${name} - ${basename(file)}`;
}

export function batches(items, n = BATCH, max = MAX_BATCH_BYTES) {
  const out = [];
  let bytes = 0;
  for (const it of items) {
    const size = it?.size ?? 0;
    const last = out[out.length - 1];
    if (last && last.length < n && bytes + size <= max) {
      last.push(it);
      bytes += size;
    } else {
      out.push([it]);
      bytes = size;
    }
  }
  return out;
}

export function timeoutMs(bytes) {
  return Math.max(120_000, Math.ceil((bytes / 1e6) * 10_000));
}

export function plan(files, name, max = MAX_BATCH_BYTES) {
  return files.map((file) => {
    const st = statSync(file, { throwIfNoEntry: false });
    if (!st?.isFile()) throw new Error(`not a file: ${file}`);
    if (st.size > max) {
      throw new Error(
        `${file} is over ${max} bytes, too large for this route; use scripts/dropbox.mjs`,
      );
    }
    const buf = readFileSync(file);
    return {
      file,
      size: buf.length,
      contentHash: contentHash(buf),
      uploadedAs: uploadedName(name, file),
      renameTo: basename(file),
    };
  });
}

export function table(rows) {
  return [
    "bytes\tcontent_hash\texpected name -> rename to",
    ...rows.map((r) => `${r.size}\t${r.contentHash}\t${r.uploadedAs} -> ${r.renameTo}`),
  ].join("\n");
}

export function commitComplete(status, text) {
  if (status !== 200) return false;
  try {
    return JSON.parse(text).status === "complete";
  } catch {
    return false;
  }
}

export function commitName(url) {
  const u = new URL(url);
  if (u.hostname !== "www.dropbox.com" || u.pathname !== "/drops/commit_file_request_by_token") {
    return null;
  }
  return u.searchParams.get("name");
}

export function verdicts(rows, committed) {
  return rows.map((r) => {
    const c = committed.get(basename(r.file));
    return {
      row: r,
      ok: Boolean(c) && commitComplete(c.status, c.text),
      why: c ? `commit answered ${c.status} ${c.text.slice(0, 80)}` : "no commit seen",
    };
  });
}

export function afterError(rows, committed, message) {
  return verdicts(rows, committed).map((v) =>
    committed.has(basename(v.row.file)) ? v : { ...v, why: message },
  );
}

export function squash(s) {
  return s.replace(/\s+/g, " ").trim();
}

export function exitCode(results) {
  return results.length > 0 && results.every((r) => r.ok) ? 0 : 1;
}

async function uploadBatch(browser, url, name, email, rows) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const committed = new Map();
  page.on("response", async (res) => {
    const file = commitName(res.url());
    if (file === null) return;
    const text = await res.text().catch(() => "");
    committed.set(file, { status: res.status(), text });
  });
  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 90_000 });
    await page.click('button:has-text("Decline")', { timeout: 5_000 }).catch(() => null);
    const zone = await page.waitForSelector("#browse-target", { timeout: 30_000 }).catch(() => {
      throw new Error("no drop zone on the page: the request may be closed or past its deadline");
    });
    const payload = rows.map((r) => {
      const buf = readFileSync(r.file);
      if (contentHash(buf) !== r.contentHash)
        throw new Error(`${r.file} changed after it was hashed`);
      return {
        name: basename(r.file),
        type: r.file.toLowerCase().endsWith(".pdf")
          ? "application/pdf"
          : "application/octet-stream",
        b64: buf.toString("base64"),
      };
    });
    const dt = await page.evaluateHandle((files) => {
      const dt = new globalThis.DataTransfer();
      for (const f of files) {
        const bin = atob(f.b64);
        const u8 = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
        dt.items.add(new File([u8], f.name, { type: f.type }));
      }
      return dt;
    }, payload);
    const target = await zone.evaluateHandle((el) => el.closest("div[class]")?.parentElement || el);
    for (const ev of ["dragenter", "dragover", "drop"]) {
      await target.dispatchEvent(ev, { dataTransfer: dt });
    }
    await page.waitForSelector('input[name="email"]', { timeout: 30_000 });
    const body = squash(await page.innerText("body"));
    const missing = payload.filter((f) => !body.includes(squash(f.name))).map((f) => f.name);
    if (missing.length)
      throw new Error(`the page did not list ${missing.join(", ")} after the drop`);
    await page.fill('input[name="name"]', name);
    await page.fill('input[name="email"]', email);
    await page.getByRole("button", { name: "Upload", exact: true }).click();
    const bytes = rows.reduce((n, r) => n + r.size, 0);
    const until = Date.now() + timeoutMs(bytes);
    while (payload.some((f) => !committed.has(f.name)) && Date.now() < until) {
      await page.waitForTimeout(500);
    }
    return verdicts(rows, committed);
  } catch (e) {
    return afterError(rows, committed, e.message.split("\n")[0]);
  } finally {
    await ctx.close();
  }
}

async function main() {
  let o;
  let rows;
  try {
    o = parseArgs(process.argv.slice(2));
    rows = plan(o.files, o.name);
  } catch (e) {
    process.stderr.write(`dropbox-file-request-upload: ${e.message}\n${USAGE}\n`);
    process.exitCode = 2;
    return;
  }
  process.stdout.write(`${table(rows)}\n`);
  if (o.dryRun) {
    process.stdout.write(`${VERIFY}\n`);
    return;
  }
  const { chromium } = await import("@playwright/test");
  const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
  const browser = await chromium.launch(proxy ? { proxy: { server: proxy } } : {});
  const results = [];
  try {
    for (const [i, group] of batches(rows).entries()) {
      process.stdout.write(`batch ${i + 1}: ${group.map((r) => r.renameTo).join(", ")}\n`);
      const got = await uploadBatch(
        browser,
        o.url,
        o.name,
        process.env.UPLOADER_EMAIL.trim(),
        group,
      );
      for (const r of got) {
        process.stdout.write(
          r.ok ? `committed\t${r.row.uploadedAs}\n` : `FAILED\t${r.row.file}\t${r.why}\n`,
        );
      }
      results.push(...got);
    }
  } finally {
    await browser.close();
  }
  process.stdout.write(`${VERIFY}\n`);
  process.exitCode = exitCode(results);
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
    process.stderr.write(`dropbox-file-request-upload: ${e?.stack ?? e}\n`);
    process.exitCode = 1;
  });
}
