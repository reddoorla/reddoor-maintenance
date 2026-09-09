import { describe, it, expect, beforeAll } from "vitest";
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { createServer, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { chmod, mkdir, mkdtemp, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { resolve, dirname, join } from "node:path";
import {
  matchHarness,
  MATCH_HARNESS_INSTALLED_PATHS,
} from "../../src/recipes/match-harness/index.js";
import {
  MATCH_HARNESS_FILES,
  GITIGNORE_MARKER,
  GITIGNORE_BLOCK,
  PRETTIERIGNORE_MARKER,
  PRETTIERIGNORE_BLOCK,
  CLAUDE_MD_MARKER,
  CLAUDE_MD_BLOCK,
  GATE_SH_TEMPLATE,
  LEDGER_MD_TEMPLATE,
} from "../../src/recipes/match-harness/template.js";
import type { SpawnFn, SpawnOptions } from "../../src/audits/util/spawn.js";
import { PRETTIER_FLAG_NOTE } from "../../src/recipes/_prettier.js";
import { copyFixtureToTmp } from "./_helpers/site-tmpdir.js";

const here = dirname(fileURLToPath(import.meta.url));
const pristine = resolve(here, "../fixtures/pristine-starter");
const noopSpawn: SpawnFn = async () => ({ code: 0, stdout: "", stderr: "" });

/** Write a file into the site and commit it, so the recipe's clean-tree check
 *  sees the pre-existing state as the site's own committed content rather than
 *  a dirty checkout. */
async function seed(cwd: string, rel: string, content: string): Promise<void> {
  await mkdir(dirname(join(cwd, rel)), { recursive: true });
  await writeFile(join(cwd, rel), content, "utf-8");
  execFileSync("git", ["add", "-A"], { cwd, stdio: "ignore" });
  execFileSync("git", ["commit", "-m", `seed ${rel}`], { cwd, stdio: "ignore" });
}

const read = (cwd: string, rel: string) => readFile(join(cwd, rel), "utf-8");
const occurrences = (haystack: string, needle: string) => haystack.split(needle).length - 1;
const exists = (cwd: string, rel: string) =>
  stat(join(cwd, rel)).then(
    () => true,
    () => false,
  );

const run = promisify(execFile);

/** THIS repo's prettier, standing in for a site's own. */
const prettierBin = resolve(here, "../../node_modules/.bin/prettier");

/** A spawn that runs a REAL prettier over exactly the paths the recipe passes,
 *  in the site, so the site's `.prettierrc.json` AND its `.prettierignore` both
 *  apply. The recording doubles prove which paths are handed over; this one
 *  proves what a formatter does to them. */
const realPrettierSpawn: SpawnFn = async (_cmd, args, opts) => {
  const paths = args.filter((a) => !a.startsWith("-") && a !== "exec" && a !== "prettier");
  try {
    const { stdout, stderr } = await run(prettierBin, ["--write", ...paths], { cwd: opts?.cwd });
    return { code: 0, stdout, stderr };
  } catch (e) {
    const err = e as { code?: number; stdout?: string; stderr?: string };
    return {
      code: typeof err.code === "number" ? err.code : 1,
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? "",
    };
  }
};

/** A site whose prettier disagrees with the templates in every way that bites:
 *  tabs, single quotes, no trailing comma. Measured 2026-09-09 across the 19
 *  clones in ~/Documents/GitHub that carry a prettier config: `erp-industrial`,
 *  `gallerysonder` and `welcome-to-the-flower-court` ship exactly this shape,
 *  `beachfront-dentistry` and `1836dig` ship prettier's bare defaults
 *  (printWidth 80), and the remaining 14 set printWidth 100 — which happens to
 *  match the templates and would hide this entirely. The site is left prettier-clean under its OWN config before the
 *  install, so a later `prettier --check .` failure can only be what the recipe
 *  wrote. */
function foreignPrettierSite(): Promise<string> {
  return copyFixtureToTmp(pristine, async (dir) => {
    await writeFile(
      join(dir, ".prettierrc.json"),
      JSON.stringify(
        {
          plugins: [fileURLToPath(import.meta.resolve("prettier-plugin-svelte"))],
          overrides: [{ files: "*.svelte", options: { parser: "svelte" } }],
          useTabs: true,
          singleQuote: true,
          trailingComma: "none",
          printWidth: 100,
        },
        null,
        2,
      ) + "\n",
      "utf-8",
    );
    await run(prettierBin, ["--write", "."], { cwd: dir });
  });
}

const owned = (o: "recipe" | "site") => MATCH_HARNESS_FILES.filter((f) => f.owner === o);

/** A skill directory whose page-diff answers `--version` and nothing else.
 *  gate.sh's first preflight compares `page-diff --version` field 4 against the
 *  harness's REPORT_SCHEMA before anything else runs, so without this every
 *  gate.sh case below would exit 2 for the wrong reason. */
async function stubSkill(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "match-skill-"));
  await writeFile(
    join(dir, "page-diff.mjs"),
    '#!/usr/bin/env node\nconsole.log("page-diff 0.0.0 report-schema 1");\n',
    "utf-8",
  );
  await chmod(join(dir, "page-diff.mjs"), 0o755);
  return dir;
}

/** The body of a stub style-census.mjs. It answers census.sh's usage-banner
 *  preflight, then writes whatever STUB_CENSUS_MODE asks for: a completed
 *  census (`clean` / `dirty`), one that dies the way a closed dev server does
 *  (`crash`), one over two pages that rendered no text at all (`blank`), one
 *  whose --vw never took (`novw`), or one whose counts line and whose printed
 *  rows disagree — the drift GUARD 2c exists for (`drift`, `ambdrift`) and the
 *  legitimate truncation it must NOT mistake for drift (`truncated`).
 *  `crash` dies AFTER the banner on purpose — the preflight passes, so only the
 *  per-run evidence check can catch it. String.raw so the `\n`s reach the file
 *  as source, not as newlines in this one. */
const STUB_CENSUS = String.raw`
const arg = (f) => {
  const i = process.argv.indexOf(f);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
if (!arg("--ref") || !arg("--cand")) {
  console.error("usage: node style-census.mjs --ref <url> --cand <url> [--vw 1440]");
  process.exit(2);
}
const mode = process.env.STUB_CENSUS_MODE ?? "clean";
if (mode === "crash") throw new Error("page.goto: net::ERR_CONNECTION_REFUSED");
const vw = Number(arg("--vw") ?? 1440);
// novw: the --vw argument never took, so all three logs carry the SAME census.
const shown = mode === "novw" ? 1440 : vw;
const runs = mode === "blank" ? 0 : 12;
// What the counts line REPORTS, which is not always what the rows below show.
const DRIFTED = { drift: [3, 0], truncated: [137, 0], ambdrift: [0, 5] };
const said = DRIFTED[mode] ?? [mode === "dirty" ? 1 : 0, 0];
console.log("\n=== style census, viewport " + shown + " ===");
console.log(
  "ref runs: " + runs + "   cand runs: " + runs +
    "   mismatches: " + said[0] + "   ambiguous: " + said[1],
);
// pad is the giveaway: style-census indents a row by TWO spaces and
// census-count.mjs matches /^ {2}y=/, so one space is a parse the printer
// disagrees with.
const row = (y, pad) => {
  console.log("\n" + pad + "y=" + String(y).padStart(6) + ' "book an appointment"');
  console.log("    ref:  Inter | 400 | 16px | 24px | ls=normal | none | rgb(0, 0, 0)");
  console.log("    cand: Inter | 400 | 11px | 24px | ls=normal | none | rgb(0, 255, 255)");
};
if (mode === "drift") {
  for (const y of [100, 200, 300]) row(y, " ");
} else if (mode === "truncated") {
  for (let i = 1; i <= 100; i++) row(i * 10, "  ");
  console.log("\n  … and 37 more (truncated print, all counted)");
} else if (mode === "ambdrift") {
  console.log("\n--- AMBIGUOUS (5): one side has extra elements carrying this");
  for (const y of [100, 200, 300, 400, 500]) row(y, " ");
} else if (said[0]) {
  row(100, "  ");
}
process.exit(said[0] > 0 || said[1] > 0 ? 1 : 0);
`;

/** A skill directory holding only that stub. */
async function stubCensusSkill(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "match-census-"));
  await writeFile(join(dir, "style-census.mjs"), STUB_CENSUS, "utf-8");
  return dir;
}

/** Rewrite fields of the installed site's harness.json. */
async function patchHarness(cwd: string, patch: Record<string, unknown>): Promise<void> {
  const p = join(cwd, "matching/harness.json");
  const j = JSON.parse(await readFile(p, "utf-8")) as Record<string, unknown>;
  await writeFile(p, JSON.stringify({ ...j, ...patch }, null, 2) + "\n", "utf-8");
}

/** Run a command inside the installed site. Resolves either way: these gates
 *  are SUPPOSED to refuse, and the assertion is about which refusal — a helper
 *  that only ever rejected would make "exit 2 for some other reason" look the
 *  same as the refusal under test. */
