// The workflow a site runs the check in, and the starting files `--init`
// writes beside it.
//
// It runs the check from a PINNED version of this package with `npx`, not from
// the site's own installed copy. A site's lockfile can sit many minors behind
// (Vineyard pinned ^0.109.1 when this shipped at 0.118), and a site that has
// not taken the release has no `content-check` command: `pnpm exec` would go
// red on a site that changed nothing. Pinned here, the check needs neither the
// site's install nor its dependency bump, and `--init` from a newer release
// re-pins it.

/** Where the workflow lands in a site repo. */
export const WORKFLOW_PATH = ".github/workflows/content-check.yml";

// Digest-pinned like every other workflow this package writes (see
// src/recipes/sync-configs/templates.ts for why a tag is not enough).
const CHECKOUT = "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7";
const SETUP_NODE = "actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7";

/** The first release that has `content-check`. A workflow pinned below it
 *  would run `npx … reddoor-maint content-check` and exit 1 on "unknown
 *  command", red on a site that changed nothing. */
export const FIRST_VERSION = "0.118.0";

const parts = (v: string): number[] => v.split(".").map(Number);
const below = (a: string, b: string): boolean => {
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i]! < y[i]!;
  return false;
};

export function contentCheckWorkflow(version: string): string {
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(
      `content-check: cannot pin the workflow to version "${version}"; run --init from a released @reddoorla/maintenance`,
    );
  }
  if (below(version, FIRST_VERSION)) {
    throw new Error(
      `content-check: cannot pin the workflow to version ${version}, which has no content-check command; run --init from @reddoorla/maintenance@${FIRST_VERSION} or later`,
    );
  }
  return `# Flags NEW hard-coded visitor-facing content (P1-120): words, images, video
# IDs, links and contact facts written in code instead of coming from Prismic.
# Managed by @reddoorla/maintenance (\`reddoor-maint content-check --init\`):
# re-run that to update it, rather than editing here.
#
# Settings are in content-check.json (\`"mode": "fail"\` makes a new literal
# fail this check; it warns until then). The literals already in code when the
# check arrived are in content-check.baseline.json and never warn.
name: content-check

on:
  pull_request:
  push:
    branches: [main, staging]

permissions:
  contents: read

jobs:
  content-check:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: ${CHECKOUT}

      - uses: ${SETUP_NODE}
        with:
          node-version: "24"

      - name: Check for new hard-coded content
        run: npx --yes --package=@reddoorla/maintenance@${version} -- reddoor-maint content-check
`;
}

/** The settings file `--init` writes when a site has none. */
export const STARTER_CONFIG = `${JSON.stringify(
  {
    $comment:
      "reddoor-maint content-check (P1-120). mode: warn | fail. exempt: globs of files no visitor reads as content. ignore: literals never to report; an entry wrapped in slashes is a regex, so '/about/' also hides 'Learn about us'. fallbackHelpers: names of calls whose literal arguments are fallbacks for a Prismic field.",
    mode: "warn",
    exempt: [],
    ignore: [],
    fallbackHelpers: [],
  },
  null,
  2,
)}
`;
