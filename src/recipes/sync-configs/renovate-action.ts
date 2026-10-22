import type { ConfigName } from "../../types.js";

/**
 * `.github/workflows/renovate.yml` (the `renovate-action` template) is
 * compliance-checked, not byte-matched, for the same reason `svelte.config.js`
 * and `netlify.toml` already are (see `isSvelteConfigCompliant` /
 * `isNetlifyConfigCompliant` in `sync-configs.ts`): an exact overwrite is the
 * wrong operation whenever a file legitimately diverges from the template
 * without being wrong. For renovate.yml there are TWO such legitimate
 * divergences, both observed live on 2026-08-31 (issue #651):
 *
 * 1. Renovate bumps its own digest pins. The template pins
 *    `renovatebot/github-action@1a96852b...` (# v46.1.21); a site Renovate
 *    maintains moves that pin forward on its own (reddoor-starter was already
 *    at `@e09d604f...` / v46.2.2). A byte-match recipe reads that as drift and
 *    opens a PR that DOWNGRADES the pin — reverting Renovate's own
 *    supply-chain update, the exact thing the template's own comment says
 *    Renovate is supposed to do. Observed live: it opened
 *    `reddoorla/reddoor-starter-blux#1`, closed unmerged.
 * 2. YAML scalar quoting. The template writes an unquoted twice-daily cron and
 *    `RENOVATE_USERNAME: reddoor-renovate[bot]` unquoted; a site's prettier
 *    may render both quoted instead. Both forms are prettier-clean (verified
 *    against the repo's own prettier), so prettier never normalizes one
 *    toward the other — once a site's copy diverges in quoting, a byte-match
 *    recipe reports drift FOREVER.
 *
 * The fix, following the svelte.config/netlify.toml precedent exactly: stop
 * asking "is this file byte-identical to the template?" and ask "does it
 * still satisfy the invariants we actually own?". `renovateActionGaps`
 * returns that — a `string[]` of human-readable gaps, empty meaning
 * compliant and left alone, the same shape as `rulesetGaps` (src/github/rulesets.ts)
 * and `renovateGaps` (src/audits/protection-coverage.ts).
 *
 * When a file genuinely IS non-compliant (e.g. its cron changed) the recipe
 * heals it by writing the template — but writing the template verbatim would
 * itself re-introduce the downgrade bug above, overwriting the site's newer
 * digest pins with the template's older ones. `withRenovatePinsFrom` carries
 * the site's own (still-digest-pinned) refs forward onto the template before
 * it is written — see that function's own doc comment for exactly what
 * guarantee this is (and, as importantly, isn't).
 *
 * Every check below runs against a COMMENT-STRIPPED copy of the file (see
 * `stripComments`). A raw-text `.match()`/`.includes()` takes the FIRST hit
 * anywhere in the file, comments included — a canonical pin, cron, or job
 * body sitting in a `#` comment above the real (non-compliant) line reads as
 * compliant, and worse, `withRenovatePinsFrom` would scrape a sha out of a
 * comment like `# old: uses: actions/checkout@1111…1111 # v4` and carry a
 * *commented* pin forward into the healed file — a pin downgrade delivered by
 * the very recipe that exists to prevent pin downgrades.
 */