async function runIn(
  cwd: string,
  cmd: string,
  args: string[],
  env: NodeJS.ProcessEnv = {},
): Promise<{ code: number | string; out: string }> {
  try {
    const { stdout, stderr } = await run(cmd, args, { cwd, env: { ...process.env, ...env } });
    return { code: 0, out: `${stdout}${stderr}` };
  } catch (e) {
    const err = e as { code?: number | string; stdout?: string; stderr?: string };
    return { code: err.code ?? "no-exit-code", out: `${err.stdout ?? ""}${err.stderr ?? ""}` };
  }
}

/** Install the harness into a fresh copy of the pristine fixture. */
async function install(): Promise<string> {
  const cwd = await copyFixtureToTmp(pristine);
  const result = await matchHarness(
    { path: cwd },
    { ref: "https://ref.test" },
    { spawn: noopSpawn },
  );
  expect(result.status).toBe("applied");
  return cwd;
}

describe("recipes/match-harness", () => {
  it("installs every template file on a clean site, in one commit", async () => {
    const cwd = await copyFixtureToTmp(pristine);
    const result = await matchHarness(
      { path: cwd },
      { ref: "https://ref.test" },
      { spawn: noopSpawn },
    );
    expect(result.status).toBe("applied");
    expect(result.commits).toHaveLength(1);
    expect(result.notes).toMatch(/branch: maint\/match-harness-/);
    for (const f of MATCH_HARNESS_FILES) {
      if (f.rel === "matching/harness.json") continue; // rendered from --ref
      expect(await readFile(join(cwd, f.rel), "utf-8")).toBe(f.template);
    }
  });

  // --- harness.json is the one rendered file: prove the render, not its absence

  it("renders harness.json from --ref with the matrix intact", async () => {
    const cwd = await copyFixtureToTmp(pristine);
    await matchHarness({ path: cwd }, { ref: "https://ref.test/" }, { spawn: noopSpawn });
    const raw = await read(cwd, "matching/harness.json");
    expect(raw).not.toContain("__REF__");
    const cfg = JSON.parse(raw) as Record<string, unknown>;
    expect(cfg.ref).toBe("https://ref.test"); // trailing slash stripped
    expect(cfg.cand).toBe("http://localhost:5173");
    expect(cfg.matrix).toEqual([1440, 834, 390]);
    // The rest of the seed must survive the parse/re-serialise round trip.
    expect(cfg.threshold).toBe(0.1);
    expect(cfg.maxHeightDelta).toBe(0.05);
    expect(cfg.candMark).toBe("_app/immutable");
    expect((cfg.pages as { home: { uid: string; spec: string } }).home).toMatchObject({
      uid: "home",
      spec: "home",
    });
  });

  it("applies --cand and --matrix (a text replace on the seed would silently drop them)", async () => {
    const cwd = await copyFixtureToTmp(pristine);
    await matchHarness(
      { path: cwd },
      { ref: "https://ref.test", cand: "http://localhost:4173", matrix: [1280, 768] },
      { spawn: noopSpawn },
    );
    const cfg = JSON.parse(await read(cwd, "matching/harness.json")) as Record<string, unknown>;
    expect(cfg.cand).toBe("http://localhost:4173");
    expect(cfg.matrix).toEqual([1280, 768]);
  });

  it("refuses without a usable --ref, and writes nothing", async () => {
    const cwd = await copyFixtureToTmp(pristine);
    for (const ref of ["", "ref.test", "ftp://ref.test"]) {
      const result = await matchHarness({ path: cwd }, { ref }, { spawn: noopSpawn });
      expect(result.status).toBe("failed");
      expect(result.commits).toEqual([]);
      expect(result.notes).toContain("--ref <url> is required");
    }
    // "writes nothing" means the whole install, not one file: assert the
    // directory the recipe would have had to create is absent, so the case
    // cannot pass because only harness.mjs happened to be skipped.
    expect(await exists(cwd, "matching")).toBe(false);
    expect(await exists(cwd, "src/routes/dev/match/[uid]/+page.svelte")).toBe(false);
    await expect(read(cwd, "matching/harness.mjs")).rejects.toThrow();
  });

  // --- never overwrite a record: both directions of the byte-compare

  it("safe-replaces a recipe-owned script that still matches a previously shipped render", async () => {
    const cwd = await copyFixtureToTmp(pristine);
    const v1 = "#!/usr/bin/env bash\n# harness gate, previous shipped version\nexit 0\n";
    await seed(cwd, "matching/gate.sh", v1);

    const result = await matchHarness(
      { path: cwd },
      { ref: "https://ref.test" },
      { spawn: noopSpawn, previous: { "matching/gate.sh": [v1] } },
    );
    expect(result.status).toBe("applied");
    expect(await read(cwd, "matching/gate.sh")).toBe(GATE_SH_TEMPLATE);
    expect(result.notes).toContain("matching/gate.sh upgraded from a previous version");
  });

  it("flags a hand-edited recipe-owned script and leaves it byte-for-byte alone", async () => {
    const cwd = await copyFixtureToTmp(pristine);
    const v1 = "#!/usr/bin/env bash\n# harness gate, previous shipped version\nexit 0\n";
    const handEdited = `${v1}# operator added this line\n`;
    await seed(cwd, "matching/gate.sh", handEdited);

    const result = await matchHarness(
      { path: cwd },
      { ref: "https://ref.test" },
      { spawn: noopSpawn, previous: { "matching/gate.sh": [v1] } },
    );
    expect(result.status).toBe("applied"); // the other 16 files still install
    expect(await read(cwd, "matching/gate.sh")).toBe(handEdited);
    expect(result.notes).toContain(
      "matching/gate.sh differs from the shipped template and was left alone",
    );
    expect(result.notes).not.toContain("matching/gate.sh upgraded");
    // and the rest of the install still happened
    expect(await read(cwd, "matching/next.mjs")).not.toBe(handEdited);
  });

  it("treats a CRLF / trailing-whitespace-only difference as still ours, not a hand edit", async () => {
    const cwd = await copyFixtureToTmp(pristine);
    const reformatted = `${GATE_SH_TEMPLATE.replace(/\n/g, "\r\n").replace(/\r\n/g, "  \r\n")}\r\n`;
    await seed(cwd, "matching/gate.sh", reformatted);

    const result = await matchHarness(
      { path: cwd },
      { ref: "https://ref.test" },
      { spawn: noopSpawn },
    );
    expect(result.notes ?? "").not.toContain("matching/gate.sh");
    expect(await read(cwd, "matching/gate.sh")).toBe(reformatted); // skipped, untouched
  });

  it("never rewrites a site-owned record, and never flags one", async () => {
    const cwd = await copyFixtureToTmp(pristine);
    const ledger = "# Deviations ledger\n\n## 2026-09-01 — hero mask, 3px\n\nReal content.\n";
    await seed(cwd, "matching/LEDGER.md", ledger);

    const result = await matchHarness(
      { path: cwd },
      { ref: "https://ref.test" },
      { spawn: noopSpawn },
    );
    expect(await read(cwd, "matching/LEDGER.md")).toBe(ledger);
    expect(ledger).not.toBe(LEDGER_MD_TEMPLATE); // the fixture really did differ
    expect(result.notes ?? "").not.toContain("matching/LEDGER.md");
  });

  it("leaves an operator-written harness.json alone (it is the site's configuration)", async () => {
    const cwd = await copyFixtureToTmp(pristine);
    const mine = `${JSON.stringify({ ref: "https://mine.test", pages: {} }, null, 2)}\n`;
    await seed(cwd, "matching/harness.json", mine);

    await matchHarness({ path: cwd }, { ref: "https://ref.test" }, { spawn: noopSpawn });
    expect(await read(cwd, "matching/harness.json")).toBe(mine);
  });

  // --- what is handed to the site's prettier

  /** Records every spawn the recipe makes. `SITE_PRETTIER` stands in for a
   *  populated `node_modules/.bin` so these cases can assert the absolute-path
   *  invocation without installing ~20 devDependencies into the fixture. */
  const SITE_PRETTIER = "/site/node_modules/.bin/prettier";
  type Call = { cmd: string; args: readonly string[]; opts?: SpawnOptions };
  function recorder(code = 0): { calls: Call[]; spawn: SpawnFn } {
    const calls: Call[] = [];
    const spawn: SpawnFn = async (cmd, args, opts) => {
      calls.push({ cmd, args, ...(opts !== undefined ? { opts } : {}) });
      return { code, stdout: "", stderr: "" };
    };
    return { calls, spawn };
  }

  it("hands the site's prettier only files the SITE owns — never one the recipe owns", async () => {
    const cwd = await copyFixtureToTmp(pristine);
    const { calls, spawn } = recorder();
    await matchHarness(
      { path: cwd },
      { ref: "https://ref.test" },
      { spawn, resolvePrettier: async () => SITE_PRETTIER },
    );

    expect(calls).toHaveLength(1);
    // No `exec`/`prettier` filter: after the fix there is no `pnpm exec` argv to
    // strip, so a re-introduced one shows up here as two extra "paths".
    const paths = calls[0]!.args.filter((a) => !a.startsWith("-"));

    // GRANTS: every site-owned record the install wrote is handed over, so this
    // cannot pass by handing prettier nothing at all.
    expect([...paths].sort()).toEqual([...owned("site").map((f) => f.rel), "CLAUDE.md"].sort());
    // DENIES: and not one recipe-owned file. Named individually so the failure
    // message says which — the whole class, not the two that happen to reflow.
    for (const f of owned("recipe"))
      expect(paths, `${f.rel} is recipe-owned and must never be formatted`).not.toContain(f.rel);
    // Neither ignore file: prettier has no parser for them.
    expect(paths).not.toContain(".gitignore");
    expect(paths).not.toContain(".prettierignore");
  });

  it("runs the SITE's own prettier by absolute path, under a timeout — never `pnpm exec`", async () => {
    const cwd = await copyFixtureToTmp(pristine);
    const { calls, spawn } = recorder();
    const result = await matchHarness(
      { path: cwd },
      { ref: "https://ref.test" },
      { spawn, resolvePrettier: async () => SITE_PRETTIER },
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]!.cmd).toBe(SITE_PRETTIER);
    expect(calls[0]!.args[0]).toBe("--write");
    expect(calls[0]!.args).not.toContain("exec");
    // Without a timeout the fleet's default spawn never detaches and never
    // kills: an implicit install in a client repo would run unbounded.
    expect(calls[0]!.opts?.timeoutMs).toBe(60_000);
    expect(calls[0]!.opts?.cwd).toBe(cwd);
    // The green is positive: the target's own prettier ran and exited 0, so
    // there is nothing to flag.
    expect(result.status).toBe("applied");
    expect(result.notes ?? "").not.toContain(PRETTIER_FLAG_NOTE);
  });

  it("resolves that prettier from the checkout itself when none is injected", async () => {
    const cwd = await copyFixtureToTmp(pristine);
    // node_modules must be ignored first or the clean-tree gate throws on it.
    await seed(cwd, ".gitignore", "node_modules\n");
    await mkdir(join(cwd, "node_modules", ".bin"), { recursive: true });
    await writeFile(join(cwd, "node_modules", ".bin", "prettier"), "#!/bin/sh\nexit 0\n", "utf-8");
    const { calls, spawn } = recorder();

    await matchHarness({ path: cwd }, { ref: "https://ref.test" }, { spawn });

    // Not merely "not pnpm": the exact binary inside THIS checkout.
    expect(calls.map((c) => c.cmd)).toEqual([
      await realpath(join(cwd, "node_modules", ".bin", "prettier")),
    ]);
  });

  it("never shells out into a clone with no prettier: it skips, flags, and still commits", async () => {
    // The fleet path exactly — `prepareFleetSites` clones and never installs,
    // so every site arrives without node_modules. Nothing may run there.
    const cwd = await copyFixtureToTmp(pristine);
    const { calls, spawn } = recorder();
    const result = await matchHarness({ path: cwd }, { ref: "https://ref.test" }, { spawn });

    expect(calls).toEqual([]);
    expect(result.status).toBe("applied");
    expect(result.commits).toHaveLength(1);
    expect(result.notes).toContain(PRETTIER_FLAG_NOTE);
  });

  it("owns the route, its page and the fixture test; the site owns the records", () => {
    // The two guards above and below are computed from `owner`, so a mislabelled
    // file would move silently between them. This is the literal census.
    expect(
      owned("recipe")
        .map((f) => f.rel)
        .sort(),
    ).toEqual(
      [
        "matching/build-spec.mjs",
        "matching/census-count.mjs",
        "matching/census.sh",
        "matching/gate.sh",
        "matching/harness.mjs",
        "matching/next.mjs",
        "matching/strikes.mjs",
        "src/lib/site-pages.test.ts",
        "src/routes/dev/match/[uid]/+page.server.ts",
        "src/routes/dev/match/[uid]/+page.svelte",
      ].sort(),
    );
    expect(
      owned("site")
        .map((f) => f.rel)
        .sort(),
    ).toEqual(
      [
        "matching/LEDGER.md",
        "matching/census-deviations.mjs",
        "matching/floors.mjs",
        "matching/harness.json",
        "matching/spec-sections/_chrome.md",
        "matching/spec-sections/_header.md",
        "src/lib/site-pages.js",
      ].sort(),
    );
  });

  it("a site whose prettier config differs cannot break the NEXT upgrade", async () => {
    const cwd = await foreignPrettierSite();

    const first = await matchHarness(
      { path: cwd },
      { ref: "https://ref.test" },
      { spawn: realPrettierSpawn, resolvePrettier: async () => prettierBin },
    );
    expect(first.status).toBe("applied");

    // POSITIVE CONTROL: the formatter really ran, and really does disagree with
    // the template style. site-pages.js is site-owned, sits in the same
    // directory as a recipe-owned file, and comes back rewritten. Without this
    // the case passes just as well when prettier never ran at all.
    const sitePages = owned("site").find((f) => f.rel === "src/lib/site-pages.js")!;
    expect(await read(cwd, sitePages.rel)).not.toBe(sitePages.template);

    // And every recipe-owned file is still byte-identical to its template.
    for (const f of owned("recipe"))
      expect(await read(cwd, f.rel), `${f.rel} was reformatted on install`).toBe(f.template);

    // So the second run has nothing to flag and nothing to do. Before the fix
    // this reported three files "hand-edited" and could never upgrade them.
    const second = await matchHarness(
      { path: cwd },
      { ref: "https://ref.test" },
      { spawn: realPrettierSpawn, resolvePrettier: async () => prettierBin },
    );
    expect(second.status).toBe("noop");
    expect(second.notes ?? "").not.toContain("differs from the shipped template");
  });

  it("puts every recipe-owned file in the site's .prettierignore, brackets escaped", async () => {
    const cwd = await foreignPrettierSite();
    await matchHarness(
      { path: cwd },
      { ref: "https://ref.test" },
      { spawn: realPrettierSpawn, resolvePrettier: async () => prettierBin },
    );
    const prettier = await import("prettier");
    const ignorePath = [join(cwd, ".gitignore"), join(cwd, ".prettierignore")];

    for (const f of owned("recipe")) {
      const info = await prettier.getFileInfo(join(cwd, f.rel), { ignorePath });
      expect(info.ignored, `${f.rel} is not ignored by the site's own prettier`).toBe(true);
    }
    // CONTROL: the ignore stays narrow — a site record is still checked. eslint
    // does not lint Markdown, so prettier is the only style check it has.
    expect(
      (await prettier.getFileInfo(join(cwd, "matching/LEDGER.md"), { ignorePath })).ignored,
    ).toBe(false);

    // harness.json is SITE-owned, so the loop above does not reach it, and its
    // line in the block was removable with nothing going red. It is data the
    // recipe seeds and the operator then edits by hand — the page table, the
    // two hosts, the matrix — and re-flowing it is the one way this recipe can
    // still churn a file it does not own.
    expect(
      (await prettier.getFileInfo(join(cwd, "matching/harness.json"), { ignorePath })).ignored,
      "matching/harness.json is not ignored by the site's own prettier",
    ).toBe(true);

    // The ignore is doing real work, not covering files that already match:
    // read through the config this site resolves, BYPASSING the ignore, and the
    // template fails. Otherwise "clean" and "ignored" look the same.
    for (const rel of [
      "src/routes/dev/match/[uid]/+page.server.ts",
      "src/routes/dev/match/[uid]/+page.svelte",
      "src/lib/site-pages.test.ts",
    ]) {
      const cfg = await prettier.resolveConfig(join(cwd, rel));
      const tmpl = MATCH_HARNESS_FILES.find((f) => f.rel === rel)!.template;
      expect(
        await prettier.check(tmpl, { ...cfg, filepath: join(cwd, rel) }),
        `${rel} already matches this site's style — the case would prove nothing`,
      ).toBe(false);
    }

    // The point of all of it: the site's first `prettier --check .` is green.
    const check = await run(prettierBin, ["--check", "."], { cwd }).then(
      () => ({ code: 0 as number | string, out: "" }),
      (e: { code?: number | string; stdout?: string; stderr?: string }) => ({
        code: e.code ?? "no-exit-code",
        out: `${e.stdout ?? ""}${e.stderr ?? ""}`,
      }),
    );
    expect(check.code, check.out).toBe(0);
  });

  it("flags — but still commits — when the site's prettier cannot run", async () => {
    const cwd = await copyFixtureToTmp(pristine);
    const { calls, spawn } = recorder(1);
    const result = await matchHarness(
      { path: cwd },
      { ref: "https://ref.test" },
      { spawn, resolvePrettier: async () => SITE_PRETTIER },
    );
    // Distinct from the skip case above: prettier WAS found and WAS run, and it
    // is its non-zero exit — not its absence — that raises the flag.
    expect(calls).toHaveLength(1);
    expect(result.status).toBe("applied");
    expect(result.commits).toHaveLength(1);
    expect(result.notes).toContain(PRETTIER_FLAG_NOTE);
  });

  it("a run that wrote nothing is note-free, even with no prettier to run", async () => {
    const cwd = await copyFixtureToTmp(pristine);
    const { calls, spawn } = recorder(0);
    // No resolvePrettier override: the fixture has no node_modules, so the REAL
    // resolver finds nothing and the format is skipped and flagged.
    const first = await matchHarness({ path: cwd }, { ref: "https://ref.test" }, { spawn });
    expect(first.status).toBe("applied");
    expect(first.notes).toContain(PRETTIER_FLAG_NOTE);

    const second = await matchHarness({ path: cwd }, { ref: "https://ref.test" }, { spawn });
    // The emptiness guard, which nothing else measures. Drop
    // `if (toFormat.length > 0)` and this run — which wrote no file and has
    // nothing to format — still tells the operator to go and check CI's
    // formatting. A note that fires on a no-op is a note that stops being read.
    expect(second.status).toBe("noop");
    expect(second.notes ?? "").not.toContain(PRETTIER_FLAG_NOTE);
    // and nothing was spawned on either run: the skip is a skip
    expect(calls).toHaveLength(0);
  });

  // --- the three marked blocks

  it("creates an absent merge target holding exactly the marker and the block", async () => {
    const cwd = await copyFixtureToTmp(pristine);
    // The fixture ships none of the three.
    for (const rel of [".gitignore", ".prettierignore", "CLAUDE.md"]) {
      await expect(read(cwd, rel)).rejects.toThrow();
    }
    await matchHarness({ path: cwd }, { ref: "https://ref.test" }, { spawn: noopSpawn });
    expect(await read(cwd, ".gitignore")).toBe(`${GITIGNORE_MARKER}\n${GITIGNORE_BLOCK}`);
    expect(await read(cwd, ".prettierignore")).toBe(
      `${PRETTIERIGNORE_MARKER}\n${PRETTIERIGNORE_BLOCK}`,
    );
    expect(await read(cwd, "CLAUDE.md")).toBe(`${CLAUDE_MD_MARKER}\n${CLAUDE_MD_BLOCK}`);
  });

  it("appends to a present merge target without disturbing what was there", async () => {
    const cwd = await copyFixtureToTmp(pristine);
    await seed(cwd, ".gitignore", "node_modules\n.svelte-kit\n");
    await seed(cwd, "CLAUDE.md", "# Site rules\n\nExisting prose."); // no trailing newline

    await matchHarness({ path: cwd }, { ref: "https://ref.test" }, { spawn: noopSpawn });

    const gitignore = await read(cwd, ".gitignore");
    expect(gitignore.startsWith("node_modules\n.svelte-kit\n")).toBe(true);
    expect(gitignore).toContain(GITIGNORE_MARKER);
    expect(gitignore).toContain("!matching/PAUSED");

    const claude = await read(cwd, "CLAUDE.md");
    expect(claude.startsWith("# Site rules\n\nExisting prose.\n")).toBe(true);
    expect(claude).toContain(CLAUDE_MD_MARKER);
  });

  // --- idempotency

  it("is a noop on a second run: no second commit, no duplicated block", async () => {
    const cwd = await copyFixtureToTmp(pristine);
    const first = await matchHarness(
      { path: cwd },
      { ref: "https://ref.test" },
      { spawn: noopSpawn },
    );
    expect(first.status).toBe("applied");

    const second = await matchHarness(
      { path: cwd },
      { ref: "https://ref.test" },
      { spawn: noopSpawn },
    );
    expect(second.status).toBe("noop");
    expect(second.commits).toEqual([]);

    expect(occurrences(await read(cwd, ".gitignore"), GITIGNORE_MARKER)).toBe(1);
    expect(occurrences(await read(cwd, ".prettierignore"), PRETTIERIGNORE_MARKER)).toBe(1);
    expect(occurrences(await read(cwd, "CLAUDE.md"), CLAUDE_MD_MARKER)).toBe(1);
    // and the block bodies too, not just their markers
    expect(occurrences(await read(cwd, ".gitignore"), "!matching/PAUSED")).toBe(1);
    expect(occurrences(await read(cwd, "CLAUDE.md"), "### Round protocol")).toBe(1);

    // every installed file is still byte-identical to the template
    for (const f of MATCH_HARNESS_FILES) {
      if (f.rel === "matching/harness.json") continue;
      expect(await read(cwd, f.rel)).toBe(f.template);
    }
  });

  // --- the installed harness EXECUTES
  //
  // Everything above proves the recipe copied bytes. The three cases below
  // shell out into the installed site and prove the copied thing runs: each
  // must refuse for its own stated reason, not merely exit non-zero.

  it("next.mjs refuses on an empty corpus rather than reporting a score", async () => {
    const cwd = await install();

    // The pause switch is the FIRST thing next.mjs evaluates and exits 0 on. If
    // the recipe ever installed a PAUSED file this case would pass without
    // reaching the guard it is actually about.
    expect(await exists(cwd, "matching/PAUSED")).toBe(false);

    const { code, out } = await runIn(cwd, "node", ["matching/next.mjs"]);
    expect(out).toMatch(/no parseable gate run/);
    expect(code).toBe(2);
    // not a module-resolution or JSON-parse crash dressed up as a refusal
    expect(out).not.toMatch(/Cannot find module|SyntaxError|ERR_MODULE_NOT_FOUND/);
  });

  it("gate.sh refuses the seeded reference: refMark is empty until someone names one", async () => {
    const cwd = await install();
    const skill = await stubSkill();

    const { code, out } = await runIn(cwd, "bash", ["matching/gate.sh", "smoke", "home"], {
      MATCHING_SKILL_DIR: skill,
    });
    expect(out).toMatch(/refMark is empty/);
    expect(code).toBe(2);
    // The seed ships refMark: "" on purpose — a fresh install cannot produce a
    // score until someone names a string only the reference serves. Prove it is
    // THAT refusal: the schema preflight was passed, and Phase 1 was never
    // reached.
    expect(out).not.toMatch(/report schema/);
    expect(out).not.toMatch(/REFUSED: no '## home' section/);
  });

  it("gate.sh reaches the Phase 1 refusal once the reference verifies", async () => {
    const cwd = await install();
    const skill = await stubSkill();

    const server = createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/html" });
      res.end("REFMARK-OK");
    });
    try {
      await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
      const { port } = server.address() as AddressInfo;
      await patchHarness(cwd, { ref: `http://127.0.0.1:${port}`, refMark: "REFMARK-OK" });

      const { code, out } = await runIn(cwd, "bash", ["matching/gate.sh", "smoke", "home"], {
        MATCHING_SKILL_DIR: skill,
      });
      // Same exit code as the case above, a DIFFERENT refusal: --check-ref now
      // passes, so the run gets as far as the spec preflight. This is the
      // sentence the matching skill's gate names, produced by the template on a
      // site that has never had a spec written.
      expect(out).toMatch(/REFUSED: no '## home' section in matching\/SPEC\.md/);
      expect(out).toMatch(/GATE INCOMPLETE \(smoke\)/);
      expect(code).toBe(2);
      expect(out).not.toMatch(/refMark is empty/);
      expect(out).not.toMatch(/refusing to gate against an unverified reference/);
    } finally {
      await new Promise<void>((done) => server.close(() => done()));
    }
  });

  // --- census.sh: a CLEAN must come from a census that RAN
  //
  // It did not. With style-census.mjs absent, all three runs died on module
  // resolution, census-count.mjs read each crash log as "0 0 0", and this gate
  // printed "Phase 3 CLEAN" and exited 0. The first case below is the load
  // bearing one: it is the only one that proves the guards can still say yes,
  // and a guard proven only to refuse is not proven.

  it("census.sh reports CLEAN when the census ran and found nothing", async () => {
    const cwd = await install();
    const skill = await stubCensusSkill();
    const { code, out } = await runIn(cwd, "bash", ["matching/census.sh"], {
      MATCHING_SKILL_DIR: skill,
      STUB_CENSUS_MODE: "clean",
    });
    expect(out).toMatch(/Phase 3 CLEAN/);
    // the count of runs the green is made of, so a green over nothing reads
    // differently from a green over the matrix
    expect(out).toMatch(/3 censused run\(s\) over 1 page\(s\)/);
    expect(code).toBe(0);
  });

  it("census.sh still fails on the mismatches a completed census found", async () => {
    const cwd = await install();
    const skill = await stubCensusSkill();
    const { code, out } = await runIn(cwd, "bash", ["matching/census.sh"], {
      MATCHING_SKILL_DIR: skill,
      STUB_CENSUS_MODE: "dirty",
    });
    expect(out).toMatch(/3 type mismatch\(es\) remain/);
    expect(code).toBe(1);
    expect(out).not.toMatch(/Phase 3 CLEAN|CENSUS INCOMPLETE/);
  });

  it("census.sh refuses when every run died — the green this guard exists for", async () => {
    const cwd = await install();
    const skill = await stubCensusSkill();
    const { code, out } = await runIn(cwd, "bash", ["matching/census.sh"], {
      MATCHING_SKILL_DIR: skill,
      STUB_CENSUS_MODE: "crash",
    });
    expect(out).toMatch(/CENSUS INCOMPLETE — 3 of 3 run\(s\) produced no usable census/);
    expect(code).toBe(2);
    expect(out).not.toMatch(/Phase 3 CLEAN/);
  });

  it("census.sh refuses two pages that rendered no text — they agree perfectly", async () => {
    const cwd = await install();
    const skill = await stubCensusSkill();
    const { code, out } = await runIn(cwd, "bash", ["matching/census.sh"], {
      MATCHING_SKILL_DIR: skill,
      STUB_CENSUS_MODE: "blank",
    });
    expect(out).toMatch(/CENSUS INCOMPLETE — 3 of 3 run\(s\) produced no usable census/);
    expect(code).toBe(2);
    expect(out).not.toMatch(/Phase 3 CLEAN/);
  });

  it("census.sh refuses when style-census.mjs is not installed at all", async () => {
    const cwd = await install();
    const empty = await mkdtemp(join(tmpdir(), "match-noskill-"));
    const { code, out } = await runIn(cwd, "bash", ["matching/census.sh"], {
      MATCHING_SKILL_DIR: empty,
    });
    expect(out).toMatch(/no style-census at .*style-census\.mjs/);
    expect(code).toBe(2);
    // THAT refusal: the existence probe, before a single run was spent. Every
    // guard in this file exits 2, so a case that asserted only the code would
    // pass with the probe deleted.
    expect(out).not.toMatch(/Phase 3 CLEAN/);
    expect(out).not.toMatch(/did not answer with a style-census/);
    expect(out).not.toMatch(/CENSUS INCOMPLETE/);
  });

  it("census.sh refuses a style-census that will not answer its usage banner", async () => {
    const cwd = await install();
    const mute = await mkdtemp(join(tmpdir(), "match-mute-"));
    await writeFile(join(mute, "style-census.mjs"), "process.exit(0);\n", "utf-8");
    const { code, out } = await runIn(cwd, "bash", ["matching/census.sh"], {
      MATCHING_SKILL_DIR: mute,
    });
    expect(out).toMatch(/did not answer with a style-census --ref\/--cand\/--vw usage/);
    expect(code).toBe(2);
    expect(out).not.toMatch(/Phase 3 CLEAN/);
    // the preflight caught it, so no run was spent on it
    expect(out).not.toMatch(/CENSUS INCOMPLETE/);
  });

  it("census.sh refuses a page name that matches nothing, and names the vocabulary", async () => {
    const cwd = await install();
    const skill = await stubCensusSkill();
    const { code, out } = await runIn(cwd, "bash", ["matching/census.sh", "hom"], {
      MATCHING_SKILL_DIR: skill,
      STUB_CENSUS_MODE: "clean",
    });
    expect(out).toMatch(/"hom" matches no page — refusing to report CLEAN/);
    expect(out).toMatch(/known pages: home/);
    expect(code).toBe(2);
    expect(out).not.toMatch(/Phase 3 CLEAN/);
  });

  it("census-count.mjs refuses a log it cannot read rather than counting it as zero", async () => {
    const cwd = await install();
    const { code, out } = await runIn(cwd, "node", [
      "matching/census-count.mjs",
      "matching/census-home-1440.log",
    ]);
    expect(out).toMatch(/cannot read .*census-home-1440\.log/);
    expect(out).not.toMatch(/^0 0 0$/m);
    expect(code).toBe(2);
  });

  // --- GUARD 2c: the count reported is the count the census MEASURED
  //
  // The guards above all ask "did a census RUN?" and then report whatever
  // census-count.mjs read out of the log, without ever comparing the two. That
  // left the same false green one step along: a COMPLETE census whose counts
  // line says `mismatches: 3`, whose `y=` rows carry one leading space instead
  // of two, was reported as 0 and this gate printed "Phase 3 CLEAN", exit 0
  // (measured 2026-09-09). The printer is versioned in the SKILL and the parser
  // is copied into every site, so neither repo has to change for them to drift.

  it("census.sh refuses a census whose counts line contradicts the rows it read", async () => {
    const cwd = await install();
    const skill = await stubCensusSkill();
    const { code, out } = await runIn(cwd, "bash", ["matching/census.sh"], {
      MATCHING_SKILL_DIR: skill,
      STUB_CENSUS_MODE: "drift",
    });
    // both numbers, so the reader can see WHICH side to go and look at
    expect(out).toMatch(/reports mismatches: 3 ambiguous: 0, but/);
    expect(out).toMatch(/census-count\.mjs read 0 mismatch row\(s\) and 0 ambiguous/);
    expect(out).toMatch(/CENSUS INCOMPLETE — 3 of 3 run\(s\) produced no usable census/);
    expect(code).toBe(2);
    expect(out).not.toMatch(/Phase 3 CLEAN/);
  });

  it("census.sh refuses a log reporting ambiguous rows its reader did not find", async () => {
    const cwd = await install();
    const skill = await stubCensusSkill();
    const { code, out } = await runIn(cwd, "bash", ["matching/census.sh"], {
      MATCHING_SKILL_DIR: skill,
      STUB_CENSUS_MODE: "ambdrift",
    });
    // mismatches agree at 0 here, so only the ambiguous leg can refuse this one
    expect(out).toMatch(/reports mismatches: 0 ambiguous: 5, but/);
    expect(code).toBe(2);
    expect(out).not.toMatch(/Phase 3 CLEAN/);
  });

  it("census.sh counts a truncated print rather than calling it drift", async () => {
    const cwd = await install();
    const skill = await stubCensusSkill();
    const { code, out } = await runIn(cwd, "bash", ["matching/census.sh"], {
      MATCHING_SKILL_DIR: skill,
      STUB_CENSUS_MODE: "truncated",
    });
    // style-census prints at most 100 rows and states the remainder on its own
    // line, so 100 read + 37 more == the 137 reported. The GRANT leg: without
    // it GUARD 2c would refuse every census over 100 mismatches, which is a
    // count it CAN honestly report.
    expect(out).toMatch(/300 type mismatch\(es\) remain/);
    expect(code).toBe(1);
    expect(out).not.toMatch(/CENSUS INCOMPLETE|Phase 3 CLEAN/);
  });

  it("census.sh refuses runs whose header does not carry the viewport asked for", async () => {
    const cwd = await install();
    const skill = await stubCensusSkill();
    const { code, out } = await runIn(cwd, "bash", ["matching/census.sh"], {
      MATCHING_SKILL_DIR: skill,
      STUB_CENSUS_MODE: "novw",
    });
    // 1440 is honest; 834 and 390 got the 1440 census under their own names,
    // which is the failure a presence-only check cannot see
    expect(out).toMatch(/CENSUS INCOMPLETE — 2 of 3 run\(s\) produced no usable census/);
    expect(code).toBe(2);
    expect(out).not.toMatch(/Phase 3 CLEAN/);
  });

  it("census.sh refuses when census-count.mjs dies instead of returning counts", async () => {
    const cwd = await install();
    const skill = await stubCensusSkill();
    // census-deviations.mjs is SITE-owned: a site editing its own ledger into a
    // syntax error takes census-count.mjs down with it, and it then prints
    // nothing at all — which bash reads as zero.
    await writeFile(
      join(cwd, "matching/census-deviations.mjs"),
      "export const DECLARED = [\n",
      "utf-8",
    );
    const { code, out } = await runIn(cwd, "bash", ["matching/census.sh"], {
      MATCHING_SKILL_DIR: skill,
      STUB_CENSUS_MODE: "clean",
    });
    expect(out).toMatch(/census-count\.mjs did not return three counts for/);
    expect(code).toBe(2);
    expect(out).not.toMatch(/Phase 3 CLEAN/);
  });

  it("census.sh refuses an empty page table rather than reporting CLEAN over nothing", async () => {
    const cwd = await install();
    const skill = await stubCensusSkill();
    await patchHarness(cwd, { pages: {} });
    const { code, out } = await runIn(cwd, "bash", ["matching/census.sh"], {
      MATCHING_SKILL_DIR: skill,
      STUB_CENSUS_MODE: "clean",
    });
    expect(out).toMatch(/the page table is empty — refusing to report CLEAN/);
    expect(code).toBe(2);
    expect(out).not.toMatch(/Phase 3 CLEAN/);
  });

  it("ships Markdown stubs that are already prettier-clean", async () => {
    const cwd = await install();
    const prettier = await import("prettier");
    // These three ARE handed to the site's prettier on install (they are site
    // records). They are still authored clean because a site with no usable
    // prettier gets the flagged degraded path and writes them unformatted, and
    // because they stay inside that site's own `prettier --check .` forever
    // after — an unformatted stub turns the first `pnpm verify` red either way.
    for (const rel of [
      "matching/spec-sections/_chrome.md",
      "matching/spec-sections/_header.md",
      "matching/LEDGER.md",
    ]) {
      expect(
        await prettier.check(await readFile(join(cwd, rel), "utf-8"), { parser: "markdown" }),
        `${rel} is not prettier-clean`,
      ).toBe(true);
    }
  });

  // --- git must actually TAKE the install, not merely not-error on `git add -A`
  //     (blocker on #733: a site that already ignores a harness path got
  //     "applied" with nothing in the commit).

  /** A site whose committed .gitignore is exactly `body`. */
  async function siteIgnoring(body: string): Promise<string> {
    const cwd = await copyFixtureToTmp(pristine);
    await seed(cwd, ".gitignore", body);
    return cwd;
  }

  const headTree = (cwd: string): string[] =>
    execFileSync("git", ["ls-tree", "-r", "-z", "--name-only", "HEAD"], {
      cwd,
      encoding: "utf-8",
    })
      .split("\0")
      .filter(Boolean);

  const gitOut = (cwd: string, args: string[]): string =>
    execFileSync("git", args, { cwd, encoding: "utf-8" }).trim();

  it("every installed path is in HEAD's tree after a clean install (the guard GRANTS)", async () => {
    const cwd = await install();
    const tree = headTree(cwd);
    // Positive half. Without this, a typo in the manifest would make the guard
    // refuse EVERY install and the refusal tests below would still be green.
    for (const rel of MATCH_HARNESS_INSTALLED_PATHS) expect(tree).toContain(rel);
    expect(MATCH_HARNESS_INSTALLED_PATHS).toHaveLength(MATCH_HARNESS_FILES.length + 3);
  });

  it("refuses when the site already ignores matching/, and names the rule", async () => {
    const cwd = await siteIgnoring("node_modules/\nmatching/\n");
    const result = await matchHarness(
      { path: cwd },
      { ref: "https://ref.test" },
      { spawn: noopSpawn },
    );
    expect(result.status).toBe("failed");
    expect(result.notes).toContain("matching/gate.sh");
    expect(result.notes).toContain("matching/harness.json");
    expect(result.notes).toContain(".gitignore:2:matching/");
    // ...and the refusal is TRUE: HEAD really does not carry them.
    expect(headTree(cwd)).not.toContain("matching/gate.sh");
    // The operator is left exactly where they started.
    expect(gitOut(cwd, ["rev-parse", "--abbrev-ref", "HEAD"])).toBe("main");
    expect(gitOut(cwd, ["status", "--porcelain"])).toBe("");
    expect(await exists(cwd, "matching")).toBe(false);
  });

  it("refuses for a shadowed src/ path too — the class is any pattern, not matching/", async () => {
    const cwd = await siteIgnoring("node_modules/\nsrc/lib/site-pages.js\n");
    const result = await matchHarness(
      { path: cwd },
      { ref: "https://ref.test" },
      { spawn: noopSpawn },
    );
    expect(result.status).toBe("failed");
    expect(result.notes).toContain("src/lib/site-pages.js");
    expect(result.notes).toContain(".gitignore:2:src/lib/site-pages.js");
    expect(result.notes).not.toContain("matching/gate.sh");
  });

  it("refuses when the files are ALREADY on disk and ignored — nothing is written this run", async () => {
    // The state an operator reaches by hand-copying a harness from another site
    // (which is how this one arrived at beachfront-dentistry). Every matching/
    // path is byte-correct on disk, so planFileWrite returns "skip" and the run
    // WRITES none of them. A check over this run's writes finds nothing missing
    // and reports "applied" over a commit that contains none of them.
    const donor = await install();
    const cwd = await siteIgnoring("node_modules/\nmatching/\n");
    const seeded = MATCH_HARNESS_FILES.filter((f) => f.rel.startsWith("matching/"));
    for (const f of seeded) {
      await mkdir(dirname(join(cwd, f.rel)), { recursive: true });
      await writeFile(join(cwd, f.rel), await read(donor, f.rel), "utf-8");
    }
    // Ignored, so the tree is still clean and the recipe will run.
    expect(gitOut(cwd, ["status", "--porcelain"])).toBe("");

    const result = await matchHarness(
      { path: cwd },
      { ref: "https://ref.test" },
      { spawn: noopSpawn },
    );
    expect(result.status).toBe("failed");
    expect(result.notes).toContain("matching/gate.sh");
    expect(result.notes).toContain("matching/harness.json");
    // The recipe did not write them, so it must not delete them either.
    expect(await exists(cwd, "matching/gate.sh")).toBe(true);
  });

  it("still refuses on a re-run — the check is the manifest, not this run's writes", async () => {
    const cwd = await siteIgnoring("node_modules/\nmatching/\n");
    const first = await matchHarness(
      { path: cwd },
      { ref: "https://ref.test" },
      { spawn: noopSpawn },
    );
    expect(first.status).toBe("failed");
    // Second run over the same unfixed site. A check over the paths WRITTEN
    // this run would pass here and report "applied" over the same half-install.
    const second = await matchHarness(
      { path: cwd },
      { ref: "https://ref.test" },
      { spawn: noopSpawn },
    );
    expect(second.status).toBe("failed");
    expect(second.notes).toContain("matching/gate.sh");
  });

  it("installs for real once the ignore rule is gone", async () => {
    const cwd = await siteIgnoring("node_modules/\nmatching/\n");
    expect(
      (await matchHarness({ path: cwd }, { ref: "https://ref.test" }, { spawn: noopSpawn })).status,
    ).toBe("failed");
    await seed(cwd, ".gitignore", "node_modules/\n");
    const again = await matchHarness(
      { path: cwd },
      { ref: "https://ref.test" },
      { spawn: noopSpawn },
    );
    expect(again.status).toBe("applied");
    const tree = headTree(cwd);
    for (const rel of MATCH_HARNESS_INSTALLED_PATHS) expect(tree).toContain(rel);
  });

  it("a refused run leaves the checkout byte-identical to how it found it", async () => {
    const cwd = await siteIgnoring("node_modules/\n*.md\n");
    const snap = () =>
      execFileSync(
        "bash",
        ["-c", `find . -path ./.git -prune -o -type f -print | LC_ALL=C sort | xargs shasum`],
        { cwd, encoding: "utf-8" },
      );
    const start = snap();
    const result = await matchHarness(
      { path: cwd },
      { ref: "https://ref.test" },
      { spawn: noopSpawn },
    );
    // *.md shadows CLAUDE.md and matching/spec-sections/*.md — the block's
    // `!matching/*.md` does not reach a nested path, and nothing re-includes
    // CLAUDE.md at all.
    expect(result.status).toBe("failed");
    expect(result.notes).toContain("CLAUDE.md");
    expect(result.notes).toContain("matching/spec-sections/_chrome.md");
    expect(snap()).toBe(start);
    expect(gitOut(cwd, ["status", "--porcelain"])).toBe("");
  });

  it("a site-wide *.sh / *.mjs ignore is NOT the defect — the block re-includes them", async () => {
    // Verified against git: the recipe appends `!matching/*.sh` / `!matching/*.mjs`
    // AFTER the site's rule and the parent directory is not excluded, so these
    // install for real. A pre-WRITE ignore check would refuse both.
    for (const rule of ["*.sh", "*.mjs"]) {
      const cwd = await siteIgnoring(`node_modules/\n${rule}\n`);
      const result = await matchHarness(
        { path: cwd },
        { ref: "https://ref.test" },
        { spawn: noopSpawn },
      );
      expect([rule, result.status]).toEqual([rule, "applied"]);
      const tree = headTree(cwd);
      for (const rel of MATCH_HARNESS_INSTALLED_PATHS)
        expect([rule, rel, tree.includes(rel)]).toEqual([rule, rel, true]);
    }
  });
});

