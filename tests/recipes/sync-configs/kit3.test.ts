// SvelteKit 3 refuses to start beside a svelte.config.js (config_file_unsupported)
// and takes its options, top-level, through the sveltekit(...) Vite plugin
// (P1-45). reddoor-starter keeps that object in sveltekit.config.js, which
// vite.config.ts and eslint.config.js both import. These tests hold sync-configs
// to three things on a kit 3 site: it never writes a svelte.config.js, its
// eslint template points at the file the site really has, and the templates
// match the starter (the fixture is the starter's own eslint.config.js).
import { describe, it, expect } from "vitest";
import { readFile, writeFile, rm, access } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve, dirname, join } from "node:path";
import {
  syncConfigs,
  planTemplateDiffs,
  planKitHazards,
} from "../../../src/recipes/sync-configs.js";
import { runSyncConfigsCommand } from "../../../src/cli/commands/sync-configs.js";
import {
  ALL_TEMPLATES,
  KIT_CONFIG_PATH,
  templatesByName,
} from "../../../src/recipes/sync-configs/templates.js";
import { readKitMajor } from "../../../src/recipes/sync-configs/kit-major.js";
import { copyFixtureToTmp } from "../_helpers/site-tmpdir.js";

const here = dirname(fileURLToPath(import.meta.url));
const kit3Starter = resolve(here, "../../fixtures/kit3-starter");
const kit2Clean = resolve(here, "../../fixtures/sync-clean");

const exists = (p: string) =>
  access(p).then(
    () => true,
    () => false,
  );

function commitAll(cwd: string, message: string): void {
  execFileSync("git", ["add", "-A"], { cwd, stdio: "ignore" });
  execFileSync("git", ["commit", "-m", message], { cwd, stdio: "ignore" });
}

async function setKit(cwd: string, spec: string): Promise<void> {
  const pkgPath = join(cwd, "package.json");
  const pkg = JSON.parse(await readFile(pkgPath, "utf-8")) as {
    devDependencies?: Record<string, string>;
  };
  pkg.devDependencies = { ...pkg.devDependencies, "@sveltejs/kit": spec };
  await writeFile(pkgPath, JSON.stringify(pkg, null, 2) + "\n", "utf-8");
}

describe("readKitMajor", () => {
  it("reads the major from the site's @sveltejs/kit range", async () => {
    const cwd = await copyFixtureToTmp(kit3Starter);
    expect(await readKitMajor(cwd)).toBe(3);
    for (const [spec, major] of [
      ["^2.61.1", 2],
      ["~3.0.1", 3],
      [">=3.0.0", 3],
      ["3.0.1", 3],
      ["npm:@sveltejs/kit@^3.0.0", 3],
    ] as const) {
      await setKit(cwd, spec);
      expect(await readKitMajor(cwd), spec).toBe(major);
    }
  });

  it("is null for a site that does not declare kit, or a range it cannot read", async () => {
    expect(await readKitMajor(await copyFixtureToTmp(kit2Clean))).toBeNull();
    const cwd = await copyFixtureToTmp(kit3Starter);
    await setKit(cwd, "latest");
    expect(await readKitMajor(cwd)).toBeNull();
  });
});

describe("sync-configs on a SvelteKit 3 site", () => {
  it("finds nothing to change on the starter's own kit 3 files (the templates match the starter)", async () => {
    const cwd = await copyFixtureToTmp(kit3Starter);
    expect(await planTemplateDiffs(cwd, templatesByName(["eslint", "svelte"]))).toEqual([]);
  });

  it("never writes a svelte.config.js, which kit 3 refuses to start beside", async () => {
    const cwd = await copyFixtureToTmp(kit3Starter);
    await rm(join(cwd, KIT_CONFIG_PATH));
    commitAll(cwd, "drop the config");
    const diffs = await planTemplateDiffs(cwd, ALL_TEMPLATES);
    expect(diffs.map((d) => d.path)).not.toContain("svelte.config.js");
    await syncConfigs({ path: cwd }, { which: ["svelte", "eslint"] });
    expect(await exists(join(cwd, "svelte.config.js"))).toBe(false);
  });

  // The config may legitimately be inline in vite.config.ts (kit 3's own
  // default). Writing a sveltekit.config.js there would be a second config
  // nothing reads, and an eslint.config.js importing it would lint against the
  // wrong one, so with no sveltekit.config.js both are left alone.
  it("leaves eslint and the config alone when the site has no sveltekit.config.js", async () => {
    const cwd = await copyFixtureToTmp(kit3Starter);
    await rm(join(cwd, KIT_CONFIG_PATH));
    await writeFile(join(cwd, "eslint.config.js"), "export default [];\n", "utf-8");
    commitAll(cwd, "inline config");
    expect(await planTemplateDiffs(cwd, templatesByName(["eslint", "svelte"]))).toEqual([]);
  });

  it("heals a drifted eslint.config.js to import sveltekit.config.js, not svelte.config.js", async () => {
    const cwd = await copyFixtureToTmp(kit3Starter);
    await writeFile(join(cwd, "eslint.config.js"), "export default [];\n", "utf-8");
    commitAll(cwd, "drift eslint");
    const result = await syncConfigs({ path: cwd }, { which: ["eslint"] });
    expect(result.status).toBe("applied");
    const eslint = await readFile(join(cwd, "eslint.config.js"), "utf-8");
    expect(eslint).toContain(`from "./${KIT_CONFIG_PATH}"`);
    expect(eslint).not.toContain("svelte.config.js");
  });

  it("leaves a hand-authored kit 3 config on adapter-netlify untouched", async () => {
    const cwd = await copyFixtureToTmp(kit3Starter);
    const before = await readFile(join(cwd, KIT_CONFIG_PATH), "utf-8");
    const result = await syncConfigs({ path: cwd }, { which: ["svelte"] });
    expect(result.status).toBe("noop");
    expect(await readFile(join(cwd, KIT_CONFIG_PATH), "utf-8")).toBe(before);
  });

  it("brings a kit 3 config on the wrong adapter to the flat template", async () => {
    const cwd = await copyFixtureToTmp(kit3Starter);
    await writeFile(
      join(cwd, KIT_CONFIG_PATH),
      `import adapter from "@sveltejs/adapter-auto";\nexport default { adapter: adapter() };\n`,
      "utf-8",
    );
    commitAll(cwd, "wrong adapter");
    await syncConfigs({ path: cwd }, { which: ["svelte"] });
    const after = await readFile(join(cwd, KIT_CONFIG_PATH), "utf-8");
    expect(after).toContain("@sveltejs/adapter-netlify");
    expect(after).toContain("createKitConfig");
    // Kit 3 refuses a `kit` namespace (config_kit_namespace).
    expect(after).not.toMatch(/\bkit\s*:/);
  });
});

