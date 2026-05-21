import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

async function git(cwd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return exec("git", args, { cwd, env: process.env });
}

export function branchName(recipe: string, when: Date = new Date()): string {
  const iso = when.toISOString().replace(/[-:.]/g, "").replace(/Z$/, "Z");
  // 2026-05-20T10:30:00.000Z → 20260520T103000000Z; trim millis:
  const trimmed = iso.replace(/(\d{8}T\d{6})\d+(Z)$/, "$1$2");
  return `maint/${recipe}-${trimmed}`;
}

export async function currentBranch(cwd: string): Promise<string> {
  const { stdout } = await git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
  return stdout.trim();
}

export async function isWorkingTreeClean(cwd: string): Promise<boolean> {
  const { stdout } = await git(cwd, ["status", "--porcelain"]);
  return stdout.trim().length === 0;
}

export async function createBranch(cwd: string, name: string): Promise<void> {
  await git(cwd, ["checkout", "-b", name]);
}

export async function stageAll(cwd: string): Promise<void> {
  await git(cwd, ["add", "-A"]);
}

/**
 * Stages all current changes and commits with `message`. Returns the commit SHA,
 * or `null` if there was nothing to commit.
 */
export async function commit(cwd: string, message: string): Promise<string | null> {
  await stageAll(cwd);
  const { stdout: status } = await git(cwd, ["status", "--porcelain"]);
  if (status.trim().length === 0) return null;
  await git(cwd, ["commit", "-m", message]);
  const { stdout: sha } = await git(cwd, ["rev-parse", "HEAD"]);
  return sha.trim();
}
