/**
 * Comment line written above the appended block so future runs (and humans)
 * can recognize the managed section. Presence of this line is incidental —
 * the merge logic is keyed on each entry's normalized form, not on the marker.
 */
export const MANAGED_MARKER = "# canonical entries from @reddoorla/maintenance sync-configs";

/**
 * Build artifacts, test outputs, deploy caches, and secrets that should never
 * be tracked across the reddoor fleet. Sites may keep additional site-specific
 * entries — they are preserved on merge.
 */
export const CANONICAL_GITIGNORE_ENTRIES: readonly string[] = [
  "node_modules/",
  "build/",
  "dist/",
  ".svelte-kit/",
  "coverage/",
  ".vitest-cache/",
  "playwright-report/",
  "test-results/",
  ".lighthouseci/",
  ".tsbuildinfo",
  ".env",
  ".env.*",
  "!.env.example",
  ".DS_Store",
  "*.log",
  ".vercel/",
  ".netlify/",
  ".reddoor-a11y/",
  // The a11y audit's transient spec dir, written inside the checkout and
  // normally cleaned, but a timeout-SIGKILL of the parent orphans it. Ignored
  // fleet-wide so it never dirties a self-updating repo's tree (2026-06-10 M-D).
  ".reddoor-a11y-spec-*/",
];

export type MergeResult = { content: string; added: string[] };

function stripLeadingSlash(s: string): string {
  return s.startsWith("/") ? s.slice(1) : s;
}

function stripTrailingSlash(s: string): string {
  return s.endsWith("/") ? s.slice(0, -1) : s;
}

/**
 * Normalize for presence comparison only: strip leading `/`, trailing `/`,
 * and surrounding whitespace. `build`, `/build`, `build/`, and `/build/` all
 * collapse to the same key.
 */
function normalizePresence(line: string): string {
  return stripTrailingSlash(stripLeadingSlash(line.trim()));
}

function presentSet(existing: string): Set<string> {
  const set = new Set<string>();
  for (const raw of existing.split(/\r?\n/)) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("#")) continue;
    set.add(normalizePresence(trimmed));
  }
  return set;
}

/**
 * Merge `canonical` entries into `existing` .gitignore content.
 *
 * - Missing entries are appended under a managed marker comment.
 * - Existing entries (in any normalized variant — `/build`, `build/`, etc.)
 *   are preserved as-is; we never rewrite the site's own lines.
 * - When every canonical entry is already present, returns the original
 *   content unchanged with `added: []` — the recipe can treat that as noop.
 */
export function mergeGitignore(existing: string | null, canonical: readonly string[]): MergeResult {
  if (existing === null) {
    const body = [MANAGED_MARKER, ...canonical].join("\n") + "\n";
    return { content: body, added: [...canonical] };
  }
  const present = presentSet(existing);
  const added: string[] = [];
  for (const entry of canonical) {
    const norm = normalizePresence(entry);
    if (!present.has(norm)) {
      added.push(entry);
      present.add(norm);
    }
  }
  if (added.length === 0) {
    return { content: existing, added: [] };
  }
  let base = existing;
  if (!base.endsWith("\n")) base += "\n";
  const block = ["", MANAGED_MARKER, ...added].join("\n") + "\n";
  return { content: base + block, added };
}

/**
 * Of the tracked paths, return those that fall under a canonical *directory*
 * entry — i.e., paths that the freshly-synced .gitignore now wants ignored
 * but which git currently has in the index.
 *
 * File-pattern entries (`.env`, `*.log`, `.DS_Store`) are intentionally
 * skipped: they may contain user-meaningful data, and `git rm --cached`
 * cannot scrub secrets from history anyway. Surfaced for manual review
 * instead of auto-removing.
 */
export function findTrackedArtifacts(
  tracked: readonly string[],
  canonical: readonly string[],
): string[] {
  const dirEntries: string[] = [];
  for (const raw of canonical) {
    const t = raw.trim();
    if (!t) continue;
    if (t.startsWith("!")) continue;
    if (/[*?[]/.test(t)) continue;
    const noLead = stripLeadingSlash(t);
    if (!noLead.endsWith("/")) continue;
    const name = stripTrailingSlash(noLead);
    if (!name) continue;
    dirEntries.push(name);
  }
  const matched: string[] = [];
  for (const path of tracked) {
    for (const dir of dirEntries) {
      if (path === dir || path.startsWith(dir + "/")) {
        matched.push(path);
        break;
      }
    }
  }
  return matched;
}
