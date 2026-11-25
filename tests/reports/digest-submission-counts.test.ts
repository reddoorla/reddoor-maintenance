import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../../src/db/client.js";
import { createSubmission } from "../../src/db/submissions.js";
import { fetchSubmissionsDigestCounts } from "../../src/reports/digest.js";
import type { WebsiteRow } from "../../src/fleet/site-row.js";

// The digest reads its counts itself (no injected `submissionCounts`), so this pins
// that it hands `countSubmissionsSinceBySite` the roster's urls: without them every
// lead reads 0 (reddoorla/reddoor-maintenance#2296).
const NOW = new Date("2026-11-25T18:00:00.000Z");
let dir: string;
const ENV = { ...process.env };

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "digest-submission-counts-"));
  process.env.TURSO_DATABASE_URL = `file:${join(dir, "db.sqlite")}`;
  delete process.env.TURSO_AUTH_TOKEN;
  const db = await openDb({ url: process.env.TURSO_DATABASE_URL });
  const at = new Date(NOW.getTime() - 3_600_000);
  for (const [email, sourceUrl] of [
    ["jane@gmail.com", "https://www.acme.com/contact"],
    ["sam@gmail.com", "https://staging.acme.com/contact"],
    ["qa@reddoorla.com", "https://acme.com/contact"],
  ] as const) {
    await createSubmission(db, {
      siteId: "recA",
      formType: "contact",
      name: "Row",
      email,
      sourceUrl,
      submittedAt: at,
    });
  }
  await db.destroy();
});

afterEach(() => {
  process.env = { ...ENV };
  rmSync(dir, { recursive: true, force: true });
});

describe("fetchSubmissionsDigestCounts (#2296)", () => {
  it("counts a site's leads against its roster url", async () => {
    const sites = new Map([["recA", { id: "recA", url: "https://acme.com" } as WebsiteRow]]);
    const counts = await fetchSubmissionsDigestCounts(NOW, sites);
    expect(counts?.get("recA")).toEqual({ leads: 1, signups: 0, spamAuto: 0 });
  });
});
