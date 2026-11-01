/**
 * P1-88: re-test one failing site during the day. These pin, end to end through the
 * seams production uses:
 *   - the plan: only the audits behind the site's current reasons (the /s/<slug> list);
 *   - the closed set: no command line or button can widen a re-test to security/deps;
 *   - one site: the `--site` filter, the command's audit call, and the write-back,
 *     which writes that site's row and no other, and records no fleet-wide rollup;
 *   - a pass clears at once: the reason is gone as soon as the row carries the pass;
 *   - the cockpit: the button shows only when there is something to re-test, and its
 *     trigger dispatches site-retest.yml with the site's slug and nothing else.
 */
import { describe, it, expect } from "vitest";
import {
  RETESTABLE_AUDITS,
  RETEST_AUDIT_BY_PREFIX,
  parseRetestOnly,
  retestPlanFromItems,
  assertRetestSlug,
  SITE_RETEST_WORKFLOW,
} from "../../src/retest/site-retest.js";
import { filterSitesBySlug, runFleetWriteBack } from "../../src/cli/commands/audit.js";
import { runSiteRetestCommand } from "../../src/cli/commands/site-retest.js";
import { triggerSiteRetest } from "../../src/dashboard/site-retest-trigger.js";
import { buildSiteAlarmContext } from "../../src/dashboard/fleet-cockpit.js";
import { buildSiteView } from "../../cockpit/src/lib/site/view.js";
import type { AuditCommandOptions } from "../../src/cli/commands/audit.js";
import type { AuditResult, Site } from "../../src/types.js";
import type { FleetEvent } from "../../src/db/fleet-events.js";
import type { WebsiteRow } from "../../src/fleet/site-row.js";
import { makeWebsiteRow } from "../_helpers/website-row.js";
import { websiteRowsFrom } from "../_helpers/raw-rows.js";

const NOW = new Date("2026-11-01T18:00:00.000Z");
const FRESH = "2026-11-01T06:30:00.000Z";

const row = (over: Partial<WebsiteRow> = {}): WebsiteRow =>
  makeWebsiteRow({ id: "recS", name: "Sonder", status: "maintained", ...over });

/** Two broken links and a certificate 20 days from expiry: a browser and a domain reason. */
const linksAndCert: Partial<WebsiteRow> = {
  linksOk: false,
  brokenLinks: 2,
  browserCheckedAt: FRESH,
  certDaysRemaining: 20,
  domainCheckedAt: FRESH,
};

const itemsOf = (r: WebsiteRow) => buildSiteAlarmContext(r, [], "", NOW).items;

describe("the plan: only the audits behind the site's current reasons", () => {
  it("links and cert re-run browser and domain, nothing else", () => {
    const plan = retestPlanFromItems(itemsOf(row(linksAndCert)));
    expect(plan.audits).toEqual(["browser", "domain"]);
    expect(plan.reasons.map((r) => [r.key.split(":")[0], r.audit])).toEqual(
      expect.arrayContaining([
        ["links", "browser"],
        ["cert", "domain"],
      ]),
    );
  });

  it("each production reason maps to the audit that writes it", () => {
    const every: Partial<WebsiteRow> = {
      reachableOk: "fail",
      crossbrowserOk: false,
      mobileOk: false,
      linksOk: false,
      brokenLinks: 1,
      titleMetaOk: "fail",
      browserCheckedAt: FRESH,
      certDaysRemaining: null,
      domainCheckedAt: FRESH,
      functionHealth: "fail",
      cmsReachable: "pass",
      functionHealthCheckedAt: FRESH,
      deployStatus: "error",
      pScore: 40,
    };
    const plan = retestPlanFromItems(itemsOf(row(every)));
    const byPrefix = Object.fromEntries(plan.reasons.map((r) => [r.key.split(":")[0], r.audit]));
    expect(byPrefix).toEqual({
      uptime: "browser",
      render: "browser",
      links: "browser",
      titles: "browser",
      domain: "domain",
      "function-health": "function-health",
      deploy: "netlify-deploy",
      lighthouse: "lighthouse",
    });
    expect(plan.audits).toEqual([...RETESTABLE_AUDITS]);
  });

  it("a reason no re-test can clear is named as untouched and runs nothing", () => {
    const plan = retestPlanFromItems(
      itemsOf(
        row({
          a11yViolations: 3,
          a11yRoutesScanned: 2,
          a11yRoutesTotal: 2,
          a11yCheckedAt: FRESH,
          securityVulnsCritical: 1,
        }),
      ),
    );
    expect(plan.audits).toEqual([]);
    expect(plan.untouched.length).toBeGreaterThan(0);
  });

  it("a healthy site has nothing to re-test", () => {
    expect(retestPlanFromItems(itemsOf(row())).audits).toEqual([]);
  });
});

