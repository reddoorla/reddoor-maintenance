import { describe, it, expect, beforeAll } from "vitest";
import { readFile } from "node:fs/promises";
import {
  stepEnv,
  stepRunScript,
  workflowPath,
  withoutComments,
} from "./_helpers/workflow-source.js";

/**
 * P1-87 PR 6: the `fleet_daily` writer reads GA4 and Search Console for the traffic block,
 * so its write step needs the GA key the reports already use, written the same way
 * daily-reports.yml writes it: `printf`, never `echo`, before the writer runs.
 */

const WRITE_STEP = "Write the night's fleet_daily row";

let workflow: string;
beforeAll(async () => {
  workflow = await readFile(workflowPath("fleet-daily.yml"), "utf-8");
});

describe("fleet-daily workflow: the traffic block's GA key", () => {
  it("gives the write step the three GA names, from the repo's existing secrets", () => {
    const env = stepEnv(workflow, WRITE_STEP);
    expect(env.GA_SUBJECT).toBe("${{ secrets.GA_SUBJECT }}");
    expect(env.GA_SA_KEY_JSON).toBe("${{ secrets.GA_SA_KEY_JSON }}");
    expect(env.GA_SA_KEY_PATH).toBe("${{ runner.temp }}/ga-service-account.json");
  });

  it("keeps the Turso and run env the writer already had (positive control)", () => {
    const env = stepEnv(workflow, WRITE_STEP);
    expect(Object.keys(env)).toEqual(
      expect.arrayContaining(["TURSO_DATABASE_URL", "TURSO_AUTH_TOKEN", "RUN_ID"]),
    );
  });

  it("writes the key with printf to the key path, before the writer runs", () => {
    const script = stepRunScript(workflow, WRITE_STEP);
    const printfAt = script.indexOf('printf \'%s\' "$GA_SA_KEY_JSON" > "$GA_SA_KEY_PATH"');
    const writerAt = script.indexOf("pnpm tsx scripts/fleet-daily.mts");
    expect(printfAt).toBeGreaterThanOrEqual(0);
    expect(writerAt).toBeGreaterThan(printfAt);
    expect(script).toContain('chmod 600 "$GA_SA_KEY_PATH"');
  });

  it("never echoes the key into the log", () => {
    const script = withoutComments(stepRunScript(workflow, WRITE_STEP));
    expect(script).not.toMatch(/echo[^\n]*GA_SA_KEY_JSON/);
    expect(script).not.toMatch(/set -x/);
  });

  it("keeps the 15-minute timeout", () => {
    expect(workflow).toMatch(/timeout-minutes: 15/);
  });
});
