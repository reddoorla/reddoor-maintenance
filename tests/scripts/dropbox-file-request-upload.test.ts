import { describe, it, expect, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  BLOCK,
  BATCH,
  contentHash,
  parseArgs,
  uploadedName,
  batches,
  timeoutMs,
  plan,
  table,
  commitComplete,
} from "../../scripts/dropbox-file-request-upload.mjs";

const SCRIPT = join(__dirname, "../../scripts/dropbox-file-request-upload.mjs");
const URL_OK = "https://www.dropbox.com/request/jdgy7hgrr2hx22f3thh5";

const roots: string[] = [];
afterAll(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true });
});

function scratch() {
  const d = mkdtempSync(join(tmpdir(), "dbx-fr-"));
  roots.push(d);
  return d;
}

function pattern(n: number, k = 1) {
  const b = Buffer.alloc(n);
  for (let i = 0; i < n; i++) b[i] = (i * k) % 251;
  return b;
}

describe("contentHash matches what Dropbox reported for the same bytes", () => {
  it("1000 bytes, one partial block", () => {
    expect(contentHash(pattern(1000))).toBe(
      "c88e98bd565d6e001a0a37ac287032e1183923f35f6fde42c14210cbe2098d7c",
    );
  });

  it("1 and 251 bytes", () => {
    expect(contentHash(pattern(1))).toBe(
      "1406e05881e299367766d313e26c05564ec91bf721d31726bd6e46e60689539a",
    );
    expect(contentHash(pattern(251))).toBe(
      "0de936d2da7a80e719e24555c743a9cf7db35b94795b088219f7c5d231a01362",
    );
  });

  it("exactly 4 MiB is one block, with no empty block after it", () => {
    expect(contentHash(pattern(4 * 1024 * 1024))).toBe(
      "b9654428408015906b44a00935b70af33830aa344b780b0eabd535a133150d04",
    );
  });

  it("4 MiB and one byte is two blocks", () => {
    expect(contentHash(pattern(4 * 1024 * 1024 + 1))).toBe(
      "4a6cc0a344febaa07772e7c974834b2fb1d24594d4ba15f27c97a54699709f44",
    );
  });

  it("two full blocks and two bytes is three blocks", () => {
    expect(contentHash(pattern(2 * (4 * 1024 * 1024 + 1), 13))).toBe(
      "9d3415a225048343dd7ed8b0456c3e32e2fc88df62d8fdd54e2c6f398f78a9e1",
    );
  });

  it("is not the plain SHA-256 of the file", () => {
    const plain = createHash("sha256").update(pattern(1000)).digest("hex");
    expect(contentHash(pattern(1000))).not.toBe(plain);
  });

  it("uses 4 MiB blocks", () => {
    expect(BLOCK).toBe(4 * 1024 * 1024);
  });
});

describe("uploadedName", () => {
  it("puts the uploader's name in front, as Dropbox does", () => {
    expect(uploadedName("Uploader probe", "/tmp/x/uploader-probe-1000.bin")).toBe(
      "Uploader probe - uploader-probe-1000.bin",
    );
    expect(uploadedName("Reddoor (Claude)", "out/Hwy 46 West.pdf")).toBe(
      "Reddoor (Claude) - Hwy 46 West.pdf",
    );
  });
});

describe("batches", () => {
  it("splits into groups of BATCH", () => {
    const xs = Array.from({ length: 12 }, (_, i) => i);
    expect(BATCH).toBe(5);
    expect(batches(xs).map((b) => b.length)).toEqual([5, 5, 2]);
    expect(batches(xs, 4).map((b) => b.length)).toEqual([4, 4, 4]);
    expect(batches([])).toEqual([]);
  });
});

describe("timeoutMs", () => {
  it("is at least two minutes and grows ten seconds per MB", () => {
    expect(timeoutMs(1000)).toBe(120_000);
    expect(timeoutMs(12_000_000)).toBe(120_000);
    expect(timeoutMs(100_000_000)).toBe(1_000_000);
  });
});

