import { describe, it, expect } from "vitest";
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { chmod, mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
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
import type { SpawnFn } from "../../src/audits/util/spawn.js";
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
 *  tabs, single quotes, no trailing comma. Measured 2026-09-09 across the 21
 *  fleet clones with a prettier config: `erp-industrial` and
 *  `welcome-to-the-flower-court` ship exactly this shape, `beachfront-dentistry`
 *  and `1836dig` ship prettier's bare defaults (printWidth 80), and the other 17
 *  set printWidth 100 — which happens to match the templates and would hide this
 *  entirely. The site is left prettier-clean under its OWN config before the
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
 *  (`crash`), or one over two pages that rendered no text at all (`blank`).
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
const runs = mode === "blank" ? 0 : 12;
const mismatches = mode === "dirty" ? 1 : 0;
console.log("\n=== style census, viewport " + vw + " ===");
console.log(
  "ref runs: " + runs + "   cand runs: " + runs +
    "   mismatches: " + mismatches + "   ambiguous: 0",
);
if (mismatches) {
  console.log('\n  y=   100 "book an appointment"');
  console.log("    ref:  Inter | 400 | 16px | 24px | ls=normal | none | rgb(0, 0, 0)");
  console.log("    cand: Inter | 400 | 11px | 24px | ls=normal | none | rgb(0, 255, 255)");
}
process.exit(mismatches > 0 ? 1 : 0);
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

  it("hands the site's prettier only files the SITE owns — never one the recipe owns", async () => {
    const cwd = await copyFixtureToTmp(pristine);
    const calls: { cmd: string; args: readonly string[] }[] = [];
    const recordingSpawn: SpawnFn = async (cmd, args) => {
      calls.push({ cmd, args });
      return { code: 0, stdout: "", stderr: "" };
    };
    await matchHarness({ path: cwd }, { ref: "https://ref.test" }, { spawn: recordingSpawn });

    expect(calls).toHaveLength(1);
    const paths = calls[0]!.args.filter(
      (a) => !a.startsWith("-") && a !== "exec" && a !== "prettier",
    );

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
      { spawn: realPrettierSpawn },
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
      { spawn: realPrettierSpawn },
    );
    expect(second.status).toBe("noop");
    expect(second.notes ?? "").not.toContain("differs from the shipped template");
  });

  it("puts every recipe-owned file in the site's .prettierignore, brackets escaped", async () => {
    const cwd = await foreignPrettierSite();
    await matchHarness({ path: cwd }, { ref: "https://ref.test" }, { spawn: realPrettierSpawn });
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
    const failingSpawn: SpawnFn = async () => ({ code: 1, stdout: "", stderr: "boom" });
    const result = await matchHarness(
      { path: cwd },
      { ref: "https://ref.test" },
      { spawn: failingSpawn },
    );
    expect(result.status).toBe("applied");
    expect(result.commits).toHaveLength(1);
    expect(result.notes).toContain(PRETTIER_FLAG_NOTE);
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
