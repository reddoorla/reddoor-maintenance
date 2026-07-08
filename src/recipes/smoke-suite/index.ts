import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { RecipeResult, Site } from "../../types.js";
import { withRecipe } from "../_with-recipe.js";
import { defaultSpawn, type SpawnFn } from "../../audits/util/spawn.js";
import { formatWithPrettier, PRETTIER_FLAG_NOTE } from "../_prettier.js";
import {
  SMOKE_ROUTES_RELATIVE,
  SMOKE_ROUTES_TEMPLATE,
  SMOKE_SPEC_RELATIVE,
  SMOKE_SPEC_TEMPLATE,
  PLAYWRIGHT_CONFIG_RELATIVE,
  PLAYWRIGHT_CONFIG_TEMPLATE,
  PLAYWRIGHT_CONFIG_PRE_R11,
} from "./template.js";

export type SmokeSuiteDeps = { spawn: SpawnFn };

type PackageJson = {
  scripts?: Record<string, string>;
  devDependencies?: Record<string, string>;
  dependencies?: Record<string, string>;
};

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function readIfExists(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf-8");
  } catch {
    return null;
  }
}

/**
 * Adds the smoke suite to a site: the `tests/smoke/*` specs, a `test:smoke` /
 * `test:unit` script split, `@playwright/test`, and a `playwright.config.ts`
 * that honors `REDDOOR_SMOKE_PORT` (R1.1). Conservative + partial-apply — every
 * file is noop-if-exists, every `package.json` script/dep is add-if-absent, and
 * an existing config that isn't a recognizable shared-base shape is left
 * untouched and flagged for a manual R1.1 patch (never a destructive write).
 * A site with no `package.json` noops (not a node project). Branch+commit per site.
 */
export async function smokeSuite(
  site: Site,
  deps: SmokeSuiteDeps = { spawn: defaultSpawn },
): Promise<RecipeResult> {
  const pkgPath = join(site.path, "package.json");
  return withRecipe<{ pkgPath: string; pkg: PackageJson }>({
    name: "smoke-suite",
    site,
    plan: async () => {
      // Parse in the read-only plan phase so a missing OR unparseable
      // package.json noops cleanly (spec: structurally unrecognizable → noop),
      // BEFORE apply writes any file. A bad JSON that only threw in apply would
      // leave the (safely-restored) branch as a `failed`, not the graceful noop.
      const raw = await readIfExists(pkgPath);
      if (raw === null) {
        return { kind: "noop", notes: "no package.json (not a node project)" };
      }
      let pkg: PackageJson;
      try {
        pkg = JSON.parse(raw) as PackageJson;
      } catch {
        return { kind: "noop", notes: "unparseable package.json — skipped" };
      }
      return { kind: "apply", plan: { pkgPath, pkg } };
    },
    apply: async (planned, { commit, cwd }) => {
      const notes: string[] = [];
      // Relative paths this run actually wrote/changed — prettier-formatted to the
      // site's own config before committing (never operator files we left alone).
      const written: string[] = [];

      // 1. Spec files — write if absent (never clobber operator edits).
      const specFiles: Array<[string, string]> = [
        [SMOKE_ROUTES_RELATIVE, SMOKE_ROUTES_TEMPLATE],
        [SMOKE_SPEC_RELATIVE, SMOKE_SPEC_TEMPLATE],
      ];
      for (const [rel, tmpl] of specFiles) {
        const target = join(cwd, rel);
        if (!(await fileExists(target))) {
          await mkdir(dirname(target), { recursive: true });
          await writeFile(target, tmpl, "utf-8");
          written.push(rel);
        }
      }

      // 2. playwright.config.ts — four cases, never an in-place edit: absent →
      //    write R1.1; already has REDDOOR_SMOKE_PORT → leave; exact pre-R1.1
      //    shared-base → safe-replace wholesale; anything else → flag for manual.
      const cfgPath = join(cwd, PLAYWRIGHT_CONFIG_RELATIVE);
      const existingCfg = await readIfExists(cfgPath);
      if (existingCfg === null) {
        await writeFile(cfgPath, PLAYWRIGHT_CONFIG_TEMPLATE, "utf-8");
        written.push(PLAYWRIGHT_CONFIG_RELATIVE);
      } else if (existingCfg.includes("REDDOOR_SMOKE_PORT")) {
        // Already R1.1-aware; leave it.
      } else if (existingCfg.trim() === PLAYWRIGHT_CONFIG_PRE_R11.trim()) {
        await writeFile(cfgPath, PLAYWRIGHT_CONFIG_TEMPLATE, "utf-8");
        written.push(PLAYWRIGHT_CONFIG_RELATIVE);
      } else {
        notes.push(
          "playwright.config.ts exists without REDDOOR_SMOKE_PORT — add the R1.1 port block manually",
        );
      }

      // 3. package.json — add-if-absent scripts + @playwright/test. Only rewrite
      //    when something changed, so a re-run of a fully-adopted site noops
      //    instead of churning the file. (Parsed in plan; see above.)
      const pkg = planned.pkg;
      let pkgChanged = false;
      pkg.scripts ??= {};
      if (!pkg.scripts["test:smoke"]) {
        pkg.scripts["test:smoke"] = "playwright install chromium && playwright test";
        pkgChanged = true;
      }
      if (!pkg.scripts["test:unit"]) {
        pkg.scripts["test:unit"] = pkg.scripts["test"] ?? "vitest run";
        pkgChanged = true;
      }
      if (!pkg.scripts["test"]) {
        pkg.scripts["test"] = "vitest run";
        pkgChanged = true;
      }
      let depsChanged = false;
      const hasPlaywright =
        !!pkg.devDependencies?.["@playwright/test"] || !!pkg.dependencies?.["@playwright/test"];
      if (!hasPlaywright) {
        pkg.devDependencies ??= {};
        pkg.devDependencies["@playwright/test"] = "^1.60.0";
        depsChanged = true;
        pkgChanged = true;
      }
      if (pkgChanged) {
        await writeFile(planned.pkgPath, JSON.stringify(pkg, null, 2) + "\n", "utf-8");
        written.push("package.json");
      }

      // 4. Install only when a dep was added (streaming, so the operator sees
      //    progress; matches bump-deps). A failed install aborts the recipe.
      if (depsChanged) {
        const res = await deps.spawn("pnpm", ["install"], { cwd, streaming: true });
        if (res.code !== 0) {
          return { kind: "failed", notes: `pnpm install failed (exit ${res.code})` };
        }
      }

      // 5. Format everything this run wrote to the site's own prettier config, so
      //    fleet CI's format check stays green across heterogeneous configs
      //    (quotes/tabs/printWidth vary). Best-effort — a site without prettier
      //    just commits unformatted with a flag note.
      if (!(await formatWithPrettier(deps.spawn, cwd, written))) {
        notes.push(PRETTIER_FLAG_NOTE);
      }

      // 6. Commit. If nothing was written/changed the commit stages nothing and
      //    withRecipe reports noop (the flag note, if any, is still surfaced).
      await commit("feat: add smoke suite (test:smoke + playwright config + /health smoke routes)");
      return notes.length > 0 ? { kind: "ok", notes: notes.join("; ") } : { kind: "ok" };
    },
  });
}
