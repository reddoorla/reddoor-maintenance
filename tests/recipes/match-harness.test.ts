import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve, dirname, join } from "node:path";
import { matchHarness } from "../../src/recipes/match-harness/index.js";
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

  it("formats only what the site owns — never the recipe-owned harness code", async () => {
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
    expect(paths.some((p) => p.startsWith("matching/"))).toBe(false);
    expect([...paths].sort()).toEqual(
      [
        "CLAUDE.md",
        "src/lib/site-pages.js",
        "src/lib/site-pages.test.ts",
        "src/routes/dev/match/[uid]/+page.server.ts",
        "src/routes/dev/match/[uid]/+page.svelte",
      ].sort(),
    );
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
});
