/** Where a resolved token came from — printed by the tokens doctor so an
 *  operator can see WHICH env var answered, never the value. */
export type ResolvedToken = { token: string; source: string };

/**
 * The canonical env var holding a Prismic repository's write token:
 * `PRISMIC_TOKEN_<REPOSITORY_NAME>` upper-snaked.
 *
 * One rule, derivable from the repository name alone — no hand-maintained map
 * from site slug to env var. That matters because the two genuinely differ:
 * medical-solutions-of-texas's Prismic repository is `msot`, reddoor-website's
 * is `reddoor-la`, and beachfront-dentistry's is the hash `48bb12d1`. A draft
 * of the nightly workflow hardcoded PRISMIC_TOKEN_MEDICAL_SOLUTIONS_OF_TEXAS;
 * that secret would never have resolved, and the failure would have looked like
 * a credentials problem rather than a naming one.
 */
export function prismicTokenEnvName(repositoryName: string): string {
  const slug = repositoryName
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return `PRISMIC_TOKEN_${slug}`;
}

/**
 * Resolve the write token for one Prismic repository.
 *
 * `allowGeneric` is the mode switch and it matters. IN-REPO (CI) runs set it
 * true: the site's own Actions secret is `PRISMIC_WRITE_TOKEN`, the name every
 * site's code already reads, and there is exactly one Prismic repository in
 * scope. FLEET runs set it FALSE: a single generic token in the environment
 * while iterating 18 repositories would silently attach the wrong credential to
 * every site after the first.
 */
export function resolvePrismicToken(
  repositoryName: string,
  env: Record<string, string | undefined>,
  opts: { allowGeneric: boolean },
): ResolvedToken | null {
  const canonical = prismicTokenEnvName(repositoryName);
  const names = opts.allowGeneric ? [canonical, "PRISMIC_WRITE_TOKEN"] : [canonical];
  for (const name of names) {
    const value = env[name]?.trim();
    if (value) return { token: value, source: name };
  }
  return null;
}
