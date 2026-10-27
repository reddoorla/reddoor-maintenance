/**
 * P1-16. `scripts/replay-checks.mts` parses every stored audit's `result_json`
 * as a report. A `running` reservation and a `failed` run both hold a `{}`
 * placeholder instead, so the script must skip them, from the same
 * `NO_REPORT_STATUSES` list every other report reader uses.
 *
 * Spawns the script from source against a real migrated file database, since
 * the property is what its query selects. The positive control is a finished
 * row holding the same `{}`: the script does read it, and reports it as having
 * no crawl.
 */
import { describe, it, expect, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { openDb } from "../../src/db/client.js";
import { generateToken, newProspectAuditId } from "../../src/db/prospect-audits.js";

const repoRoot = resolve(__dirname, "../..");
let dir: string | null = null;

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = null;
});

async function replayOver(rows: Array<{ url: string; status: string }>): Promise<string> {
  dir = mkdtempSync(join(tmpdir(), "replay-checks-"));
  const url = `file:${join(dir, "db.sqlite")}`;
  const db = await openDb({ url });
  for (const r of rows) {
    await db
      .insertInto("prospect_audits")
      .values({
        id: newProspectAuditId(),
        token: generateToken(),
        url: r.url,
        business: null,
        status: r.status,
        result_json: "{}",
        created_at: "2026-09-29T12:00:00.000Z",
      })
      .execute();
  }
  await db.destroy();
  return execFileSync(
    join(repoRoot, "node_modules/.bin/tsx"),
    [join(repoRoot, "scripts/replay-checks.mts")],
    {
      cwd: dir,
      env: { ...process.env, TURSO_DATABASE_URL: url, TURSO_AUTH_TOKEN: "" },
    },
  ).toString();
}

describe("replay-checks skips rows with no report behind them", () => {
  it("positive control: a finished row holding `{}` is read, and has no crawl", async () => {
    const out = await replayOver([{ url: "https://done.example/", status: "complete" }]);
    expect(out).toContain("1 stored audits");
    expect(out).toContain("https://done.example/: no crawl in the stored result");
  }, 60_000);

  it("a `failed` row and a `running` row are not read at all", async () => {
    const out = await replayOver([
      { url: "https://failed.example/", status: "failed" },
      { url: "https://running.example/", status: "running" },
    ]);
    expect(out).toContain("0 stored audits");
    expect(out).not.toContain("failed.example");
    expect(out).not.toContain("running.example");
  }, 60_000);
});
