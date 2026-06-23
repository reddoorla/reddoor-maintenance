#!/usr/bin/env node
// Smoke gate for built artifacts. Runs AFTER `pnpm build` and catches the
// class of bugs that surface only in dist context — silent drift where
// vitest passes against source but consumers break against dist.
//
// Bugs this gate would have caught:
//   - 0.10.0: selfPackageVersion "two levels up" shortcut returned "0.0.0"
//             from dist/index.js (1 dir deep, not 2) → consumers pinned ^0.0.0
//   - 0.10.1: loadBundledImages ENOENT — src-relative path didn't follow the
//             bundle into dist/cli/bin.js
//   - missing re-exports on dist/index.js
//   - CLI subcommand dynamic-import paths broken by bundling

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const distIndex = resolve(repoRoot, "dist/index.js");
const distBin = resolve(repoRoot, "dist/cli/bin.js");
const pkgVersion = JSON.parse(readFileSync(resolve(repoRoot, "package.json"), "utf-8")).version;
const distUrl = pathToFileURL(distIndex).toString();

const failures = [];

async function check(name, fn) {
  try {
    await fn();
    process.stdout.write(`  ✓ ${name}\n`);
  } catch (e) {
    failures.push({ name, error: e });
    process.stdout.write(`  ✗ ${name} — ${e.message}\n`);
  }
}

// Central-only deps: server/report/db/audit-runner packages that this repo's
// CLI, Netlify functions, and audit pipeline use, but that a consuming fleet
// site must NOT inherit (it installs @reddoorla/maintenance only for `./forms`
// + `./configs/*` and runs `reddoor-maint audit --only a11y` in CI). They are
// `devDependencies`; the CLI reaches them only via LAZY `import()` inside each
// command action. If any reappears in bin.js's STATIC import closure, an eager
// top-level import has crept back and every consumer's node_modules would pull
// the heavy chain (mjml→html-minifier, @lhci/cli→tmp, …) again.
const CENTRAL_ONLY_DEPS = [
  "mjml",
  "resend",
  "airtable",
  "@google-analytics/data",
  "google-auth-library",
  "@libsql/client",
  "@libsql/kysely-libsql",
  "kysely",
  "sharp",
  "svix",
  "@lhci/cli",
];

// Static-import closure of a dist entry: follows ONLY static `import/export …
// from "…"` and bare `import "…"` — never dynamic `import("…")` (the lazy
// command loads). Returns the set of bare (node_modules) package names reachable.
function staticBareDepsReachableFrom(entry) {
  const seen = new Set();
  const bare = new Set();
  const stack = [entry];
  while (stack.length) {
    const file = stack.pop();
    if (seen.has(file) || !existsSync(file)) continue;
    seen.add(file);
    for (const line of readFileSync(file, "utf-8").split("\n")) {
      // A static import line either has a `from "spec"` clause or is a bare
      // side-effect `import "spec"`. A dynamic `await import("spec")` appears
      // mid-line (after `=`/`await`) and matches neither — exactly the point.
      const m =
        /^\s*(?:import|export)\b[^;]*?\bfrom\s*["']([^"']+)["']/.exec(line) ??
        /^\s*import\s*["']([^"']+)["']/.exec(line);
      const spec = m?.[1];
      if (!spec || spec.startsWith("node:")) continue;
      if (spec.startsWith(".") || spec.startsWith("/")) {
        const p = resolve(dirname(file), spec);
        for (const c of [p, `${p}.js`, resolve(p, "index.js")]) {
          if (existsSync(c)) {
            stack.push(c);
            break;
          }
        }
      } else {
        const parts = spec.split("/");
        bare.add(spec.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0]);
      }
    }
  }
  return bare;
}

process.stdout.write(`smoke-dist (${pkgVersion}):\n`);

await check("dist/index.js exists", () => {
  if (!existsSync(distIndex)) throw new Error(`missing: ${distIndex} (run 'pnpm build')`);
});

await check("dist/cli/bin.js exists", () => {
  if (!existsSync(distBin)) throw new Error(`missing: ${distBin} (run 'pnpm build')`);
});

// Every entry a consuming fleet site can load — the CLI bin (run as
// `reddoor-maint audit --only a11y` in CI) and the `./forms` + `./configs/*`
// subpath exports — must have a STATIC import closure free of the central-only
// deps, so those packages never need resolving from a consumer's node_modules.
// (The kitchen-sink `.` entry is exempt: it deliberately re-exports the report/
// audit/dashboard surface and is used only inside this repo, never by the fleet.)
const consumerFacingEntries = {
  "cli/bin.js": distBin,
  "forms/index.js": resolve(repoRoot, "dist/forms/index.js"),
  "configs/lighthouse.js": resolve(repoRoot, "dist/configs/lighthouse.js"),
  "configs/eslint.js": resolve(repoRoot, "dist/configs/eslint.js"),
  "configs/prettier.js": resolve(repoRoot, "dist/configs/prettier.js"),
  "configs/playwright-a11y.js": resolve(repoRoot, "dist/configs/playwright-a11y.js"),
  "configs/svelte.js": resolve(repoRoot, "dist/configs/svelte.js"),
};