const DIGEST_RE = /^[0-9a-f]{40}$/;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Strip full-line `#` comments before any compliance check or ref extraction
 * runs, so a canonical-looking line that exists only in a comment can never
 * read as the real thing.
 *
 * Full-line only: a trailing `# vX.Y.Z` after a real `uses:` line is
 * meaningful (it's the human-readable version tag) and must survive — only
 * strip a line whose first non-whitespace character is `#`. This is safe
 * specifically because this workflow's YAML has no block scalars (`|`/`>`),
 * so there is no line in a compliant or non-compliant renovate.yml where a
 * leading `#` is literal string content rather than a comment.
 */
function stripComments(contents: string): string {
  return contents.replace(/^[ \t]*#[^\n]*$/gm, "");
}

/** A `uses:` line, anchored to the start of a line (allowing only leading
 *  indentation and an optional `- ` list marker before `uses:`) so a match
 *  can only ever land on a real step, never on prose inside a comment that
 *  happens to contain the word `uses:`. Always run against comment-stripped
 *  text (see `stripComments`) — the anchor alone does not exclude comments,
 *  since a full-line comment's content can itself start with `- uses:` at
 *  matching indentation. */
const USES_LINE_RE = /^([ \t]*(?:- )?)uses:\s*([\w.-]+\/[\w.-]+)@(\S+)(?:[ \t]*#[^\r\n]*)?/gm;

/** The ref (and trailing `# vX.Y.Z` comment, if any) a `uses: <slug>@<ref>`
 *  line carries in `contents`, or null if that action isn't referenced.
 *  Callers must pass comment-stripped text — see `stripComments`. */
function usesRefAndComment(
  contents: string,
  slug: string,
): { ref: string; comment: string } | null {
  const re = new RegExp(
    `^[ \\t]*(?:- )?uses:\\s*${escapeRegExp(slug)}@(\\S+)([ \\t]*#[^\\r\\n]*)?`,
    "m",
  );
  const m = contents.match(re);
  if (!m) return null;
  return { ref: m[1]!, comment: m[2] ?? "" };
}

/** Gap text for one `uses:` action that must be present AND digest-pinned.
 *  This workflow mints a repo-write token (the App-token step), so a mutable
 *  tag ref on ANY step here is a supply-chain hole — a retagged `@v3`/`@v46`
 *  would run attacker code with that token. (The three actions checked here
 *  are the ones this workflow ships with by default; `renovateActionGaps`
 *  separately widens this to ANY `uses:` line, so an action added later is
 *  covered too.) `contents` must already be comment-stripped. */
function pinGap(slug: string, contents: string): string | null {
  const found = usesRefAndComment(contents, slug);
  if (!found || !DIGEST_RE.test(found.ref)) {
    return `${slug} is missing or not digest-pinned (needs @<40-hex-sha>) — this workflow mints a repo-write token, so a mutable tag ref is a supply-chain hole`;
  }
  return null;
}

/** The three actions this workflow ships with by default and always requires,
 *  present and digest-pinned. Checked individually (via `pinGap`, above) so a
 *  gap can say which one of the three is the problem; the widen loop in
 *  `renovateActionGaps` then covers every OTHER `uses:` line so a step added
 *  later can't slip in on a mutable ref unnoticed. */
const KNOWN_PINNED_ACTIONS = [
  "renovatebot/github-action",
  "actions/create-github-app-token",
  "actions/checkout",
];

const APP_AUTH_MARKERS = [
  "vars.RENOVATE_APP_ID",
  "secrets.RENOVATE_APP_PRIVATE_KEY",
  "steps.app-token.outputs.token",
];

/** Gaps in a site's `.github/workflows/renovate.yml`. Empty = compliant,
 *  leave it alone — see the module doc comment above for why this is
 *  compliance-checked rather than byte-matched. */
export function renovateActionGaps(contents: string): string[] {
  const gaps: string[] = [];
  const withoutComments = stripComments(contents);

  for (const slug of KNOWN_PINNED_ACTIONS) {
    const gap = pinGap(slug, withoutComments);
    if (gap) gaps.push(gap);
  }

  // Widen the pin check to every OTHER `uses:` line in the file — the doc
  // comment on `pinGap` says a mutable ref on ANY step is a supply-chain
  // hole; without this, a step added later (e.g. `pnpm/action-setup@v4`)
  // would pass clean just because it isn't one of the three known actions.
  // A local `uses: ./.github/actions/foo` path ref never matches — the regex
  // requires a literal `@<ref>`, which a bare path reference doesn't have.
  for (const m of withoutComments.matchAll(USES_LINE_RE)) {
    const slug = m[2]!;
    const ref = m[3]!;
    if (KNOWN_PINNED_ACTIONS.includes(slug)) continue; // already covered above
    if (!DIGEST_RE.test(ref)) {
      gaps.push(
        `${slug}@${ref} is not digest-pinned (needs @<40-hex-sha>) — this workflow mints a repo-write token, so every action reference must be digest-pinned`,
      );
    }
  }

  const missingAuth = APP_AUTH_MARKERS.filter((m) => !withoutComments.includes(m));
  if (missingAuth.length > 0) {
    gaps.push(
      `App auth is not fully wired — missing ${missingAuth.join(", ")} (Renovate authenticates as the reddoor-renovate GitHub App, not an operator PAT)`,
    );
  }

  if (withoutComments.includes("RENOVATE_TOKEN")) {
    gaps.push(
      "contains RENOVATE_TOKEN — that is the retired operator-PAT identity the App migration replaced",
    );
  }

  // Checked (and reported) as two independent gaps, not one folded string, so
  // a caller can tell which field actually failed.
  if (!/RENOVATE_USERNAME:\s*["']?reddoor-renovate\[bot\]/.test(withoutComments)) {
    gaps.push("RENOVATE_USERNAME does not identify reddoor-renovate[bot]");
  }
  if (!/RENOVATE_GIT_AUTHOR:\s*["']?reddoor-renovate\[bot\]/.test(withoutComments)) {
    gaps.push("RENOVATE_GIT_AUTHOR does not identify reddoor-renovate[bot]");
  }

  if (
    !/RENOVATE_REPOSITORIES:\s*["']?\$\{\{\s*github\.repository\s*\}\}["']?/.test(withoutComments)
  ) {
    gaps.push(
      "RENOVATE_REPOSITORIES is not scoped to ${{ github.repository }} — this workflow must only ever touch its own repo",
    );
  }

  if (!/cron:\s*["']?0 \*\/12 \* \* \*["']?/.test(withoutComments)) {
    gaps.push(
      'cron is not the twice-daily "0 */12 * * *" schedule — this cron IS the fleet\'s merge cadence (platform auto-merge is disabled fleet-wide, so Renovate merges from inside this run)',
    );
  }

  if (!withoutComments.includes("workflow_dispatch")) {
    gaps.push("missing workflow_dispatch trigger");
  }

  // A `permissions:` key is present somewhere AND a `contents: read` line
  // (optionally quoted) exists somewhere — not anchored to top-level-first-key,
  // since this predicate doesn't actually need to assert that shape (a
  // job-level permissions block satisfies the same invariant), and requiring
  // `contents: read` to be the first entry under `permissions:` false-positived
  // on both quoting (`contents: "read"`) and ordering (`contents: read` listed
  // after another key, e.g. `pull-requests: write`).
  const hasPermissionsKey = withoutComments.includes("permissions:");
  const hasContentsRead = /^[ \t]*contents:\s*["']?read["']?[ \t]*$/m.test(withoutComments);
  if (!hasPermissionsKey || !hasContentsRead) {
    gaps.push("permissions: does not grant contents: read");
  }

  return gaps;
}

/**
 * The canonical template with each action's `uses:` ref replaced by the ref
 * the site already has, when the site's is digest-pinned.
 *
 * Why: when a file IS genuinely non-compliant (say its cron changed) the
 * recipe heals it by writing the template — and writing the template verbatim
 * would put the template's OLDER pins over the site's newer ones, re-
 * introducing the downgrade this fix removes. So carry the site's pins
 * forward onto the (otherwise-canonical) healed file.
 *
 * This is PIN-NEUTRAL, not downgrade-avoiding: it substitutes the site's ref
 * whenever it is 40 hex characters, with no notion of "newer" — digests are
 * unorderable, so there is no way to tell from the strings alone. It never
 * changes a digest-pinned ref in either direction; some fleet sites carry a
 * pin OLDER than the template's and will heal onto their own older pin
 * (defensible — Renovate re-advances it on its own), so "pin-neutral" is the
 * accurate description, not "downgrade-avoiding".
 *
 * `current === null` (no existing file) returns the template unchanged — there
 * is nothing to carry forward. A non-digest ref on the site (a mutable tag) is
 * never substituted in, since that would carry the mutable-ref hole forward
 * instead of healing it. Likewise, a ref that appears only inside a `#`
 * comment in `current` is never carried forward (see `stripComments`) — a
 * commented sha must never be scraped and pinned into the healed file.
 */
export function withRenovatePinsFrom(template: string, current: string | null): string {
  if (current === null) return template;
  const currentWithoutComments = stripComments(current);
  return template.replace(USES_LINE_RE, (full, prefix: string, slug: string) => {
    const found = usesRefAndComment(currentWithoutComments, slug);
    if (!found || !DIGEST_RE.test(found.ref)) return full;
    return `${prefix}uses: ${slug}@${found.ref}${found.comment}`;
  });
}

/** The `ConfigName` for `.github/workflows/renovate.yml`. Exported once here
 *  (rather than re-declared as a local constant in both `sync-configs.ts` and
 *  `self-updating/index.ts`) so the two call sites can't drift apart. */
export const RENOVATE_ACTION_CONFIG: ConfigName = "renovate-action";
