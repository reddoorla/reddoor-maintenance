/** The Phase 3 dual-write lockstep (#539): every Airtable column the audit
 *  field builders can emit must resolve through the importer's healthColumnFor,
 *  or mirrorHealthFields throws at runtime and that writer's dual-write
 *  silently degrades to mirror_failed on every site. Proven here at build time
 *  by exercising the REAL builders (via updateAuditFields / updateGitHubSignals
 *  with every slice populated) rather than a hand-copied column list.
 */
import { describe, it, expect } from "vitest";
import {
  updateAuditFields,
  updateGitHubSignals,
  updateNextDueDates,
} from "../../src/reports/airtable/websites.js";
import { healthColumnFor, scheduleColumnFor } from "../../src/db/import-airtable.js";
import {
  makeHealthMirrorBestEffort,
  makeScheduleMirrorBestEffort,
} from "../../src/audits/health-mirror.js";
import { makeFakeBase } from "../reports/_helpers/fake-airtable-base.js";
import { openDb } from "../../src/db/client.js";
import { importFleetState, type ImportIo } from "../../src/db/import-airtable.js";

const base = () => makeFakeBase({ Websites: [{ id: "recA", fields: { Name: "Acme Co" } }] });

describe("every audit-writer column is importer-claimed (dual-write lockstep)", () => {
  it("updateAuditFields with EVERY slice populated emits only healthColumnFor-resolvable keys", async () => {
    const fields = await updateAuditFields(base(), "recA", {
      scores: { performance: 98, accessibility: null, bestPractices: 96, seo: 92 },
      a11y: { violations: 0 },
      deps: { drifted: 2, majorBehind: 1, outdated: 3, majorOutdated: 0 },
      security: { critical: 0, high: 0, moderate: 1, low: 2 },
      securityAdvisories: [
        { module: "left-pad", severity: "moderate", title: "x", cves: [], url: null },
      ],
      domain: { certDaysRemaining: null, checkedAt: "2026-08-24T06:00:00.000Z" },
      browser: {
        desktopOk: true,
        mobileOk: false,
        linksOk: true,
        reachableOk: true,
        titleMetaOk: false,
        brokenLinks: 0,
        checkedAt: "2026-08-24T06:30:00.000Z",
      },
      netlifyDeploy: {
        state: null,
        deployedAt: null,
        logUrl: null,
        checkedAt: "2026-08-24T06:10:00.000Z",
      },
      functionHealth: {
        functionHealth: "pass",
        cmsReachable: null,
        turnstileWidget: "fail",
        checkedAt: "2026-08-24T06:20:00.000Z",
      },
      smoke: { ok: "pass", checkedAt: "2026-08-24T07:00:00.000Z" },
      formE2e: { ok: null, checkedAt: "2026-08-24T07:10:00.000Z" },
    });
    expect(Object.keys(fields).length).toBeGreaterThanOrEqual(25);
    for (const key of Object.keys(fields)) {
      expect(healthColumnFor(key), `unclaimed audit column '${key}'`).not.toBeNull();
    }
  });

  it("updateGitHubSignals returns the FieldSet it wrote, and every key is claimed", async () => {
    const b = base();
    const fields = await updateGitHubSignals(b, "recA", {
      renovateFailingCis: 1,
      ciState: "success",
      lastCommitAt: "2026-08-21T12:00:00.000Z",
      sweptAt: "2026-08-24T07:20:00.000Z",
    });
    // Return value IS the written payload — the mirror consumes it verbatim.
    const update = b.__calls.find((c) => c.kind === "update");
    expect(update?.records[0]?.fields).toEqual(fields);
    for (const key of Object.keys(fields)) {
      expect(healthColumnFor(key), `unclaimed github-signals column '${key}'`).not.toBeNull();
    }
  });

  it("updateNextDueDates returns the FieldSet it wrote, and every key is schedule-claimed", async () => {
    const b = base();
    const fields = await updateNextDueDates(b, "recA", {
      maintenanceAt: "2026-09-01",
      testingAt: null,
    });
    const update = b.__calls.find((c) => c.kind === "update");
    expect(update?.records[0]?.fields).toEqual(fields);
    for (const key of Object.keys(fields)) {
      expect(scheduleColumnFor(key), `unclaimed next-due column '${key}'`).not.toBeNull();
    }
  });
});

describe("makeHealthMirrorBestEffort", () => {
  it("returns null (and does not throw) when libSQL cannot open", async () => {
    const mirror = await makeHealthMirrorBestEffort(async () => {
      throw new Error("no creds");
    });
    expect(mirror).toBeNull();
  });

  it("mirrors into the opened db end-to-end", async () => {
    const db = await openDb({ url: ":memory:" });
    const io: ImportIo = {
      listWebsiteRecords: async () => [{ id: "recA", fields: { Name: "Acme Co" } }],
      listReportRecords: async () => [],
      fetchAttachment: async () => null,
      now: () => new Date("2026-08-24T12:00:00.000Z"),
    };
    await importFleetState(db, io);
    const mirror = await makeHealthMirrorBestEffort(async () => db);
    expect(mirror).not.toBeNull();
    await mirror!("recA", { "Smoke OK": "pass" });
    const row = await db
      .selectFrom("site_health")
      .select("smoke_ok")
      .where("site_id", "=", "recA")
      .executeTakeFirstOrThrow();
    expect(row.smoke_ok).toBe("pass");
  });

  it("the schedule twin: null without creds, mirrors end-to-end with one", async () => {
    expect(
      await makeScheduleMirrorBestEffort(async () => {
        throw new Error("no creds");
      }),
    ).toBeNull();
    const db = await openDb({ url: ":memory:" });
    const io: ImportIo = {
      listWebsiteRecords: async () => [{ id: "recA", fields: { Name: "Acme Co" } }],
      listReportRecords: async () => [],
      fetchAttachment: async () => null,
      now: () => new Date("2026-08-24T12:00:00.000Z"),
    };
    await importFleetState(db, io);
    const mirror = await makeScheduleMirrorBestEffort(async () => db);
    await mirror!("recA", { "Next maintenance at": "2026-09-01" }, "2026-08-24T09:23:00.000Z");
    const row = await db
      .selectFrom("site_schedule")
      .selectAll()
      .where("site_id", "=", "recA")
      .executeTakeFirstOrThrow();
    expect(row.next_maintenance_at).toBe("2026-09-01");
    expect(row.computed_at).toBe("2026-08-24T09:23:00.000Z");
  });
});
