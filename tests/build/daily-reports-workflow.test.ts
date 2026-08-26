import { describe, it, expect, beforeAll } from "vitest";
import { readFile } from "node:fs/promises";
import { stepEnv, workflowPath } from "./_helpers/workflow-source.js";

/**
 * `report --due` is a Phase 3 dual-writer: `writeNextDueDates` mirrors every
 * next-due write into `site_schedule` through `makeScheduleMirrorBestEffort`,
 * which resolves its connection from TURSO_DATABASE_URL / TURSO_AUTH_TOKEN.
 *
 * "Best effort" means it returns null when those are absent, and a null mirror
 * writes nothing and throws nothing. So the credentials missing from THIS step
 * does not fail the run, does not warn, and does not change the exit code — the
 * dual-write simply never happens. That is exactly what shipped: the first
 * production run after Phase 3 landed printed
 * `NEXT_DUE_WRITE wrote=1 skipped=43 failed=0` with no mirror counters at all,
 * because the draft step carried Airtable and GA credentials but no Turso ones.
 *
 * The hourly `fleet-db-sync` re-imports site_schedule from Airtable, so nothing
 * visibly broke — which is the whole problem. At the Phase 5 freeze the
 * dual-write becomes the only writer, and a dead one would be discovered by
 * the dates silently ceasing to update.
 */

const DRAFT_STEP = "Draft due reports";
const DIGEST_STEP = "Email the operator digest";

let workflow: string;

beforeAll(async () => {
  workflow = await readFile(workflowPath("daily-reports.yml"), "utf-8");
});

describe("daily-reports workflow", () => {
  it("gives the draft step the Turso credentials its site_schedule dual-write needs", () => {
    const env = stepEnv(workflow, DRAFT_STEP);
    expect(Object.keys(env)).toEqual(
      expect.arrayContaining(["TURSO_DATABASE_URL", "TURSO_AUTH_TOKEN"]),
    );
  });

  it("still gives the draft step the Airtable and GA credentials it already needed", () => {
    // The positive control: proves stepEnv is reading the real block, so the
    // assertion above cannot be passing against an empty or mis-parsed map.
    const env = stepEnv(workflow, DRAFT_STEP);
    expect(Object.keys(env)).toEqual(
      expect.arrayContaining(["AIRTABLE_PAT", "AIRTABLE_BASE_ID", "GA_SA_KEY_JSON"]),
    );
  });

  /**
   * #609 changed what a missing Turso credential COSTS this step. It used to be
   * optional here — notify-bounce counts and submissions telemetry each degrade
   * to an absent section. The digest now reads its own prior-run snapshot from
   * Turso, and that read is deliberately not defensive, so the step fails loudly
   * instead of emailing a digest with every item spuriously badged NEW.
   *
   * Loud beats silent, but only if the credentials are actually there.
   */
  it("gives the digest step the Turso credentials it now REQUIRES", () => {
    const env = stepEnv(workflow, DIGEST_STEP);
    expect(Object.keys(env)).toEqual(
      expect.arrayContaining(["TURSO_DATABASE_URL", "TURSO_AUTH_TOKEN"]),
    );
  });

  it("still gives the digest step Airtable and Resend (positive control)", () => {
    const env = stepEnv(workflow, DIGEST_STEP);
    expect(Object.keys(env)).toEqual(
      expect.arrayContaining(["AIRTABLE_PAT", "AIRTABLE_BASE_ID", "RESEND_API_KEY"]),
    );
  });
});