// ---------------------------------------------------------------------------
// THE GUARDS THE HARNESS IS FOR, EXECUTED.
//
// Everything above proves the recipe wrote bytes and that three scripts refuse.
// A refusal-only suite cannot tell a working guard from a guard that refuses
// everything, and it never touches the two guards with the largest blast radius:
// the /dev/match route's production 404 and checkRef's "a 200 is not evidence".
// Each case below runs the installed artefact and pins ONE arm — with every
// other arm arranged to pass, so a green is that arm and nothing else.
// ---------------------------------------------------------------------------

/** Run `fn` against a throwaway origin. Returns whatever `fn` returns. */
async function withServer<T>(
  handler: (req: unknown, res: ServerResponse) => void,
  fn: (origin: string) => Promise<T>,
): Promise<T> {
  const server = createServer(handler as never);
  try {
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    const { port } = server.address() as AddressInfo;
    return await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((done) => server.close(() => done()));
  }
}

const html = (
  res: ServerResponse,
  status: number,
  body: string,
  headers: Record<string, string> = {},
) => {
  res.writeHead(status, { "content-type": "text/html", ...headers });
  res.end(body);
};

/**
 * Execute the INSTALLED `/dev/match/[uid]` route's `load` with a chosen `dev`.
 *
 * The route file is NOT rewritten — Node strips its two type annotations
 * natively, and what runs is the byte-for-byte template the recipe wrote. Only
 * its three bare specifiers are supplied, as tiny packages under the site's own
 * node_modules: `$app/environment` (the switch under test), `@sveltejs/kit` (an
 * `error` that throws what SvelteKit's throws), and `$lib/site-pages.js` (a
 * re-export of the site's real file).
 */