describe("sync-configs on a SvelteKit 2 site is unchanged", () => {
  it("still finds the kit 2 fixture clean, and still points eslint at svelte.config.js", async () => {
    const cwd = await copyFixtureToTmp(kit2Clean);
    await setKit(cwd, "^2.61.1");
    commitAll(cwd, "declare kit 2");
    expect(await planTemplateDiffs(cwd, ALL_TEMPLATES)).toEqual([]);
    const eslint = await readFile(join(cwd, "eslint.config.js"), "utf-8");
    expect(eslint).toContain(`from "./svelte.config.js"`);
  });
});

// A Renovate kit 3 bump with no migration leaves svelte.config.js in place,
// and kit 3 refuses to start beside it. sync-configs cannot fix that by writing
// a template (the options have to move first, and it never deletes a site's
// file), so it says so: in the recipe's notes and as a DRIFT line in the weekly
// fleet-config-drift sweep, which runs the --dry planner.
describe("a SvelteKit 3 site that still has svelte.config.js", () => {
  async function renovateBumpedKit2Site(): Promise<string> {
    const cwd = await copyFixtureToTmp(kit2Clean);
    await setKit(cwd, "^3.0.0");
    commitAll(cwd, "renovate: kit 3");
    return cwd;
  }

  it("is a hazard on kit 3 and not on kit 2", async () => {
    const kit3 = await renovateBumpedKit2Site();
    const hazards = await planKitHazards(kit3);
    expect(hazards).toHaveLength(1);
    expect(hazards[0]).toMatch(/svelte\.config\.js.*config_file_unsupported/);
    const kit2 = await copyFixtureToTmp(kit2Clean);
    await setKit(kit2, "^2.61.1");
    expect(await planKitHazards(kit2)).toEqual([]);
    expect(await planKitHazards(await copyFixtureToTmp(kit3Starter))).toEqual([]);
  });

  it("is named in the recipe's notes and the file is left in place", async () => {
    const cwd = await renovateBumpedKit2Site();
    const result = await syncConfigs({ path: cwd }, { which: ["svelte", "eslint"] });
    expect(result.notes).toMatch(/svelte\.config\.js.*config_file_unsupported/);
    expect(await exists(join(cwd, "svelte.config.js"))).toBe(true);
  });

  it("is a DRIFT line in the --dry sweep", async () => {
    const cwd = await renovateBumpedKit2Site();
    const { output } = await runSyncConfigsCommand(undefined, { dry: true, cwd });
    expect(output).toMatch(/must move by hand: svelte\.config\.js is present on SvelteKit 3/);
    const clean = await copyFixtureToTmp(kit3Starter);
    const cleanRun = await runSyncConfigsCommand(undefined, {
      dry: true,
      cwd: clean,
      only: "svelte,eslint",
    });
    expect(cleanRun.output).not.toMatch(/must move by hand/);
  });
});

// The fixture's eslint.config.js, sveltekit.config.js and vite.config.ts are
// byte copies of reddoor-starter's (tests/fixtures/README.md names the commit).
// The template-matches-starter test above holds templates.ts to the fixture;
// this holds the fixture to a real starter checkout, when one is given.
const starterDir = process.env.REDDOOR_STARTER_DIR;
describe.skipIf(!starterDir)("the kit3-starter fixture is still the starter's", () => {
  for (const file of ["eslint.config.js", KIT_CONFIG_PATH, "vite.config.ts"]) {
    it(file, async () => {
      const ours = await readFile(join(kit3Starter, file), "utf-8");
      const theirs = await readFile(join(starterDir!, file), "utf-8");
      expect(ours).toBe(theirs);
    });
  }
});
