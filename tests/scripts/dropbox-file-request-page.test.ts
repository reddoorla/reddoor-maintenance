import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createHash } from "node:crypto";
import { closeSync, mkdtempSync, openSync, rmSync, writeFileSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser, type BrowserContext } from "@playwright/test";
import { plan, uploadBatch } from "../../scripts/dropbox-file-request-upload.mjs";

/**
 * `uploadBatch` → the page → `waitForCommits`, driven in real Chromium (#1471 (2)).
 * Every request to www.dropbox.com is answered by a stand-in for the file request
 * page, shaped as the runbook measured the real one: a drop zone under
 * `#browse-target`, the name and email fields only after a drop, and one
 * `POST /drops/commit_file_request_by_token?name=<file>` per file. The stand-in
 * sends the SHA-256 of the bytes it was handed in place of uploading them, so a
 * test sees exactly what Chromium read, and it re-sends a commit answered 5xx, the
 * one retry the real page may make.
 */

const URL = "https://www.dropbox.com/request/standin0000000000000";

const PAGE = `<!doctype html><html><body>
<button id="cookies" type="button" onclick="this.remove()">Decline</button>
<div id="app"><div class="zone"><span id="browse-target">Choose files</span></div></div>
<script>
const app = document.getElementById("app");
let files = [];
for (const ev of ["dragenter", "dragover"]) app.addEventListener(ev, (e) => e.preventDefault());
app.addEventListener("drop", (e) => {
  e.preventDefault();
  files = [...e.dataTransfer.files];
  const list = document.createElement("ul");
  for (const f of files) {
    const li = document.createElement("li");
    li.textContent = f.name;
    list.append(li);
  }
  app.append(list);
  app.insertAdjacentHTML("beforeend",
    '<input name="name"><input name="email"><button type="button">Upload</button>');
  app.querySelector("button").addEventListener("click", () => {
    for (const f of files) commit(f, 0);
  });
});
async function commit(f, attempt) {
  const digest = await crypto.subtle.digest("SHA-256", await f.arrayBuffer());
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  const res = await fetch("/drops/commit_file_request_by_token?name=" + encodeURIComponent(f.name), {
    method: "POST",
    body: JSON.stringify({ sha256: hex, size: f.size }),
  });
  if (res.status >= 500 && attempt < 2) setTimeout(() => commit(f, attempt + 1), 300);
}
</script></body></html>`;

type Answer = { status: number; body: string };
const COMPLETE: Answer = { status: 200, body: '{"status": "complete"}' };

let browser: Browser;
let dir: string;
beforeAll(async () => {
  browser = await chromium.launch();
  dir = mkdtempSync(join(tmpdir(), "dbx-page-"));
});
afterAll(async () => {
  await browser?.close();
  rmSync(dir, { recursive: true, force: true });
});

/** A browser whose contexts answer www.dropbox.com with the stand-in. Each file's
 *  commits are answered from its list in order, the last answer repeating. */
function standIn(answers: Record<string, Answer[]>) {
  const received = new Map<string, { sha256: string; size: number }>();
  const attempts = new Map<string, number>();
  const fake = {
    newContext: async (o: Parameters<Browser["newContext"]>[0]): Promise<BrowserContext> => {
      const ctx = await browser.newContext(o);
      await ctx.route("https://www.dropbox.com/**", async (route) => {
        const u = new globalThis.URL(route.request().url());
        if (u.pathname === "/drops/commit_file_request_by_token") {
          const name = u.searchParams.get("name") ?? "";
          const n = attempts.get(name) ?? 0;
          attempts.set(name, n + 1);
          received.set(name, JSON.parse(route.request().postData() ?? "{}"));
          const list = answers[name] ?? [COMPLETE];
          const a = list[Math.min(n, list.length - 1)]!;
          await route.fulfill({ status: a.status, contentType: "application/json", body: a.body });
          return;
        }
        await route.fulfill({ status: 200, contentType: "text/html", body: PAGE });
      });
      return ctx;
    },
  };
  return { fake, received, attempts };
}

function file(name: string, bytes: Buffer): string {
  const p = join(dir, name);
  writeFileSync(p, bytes);
  return p;
}

const sha256 = (b: Buffer) => createHash("sha256").update(b).digest("hex");

async function run(paths: string[], answers: Record<string, Answer[]>, deadlineMs = 20_000) {
  const s = standIn(answers);
  const rows = plan(paths, "Claude");
  const t = Date.now();
  const got = await uploadBatch(s.fake, URL, "Claude", "a@example.com", rows, { deadlineMs });
  return { got, ms: Date.now() - t, ...s };
}

