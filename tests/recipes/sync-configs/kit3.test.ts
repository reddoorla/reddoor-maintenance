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
  templateForKit,
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
      ["3", 3],
      ["^4.0.0", 4],
      ["^2.0.0 || ^3.0.0", 3],
      [">=3 <4", 3],
    ] as const) {
      await setKit(cwd, spec);
      expect(await readKitMajor(cwd), spec).toBe(major);
    }
  });

  it("is null for a site that does not declare kit", async () => {
    expect(await readKitMajor(await copyFixtureToTmp(kit2Clean))).toBeNull();
  });

  // Kept apart from null: guessing kit 2 for a catalog spec that holds kit 3
  // would write the svelte.config.js kit 3 refuses to start beside.
  it("is 'unreadable' for a spec it cannot read", async () => {
    const cwd = await copyFixtureToTmp(kit3Starter);
    for (const spec of ["catalog:", "workspace:*", "latest", "github:sveltejs/kit"]) {
      await setKit(cwd, spec);
      expect(await readKitMajor(cwd), spec).toBe("unreadable");
    }
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
    // Both files the Renovate bump left behind: the config kit refuses, and the
    // eslint.config.js that imports it.
    const hazards = await planKitHazards(kit3);
    expect(hazards.map((h) => h.path)).toEqual(["svelte.config.js", "eslint.config.js"]);
    expect(hazards[0]?.note).toMatch(/svelte\.config\.js.*config_file_unsupported/);
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
    // The machine line the drift issue quotes says it is not template drift.
    expect(output).toMatch(
      /^DRIFT \S+ svelte\.config\.js \(move by hand, sync-configs will not\)$/m,
    );
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

describe("kit 3 hazards and templates, past the first review", () => {
  async function renovateBumpedKit2Site(spec = "^3.0.0"): Promise<string> {
    const cwd = await copyFixtureToTmp(kit2Clean);
    await setKit(cwd, spec);
    commitAll(cwd, `renovate: kit ${spec}`);
    return cwd;
  }

  it("names the hazard in the notes when other configs are applied too", async () => {
    const cwd = await renovateBumpedKit2Site();
    await writeFile(join(cwd, ".prettierrc.json"), "{}\n", "utf-8");
    commitAll(cwd, "drift prettier");
    const result = await syncConfigs({ path: cwd });
    expect(result.status).toBe("applied");
    expect(result.notes).toMatch(/svelte\.config\.js.*config_file_unsupported/);
  });

  it("reports the hazard under --only svelte and not under --only prettier", async () => {
    const cwd = await renovateBumpedKit2Site();
    const svelte = await runSyncConfigsCommand(undefined, { dry: true, cwd, only: "svelte" });
    expect(svelte.output).toMatch(/must move by hand/);
    const prettier = await runSyncConfigsCommand(undefined, { dry: true, cwd, only: "prettier" });
    expect(prettier.output).not.toMatch(/must move by hand/);
  });

  it("treats kit 4 as kit 3: the hazard, and no svelte.config.js written", async () => {
    const cwd = await renovateBumpedKit2Site("^4.0.0");
    expect((await planKitHazards(cwd)).map((h) => h.path)).toEqual([
      "svelte.config.js",
      "eslint.config.js",
    ]);
    const bare = await copyFixtureToTmp(kit3Starter);
    await setKit(bare, "^4.0.0");
    await rm(join(bare, KIT_CONFIG_PATH));
    commitAll(bare, "kit 4, inline config");
    const diffs = await planTemplateDiffs(bare, ALL_TEMPLATES);
    expect(diffs.map((d) => d.path)).not.toContain("svelte.config.js");
  });

  it("writes neither kit file for a kit spec it cannot read, and says so", async () => {
    const cwd = await copyFixtureToTmp(kit3Starter);
    await setKit(cwd, "catalog:");
    await rm(join(cwd, KIT_CONFIG_PATH));
    await rm(join(cwd, "eslint.config.js"));
    commitAll(cwd, "catalog kit");
    const diffs = await planTemplateDiffs(cwd, ALL_TEMPLATES);
    expect(diffs.map((d) => d.path)).not.toContain("svelte.config.js");
    expect(diffs.map((d) => d.path)).not.toContain("eslint.config.js");
    expect((await planKitHazards(cwd)).map((h) => h.path)).toEqual(["package.json"]);
  });

  it("names an eslint.config.js still importing svelte.config.js when the config is inline", async () => {
    const cwd = await copyFixtureToTmp(kit3Starter);
    await rm(join(cwd, KIT_CONFIG_PATH));
    await writeFile(
      join(cwd, "eslint.config.js"),
      'import svelteConfig from "./svelte.config.js";\nexport default [svelteConfig];\n',
      "utf-8",
    );
    commitAll(cwd, "inline config, stale eslint");
    expect((await planKitHazards(cwd)).map((h) => h.path)).toEqual(["eslint.config.js"]);
  });

  it("pins the kit 3 svelte template's text: the adapter options and no forced CSP", () => {
    const svelte = templatesByName(["svelte"])[0]!;
    expect(templateForKit(svelte, 3)).toEqual({
      config: "svelte",
      path: KIT_CONFIG_PATH,
      contents: `import { createKitConfig } from "@reddoorla/maintenance/configs/svelte";
import adapter from "@sveltejs/adapter-netlify";

/** @type {import('@sveltejs/kit/vite').Config} */
export default createKitConfig({
  adapter: adapter({ edge: false, split: false }),
});
`,
    });
    expect(templateForKit(svelte, 2)).toBe(svelte);
    expect(templateForKit(svelte, "unreadable")).toBe(svelte);
  });
});

describe("kit 3 hazards, past the second review", () => {
  it("reports a broken eslint.config.js under --only eslint, and its own fix under --only svelte none", async () => {
    const cwd = await copyFixtureToTmp(kit3Starter);
    await rm(join(cwd, KIT_CONFIG_PATH));
    await writeFile(
      join(cwd, "eslint.config.js"),
      'import svelteConfig from "./svelte.config.js";\nexport default [svelteConfig];\n',
      "utf-8",
    );
    commitAll(cwd, "inline config, stale eslint");
    const eslint = await runSyncConfigsCommand(undefined, { dry: true, cwd, only: "eslint" });
    expect(eslint.output).toMatch(/^DRIFT \S+ eslint\.config\.js \(move by hand/m);
    const svelte = await runSyncConfigsCommand(undefined, { dry: true, cwd, only: "svelte" });
    expect(svelte.output).not.toMatch(/must move by hand/);
    const result = await syncConfigs({ path: cwd }, { which: ["eslint"] });
    expect(result.notes).toMatch(/eslint\.config\.js imports \.\/svelte\.config\.js/);
  });

  it("finds nothing on an inline-config kit 3 site whose eslint.config.js does not import svelte.config.js", async () => {
    const cwd = await copyFixtureToTmp(kit3Starter);
    await rm(join(cwd, KIT_CONFIG_PATH));
    await writeFile(join(cwd, "eslint.config.js"), "export default [];\n", "utf-8");
    commitAll(cwd, "inline config, own eslint");
    expect(await planKitHazards(cwd)).toEqual([]);
  });

  it("leaves a stale eslint import to the template when sveltekit.config.js exists", async () => {
    const cwd = await copyFixtureToTmp(kit3Starter);
    await writeFile(
      join(cwd, "eslint.config.js"),
      'import svelteConfig from "./svelte.config.js";\nexport default [svelteConfig];\n',
      "utf-8",
    );
    commitAll(cwd, "stale eslint beside sveltekit.config.js");
    expect(await planKitHazards(cwd)).toEqual([]);
    const diffs = await planTemplateDiffs(cwd, templatesByName(["eslint"]));
    expect(diffs.map((d) => d.path)).toEqual(["eslint.config.js"]);
  });
});