describe("parseArgs", () => {
  const env = { UPLOADER_EMAIL: "someone@example.com" };

  it("reads the URL, the uploader name and the files", () => {
    expect(parseArgs([URL_OK, "Reddoor (Claude)", "a.pdf", "b.png"], env)).toEqual({
      url: URL_OK,
      name: "Reddoor (Claude)",
      files: ["a.pdf", "b.png"],
      dryRun: false,
    });
  });

  it("takes --dry-run anywhere and then needs no email", () => {
    expect(parseArgs(["--dry-run", URL_OK, "R", "a.pdf"], {}).dryRun).toBe(true);
    expect(parseArgs([URL_OK, "R", "a.pdf", "--dry-run"], {}).dryRun).toBe(true);
  });

  it("refuses an upload without UPLOADER_EMAIL", () => {
    expect(() => parseArgs([URL_OK, "R", "a.pdf"], {})).toThrow(/UPLOADER_EMAIL/);
    expect(() => parseArgs([URL_OK, "R", "a.pdf"], { UPLOADER_EMAIL: " " })).toThrow(
      /UPLOADER_EMAIL/,
    );
  });

  it("refuses a URL that is not a Dropbox file request", () => {
    expect(() => parseArgs(["https://www.dropbox.com/scl/fo/abc", "R", "a.pdf"], env)).toThrow(
      /file request/,
    );
    expect(() => parseArgs(["http://www.dropbox.com/request/abc", "R", "a.pdf"], env)).toThrow(
      /file request/,
    );
  });

  it("refuses a missing name, no files, an unknown flag, and two files with one name", () => {
    expect(() => parseArgs([URL_OK, "", "a.pdf"], env)).toThrow(/name/);
    expect(() => parseArgs([URL_OK, "R"], env)).toThrow(/file/);
    expect(() => parseArgs([URL_OK, "R", "a.pdf", "--batch=3"], env)).toThrow(/--batch=3/);
    expect(() => parseArgs([URL_OK, "R", "x/a.pdf", "y/a.pdf"], env)).toThrow(/a\.pdf/);
  });
});

describe("plan and table", () => {
  it("lists each file's size, content hash, uploaded name and rename target", () => {
    const d = scratch();
    const f = join(d, "probe 1000.bin");
    writeFileSync(f, pattern(1000));
    const rows = plan([f], "Uploader probe");
    expect(rows).toEqual([
      {
        file: f,
        size: 1000,
        contentHash: "c88e98bd565d6e001a0a37ac287032e1183923f35f6fde42c14210cbe2098d7c",
        uploadedAs: "Uploader probe - probe 1000.bin",
        renameTo: "probe 1000.bin",
      },
    ]);
    const t = table(rows);
    expect(t).toContain("1000");
    expect(t).toContain("c88e98bd565d6e001a0a37ac287032e1183923f35f6fde42c14210cbe2098d7c");
    expect(t).toContain("Uploader probe - probe 1000.bin -> probe 1000.bin");
  });
});

describe("commitComplete", () => {
  it("is true only for a 200 whose body says complete, as Dropbox answered on 2026-10-16", () => {
    expect(commitComplete(200, '{"status": "complete"}')).toBe(true);
    expect(commitComplete(200, '{"status": "error"}')).toBe(false);
    expect(commitComplete(200, "<html>")).toBe(false);
    expect(commitComplete(200, "")).toBe(false);
    expect(commitComplete(409, '{"status": "complete"}')).toBe(false);
  });
});

describe("the command", () => {
  function run(args: string[], env: Record<string, string> = {}) {
    const clean = { ...process.env, ...env };
    if (!("UPLOADER_EMAIL" in env)) delete clean.UPLOADER_EMAIL;
    return spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf-8", env: clean });
  }

  it("--dry-run prints the table and the verification step, and opens no browser", () => {
    const d = scratch();
    const f = join(d, "probe.bin");
    writeFileSync(f, pattern(1000));
    const r = run(["--dry-run", URL_OK, "Uploader probe", f]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("c88e98bd565d6e001a0a37ac287032e1183923f35f6fde42c14210cbe2098d7c");
    expect(r.stdout).toContain("download_link");
    expect(r.stdout).toContain("content_hash");
    expect(r.stdout).not.toContain("batch 1");
  });

  it("exits 2 with the usage on bad arguments", () => {
    const d = scratch();
    const f = join(d, "probe.bin");
    writeFileSync(f, pattern(10));
    const r = run([URL_OK, "R", f]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("UPLOADER_EMAIL");
    expect(r.stderr).toContain("usage:");
  });

  it("exits 2 when a file does not exist", () => {
    const r = run(["--dry-run", URL_OK, "R", "/nonexistent/x.pdf"]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("/nonexistent/x.pdf");
  });
});
