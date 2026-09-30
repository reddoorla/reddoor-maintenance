#!/usr/bin/env node
/**
 * scripts/webflow-capture/capture.mjs — capture a live Webflow site, every page
 * and every file those pages load, before the site goes away (spec D11).
 *
 *   node scripts/webflow-capture/capture.mjs --ref https://www.example.com \
 *     --out captures/<slug> [--expect-pages N]
 *
 * Crawls same-origin links from `/`, then downloads every reference the pages
 * make (lib.mjs extractFromHtml), and every reference those files make in turn
 * (stylesheet url()s, a script's runtime loads, Lottie images), recursively.
 * Nothing is rewritten: the capture is the record of what the reference loads.
 *
 * Polite on purpose: plain unauthenticated GETs, one at a time, with a pause
 * between requests. It never writes to the site.
 *
 * Writes <out>/pages/, <out>/files/, <out>/manifest.json and <out>/CAPTURE.md,
 * then runs check.mjs over the result. Exit 0 only when every non-excluded
 * reference downloaded with a 200 and the check passes; 2 otherwise.
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  exclusionFor,
  extractFromFile,
  extractFromHtml,
  extractPageLinks,
  paginationLinks,
  isTextFile,
  normalizePagePath,
  pageToLocal,
  sha256,
  urlToLocal,
} from "./lib.mjs";
import { checkCapture } from "./check.mjs";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";
const PAGE_PAUSE_MS = 600;
const FILE_PAUSE_MS = 150;
const MAX_PAGES = 200;

const args = process.argv.slice(2);
const opt = (k) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : undefined;
};
const ref = opt("--ref")?.replace(/\/$/, "");
const out = opt("--out");
const expectPages = opt("--expect-pages") !== undefined ? Number(opt("--expect-pages")) : undefined;
if (!ref || !/^https?:\/\//.test(ref) || !out) {
  console.error("usage: capture.mjs --ref <origin> --out <dir> [--expect-pages N]");
  process.exit(2);
}
const origin = new URL(ref).origin;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url) {
  const headers = { "user-agent": UA, referer: `${origin}/` };
  for (let i = 0; ; i++) {
    try {
      const res = await fetch(url, { headers, redirect: "follow" });
      const buf = Buffer.from(await res.arrayBuffer());
      if (res.status < 500 || i >= 2) return { status: res.status, finalUrl: res.url, buf };
    } catch (e) {
      if (i >= 2) return { status: 0, finalUrl: url, buf: Buffer.alloc(0), error: String(e) };
    }
    await sleep(1500 * (i + 1));
  }
}

rmSync(join(out, "pages"), { recursive: true, force: true });
rmSync(join(out, "files"), { recursive: true, force: true });
const write = (rel, buf) => {
  const abs = join(out, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, buf);
};

// 1. Pages: breadth-first over same-origin links, serially.
const pages = [];
const refs = new Map();
const addRef = (url, from) => {
  const r = refs.get(url) ?? { from: [], kinds: new Set() };
  r.from.push(from.where);
  r.kinds.add(from.kind);
  refs.set(url, r);
};
const seen = new Set(["/"]);
const frontier = ["/"];
const pageFailures = [];
let siteId = null;
while (frontier.length) {
  if (pages.length >= MAX_PAGES) {
    pageFailures.push(`stopped at ${MAX_PAGES} pages with ${frontier.length} unvisited`);
    break;
  }
  const path = frontier.shift();
  const url = origin + path;
  const r = await get(url);
  await sleep(PAGE_PAUSE_MS);
  const finalPath = r.finalUrl ? normalizePagePath(new URL(r.finalUrl).pathname) : path;
  if (r.status !== 200 || new URL(r.finalUrl).origin !== origin || finalPath !== path) {
    pageFailures.push(`${path}: ${r.status}${r.finalUrl !== url ? ` -> ${r.finalUrl}` : ""}`);
    continue;
  }
  const html = r.buf.toString("utf8");
  const id = /data-wf-site="([^"]+)"/.exec(html)?.[1] ?? null;
  if (path === "/") siteId = id;
  const file = pageToLocal(path);
  write(file, r.buf);
  pages.push({ path, file, status: r.status, bytes: r.buf.length, sha256: sha256(r.buf) });
  console.error(`page ${pages.length}: ${path} (${r.buf.length} bytes)`);
  for (const x of extractFromHtml(html, url)) addRef(x.url, { where: path, kind: x.kind });
  for (const link of paginationLinks(html, url))
    pageFailures.push(
      `${path} paginates (${link}): not supported, list pages beyond the first would be missing`,
    );
  for (const link of extractPageLinks(html, url)) {
    if (!seen.has(link)) {
      seen.add(link);
      frontier.push(link);
    }
  }
}

// 2. Files: every reference, and every reference those files make.
const files = [];
const excluded = [];
const failed = [];
const claimed = new Map();
const queue = [...refs.keys()];
const done = new Set();
while (queue.length) {
  const url = queue.shift();
  if (done.has(url)) continue;
  done.add(url);
  const meta = refs.get(url);
  const reason = exclusionFor(url);
  if (reason) {
    excluded.push({ url, reason, from: [...new Set(meta.from)].slice(0, 5) });
    continue;
  }
  const file = urlToLocal(url);
  const owner = claimed.get(file);
  if (owner && owner !== url) {
    failed.push({ url, status: "collision", note: `${file} already holds ${owner}` });
    continue;
  }
  claimed.set(file, url);
  const r = await get(url);
  await sleep(FILE_PAUSE_MS);
  if (r.status !== 200 || r.buf.length === 0) {
    failed.push({
      url,
      status: r.status,
      note: r.error ?? `${r.buf.length} bytes`,
      from: meta.from.slice(0, 3),
    });
    continue;
  }
  write(file, r.buf);
  files.push({
    url,
    file,
    status: r.status,
    bytes: r.buf.length,
    sha256: sha256(r.buf),
    kinds: [...meta.kinds].sort(),
    from: [...new Set(meta.from)].slice(0, 5),
  });
  if (files.length % 25 === 0) console.error(`files: ${files.length} (queue ${queue.length})`);
  if (isTextFile(url)) {
    for (const x of extractFromFile(url, r.buf.toString("utf8"))) {
      addRef(x.url, { where: file, kind: x.kind });
      if (!done.has(x.url)) queue.push(x.url);
    }
  }
}

pages.sort((a, b) => a.path.localeCompare(b.path));
files.sort((a, b) => a.file.localeCompare(b.file));
const capturedAt = new Date().toISOString();
writeFileSync(
  join(out, "manifest.json"),
  JSON.stringify(
    { ref: origin, siteId, capturedAt, pages, files, excluded, failed, pageFailures },
    null,
    2,
  ) + "\n",
);

// 3. Prove it offline, with the same check anyone can re-run later.
const check = checkCapture(out, { expectPages });

const extOf = (f) =>
  (
    /\.([a-z0-9]+)$/i.exec(f.file.replace(/\.q[0-9a-f]{8}(?=\.|$)/, ""))?.[1] ?? "(none)"
  ).toLowerCase();
const byExt = {};
for (const f of files) byExt[extOf(f)] = (byExt[extOf(f)] ?? 0) + 1;
const byHost = {};
for (const f of files) {
  const h = new URL(f.url).host;
  byHost[h] = (byHost[h] ?? 0) + 1;
}
const totalBytes = files.reduce((n, f) => n + f.bytes, 0) + pages.reduce((n, p) => n + p.bytes, 0);
const md = [
  `# Webflow capture: ${origin}`,
  "",
  `Captured ${capturedAt} by \`scripts/webflow-capture/capture.mjs\`. Webflow site id \`${siteId}\`.`,
  "",
  "Every page reachable by same-origin links from `/`, and every file those pages load, recursively",
  "(stylesheet `url()`s, runtime script loads, Lottie images), byte for byte and unrewritten.",
  "`manifest.json` maps each URL to its file with its sha256. Re-prove it offline with",
  "`node scripts/webflow-capture/check.mjs <this directory>`.",
  "",
  `**${pages.length} pages, ${files.length} files, ${(totalBytes / 1e6).toFixed(1)} MB. ${excluded.length} excluded, ${failed.length} failed to download. Check: ${check.ok ? "PASS" : "FAIL"} (${check.present} present, ${check.failures.length} failures).**`,
  "",
  "## Pages",
  "",
  "| path | bytes |",
  "| --- | --- |",
  ...pages.map((p) => `| \`${p.path}\` | ${p.bytes} |`),
  "",
  "## Files by type",
  "",
  "| type | files |",
  "| --- | --- |",
  ...Object.entries(byExt)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `| ${k} | ${v} |`),
  "",
  "## Files by host",
  "",
  "| host | files |",
  "| --- | --- |",
  ...Object.entries(byHost)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `| ${k} | ${v} |`),
  "",
  "## Excluded (not vendored, on purpose)",
  "",
  ...(excluded.length
    ? excluded.map((e) => `- \`${e.url}\` (from ${e.from.join(", ")}): ${e.reason}.`)
    : ["None."]),
  "",
  "## Failed",
  "",
  ...(failed.length || pageFailures.length || check.failures.length
    ? [
        ...pageFailures.map((f) => `- page ${f}`),
        ...failed.map((f) => `- \`${f.url}\`: ${f.status} ${f.note}`),
        ...check.failures.map((f) => `- check: ${f}`),
      ]
    : ["None."]),
  "",
].join("\n");
writeFileSync(join(out, "CAPTURE.md"), md);

for (const f of pageFailures) console.error(`FAIL page ${f}`);
for (const f of failed) console.error(`FAIL ${f.status} ${f.url} ${f.note}`);
for (const f of check.failures) console.error(`FAIL check: ${f}`);
console.error(
  `${origin}: ${pages.length} pages, ${files.length} files, ${excluded.length} excluded, ${failed.length} failed, check ${check.ok ? "PASS" : "FAIL"}`,
);
process.exitCode = failed.length === 0 && pageFailures.length === 0 && check.ok ? 0 : 2; // not process.exit(): see check.mjs