for (const [label, entry] of Object.entries(consumerFacingEntries)) {
  await check(`${label} static import closure is free of central-only deps`, () => {
    const reachable = staticBareDepsReachableFrom(entry);
    const leaked = CENTRAL_ONLY_DEPS.filter((d) => reachable.has(d));
    if (leaked.length) {
      throw new Error(
        `${label} statically imports central-only dep(s): ${leaked.join(", ")} — these are ` +
          `devDependencies a consuming site never installs, so it would crash at load. For the ` +
          `CLI, the command must load LAZILY (dynamic import inside the action); for a subpath ` +
          `export, drop the eager import. Check the relevant src entry.`,
      );
    }
  });
}

await check("CLI --version reports real package.json version", () => {
  const out = execFileSync(process.execPath, [distBin, "--version"], {
    encoding: "utf-8",
  }).trim();
  if (!out.includes(`reddoor-maint/${pkgVersion}`)) {
    throw new Error(`expected 'reddoor-maint/${pkgVersion}' in: ${out}`);
  }
  if (/\/(unknown|0\.0\.0)\b/.test(out)) {
    throw new Error(`CLI reported placeholder version: ${out}`);
  }
});

const expectedSubcommands = [
  "list-audits",
  "list-recipes",
  "audit",
  "sync-configs",
  "bump-deps",
  "upgrade",
  "convert-to-pnpm",
  "svelte-codemods",
  "onboard",
  "init",
  "report",
  // The heaviest dynamic-import commands — exactly the ones whose deep
  // src/ import paths are most likely to break under bundling and slip past
  // vitest (which runs against source). `launch` takes a required <site>
  // positional but cac still short-circuits `launch --help` to exit 0 (unlike
  // `upgrade`, whose <upgrade> arg cac validates first — hence the skip below).
  "self-updating",
  "launch",
  "github-signals",
  "db",
];

await check("CLI --help exits 0 and lists all expected commands", () => {
  const out = execFileSync(process.execPath, [distBin, "--help"], { encoding: "utf-8" });
  const missing = expectedSubcommands.filter((cmd) => !out.includes(cmd));
  if (missing.length) throw new Error(`missing commands in help: ${missing.join(", ")}`);
});

// `upgrade` requires a positional <upgrade>, so we skip --help for it (cac
// rejects unknown subcommand parse otherwise); the top-level help already
// asserted it is registered.
for (const cmd of expectedSubcommands.filter((c) => c !== "upgrade")) {
  await check(`CLI '${cmd} --help' exits 0`, () => {
    execFileSync(process.execPath, [distBin, cmd, "--help"], { encoding: "utf-8" });
  });
}

const requiredExports = [
  // audits
  "runAudits",
  "runAuditsAcross",
  "ALL_AUDIT_NAMES",
  // recipes
  "syncConfigs",
  "bumpDeps",
  "upgradeSvelte4to5",
  "svelteCodemods",
  "convertToPnpm",
  "onboard",
  "a11yFixturesPage",
  "init",
  "DEFAULT_INIT_STEPS",
  "ALL_RECIPE_NAMES",
  "isRecipeName",
  // inventory
  "localPath",
  "fromJsonFile",
  "fromAirtableBase",
  // reports
  "draftReportForSite",
  "sendApprovedReports",
  "renderReportHtml",
  "findDueReports",
  // bundled assets — present so the asset-resolution regression can be reproduced
  "loadBundledImages",
  "CHECK_CID",
  "BLURRED_CID",
  // version helpers — present so consumers can pin to our actual version
  "selfPackageVersion",
  "selfCaretRange",
  // dashboard — Netlify functions import these for the per-site /s/:slug page
  // and the fleet homepage at /. Both are now gated by verifyBasicAuth (the
  // operator password); the per-site token model was retired 2026-06-10.
  "renderSiteDashboardHtml",
  "renderCockpitHtml",
  "verifyBasicAuth",
];

const mod = await import(distUrl);

await check("dist/index.js exposes all required public exports", () => {
  const missing = requiredExports.filter((name) => !(name in mod));
  if (missing.length) throw new Error(`missing exports: ${missing.join(", ")}`);
});

