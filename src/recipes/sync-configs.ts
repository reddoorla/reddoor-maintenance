import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import type { RecipeResult, Site, ConfigName } from "../types.js";
import {
  ALL_TEMPLATES,
  KIT_CONFIG_PATH,
  templateForKit,
  templatesByName,
  type ConfigTemplate,
} from "./sync-configs/templates.js";
import { readKitMajor } from "./sync-configs/kit-major.js";
import {
  CANONICAL_GITIGNORE_ENTRIES,
  mergeGitignore,
  findTrackedArtifacts,
} from "./sync-configs/gitignore.js";
import { listTrackedFiles, removeFromIndex } from "../util/git.js";
import { withRecipe } from "./_with-recipe.js";
import {
  renovateActionGaps,
  withRenovatePinsFrom,
  RENOVATE_ACTION_CONFIG,
} from "./sync-configs/renovate-action.js";

export type SyncConfigsOptions = {
  which?: ConfigName[];
};

const GITIGNORE_CONFIG: ConfigName = "gitignore";
const SVELTE_CONFIG: ConfigName = "svelte";
const PRETTIER_IGNORE_CONFIG: ConfigName = "prettier-ignore";
const NETLIFY_CONFIG: ConfigName = "netlify";

/** A site's `svelte.config.js` is "compliant" — and left untouched by sync —
 * once it builds on the canonical helpers (createSvelteConfig + adapter-netlify).
 *
 * Unlike the other exact-match templates, svelte.config legitimately carries
 * site-specific `kit.alias` and `compilerOptions`; an exact overwrite would
 * clobber those on every sync (it silently dropped MSOT's $utils alias,
 * 2026-06-04). So once a config is on the canonical pattern we preserve it as-is
 * and only rewrite a genuinely off-pattern (or missing) config. `createSvelteConfig`
 * now provides the canonical `$lib` aliases itself, and a site's own `kit.alias`
 * overrides per key (and may add more), so a site's additive customization is safe
 * to preserve. */
function isSvelteConfigCompliant(contents: string): boolean {
  // Not on the canonical adapter (a missing file, or `adapter-auto` from a
  // stock `npm create svelte`) => bring it to the template.
  if (!contents.includes("@sveltejs/adapter-netlify")) return false;
  // The canonical shape: the helper supplies fleet aliases, the warning filter
  // and CSP defaults.
  if (contents.includes("createSvelteConfig")) return true;
  // A hand-authored config with its own `kit` block is deliberate customization,
  // not drift. Requiring the helper string treated four live sites as off-pattern
  // — the-pointe-burbank (151 lines), beachfront-dentistry (241), 1836dig,
  // data-dynamiq — plus reddoor-starter, whose placeholder-repo prerender
  // tolerance is the only reason a freshly cloned site builds green. Replacing
  // any of those with the 8-line template is the clobbering bug this predicate
  // exists to prevent (MSOT's $utils aliases, 2026-06-04), not a fix for it.
  // A stub with no `kit` config at all still gets the template.
  return /\bkit\s*:/.test(contents);
}

/** A SvelteKit 3 site's `sveltekit.config.js` is compliant on the canonical
 * adapter. Kit 3's options are top-level, so there is no `kit` block to look
 * for, and a hand-authored config (the starter's is ~240 lines) is deliberate
 * customization for the same reason as {@link isSvelteConfigCompliant}'s. */
function isKitConfigCompliant(contents: string): boolean {
  return contents.includes("@sveltejs/adapter-netlify");
}

/** Any of the baseline security headers — the marker that a netlify.toml is
 * deliberately hardened (vs. e.g. a cache-control-only `[[headers]]` block). */
const SECURITY_HEADER_RE =
  /Strict-Transport-Security|Content-Security-Policy|X-Frame-Options|X-Content-Type-Options|Referrer-Policy|Permissions-Policy|Cross-Origin-Opener-Policy/i;

/** A site's `netlify.toml` is "compliant" — and left untouched by sync — once it
 * carries a `[[headers]]` block AND a security header (HSTS/CSP/X-Frame-Options/…).
 *
 * Like svelte.config, netlify.toml legitimately holds site-specific config
 * (custom CSP, redirects, per-route headers). The canonical template ships the
 * baseline security headers, but an exact overwrite would CLOBBER a site's own
 * hardening — that bug stripped gallerysonder's headers on a routine sync
 * (2026-06-10). So a genuinely-hardened file is left alone, while a missing,
 * header-less (previously-stripped), OR merely cache-header file is non-compliant
 * and gets the canonical template, which backfills the security baseline. */
function isNetlifyConfigCompliant(contents: string): boolean {
  return contents.includes("[[headers]]") && SECURITY_HEADER_RE.test(contents);
}

/** Runtime enumeration of every `ConfigName`. Mirror of the union in
 * `src/types.ts`. Used by CLI `--only` validation; a missing entry would
 * silently accept typos. The type-test in `tests/types.test.ts` guards
 * against drift between this array and the union. */
