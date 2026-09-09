// The CLI face of the `match-harness` recipe.
//
// Until this file existed, `matchHarness` was never once reached through the
// command: the only CLI test that named it mocked `resolveSites` to return an
// empty inventory, so the command ran its argument handling over zero sites and
// exited 0. Everything below goes through the built `dist/cli/bin.js`, so what
// is exercised is cac's parsing (which type-coerces a numeric option value), the
// option plumbing, the recipe, and the exit code — the four things that layer
// exists to get right.
//
// NOTE, so nobody reads the coverage table as a verdict on this file: a
// subprocess is not counted by in-process v8 coverage, so
// src/cli/commands/match-harness.ts stays at its 60% / 27.5% here and the number
// says nothing about whether these cases run. What they are worth is measured by
// mutation instead — each case below has one named source change that reddens it
// and nothing else. (vitest.config.ts says the same thing about the CLI layer as
// a whole; tests/cli/sync-configs-command.test.ts is the same shape.)
import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { copyFixtureToTmp } from "../recipes/_helpers/site-tmpdir.js";

const here = dirname(fileURLToPath(import.meta.url));
const binPath = resolve(here, "../../dist/cli/bin.js");
const pristine = resolve(here, "../fixtures/pristine-starter");

/** Run the CLI in `cwd`. Resolves either way — the exit CODE is under test. */
function cli(cwd: string, ...args: string[]): { out: string; code: number } {
  try {
    const out = execFileSync(process.execPath, [binPath, ...args], {
      encoding: "utf-8",
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { out, code: 0 };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { out: `${err.stdout ?? ""}${err.stderr ?? ""}`, code: err.status ?? -1 };
  }
}

const git = (cwd: string, ...args: string[]): string =>
  execFileSync("git", args, { cwd, encoding: "utf-8" }).trim();

const harnessJson = async (cwd: string): Promise<Record<string, unknown>> =>
  JSON.parse(await readFile(join(cwd, "matching/harness.json"), "utf-8")) as Record<
    string,
    unknown
  >;

describe("cli: match-harness", () => {
  beforeAll(() => {
    if (!existsSync(binPath)) throw new Error("run `pnpm build` first");
  });

  it("reaches the recipe: --ref installs the harness and commits once", async () => {
    const cwd = await copyFixtureToTmp(pristine);
    const { out, code } = cli(cwd, "match-harness", "--ref", "https://ref.test/");

    expect(code).toBe(0);
    expect(out).toMatch(/applied: 1 commit\(s\)/);
    expect((await harnessJson(cwd)).ref).toBe("https://ref.test");
    expect(existsSync(join(cwd, "src/routes/dev/match/[uid]/+page.server.ts"))).toBe(true);
    expect(git(cwd, "log", "--oneline", "-1")).toMatch(/install the matching harness/);
  });

  it("forwards --cand and --matrix into the site's harness.json", async () => {
    const cwd = await copyFixtureToTmp(pristine);
    const { code } = cli(
      cwd,
      "match-harness",
      "--ref",
      "https://ref.test",
      "--cand",
      "http://localhost:4173",
      "--matrix",
      "1280,768",
    );
    expect(code).toBe(0);
    const cfg = await harnessJson(cwd);
    expect(cfg.cand).toBe("http://localhost:4173");
    expect(cfg.matrix).toEqual([1280, 768]);
  });

  it("accepts a single --matrix viewport, which cac hands over as a NUMBER", async () => {
    // `--matrix 1440` does not arrive as "1440": cac coerces a numeric option
    // value, so the command normalises with String() before splitting. Calling
    // .split on what cac passed would throw here.
    const cwd = await copyFixtureToTmp(pristine);
    const { code, out } = cli(
      cwd,
      "match-harness",
      "--ref",
      "https://ref.test",
      "--matrix",
      "1440",
    );
    expect(out).not.toMatch(/split is not a function/);
    expect(code).toBe(0);
    expect((await harnessJson(cwd)).matrix).toEqual([1440]);
  });

  it("refuses --matrix 0 — the value a truthiness test drops", async () => {
    // THE case the source comment is about. cac hands over the NUMBER 0, which
    // is falsy: `opts.matrix ? … : undefined` silently substitutes the default
    // [1440,834,390] and exits 0, so an operator who asked for one thing gets
    // another and is told it worked.
    const cwd = await copyFixtureToTmp(pristine);
    const { out, code } = cli(cwd, "match-harness", "--ref", "https://ref.test", "--matrix", "0");

    expect(out).toContain('match-harness: --matrix "0" is not a list of viewports');
    expect(code).toBe(1);
    // and it refused BEFORE touching the site
    expect(existsSync(join(cwd, "matching"))).toBe(false);
    expect(git(cwd, "rev-parse", "--abbrev-ref", "HEAD")).toBe("main");
    expect(git(cwd, "status", "--porcelain")).toBe("");
  });

  it("refuses a --matrix that is not numeric at all", async () => {
    const cwd = await copyFixtureToTmp(pristine);
    const { out, code } = cli(cwd, "match-harness", "--ref", "https://ref.test", "--matrix", "abc");
    expect(out).toContain('match-harness: --matrix "abc" is not a list of viewports');
    expect(code).toBe(1);
    expect(existsSync(join(cwd, "matching"))).toBe(false);
  });

  it("exits 1 — and installs nothing — when the recipe refuses for want of --ref", async () => {
    const cwd = await copyFixtureToTmp(pristine);
    const { out, code } = cli(cwd, "match-harness");

    expect(out).toMatch(/failed: --ref <url> is required/);
    expect(code).toBe(1);
    expect(existsSync(join(cwd, "matching"))).toBe(false);
    expect(existsSync(join(cwd, "src/routes/dev/match/[uid]/+page.server.ts"))).toBe(false);
    expect(git(cwd, "rev-parse", "--abbrev-ref", "HEAD")).toBe("main");
    expect(git(cwd, "status", "--porcelain")).toBe("");
  });
});
