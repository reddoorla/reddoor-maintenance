import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ESLint } from "eslint";
import {
  check as prettierCheck,
  getFileInfo as prettierFileInfo,
  resolveConfig as prettierResolveConfig,
} from "prettier";
import { glob } from "tinyglobby";
import type { AuditResult } from "../types.js";
import { siteLabel } from "../util/site.js";
import type { AuditContext } from "./util/inject.js";

const TARGET_GLOBS = ["**/*.{ts,js,svelte}"];
const IGNORE = ["node_modules/**", "dist/**", ".svelte-kit/**", "build/**", ".netlify/**"];

async function listFiles(cwd: string): Promise<string[]> {
  return glob(TARGET_GLOBS, { cwd, ignore: IGNORE, absolute: false });
}

export async function lintAudit(ctx: AuditContext): Promise<AuditResult> {
  const { site } = ctx;
  const configPath = join(site.path, "eslint.config.js");

  if (!existsSync(configPath)) {
    return {
      audit: "lint",
      site: siteLabel(site),
      status: "skip",
      summary: "no eslint config at site root",
    };
  }

  const eslint = new ESLint({
    cwd: site.path,
    overrideConfigFile: configPath,
    errorOnUnmatchedPattern: false,
  });

  const relFiles = await listFiles(site.path);

  // Pass relative paths to ESLint; its cwd is already site.path. Avoids
  // dereferencing symlinks on pnpm workspaces.
  const eslintResults = await eslint.lintFiles(relFiles);
  const eslintErrors = eslintResults.reduce((n, r) => n + r.errorCount, 0);
  const eslintWarnings = eslintResults.reduce((n, r) => n + r.warningCount, 0);

  // The site's own `prettier --check .` honours .gitignore and .prettierignore,
  // and so must this. Since #1090 the Prismic CLI writes prismicio-types.d.ts
  // and src/lib/slices/index.ts in its own style, every migrated site lists
  // both in .prettierignore, and its prismic-codegen job compares them
  // byte-for-byte with the generator, so formatting them is not an option.
  // Measured on espada after its migration: fail with 2 unformatted, against
  // warn with 0 on the commit before.
  const ignorePath = [join(site.path, ".gitignore"), join(site.path, ".prettierignore")];
  const prettierUnformatted: string[] = [];
  for (const rel of relFiles) {
    const absForResolve = join(site.path, rel);
    if ((await prettierFileInfo(absForResolve, { ignorePath })).ignored) continue;
    const source = await readFile(absForResolve, "utf-8");
    const options = (await prettierResolveConfig(absForResolve)) ?? {};
    const ok = await prettierCheck(source, { ...options, filepath: absForResolve });
    if (!ok) prettierUnformatted.push(rel);
  }

  const status: AuditResult["status"] =
    eslintErrors > 0 || prettierUnformatted.length > 0
      ? "fail"
      : eslintWarnings > 0
        ? "warn"
        : "pass";

  const summary =
    status === "pass"
      ? `lint clean across ${relFiles.length} files`
      : `${eslintErrors} eslint errors, ${eslintWarnings} warnings, ${prettierUnformatted.length} unformatted`;

  return {
    audit: "lint",
    site: siteLabel(site),
    status,
    summary,
    details: {
      eslintErrors,
      eslintWarnings,
      prettierUnformatted,
      files: relFiles.length,
    },
  };
}
