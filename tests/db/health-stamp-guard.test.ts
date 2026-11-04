/**
 * reddoorla/reddoor-maintenance#1886: a site re-test and a fleet-lighthouse sweep can both
 * write one site's row. The sweep audits every site in turn and writes at its end, so its
 * measurement of site X can be older than a re-test that landed in between. Each stamped
 * set is written only when the stored stamp is not newer than the patch's.
 */
import { describe, it, expect } from "vitest";
import { openDb } from "../../src/db/client.js";
import { getSiteBySlug, mirrorHealthFields, mirrorSiteInsert } from "../../src/db/fleet-state.js";
import { auditFields } from "../../src/fleet/site-fields.js";
import { runFleetWriteBack } from "../../src/cli/commands/audit.js";
import { websiteRowsFrom } from "../_helpers/raw-rows.js";
import type { AuditResult } from "../../src/types.js";

const SWEEP_MEASURED = "2026-11-03T06:10:00.000Z"; // the sweep reached X early
const RETEST = "2026-11-03T06:40:00.000Z"; // the re-test, mid-sweep
const LATER = "2026-11-04T06:10:00.000Z"; // the next night

async function site() {
  const db = await openDb({ url: ":memory:" });
  await mirrorSiteInsert(
    db,
    { id: "recX", fields: { Name: "Xeno", Status: "maintenance" } },
    "2026-11-01T00:00:00.000Z",
  );
  return db;
}

const browser = (linksOk: boolean, at: string) => ({
  "Links OK": linksOk,
  "Broken links": linksOk ? 0 : 3,
  "Browser checked at": at,
});

describe("the stamp guard on mirrorHealthFields", () => {
  it("a sweep's older fail, written after a re-test's newer pass, leaves the pass", async () => {
    const db = await site();
    await mirrorHealthFields(db, "recX", browser(true, RETEST));
    await expect(mirrorHealthFields(db, "recX", browser(false, SWEEP_MEASURED))).resolves.toBe(
      true,
    );
    const r = (await getSiteBySlug(db, "xeno"))!;
    expect(r.linksOk).toBe(true);
    expect(r.brokenLinks).toBe(0);
    expect(r.browserCheckedAt).toBe(RETEST);
  });

  it("a newer measurement still overwrites (the control), in either order", async () => {
    const db = await site();
    await mirrorHealthFields(db, "recX", browser(true, RETEST));
    await mirrorHealthFields(db, "recX", browser(false, LATER));
    const r = (await getSiteBySlug(db, "xeno"))!;
    expect(r.linksOk).toBe(false);
    expect(r.browserCheckedAt).toBe(LATER);
  });

  it("each stamped set is guarded on its own stamp", async () => {
    const db = await site();
    await mirrorHealthFields(db, "recX", {
      ...browser(true, RETEST),
      "Cert days remaining": 40,
      "Domain checked at": SWEEP_MEASURED,
    });
    // One patch: an older browser reading and a newer domain reading.
    await mirrorHealthFields(db, "recX", {
      ...browser(false, SWEEP_MEASURED),
      "Cert days remaining": 39,
      "Domain checked at": RETEST,
      "Smoke OK": "pass",
    });
    const r = (await getSiteBySlug(db, "xeno"))!;
    expect(r.linksOk).toBe(true);
    expect(r.certDaysRemaining).toBe(39);
    expect(r.domainCheckedAt).toBe(RETEST);
    expect(r.smokeOk).toBe("pass"); // an unstamped column is written as before
  });

  it("Lighthouse scores carry their measurement's stamp, not the write's", async () => {
    expect(
      auditFields({
        scores: { performance: 50, accessibility: 90, bestPractices: 90, seo: 90 },
        lighthouseCheckedAt: SWEEP_MEASURED,
      })["Last lighthouse audit at"],
    ).toBe(SWEEP_MEASURED);

    const fields: Array<Record<string, unknown>> = [];
    const lh: AuditResult = {
      audit: "lighthouse",
      site: "xeno",
      status: "fail",
      summary: "",
      details: {
        summary: { performance: 0.5, accessibility: 0.9, "best-practices": 0.9, seo: 0.9 },
        checkedAt: SWEEP_MEASURED,
      },
    };
    await runFleetWriteBack({
      results: [lh],
      which: ["lighthouse"],
      expectedSites: ["xeno"],
      rollup: false,
      deps: {
        roster: async () =>
          websiteRowsFrom([{ id: "recX", fields: { Name: "Xeno", Status: "maintenance" } }]),
        makeMirror: async () => async (_id: string, f: Record<string, unknown>) => {
          fields.push(f);
          return true;
        },
        recordEvents: async () => {},
      },
    });
    expect(fields[0]?.["Last lighthouse audit at"]).toBe(SWEEP_MEASURED);

    // And so the sweep's older scores lose to a re-test's newer ones.
    const db = await site();
    await mirrorHealthFields(db, "recX", { rScore: 95, "Last lighthouse audit at": RETEST });
    await mirrorHealthFields(db, "recX", fields[0]!);
    const r = (await getSiteBySlug(db, "xeno"))!;
    expect(r.rScore).toBe(95);
    expect(r.lastLighthouseAuditAt).toBe(RETEST);
  });
});
