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
        .filter((f) => f.endsWith(".yml"))
        .map((f) => ({
          where: f,
          cmd: readFileSync(join(ROOT, ".github/workflows", f), "utf-8"),
        })),
    ];
    // A sync on a line that does not also name the config file. A backticked
    // one is prose (time-travel.yml's issue body names the step).
    const bare = sources.flatMap(({ where, cmd }) =>
      cmd
        .split("\n")
        .filter((line) => !line.trimStart().startsWith("#"))
        .filter(
          (line) => /(?<!`)svelte-kit sync/.test(line) && !line.includes(`--config ${CONFIG}`),
        )
        .map((line) => `${where}: ${line.trim()}`),
    );
    expect(bare).toEqual([]);
  });

  it("control: a bare sync's config really is kit's defaults", async () => {
    // What `svelte-kit sync` with no `--config` resolves here: no Vite config
    // file, so no kit plugin and kit's own defaults. Proves the test above
    // guards a real difference, not two spellings of one config.
    const resolved = await resolveConfig({ configFile: false, root: ROOT }, "build", "production");
    expect(resolved.plugins.some((p) => p.name === "vite-plugin-sveltekit-setup")).toBe(false);
  });
});
