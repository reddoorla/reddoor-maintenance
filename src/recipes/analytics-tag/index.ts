import { readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { RecipeResult, Site } from "../../types.js";
import { withRecipe } from "../_with-recipe.js";
import { refusedByGit, undoRefusedWrites, RESTORED_NOTE } from "../_head-guard.js";
import { formatWithPrettier, resolveTargetPrettier, PRETTIER_FLAG_NOTE } from "../_prettier.js";
import { defaultSpawn, type SpawnFn } from "../../audits/util/spawn.js";
import { hostnameOf, isHttpUrl } from "../../util/url.js";
import { siteHostnames } from "../../client/site-host.js";
import { HOOKS_CLIENT_RELATIVE, MEASUREMENT_ID_RE, hooksClientTemplate } from "./template.js";
import { HAND_ADD_HOSTS, planCspEdit, type CspEditPlan } from "./csp-edit.js";
import { SCAN_FILE_CAP, scanCheckout } from "../../audits/analytics.js";

const SVELTE_CONFIG_RELATIVE = "svelte.config.js";

/** Same budget as health-endpoint, smoke-suite, prismic-ci and match-harness.
 *  Without one the default spawn never detaches and never kills. */
const PRETTIER_TIMEOUT_MS = 60_000;

export type AnalyticsTagDeps = {
  spawn: SpawnFn;
  /** Resolve the TARGET repo's own prettier. Injected so a test can assert the
   *  absolute-path spawn without a populated `node_modules`. */
  resolvePrettier?: (repoRoot: string) => Promise<string | null>;
  /** The src/ walk's file cap. A test seam: the default is SCAN_FILE_CAP. */
  scanCap?: number;
};

export type AnalyticsTagOptions = {
  /** The GA4 web-stream measurement ID, `G-XXXXXXXXXX`. */
  measurementId: string;
  /** Overrides the host derived from the site's deployed URL. */
  productionHost?: string;
};

/**
 * The first `@reddoorla/maintenance` whose `./client` exports `initAnalytics`.
 * The hook this recipe writes imports it, so a site whose declared range
 * cannot reach this version fails its build on the new file. Must match the
 * release these changes ship in (0.102.0, per the changesets).
 */
export const FIRST_MAINTENANCE_WITH_INIT_ANALYTICS = "0.102.0";

/** SvelteKit's client `init` hook and its `ClientInit` type are `@since 2.10.0`
 *  (read from the installed @sveltejs/kit's types/index.d.ts). */
export const FIRST_KIT_WITH_CLIENT_INIT = "2.10.0";

/** Every file SvelteKit accepts as the client hook. A `.ts` written beside an
 *  existing `.js` is IGNORED by SvelteKit while the recipe reports success. */
const HOOK_CANDIDATES = [
  "src/hooks.client.ts",
  "src/hooks.client.js",
  "src/hooks.client.mts",
  "src/hooks.client.mjs",
  "src/hooks.client/index.ts",
  "src/hooks.client/index.js",
];

/** A bare hostname: labels of letters, digits and hyphens, at least one dot, no
 *  scheme, port, path or whitespace. `https://www.x.com` as a production host
 *  gates the tag off on every host there is. */
const BARE_HOST = /^(?=.{1,253}$)(?!-)[a-z0-9-]{1,63}(?:\.(?!-)[a-z0-9-]{1,63})+$/;

/** Is `host` a bare hostname initAnalytics can compare to location.hostname? */
export function isBareHost(host: string): boolean {
  const h = host.trim().toLowerCase();
  return BARE_HOST.test(h) && siteHostnames(h).length > 0;
}

/** The lower bound of a semver range as [major, minor, patch], or null. */
export function rangeFloor(range: string): [number, number, number] | null {
  const m = /^\s*(?:\^|~|>=|=)?\s*v?(\d+)(?:\.(\d+|x|\*))?(?:\.(\d+|x|\*))?(?:[-+\s]|$)/.exec(
    range,
  );
  if (!m) return null;
  const n = (v: string | undefined) => (v === undefined || v === "x" || v === "*" ? 0 : Number(v));
  return [Number(m[1]), n(m[2]), n(m[3])];
}

function atLeast(v: [number, number, number], min: string): boolean {
  const [a, b, c] = min.split(".").map(Number) as [number, number, number];
  if (v[0] !== a) return v[0] > a;
  if (v[1] !== b) return v[1] > b;
  return v[2] >= c;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/** The snippet an operator adds to an existing hook by hand. */
function handSnippet(id: string, host: string): string {
  return (
    `import { initAnalytics } from "@reddoorla/maintenance/client"; and in its init: ` +
    `initAnalytics({ measurementId: ${JSON.stringify(id)}, productionHost: ${JSON.stringify(host)} });`
  );
}

/** Refusals the site's package.json earns, or null when it can take the hook. */
async function packageRefusal(sitePath: string): Promise<string | null> {
  let pkg: Record<string, unknown>;
  try {
    pkg = JSON.parse(await readFile(join(sitePath, "package.json"), "utf8")) as Record<
      string,
      unknown
    >;
  } catch {
    return "the site has no readable package.json, so whether it can import initAnalytics is unknown";
  }
  const deps = {
    ...(pkg["devDependencies"] as Record<string, string> | undefined),
    ...(pkg["dependencies"] as Record<string, string> | undefined),
  };
  const checks: Array<[string, string, string]> = [
    ["@reddoorla/maintenance", FIRST_MAINTENANCE_WITH_INIT_ANALYTICS, "exports initAnalytics"],
    ["@sveltejs/kit", FIRST_KIT_WITH_CLIENT_INIT, "runs a client `init` hook"],
  ];
  for (const [name, min, what] of checks) {
    const range = deps[name];
    if (range === undefined) {
      return `the site does not depend on ${name}, and the hook this writes needs one that ${what} (${min} or later)`;
    }
    const floor = rangeFloor(range);
    if (floor === null) {
      return (
        `the site's ${name} range ${JSON.stringify(range)} is not one this recipe can read; make ` +
        `it ^${min} or later (the first that ${what}), then re-run`
      );
    }
    if (!atLeast(floor, min)) {
      return (
        `the site's ${name} range ${JSON.stringify(range)} allows versions before ${min}, the ` +
        `first that ${what}, so the hook would fail its build. Bump it to ^${min} or later first`
      );
    }
  }
  return null;
}

type Planned = {
  productionHost: string;
  hooks: string;
  csp: CspEditPlan;
  cspSource: string | null;
};

/**
 * Turn on GA4 for one site: write the client hook that starts the tag, and flip
 * the analytics hosts on in its CSP.
 *
 * Writes `src/hooks.client.ts` rather than editing `src/routes/+layout.svelte`.
 * No fleet site had that file as of 2026-09-22, so this is a create and never a
 * clobber, and the root layouts it would otherwise patch are 2.7KB to 9.7KB of
 * per-site hand-maintained markup with nothing in common to anchor an edit on.
 * An existing hook is a NOOP — someone else's file is not this recipe's to
 * rewrite.
 *
 * The CSP half refuses anything it does not recognise rather than guessing. A
 * site whose `svelte.config.js` cannot be extended safely still gets its hook
 * and is REPORTED, because the alternative is a half-rewritten policy on a live
 * site, and the browser applies that on every request.
 */
export async function analyticsTag(
  site: Site,
  opts: AnalyticsTagOptions,
  deps: AnalyticsTagDeps = { spawn: defaultSpawn },
): Promise<RecipeResult> {
  return withRecipe<Planned>({
    name: "analytics-tag",
    site,
    plan: async () => {
      const id = opts.measurementId.trim();
      if (!MEASUREMENT_ID_RE.test(id)) {
        // A malformed ID collects into nothing and looks completely healthy, so
        // it is refused before anything is written rather than audited later.
        return {
          kind: "failed",
          notes: `measurementId ${JSON.stringify(id)} is not a GA4 web-stream ID (G- plus 10 characters)`,
        };
      }

      const productionHost = (opts.productionHost?.trim() || deriveHost(site)).toLowerCase();
      if (!productionHost) {
        return {
          kind: "failed",
          notes:
            "no production hostname: none was passed and the site has no http(s) deployed URL " +
            "to derive one from. initAnalytics would keep the tag off everywhere, which is a " +
            "silent no-op.",
        };
      }
      if (!isBareHost(productionHost)) {
        return {
          kind: "failed",
          notes:
            `productionHost ${JSON.stringify(productionHost)} is not a bare hostname. Pass the ` +
            "host alone, like www.example.com: no scheme, port or path. initAnalytics compares it " +
            "to location.hostname, so anything else keeps the tag off on every host.",
        };
      }

      // One walk of src/, shared with the audit so the gate and the reading
      // can never disagree about a file.
      const scan = await scanCheckout(site.path, deps.scanCap ?? SCAN_FILE_CAP);
      if (scan === null) {
        return { kind: "failed", notes: "the site has no src/ directory to install into" };
      }

      // Already running the package? Only the SAME ID on the SAME host is a
      // noop. A different ID, or one this recipe cannot read, used to be a
      // noop with exit 0 while GA4 with the requested ID was never installed.
      if (scan.references.length > 0) {
        const where = scan.references.map((r) => r.file).join(", ");
        const same = scan.references.every(
          (r) => r.measurementId === id && r.productionHost === productionHost,
        );
        if (same && scan.foreignFile === null) {
          return {
            kind: "noop",
            notes: `${where} already starts ${id} on ${productionHost} through initAnalytics`,
          };
        }
        const ids = [
          ...new Set(
            scan.references.map((r) => r.measurementId ?? "an ID this recipe cannot read"),
          ),
        ];
        return {
          kind: "failed",
          notes:
            `${where} already call${scan.references.length === 1 ? "s" : ""} initAnalytics with ` +
            `${ids.join(" / ")}` +
            (same ? `, and ${scan.foreignFile} also loads a tag` : "") +
            `, not ${id} on ${productionHost}. A second call would load a second property. ` +
            "Change the existing call by hand, or remove it and re-run.",
        };
      }

      // A hook SvelteKit will use already exists, and does not start GA4.
      // Writing src/hooks.client.ts beside a .js one is ignored by SvelteKit
      // while this recipe reported "applied" and the audit passed.
      for (const rel of HOOK_CANDIDATES) {
        if (await exists(join(site.path, rel))) {
          return {
            kind: "failed",
            notes:
              `${rel} already exists, and this recipe does not edit someone else's hook. Add ` +
              `GA4 to it by hand: ${handSnippet(id, productionHost)}`,
          };
        }
      }

      // REFUSE rather than install alongside a loader the site already has.
      //
      // `initAnalytics` stands down only for its OWN measurement ID, and a
      // site-local loader that runs later never sees ours to stand down for.
      // beachfront is exactly that shape: its component appends in `onMount`
      // with no guard of any kind, and SvelteKit's ClientInit runs before the
      // app starts — so migrating it with its existing ID would give one
      // property two loaders and double every session.
      if (scan.foreignFile !== null) {
        return {
          kind: "failed",
          notes:
            `${scan.foreignFile} already references a tag manager. Installing alongside it would ` +
            "give one property two loaders and double every session, which GA4 cannot separate " +
            "afterwards. Remove that loader and commit the removal (this recipe refuses a dirty " +
            "tree), then re-run: its commit sits on top of yours in the same PR.",
        };
      }
      if (!scan.complete) {
        return {
          kind: "failed",
          notes:
            `src/ holds more than ${deps.scanCap ?? SCAN_FILE_CAP} files, so this recipe could not rule out a ` +
            "loader the site already has, and installing alongside one doubles every session. " +
            "Check by hand and install it by hand.",
        };
      }

      const pkgRefusal = await packageRefusal(site.path);
      if (pkgRefusal !== null) return { kind: "failed", notes: pkgRefusal };

      let cspSource: string | null;
      try {
        cspSource = await readFile(join(site.path, SVELTE_CONFIG_RELATIVE), "utf8");
      } catch {
        cspSource = null;
      }
      // A custom `kit.files.hooks.client` moves the hook; the file this writes
      // would then be ignored exactly like a .ts beside a .js.
      if (cspSource !== null && /\bhooks\s*:\s*\{[^}]*\bclient\b/.test(cspSource)) {
        return {
          kind: "failed",
          notes:
            "svelte.config.js sets kit.files.hooks.client, so SvelteKit reads the client hook " +
            `from somewhere else. Add GA4 there by hand: ${handSnippet(id, productionHost)}`,
        };
      }
      const csp: CspEditPlan = cspSource === null ? { kind: "none" } : planCspEdit(cspSource);

      return {
        kind: "apply",
        plan: {
          productionHost,
          hooks: hooksClientTemplate({ measurementId: id, productionHost }),
          csp,
          cspSource,
        },
      };
    },

    apply: async (planned, { commit, cwd }) => {
      const written: string[] = [HOOKS_CLIENT_RELATIVE];
      await writeFile(join(cwd, HOOKS_CLIENT_RELATIVE), planned.hooks, "utf8");

      if (planned.csp.kind === "edit") {
        await writeFile(join(cwd, SVELTE_CONFIG_RELATIVE), planned.csp.next, "utf8");
        written.push(SVELTE_CONFIG_RELATIVE);
      }

      // Formatting must not be able to strand the write. `withRecipe`'s failure
      // path is `git checkout -f`, which does NOT remove an untracked new file,
      // so a prettier throw used to leave src/hooks.client.ts on disk with
      // nothing in git — and the next run hit the "already exists" noop and
      // reported the site as done. `formatWithPrettier` never throws, and the
      // resolver collapses every failure to null, so a formatting miss becomes
      // the flag note rather than a stranded file.
      //
      // The SITE's own prettier by absolute path, or none at all — never the
      // `pnpm exec` default. A sweep clone has no node_modules, and there
      // `pnpm exec prettier` runs whatever prettier the ambient PATH offers
      // (measured in a cloud container: /opt/node22/bin/prettier, which then
      // failed on the site's plugin), or per _prettier.ts an unrequested install
      // first. The result was ignored, so a failed format was also silent.
      const notes: string[] = [];
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

      await commit(`feat: start GA4 on the production host (${planned.productionHost})`);

      // Did git TAKE them? A site that gitignores a path gets the file on disk,
      // nothing in the commit, and a result that reads as done — the #741 shape.
      const refusal = await refusedByGit(cwd, written, "the analytics tag");
      if (refusal) {
        await undoRefusedWrites(
          cwd,
          new Map(
            written.map((p) => [
              p,
              p === SVELTE_CONFIG_RELATIVE ? (planned.cspSource ?? null) : null,
            ]),
          ),
          refusal.missing,
        );
        return { kind: "failed", notes: refusal.notes + RESTORED_NOTE };
      }

      return { kind: "ok", notes: [cspNote(planned.csp), ...notes].join("\n") };
    },
  });
}

function deriveHost(site: Site): string {
  const url = site.deployedUrl;
  return url && isHttpUrl(url) ? hostnameOf(url) : "";
}

/** What the operator still has to do, said plainly. An unreported CSP gap is a
 *  tag the browser refuses on every request with nothing on the page to show it. */
function cspNote(plan: CspEditPlan): string {
  switch (plan.kind) {
    case "edit":
      return "CSP: analytics hosts enabled via `csp: { analytics: true }`.";
    case "already":
      return "CSP: already had `analytics: true`.";
    case "none":
      // Says what was CHECKED, not what is true. reddoor-website and
      // gallerysonder set an enforcing Content-Security-Policy in
      // `netlify.toml` and have no `csp:` in svelte.config.js at all. And a
      // header needs every directive, not only script-src.
      return (
        "CSP: no `csp` option in svelte.config.js. A policy set elsewhere (netlify.toml " +
        "headers, an edge function) was NOT checked — if this site has one, it must allow " +
        `${HAND_ADD_HOSTS}, or the browser refuses the tag.`
      );
    case "refuse":
      // Only a located CSP earns "the browser refuses". A refusal that never
      // found the option (a regex literal stopped the parse) says "if".
      return plan.policy === "present"
        ? `CSP NOT CHANGED — ${plan.reason}. The browser refuses the loader until these are ` +
            `added to that policy by hand: ${plan.handAdd}.`
        : `CSP NOT CHANGED — ${plan.reason}. If svelte.config.js sets a Content-Security-Policy, ` +
            `the browser refuses the loader until these are added to it by hand: ${plan.handAdd}. ` +
            "(If that `csp` is a createSvelteConfig option rather than kit.csp, `analytics: true` " +
            "inside it does the same.)";
  }
}
