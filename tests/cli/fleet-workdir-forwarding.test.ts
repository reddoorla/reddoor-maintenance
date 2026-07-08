import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock resolveSites so it returns no sites: prepareFleetSites / runRecipeOverSites
// then iterate an empty array (no clone, no git, no network, no recipe run), while
// we assert what each command PASSED to resolveSites.
vi.mock("../../src/cli/fleet/resolve-sites.js", () => ({ resolveSites: vi.fn() }));

import { resolveSites } from "../../src/cli/fleet/resolve-sites.js";
import { runHealthEndpointCommand } from "../../src/cli/commands/health-endpoint.js";
import { runSmokeSuiteCommand } from "../../src/cli/commands/smoke-suite.js";
import { runSvelteCodemodsCommand } from "../../src/cli/commands/svelte-codemods.js";
import { runInitCommand } from "../../src/cli/commands/init.js";
import { runBumpDepsCommand } from "../../src/cli/commands/bump-deps.js";
import { runConvertToPnpmCommand } from "../../src/cli/commands/convert-to-pnpm.js";
import { runSyncConfigsCommand } from "../../src/cli/commands/sync-configs.js";
import { runUpgradeCommand } from "../../src/cli/commands/upgrade.js";

const OPTS = { fleet: "airtable", workdir: "/custom/workdir" } as const;

// Each fleet command's invocation with an explicit --workdir. upgrade takes a
// leading upgradeName; the rest take (site, opts).
const commands: Array<[string, () => Promise<unknown>]> = [
  ["health-endpoint", () => runHealthEndpointCommand(undefined, { ...OPTS })],
  ["smoke-suite", () => runSmokeSuiteCommand(undefined, { ...OPTS })],
  ["svelte-codemods", () => runSvelteCodemodsCommand(undefined, { ...OPTS })],
  ["init", () => runInitCommand(undefined, { ...OPTS })],
  ["bump-deps", () => runBumpDepsCommand(undefined, { ...OPTS })],
  ["convert-to-pnpm", () => runConvertToPnpmCommand(undefined, { ...OPTS })],
  ["sync-configs", () => runSyncConfigsCommand(undefined, { ...OPTS })],
  ["upgrade", () => runUpgradeCommand("svelte-4-to-5", undefined, { ...OPTS })],
];

describe("fleet recipe commands forward --workdir to resolveSites (--fleet airtable)", () => {
  beforeEach(() => {
    vi.mocked(resolveSites).mockReset();
    vi.mocked(resolveSites).mockResolvedValue([]); // empty inventory → no clone/recipe/git
  });

  for (const [name, run] of commands) {
    it(`${name}: passes workdir through so airtable can compute {workdir}/{slug}`, async () => {
      await run();
      expect(vi.mocked(resolveSites)).toHaveBeenCalledWith(
        expect.objectContaining({ fleet: "airtable", workdir: "/custom/workdir" }),
      );
    });
  }

  it("omits workdir entirely when --workdir is not supplied (conditional spread)", async () => {
    await runHealthEndpointCommand(undefined, { fleet: "airtable" });
    const arg = vi.mocked(resolveSites).mock.calls[0]?.[0] ?? {};
    expect(arg).not.toHaveProperty("workdir");
    expect(arg).toMatchObject({ fleet: "airtable" });
  });
});
