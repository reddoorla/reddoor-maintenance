/**
 * #646 step 4: the operator digest and preflight read the fleet from TURSO.
 *
 * The rest of the digest suite injects its two datasets from a fake Airtable base,
 * because that is where its fixtures live and because the digest-state shadow write
 * is still Airtable's. This file wires the readers the CLI actually wires — `listSites`
 * and `listAllReports` over a REAL migrated libSQL database in a temp `file:` (never
 * `:memory:`, never a `TURSO_*` url from the environment) — and pins the thing the
 * step exists for: a `site_<ULID>` site, which has no Airtable record at all, reaches
 * the operator's morning email and the preflight checks.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, type Db } from "../../src/db/client.js";
import { listSites, listAllReports, mirrorSiteInsert } from "../../src/db/fleet-state.js";
import { mintSiteId } from "../../src/fleet/site-id.js";
import { runDigest } from "../../src/reports/digest.js";
import { preflight } from "../../src/reports/preflight.js";
import type { ResendClient, ResendSendInput } from "../../src/reports/send/resend.js";
import { makeFakeBase } from "./_helpers/fake-airtable-base.js";

const NOW = new Date("2026-09-17T09:00:00.000Z");
const NATIVE = mintSiteId(NOW.getTime());
const BASE_URL = "https://reddoor-maintenance.netlify.app";

let dir: string;
let db: Db;

function captureClient(): { client: ResendClient; captured: ResendSendInput[] } {
  const captured: ResendSendInput[] = [];
  return {
    captured,
    client: {
      async send(input) {
        captured.push(input);
        return { messageId: `msg_${captured.length}` };
      },
    },
  };
}

const memoryDigestState = () => {
  let snap: Record<string, { metric: number; firstFlaggedAt: string; exhausted?: boolean }> = {};
  return {
    read: async () => snap,
    write: async (next: typeof snap) => {
      snap = next;
    },
  };
};

beforeEach(async () => {
  vi.stubEnv("OPERATOR_EMAIL", "tucker@reddoorla.com");
  dir = mkdtempSync(join(tmpdir(), "digest-turso-"));
  db = await openDb({ url: `file:${join(dir, "fleet.db")}` });
  // A Turso-native site (#646 step 3) carrying a critical vulnerability whose
  // auto-fix is EXHAUSTED — the shape the digest actually emails about (a fresh
  // vuln stays muted while Renovate is still self-patching). It has no Airtable
  // record, by design.
  await mirrorSiteInsert(
    db,
    {
      id: NATIVE,
      fields: {
        Name: "Native Co",
        Status: "maintained",
        url: "https://native.example.com",
        "maintenence freq": "Monthly",
        "Security Vulns Critical": 2,
        "Security Auto-Fix Attempts": 3,
        "point of contact": "owner@native.example.com",
        "Header image": [{ url: "https://x/img.png", filename: "img.png", type: "image/png" }],
        pScore: 95,
        rScore: 100,
        bpScore: 100,
        seoScore: 100,
      },
    },
    NOW.toISOString(),
  );
});

afterEach(async () => {
  await db.destroy();
  rmSync(dir, { recursive: true, force: true });
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const io = () => ({
  roster: () => listSites(db),
  allReports: () => listAllReports(db),
});

describe("the operator digest, read from Turso", () => {
  it("raises a site_<ULID> site's vulnerability — the site Airtable cannot see", async () => {
    const { client, captured } = captureClient();
    const result = await runDigest({
      ...io(),
      // Airtable is opened for the digest-state shadow write only.
      base: makeFakeBase({}),
      digestState: memoryDigestState(),
      resend: client,
      baseUrl: BASE_URL,
      submissionCounts: null,
      now: NOW,
    });
    expect(result.code).toBe(0);
    expect(captured).toHaveLength(1);
    expect(captured[0]!.html).toContain("Native Co");
    expect(captured[0]!.html).toContain("critical/high");
  });

  it("a Turso read failure reds the run rather than sending a short digest", async () => {
    const { client, captured } = captureClient();
    const result = await runDigest({
      roster: async () => {
        throw new Error("turso down");
      },
      allReports: () => listAllReports(db),
      base: makeFakeBase({}),
      digestState: memoryDigestState(),
      resend: client,
      baseUrl: BASE_URL,
      submissionCounts: null,
      now: NOW,
    });
    expect(result.code).toBe(1);
    expect(result.output).toMatch(/^digest failed: /);
    expect(captured).toHaveLength(0);
  });
});

describe("preflight, read from Turso", () => {
  it("checks a site_<ULID> site in --all, and finds it by slug", async () => {
    const all = await preflight({ ...io(), all: true, type: "Announcement", now: NOW });
    expect(all.results.map((r) => r.site)).toContain("Native Co");
    // Found by SLUG too — the handle every operator types, matched with siteSlug.
    const one = await preflight({ ...io(), site: "native-co", now: NOW });
    expect(one.results.map((r) => r.site)).toEqual(["Native Co"]);
  });
});
