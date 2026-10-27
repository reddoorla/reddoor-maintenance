/**
 * #911, writer to verdict. The unit tests in auto-tick.test.ts hand `cmsEvidence` a row
 * already shaped the way it wants. This file makes the row the way production does: the two
 * nightly writers' real field output (`/health` via `functionHealthResultFromAudit` →
 * `auditFields`, and the Prismic sweep via `sweepRowWriteback` → `prismicModelsFields`) is
 * stored through `mirrorHealthFields` into an in-memory Turso, read back by `getSiteById`,
 * and only then judged. A writer that stopped storing the blank verdict as NULL, a coercer
 * that turned it into something else, or a reader that dropped the stamp breaks it here.
 */
import { describe, it, expect } from "vitest";
import { openDb } from "../../src/db/client.js";
import { getSiteById, mirrorHealthFields, mirrorSiteInsert } from "../../src/db/fleet-state.js";
import { auditFields, prismicModelsFields } from "../../src/fleet/site-fields.js";
import { functionHealthResultFromAudit } from "../../src/audits/function-health-fields.js";
import { sweepRowWriteback, type SweepRow } from "../../src/cli/commands/prismic-models.js";
import { autoTickChecklist } from "../../src/reports/auto-tick.js";

const NOW = new Date("2026-10-05T09:23:00.000Z");
const HEALTH_AT = "2026-10-05T08:05:00.000Z";
const SWEEP_AT = "2026-10-05T05:10:00.000Z";
const CMS = "Maint: CMS Checked";

async function siteAfterNightlies(opts: {
  prismic: "ok" | "error" | "skipped";
  sweep: Pick<SweepRow, "status" | "clean" | "detail">;
}) {
  const db = await openDb({ url: ":memory:" });
  // Seeded with YESTERDAY's verdicts from when it looked like a Prismic site, so the test
  // also proves tonight's writes overwrite them rather than leaving them standing.
  await mirrorSiteInsert(
    db,
    {
      id: "recLAHI",
      fields: {
        Name: "LA Homelessness Initiative",
        Status: "maintained",
        "CMS Reachable": "pass",
        "Prismic Models": "pass",
        "Prismic Models Checked At": "2026-09-01T00:00:00.000Z",
      },
    },
    NOW.toISOString(),
  );

  const health = functionHealthResultFromAudit({
    audit: "function-health",
    site: "la-homelessness-initiative",
    status: "pass",
    summary: `health ok (prismic ${opts.prismic})`,
    details: {
      ok: opts.prismic !== "error",
      prismic: opts.prismic,
      forms: null,
      checkedAt: HEALTH_AT,
    },
  });
  await mirrorHealthFields(db, "recLAHI", auditFields({ functionHealth: health }));

  const row: SweepRow = {
    site: "la-homelessness-initiative",
    repositoryName: null,
    commit: null,
    ...opts.sweep,
  };
  await mirrorHealthFields(db, "recLAHI", prismicModelsFields(sweepRowWriteback(row, SWEEP_AT)));

  const site = await getSiteById(db, "recLAHI");
  await db.destroy();
  return site!;
}

const cms = (site: Awaited<ReturnType<typeof siteAfterNightlies>>) =>
  autoTickChecklist(site, "Maintenance", NOW, {
    search: { value: null, softFailed: false, notConfigured: false },
  }).get(CMS)!;

const SKIPPED = {
  status: "skipped",
  clean: null,
  detail: "not a Prismic site (no repositoryName) — skipped",
} as const;

describe("CMS Checked through the real nightly writers and the Turso row (#911)", () => {
  it("/health 'skipped' + sweep 'skipped' → stored NULL + fresh stamp → n/a on the sweep's stamp", async () => {
    const site = await siteAfterNightlies({ prismic: "skipped", sweep: SKIPPED });
    expect(site.cmsReachable).toBeNull();
    expect(site.prismicModels).toBeNull();
    expect(site.prismicModelsCheckedAt).toBe(SWEEP_AT);
    const e = cms(site);
    expect(e.result).toBe("n/a");
    expect(e.checkedAt).toBe(SWEEP_AT);
  });

  it("/health 'skipped' + a sweep that FAILED → stored `unknown` → stays unknown", async () => {
    const site = await siteAfterNightlies({
      prismic: "skipped",
      sweep: { status: "failed", clean: null, detail: "git clone failed" },
    });
    expect(site.prismicModels).toBe("unknown");
    expect(cms(site).result).toBe("unknown");
  });

  it("/health 'ok' + sweep 'skipped' (the data-dynamiq shape) → pass", async () => {
    expect(cms(await siteAfterNightlies({ prismic: "ok", sweep: SKIPPED })).result).toBe("pass");
  });
});
