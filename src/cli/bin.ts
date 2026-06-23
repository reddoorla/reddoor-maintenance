#!/usr/bin/env node
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { cac } from "cac";
import type { AuditName, RecipeName } from "../types.js";
import { loadCredentialsIntoEnv } from "../util/credentials.js";
import { resolvePackageVersion } from "./version.js";

// Command modules are loaded LAZILY (dynamic `import()` inside each `.action()`),
// never eagerly at the top. An eager `import { runReportCommand } from
// "./commands/report.js"` would pull EVERY command's transitive dependency chain
// into the CLI's startup graph — report/announce/launch drag in mjml + resend +
// @google-analytics/data, `db` drags in the libSQL/kysely stack, etc. Those heavy
// packages are `devDependencies` (this repo's CLI/functions/audits use them); a
// consuming fleet site installs @reddoorla/maintenance only for `./forms` +
// `./configs/*` and runs just `reddoor-maint audit --only a11y` in CI. Lazy
// loading keeps that path (and `--help`/`--version`) free of the report/db
// chains, so those packages never land in a consumer's node_modules. The
// smoke-dist gate asserts bin.js's STATIC import closure stays free of them.

// Load credentials from ~/.config/reddoor-maint/credentials.env before any
// command runs, so AIRTABLE_PAT/AIRTABLE_BASE_ID/RESEND_API_KEY/etc. are
// available from any cwd. Shell-exported env vars still win. Silent on
// missing file — commands that need the credentials will fail with their
// own clear error.
loadCredentialsIntoEnv();

const here = dirname(fileURLToPath(import.meta.url));
const version = resolvePackageVersion(here);

const AUDIT_DESCRIPTIONS: Record<AuditName, string> = {
  deps: "Diff site package.json against the bundled baseline version map.",
  lighthouse: "Run @lhci/cli autorun using the canonical lighthouserc.",
  a11y: "Playwright + axe against the canonical a11y routes.",
  security: "pnpm audit (falls back to npm audit), prod-deps by default.",
  lint: "ESLint + Prettier using the canonical configs.",
  domain: "DNS resolve + TLS cert expiry against the deployed URL (checkout-free).",
  browser:
    "Playwright across desktop engines + mobile devices + link-check against the deployed URL (checkout-free).",
};

const RECIPE_DESCRIPTIONS: Record<RecipeName, string> = {
  "sync-configs": "Overwrite a site's canonical configs to match @reddoorla/maintenance.",
  "bump-deps": "Bump dependencies and commit the lockfile change.",
  "svelte-4-to-5": "Run the 7-commit Svelte 4 → 5 upgrade recipe.",
  "svelte-codemods":
    "Apply Svelte 5 gotcha codemods to an already-migrated site (state_referenced_locally, etc.).",
  "convert-to-pnpm": "Convert an npm/yarn site to pnpm (lockfile, packageManager, scripts).",
  onboard: "Install @reddoorla/maintenance + audit deps on a site (preferred first step).",
  "a11y-fixtures-page":
    "Write src/routes/dev/a11y-fixtures/+page.svelte (stub for lhci + axe targets).",
  "self-updating":
    "Bootstrap CI + Renovate + auto-merge per repo (writes workflows, opens PR, sets RENOVATE_TOKEN).",
  init: "Run the full onboarding chain (convert-to-pnpm → onboard → sync-configs → svelte-codemods → a11y-fixtures-page → audit).",
};

/** Run a command thunk and surface its result, falling back to a clean error
 * message on throw. Wraps the ~10-line try/catch every `.action()` used to
 * duplicate. `verbose` flips between full stack and message-only.
 *
 * On success it sets `process.exitCode` and RETURNS rather than calling
 * `process.exit()` right after `console.log()`. `process.exit()` does not wait
 * for stdout to flush when stdout is a pipe, so a large `--json` payload piped
 * to another process would get truncated mid-write. Setting `exitCode` and
 * returning lets Node drain stdout and exit naturally with the right code. A
 * non-zero `code` still yields a non-zero process exit.
 *
 * The error path keeps `process.exit()` — error messages are small (one line),
 * always go to stderr, and exiting immediately is the desired fail-fast. */
