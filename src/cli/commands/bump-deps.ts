import { resolve } from "node:path";
import { bumpDeps, type BumpDepsGroup } from "../../recipes/bump-deps.js";

const GROUPS: BumpDepsGroup[] = ["patch", "minor", "major"];

export type BumpDepsCommandOptions = {
  group?: string;
};

export async function runBumpDepsCommand(
  site: string | undefined,
  opts: BumpDepsCommandOptions,
): Promise<{ output: string; code: number }> {
  const group = (opts.group ?? "minor") as BumpDepsGroup;
  if (!GROUPS.includes(group)) {
    throw Object.assign(
      new Error(`unknown --group: ${group}. expected one of ${GROUPS.join(", ")}`),
      { exitCode: 2 },
    );
  }
  const sitePath = resolve(site ?? process.cwd());
  const result = await bumpDeps({ path: sitePath }, { group });

  const output =
    result.status === "noop"
      ? `noop: ${result.notes ?? ""}`
      : `applied: ${result.commits.length} commit(s)\n${result.notes ?? ""}`;

  return { output, code: result.status === "failed" ? 1 : 0 };
}
