import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

async function git(cwd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return exec("git", args, { cwd, env: process.env });
}

export function branchName(recipe: string, when: Date = new Date()): string {
  // ISO with millisecond precision: 2026-05-20T10:30:00.123Z → 20260520T103000123Z.
  // Millis (vs. second-precision) shrinks the collision window for parallel runs.
  const compact = when.toISOString().replace(/[-:.]/g, "");
  return `maint/${recipe}-${compact}`;
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

export async function listTrackedFiles(cwd: string): Promise<string[]> {
  const { stdout } = await git(cwd, ["ls-files"]);
  return stdout
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

export async function removeFromIndex(cwd: string, paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  await git(cwd, ["rm", "-r", "--cached", "--", ...paths]);
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

/**
 * Strict GitHub repo identity: exactly two `[A-Za-z0-9._-]` segments separated
 * by a single slash. Rejects a scheme, host, extra path segment, traversal
 * (`..`), whitespace, or an argv flag — anything that could retarget a `gh`
 * write at an unintended (attacker/typo-controlled) repo.
 */
export const OWNER_REPO_RE = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;

/** True when `repo` is a clean `owner/repo` (see {@link OWNER_REPO_RE}). The
 *  explicit `..` reject covers traversal segments the char-class would otherwise
 *  admit (`.` is a legal repo char, so `../evil` matches the shape regex). */
export function isOwnerRepo(repo: string): boolean {
  if (repo.includes("..")) return false;
  return OWNER_REPO_RE.test(repo);
}

/**
 * True when two repo references name the same `owner/repo`. Each side may be a
 * full remote URL (https or scp-style), or already an `owner/repo`. Used to
 * verify an existing checkout's `origin` matches the site's expected repo
 * before reusing it. Returns false if either side is unparseable.
 */
export function sameOwnerRepo(a: string, b: string): boolean {
  const na = isOwnerRepo(a.trim()) ? a.trim() : parseOwnerRepo(a);
  const nb = isOwnerRepo(b.trim()) ? b.trim() : parseOwnerRepo(b);
  if (na === null || nb === null) return false;
  return na.toLowerCase() === nb.toLowerCase();
}

/** Derive `owner/repo` from a git remote URL (https or scp-style). Null if unparseable. */
export function parseOwnerRepo(remoteUrl: string): string | null {
  const trimmed = remoteUrl
    .trim()
    .replace(/\.git$/, "")
    .replace(/\/$/, "");
  // scp-style: git@github.com:owner/repo
  const scp = trimmed.match(/^[A-Za-z0-9._-]+@[A-Za-z0-9._-]+:(.+)$/);
  const path = scp ? scp[1]! : trimmed.replace(/^https?:\/\/[^/]+\//, "");
  const segments = path.split("/").filter(Boolean);
  if (segments.length < 2) return null;
  return `${segments[segments.length - 2]}/${segments[segments.length - 1]}`;
}

/** `origin` remote URL for a checkout, trimmed. Throws (via git) if there's no origin. */
export async function getRemoteUrl(cwd: string): Promise<string> {
  const { stdout } = await git(cwd, ["remote", "get-url", "origin"]);
  return stdout.trim();
}

/** Push a branch to origin, setting upstream. Throws on non-zero (execFile rejects). */
export async function push(cwd: string, branch: string): Promise<void> {
  await git(cwd, ["push", "-u", "origin", branch]);
}