type LoadOutcome = {
  ok: boolean;
  data?: { uid: string; slices: Array<Record<string, unknown>> };
  status?: number;
  body?: { message?: string };
  message?: string;
};

async function loadDevMatch(
  cwd: string,
  opts: { dev: boolean; uid: string; sitePages?: string },
): Promise<LoadOutcome> {
  const nm = join(cwd, "node_modules");
  const put = async (rel: string, body: string): Promise<void> => {
    await mkdir(dirname(join(nm, rel)), { recursive: true });
    await writeFile(join(nm, rel), body, "utf-8");
  };
  await put(
    "$app/package.json",
    JSON.stringify({
      name: "$app",
      type: "module",
      exports: { "./environment": "./environment.js" },
    }),
  );
  await put("$app/environment.js", 'export const dev = process.env.MATCH_PROBE_DEV === "1";\n');
  await put(
    "$lib/package.json",
    JSON.stringify({
      name: "$lib",
      type: "module",
      exports: { "./site-pages.js": "./site-pages.js" },
    }),
  );
  await put("$lib/site-pages.js", 'export * from "../../src/lib/site-pages.js";\n');
  await put(
    "@sveltejs/kit/package.json",
    JSON.stringify({ name: "@sveltejs/kit", type: "module", exports: { ".": "./index.js" } }),
  );
  await put(
    "@sveltejs/kit/index.js",
    `export function error(status, body) {
  const e = new Error(typeof body === "string" ? body : (body?.message ?? String(status)));
  e.status = status;
  e.body = body;
  e.name = "HttpError";
  throw e;
}
`,
  );
  if (opts.sitePages !== undefined)
    await writeFile(join(cwd, "src/lib/site-pages.js"), opts.sitePages, "utf-8");
  await writeFile(
    join(cwd, "probe-load.mjs"),
    `const mod = await import("./src/routes/dev/match/[uid]/+page.server.ts");
try {
  console.log(JSON.stringify({ ok: true, data: await mod.load({ params: { uid: process.argv[2] } }) }));
} catch (e) {
  console.log(JSON.stringify({ ok: false, status: e.status, body: e.body, message: e.message }));
}
`,
    "utf-8",
  );
  const { code, out } = await runIn(cwd, "node", ["probe-load.mjs", opts.uid], {
    MATCH_PROBE_DEV: opts.dev ? "1" : "0",
  });
  expect(code, `the route probe did not run: ${out}`).toBe(0);
  return JSON.parse(out) as LoadOutcome;
}

