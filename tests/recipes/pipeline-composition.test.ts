/**
 * End-to-end composition test for the fleet onboarding pipeline:
 *
 *   convert-to-pnpm → onboard → sync-configs → svelte-codemods
 *
 * This is the actual sequence we ran (manually) against caltex-landing and
 * espada. Several bugs from those pilots — lockfile resync in bump-deps,
 * legacyReactiveToRunes lost on merge, $$props.class blocking the build —
 * surfaced only when the recipes ran against each other's output. A
 * dedicated test for each recipe in isolation wouldn't have caught any of
 * them.
 *
 * The fixture (`pre-onboarding/`) is a Svelte 5 site that's still on npm
 * with the legacy patterns reddoor sites accumulated through their original
 * 4→5 migration: `export let`, `on:click=`, `$$props.class`, `$state + $effect`
 * manual sync, `$:` reactive labels.
 */
import { describe, it, expect } from "vitest";
import { readFile, stat } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve, dirname, join } from "node:path";
import { writeFile } from "node:fs/promises";
import { convertToPnpm } from "../../src/recipes/convert-to-pnpm.js";
import { onboard } from "../../src/recipes/onboard.js";
import { syncConfigs } from "../../src/recipes/sync-configs.js";
import { svelteCodemods } from "../../src/recipes/svelte-codemods.js";
import { copyFixtureToTmp } from "./_helpers/site-tmpdir.js";
import type { SpawnFn } from "../../src/audits/util/spawn.js";

const here = dirname(fileURLToPath(import.meta.url));
const preOnboarding = resolve(here, "../fixtures/pre-onboarding");

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/** Fake spawn that handles every pnpm/npm command the four recipes emit.
 *  Materializes a pnpm-lock.yaml on `pnpm install` so subsequent recipes'
 *  pre-flight checks succeed. */
