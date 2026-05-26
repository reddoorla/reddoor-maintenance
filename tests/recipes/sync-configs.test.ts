import { describe, it, expect } from "vitest";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve, dirname, join } from "node:path";
import { syncConfigs } from "../../src/recipes/sync-configs.js";
import { copyFixtureToTmp } from "./_helpers/site-tmpdir.js";

function gitListFiles(cwd: string): string[] {
  return execFileSync("git", ["ls-files"], { cwd, encoding: "utf-8" })
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

async function writeCommitted(cwd: string, relPath: string, contents: string): Promise<void> {
  const full = join(cwd, relPath);
  const dir = dirname(full);
  if (dir !== cwd) await mkdir(dir, { recursive: true });
  await writeFile(full, contents, "utf-8");
  execFileSync("git", ["add", "-A"], { cwd, stdio: "ignore" });
  execFileSync("git", ["commit", "-m", `add ${relPath}`], { cwd, stdio: "ignore" });
}

const here = dirname(fileURLToPath(import.meta.url));
const clean = resolve(here, "../fixtures/sync-clean");
const drift = resolve(here, "../fixtures/sync-drift");

describe("recipes/sync-configs", () => {
  it("returns noop when every template already matches", async () => {
    const cwd = await copyFixtureToTmp(clean);
    const result = await syncConfigs({ path: cwd });
    expect(result.status).toBe("noop");
    expect(result.commits).toHaveLength(0);
  });

  it("applies templates that differ and commits one per config", async () => {
    const cwd = await copyFixtureToTmp(drift);
    const result = await syncConfigs({ path: cwd });
    expect(result.status).toBe("applied");
    expect(result.commits.length).toBeGreaterThan(0);

    const eslintCfg = await readFile(join(cwd, "eslint.config.js"), "utf-8");
    expect(eslintCfg).toContain("@reddoorla/maintenance/configs/eslint");

    const branch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd,
      encoding: "utf-8",
    }).trim();
    expect(branch).toMatch(/^maint\/sync-configs-\d{8}T\d{9}Z$/);
  });

  it("running twice on drift leaves the second run as a noop", async () => {
    const cwd = await copyFixtureToTmp(drift);
    const first = await syncConfigs({ path: cwd });
    expect(first.status).toBe("applied");
    const second = await syncConfigs({ path: cwd });
    expect(second.status).toBe("noop");
    expect(second.commits).toHaveLength(0);
  });

  it("respects opts.which", async () => {
    const cwd = await copyFixtureToTmp(drift);
    const result = await syncConfigs({ path: cwd }, { which: ["prettier"] });
    expect(result.status).toBe("applied");
    expect(result.commits).toHaveLength(1);
    const eslintCfg = await readFile(join(cwd, "eslint.config.js"), "utf-8");
    expect(eslintCfg).not.toContain("@reddoorla/maintenance/configs/eslint");
  });

  it("refuses to run when the working tree is dirty", async () => {
    const cwd = await copyFixtureToTmp(drift);
    execFileSync("touch", ["dirty.txt"], { cwd });
    await expect(syncConfigs({ path: cwd })).rejects.toThrow(/working tree/i);
  });
});

describe("recipes/sync-configs gitignore handling", () => {
  it("creates .gitignore from canonical when none exists", async () => {
    const cwd = await copyFixtureToTmp(drift);
    expect(gitListFiles(cwd)).not.toContain(".gitignore");

    await syncConfigs({ path: cwd });

    const content = await readFile(join(cwd, ".gitignore"), "utf-8");
    expect(content).toContain("node_modules/");
    expect(content).toContain(".svelte-kit/");
    expect(content).toContain("build/");
    expect(content).toContain("# canonical entries from @reddoorla/maintenance");
  });

  it("merges missing canonical entries into existing .gitignore, preserving site lines", async () => {
    const cwd = await copyFixtureToTmp(drift);
    await writeCommitted(cwd, ".gitignore", "node_modules\n\n# site-specific\nmy-custom-dir/\n");

    await syncConfigs({ path: cwd });

    const content = await readFile(join(cwd, ".gitignore"), "utf-8");
    expect(content).toContain("my-custom-dir/");
    expect(content).toContain("# site-specific");
    expect(content).toContain(".svelte-kit/");
    expect(content).toContain("build/");
    // existing node_modules entry preserved (no trailing slash style) — not duplicated
    expect(content.match(/^node_modules$/gm)?.length).toBe(1);
    expect(content).not.toMatch(/^node_modules\/$/m);
  });

  it("untracks tracked build artifacts as part of the gitignore commit", async () => {
    const cwd = await copyFixtureToTmp(drift);
    await writeCommitted(cwd, "build/index.html", "<html></html>");
    await writeCommitted(cwd, ".svelte-kit/generated/whatever.ts", "// stale");
    expect(gitListFiles(cwd)).toContain("build/index.html");
    expect(gitListFiles(cwd)).toContain(".svelte-kit/generated/whatever.ts");

    const result = await syncConfigs({ path: cwd }, { which: ["gitignore"] });
    expect(result.status).toBe("applied");
    expect(result.commits).toHaveLength(1);

    const tracked = gitListFiles(cwd);
    expect(tracked).not.toContain("build/index.html");
    expect(tracked).not.toContain(".svelte-kit/generated/whatever.ts");
    expect(tracked).toContain(".gitignore");
  });

  it("opts.which=['gitignore'] touches only .gitignore", async () => {
    const cwd = await copyFixtureToTmp(drift);
    const result = await syncConfigs({ path: cwd }, { which: ["gitignore"] });

    expect(result.status).toBe("applied");
    expect(result.commits).toHaveLength(1);

    const eslintCfg = await readFile(join(cwd, "eslint.config.js"), "utf-8");
    expect(eslintCfg).not.toContain("@reddoorla/maintenance/configs/eslint");
  });

  it("re-running gitignore sync against its own output is a noop", async () => {
    const cwd = await copyFixtureToTmp(drift);
    const first = await syncConfigs({ path: cwd }, { which: ["gitignore"] });
    expect(first.status).toBe("applied");
    const second = await syncConfigs({ path: cwd }, { which: ["gitignore"] });
    expect(second.status).toBe("noop");
    expect(second.commits).toHaveLength(0);
  });
});
