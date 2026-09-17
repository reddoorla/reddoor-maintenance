/**
 * #646 step 4: report ids. The minting half mirrors the site-id suite; the
 * `isReportId` half is what the three request routes validate with, so it is
 * pinned in both directions — it must accept what the minter produces AND keep
 * accepting every `rec` id the routes served before, because those reports do
 * not get rewritten.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { mintReportId, isMintedReportId, isReportId } from "../../src/fleet/report-id.js";
import { encodeUlid } from "../../src/fleet/site-id.js";

describe("mintReportId", () => {
  it("mints `report_` + a 26-character ULID", () => {
    const id = mintReportId();
    expect(id).toMatch(/^report_[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(isMintedReportId(id)).toBe(true);
  });

  it("reuses the site-id module's ULID encoding rather than a second copy", () => {
    // The time half is deterministic, so a minted id's first 10 characters are
    // exactly what `encodeUlid` produces for that millisecond. If this module
    // ever grew its own encoder, this is what would catch it.
    const at = Date.parse("2026-09-17T12:00:00.000Z");
    const expectedTime = encodeUlid(at, new Uint8Array(10)).slice(0, 10);
    expect(mintReportId(at).slice("report_".length, "report_".length + 10)).toBe(expectedTime);
  });

  it("is unique across a burst within one millisecond", () => {
    const at = Date.now();
    const ids = new Set(Array.from({ length: 500 }, () => mintReportId(at)));
    expect(ids.size).toBe(500);
  });

  it("sorts by mint time", () => {
    const early = mintReportId(Date.parse("2026-01-01T00:00:00.000Z"));
    const late = mintReportId(Date.parse("2026-09-17T00:00:00.000Z"));
    expect([late, early].sort()).toEqual([early, late]);
  });
});

describe("isReportId — what the report routes accept", () => {
  it("accepts a minted report id", () => {
    expect(isReportId(mintReportId())).toBe(true);
  });

  it("accepts an Airtable rec id, exactly as the routes' old regex did", () => {
    expect(isReportId("recABC123xyz")).toBe(true);
  });

  it("rejects a site id, junk, and path-traversal probes", () => {
    for (const id of [
      "site_01ARYZ6S41TSV4RRFFQ69G5FAV",
      "report_short",
      "report_01ARYZ6S41TSV4RRFFQ69G5FAI", // I is not in the ULID alphabet
      "rec_report_1", // readable fixture shape — not a real route id
      "../../etc/passwd",
      "rec",
      "",
    ]) {
      expect(isReportId(id), id).toBe(false);
    }
  });
});

describe("the three report routes validate with it (#646 step 4)", () => {
  const ROUTES = ["report-preview.mts", "report-rerender.mts", "report-commentary.mts"];

  for (const route of ROUTES) {
    it(`netlify/functions/${route} uses isReportId and no longer hard-codes the rec-only regex`, () => {
      const src = readFileSync(
        fileURLToPath(new URL(`../../netlify/functions/${route}`, import.meta.url)),
        "utf-8",
      );
      expect(src).toContain("isReportId(id)");
      expect(src).not.toContain("/^rec[A-Za-z0-9]+$/");
    });
  }
});
