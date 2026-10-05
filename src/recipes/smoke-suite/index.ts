import { access, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { RecipeResult, Site } from "../../types.js";
import { withRecipe } from "../_with-recipe.js";
import { defaultSpawn, type SpawnFn } from "../../audits/util/spawn.js";
import { formatWithPrettier, resolveTargetPrettier, PRETTIER_FLAG_NOTE } from "../_prettier.js";
import { refusedByGit, undoRefusedWrites, RESTORED_NOTE } from "../_head-guard.js";
import {
  SMOKE_ROUTES_RELATIVE,
  SMOKE_ROUTES_TEMPLATE,
  SMOKE_SPEC_RELATIVE,
  SMOKE_SPEC_TEMPLATE,
  PLAYWRIGHT_CONFIG_RELATIVE,
  PLAYWRIGHT_CONFIG_TEMPLATE,
  PLAYWRIGHT_CONFIG_PRE_R11,
} from "./template.js";

export type SmokeSuiteDeps = {
  spawn: SpawnFn;
  /** Resolve the TARGET repo's own prettier. Injected so a test can assert the
   *  absolute-path spawn without a populated `node_modules`. */
  resolvePrettier?: (repoRoot: string) => Promise<string | null>;
};

/** Same budget as prismic-ci and match-harness. Without one the default spawn
 *  never detaches and never kills, so a hung formatter runs unbounded. */
const PRETTIER_TIMEOUT_MS = 60_000;

/** What "the smoke suite is installed" means, as paths a fresh clone must get.
 *  package.json is deliberately absent: it is already tracked on every site the
 *  recipe runs on, so it can never be the path git silently drops — and it is
 *  exactly what makes the drop invisible, because its edit alone produces a
 *  commit and therefore an "applied". */
export const SMOKE_SUITE_INSTALLED_PATHS = [
  SMOKE_ROUTES_RELATIVE,
  SMOKE_SPEC_RELATIVE,
  PLAYWRIGHT_CONFIG_RELATIVE,
] as const;

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

/** The template's default hydration marker, and the sentence explaining it —
 *  swapped for a fallback explanation when the marker deviates. Must match
 *  template.ts. */
const HYDRATED_MARKER = "html[data-hydrated]";
const HYDRATED_MARKER_SENTENCE =
  "The hydration marker `html[data-hydrated]`\n" +
  "// is written only by the root layout's onMount, so it matches only once script\n" +
  "// has taken the page over (a server-rendered element such as `footer` is\n" +
  "// visible with the bundle missing).";

const ADD_MARKER_HINT =
  'set `document.documentElement.dataset.hydrated = ""` in the root layout\'s onMount ' +
  "and point the marker at `html[data-hydrated]`";

function fallbackMarkerSentence(marker: FallbackMarker): string {
  const why =
    marker === "footer"
      ? "nothing in this site's Svelte source writes\n// `html[data-hydrated]`"
      : "nothing in this site's Svelte source writes\n// `html[data-hydrated]` and no <footer> element exists";
  return (
    `The hydration marker \`${marker}\` is a\n` +
    `// fallback: ${why}. It is server-rendered, so it\n` +
    "// proves paint, not hydration. To prove hydration, set\n" +
    '// `document.documentElement.dataset.hydrated = ""` in the root layout\'s onMount\n' +
    "// and point the marker at `html[data-hydrated]`."
  );
}

type FallbackMarker = "footer" | "main" | "body";

/** A Svelte source line that writes the marker on the document root: the
 *  starter's `document.documentElement.dataset.hydrated = …`, or a
 *  `setAttribute` of it. Anchored on `documentElement`, because the same write
 *  on any other element (a carousel's own `data-hydrated`) leaves `<html>`
 *  bare. A writer this misses falls back to a server-rendered marker, which
 *  proves less but never false-fails: a `.ts` file, `dataset["hydrated"]`, a
 *  `//` inside a string on the write's line, or a `/*` inside a string (an
 *  `import.meta.glob("/src/posts/*.md")`) that the comment pass blanks up to a
 *  later `*\/`. Any `.svelte` file counts, not only the root layout. */
const WRITES_HYDRATED_MARKER =
  /documentElement\s*\.\s*(?:dataset\.hydrated\s*=[^=]|setAttribute\(\s*["'`]data-hydrated["'`])/;

/** Svelte source with its markup, block and line comments blanked, so a
 *  comment that names the write is not taken for one. */
function withoutComments(text: string): string {
  return text
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

/** The template's `html[data-hydrated]` marker needs the site's root layout to
 *  write it, or EVERY route check false-fails, as `footer` once did on a site
 *  with no footer (la-homelessness-initiative red'd the first fleet-smoke run
 *  exactly this way). The fleet takes the starter's marker as per-repo PRs, so
 *  most sites do not write it yet. Keep the default only on positive evidence
 *  that some Svelte file writes it; otherwise prove paint with the first
 *  server-rendered element the site has: a literal lowercase `<footer` (a
 *  capital-F `<Footer` component tag proves nothing — the element the browser
 *  paints lives inside that component), then `<main`, then `body`. No svelte
 *  files at all → no signal → keep the template default. */
async function detectHydrationMarker(
  cwd: string,
): Promise<typeof HYDRATED_MARKER | FallbackMarker> {
  let entries: string[];
  try {
    entries = (await readdir(join(cwd, "src"), { recursive: true })) as string[];
  } catch {
    return HYDRATED_MARKER;
  }
  const svelteFiles = entries.filter((p) => p.endsWith(".svelte"));
  if (svelteFiles.length === 0) return HYDRATED_MARKER;
  let sawFooter = false;
  let sawMain = false;
  for (const rel of svelteFiles) {
    const text = (await readIfExists(join(cwd, "src", rel))) ?? "";
    if (WRITES_HYDRATED_MARKER.test(withoutComments(text))) return HYDRATED_MARKER;
    if (/<footer[\s>/]/.test(text)) sawFooter = true;
    if (/<main[\s>/]/.test(text)) sawMain = true;
  }
  return sawFooter ? "footer" : sawMain ? "main" : "body";
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
      // ...and what each of those paths held BEFORE this run, so a path git then
      // refuses can be put back exactly as it was (null = did not exist).
      const before = new Map<string, string | null>();

      // 1. Spec files — write if absent (never clobber operator edits). The
      //    routes manifest ships the starter's `html[data-hydrated]` marker only
      //    when the site's source writes it; otherwise it falls back to `footer`,
      //    `main`, then `body`, so the suite proves paint instead of
      //    false-failing.
      let routesTemplate = SMOKE_ROUTES_TEMPLATE;
      if (!(await fileExists(join(cwd, SMOKE_ROUTES_RELATIVE)))) {
        const marker = await detectHydrationMarker(cwd);
        if (marker !== HYDRATED_MARKER) {
          routesTemplate = SMOKE_ROUTES_TEMPLATE.replace(
            `hydrationMarker: "${HYDRATED_MARKER}"`,
            `hydrationMarker: "${marker}"`,
          ).replace(HYDRATED_MARKER_SENTENCE, fallbackMarkerSentence(marker));
          notes.push(
            `nothing in src/**/*.svelte writes html[data-hydrated]` +
              (marker === "footer" ? "" : " and no <footer> element renders") +
              ` — hydration marker set to "${marker}", which proves paint, not hydration ` +
              `(${ADD_MARKER_HINT})`,
          );
        }
      }
      const specFiles: Array<[string, string]> = [
        [SMOKE_ROUTES_RELATIVE, routesTemplate],
        [SMOKE_SPEC_RELATIVE, SMOKE_SPEC_TEMPLATE],
      ];
      for (const [rel, tmpl] of specFiles) {
        const target = join(cwd, rel);
        if (!(await fileExists(target))) {
          await mkdir(dirname(target), { recursive: true });
          await writeFile(target, tmpl, "utf-8");
          written.push(rel);
          before.set(rel, null);
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
        before.set(PLAYWRIGHT_CONFIG_RELATIVE, null);
      } else if (existingCfg.includes("REDDOOR_SMOKE_PORT")) {
        // Already R1.1-aware; leave it.
      } else if (existingCfg.trim() === PLAYWRIGHT_CONFIG_PRE_R11.trim()) {
        await writeFile(cfgPath, PLAYWRIGHT_CONFIG_TEMPLATE, "utf-8");
        written.push(PLAYWRIGHT_CONFIG_RELATIVE);
        before.set(PLAYWRIGHT_CONFIG_RELATIVE, existingCfg);
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
      // Unit-test scripts (`test:unit` / `test` → "vitest run") only when the site
      // actually runs vitest — either it depends on vitest, or it already defines a
      // `test` script. Adding `test: "vitest run"` to a site WITHOUT vitest makes
      // the shared CI's "run the test script if present" step fail with
      // `vitest: not found` (the whole fleet-smoke batch red'd on exactly this).
      const hasVitest = !!(pkg.devDependencies?.vitest || pkg.dependencies?.vitest);
      const existingTest = pkg.scripts["test"];
      if (hasVitest || existingTest !== undefined) {
        if (!pkg.scripts["test:unit"]) {
          pkg.scripts["test:unit"] = existingTest ?? "vitest run";
          pkgChanged = true;
        }
        if (pkg.scripts["test"] === undefined) {
          pkg.scripts["test"] = "vitest run";
          pkgChanged = true;
        }
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
      //
      //    Resolved AFTER step 4 so a site that just gained its devDependencies
      //    has a prettier to run — and resolved POSITIVELY, invoked by absolute
      //    path. `pnpm exec prettier` would, on a clone with no node_modules
      //    (the NORMAL path on `--fleet`, because `prepareFleetSites` clones and
      //    never installs), first run a full unbounded `pnpm install` in the
      //    client's checkout and then, in a repo whose install left no prettier
      //    of its own, fall through to the CALLING repo's binary and exit 0. A
      //    clone with no prettier gets the flag note and no spawn at all (#737).
      if (written.length > 0) {
        const bin = await (deps.resolvePrettier ?? resolveTargetPrettier)(cwd);
        if (bin === null) {
          notes.push(PRETTIER_FLAG_NOTE);
        } else if (
          !(await formatWithPrettier(deps.spawn, cwd, written, {
            bin,
            timeoutMs: PRETTIER_TIMEOUT_MS,
          }))
        ) {
          notes.push(PRETTIER_FLAG_NOTE);
        }
      }

      // 6. Commit. If nothing was written/changed the commit stages nothing and
      //    withRecipe reports noop (the flag note, if any, is still surfaced).
      await commit("feat: add smoke suite (test:smoke + playwright config + /health smoke routes)");

      // 7. Did git TAKE the suite? This is the sharpest case of the class
      //    (#741): package.json is tracked and always changes, so `commit()`
      //    returns a SHA and the result reads "applied" even when the two spec
      //    files the suite CONSISTS OF were dropped by a `tests/` rule. CI then
      //    runs `test:smoke` against a suite that exists on nobody's disk.
      const refusal = await refusedByGit(cwd, SMOKE_SUITE_INSTALLED_PATHS, "the smoke suite");
      if (refusal) {
        await undoRefusedWrites(cwd, before, refusal.missing);
        return { kind: "failed", notes: refusal.notes + RESTORED_NOTE };
      }

      return notes.length > 0 ? { kind: "ok", notes: notes.join("; ") } : { kind: "ok" };
    },
  });
}
