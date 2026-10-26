import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { resolveConfig, type Plugin } from "vite";

/**
 * The cockpit's SvelteKit 3 configuration, read the way kit itself reads it.
 *
 * Kit 3 refuses `svelte.config.js` and takes its options through the
 * `sveltekit(...)` plugin in `vite.cockpit.config.ts` (P1-69). The `svelte-kit
 * sync` CLI finds them only through `--config`: with none it resolves Vite's
 * defaults, writes types for a `src/` app that does not exist and exits 0, so a
 * bare sync leaves the cockpit's tests and svelte-check reading nothing. These
 * tests hold the options and every sync to that one file.
 */

const ROOT = join(import.meta.dirname, "../..");
const CONFIG = "vite.cockpit.config.ts";

type KitOptions = {
  adapter: { name: string };
  files: { src: string };
  outDir: string;
  csrf: { trustedOrigins: string[] };
};

/** The options kit's CLI hands to sync: `load_vite_config` + `extract_svelte_config`. */
async function kitOptions(configFile: string): Promise<KitOptions | undefined> {
  const resolved = await resolveConfig({ configFile, root: ROOT }, "build", "production");
  const setup = resolved.plugins.find((p) => p.name === "vite-plugin-sveltekit-setup") as
    (Plugin & { api?: { options?: KitOptions } }) | undefined;
  return setup?.api?.options;
}

describe("the cockpit's SvelteKit config", () => {
  it("is the one kit resolves from the cockpit's Vite config", async () => {
    const options = await kitOptions(join(ROOT, CONFIG));
    expect(options?.adapter.name).toBe("@sveltejs/adapter-netlify");
    // Kit hands these on resolved against the root.
    expect(relative(ROOT, options?.files.src ?? "")).toBe("cockpit/src");
    expect(relative(ROOT, options?.outDir ?? "")).toBe("cockpit/.svelte-kit");
    // The endpoints run their own CSRF check (endpoint-routes.ssr.test.ts).
    expect(options?.csrf.trustedOrigins).toEqual(["*"]);
  });

  it("is not in a svelte.config file, which kit 3 refuses to start beside", () => {
    expect(
      ["svelte.config.js", "svelte.config.ts"].filter((f) => existsSync(join(ROOT, f))),
    ).toEqual([]);
  });

  it("reaches every sync: no script or workflow runs a bare `svelte-kit sync`", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf-8")) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts["cockpit:sync"]).toBe(`svelte-kit sync --config ${CONFIG}`);
    expect(pkg.scripts["cockpit:build"]).toBe(`vite build --config ${CONFIG}`);

    const sources = [
      ...Object.entries(pkg.scripts).map(([name, cmd]) => ({ where: `package.json ${name}`, cmd })),
      ...readdirSync(join(ROOT, ".github/workflows"))
        .filter((f) => /\.ya?ml$/.test(f))
        .map((f) => ({
          where: f,
          cmd: readFileSync(join(ROOT, ".github/workflows", f), "utf-8"),
        })),
    ];
    // Each command (a line split on `&&`, `||`, `;` and `|`) that syncs must
    // name the config itself. A backticked one is prose (time-travel.yml's
    // issue body names the step).
    // `--config X`, `--config=X` or `-c X` (kit reads `-c=X` as the file
    // `=X`), optionally `./`-prefixed or quoted.
    const file = CONFIG.replaceAll(".", "\\.");
    const names = new RegExp(`(?:--config[ =]|-c )(["']?)(?:\\./)?${file}\\1(?:\\s|$)`);
    // `svelte-kit`, `svelte-kit@3`, with any options before the command.
    const sync = /(?<!`)svelte-kit(?:@\S+)?\s+(?:-\S+\s+(?:[^-\s]\S*\s+)?)*sync\b/;
    const bare = sources.flatMap(({ where, cmd }) =>
      cmd
        .replace(/\\\n/g, " ")
        .split("\n")
        .filter((line) => !line.trimStart().startsWith("#"))
        .flatMap((line) => line.split(/&&|\|\||;|\|/))
        .filter((c) => sync.test(c) && !names.test(c))
        .map((c) => `${where}: ${c.trim()}`),
    );
    expect(bare).toEqual([]);
  });

  it("control: a bare sync's config really is kit's defaults", async () => {
    // What `svelte-kit sync` with no `--config` resolves here: kit's CLI passes
    // `configFile: undefined` (here: no key), so Vite looks for a
    // `vite.config.*`. There is none, so no kit plugin and kit's own defaults.
    // Red if one appears, and proof the test above guards a real difference.
    const resolved = await resolveConfig({ root: ROOT }, "build", "production");
    expect(resolved.plugins.some((p) => p.name === "vite-plugin-sveltekit-setup")).toBe(false);
  });
});
