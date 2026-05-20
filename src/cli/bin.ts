#!/usr/bin/env node
import { cac } from "cac";
import type { AuditName, RecipeName } from "../types.js";

const AUDIT_DESCRIPTIONS: Record<AuditName, string> = {
  deps: "Diff site package.json against the bundled baseline version map.",
  lighthouse: "Run @lhci/cli autorun using the canonical lighthouserc.",
  a11y: "Playwright + axe against the canonical a11y routes.",
  security: "pnpm audit (falls back to npm audit), prod-deps by default.",
  lint: "ESLint + Prettier using the canonical configs.",
};

const RECIPE_DESCRIPTIONS: Record<RecipeName, string> = {
  "sync-configs": "Overwrite a site's canonical configs to match @reddoor/maintenance.",
  "bump-deps": "Bump dependencies and commit the lockfile change.",
  "svelte-4-to-5": "Run the 7-commit Svelte 4 → 5 upgrade recipe.",
};

const cli = cac("reddoor-maint");

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

cli.help();
cli.version("0.0.1");

cli.parse();
