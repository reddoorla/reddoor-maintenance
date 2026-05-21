#!/usr/bin/env node
import { cac } from "cac";
import type { AuditName, RecipeName } from "../types.js";
import { runAuditCommand } from "./commands/audit.js";
import { runSyncConfigsCommand } from "./commands/sync-configs.js";
import { runBumpDepsCommand } from "./commands/bump-deps.js";
import { runUpgradeCommand } from "./commands/upgrade.js";

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
};

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
  .option("--fleet <inventory>", "Inventory file (.json or .mjs/.js); aggregates across sites")
  .option("--workdir <path>", "Clone target for fleet mode (default ~/.reddoor-maint/sites)")
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
      },
    ) => {
      try {
        const { output, code } = await runAuditCommand(site, opts);
        console.log(output);
        process.exit(code);
      } catch (err) {
        const e = err as { exitCode?: number; message?: string; stack?: string };
        console.error(opts.verbose ? (e.stack ?? e.message) : (e.message ?? String(err)));
        process.exit(e.exitCode ?? 1);
      }
    },
  );

cli
  .command("sync-configs [site]", "Sync canonical configs into a site.")
  .option("--only <names>", "Comma-separated config names (e.g. eslint,prettier)")
  .option("--dry", "Print diff without writing")
  .option("--fleet <inventory>", "Inventory file (.json or .mjs/.js)")
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
    ) => {
      try {
        const { output, code } = await runSyncConfigsCommand(site, opts);
        console.log(output);
        process.exit(code);
      } catch (err) {
        const e = err as { exitCode?: number; message?: string; stack?: string };
        console.error(opts.verbose ? (e.stack ?? e.message) : (e.message ?? String(err)));
        process.exit(e.exitCode ?? 1);
      }
    },
  );

cli
  .command("bump-deps [site]", "Bump dependencies.")
  .option("--group <group>", "patch | minor | major", { default: "minor" })
  .option("--fleet <inventory>", "Inventory file (.json or .mjs/.js)")
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
    ) => {
      try {
        const { output, code } = await runBumpDepsCommand(site, opts);
        console.log(output);
        process.exit(code);
      } catch (err) {
        const e = err as { exitCode?: number; message?: string; stack?: string };
        console.error(opts.verbose ? (e.stack ?? e.message) : (e.message ?? String(err)));
        process.exit(e.exitCode ?? 1);
      }
    },
  );

cli
  .command("upgrade <upgrade> [site]", "Run a named upgrade recipe (svelte-4-to-5).")
  .example("reddoor-maint upgrade svelte-4-to-5 ./my-site")
  .option("--fleet <inventory>", "Inventory file (.json or .mjs/.js)")
  .option("--workdir <path>", "Clone target for fleet mode (default ~/.reddoor-maint/sites)")
  .action(
    async (
      upgrade: string,
      site: string | undefined,
      opts: { fleet?: string; workdir?: string; cwd?: string; verbose?: boolean },
    ) => {
      try {
        const { output, code } = await runUpgradeCommand(upgrade, site, opts);
        console.log(output);
        process.exit(code);
      } catch (err) {
        const e = err as { exitCode?: number; message?: string; stack?: string };
        console.error(opts.verbose ? (e.stack ?? e.message) : (e.message ?? String(err)));
        process.exit(e.exitCode ?? 1);
      }
    },
  );

cli.help();
cli.version("0.0.1");

cli.parse();
