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
It is the fallback, for when the API cannot upload: "node scripts/dropbox.mjs check"
fails before naming the account, or prints MISSING for files.content.write.
Otherwise use "node scripts/dropbox.mjs upload", even when only file_requests.write is missing.
If check prints UNKNOWN for files.content.write, re-run it; if that persists, treat the API as unable to upload.
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
  const why = pathLike(name);
  if (why) {
    throw new Error(
      `the uploader name "${name}" looks like a file (${why}); the name comes before the files`,
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

function pathLike(name) {
  if (/[\\/]/.test(name)) return "it contains / or \\";
  try {
    if (statSync(name, { throwIfNoEntry: false })) {
      return "the working directory has an entry by that name";
    }
  } catch (e) {
    return `it cannot be checked against the working directory: ${e.code ?? "stat failed"}`;
  }
  return null;
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
        `${file} is over ${max} bytes, too large for this route; it needs "node scripts/dropbox.mjs upload", once "node scripts/dropbox.mjs check" passes`,
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

/** The paths to hand Chromium, once each file is shown to still hash as planned.
 *  Chromium reads the files itself (`setInputFiles` with paths), so no file's bytes
 *  cross the DevTools pipe, which closes the page on a message of about 120 MB
 *  (measured 2026-11-09; #1396). */
export function unchangedPaths(rows) {
  return rows.map((r) => {
    if (contentHash(readFileSync(r.file)) !== r.contentHash)
      throw new Error(`${r.file} changed after it was hashed`);
    return r.file;
  });
}

export function missingAfterDrop(body, names) {
  const text = squash(body);
  return names.filter((n) => !text.includes(squash(n)));
}

/**
 * Is this commit answer the page's last word on the file (#1471)? Read from the
 * upload page's own bundle on 2026-11-09 (`submission_edison-vfl7ETbh6.js`; the
 * runbook has the detail): its commit call resolves on any 200, whatever the body,
 * so a 200 is never re-sent, and on a 403 the page disables the form. Anything else
 * (a 5xx, another 4xx, no answer) is a rejection the page's upload scheduler may
 * retry, so the wait goes on until the deadline.
 */
export function commitFinal(status) {
  return status === 200 || status === 403;
}

export async function waitForCommits(committed, names, until, sleep, now = Date.now) {
  const final = (n) => {
    const c = committed.get(n);
    return Boolean(c) && commitFinal(c.status);
  };
  while (names.some((n) => !final(n)) && now() < until) await sleep(500);
}

/** One batch through one page. `deadlineMs` is how long the commits may take; it
 *  defaults to `timeoutMs` of the batch's bytes, and exists for the wiring test. */
export async function uploadBatch(browser, url, name, email, rows, { deadlineMs } = {}) {
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
    const paths = unchangedPaths(rows);
    const names = paths.map((p) => basename(p));
    // A file input of our own, outside the page's app, filled from the paths; the
    // drop then carries the Files it holds. The page's own input does nothing when
    // set (runbook), so the drop stays the route in.
    const input = await page.evaluateHandle(() => {
      const el = globalThis.document.createElement("input");
      el.type = "file";
      el.multiple = true;
      el.hidden = true;
      globalThis.document.body.append(el);
      return el;
    });
    await input.setInputFiles(paths);
    const dt = await input.evaluateHandle((el) => {
      const dt = new globalThis.DataTransfer();
      for (const f of el.files) dt.items.add(f);
      el.remove();
      return dt;
    });
    const target = await zone.evaluateHandle((el) => el.closest("div[class]")?.parentElement || el);
    for (const ev of ["dragenter", "dragover", "drop"]) {
      await target.dispatchEvent(ev, { dataTransfer: dt });
    }
    await page.waitForSelector('input[name="email"]', { timeout: 30_000 });
    const missing = missingAfterDrop(await page.innerText("body"), names);
    if (missing.length)
      throw new Error(`the page did not list ${missing.join(", ")} after the drop`);
    await page.fill('input[name="name"]', name);
    await page.fill('input[name="email"]', email);
    await page.getByRole("button", { name: "Upload", exact: true }).click();
    const bytes = rows.reduce((n, r) => n + r.size, 0);
    await waitForCommits(committed, names, Date.now() + (deadlineMs ?? timeoutMs(bytes)), (ms) =>
      page.waitForTimeout(ms),
    );
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
