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

// The consumer-facing entries (CLI bin + ./forms + ./configs/*) must never
// statically import a "central-only" devDep (mjml, airtable, the libSQL/Kysely
// stack, …) — a consuming fleet site never installs those, so an eager import
// would crash it at load. We verify this by LOADING each entry under a Node
// resolution hook that makes those 11 packages unresolvable
// (scripts/central-dep-blocker.mjs), reproducing a consumer's install exactly.
// This replaces an earlier source-scanning regex that silently missed esbuild's
// multi-line imports and so passed vacuously.
const blockerBootstrap = pathToFileURL(resolve(here, "register-central-dep-blocker.mjs")).href;

// Spawn `node --import <blocker> …`; throws (non-zero exit) iff the loaded code's
// real import graph reaches a blocked central-only dep. stderr carries the
// blocker's message for the failure report.
function loadUnderBlocker(nodeArgs) {
  execFileSync(process.execPath, ["--import", blockerBootstrap, ...nodeArgs], {
    encoding: "utf-8",
    stdio: ["ignore", "ignore", "pipe"],
  });
}

process.stdout.write(`smoke-dist (${pkgVersion}):\n`);

await check("dist/index.js exists", () => {
  if (!existsSync(distIndex)) throw new Error(`missing: ${distIndex} (run 'pnpm build')`);
});

await check("dist/cli/bin.js exists", () => {
  if (!existsSync(distBin)) throw new Error(`missing: ${distBin} (run 'pnpm build')`);
});

// Prove the blocker actually blocks before trusting the green checks below:
// loading a central-only dep under it MUST fail. Without this self-test, an
// inert hook would make every entry "pass" vacuously — the failure mode of the
// regex gate this replaced.
await check("central-dep blocker is active (negative self-test)", () => {
  let threw = false;
  try {
    loadUnderBlocker(["--input-type=module", "-e", 'await import("airtable")']);
  } catch {
    threw = true;
  }
  if (!threw) {
    throw new Error(
      'the blocker did not reject `import "airtable"` — the guard is inert and would not catch ' +
        "a real leak. Check scripts/central-dep-blocker.mjs and its registration.",
    );
  }
});

// Every entry a consuming fleet site can load — the CLI bin (run as
// `reddoor-maint audit --only a11y` in CI) and the `./forms` + `./configs/*`
// subpath exports — must LOAD with the central-only deps made unresolvable, i.e.
// its real static import graph never reaches one. (The kitchen-sink `.` entry is
// exempt: it deliberately re-exports the report/audit/dashboard surface and is
// used only inside this repo, never by the fleet.)
await check("cli/bin.js loads with central-only deps blocked (lazy command loading holds)", () => {
  try {
    loadUnderBlocker([distBin, "--version"]);
  } catch (e) {
    throw new Error(
      `bin.js failed to load with the central-only deps blocked — an eager top-level import ` +
        `crept back into the CLI startup graph, so a consumer's \`reddoor-maint audit\` would ` +
        `crash. Make the offending command load LAZILY. Blocker output: ${e.stderr ?? e.message}`,
      { cause: e },
    );
  }
});

const subpathEntries = {
  "forms/index.js": resolve(repoRoot, "dist/forms/index.js"),
  "client/index.js": resolve(repoRoot, "dist/client/index.js"),
  "configs/lighthouse.js": resolve(repoRoot, "dist/configs/lighthouse.js"),
  "configs/eslint.js": resolve(repoRoot, "dist/configs/eslint.js"),
  "configs/prettier.js": resolve(repoRoot, "dist/configs/prettier.js"),
  "configs/playwright-a11y.js": resolve(repoRoot, "dist/configs/playwright-a11y.js"),
  "configs/svelte.js": resolve(repoRoot, "dist/configs/svelte.js"),
};

for (const [label, entry] of Object.entries(subpathEntries)) {
  await check(`${label} loads with central-only deps blocked`, () => {
    const url = pathToFileURL(entry).href;
    try {
      loadUnderBlocker(["--input-type=module", "-e", `await import(${JSON.stringify(url)})`]);
    } catch (e) {
      throw new Error(
        `${label} reaches a central-only dep in its static import graph — a consuming site ` +
          `(which never installs those devDeps) would crash at load. Drop the eager import. ` +
          `Blocker output: ${e.stderr ?? e.message}`,
        { cause: e },
      );
    }
  });
}

// The `audit` subcommand is the ONE command a consuming fleet site runs
// (`reddoor-maint audit --only a11y` in CI). bin.js loads it LAZILY, so the
// `bin.js --version` check above never exercises its import graph — a regression
// where audit transitively eager-imports a central-only dep (the libSQL/Kysely
// stack via fleet-events-writer → db/client) slips past bin.js and crashes only on
// the fleet. Load the command entry directly under the blocker to guard that path.
await check("cli/commands/audit.js loads with central-only deps blocked", () => {
  const auditEntry = resolve(repoRoot, "dist/cli/commands/audit.js");
  if (!existsSync(auditEntry)) throw new Error(`missing: ${auditEntry} (run 'pnpm build')`);
  const url = pathToFileURL(auditEntry).href;
  try {
    loadUnderBlocker(["--input-type=module", "-e", `await import(${JSON.stringify(url)})`]);
  } catch (e) {
    throw new Error(
      `audit reaches a central-only dep in its static import graph — a consuming site ` +
        `(which never installs those devDeps) would crash running \`reddoor-maint audit\`. ` +
        `Make the offending import lazy (e.g. dynamic import in db/client). Blocker output: ${e.stderr ?? e.message}`,
      { cause: e },
    );
  }
});

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
  "renovate-dispatch",
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
