import { describe, it, expect, beforeAll } from "vitest";
import { readFile } from "node:fs/promises";
import { stepEnv, workflowPath } from "./_helpers/workflow-source.js";

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
      expect.arrayContaining(["AIRTABLE_PAT", "AIRTABLE_BASE_ID", "RENOVATE_TOKEN"]),
    );
  });
});