function makeFakeSpawn(): SpawnFn {
  return async (cmd, args, opts) => {
    if (cmd === "pnpm" && args[0] === "install") {
      const cwd = opts?.cwd ?? process.cwd();
      await writeFile(join(cwd, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n", "utf-8");
      return { code: 0, stdout: "", stderr: "" };
    }
    throw new Error(`unexpected spawn in composition test: ${cmd} ${args.join(" ")}`);
  };
}

describe("recipes/pipeline composition (convert-to-pnpm → onboard → sync-configs → svelte-codemods)", () => {
  it("takes a fresh npm-locked Svelte 5 site through full onboarding without conflict", async () => {
    const cwd = await copyFixtureToTmp(preOnboarding);
    const spawn = makeFakeSpawn();

    // Step 1: convert-to-pnpm
    const r1 = await convertToPnpm({ path: cwd }, { spawn });
    expect(r1.status).toBe("applied");
    expect(await exists(join(cwd, "pnpm-lock.yaml"))).toBe(true);
    expect(await exists(join(cwd, "package-lock.json"))).toBe(false);

    // Step 2: onboard (must find pnpm-lock.yaml left by step 1)
    const r2 = await onboard({ path: cwd }, { spawn });
    expect(r2.status).toBe("applied");
    const pkgAfterOnboard = JSON.parse(await readFile(join(cwd, "package.json"), "utf-8")) as {
      devDependencies?: Record<string, string>;
      packageManager?: string;
    };
    expect(pkgAfterOnboard.devDependencies?.["@reddoorla/maintenance"]).toMatch(/^\^\d/);
    expect(pkgAfterOnboard.devDependencies?.["@lhci/cli"]).toBeTruthy();
    expect(pkgAfterOnboard.devDependencies?.["@playwright/test"]).toBeTruthy();
    expect(pkgAfterOnboard.devDependencies?.["@axe-core/playwright"]).toBeTruthy();
    expect(pkgAfterOnboard.packageManager).toMatch(/^pnpm@/);

    // Step 3: sync-configs (writes the 6 canonical targets on top of the
    // onboarded site)
    const r3 = await syncConfigs({ path: cwd });
    expect(r3.status).toBe("applied");

    // All five template targets present + canonical
    const eslintCfg = await readFile(join(cwd, "eslint.config.js"), "utf-8");
    expect(eslintCfg).toContain("@reddoorla/maintenance/configs/eslint");
    const prettierCfg = await readFile(join(cwd, ".prettierrc.json"), "utf-8");
    expect(prettierCfg).toContain("prettier-plugin-svelte");
    const lighthouseCfg = await readFile(join(cwd, "lighthouserc.json"), "utf-8");
    expect(lighthouseCfg).toContain("@reddoorla/maintenance/configs/lighthouse");
    const playwrightCfg = await readFile(join(cwd, "playwright.config.ts"), "utf-8");
    expect(playwrightCfg).toContain("@reddoorla/maintenance/configs/playwright-a11y");
    const svelteCfg = await readFile(join(cwd, "svelte.config.js"), "utf-8");
    expect(svelteCfg).toContain("createSvelteConfig");

    // .gitignore — original `node_modules` preserved, canonical entries appended
    const gitignore = await readFile(join(cwd, ".gitignore"), "utf-8");
    expect(gitignore).toContain("node_modules"); // site's original line
    expect(gitignore).toContain("build/");
    expect(gitignore).toContain(".svelte-kit/");
    expect(gitignore).toContain(".env");

    // Step 4: svelte-codemods (clean up the legacy patterns we baked in)
    const r4 = await svelteCodemods({ path: cwd });
    expect(r4.status).toBe("applied");

    // Button.svelte: export let → $props, on:click → onclick, $$props.class → className
    const button = await readFile(join(cwd, "src/lib/components/Button.svelte"), "utf-8");
    expect(button).not.toContain("export let");
    expect(button).not.toContain("on:click");
    expect(button).not.toContain("$$props.class");
    expect(button).toContain("$props()");
    expect(button).toContain("onclick=");
    expect(button).toContain("className");

    // +layout.svelte: $state+$effect sync → $derived, $: → $derived
    const layout = await readFile(join(cwd, "src/routes/+layout.svelte"), "utf-8");
    expect(layout).toContain("$derived(data.page.data)");
    expect(layout).not.toMatch(/^\s*\$:/m); // no remaining $: at line start

    // Final state: HEAD on the last recipe's branch
    const branch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd,
      encoding: "utf-8",
    }).trim();
    expect(branch).toMatch(/^maint\/svelte-codemods-\d{8}T\d{6}Z$/);

    // Final state: full commit chain visible — at least one commit per recipe
    // (some recipes contribute multiple). The chain establishes the onboarding
    // can be reviewed step-by-step.
    const logCount = execFileSync("git", ["rev-list", "--count", "HEAD", "^main"], {
      cwd,
      encoding: "utf-8",
    }).trim();
    expect(Number(logCount)).toBeGreaterThanOrEqual(4);
  });

  it("each recipe is idempotent — re-running the pipeline against the onboarded site is noop", async () => {
    const cwd = await copyFixtureToTmp(preOnboarding);
    const spawn = makeFakeSpawn();

    // Full pipeline once
    await convertToPnpm({ path: cwd }, { spawn });
    await onboard({ path: cwd }, { spawn });
    await syncConfigs({ path: cwd });
    await svelteCodemods({ path: cwd });

    // Now re-run each — all should report noop
    const r1 = await convertToPnpm({ path: cwd }, { spawn });
    expect(r1.status).toBe("noop");

    const r2 = await onboard({ path: cwd }, { spawn });
    expect(r2.status).toBe("noop");

    const r3 = await syncConfigs({ path: cwd });
    expect(r3.status).toBe("noop");

    const r4 = await svelteCodemods({ path: cwd });
    expect(r4.status).toBe("noop");
  });
});
