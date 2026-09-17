import { describe, it, expect, vi, afterEach } from "vitest";
import {
  encodeUlid,
  isAirtableRecordId,
  isMintedSiteId,
  mintSiteId,
  skipsAirtableShadow,
} from "../../src/fleet/site-id.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("encodeUlid — the ULID wire format", () => {
  it("matches the ULID spec's published time component", () => {
    // github.com/ulid/spec: ulid(1469918176385) → 01ARYZ6S41…; the random half is
    // whatever the bytes are, so only the 10-char time prefix is a fixed vector.
    const id = encodeUlid(1469918176385, new Uint8Array(10));
    expect(id.slice(0, 10)).toBe("01ARYZ6S41");
  });

  it("encodes the random half as 16 Crockford chars, both extremes", () => {
    expect(encodeUlid(0, new Uint8Array(10))).toBe("0".repeat(26));
    expect(encodeUlid(0, new Uint8Array(10).fill(0xff))).toBe("0".repeat(10) + "Z".repeat(16));
  });

  it("is lexically time-sortable across milliseconds", () => {
    const rnd = new Uint8Array(10).fill(0xff);
    const earlier = encodeUlid(1_700_000_000_000, rnd);
    const later = encodeUlid(1_700_000_000_001, new Uint8Array(10));
    expect(earlier < later).toBe(true);
  });

  it("refuses a time outside 48 bits or a wrong-sized random buffer", () => {
    expect(() => encodeUlid(2 ** 48, new Uint8Array(10))).toThrow(/48-bit/);
    expect(() => encodeUlid(-1, new Uint8Array(10))).toThrow(/48-bit/);
    expect(() => encodeUlid(0, new Uint8Array(9))).toThrow(/10 random bytes/);
  });
});

describe("mintSiteId", () => {
  it("mints site_<ULID> and the shape predicate recognises it", () => {
    const id = mintSiteId();
    expect(id).toMatch(/^site_[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(isMintedSiteId(id)).toBe(true);
    expect(isAirtableRecordId(id)).toBe(false);
  });

  it("does not repeat across a burst (80 random bits per id)", () => {
    const ids = new Set(Array.from({ length: 2000 }, () => mintSiteId()));
    expect(ids.size).toBe(2000);
  });
});

describe("id-shape predicates", () => {
  it("an Airtable record id is anything rec-prefixed; a minted site id never is", () => {
    expect(isAirtableRecordId("recA1b2C3d4E5f6G7")).toBe(true);
    expect(isAirtableRecordId("recEXIST")).toBe(true);
    expect(isAirtableRecordId("rec_site_acme")).toBe(true);
    for (const bad of ["site_01ARYZ6S41TSV4RRFFQ69G5FAV", "rec", "REC123", "xrec1", ""]) {
      expect(isAirtableRecordId(bad), bad).toBe(false);
    }
  });

  it("a minted site id is exactly site_ + 26 Crockford chars", () => {
    expect(isMintedSiteId("site_01ARYZ6S41TSV4RRFFQ69G5FAV")).toBe(true);
    for (const bad of [
      "site_01ARYZ6S41TSV4RRFFQ69G5FA",
      "site_01ARYZ6S41TSV4RRFFQ69G5FAI",
      "recA",
    ]) {
      expect(isMintedSiteId(bad), bad).toBe(false);
    }
  });
});

describe("skipsAirtableShadow — the one skip decision + its log line", () => {
  it("skips a site_ id and logs the stable greppable line", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(skipsAirtableShadow("updateSiteField", "site_01ARYZ6S41TSV4RRFFQ69G5FAV")).toBe(true);
    expect(log).toHaveBeenCalledWith(
      "AIRTABLE_SHADOW skipped=non-rec-id writer=updateSiteField id=site_01ARYZ6S41TSV4RRFFQ69G5FAV",
    );
  });

  it("does NOT skip (and logs nothing for) a rec id — the positive control", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(skipsAirtableShadow("updateSiteField", "recEXIST")).toBe(false);
    expect(log).not.toHaveBeenCalled();
  });
});
