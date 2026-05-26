import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import { runSyncConfigsCommand } from "../../src/cli/commands/sync-configs.js";
import { copyFixtureToTmp } from "../recipes/_helpers/site-tmpdir.js";

const here = dirname(fileURLToPath(import.meta.url));
const drift = resolve(here, "../fixtures/sync-drift");
const clean = resolve(here, "../fixtures/sync-clean");

describe("cli: sync-configs --only validation", () => {
  it("rejects an unknown config name with a clear error + exitCode 2", async () => {
    // Regression: parseOnly used to do `as ConfigName[]` and let typos
    // through, producing a silent noop. CLI must surface the typo loudly.
    await expect(
      runSyncConfigsCommand(undefined, { only: "bogus", cwd: process.cwd() }),
    ).rejects.toMatchObject({
      message: expect.stringMatching(/bogus/),
      exitCode: 2,
    });
  });

  it("rejects a partially-valid list (one bad entry among good ones)", async () => {
    await expect(
      runSyncConfigsCommand(undefined, { only: "eslint,bogus,prettier", cwd: process.cwd() }),
    ).rejects.toMatchObject({
      message: expect.stringMatching(/bogus/),
      exitCode: 2,
    });
  });
});

describe("cli: sync-configs --dry covers gitignore drift", () => {
  it("reports gitignore drift when the site has no .gitignore at all", async () => {
    // Regression: dryPlan used to iterate only the 5 template configs, so
    // a missing .gitignore was silently absent from the dry output even
    // though a real run would create one.
    const cwd = await copyFixtureToTmp(drift);
    const { output, code } = await runSyncConfigsCommand(undefined, { dry: true, cwd });
    expect(code).toBe(0);
    expect(output).toMatch(/\.gitignore/);
  });

  it("reports gitignore drift only when --only=gitignore is targeted", async () => {
    const cwd = await copyFixtureToTmp(drift);
    const { output } = await runSyncConfigsCommand(undefined, {
      dry: true,
      only: "gitignore",
      cwd,
    });
    expect(output).toMatch(/\.gitignore/);
    // Other templates should NOT show up — --only=gitignore restricts the plan.
    expect(output).not.toMatch(/eslint\.config\.js/);
    expect(output).not.toMatch(/svelte\.config\.js/);
  });

  it("does not report gitignore drift when the site's .gitignore is already canonical", async () => {
    const cwd = await copyFixtureToTmp(clean);
    const { output } = await runSyncConfigsCommand(undefined, { dry: true, cwd });
    expect(output).not.toMatch(/would.*\.gitignore/i);
  });
});
