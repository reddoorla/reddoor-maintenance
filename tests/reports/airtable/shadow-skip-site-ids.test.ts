/**
 * #646 step 3 (operator decision 2026-09-17): new sites get `site_<ULID>` ids
 * minted by Turso, and Airtable can never hold a record under one. Every Airtable
 * writer that takes a SITE id must therefore skip a non-`rec` id on purpose — and
 * say so with one stable greppable line — instead of 404ing (or throwing
 * INVALID_RECORDS) on a site Airtable has never heard of.
 *
 * Two closures keep this honest:
 *   1. Completeness — every exported Airtable writer that addresses a Websites
 *      row by id must appear in WRITERS. A new `update*` writer fails the build
 *      until someone decides how it treats a `site_` id.
 *   2. The positive control — each writer, given a `rec` id, still writes. A
 *      guard that skipped everything would satisfy the skip assertions alone.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import * as websites from "../../../src/reports/airtable/websites.js";
import { uploadAttachment } from "../../../src/reports/airtable/attachments.js";
import { createDraft } from "../../../src/reports/airtable/reports.js";
import { makeFakeBase, type FakeAirtableBase } from "../_helpers/fake-airtable-base.js";

const SITE_ID = "site_01ARYZ6S41TSV4RRFFQ69G5FAV";
const REC_ID = "recEXIST";

type Writer = {
  name: string;
  /** Invoke the writer against `base` for `id`; resolves whatever it returns. */
  call: (base: FakeAirtableBase, id: string) => Promise<unknown>;
  /** Did the writer reach Airtable? */
  wrote: (base: FakeAirtableBase, fetchMock: ReturnType<typeof vi.fn>) => boolean;
  /** Writers whose returned FieldSet feeds the Turso write must STILL return it
   *  when they skip — the authoritative write cannot depend on the shadow. */
  returnsFields?: boolean;
};

const updatedBase = (base: FakeAirtableBase) => base.__calls.some((c) => c.kind === "update");

const WRITERS: Writer[] = [
  {
    name: "updateScores",
    call: (b, id) =>
      websites.updateScores(b, id, { performance: 1, accessibility: 1, bestPractices: 1, seo: 1 }),
    wrote: updatedBase,
  },
  {
    name: "updateAnalyticsHealth",
    call: (b, id) => websites.updateAnalyticsHealth(b, id, "2026-09-17T00:00:00.000Z"),
    wrote: updatedBase,
    returnsFields: true,
  },
  {
    name: "updateA11yCounts",
    call: (b, id) => websites.updateA11yCounts(b, id, { violations: 0 }),
    wrote: updatedBase,
  },
  {
    name: "updateDepsCounts",
    call: (b, id) =>
      websites.updateDepsCounts(b, id, {
        drifted: 0,
        majorBehind: 0,
        outdated: 0,
        majorOutdated: 0,
      }),
    wrote: updatedBase,
  },
  {
    name: "updateSecurityCounts",
    call: (b, id) =>
      websites.updateSecurityCounts(b, id, { critical: 0, high: 0, moderate: 0, low: 0 }),
    wrote: updatedBase,
  },
  {
    name: "updateAutoFixAttempts",
    call: (b, id) => websites.updateAutoFixAttempts(b, id, 2),
    wrote: updatedBase,
    returnsFields: true,
  },
  {
    name: "updateNextDueDates",
    call: (b, id) =>
      websites.updateNextDueDates(b, id, { maintenanceAt: "2026-10-01", testingAt: null }),
    wrote: updatedBase,
    returnsFields: true,
  },
  {
    name: "updateSiteField",
    call: (b, id) => websites.updateSiteField(b, id, "url", "https://acme.example.com"),
    wrote: updatedBase,
  },
  {
    name: "updateSiteFields",
    call: (b, id) => websites.updateSiteFields(b, id, { url: "https://acme.example.com" }),
    wrote: updatedBase,
  },
  {
    name: "updateAuditFields",
    call: (b, id) => websites.updateAuditFields(b, id, { a11y: { violations: 3 } }),
    wrote: updatedBase,
    returnsFields: true,
  },
  {
    name: "updateGitHubSignals",
    call: (b, id) =>
      websites.updateGitHubSignals(b, id, {
        renovateFailingCis: 0,
        ciState: "success",
        lastCommitAt: null,
        sweptAt: "2026-09-17T00:00:00.000Z",
      }),
    wrote: updatedBase,
    returnsFields: true,
  },
  {
    name: "updatePrismicModels",
    call: (b, id) =>
      websites.updatePrismicModels(b, id, {
        verdict: "pass",
        checkedAt: "2026-09-17T00:00:00.000Z",
        detail: null,
      }),
    wrote: updatedBase,
    returnsFields: true,
  },
  {
    name: "updateLaunched",
    call: (b, id) => websites.updateLaunched(b, id, "2026-09-17T00:00:00.000Z"),
    wrote: updatedBase,
    returnsFields: true,
  },
  {
    // The header-image write-back (`header-image --write-back`, drafting's
    // refreshHeaderImage) addresses the Websites row through the content API.
    name: "uploadAttachment",
    call: (_b, id) =>
      uploadAttachment(id, "Header image", new Uint8Array([1]), "h.png", "image/png"),
    wrote: (_b, fetchMock) => fetchMock.mock.calls.length > 0,
  },
];

