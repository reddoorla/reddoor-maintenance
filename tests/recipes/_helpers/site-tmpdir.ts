import { mkdtemp, cp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

export async function copyFixtureToTmp(fixtureAbsPath: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "reddoor-recipe-"));
  await cp(fixtureAbsPath, dir, { recursive: true });

  execFileSync("git", ["init", "--initial-branch=main"], { cwd: dir, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "test@reddoor.local"], {
    cwd: dir,
    stdio: "ignore",
  });
  execFileSync("git", ["config", "user.name", "reddoor-test"], { cwd: dir, stdio: "ignore" });
  execFileSync("git", ["add", "-A"], { cwd: dir, stdio: "ignore" });
  execFileSync("git", ["commit", "-m", "initial"], { cwd: dir, stdio: "ignore" });
  return dir;
}