export const ALL_CONFIG_NAMES: ConfigName[] = [
  "lighthouse",
  "eslint",
  "prettier",
  "prettier-ignore",
  "playwright-a11y",
  "svelte",
  "gitignore",
  "renovate-action",
  "renovate-config",
  "netlify",
];

export function isConfigName(value: string): value is ConfigName {
  return (ALL_CONFIG_NAMES as string[]).includes(value);
}

async function readMaybe(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf-8");
  } catch {
    return null;
  }
}

export async function planTemplateDiffs(
  cwd: string,
  templates: ConfigTemplate[],
): Promise<ConfigTemplate[]> {
  const diffs: ConfigTemplate[] = [];
  const kitMajor = await readKitMajor(cwd);
  const kit3 = typeof kitMajor === "number" && kitMajor >= 3;
  // On kit 3 the config may live in sveltekit.config.js (the starter's shape)
  // or inline in vite.config.ts (kit's own default). sync-configs owns neither
  // vite.config.ts nor the choice, so with no sveltekit.config.js it writes no
  // config (a second one nothing reads) and no eslint.config.js importing one.
  // A kit spec it cannot read gets neither: either guess breaks one major.
  const kitConfigPresent = kit3 && (await readMaybe(join(cwd, KIT_CONFIG_PATH))) !== null;
  const skipKitFiles = kitMajor === "unreadable" || (kit3 && !kitConfigPresent);
  for (const base of templates) {
    const t = templateForKit(base, kit3 ? kitMajor : null);
    if (skipKitFiles && (t.config === SVELTE_CONFIG || t.config === "eslint")) continue;
    const existing = await readMaybe(join(cwd, t.path));
    if (existing === t.contents) continue;
    // svelte.config is compliance-checked, not exact-matched: an existing config
    // already on the canonical pattern is left alone so its aliases/compilerOptions
    // survive. A missing (null) or off-pattern config still gets the canonical template.
    if (
      t.config === SVELTE_CONFIG &&
      existing !== null &&
      (kit3 ? isKitConfigCompliant(existing) : isSvelteConfigCompliant(existing))
    ) {
      continue;
    }
    // netlify.toml is likewise compliance-checked: a file that already carries
    // `[[headers]]` is hardened and left alone (an exact overwrite would strip
    // its security headers). A header-less / missing file gets the template.
    if (t.config === NETLIFY_CONFIG && existing !== null && isNetlifyConfigCompliant(existing)) {
      continue;
    }
    // renovate.yml is likewise compliance-checked, not byte-matched: Renovate
    // legitimately bumps its own digest pins forward (an exact overwrite would
    // DOWNGRADE them — reddoorla/reddoor-starter-blux#1, 2026-08-31), and a
    // site's prettier may legitimately quote the cron / RENOVATE_* scalars
    // differently than the template (both forms are prettier-clean, so
    // prettier never converges them — issue #651). A file with zero
    // `renovateActionGaps` is left alone.
    if (
      t.config === RENOVATE_ACTION_CONFIG &&
      existing !== null &&
      renovateActionGaps(existing).length === 0
    ) {
      continue;
    }
    // When renovate.yml genuinely IS non-compliant, heal it with the template
    // but carry the site's own (still-digest-pinned) action refs forward onto
    // it first — writing the template verbatim would re-introduce the same
    // pin downgrade this compliance check exists to prevent.
    if (t.config === RENOVATE_ACTION_CONFIG) {
      diffs.push({ ...t, contents: withRenovatePinsFrom(t.contents, existing) });
      continue;
    }
    // .prettierignore is MERGED, not overwritten — the same treatment
    // .gitignore has always had, because it is the same kind of file: a list a
    // site legitimately extends. reddoor-starter adds the Slice Machine-
    // generated `src/prismicio-types.d.ts`, whose reformatting on a prettier
    // version bump reds `prettier --check` on otherwise-fine dependency PRs.
    // An exact overwrite silently deleted that and re-armed the failure.
    if (t.config === PRETTIER_IGNORE_CONFIG) {
      const merged = mergeGitignore(existing, canonicalIgnoreEntries(t.contents));
      if (merged.added.length === 0) continue;
      diffs.push({ ...t, contents: merged.content });
      continue;
    }
    diffs.push(t);
  }
  return diffs;
}

export type KitHazard = { path: string; note: string };

/**
 * What sync-configs can see is wrong on a site but will not fix by writing a
 * template. Removing or moving a config is a move, not a sync: its options must
 * reach `sveltekit(...)` first, and sync-configs never deletes a site's file.
 *  - kit 3 with a `svelte.config.js`: kit refuses to start beside it
 *    (config_file_unsupported). This is what a Renovate kit 3 bump with no
 *    migration looks like.
 *  - kit 3 with no `sveltekit.config.js` (config inline in vite.config.ts) and
 *    an `eslint.config.js` still importing `./svelte.config.js`.
 *  - a kit spec sync-configs cannot read, so it left both files alone.
 */
