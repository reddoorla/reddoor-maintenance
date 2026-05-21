import { defaultSpawn, type SpawnFn, type SpawnResult } from "../../audits/util/spawn.js";

export type VerifyResult = {
  install: SpawnResult | { skipped: true };
  check: SpawnResult | { skipped: true };
};

export async function verifyMigration(
  cwd: string,
  spawn: SpawnFn = defaultSpawn,
): Promise<VerifyResult> {
  let install: VerifyResult["install"];
  try {
    install = await spawn("pnpm", ["install"], { cwd, timeoutMs: 10 * 60_000 });
  } catch {
    install = { skipped: true };
  }

  let check: VerifyResult["check"];
  try {
    check = await spawn("pnpm", ["run", "check"], { cwd, timeoutMs: 5 * 60_000 });
  } catch {
    check = { skipped: true };
  }

  return { install, check };
}
