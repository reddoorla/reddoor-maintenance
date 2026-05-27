#!/usr/bin/env node
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { cac } from "cac";
import type { AuditName, RecipeName } from "../types.js";
import { runAuditCommand } from "./commands/audit.js";
import { runSyncConfigsCommand } from "./commands/sync-configs.js";
import { runBumpDepsCommand } from "./commands/bump-deps.js";
import { runUpgradeCommand } from "./commands/upgrade.js";
import { runConvertToPnpmCommand } from "./commands/convert-to-pnpm.js";
import { runOnboardCommand } from "./commands/onboard.js";
import { runSvelteCodemodsCommand } from "./commands/svelte-codemods.js";
import { runReportCommand } from "./commands/report.js";
import { resolvePackageVersion } from "./version.js";

const here = dirname(fileURLToPath(import.meta.url));
const version = resolvePackageVersion(here);

const AUDIT_DESCRIPTIONS: Record<AuditName, string> = {
  deps: "Diff site package.json against the bundled baseline version map.",
  lighthouse: "Run @lhci/cli autorun using the canonical lighthouserc.",
  a11y: "Playwright + axe against the canonical a11y routes.",
  security: "pnpm audit (falls back to npm audit), prod-deps by default.",
  lint: "ESLint + Prettier using the canonical configs.",
};

const RECIPE_DESCRIPTIONS: Record<RecipeName, string> = {
  "sync-configs": "Overwrite a site's canonical configs to match @reddoorla/maintenance.",
  "bump-deps": "Bump dependencies and commit the lockfile change.",
  "svelte-4-to-5": "Run the 7-commit Svelte 4 → 5 upgrade recipe.",
  "svelte-codemods":
    "Apply Svelte 5 gotcha codemods to an already-migrated site (state_referenced_locally, etc.).",
  "convert-to-pnpm": "Convert an npm/yarn site to pnpm (lockfile, packageManager, scripts).",
  onboard: "Install @reddoorla/maintenance + audit deps on a site (preferred first step).",
};

/** Run a command thunk and exit with its code, falling back to a clean
 * error message on throw. Wraps the ~10-line try/catch every `.action()`
 * used to duplicate. `verbose` flips between full stack and message-only. */
async function runOrExit(
  fn: () => Promise<{ output: string; code: number }>,
  opts: { verbose?: boolean },
): Promise<void> {
  try {
    const { output, code } = await fn();
    console.log(output);
    process.exit(code);
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
      },
    ) => runOrExit(() => runAuditCommand(site, opts), opts),
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
    ) => runOrExit(() => runSyncConfigsCommand(site, opts), opts),
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
    ) => runOrExit(() => runBumpDepsCommand(site, opts), opts),
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
    ) => runOrExit(() => runUpgradeCommand(upgrade, site, opts), opts),
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
      runOrExit(() => runConvertToPnpmCommand(site, opts), opts),
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
      runOrExit(() => runSvelteCodemodsCommand(site, opts), opts),
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
    ) => runOrExit(() => runOnboardCommand(site, opts), opts),
  );

cli
  .command("report [site]", "Draft or send maintenance/testing reports.")
  .option("--due", "Scan all Websites and draft overdue reports.")
  .option(
    "--preview",
    "Single-site dry run; writes reports/<slug>/draft.html, never touches Airtable.",
  )
  .option(
    "--send-ready",
    "Send all Reports with Draft ready=true AND Approved to send=true AND Sent at IS NULL.",
  )
  .action(
    async (
      site,
      opts: {
        due?: boolean;
        preview?: boolean;
        sendReady?: boolean;
        cwd?: string;
        verbose?: boolean;
      },
    ) => runOrExit(() => runReportCommand(site, opts), opts),
  );

cli.help();
cli.version(version);

cli.parse();