describe("the closed set: a re-test never widens to security, deps or a11y (P0-1)", () => {
  it.each(["security", "deps", "a11y", "lint", "smoke", "browser,security"])(
    "--only %s is refused with exit code 2",
    (only) => {
      expect(() => parseRetestOnly(only)).toThrow(/refused/);
      try {
        parseRetestOnly(only);
      } catch (e) {
        expect((e as { exitCode?: number }).exitCode).toBe(2);
      }
    },
  );

  it("no re-testable audit and no mapped reason is security or deps", () => {
    const forbidden = ["security", "deps", "a11y"];
    for (const a of RETESTABLE_AUDITS) expect(forbidden).not.toContain(a);
    for (const a of Object.values(RETEST_AUDIT_BY_PREFIX)) expect(forbidden).not.toContain(a);
  });

  it("a valid --only is kept in run order; blank is the plan", () => {
    expect(parseRetestOnly("lighthouse, browser")).toEqual(["browser", "lighthouse"]);
    expect(parseRetestOnly("")).toBeNull();
    expect(parseRetestOnly(undefined)).toBeNull();
  });

  it("a slug that is not the roster's shape is refused before anything runs", () => {
    for (const bad of ["", "Sonder", "a b", "../x", "x;rm", "-x"])
      expect(() => assertRetestSlug(bad)).toThrow(/not a site slug/);
    expect(assertRetestSlug("sonder-co")).toBe("sonder-co");
  });
});

describe("one site: the fleet --site filter", () => {
  const sites: Site[] = ["acme", "sonder", "vida"].map((name) => ({ name, path: `/w/${name}` }));

  it("keeps the named site only", () => {
    expect(filterSitesBySlug(sites, "sonder").map((s) => s.name)).toEqual(["sonder"]);
  });

  it("a slug not on the active roster is a usage error, not a clean empty run", () => {
    expect(() => filterSitesBySlug(sites, "gone")).toThrow(/no active fleet site/);
  });
});

describe("one site: the write-back writes that row alone and no fleet rollup", () => {
  const websites = websiteRowsFrom([
    { id: "recA", fields: { Name: "Acme", Status: "maintenance" } },
    { id: "recS", fields: { Name: "Sonder", Status: "maintenance" } },
    { id: "recV", fields: { Name: "Vida", Status: "maintenance" } },
  ]);
  const lh = (site: string): AuditResult => ({
    audit: "lighthouse",
    site,
    status: "pass",
    summary: "",
    details: { summary: { performance: 0.9, accessibility: 1, "best-practices": 0.9, seo: 0.9 } },
  });

  async function writeBack(rollup: boolean | undefined) {
    const mirrored: string[] = [];
    const events: FleetEvent[] = [];
    const res = await runFleetWriteBack({
      results: [lh("sonder")],
      which: ["lighthouse"],
      expectedSites: ["sonder"],
      ...(rollup === undefined ? {} : { rollup }),
      deps: {
        roster: async () => websites,
        makeMirror: async () => async (siteId: string) => {
          mirrored.push(siteId);
          return true;
        },
        recordEvents: async (ev) => {
          events.push(...ev);
        },
      },
    });
    return { res, mirrored, events };
  }

  it("mirrors the re-tested site's row and leaves the other rows untouched", async () => {
    const { res, mirrored } = await writeBack(false);
    expect(mirrored).toEqual(["recS"]);
    expect(res.anyFailed).toBe(false);
    expect(res.summary).toContain("wrote=1 failed=0 total=1");
  });

  it("a re-test records no fleet_swept rollup; a sweep still does (the control)", async () => {
    expect((await writeBack(false)).events.some((e) => e.type === "fleet_swept")).toBe(false);
    expect((await writeBack(undefined)).events.some((e) => e.type === "fleet_swept")).toBe(true);
  });
});