/** One page assembly, so `dev === true` has something real to return. */
const ONE_PAGE = `export const lang = "en-us";
export function documents(img) {
  return [
    {
      type: "page",
      uid: "home",
      title: "Home",
      data: {
        slices: [
          {
            slice_type: "hero",
            variation: "default",
            primary: { image: img("https://example.test/hero.jpg") },
          },
        ],
      },
    },
  ];
}
`;

/** A fixture rigged to blow up the instant it is read, so "the guard ran FIRST"
 *  becomes measurable rather than merely asserted in a test name. */
const EXPLODING_PAGES = `export const lang = "en-us";
export function documents() {
  throw new Error("FIXTURE READ — the guard did not run first");
}
`;

describe("the installed /dev/match route's production guard", () => {
  it("404s with the guard's OWN message when dev is false, before any fixture is read", async () => {
    const cwd = await install();
    const out = await loadDevMatch(cwd, { dev: false, uid: "home", sitePages: ONE_PAGE });

    expect(out.ok).toBe(false);
    expect(out.status).toBe(404);
    expect(out.body?.message).toBe("Not found");
    // THE POINT. The site-pages fixture above HAS a "home" assembly, so a route
    // that reached line 2 would have returned it. And the route's own
    // not-found — "no assembly for" — is a different 404 that the launch
    // recipe's dev-guard step explicitly refuses to accept as evidence of this
    // guard (see tests/recipes/launch.test.ts). Matching only "404" would pass
    // on either.
    expect(out.body?.message).not.toMatch(/no assembly for/);
  });

  it("reads no fixture at all when dev is false — the guard is the FIRST statement", async () => {
    const cwd = await install();
    const out = await loadDevMatch(cwd, { dev: false, uid: "home", sitePages: EXPLODING_PAGES });

    // The case above names an ORDER and cannot see one: moving the guard below
    // `const docs = documents(devImg)` leaves it green, because the message is
    // the same either way. Here the fixture throws the moment it is read, so a
    // guard that ran second surfaces the fixture's error instead of the 404 —
    // which is what the template's own "FIRST statement" comment claims.
    expect(out.status).toBe(404);
    expect(out.body?.message).toBe("Not found");
    expect(out.message ?? "").not.toMatch(/FIXTURE READ/);
  });

  it("serves the site's assembly when dev is true — the guard is a switch, not a wall", async () => {
    const cwd = await install();
    const out = await loadDevMatch(cwd, { dev: true, uid: "home", sitePages: ONE_PAGE });

    expect(out.ok, `expected a render, got ${JSON.stringify(out)}`).toBe(true);
    expect(out.data?.uid).toBe("home");
    expect(out.data?.slices).toHaveLength(1);
    // The route's own image resolver reached the document builder: `devImg`
    // hands slices a `{url, dimensions}` rather than the seed's asset id.
    const image = (out.data?.slices[0] as { primary: { image: Record<string, unknown> } }).primary
      .image;
    expect(image.url).toBe("https://example.test/hero.jpg");
    expect(image.dimensions).toEqual({ width: 1600, height: 1067 });
  });

  it("404s in dev for a uid the site has no assembly for, and names the ones it has", async () => {
    const cwd = await install();
    const out = await loadDevMatch(cwd, { dev: true, uid: "nope", sitePages: ONE_PAGE });
    expect(out.status).toBe(404);
    expect(out.body?.message).toBe('no assembly for "nope" (have: home)');
  });
});

