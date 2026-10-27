import { readPackageJson } from "../../util/pkg.js";
import { join } from "node:path";
import { defaultSpawn, type SpawnFn } from "../../audits/util/spawn.js";

export async function upgradeTailwind(
  cwd: string,
  spawn: SpawnFn = defaultSpawn,
): Promise<{ ran: boolean; reason?: string }> {
  const pkg = await readPackageJson(join(cwd, "package.json"));
  const tailwindVersion = pkg.devDependencies?.tailwindcss ?? pkg.dependencies?.tailwindcss;
  if (!tailwindVersion) return { ran: false, reason: "tailwindcss not installed" };
  if (/^\^?4\./.test(tailwindVersion)) return { ran: false, reason: "already on tailwind 4.x" };

  try {
    const { code, stderr } = await spawn("npx", ["--yes", "@tailwindcss/upgrade", "--force"], {
      cwd,
      timeoutMs: 5 * 60_000,
    });
    if (code !== 0) return { ran: false, reason: stderr.slice(0, 200) };
    return { ran: true };
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === "ENOENT" || /ENOENT/.test(String(err))) {
      return { ran: false, reason: "npx unavailable" };
    }
    throw err;
  }
}