await check("selfPackageVersion via dist returns real version from arbitrary cwd", () => {
  // Subprocess from cwd `/` proves resolution doesn't piggyback on cwd —
  // that's the failure mode the 0.10.0 silent drift shipped under (consumers
  // run from their own project, never our repo root).
  const script = `
    import("${distUrl}").then(m => {
      process.stdout.write(String(m.selfPackageVersion("${distUrl}")));
    }).catch(e => { process.stderr.write(String(e)); process.exit(1); });
  `;
  const out = execFileSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: "/",
    encoding: "utf-8",
  });
  if (out !== pkgVersion) throw new Error(`expected '${pkgVersion}', got '${out}'`);
});

await check("loadBundledImages returns two non-empty buffers without ENOENT", async () => {
  const { check: checkPng, blurred } = await mod.loadBundledImages();
  if (!(checkPng.bytes instanceof Uint8Array) || checkPng.bytes.byteLength === 0) {
    throw new Error("check.png loaded but empty");
  }
  if (!(blurred.bytes instanceof Uint8Array) || blurred.bytes.byteLength === 0) {
    throw new Error("blurredTests.jpg loaded but empty");
  }
  if (checkPng.cid !== mod.CHECK_CID || blurred.cid !== mod.BLURRED_CID) {
    throw new Error(`CID mismatch: ${checkPng.cid}, ${blurred.cid}`);
  }
});

// Netlify-handler import resolution. The .mts handlers import deep `../../src/*`
// paths (Netlify bundles them from source at deploy, so they are NOT dist
// consumers and can't be `import()`-ed here). The failure mode this guards is
// the #180 incident: a renamed/moved src export breaks a handler import and
// surfaces only at deploy. We statically resolve each handler's `../../src/...`
// imports — verifying (a) the target file exists and (b) each named import is
// actually exported by it. `pnpm typecheck` (now incl. tsconfig.netlify.json)
// is the primary guard; this re-asserts it in the built-artifact gate so a
// release that skipped typecheck still can't ship a broken handler import.
const fnDir = resolve(repoRoot, "netlify/functions");
const handlerFiles = existsSync(fnDir) ? readdirSync(fnDir).filter((f) => f.endsWith(".mts")) : [];

// Parse `import { a, b } from "../../src/x.js"` and `import x from "..."`
// (default) and `import { a } from "..."` forms; we only care about src paths.
function srcImportsOf(handlerSource) {
  const out = [];
  const re =
    /import\s+(?:([A-Za-z0-9_$]+)\s*,?\s*)?(?:\{([^}]*)\})?\s*from\s*["'](\.\.\/\.\.\/src\/[^"']+)["']/g;
  let m;
  while ((m = re.exec(handlerSource)) !== null) {
    const named = (m[2] ?? "")
      .split(",")
      .map((s) =>
        s
          .trim()
          .split(/\s+as\s+/)[0]
          .trim(),
      )
      .filter(Boolean)
      // `import type { X }` members: tsc checks those; the runtime export check
      // would false-positive on type-only exports, so drop a leading `type `.
      .map((s) => s.replace(/^type\s+/, ""))
      .filter((s) => s.length > 0);
    out.push({ specifier: m[3], named });
  }
  return out;
}

for (const file of handlerFiles) {
  await check(`Netlify handler '${file}' resolves all its src/ imports`, () => {
    const handlerSrc = readFileSync(resolve(fnDir, file), "utf-8");
    const imports = srcImportsOf(handlerSrc);
    if (imports.length === 0) return; // a glue-only handler with no src imports
    for (const imp of imports) {
      // `../../src/x.js` (ESM specifier) → on disk it's `src/x.ts`.
      const rel = imp.specifier.replace(/^\.\.\/\.\.\//, "").replace(/\.js$/, ".ts");
      const target = resolve(repoRoot, rel);
      if (!existsSync(target)) {
        throw new Error(`${file} imports ${imp.specifier} but ${rel} does not exist`);
      }
      const targetSrc = readFileSync(target, "utf-8");
      for (const name of imp.named) {
        // Match `export { name }`, `export const/function/class/type name`, and
        // re-export barrels `export { name } from "..."`. A renamed export trips
        // this exactly like the #180 incident did in CI.
        const exported =
          new RegExp(
            `export\\s+(?:async\\s+)?(?:const|let|var|function|class|type|interface|enum)\\s+${name}\\b`,
          ).test(targetSrc) || new RegExp(`export\\s*\\{[^}]*\\b${name}\\b`).test(targetSrc);
        if (!exported) {
          throw new Error(
            `${file} imports {${name}} from ${imp.specifier} but it is not exported by ${rel}`,
          );
        }
      }
    }
  });
}

if (failures.length) {
  process.stderr.write(`\nsmoke-dist: ${failures.length} failure(s)\n`);
  process.exit(1);
}
process.stdout.write(`\nsmoke-dist: ${pkgVersion} OK\n`);
