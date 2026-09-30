#!/usr/bin/env node
/**
 * scripts/webflow-capture/check.mjs — prove a Webflow capture is whole, offline.
 *
 *   node scripts/webflow-capture/check.mjs captures/<slug> [--expect-pages N]
 *
 * Re-derives every reference from the CAPTURED BYTES (each page's HTML, then
 * every captured stylesheet, script and Lottie file, recursively) with the same
 * extractors capture.mjs used, and requires each one to be a non-empty file on
 * disk at its deterministic path, or to be a named exclusion (lib.mjs EXCLUDE).
 * It does not trust manifest.json's file list; the manifest supplies only the
 * reference origin, the site id and the page list. It also requires:
 *
 * - every same-origin page link in a captured page to be a captured page (a
 *   dropped page is a gap, not a smaller site);
 * - every captured page to carry the site's `data-wf-site` id (the capture is
 *   of the reference, not of something that answered in its place);
 * - every page's and file's sha256 to equal the manifest's (the bytes are the
 *   ones fetched: a page cut short would otherwise lose its references quietly);
 * - a page `/` (the crawl root, which the site id is read from);
 * - no two references or pages to clash on one path (lib.mjs pathConflict), no
 *   collection pagination, and no download or page failure recorded in the
 *   manifest by the capture itself;
 * - with --expect-pages, exactly that many pages.
 *
 * Exit 0 when all hold, 1 naming every failure, 2 on usage.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve as resolvePath } from "node:path";
import { pathToFileURL } from "node:url";
import {
  exclusionFor,
  extractFromFile,
  extractFromHtml,
  extractPageLinks,
  paginationLinks,
  isTextFile,
  pageToLocal,
  pathConflict,
  sha256,
  urlToLocal,
} from "./lib.mjs";

export function checkCapture(dir, { expectPages } = {}) {
  const failures = [];
  const manifestPath = join(dir, "manifest.json");
  if (!existsSync(manifestPath)) {
    return {
      ok: false,
      failures: [`no manifest.json in ${dir}`],
      present: 0,
      excluded: [],
      pages: 0,
    };
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const origin = new URL(manifest.ref).origin;
  const siteId = manifest.siteId;
  if (!siteId)
    failures.push("manifest.json has no siteId: nothing proves these pages are the reference");
  const shaByFile = new Map([...manifest.pages, ...manifest.files].map((f) => [f.file, f.sha256]));
  for (const f of manifest.failed ?? [])
    failures.push(`capture recorded a failure: ${f.url} ${f.status} ${f.note ?? ""}`.trim());
  for (const f of manifest.pageFailures ?? [])
    failures.push(`capture recorded a page failure: ${f}`);

  const refs = new Map();
  const note = (url, from) => {
    if (!refs.has(url)) refs.set(url, from);
  };

  const pagePaths = new Set(manifest.pages.map((p) => p.path));
  if (!pagePaths.has("/"))
    failures.push("manifest.json has no page /: the crawl root was not captured");
  const pageOwner = new Map();
  for (const p of manifest.pages) {
    const file = pageToLocal(p.path);
    const clash = pathConflict(pageOwner, file, p.path);
    if (clash) {
      failures.push(`collision: page ${p.path} and ${clash} both map to ${file}`);
      continue;
    }
    const abs = join(dir, file);
    if (!existsSync(abs)) {
      failures.push(`page ${p.path} is missing: ${file}`);
      continue;
    }
    const pageBuf = readFileSync(abs);
    if (pageBuf.length === 0 || shaByFile.get(file) !== sha256(pageBuf))
      failures.push(`changed: ${file} does not match its manifest sha256`);
    const html = pageBuf.toString("utf8");
    if (siteId && !html.includes(`data-wf-site="${siteId}"`))
      failures.push(`page ${p.path} does not carry data-wf-site="${siteId}": not the reference`);
    const pageUrl = origin + p.path;
    for (const r of extractFromHtml(html, pageUrl)) note(r.url, `${p.path} (${r.kind})`);
    for (const link of extractPageLinks(html, pageUrl))
      if (!pagePaths.has(link))
        failures.push(`page ${p.path} links to ${link}, which was not captured`);
    for (const link of paginationLinks(html, pageUrl))
      failures.push(
        `page ${p.path} paginates (${link}): list pages beyond the first are not captured`,
      );
  }
  if (expectPages !== undefined && manifest.pages.length !== expectPages)
    failures.push(`${manifest.pages.length} pages captured, expected ${expectPages}`);

  const excluded = [];
  let present = 0;
  const done = new Set();
  const owner = new Map();
  const queue = [...refs.keys()];
  while (queue.length) {
    const url = queue.shift();
    if (done.has(url)) continue;
    done.add(url);
    const reason = exclusionFor(url);
    if (reason) {
      excluded.push({ url, reason, from: refs.get(url) });
      continue;
    }
    const file = urlToLocal(url);
    const abs = join(dir, file);
    const seen = owner.has(file);
    const clash = pathConflict(owner, file, url);
    if (clash) {
      failures.push(`collision: ${url} and ${clash} both map to ${file}`);
      continue;
    }
    if (seen) continue;
    if (!existsSync(abs) || statSync(abs).size === 0) {
      failures.push(`missing: ${url} -> ${file} (referenced by ${refs.get(url)})`);
      continue;
    }
    const buf = readFileSync(abs);
    const want = shaByFile.get(file);
    if (!want) failures.push(`unrecorded: ${file} is on disk but not in manifest.json`);
    else if (want !== sha256(buf))
      failures.push(`changed: ${file} does not match its manifest sha256`);
    present++;
    if (isTextFile(url)) {
      for (const r of extractFromFile(url, buf.toString("utf8"))) {
        note(r.url, `${file} (${r.kind})`);
        queue.push(r.url);
      }
    }
  }

  return { ok: failures.length === 0, failures, present, excluded, pages: manifest.pages.length };
}

const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(resolvePath(process.argv[1])).href;
if (invokedDirectly) {
  const args = process.argv.slice(2);
  const i = args.indexOf("--expect-pages");
  const dir = args.find((a, k) => !a.startsWith("--") && !(i >= 0 && k === i + 1));
  const expectPages = i >= 0 ? Number(args[i + 1]) : undefined;
  if (!dir || (i >= 0 && !Number.isInteger(expectPages))) {
    console.error("usage: check.mjs <capture-dir> [--expect-pages N]");
    process.exit(2);
  }
  // exitCode, not process.exit(): measured 2026-09-30, `process.exit()` after
  // hashing the 138 MB Construction capture hung parked in a futex in 2-4 of
  // every 30 runs with stdout on /dev/null (0 CPU, never returning), while the
  // same work followed by a natural exit did not. A check that can hang is a
  // gate that can never report, so the process ends the ordinary way.
  const r = checkCapture(dir, { expectPages });
  for (const e of r.excluded)
    console.log(`excluded: ${e.url} (referenced by ${e.from}): ${e.reason}`);
  for (const f of r.failures) console.error(`FAIL ${f}`);
  console.log(
    `${dir}: ${r.pages} pages, ${r.present} files present, ${r.excluded.length} excluded, ${r.failures.length} failed`,
  );
  process.exitCode = r.ok ? 0 : 1;
}
