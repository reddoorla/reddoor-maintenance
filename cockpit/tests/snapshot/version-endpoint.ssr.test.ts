import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../../../src/db/client.js";
import { createSubmission, setSubmissionStatusRow } from "../../../src/db/submissions.js";
import { loadCockpitSnapshot } from "../../../src/dashboard/snapshot.js";
import handler from "../../src/lib/server/endpoints/cockpit-version.js";
import { authHeader } from "../../../tests/_helpers/basic-auth.js";

/**
 * `/api/cockpit/version`: the store's change counter, which the open cockpit
 * compares with its snapshot's to know whether to offer a reload. It must agree
 * with the snapshot when nothing changed, move when anything the snapshot shows
 * did (the brief's mutation 5: a new submission), and say nothing to a stranger.
 */

const ORIGINAL_ENV = { ...process.env };
let dir: string;
let url: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cockpit-version-"));
  url = `file:${join(dir, "db.sqlite")}`;
  process.env = { ...ORIGINAL_ENV, TURSO_DATABASE_URL: url, DASHBOARD_PASSWORD: "s3cret" };
  delete process.env.TURSO_AUTH_TOKEN;
  delete process.env.CONTEXT;
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  rmSync(dir, { recursive: true, force: true });
});

async function ask(headers: Record<string, string> = authHeader("s3cret"), method = "GET") {
  const res = await handler(
    new Request("https://cockpit.example/api/cockpit/version", { method, headers }),
  );
  return { res, body: (await res.json().catch(() => null)) as { version?: number } | null };
}

describe("/api/cockpit/version", () => {
  it("agrees with the snapshot until something it shows changes, then moves", async () => {
    const db = await openDb({ url });
    await db
      .insertInto("sites")
      .values({ id: "recA", slug: "acme", name: "Acme", url: "https://a.example" } as never)
      .execute();
    const snapshot = await loadCockpitSnapshot(db, new Date(), "https://dash.example");
    const first = await ask();
    expect(first.res.status).toBe(200);
    expect(first.res.headers.get("cache-control")).toBe("private, no-store");
    expect(first.body?.version).toBe(snapshot.version);

    // Nothing written: the same answer, so the cockpit shows no notice.
    expect((await ask()).body?.version).toBe(snapshot.version);

    // A lead arrives through the ingest path's own writer.
    const lead = await createSubmission(db, {
      siteId: "recA",
      formType: "contact",
      name: "Pat",
      email: "pat@example.com",
      submittedAt: new Date(),
    });
    const afterLead = (await ask()).body?.version;
    expect(afterLead).not.toBe(snapshot.version);

    // And a status change, which no timestamp records.
    await setSubmissionStatusRow(db, lead.id, "read");
    expect((await ask()).body?.version).not.toBe(afterLead);
  });

  it("says nothing to a signed-out caller, and answers only GET", async () => {
    await openDb({ url });
    const out = await ask({});
    expect([401, 403]).toContain(out.res.status);
    // No answer from this route may be cached, a denial included.
    expect(out.res.headers.get("cache-control")).toBe("private, no-store");
    expect(out.body?.version).toBeUndefined();
    const post = await ask(authHeader("s3cret"), "POST");
    expect(post.res.status).toBe(405);
    expect(post.res.headers.get("cache-control")).toBe("private, no-store");
  });
});
