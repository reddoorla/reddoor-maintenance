import { describe, it, expect, beforeAll } from "vitest";
import { readFile } from "node:fs/promises";
import { stepEnv, stepRunScript, workflowPath } from "./_helpers/workflow-source.js";

/**
 * #643 (the freeze): `bin.ts` evaluates `await makeSiteMirror()` EAGERLY as an
 * argument to the renovate-dispatch command, and post-flip the factory throws
 * without Turso creds. This step's `| tee … || true` masks the exit code BY
 * DESIGN (a missing Renovate token clean-skips), so a creds gap here is not a
 * red run — it is Renovate silently never dispatching again, which is the #585
 * failure shape inverted: the mirror no longer silently no-ops, the whole
 * command silently doesn't run. The env block is therefore load-bearing in a
 * way the step's own output cannot prove.
 */

const DISPATCH_STEP = "Trigger Renovate for sites with actionable vulnerabilities";

let workflow: string;

beforeAll(async () => {
  workflow = await readFile(workflowPath("fleet-security.yml"), "utf-8");
});

describe("fleet-security workflow", () => {
  it("gives the renovate-dispatch step the Turso credentials its site mirror now REQUIRES", () => {
    const env = stepEnv(workflow, DISPATCH_STEP);
    expect(Object.keys(env)).toEqual(
      expect.arrayContaining(["TURSO_DATABASE_URL", "TURSO_AUTH_TOKEN"]),
    );
  });

  it("still gives the renovate-dispatch step its Airtable creds and app token (positive control)", () => {
    // Proves stepEnv is reading the real block, so the assertion above cannot
    // be passing against an empty or mis-parsed map.
    const env = stepEnv(workflow, DISPATCH_STEP);
    expect(Object.keys(env)).toEqual(
      expect.arrayContaining(["AIRTABLE_PAT", "AIRTABLE_BASE_ID", "GH_TOKEN"]),
    );
  });
});

/**
 * The retired PAT name. The CLI reads the fleet token from GH_TOKEN only, so a
 * step still passing the minted App token as RENOVATE_TOKEN would hand the
 * command NO token — and every one of these commands treats "no token" as a
 * clean local-dev skip (exit 0). The value is pinned too: GH_TOKEN wired to
 * anything but the late-minted App token is the same silent de-tokening.
 */
const APP_TOKEN = "${{ steps.app-token-late.outputs.token }}";
const PROTECTION_STEP = "Protection coverage audit (org-wide)";
const SWEEP_STEP = "Sweep GitHub signals to Airtable";

describe("fleet token wiring: the minted App token reaches the CLI as GH_TOKEN", () => {
  it.each([DISPATCH_STEP, PROTECTION_STEP])(
    "fleet-security `%s` passes GH_TOKEN = the late App token",
    (step) => {
      const env = stepEnv(workflow, step);
      expect(env.GH_TOKEN).toBe(APP_TOKEN);
      expect(env).not.toHaveProperty("RENOVATE_TOKEN");
    },
  );

  it("the protection audit's empty-token guard tests the variable the CLI actually reads", () => {
    const run = stepRunScript(workflow, PROTECTION_STEP);
    expect(run).toContain('if [ -z "$GH_TOKEN" ]; then');
    expect(run).not.toContain("RENOVATE_TOKEN");
  });

  it("fleet-lighthouse's signals sweep passes GH_TOKEN = its App token, and guards on it", async () => {
    const lighthouse = await readFile(workflowPath("fleet-lighthouse.yml"), "utf-8");
    const env = stepEnv(lighthouse, SWEEP_STEP);
    expect(env.GH_TOKEN).toBe("${{ steps.app-token.outputs.token }}");
    expect(env).not.toHaveProperty("RENOVATE_TOKEN");
    const run = stepRunScript(lighthouse, SWEEP_STEP);
    expect(run).toContain('if [ -z "$GH_TOKEN" ]; then');
  });
});