export async function runOrExit(
  fn: () => Promise<{ output: string; code: number }>,
  opts: { verbose?: boolean },
): Promise<void> {
  try {
    const { output, code } = await fn();
    console.log(output);
    process.exitCode = code;
    return;
  } catch (err) {
    const e = err as { exitCode?: number; message?: string; stack?: string };
    console.error(opts.verbose ? (e.stack ?? e.message) : (e.message ?? String(err)));
    process.exit(e.exitCode ?? 1);
  }
}

const cli = cac("reddoor-maint");

cli.option("--cwd <path>", "Override working directory (default: process.cwd())");
cli.option("--verbose", "Verbose output (full stack on errors)");

cli.command("list-audits", "Print the available audits.").action(() => {
  for (const [name, desc] of Object.entries(AUDIT_DESCRIPTIONS)) {
    console.log(`${name.padEnd(12)} ${desc}`);
  }
});

cli.command("list-recipes", "Print the available recipes.").action(() => {
  for (const [name, desc] of Object.entries(RECIPE_DESCRIPTIONS)) {
    console.log(`${name.padEnd(16)} ${desc}`);
  }
});

cli
  .command("audit [site]", "Run audits against a site (default: cwd).")
  .option("--only <names>", "Comma-separated audit names (e.g. deps,lighthouse)")
  .option("--json", "Machine-readable JSON output")
  .option(
    "--fleet <inventory>",
    'Inventory file (.json or .mjs/.js), or "airtable" to read from Websites table',
  )
  .option("--workdir <path>", "Clone target for fleet mode (default ~/.reddoor-maint/sites)")
  .option(
    "--write-airtable [slug]",
    "After lighthouse runs, write pScore/rScore/bpScore/seoScore + timestamp to the matching Websites row. Slug defaults to cwd's package.json#name.",
  )
  .option("--fail-on-violations", "Exit non-zero if any a11y violations are found (for CI gates)")
  .option(
    "--url <url>",
    "Audit this deployed URL with lighthouse (no dev server); single-site. Pair with --only lighthouse — other audits still use the local checkout.",
  )
  .option(
    "--concurrency <n>",
    "Max sites to audit in parallel in --fleet mode (default: all at once). Use 1 for sequential (CI).",
  )
  .action(
    async (
      site,
      opts: {
        only?: string;
        json?: boolean;
        fleet?: string;
        workdir?: string;
        cwd?: string;
        verbose?: boolean;
        writeAirtable?: string | boolean;
        failOnViolations?: boolean;
        url?: string;
        concurrency?: string;
      },
    ) =>
      runOrExit(
        async () => (await import("./commands/audit.js")).runAuditCommand(site, opts),
        opts,
      ),
  );

cli
  .command("sync-configs [site]", "Sync canonical configs into a site.")
  .option("--only <names>", "Comma-separated config names (e.g. eslint,prettier)")
  .option("--dry", "Print diff without writing")
  .option(
    "--fleet <inventory>",
    'Inventory file (.json or .mjs/.js), or "airtable" to read from Websites table',
  )
  .option("--workdir <path>", "Clone target for fleet mode (default ~/.reddoor-maint/sites)")
  .action(
    async (
      site,
      opts: {
        only?: string;
        dry?: boolean;
        fleet?: string;
        workdir?: string;
        cwd?: string;
        verbose?: boolean;
      },
    ) =>
      runOrExit(
        async () => (await import("./commands/sync-configs.js")).runSyncConfigsCommand(site, opts),
        opts,
      ),
  );

cli
  .command("bump-deps [site]", "Bump dependencies.")
  .option("--group <group>", "patch | minor | major", { default: "minor" })
  .option(
    "--fleet <inventory>",
    'Inventory file (.json or .mjs/.js), or "airtable" to read from Websites table',
  )
  .option("--workdir <path>", "Clone target for fleet mode (default ~/.reddoor-maint/sites)")
  .action(
    async (
      site,
      opts: {
        group?: string;
        fleet?: string;
        workdir?: string;
        cwd?: string;
        verbose?: boolean;
      },
    ) =>
      runOrExit(
        async () => (await import("./commands/bump-deps.js")).runBumpDepsCommand(site, opts),
        opts,
      ),
  );