export async function planKitHazards(cwd: string): Promise<KitHazard[]> {
  const kitMajor = await readKitMajor(cwd);
  if (kitMajor === "unreadable") {
    return [
      {
        path: "package.json",
        note:
          "package.json declares @sveltejs/kit with a spec sync-configs cannot read (a catalog, " +
          "workspace or git spec), so it left svelte.config.js and eslint.config.js alone: " +
          "check them against the site's real kit major by hand",
      },
    ];
  }
  if (kitMajor === null || kitMajor < 3) return [];
  const hazards: KitHazard[] = [];
  if ((await readMaybe(join(cwd, "svelte.config.js"))) !== null) {
    hazards.push({
      path: "svelte.config.js",
      note:
        `svelte.config.js is present on SvelteKit ${kitMajor}, which refuses to start beside it ` +
        "(config_file_unsupported): move its options into the sveltekit(...) plugin " +
        `(the starter keeps them in ${KIT_CONFIG_PATH}) and delete it`,
    });
  }
  const eslint = await readMaybe(join(cwd, "eslint.config.js"));
  if (
    (await readMaybe(join(cwd, KIT_CONFIG_PATH))) === null &&
    eslint !== null &&
    /["']\.\/svelte\.config\.js["']/.test(eslint)
  ) {
    hazards.push({
      path: "eslint.config.js",
      note:
        `eslint.config.js imports ./svelte.config.js, which SvelteKit ${kitMajor} does not use: ` +
        "import the object vite.config.ts passes to sveltekit(...) instead",
    });
  }
  return hazards;
}

/** The template's own entries, minus comments and blank lines — the set a site
 *  must contain for its .prettierignore to be considered complete. */
function canonicalIgnoreEntries(templateContents: string): string[] {
  return templateContents
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "" && !l.startsWith("#"));
}

export type GitignorePlan =
  { kind: "noop" } | { kind: "apply"; content: string; toUntrack: string[]; added: string[] };

export async function planGitignore(
  cwd: string,
  tracked?: readonly string[],
): Promise<GitignorePlan> {
  const existing = await readMaybe(join(cwd, ".gitignore"));
  const merge = mergeGitignore(existing, CANONICAL_GITIGNORE_ENTRIES);
  tracked ??= await listTrackedFiles(cwd);
  const toUntrack = findTrackedArtifacts(tracked, CANONICAL_GITIGNORE_ENTRIES);
  if (merge.added.length === 0 && toUntrack.length === 0) return { kind: "noop" };
  return { kind: "apply", content: merge.content, toUntrack, added: merge.added };
}

async function applyGitignore(
  cwd: string,
  plan: Extract<GitignorePlan, { kind: "apply" }>,
): Promise<void> {
  await writeFile(join(cwd, ".gitignore"), plan.content, "utf-8");
  if (plan.toUntrack.length > 0) {
    await removeFromIndex(cwd, plan.toUntrack);
  }
}

export async function syncConfigs(
  site: Site,
  opts: SyncConfigsOptions = {},
): Promise<RecipeResult> {
  const requested = opts.which ?? ALL_TEMPLATES.map((t) => t.config).concat(GITIGNORE_CONFIG);
  const templateNames = requested.filter((c): c is ConfigName => c !== GITIGNORE_CONFIG);
  const templates = templatesByName(templateNames);
  const includeGitignore = requested.includes(GITIGNORE_CONFIG);

  return withRecipe({
    name: "sync-configs",
    site,
    plan: async () => {
      const templateDiffs = await planTemplateDiffs(site.path, templates);
      const gitignorePlan: GitignorePlan = includeGitignore
        ? await planGitignore(site.path)
        : { kind: "noop" };
      const hazards = templateNames.includes(SVELTE_CONFIG) ? await planKitHazards(site.path) : [];
      if (templateDiffs.length === 0 && gitignorePlan.kind === "noop") {
        return {
          kind: "noop",
          notes: ["all targeted configs already match", ...hazards.map((h) => h.note)].join("\n"),
        };
      }
      return { kind: "apply", plan: { templateDiffs, gitignorePlan, hazards } };
    },
    apply: async ({ templateDiffs, gitignorePlan, hazards }, { commit }) => {
      for (const t of templateDiffs) {
        const dest = join(site.path, t.path);
        await mkdir(dirname(dest), { recursive: true });
        await writeFile(dest, t.contents, "utf-8");
        await commit(`chore: sync ${t.config} config from @reddoorla/maintenance`);
      }
      if (gitignorePlan.kind === "apply") {
        await applyGitignore(site.path, gitignorePlan);
        await commit(`chore: sync gitignore from @reddoorla/maintenance`);
      }
      return hazards.length > 0
        ? { kind: "ok", notes: hazards.map((h) => h.note).join("\n") }
        : { kind: "ok" };
    },
  });
}
