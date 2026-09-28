/** The Phase 3 dual-write lockstep (#539): every column the audit
 *  field builders can emit must resolve through the importer's healthColumnFor,
 *  or mirrorHealthFields throws at runtime and that writer's mirror
 *  silently degrades to mirror_failed on every site. Proven here at build time
 *  by exercising the REAL builders (auditFields / gitHubSignalsFields with every
 *  slice populated) rather than a hand-copied column list.
 */
import { describe, it, expect } from "vitest";
import {
  auditFields,
  gitHubSignalsFields,
  nextDueDatesFields,
} from "../../src/reports/airtable/websites.js";
import { healthColumnFor, scheduleColumnFor } from "../../src/db/import-airtable.js";
import {
  makeHealthMirrorBestEffort,
  makeScheduleMirrorBestEffort,
} from "../../src/audits/health-mirror.js";
import { openDb, type Db } from "../../src/db/client.js";
import { mirrorSiteInsert } from "../../src/db/fleet-state.js";

async function seededDb(): Promise<Db> {
  const db = await openDb({ url: ":memory:" });
  await mirrorSiteInsert(
    db,
    { id: "recA", fields: { Name: "Acme Co" } },
    "2026-08-24T12:00:00.000Z",
  );
  return db;
}

describe("every audit-writer column is importer-claimed (dual-write lockstep)", () => {
  it("auditFields with EVERY slice populated emits only healthColumnFor-resolvable keys", () => {
    const fields = auditFields({
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

  it("gitHubSignalsFields emits only claimed keys", () => {
    const fields = gitHubSignalsFields({
      renovateFailingCis: 1,
      ciState: "success",
      lastCommitAt: "2026-08-21T12:00:00.000Z",
      sweptAt: "2026-08-24T07:20:00.000Z",
    });
    expect(Object.keys(fields)).toHaveLength(4);
    for (const key of Object.keys(fields)) {
      expect(healthColumnFor(key), `unclaimed github-signals column '${key}'`).not.toBeNull();
    }
  });

  it("nextDueDatesFields emits only schedule-claimed keys", () => {
    const fields = nextDueDatesFields({
      maintenanceAt: "2026-09-01",
      testingAt: null,
    });
    expect(Object.keys(fields)).toHaveLength(2);
    for (const key of Object.keys(fields)) {
      expect(scheduleColumnFor(key), `unclaimed next-due column '${key}'`).not.toBeNull();
    }
  });
});

describe("makeHealthMirrorBestEffort", () => {
  it("returns null (and does not throw) when libSQL cannot open", async () => {
    // `false` pinned explicitly, not inherited from the shipped constant:
    // these assert the PRE-freeze contract, so the freeze commit must not turn
    // them red for a reason unrelated to what they claim (#612).
    const mirror = await makeHealthMirrorBestEffort(async () => {
      throw new Error("no creds");
    }, false);
    expect(mirror).toBeNull();
  });

  it("mirrors into the opened db end-to-end", async () => {
    const db = await seededDb();
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
      }, false),
    ).toBeNull();
    const db = await seededDb();
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