cli
  .command(
    "self-updating [site]",
    "Bootstrap a repo to keep itself updated (CI + Renovate + auto-merge).",
  )
  .option("--dry", "List what would be enabled without writing or opening PRs")
  .option("--fleet <inventory>", 'Inventory file (.json or .mjs/.js), or "airtable"')
  .option("--workdir <path>", "Clone target for fleet mode (default ~/.reddoor-maint/sites)")
  .action(
    async (
      site,
      opts: {
        dry?: boolean;
        fleet?: string;
        workdir?: string;
        cwd?: string;
        verbose?: boolean;
      },
    ) =>
      runOrExit(
        async () =>
          (await import("./commands/self-updating.js")).runSelfUpdatingCommand(site, opts),
        opts,
      ),
  );

cli
  .command("upgrade <upgrade> [site]", "Run a named upgrade recipe (svelte-4-to-5).")
  .example("reddoor-maint upgrade svelte-4-to-5 ./my-site")
  .option(
    "--fleet <inventory>",
    'Inventory file (.json or .mjs/.js), or "airtable" to read from Websites table',
  )
  .option("--workdir <path>", "Clone target for fleet mode (default ~/.reddoor-maint/sites)")
  .action(
    async (
      upgrade: string,
      site: string | undefined,
      opts: { fleet?: string; workdir?: string; cwd?: string; verbose?: boolean },
    ) =>
      runOrExit(
        async () => (await import("./commands/upgrade.js")).runUpgradeCommand(upgrade, site, opts),
        opts,
      ),
  );

cli
  .command(
    "convert-to-pnpm [site]",
    "Convert an npm/yarn site to pnpm (lockfile, packageManager, scripts).",
  )
  .option(
    "--fleet <inventory>",
    'Inventory file (.json or .mjs/.js), or "airtable" to read from Websites table',
  )
  .option("--workdir <path>", "Clone target for fleet mode (default ~/.reddoor-maint/sites)")
  .action(
    async (site, opts: { fleet?: string; workdir?: string; cwd?: string; verbose?: boolean }) =>
      runOrExit(
        async () =>
          (await import("./commands/convert-to-pnpm.js")).runConvertToPnpmCommand(site, opts),
        opts,
      ),
  );

cli
  .command("svelte-codemods [site]", "Apply Svelte 5 gotcha codemods to an already-migrated site.")
  .option(
    "--fleet <inventory>",
    'Inventory file (.json or .mjs/.js), or "airtable" to read from Websites table',
  )
  .option("--workdir <path>", "Clone target for fleet mode (default ~/.reddoor-maint/sites)")
  .action(
    async (site, opts: { fleet?: string; workdir?: string; cwd?: string; verbose?: boolean }) =>
      runOrExit(
        async () =>
          (await import("./commands/svelte-codemods.js")).runSvelteCodemodsCommand(site, opts),
        opts,
      ),
  );

cli
  .command(
    "onboard [site]",
    "Install @reddoorla/maintenance + audit deps on a site (run after convert-to-pnpm).",
  )
  .option("--audits <names>", "Comma-separated audit subset: lighthouse,a11y (default: both)")
  .option(
    "--fleet <inventory>",
    'Inventory file (.json or .mjs/.js), or "airtable" to read from Websites table',
  )
  .option("--workdir <path>", "Clone target for fleet mode (default ~/.reddoor-maint/sites)")
  .action(
    async (
      site,
      opts: {
        audits?: string;
        fleet?: string;
        workdir?: string;
        cwd?: string;
        verbose?: boolean;
      },
    ) =>
      runOrExit(
        async () => (await import("./commands/onboard.js")).runOnboardCommand(site, opts),
        opts,
      ),
  );

