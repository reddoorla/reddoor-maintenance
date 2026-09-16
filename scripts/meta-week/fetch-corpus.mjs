#!/usr/bin/env node
// Re-fetch the third-party docs corpus the refuter round's claims were written against,
// and prove it is byte-identical to the copy those claims' line anchors were derived from.
//
//   node scripts/meta-week/fetch-corpus.mjs [--out docs/meta-week/_corpus] [--update]
//
// The manifest (docs/meta-week/_data/refute-claims-corpus.manifest.json) is the authority:
// 40 pages of https://code.claude.com/docs/, each with the sha256 and byte count of the
// copy fetched on 2026-09-14. The claims in refute-claims-levers.json cite those files by
// line number, so a page that has changed since silently moves every anchor into it.
//
//   CORPUS <name> ok|drift|failed http=<code> bytes=<n>
//   CORPUS_FETCH pages=40 ok=N drift=N failed=N
//
// Exit 1 on any drift or failure, so this is usable as a gate. `--update` rewrites the
// manifest's hashes, byte counts and fetchedAt from what was just fetched and exits 0 —
// only correct when the round is being re-anchored against today's docs, never as a way
// to get a red run green.
//
// THE VERDICT IS THE HASH, NOT THE HTTP CODE. `http=` is printed for context and does not
// classify: two of the 40 pages were 404s when the corpus was taken (`sitemap.xml` is the
// 15-byte body "Asset not found", `scheduled-routines.md` a 678-byte "Page Not Found"),
// and they are `ok` for as long as they keep returning that same body. A page that starts
// 404ing after being real changes its bytes, so it reads as `drift` — which is the signal
// that matters. `failed` means curl produced no file at all.
//
// Fetched with curl through child_process, not Node's fetch: the sandbox this runs in
// routes egress through a proxy that curl honours and undici does not.
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const MANIFEST = join(
  REPO_ROOT,
  "docs",
  "meta-week",
  "_data",
  "refute-claims-corpus.manifest.json",
);
const DEFAULT_OUT = join(REPO_ROOT, "docs", "meta-week", "_corpus");

function parseArgs(argv) {
  const o = { out: DEFAULT_OUT, update: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      if (i + 1 >= argv.length) throw new Error(`${a} needs a value`);
      return argv[++i];
    };
    switch (a) {
      case "--out":
        o.out = resolve(process.cwd(), next());
        break;
      case "--update":
        o.update = true;
        break;
      default:
        throw new Error(`unknown argument: ${a}`);
    }
  }
  return o;
}

function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

/**
 * One page. Returns `{ status, http, bytes, sha256 }`. `status` is decided by the hash;
 * `http` is context. A curl that exits non-zero still wrote its `-w` body to stdout in
 * most failure modes, so the code is read off the thrown error too rather than lost.
 */
async function fetchPage(page, outDir) {
  const file = join(outDir, page.name);
  let http;
  try {
    const { stdout } = await execFileAsync("curl", [
      "-sS",
      "-m",
      "30",
      "-o",
      file,
      "-w",
      "%{http_code}",
      page.url,
    ]);
    http = stdout.trim() || "000";
  } catch (e) {
    const code = typeof e.stdout === "string" ? e.stdout.trim() : "";
    return { status: "failed", http: code || "000", bytes: 0, sha256: "" };
  }
  let buf;
  try {
    buf = await readFile(file);
  } catch {
    return { status: "failed", http, bytes: 0, sha256: "" };
  }
  const got = sha256(buf);
  return {
    status: got === page.sha256 ? "ok" : "drift",
    http,
    bytes: buf.length,
    sha256: got,
  };
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  const manifest = JSON.parse(await readFile(MANIFEST, "utf8"));
  const pages = manifest.pages;
  if (!Array.isArray(pages) || pages.length === 0) {
    throw new Error(`manifest has no pages: ${MANIFEST}`);
  }
  await mkdir(o.out, { recursive: true });

  const counts = { ok: 0, drift: 0, failed: 0 };
  // Sequential on purpose: the output is one line per page in manifest order, so a run
  // diffs cleanly against the last one.
  for (const page of pages) {
    const r = await fetchPage(page, o.out);
    counts[r.status] += 1;
    process.stdout.write(`CORPUS ${page.name} ${r.status} http=${r.http} bytes=${r.bytes}\n`);
    if (o.update && r.status !== "failed") {
      page.sha256 = r.sha256;
      page.bytes = r.bytes;
    }
  }

  process.stdout.write(
    `CORPUS_FETCH pages=${pages.length} ok=${counts.ok} drift=${counts.drift} failed=${counts.failed}\n`,
  );

  if (o.update) {
    // UTC, not local: an evening run on the US west coast stamps tomorrow's date. That is
    // the right trade for a field whose only job is to be unambiguous later, but it does
    // mean fetchedAt and the operator's calendar can disagree by a day.
    manifest.fetchedAt = new Date().toISOString().slice(0, 10);
    await writeFile(MANIFEST, JSON.stringify(manifest, null, 2) + "\n");
    process.stdout.write(`CORPUS_FETCH updated ${MANIFEST} fetchedAt=${manifest.fetchedAt}\n`);
    if (counts.failed > 0) {
      // Nothing was fetched for these, so there is nothing to update them from: they keep
      // the hash they had. Say so, rather than letting --update read as "all 40 re-anchored".
      process.stderr.write(
        `fetch-corpus: ${counts.failed} page(s) failed and kept their previous hash — re-run before trusting the manifest\n`,
      );
    }
    return;
  }

  if (counts.drift > 0 || counts.failed > 0) {
    process.stderr.write(
      `fetch-corpus: ${counts.drift} drifted, ${counts.failed} failed — the claims' line anchors into any drifted page must be re-derived before the round's verdicts on them mean anything\n`,
    );
    process.exitCode = 1;
  }
}

main().catch((e) => {
  process.stderr.write(`fetch-corpus: ${e.message}\n`);
  process.exit(1);
});
