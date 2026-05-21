import { resolve } from "node:path";
import { upgradeSvelte4to5 } from "../../recipes/svelte-5/index.js";

const KNOWN_UPGRADES = new Set(["svelte-4-to-5"]);

export async function runUpgradeCommand(
  upgradeName: string | undefined,
  site: string | undefined,
): Promise<{ output: string; code: number }> {
  if (!upgradeName || !KNOWN_UPGRADES.has(upgradeName)) {
    throw Object.assign(
      new Error(
        `unknown upgrade: ${upgradeName ?? "(none)"}. expected one of ${[...KNOWN_UPGRADES].join(", ")}`,
      ),
      { exitCode: 2 },
    );
  }

  const sitePath = resolve(site ?? process.cwd());

  if (upgradeName === "svelte-4-to-5") {
    const result = await upgradeSvelte4to5({ path: sitePath });
    const output =
      result.status === "noop"
        ? `noop: ${result.notes ?? "site already on svelte 5"}`
        : `applied: ${result.commits.length} commit(s)\n${result.notes ?? ""}`;
    return { output, code: result.status === "failed" ? 1 : 0 };
  }

  throw new Error(`internal: unhandled upgrade ${upgradeName}`);
}
