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