describe("the installed harness's checkRef preflight", () => {
  // One install, re-seeded per case from the harness.json the recipe wrote, so
  // no case inherits another's config.
  let cwd = "";
  let seedCfg: Record<string, unknown> = {};

  beforeAll(async () => {
    cwd = await install();
    seedCfg = JSON.parse(await read(cwd, "matching/harness.json")) as Record<string, unknown>;
  });

  /** Re-seed harness.json and ask the preflight the gate asks. */
  async function checkRef(
    patch: Record<string, unknown>,
  ): Promise<{ code: number | string; out: string }> {
    await writeFile(
      join(cwd, "matching/harness.json"),
      JSON.stringify({ ...seedCfg, ...patch }, null, 2) + "\n",
      "utf-8",
    );
    return runIn(cwd, "node", ["matching/harness.mjs", "--check-ref"]);
  }

  it("GRANTS a reference that serves refMark, 200, no redirect and no candMark", async () => {
    const { code, out } = await withServer(
      (_req, res) => html(res, 200, "<html>build-9f2a1c</html>"),
      (origin) => checkRef({ ref: origin, refMark: "build-9f2a1c" }),
    );
    expect(out).toMatch(/^REF OK/m);
    expect(out).toMatch(/refMark present, candMark absent/);
    expect(code).toBe(0);
  });

  it("refuses a REF host listed in selfHosts", async () => {
    // No server: this arm fires before the fetch, and everything else is valid.
    const { code, out } = await checkRef({
      ref: "http://127.0.0.1:9",
      refMark: "build-9f2a1c",
      selfHosts: ["127.0.0.1:9"],
    });
    expect(out).toMatch(/REF REFUSED — REF host 127\.0\.0\.1:9 is in selfHosts/);
    expect(code).toBe(2);
  });

  it("refuses a REF whose host equals the candidate's", async () => {
    const { code, out } = await checkRef({
      ref: "http://127.0.0.1:9",
      cand: "http://127.0.0.1:9",
      refMark: "build-9f2a1c",
    });
    expect(out).toMatch(/REF REFUSED — REF host 127\.0\.0\.1:9 equals CAND's host/);
    expect(code).toBe(2);
  });

  it("refuses a reference that does not answer at all", async () => {
    const { code, out } = await checkRef({ ref: "http://127.0.0.1:1", refMark: "build-9f2a1c" });
    expect(out).toMatch(/REF REFUSED — GET http:\/\/127\.0\.0\.1:1\/ failed:/);
    expect(code).toBe(2);
  });

  it("refuses a non-200 EVEN WHEN the body carries refMark", async () => {
    const { code, out } = await withServer(
      (_req, res) => html(res, 503, "<html>build-9f2a1c</html>"),
      (origin) => checkRef({ ref: origin, refMark: "build-9f2a1c" }),
    );
    expect(out).toMatch(/REF REFUSED — GET .*→ HTTP 503, expected 200/);
    expect(code).toBe(2);
  });

  it("refuses a 404 carrying refMark — the arm is not pinned by 503 alone", async () => {
    // One value cannot tell `status !== 200` from `status >= 500`, and the
    // narrowing is the likelier drift: a reference page that has MOVED answers
    // 404, and a themed 404 served from the same build carries refMark, so the
    // preflight whose whole thesis is "a 200 is not evidence" would GRANT it.
    const { code, out } = await withServer(
      (_req, res) => html(res, 404, "<html>build-9f2a1c</html>"),
      (origin) => checkRef({ ref: origin, refMark: "build-9f2a1c" }),
    );
    expect(out).toMatch(/REF REFUSED — GET .*→ HTTP 404, expected 200/);
    expect(code).toBe(2);
  });

  it("refuses a 200 that carries a Location header — an answer that is really a redirect", async () => {
    // Deliberately 200-with-Location, not 302: `redirect: "manual"` leaves a real
    // 3xx as its own status, so the status arm above claims it first and this
    // arm is only ever reached by a 200 that redirects anyway.
    const { code, out } = await withServer(
      (_req, res) => html(res, 200, "<html>build-9f2a1c</html>", { location: "/elsewhere" }),
      (origin) => checkRef({ ref: origin, refMark: "build-9f2a1c" }),
    );
    expect(out).toMatch(/REF REFUSED — GET .*→ 200 redirect to \/elsewhere/);
    expect(code).toBe(2);
  });

  it("refuses a 200 whose body does NOT carry refMark — a 200 is not evidence", async () => {
    const { code, out } = await withServer(
      (_req, res) => html(res, 200, "<html>some other site</html>"),
      (origin) => checkRef({ ref: origin, refMark: "build-9f2a1c" }),
    );
    expect(out).toMatch(
      /served 200 but WITHOUT refMark "build-9f2a1c" — that is not the reference/,
    );
    expect(code).toBe(2);
  });

  it("refuses a reference that carries candMark — the host has cut over to OUR build", async () => {
    // refMark present too: without it this would refuse one arm earlier and the
    // case would pass while proving nothing about candMark.
    const { code, out } = await withServer(
      (_req, res) => html(res, 200, "<html>build-9f2a1c /_app/immutable/x.js</html>"),
      (origin) => checkRef({ ref: origin, refMark: "build-9f2a1c" }),
    );
    expect(out).toMatch(/contains candMark "_app\/immutable" — REF is serving OUR build/);
    expect(code).toBe(2);
  });
});

describe("the installed harness reports, not just refuses", () => {
  /** A page-diff report next.mjs will actually count: current schema, the
   *  harness's own threshold, no mask and not truncated. */
  async function writeReport(
    cwd: string,
    dir: string,
    regions: Array<{ viewport: number; label: string; mismatchFraction: number; pass: boolean }>,
  ): Promise<void> {
    await mkdir(join(cwd, "matching", dir), { recursive: true });
    await writeFile(
      join(cwd, "matching", dir, "report.json"),
      JSON.stringify({
        meta: {
          schemaVersion: 1,
          threshold: 0.1,
          maxHeightDelta: 0.05,
          mask: [],
          neutralizeMedia: false,
          maskPhotos: false,
          truncated: false,
        },
        overallPass: regions.every((r) => r.pass),
        regions: regions.map((r) => ({ ...r, heightDeltaFraction: 0 })),
      }),
      "utf-8",
    );
  }

  const CORPUS = [
    { viewport: 1440, label: "top", mismatchFraction: 0.5, pass: false },
    { viewport: 834, label: "top", mismatchFraction: 0.01, pass: true },
    { viewport: 390, label: "top", mismatchFraction: 0.02, pass: true },
  ];

  it("next.mjs SCORES a real corpus and names the worst region", async () => {
    const cwd = await install();
    await writeReport(cwd, "out-smoke-home", CORPUS);

    const { code, out } = await runIn(cwd, "node", ["matching/next.mjs"]);
    // 3 = (0 anchors + 1) × 3 viewports, derived by harness.mjs from the seed.
    expect(out).toMatch(/SCORE 2\/3 regions passing/);
    expect(out).toMatch(/1 open failure\(s\) \+ 0 declared floor\(s\)/);
    expect(out).toMatch(/NEXT: home — worst page/);
    expect(out).toMatch(/@1440\s+top\s+pixels 50\.0%/);
    expect(code).toBe(1); // work remains: rule 5's loop keeps going
    expect(out).not.toMatch(/no parseable gate run/);
  });

  it("next.mjs exits 0 with no agenda once every region passes", async () => {
    const cwd = await install();
    await writeReport(
      cwd,
      "out-smoke-home",
      CORPUS.map((r) => ({ ...r, mismatchFraction: 0.01, pass: true })),
    );

    const { code, out } = await runIn(cwd, "node", ["matching/next.mjs"]);
    expect(out).toMatch(/SCORE 3\/3 regions passing/);
    expect(out).toMatch(/No open geometry failures/);
    expect(code).toBe(0);
  });

  it("the PAUSED switch silences the agenda a scoring corpus would otherwise produce", async () => {
    const cwd = await install();
    await writeReport(cwd, "out-smoke-home", CORPUS);
    // Same corpus as the scoring case above, which exits 1 with a named region.
    await writeFile(join(cwd, "matching/PAUSED"), "waiting on the operator\n", "utf-8");

    const { code, out } = await runIn(cwd, "node", ["matching/next.mjs"]);
    expect(out).toMatch(/MATCHING PAUSED — no agenda, and none is to be inferred/);
    expect(out).toContain("waiting on the operator");
    expect(out).not.toMatch(/SCORE/);
    expect(out).not.toMatch(/NEXT:/);
    expect(code).toBe(0);
  });

  it("gate.sh RUNS the page once the reference verifies and SPEC.md has its section", async () => {
    const cwd = await install();
    const skill = await stubSkill();
    await writeFile(
      join(cwd, "matching/SPEC.md"),
      "# Reference spec\n\n## home\n\nOne section, so Phase 1 is done for this page.\n",
      "utf-8",
    );

    const { code, out } = await withServer(
      (_req, res) => html(res, 200, "REFMARK-OK"),
      async (origin) => {
        await patchHarness(cwd, { ref: origin, refMark: "REFMARK-OK" });
        return runIn(cwd, "bash", ["matching/gate.sh", "smoke", "home"], {
          MATCHING_SKILL_DIR: skill,
        });
      },
    );

    expect(out).toMatch(/REF OK/);
    expect(out).toMatch(/########## home ##########/);
    expect(out).toMatch(/home exit=0/);
    expect(out).toMatch(/ALL DONE \(smoke\)/);
    expect(code).toBe(0);
    expect(out).not.toMatch(/REFUSED/);
    expect(out).not.toMatch(/GATE INCOMPLETE/);
  });
});

describe("what the recipe COMMITS", () => {
  /** Paths git actually tracks under the site, from git itself. */
  const tracked = (cwd: string): string[] =>
    execFileSync("git", ["ls-files"], { cwd, encoding: "utf-8" }).trim().split("\n");

  /**
   * The shipped manifest, written out by hand.
   *
   * MATCH_HARNESS_FILES is generated, and every other case in this file loops it
   * to decide what to check — so deleting a row deletes its own check and the
   * suite stays green with a file no longer installed. This list is the
   * independent side of that comparison: it has to be edited deliberately.
   */
  const MANIFEST: ReadonlyArray<[string, "recipe" | "site"]> = [
    ["matching/harness.mjs", "recipe"],
    ["matching/gate.sh", "recipe"],
    ["matching/census.sh", "recipe"],
    ["matching/next.mjs", "recipe"],
    ["matching/strikes.mjs", "recipe"],
    ["matching/build-spec.mjs", "recipe"],
    ["matching/census-count.mjs", "recipe"],
    ["matching/harness.json", "site"],
    ["matching/floors.mjs", "site"],
    ["matching/census-deviations.mjs", "site"],
    ["matching/spec-sections/_chrome.md", "site"],
    ["matching/spec-sections/_header.md", "site"],
    ["matching/LEDGER.md", "site"],
    ["src/routes/dev/match/[uid]/+page.server.ts", "recipe"],
    ["src/routes/dev/match/[uid]/+page.svelte", "recipe"],
    ["src/lib/site-pages.js", "site"],
    ["src/lib/site-pages.test.ts", "recipe"],
  ];

  it("installs exactly the manifest, with the ownership each row was given", () => {
    expect(MATCH_HARNESS_FILES.map((f) => [f.rel, f.owner])).toEqual(
      MANIFEST.map(([rel, owner]) => [rel, owner]),
    );
  });

  it("GIT TRACKS every installed file — the .gitignore block whitelists them back", async () => {
    const cwd = await install();
    const files = tracked(cwd);

    // The whole point of the negations: `matching/*` ignores the directory, and
    // every line after it puts the harness back. Every assertion elsewhere in
    // this file reads the filesystem, where an ignored file looks identical to a
    // committed one — and 13 of these 17 live under `matching/`.
    for (const [rel] of MANIFEST) {
      expect(files, `${rel} was written but not committed`).toContain(rel);
    }
    expect(files).toContain(".gitignore");
    expect(files).toContain(".prettierignore");
    expect(files).toContain("CLAUDE.md");
  });

  it("still ignores the workspace the harness generates around those files", async () => {
    const cwd = await install();
    // This list exercises ONE layer, not two. `matching/*` catches every path
    // below, including a round's OUTPUT DIRECTORY (a per-extension rule matches
    // one level and never reaches inside it) and a stray file with no listed
    // extension — so deleting the `matching/*.log|json|png` lines leaves this
    // green, measured. They are defence in depth for a future relaxation of the
    // line above, and no honest test can redden their removal while it stands;
    // #738 records that rather than papering over it with a vacuous assertion.
    const ignored = [
      "matching/out-smoke-home/report.json",
      "matching/out-smoke-home/ref-1440.png",
      "matching/scratch.txt",
      "matching/out-smoke-home.log",
      "matching/probe.json",
      "matching/x.png",
    ];
    for (const rel of ignored) {
      await mkdir(dirname(join(cwd, rel)), { recursive: true });
      await writeFile(join(cwd, rel), "x", "utf-8");
    }
    execFileSync("git", ["add", "-A"], { cwd, stdio: "ignore" });
    const files = tracked(cwd);
    for (const rel of ignored) {
      expect(files, `${rel} should have stayed ignored`).not.toContain(rel);
    }
    // …and the one JSON that is not workspace debris is still in.
    expect(files).toContain("matching/harness.json");
  });
});
