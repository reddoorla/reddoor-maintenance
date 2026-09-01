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
 * it is written, so healing a real gap never regresses a pin Renovate already
 * advanced.
 */

const DIGEST_RE = /^[0-9a-f]{40}$/;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The ref (and trailing `# vX.Y.Z` comment, if any) a `uses: <slug>@<ref>`
 *  line carries in `contents`, or null if that action isn't referenced. */
function usesRefAndComment(
  contents: string,
  slug: string,
): { ref: string; comment: string } | null {
  const re = new RegExp(`uses:\\s*${escapeRegExp(slug)}@(\\S+)([ \\t]*#[^\\r\\n]*)?`);
  const m = contents.match(re);
  if (!m) return null;
  return { ref: m[1]!, comment: m[2] ?? "" };
}

/** Gap text for one `uses:` action that must be present AND digest-pinned.
 *  This workflow mints a repo-write token (the App-token step), so a mutable
 *  tag ref on ANY step here is a supply-chain hole — a retagged `@v3`/`@v46`
 *  would run attacker code with that token. */
function pinGap(slug: string, contents: string): string | null {
  const found = usesRefAndComment(contents, slug);
  if (!found || !DIGEST_RE.test(found.ref)) {
    return `${slug} is missing or not digest-pinned (needs @<40-hex-sha>) — this workflow mints a repo-write token, so a mutable tag ref is a supply-chain hole`;
  }
  return null;
}

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

  for (const slug of [
    "renovatebot/github-action",
    "actions/create-github-app-token",
    "actions/checkout",
  ]) {
    const gap = pinGap(slug, contents);
    if (gap) gaps.push(gap);
  }

  const missingAuth = APP_AUTH_MARKERS.filter((m) => !contents.includes(m));
  if (missingAuth.length > 0) {
    gaps.push(
      `App auth is not fully wired — missing ${missingAuth.join(", ")} (Renovate authenticates as the reddoor-renovate GitHub App, not an operator PAT)`,
    );
  }

  if (contents.includes("RENOVATE_TOKEN")) {
    gaps.push(
      "contains RENOVATE_TOKEN — that is the retired operator-PAT identity the App migration replaced",
    );
  }

  const usernameOk = /RENOVATE_USERNAME:.*reddoor-renovate\[bot\]/.test(contents);
  const authorOk = /RENOVATE_GIT_AUTHOR:.*reddoor-renovate\[bot\]/.test(contents);
  if (!usernameOk || !authorOk) {
    gaps.push(
      "RENOVATE_USERNAME / RENOVATE_GIT_AUTHOR do not both identify reddoor-renovate[bot] — commit/PR identity must match the App's bot user",
    );
  }

  if (!/RENOVATE_REPOSITORIES:\s*\$\{\{\s*github\.repository\s*\}\}/.test(contents)) {
    gaps.push(
      "RENOVATE_REPOSITORIES is not scoped to ${{ github.repository }} — this workflow must only ever touch its own repo",
    );
  }

  if (!/cron:\s*["']?0 \*\/12 \* \* \*["']?/.test(contents)) {
    gaps.push(
      'cron is not the twice-daily "0 */12 * * *" schedule — this cron IS the fleet\'s merge cadence (platform auto-merge is disabled fleet-wide, so Renovate merges from inside this run)',
    );
  }

  if (!contents.includes("workflow_dispatch")) {
    gaps.push("missing workflow_dispatch trigger");
  }

  if (!/permissions:\s*\n\s*contents:\s*read/.test(contents)) {
    gaps.push("permissions: does not grant contents: read");
  }

  return gaps;
}

const USES_LINE_RE = /uses:\s*([\w.-]+\/[\w.-]+)@(\S+)(?:[ \t]*#[^\r\n]*)?/g;

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
 * `current === null` (no existing file) returns the template unchanged — there
 * is nothing to carry forward. A non-digest ref on the site (a mutable tag) is
 * never substituted in, since that would carry the mutable-ref hole forward
 * instead of healing it.
 */
export function withRenovatePinsFrom(template: string, current: string | null): string {
  if (current === null) return template;
  return template.replace(USES_LINE_RE, (full, slug: string) => {
    const found = usesRefAndComment(current, slug);
    if (!found || !DIGEST_RE.test(found.ref)) return full;
    return `uses: ${slug}@${found.ref}${found.comment}`;
  });
}