describe("uploadBatch through the page (stand-in for Dropbox)", () => {
  it("hands Chromium the files by path, and each commit carries exactly their bytes", async () => {
    const a = Buffer.from("first file\n");
    const b = Buffer.alloc(70_000, 7);
    const { got, received } = await run([file("Lot 12.pdf", a), file("b.bin", b)], {});
    expect(got.map((r) => [r.ok, r.why])).toEqual([
      [true, 'commit answered 200 {"status": "complete"}'],
      [true, 'commit answered 200 {"status": "complete"}'],
    ]);
    expect(received.get("Lot 12.pdf")).toEqual({ sha256: sha256(a), size: a.length });
    expect(received.get("b.bin")).toEqual({ sha256: sha256(b), size: b.length });
  }, 60_000);

  // #1396: as base64 in one message, this file is 120 M characters, which closed
  // the page (measured 2026-11-09: 100 MB through, 120 MB closed); as a buffer,
  // Playwright refuses it outright (50 MB). By path it never crosses the pipe.
  it("moves a 90 MB file, past what one DevTools message carries as base64", async () => {
    const p = join(dir, "big.bin");
    const fd = openSync(p, "w");
    const chunk = Buffer.alloc(1 << 20, 0x5a);
    for (let i = 0; i < 90; i++) writeSync(fd, chunk);
    closeSync(fd);
    const whole = Buffer.concat(Array.from({ length: 90 }, () => chunk));
    const { got, received } = await run([p], {});
    expect(got[0]?.why).toBe('commit answered 200 {"status": "complete"}');
    expect(got[0]?.ok).toBe(true);
    expect(received.get("big.bin")).toEqual({ sha256: sha256(whole), size: whole.length });
  }, 180_000);

  // #1471 (1): a definite failure ends the wait, where it used to wait out the
  // whole deadline (1,342 s for a 128 MiB batch).
  it("a 403 closed request ends the batch at once, FAILED, beside a file that committed", async () => {
    const { got, ms } = await run(
      [file("ok.pdf", Buffer.from("ok")), file("shut.pdf", Buffer.from("shut"))],
      { "shut.pdf": [{ status: 403, body: '{"error":"closed"}' }] },
    );
    expect(got.map((r) => r.ok)).toEqual([true, false]);
    expect(got[1]?.why).toBe('commit answered 403 {"error":"closed"}');
    expect(ms).toBeLessThan(10_000);
  }, 60_000);

  it("a 200 that is not complete ends the batch at once, FAILED", async () => {
    const { got, ms } = await run([file("err.pdf", Buffer.from("err"))], {
      "err.pdf": [{ status: 200, body: '{"status": "error"}' }],
    });
    expect(got[0]?.ok).toBe(false);
    expect(got[0]?.why).toBe('commit answered 200 {"status": "error"}');
    expect(ms).toBeLessThan(10_000);
  }, 60_000);

  it("a 5xx is waited through, and the page's retry that completes counts", async () => {
    const { got, attempts } = await run([file("flaky.pdf", Buffer.from("flaky"))], {
      "flaky.pdf": [{ status: 503, body: "" }, COMPLETE],
    });
    expect(attempts.get("flaky.pdf")).toBe(2);
    expect(got[0]?.ok).toBe(true);
  }, 60_000);

  it("a 5xx that never clears is FAILED at the deadline, not before", async () => {
    const { got, ms } = await run(
      [file("down.pdf", Buffer.from("down"))],
      { "down.pdf": [{ status: 502, body: "" }] },
      4_000,
    );
    expect(got[0]?.ok).toBe(false);
    expect(got[0]?.why).toBe("commit answered 502 ");
    expect(ms).toBeGreaterThanOrEqual(4_000);
  }, 60_000);

  it("a file changed after it was hashed is not sent", async () => {
    const p = file("moved.pdf", Buffer.from("before"));
    const s = standIn({});
    const rows = plan([p], "Claude");
    writeFileSync(p, "after!");
    const got = await uploadBatch(s.fake, URL, "Claude", "a@example.com", rows, {
      deadlineMs: 10_000,
    });
    expect(got[0]?.ok).toBe(false);
    expect(got[0]?.why).toMatch(/moved\.pdf changed after it was hashed/);
    expect(s.received.size).toBe(0);
  }, 60_000);
});