cli
  .command(
    "init [site]",
    "One-shot guided onboarding: convert-to-pnpm → onboard → sync-configs → svelte-codemods → a11y-fixtures-page → audit.",
  )
  .option(
    "--fleet <inventory>",
    'Inventory file (.json or .mjs/.js), or "airtable" to read from Websites table',
  )
  .option("--workdir <path>", "Clone target for fleet mode (default ~/.reddoor-maint/sites)")
  .action(
    async (site, opts: { fleet?: string; workdir?: string; cwd?: string; verbose?: boolean }) =>
      runOrExit(async () => (await import("./commands/init.js")).runInitCommand(site, opts), opts),
  );

cli
  .command(
    "launch <site>",
    "Bootstrap + first-audit a site, then draft its launch email for approval.",
  )
  .action(async (site: string, opts: { cwd?: string; verbose?: boolean }) =>
    runOrExit(
      async () => (await import("./commands/launch.js")).runLaunchCommand(site, opts),
      opts,
    ),
  );

cli
  .command(
    "announce [site]",
    "Draft the monthly-report announcement email for maintenance sites (all, or one) for approval.",
  )
  .action(async (site: string | undefined, opts: { cwd?: string; verbose?: boolean }) =>
    runOrExit(
      async () => (await import("./commands/announce.js")).runAnnounceCommand(site, opts),
      opts,
    ),
  );

cli
  .command("report [site]", "Draft or send maintenance/testing reports.")
  .option("--due", "Scan all Websites and draft overdue reports.")
  .option("--type <type>", "Single-site draft report type: Maintenance (default) or Testing.")
  .option(
    "--preview",
    "Single-site dry run; writes reports/<slug>/draft.html, never touches Airtable.",
  )
  .option(
    "--send-ready",
    "Send all Reports with Draft ready=true AND Approved to send=true AND Sent at IS NULL.",
  )
  .option(
    "--digest",
    "Email the operator one daily digest of reports ready for approval (skips when empty).",
  )
  .action(
    async (
      site,
      opts: {
        due?: boolean;
        type?: string;
        preview?: boolean;
        sendReady?: boolean;
        digest?: boolean;
        cwd?: string;
        verbose?: boolean;
      },
    ) =>
      runOrExit(
        async () => (await import("./commands/report.js")).runReportCommand(site, opts),
        opts,
      ),
  );

cli
  .command(
    "github-signals",
    "Sweep the fleet for GitHub signals (Renovate-failing/CI/last-commit) and write Airtable.",
  )
  .option("--fleet", "Run across every site in the Airtable inventory.")
  .option("--write-airtable", "Write each site's signals back to its Websites row.")
  .action(
    async (opts: { fleet?: boolean; writeAirtable?: boolean; cwd?: string; verbose?: boolean }) =>
      runOrExit(
        async () =>
          (await import("./commands/github-signals.js")).runGitHubSignalsCommand({
            fleet: opts.fleet,
            writeAirtable: opts.writeAirtable,
          }),
        opts,
      ),
  );

cli
  .command(
    "db <action>",
    "Migrate / backfill / reconcile the libSQL store (migrate | backfill | reconcile).",
  )
  .action(async (action: string, opts: { cwd?: string; verbose?: boolean }) =>
    runOrExit(async () => (await import("./commands/db.js")).runDbCommand(action, opts), opts),
  );

cli.help();
cli.version(version);

// A typo'd / unrecognized subcommand (e.g. `reddoor-maint auditt`) otherwise
// falls through cac with no matched command and exits 0 — a cron/CI typo would
// "succeed" silently. cac emits `command:*` at the end of parse() exactly when
// a positional arg was given but matched no command (a bare `reddoor-maint`,
// `--help`, and `--version` do NOT trigger it: they have no leading positional
// or are handled before this fires). Turn that into a clear stderr error +
// non-zero exit. process.argv[2] is the first positional, i.e. the bad command.
cli.on("command:*", () => {
  const unknown = cli.args[0] ?? process.argv[2] ?? "";
  console.error(
    `error: unknown command '${unknown}'. Run 'reddoor-maint --help' to see available commands.`,
  );
  process.exit(1);
});

cli.parse();
