import { readFileSync } from "node:fs";
import { defineConfig } from "tsup";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf-8")) as {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
};

// Externalize EVERY node_modules dependency — this is a Node library, so nothing
// from node_modules should be inlined into dist. tsup auto-externalizes
// `dependencies` + `peerDependencies`, but the heavy server/report/db packages
// (mjml, resend, airtable, the libSQL/kysely stack, …) now live in
// `devDependencies` so consuming fleet sites don't inherit them — and tsup
// BUNDLES devDeps by default, which breaks non-bundleable packages (e.g. mjml's
// `require("path")` can't be rewritten to ESM). Marking all three groups external
// keeps each dep a runtime `import` resolved from node_modules (present here as a
// devDep; consumers only ever import the dependency-free `./forms` + `./configs/*`
// entries, so they never resolve these).
const external = Object.keys({
  ...pkg.dependencies,
  ...pkg.devDependencies,
  ...pkg.peerDependencies,
});

export default defineConfig({
  external,
  entry: [
    "src/index.ts",
    "src/forms/index.ts",
    "src/client/index.ts",
    "src/cli/bin.ts",
    "src/cli/commands/audit.ts",
    "src/configs/lighthouse.ts",
    "src/configs/eslint.ts",
    "src/configs/prettier.ts",
    "src/configs/playwright-a11y.ts",
    "src/configs/svelte.ts",
    "src/util/git.ts",
    "src/util/pkg.ts",
    "src/recipes/sync-configs.ts",
  ],
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  // Code-splitting ON so the CLI's per-command dynamic imports
  // (`await import("./commands/report.js")` in bin.ts) become real on-demand
  // chunks instead of being inlined into bin.js. With splitting OFF esbuild
  // collapses every command into bin.js so their external `import "mjml"` /
  // `import "airtable"` load at bin.js startup — making the CLI eagerly pull the
  // report/db dependency chains, which would crash a
  // consuming fleet site (those packages are devDeps, absent from its install)
  // the moment it ran `reddoor-maint audit --only a11y`. Splitting keeps bin.js's
  // static graph to just its own light deps; mjml/airtable/etc. live in the
  // report/db chunks, loaded only when those commands actually run. The
  // import.meta.url consumers (bundled-asset loader, selfPackageVersion) walk up
  // the dir tree, so they're unaffected by where splitting places a module.
  splitting: true,
  target: "node20",
  outDir: "dist",
  outExtension: () => ({ js: ".js" }),
  // Copy bundled email assets (check.png + blurredTests.jpg) into dist so the
  // runtime loader at dist/reports/maintenance-email/assets/index.js can read
  // them via fs.readFile from a path relative to import.meta.url.
  onSuccess: async () => {
    const { copyFile, mkdir } = await import("node:fs/promises");
    const dest = "dist/reports/maintenance-email/assets";
    await mkdir(dest, { recursive: true });
    await copyFile("src/reports/maintenance-email/assets/check.png", `${dest}/check.png`);
    await copyFile(
      "src/reports/maintenance-email/assets/blurredTests.jpg",
      `${dest}/blurredTests.jpg`,
    );
  },
});
