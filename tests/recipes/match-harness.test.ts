import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve, dirname, join } from "node:path";
import { matchHarness } from "../../src/recipes/match-harness/index.js";
import { MATCH_HARNESS_FILES } from "../../src/recipes/match-harness/template.js";
import type { SpawnFn } from "../../src/audits/util/spawn.js";
import { copyFixtureToTmp } from "./_helpers/site-tmpdir.js";

const here = dirname(fileURLToPath(import.meta.url));
const pristine = resolve(here, "../fixtures/pristine-starter");
const noopSpawn: SpawnFn = async () => ({ code: 0, stdout: "", stderr: "" });

describe("recipes/match-harness", () => {
  it("installs every template file on a clean site, in one commit", async () => {
    const cwd = await copyFixtureToTmp(pristine);
    const result = await matchHarness(
      { path: cwd },
      { ref: "https://ref.test" },
      { spawn: noopSpawn },
    );
    expect(result.status).toBe("applied");
    expect(result.commits).toHaveLength(1);
    expect(result.notes).toMatch(/branch: maint\/match-harness-/);
    for (const f of MATCH_HARNESS_FILES) {
      if (f.rel === "matching/harness.json") continue; // rendered from --ref
      expect(await readFile(join(cwd, f.rel), "utf-8")).toBe(f.template);
    }
  });
});