let fetchMock: ReturnType<typeof vi.fn>;

function setup() {
  fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("AIRTABLE_PAT", "pat_probe");
  vi.stubEnv("AIRTABLE_BASE_ID", "app_probe");
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("Airtable site writers skip a Turso-minted site_ id (#646 step 3)", () => {
  it("covers every exported Websites writer (completeness)", () => {
    const exported = Object.entries(websites)
      .filter(([name, v]) => typeof v === "function" && /^update/.test(name))
      .map(([name]) => name)
      .sort();
    const covered = WRITERS.map((w) => w.name).filter((n) => n !== "uploadAttachment");
    expect(covered.sort()).toEqual(exported);
  });

  for (const w of WRITERS) {
    it(`${w.name}: skips a site_ id, logs AIRTABLE_SHADOW skipped=non-rec-id, never reaches Airtable`, async () => {
      setup();
      const log = vi.spyOn(console, "log").mockImplementation(() => {});
      const base = makeFakeBase({ Websites: [] });
      const out = await w.call(base, SITE_ID);
      expect(w.wrote(base, fetchMock)).toBe(false);
      expect(log).toHaveBeenCalledWith(
        `AIRTABLE_SHADOW skipped=non-rec-id writer=${w.name} id=${SITE_ID}`,
      );
      if (w.returnsFields) {
        expect(
          out,
          "a skipped writer must still hand back the FieldSet the Turso write uses",
        ).toBeTypeOf("object");
        expect(Object.keys(out as object).length).toBeGreaterThan(0);
      }
    });

    it(`${w.name}: still writes a rec id (positive control)`, async () => {
      setup();
      const log = vi.spyOn(console, "log").mockImplementation(() => {});
      const base = makeFakeBase({ Websites: [{ id: REC_ID, fields: { Name: "Acme" } }] });
      await w.call(base, REC_ID);
      expect(w.wrote(base, fetchMock)).toBe(true);
      expect(log.mock.calls.flat().join("\n")).not.toContain("AIRTABLE_SHADOW skipped=non-rec-id");
    });
  }
});

describe("the legacy Airtable createDraft still refuses a site_ id by name", () => {
  // It MINTS the report id from Airtable's record id, so skipping would silently
  // produce no report: it refuses before any Airtable call, with a reason,
  // instead of Airtable's opaque link-field rejection. Since #646 step 4 no
  // production path calls it — reports are created in Turso
  // (`createReportDraft`), which is what the message now points at.
  it("throws before touching Airtable", async () => {
    const base = makeFakeBase({ Reports: [] });
    await expect(
      createDraft(base, {
        reportId: "acme-2026-09",
        siteId: SITE_ID,
        reportType: "Maintenance",
        periodStart: new Date("2026-09-01"),
        periodEnd: new Date("2026-09-30"),
        completedOn: new Date("2026-09-30"),
        lighthouse: { performance: 1, accessibility: 1, bestPractices: 1, seo: 1 },
        lastTestedDate: null,
      }),
    ).rejects.toThrow(/create the report in Turso instead/i);
    expect(base.__calls).toEqual([]);
  });
});
