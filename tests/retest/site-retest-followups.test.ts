/**
 * P1-88's review-round follow-ups (reddoorla/reddoor-maintenance#1887 to #1891), through
 * the seams production uses: the `site-retest` command, the write-back's own account
 * (`runFleetWriteBack`), the cockpit trigger, and `buildSiteView`.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  RETEST_AUDIT_BY_PREFIX,
  retestMeasured,
  retestPlanForRow,
  retestVerdict,
} from "../../src/retest/site-retest.js";
import { runFleetWriteBack } from "../../src/cli/commands/audit.js";
import { runSiteRetestCommand, type SiteRetestDeps } from "../../src/cli/commands/site-retest.js";
import { triggerSiteRetest } from "../../src/dashboard/site-retest-trigger.js";
import { buildSiteAlarmContext } from "../../src/dashboard/fleet-cockpit.js";
import { buildSiteView } from "../../cockpit/src/lib/site/view.js";
import type { AuditCommandOptions } from "../../src/cli/commands/audit.js";
import type { AuditResult } from "../../src/types.js";
import type { FleetWriteResult } from "../../src/audits/write-audits.js";
import type { WebsiteRow } from "../../src/fleet/site-row.js";
import { makeWebsiteRow } from "../_helpers/website-row.js";
import { websiteRowsFrom } from "../_helpers/raw-rows.js";

const NOW = new Date("2026-11-03T22:00:00.000Z");
const FRESH = "2026-11-03T21:00:00.000Z";
const A_DAY_AGO = "2026-11-02T21:00:00.000Z";

const row = (over: Partial<WebsiteRow> = {}): WebsiteRow =>
  makeWebsiteRow({ id: "recS", name: "Sonder", status: "maintained", ...over });

const itemsOf = (r: WebsiteRow) => buildSiteAlarmContext(r, [], "", NOW).items;

/** The command with an injected roster (first read before, then after) and a clean run. */
function harness(before: WebsiteRow[], after: WebsiteRow[], extra: Partial<SiteRetestDeps> = {}) {
  const calls: AuditCommandOptions[] = [];
  let reads = 0;
  const deps: SiteRetestDeps = {
    now: () => NOW,
    readRoster: async () => (reads++ === 0 ? before : after),
    runAudit: async (o: AuditCommandOptions) => {
      calls.push(o);
      return {
        output: "FLEET_WRITE_SUMMARY wrote=1 failed=0 total=1",
        writeBackFailed: false,
        writeResult: { written: [], failed: [] } as FleetWriteResult,
      };
    },
    ...extra,
  };
  return { calls, deps };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("#1891: a certificate that worsened is still failing, never cleared", () => {
  it("8 days left re-tested to 7: no cleared line, both still failing, write=ok, exit 0", async () => {
    // Stored 9, checked a day ago: the cockpit reads 8 (`cert`). The re-test stores 7
    // with a fresh stamp: `cert-expiring`, under another key.
    const before = row({ certDaysRemaining: 9, domainCheckedAt: A_DAY_AGO });
    const after = row({ certDaysRemaining: 7, domainCheckedAt: NOW.toISOString() });
    expect(itemsOf(before).map((i) => i.title)).toEqual(["TLS certificate expires in 8 days"]);
    const h = harness([before], [after]);
    const { output, code } = await runSiteRetestCommand("sonder", {}, h.deps);
    expect(output).not.toContain("cleared:");
    expect(output).toContain("still failing: TLS certificate expires in 8 days");
    expect(output).toContain("still failing: TLS certificate expires in 7 days");
    expect(output).toContain("cleared=0");
    expect(output).toContain("write=ok");
    expect(code).toBe(0);
  });

  it("the verdict follows the collector's lines (#1908's 20 days, and 7)", () => {
    const v = (key: string, days: number | null) =>
      retestVerdict(key, row({ certDaysRemaining: days }));
    expect(v("cert:recS", 21)).toBe("pass");
    expect(v("cert:recS", 20)).toBe("fail");
    expect(v("cert:recS", 7)).toBe("fail");
    expect(v("cert:recS", null)).toBe("fail");
    expect(v("cert-expiring:recS", 8)).toBe("pass");
    expect(v("cert-expiring:recS", 7)).toBe("fail");
    expect(v("domain:recS", 3)).toBe("pass");
    expect(v("domain:recS", null)).toBe("fail");
  });

  it("a certificate that renewed still clears (the control)", async () => {
    const before = row({ certDaysRemaining: 9, domainCheckedAt: A_DAY_AGO });
    const after = row({ certDaysRemaining: 89, domainCheckedAt: NOW.toISOString() });
    const { output, code } = await runSiteRetestCommand(
      "sonder",
      {},
      harness([before], [after]).deps,
    );
    expect(output).toContain("cleared: TLS certificate expires in 8 days");
    expect(code).toBe(0);
  });
});

describe("#1890: a reason that changed key is measured, still failing", () => {
  it("function-health becomes cms: still failing, write=ok, exit 0", async () => {
    const before = row({
      functionHealth: "fail",
      cmsReachable: null,
      functionHealthCheckedAt: FRESH,
    });
    const after = row({
      functionHealth: "fail",
      cmsReachable: "fail",
      functionHealthCheckedAt: NOW.toISOString(),
    });
    const { output, code } = await runSiteRetestCommand(
      "sonder",
      {},
      harness([before], [after]).deps,
    );
    expect(output).toContain("still failing: a server function is erroring (/health failed)");
    expect(output).toContain("still failing: the CMS is unreachable from the site");
    expect(output).not.toContain("not measured:");
    expect(output).toContain("write=ok");
    expect(code).toBe(0);
  });

  it("every prefix the plan maps has a verdict: a passing row reads pass for each", () => {
    const passing = row({
      reachableOk: "pass",
      crossbrowserOk: true,
      mobileOk: true,
      linksOk: true,
      titleMetaOk: "pass",
      certDaysRemaining: 80,
      functionHealth: "pass",
      cmsReachable: "pass",
      deployStatus: "ready",
      pScore: 90,
      rScore: 90,
      bpScore: 90,
      seoScore: 90,
    });
    const keys = Object.keys(RETEST_AUDIT_BY_PREFIX);
    expect(keys.length).toBeGreaterThan(0);
    for (const prefix of keys) {
      expect(retestVerdict(`${prefix}:recS:seo`, passing), prefix).toBe("pass");
    }
  });

  it("a lighthouse verdict reads the collector's table: below the floor fails, null is unmeasured", () => {
    expect(retestVerdict("lighthouse:recS:accessibility", row({ rScore: 60 }))).toBe("fail");
    expect(retestVerdict("lighthouse:recS:accessibility", row({ rScore: 75 }))).toBe("pass");
    expect(retestVerdict("lighthouse:recS:accessibility", row({ rScore: null }))).toBeNull();
    expect(retestVerdict("lighthouse:recS:nope", row({ rScore: 90 }))).toBeNull();
  });
});

describe("#1889: the write-back's account, per audit", () => {
  it("a Lighthouse miss unmeasures lighthouse alone; the site's other audits were written", () => {
    const write: FleetWriteResult = {
      written: [],
      failed: [
        { slug: "sonder", error: "Lighthouse audit produced no scores", audit: "lighthouse" },
      ],
    };
    expect(retestMeasured(write, "sonder", "browser")).toBe(true);
    expect(retestMeasured(write, "sonder", "lighthouse")).toBe(false);
    // An untagged failure still unmeasures everything (the control).
    expect(
      retestMeasured(
        { written: [], failed: [{ slug: "sonder", error: "x" }] },
        "sonder",
        "browser",
      ),
    ).toBe(false);
  });

  it("end to end: real results through runFleetWriteBack, then retestMeasured", async () => {
    const websites = websiteRowsFrom([
      { id: "recS", fields: { Name: "Sonder", Status: "maintenance" } },
    ]);
    const browser: AuditResult = {
      audit: "browser",
      site: "sonder",
      status: "pass",
      summary: "",
      details: {
        desktopOk: true,
        mobileOk: true,
        linksOk: true,
        reachableOk: true,
        titleMetaOk: true,
        brokenLinks: 0,
        checkedAt: FRESH,
      },
    };
    const noScores: AuditResult = {
      audit: "lighthouse",
      site: "sonder",
      status: "fail",
      summary: "no lhr",
      details: { summary: {} },
    };
    const noPat: AuditResult = {
      audit: "netlify-deploy",
      site: "sonder",
      status: "skip",
      summary: "no NETLIFY_PAT",
    };
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const { write } = await runFleetWriteBack({
      results: [browser, noScores, noPat],
      which: ["browser", "lighthouse", "netlify-deploy"],
      expectedSites: ["sonder"],
      rollup: false,
      deps: {
        roster: async () => websites,
        makeMirror: async () => async () => true,
        recordEvents: async () => {},
      },
    });
    err.mockRestore();
    expect(retestMeasured(write, "sonder", "browser")).toBe(true);
    expect(retestMeasured(write, "sonder", "lighthouse")).toBe(false);
    expect(retestMeasured(write, "sonder", "netlify-deploy")).toBe(false);
  });

  it("--only an audit the row cannot measure is refused, exit 2, with the reason, and nothing runs", async () => {
    const h = harness([row({ linksOk: false, browserCheckedAt: FRESH })], []);
    await expect(
      runSiteRetestCommand("sonder", { only: "netlify-deploy" }, h.deps),
    ).rejects.toMatchObject({ exitCode: 2, message: expect.stringContaining("no Netlify id") });
    expect(h.calls).toEqual([]);
  });

  it("--only an audit the row can measure still runs (the control)", async () => {
    const r = row({ linksOk: false, browserCheckedAt: FRESH, netlifyId: "nf-1" });
    const h = harness([r], [r]);
    await runSiteRetestCommand("sonder", { only: "netlify-deploy" }, h.deps);
    expect(h.calls.map((c) => c.only)).toEqual(["netlify-deploy"]);
  });

  it("two roster rows that answer to one slug are refused, exit 2, and nothing runs", async () => {
    const a = row({ id: "recA", name: "Acme", netlifyId: "nf-1", deployStatus: "error" });
    const b = row({ id: "recB", name: "ACME", linksOk: false, browserCheckedAt: FRESH });
    const h = harness([a, b], []);
    await expect(runSiteRetestCommand("acme", {}, h.deps)).rejects.toMatchObject({ exitCode: 2 });
    expect(h.calls).toEqual([]);
  });
});

describe("#1887: a renamed site is found by its stored slug", () => {
  // Stored slug `acme-co`, kept by the rename; the Name now derives `acme-company`.
  const renamed = row({
    id: "recR",
    name: "Acme Company",
    linksOk: false,
    brokenLinks: 1,
    browserCheckedAt: FRESH,
  });
  const storedSlugs = async () => [{ id: "recR", slug: "acme-co" }];

  it("the command takes the stored slug and runs under the roster's", async () => {
    const h = harness([renamed], [renamed], { readStoredSlugs: storedSlugs });
    const { output } = await runSiteRetestCommand("acme-co", {}, h.deps);
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0]).toMatchObject({ site: "acme-company", only: "browser" });
    expect(output).toContain("RETEST site=acme-company");
  });

  it("the Name-derived slug still works", async () => {
    const h = harness([renamed], [renamed], { readStoredSlugs: storedSlugs });
    await runSiteRetestCommand("acme-company", {}, h.deps);
    expect(h.calls).toHaveLength(1);
  });

  it("a stored slug that is another row's Name-derived slug is refused", async () => {
    const other = row({ id: "recO", name: "Acme Co", linksOk: false, browserCheckedAt: FRESH });
    const h = harness([renamed, other], [], { readStoredSlugs: storedSlugs });
    await expect(runSiteRetestCommand("acme-co", {}, h.deps)).rejects.toMatchObject({
      exitCode: 2,
    });
    expect(h.calls).toEqual([]);
  });

  it("the page's action URLs use the stored slug; the submissions link keeps the Name's", () => {
    const ctx = buildSiteAlarmContext(renamed, [], "", NOW);
    const view = buildSiteView(renamed, [], [], null, NOW, ctx, "acme-co");
    expect(view.alarm!.retest!.url).toBe("/api/sites/acme-co/retest");
    expect(view.details.url).toBe("/api/sites/acme-co/details");
    const withRepo = buildSiteView(
      { ...renamed, gitRepo: "reddoorla/acme" },
      [],
      [],
      null,
      NOW,
      ctx,
      "acme-co",
    );
    expect(withRepo.details.triggerUrl).toBe("/api/sites/acme-co/trigger-renovate");
  });

  it("the trigger dispatches the stored slug it was addressed by", async () => {
    const dispatched: Array<Record<string, string>> = [];
    const res = await triggerSiteRetest(
      {
        now: () => NOW,
        getSite: async (s) => (s === "acme-co" ? renamed : null),
        dispatch: async (_w, inputs) => {
          dispatched.push(inputs);
        },
      },
      "acme-co",
    );
    expect(res.status).toBe("dispatched");
    expect(dispatched).toEqual([{ site: "acme-co" }]);
  });
});

describe("#1891: the plan check is quiet on read paths", () => {
  it("a row whose url is not http(s) plans nothing and logs nothing", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const r = row({
      url: "ftp://acme.example.com",
      linksOk: false,
      brokenLinks: 2,
      browserCheckedAt: FRESH,
    });
    const plan = retestPlanForRow(r, itemsOf(r));
    expect(plan.audits).toEqual([]);
    // The reason was planned and then dropped by the roster check, so the check ran.
    expect(plan.untouched).toContain("2 broken links");
    expect(warn).not.toHaveBeenCalled();
  });
});
