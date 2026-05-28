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
import { existsSync, readFileSync } from "node:fs";
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

process.stdout.write(`smoke-dist (${pkgVersion}):\n`);

await check("dist/index.js exists", () => {
  if (!existsSync(distIndex)) throw new Error(`missing: ${distIndex} (run 'pnpm build')`);
});

await check("dist/cli/bin.js exists", () => {
  if (!existsSync(distBin)) throw new Error(`missing: ${distBin} (run 'pnpm build')`);
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
  // dashboard — Netlify function imports these for the per-site /s/:slug page
  "renderSiteDashboardHtml",
  "verifyDashboardToken",
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

if (failures.length) {
  process.stderr.write(`\nsmoke-dist: ${failures.length} failure(s)\n`);
  process.exit(1);
}
process.stdout.write(`\nsmoke-dist: ${pkgVersion} OK\n`);
