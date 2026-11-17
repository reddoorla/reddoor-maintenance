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

  // Review round 1, Group E: the key is written only when it is set, so an unset secret
  // never writes an empty key file.
  it("guards the printf with 'if [ -n \"$GA_SA_KEY_JSON\" ]'", () => {
    const script = withoutComments(stepRunScript(workflow, WRITE_STEP));
    const guardAt = script.indexOf('if [ -n "$GA_SA_KEY_JSON" ]');
    const printfAt = script.indexOf("printf '%s' \"$GA_SA_KEY_JSON\"");
    expect(guardAt).toBeGreaterThanOrEqual(0);
    expect(printfAt).toBeGreaterThan(guardAt);
  });

  // Review round 2, Group C: the key file is never world-readable: umask 077 is the first
  // line inside the guard's if, before the printf that creates the file.
  it("sets umask 077 as the first line inside the guard, before the key is written", () => {
    const script = withoutComments(stepRunScript(workflow, WRITE_STEP));
    expect(script).toMatch(/if \[ -n "\$GA_SA_KEY_JSON" \]; then\n\s*umask 077\n\s*printf/);
  });

  // Group C: the key's text leaves the writer's environment once the file is written.
  it("unsets GA_SA_KEY_JSON after the key file is written, so the writer never sees it", () => {
    const script = withoutComments(stepRunScript(workflow, WRITE_STEP));
    const chmodAt = script.indexOf('chmod 600 "$GA_SA_KEY_PATH"');
    const unsetAt = script.indexOf("unset GA_SA_KEY_JSON");
    expect(chmodAt).toBeGreaterThanOrEqual(0);
    expect(unsetAt).toBeGreaterThan(chmodAt);
    expect(unsetAt).toBeLessThan(script.indexOf("pnpm tsx scripts/fleet-daily.mts"));
    // Review round 2, Group B (X15): the unset is inside the guard's if, before its closing fi.
    const guardAt = script.indexOf('if [ -n "$GA_SA_KEY_JSON" ]');
    const closeAt = guardAt + script.slice(guardAt).search(/\n\s*fi\s*(\n|$)/);
    expect(guardAt).toBeGreaterThanOrEqual(0);
    expect(unsetAt).toBeGreaterThan(guardAt);
    expect(unsetAt).toBeLessThan(closeAt);
  });

  it("keeps the 15-minute timeout", () => {
    expect(workflow).toMatch(/timeout-minutes: 15/);
  });
});
