import { describe, it, expect, vi, afterEach } from "vitest";
import { AIRTABLE_SHADOW_WRITES } from "../../src/db/freeze.js";
import { airtableShadowOff, skipsAirtableShadow } from "../../src/fleet/site-id.js";
import * as websites from "../../src/reports/airtable/websites.js";
import * as reports from "../../src/reports/airtable/reports.js";
import { uploadAttachment } from "../../src/reports/airtable/attachments.js";
import { writeDigestState } from "../../src/alerts/digest-state.js";
import { makeFakeBase, type FakeAirtableBase } from "../reports/_helpers/fake-airtable-base.js";

const REC = "recEXIST";
const SITE = "site_01ARYZ6S41TSV4RRFFQ69G5FAV";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the Airtable shadow switch", () => {
  it("ships OFF: no Airtable shadow write runs anywhere", () => {
    expect(AIRTABLE_SHADOW_WRITES).toBe(false);
  });

  it("off: a rec id skips too, with its own greppable reason", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(skipsAirtableShadow("updateX", REC, false)).toBe(true);
    expect(log).toHaveBeenCalledWith(
      "AIRTABLE_SHADOW skipped=shadow-off writer=updateX id=recEXIST",
    );
  });

  it("on: a rec id writes and a site_ id skips as before (positive control)", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(skipsAirtableShadow("updateX", REC, true)).toBe(false);
    expect(log).not.toHaveBeenCalled();
    expect(skipsAirtableShadow("updateX", SITE, true)).toBe(true);
    expect(log).toHaveBeenCalledWith(
      `AIRTABLE_SHADOW skipped=non-rec-id writer=updateX id=${SITE}`,
    );
  });

  it("a writer with no record id logs the reason without one", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(airtableShadowOff("writeDigestState", undefined, false)).toBe(true);
    expect(log).toHaveBeenCalledWith("AIRTABLE_SHADOW skipped=shadow-off writer=writeDigestState");
    expect(airtableShadowOff("writeDigestState", undefined, true)).toBe(false);
  });
});

type Call = (base: FakeAirtableBase) => Promise<unknown>;

const WEBSITE_WRITERS: Record<string, Call> = {
  updateScores: (b) =>
    websites.updateScores(b, REC, { performance: 1, accessibility: 1, bestPractices: 1, seo: 1 }),
  updateAnalyticsHealth: (b) => websites.updateAnalyticsHealth(b, REC, "2026-09-28T00:00:00.000Z"),
  updateA11yCounts: (b) => websites.updateA11yCounts(b, REC, { violations: 0 }),
  updateDepsCounts: (b) =>
    websites.updateDepsCounts(b, REC, {
      drifted: 0,
      majorBehind: 0,
      outdated: 0,
      majorOutdated: 0,
    }),
  updateSecurityCounts: (b) =>
    websites.updateSecurityCounts(b, REC, { critical: 0, high: 0, moderate: 0, low: 0 }),
  updateAutoFixAttempts: (b) => websites.updateAutoFixAttempts(b, REC, 1),
  updateNextDueDates: (b) =>
    websites.updateNextDueDates(b, REC, { maintenanceAt: "2026-10-01", testingAt: null }),
  updateSiteField: (b) => websites.updateSiteField(b, REC, "Name", "Acme"),
  updateSiteFields: (b) => websites.updateSiteFields(b, REC, { Name: "Acme" }),
  updateAuditFields: (b) => websites.updateAuditFields(b, REC, { a11y: { violations: 1 } }),
  updateAuditFieldSet: (b) => websites.updateAuditFieldSet(b, REC, { "A11y Violations": 1 }),
  updateGitHubSignals: (b) =>
    websites.updateGitHubSignals(b, REC, {
      renovateFailingCis: 0,
      ciState: "success",
      lastCommitAt: null,
      sweptAt: "2026-09-28T00:00:00.000Z",
    }),
  updatePrismicModels: (b) =>
    websites.updatePrismicModels(b, REC, {
      verdict: "pass",
      checkedAt: "2026-09-28T00:00:00.000Z",
      detail: null,
    }),
  updateLaunched: (b) => websites.updateLaunched(b, REC, "2026-09-28T00:00:00.000Z"),
};

const REPORT_WRITERS: Record<string, Call> = {
  setDraftReady: (b) => reports.setDraftReady(b, REC, true),
  updateReportCommentary: (b) => reports.updateReportCommentary(b, REC, "hello"),
  stampSent: (b) => reports.stampSent(b, REC, new Date("2026-09-28T00:00:00.000Z"), "msg_1"),
  setDeliveryStatus: (b) => reports.setDeliveryStatus(b, REC, "delivered"),
};

describe("with the switch off, no writer reaches Airtable for a rec id", () => {
  it("covers every exported Websites update* writer", () => {
    const exported = Object.entries(websites)
      .filter(([name, v]) => typeof v === "function" && /^update/.test(name))
      .map(([name]) => name)
      .sort();
    expect(Object.keys(WEBSITE_WRITERS).sort()).toEqual(exported);
  });

  for (const [name, call] of Object.entries({ ...WEBSITE_WRITERS, ...REPORT_WRITERS })) {
    it(name, async () => {
      vi.spyOn(console, "log").mockImplementation(() => {});
      const base = makeFakeBase({
        Websites: [{ id: REC, fields: {} }],
        Reports: [{ id: REC, fields: {} }],
      });
      await call(base);
      expect(base.__calls).toEqual([]);
    });
  }

  it("the FieldSet writers still return their payload for the Turso write", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const base = makeFakeBase();
    expect(await websites.updateLaunched(base, REC, "2026-09-28T00:00:00.000Z")).toEqual(
      websites.launchedFields("2026-09-28T00:00:00.000Z"),
    );
    expect(await websites.updateAutoFixAttempts(base, REC, 3)).toEqual(
      websites.autoFixAttemptsFields(3),
    );
  });

  it("uploadAttachment makes no request", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await uploadAttachment(REC, "Header image", "x", "h.png", "image/png", {
      replaceIn: "Websites",
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("the digest-state shadow makes no request and says it did not write", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const base = makeFakeBase();
    expect(await writeDigestState(base, { version: 1, keys: [] } as never)).toBe(false);
    expect(base.__calls).toEqual([]);
  });
});
