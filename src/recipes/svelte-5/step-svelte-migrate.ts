import { defaultSpawn, type SpawnFn } from "../../audits/util/spawn.js";

export async function runSvelteMigrate(
  cwd: string,
  spawn: SpawnFn = defaultSpawn,
): Promise<{ ran: boolean; stderr: string }> {
  try {
    const { code, stderr } = await spawn(
      "npx",
      ["--yes", "svelte-migrate", "svelte-5", "--no-install"],
      { cwd, timeoutMs: 5 * 60_000 },
    );
    if (code !== 0) {
      return { ran: false, stderr };
    }
    return { ran: true, stderr };
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === "ENOENT" || /ENOENT/.test(String(err))) {
      return { ran: false, stderr: "npx unavailable" };
    }
    throw err;
  }
}