describe("the command: plan, run one site, read back, report", () => {
  function harness(before: WebsiteRow[], after: WebsiteRow[]) {
    const calls: AuditCommandOptions[] = [];
    let reads = 0;
    return {
      calls,
      deps: {
        now: () => NOW,
        readRoster: async () => (reads++ === 0 ? before : after),
        runAudit: async (o: AuditCommandOptions) => {
          calls.push(o);
          return { output: "FLEET_WRITE_SUMMARY wrote=1 failed=0 total=1", writeBackFailed: false };
        },
      },
    };
  }
  const other = makeWebsiteRow({
    id: "recV",
    name: "Vida",
    status: "maintained",
    ...linksAndCert,
  });

  it("runs only the plan's audits, for this site, as a re-test, and reports a pass cleared", async () => {
    const h = harness(
      [row(linksAndCert), other],
      [row({ ...linksAndCert, linksOk: true, brokenLinks: 0 }), other],
    );
    const { output, code } = await runSiteRetestCommand("sonder", {}, h.deps);
    expect(code).toBe(0);
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0]).toMatchObject({
      fleet: "turso",
      site: "sonder",
      only: "browser,domain",
      writeBack: true,
      retest: true,
    });
    expect(output).toContain("RETEST site=sonder audits=browser,domain");
    expect(output).toContain("cleared: 2 broken links");
    expect(output).toContain("still failing: TLS certificate expires in 20 days");
    expect(output).toContain("RETEST_RESULT site=sonder cleared=1 still=1 write=ok");
  });

  it("nothing to re-test: no audit runs, exit 0", async () => {
    const h = harness([row()], [row()]);
    const { output, code } = await runSiteRetestCommand("sonder", {}, h.deps);
    expect(h.calls).toEqual([]);
    expect(code).toBe(0);
    expect(output).toContain("nothing to re-test for sonder");
  });

  it("--dry-run prints the plan and runs nothing", async () => {
    const h = harness([row(linksAndCert)], [row(linksAndCert)]);
    const { output } = await runSiteRetestCommand("sonder", { dryRun: true }, h.deps);
    expect(h.calls).toEqual([]);
    expect(output).toContain("audits=browser,domain");
  });

  it("a failed write reds the run; a failing verdict alone does not", async () => {
    const h = harness([row(linksAndCert)], [row(linksAndCert)]);
    const failing = {
      ...h.deps,
      runAudit: async () => ({ output: "", writeBackFailed: true }),
    };
    expect((await runSiteRetestCommand("sonder", {}, failing)).code).toBe(1);
    const h2 = harness([row(linksAndCert)], [row(linksAndCert)]);
    expect((await runSiteRetestCommand("sonder", {}, h2.deps)).code).toBe(0);
  });

  it("an unknown slug is exit 2, and --only security is refused before the roster is read", async () => {
    const h = harness([row()], [row()]);
    await expect(runSiteRetestCommand("nobody", {}, h.deps)).rejects.toMatchObject({
      exitCode: 2,
    });
    let read = false;
    await expect(
      runSiteRetestCommand(
        "sonder",
        { only: "security" },
        {
          ...h.deps,
          readRoster: async () => {
            read = true;
            return [];
          },
        },
      ),
    ).rejects.toMatchObject({ exitCode: 2 });
    expect(read).toBe(false);
  });
});

describe("the cockpit: button and trigger", () => {
  it("the trigger dispatches site-retest.yml with the site's slug as its only input", async () => {
    const dispatched: Array<{ workflow: string; inputs: Record<string, string> }> = [];
    const res = await triggerSiteRetest(
      {
        now: () => NOW,
        getSite: async () => row(linksAndCert),
        dispatch: async (workflow, inputs) => {
          dispatched.push({ workflow, inputs });
        },
      },
      "sonder",
    );
    expect(res).toMatchObject({
      status: "dispatched",
      site: "sonder",
      audits: ["browser", "domain"],
    });
    expect(dispatched).toEqual([{ workflow: SITE_RETEST_WORKFLOW, inputs: { site: "sonder" } }]);
  });

  it("the trigger dispatches nothing for a healthy site, a missing site, or a bad slug", async () => {
    const dispatched: string[] = [];
    const deps = (site: WebsiteRow | null) => ({
      now: () => NOW,
      getSite: async () => site,
      dispatch: async (w: string) => {
        dispatched.push(w);
      },
    });
    expect((await triggerSiteRetest(deps(row()), "sonder")).status).toBe("nothing-to-retest");
    expect((await triggerSiteRetest(deps(null), "sonder")).status).toBe("not-found");
    expect((await triggerSiteRetest(deps(row(linksAndCert)), "x;y")).status).toBe("bad-slug");
    expect(dispatched).toEqual([]);
  });

  it("a dispatch failure comes back as failed, never thrown", async () => {
    const res = await triggerSiteRetest(
      {
        now: () => NOW,
        getSite: async () => row(linksAndCert),
        dispatch: async () => {
          throw new Error("403");
        },
      },
      "sonder",
    );
    expect(res).toEqual({ status: "failed", slug: "sonder", error: "403" });
  });

  it("the /s/<slug> page offers Re-test only when a reason is re-testable", () => {
    const failing = row(linksAndCert);
    const view = buildSiteView(
      failing,
      [],
      [],
      null,
      NOW,
      buildSiteAlarmContext(failing, [], "", NOW),
    ).alarm!;
    expect(view.retest).toEqual({ url: "/api/sites/sonder/retest", audits: ["browser", "domain"] });

    const a11yOnly = row({
      a11yViolations: 3,
      a11yRoutesScanned: 2,
      a11yRoutesTotal: 2,
      a11yCheckedAt: FRESH,
    });
    const quiet = buildSiteView(
      a11yOnly,
      [],
      [],
      null,
      NOW,
      buildSiteAlarmContext(a11yOnly, [], "", NOW),
    ).alarm!;
    expect(quiet.chips.length).toBeGreaterThan(0);
    expect(quiet.retest).toBeNull();
  });
});
