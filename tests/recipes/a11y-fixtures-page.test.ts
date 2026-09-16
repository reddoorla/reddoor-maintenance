import { describe, it, expect } from "vitest";
import { writeFile, mkdir, readFile, access } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve, dirname, join } from "node:path";
import { a11yFixturesPage } from "../../src/recipes/a11y-fixtures-page/index.js";
import {
  A11Y_FIXTURES_PAGE_RELATIVE,
  A11Y_FIXTURES_PAGE_TEMPLATE,
} from "../../src/recipes/a11y-fixtures-page/template.js";
import { copyFixtureToTmp } from "./_helpers/site-tmpdir.js";

const here = dirname(fileURLToPath(import.meta.url));
const pristine = resolve(here, "../fixtures/pristine-starter");

describe("recipes/a11y-fixtures-page", () => {
  it("writes the stub page on a clean site, commits, and surfaces a branch", async () => {
    const cwd = await copyFixtureToTmp(pristine);
    const result = await a11yFixturesPage({ path: cwd });

    expect(result.status).toBe("applied");
    expect(result.commits).toHaveLength(1);
    expect(result.notes).toMatch(/branch: maint\/a11y-fixtures-page-/);

    const written = await readFile(join(cwd, A11Y_FIXTURES_PAGE_RELATIVE), "utf-8");
    expect(written).toBe(A11Y_FIXTURES_PAGE_TEMPLATE);
  });

  it("noops when the route already exists (does not clobber operator edits)", async () => {
    const cwd = await copyFixtureToTmp(pristine);
    // Operator already wrote their own custom fixture page — recipe must
    // refuse to touch it. Otherwise re-running init on an established site
    // would silently overwrite hand-tuned content.
    const target = join(cwd, A11Y_FIXTURES_PAGE_RELATIVE);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, "<!-- custom site fixture, do not overwrite -->\n");
    execFileSync("git", ["add", "-A"], { cwd, stdio: "ignore" });
    execFileSync("git", ["commit", "-m", "add custom fixture"], { cwd, stdio: "ignore" });

    const result = await a11yFixturesPage({ path: cwd });
    expect(result.status).toBe("noop");
    expect(result.commits).toHaveLength(0);
    expect(result.notes).toMatch(/already exists/);

    const after = await readFile(target, "utf-8");
    expect(after).toBe("<!-- custom site fixture, do not overwrite -->\n");
  });

  it("creates the dev/ + a11y-fixtures/ parent dirs when they don't exist", async () => {
    const cwd = await copyFixtureToTmp(pristine);
    // Verify the recipe handles missing parent dirs — pristine-starter has
    // src/routes/ but no src/routes/dev/ subdir.
    await expect(access(join(cwd, "src/routes/dev"))).rejects.toThrow();
    await a11yFixturesPage({ path: cwd });
    await access(join(cwd, "src/routes/dev/a11y-fixtures/+page.svelte"));
  });
});

// --- git must actually TAKE the write, not merely not-error on `git add -A`
//     (#741, the defect class #734 closed for match-harness only).

describe("recipes/a11y-fixtures-page: the commit must carry the route", () => {
  /** A site whose committed .gitignore is exactly `body`. */
  async function siteIgnoring(body: string): Promise<string> {
    const cwd = await copyFixtureToTmp(pristine);
    await writeFile(join(cwd, ".gitignore"), body, "utf-8");
    execFileSync("git", ["add", "-A"], { cwd, stdio: "ignore" });
    execFileSync("git", ["commit", "-m", "seed .gitignore"], { cwd, stdio: "ignore" });
    return cwd;
  }

  const headTree = (cwd: string): string[] =>
    execFileSync("git", ["ls-tree", "-r", "-z", "--name-only", "HEAD"], { cwd, encoding: "utf-8" })
      .split("\0")
      .filter(Boolean);

  const gitOut = (cwd: string, args: string[]): string =>
    execFileSync("git", args, { cwd, encoding: "utf-8" }).trim();

  it("GRANTS a normal install — the route is in HEAD's tree and the result still applies", async () => {
    // The positive half. Without it, a typo in the guarded path would refuse
    // EVERY install and the refusal test below would stay green.
    const cwd = await copyFixtureToTmp(pristine);
    const result = await a11yFixturesPage({ path: cwd });
    expect(result.status).toBe("applied");
    expect(headTree(cwd)).toContain(A11Y_FIXTURES_PAGE_RELATIVE);
  });

  it("REFUSES when the site ignores the route's directory, and names the rule", async () => {
    const cwd = await siteIgnoring("node_modules\nsrc/routes/dev/\n");
    const result = await a11yFixturesPage({ path: cwd });

    expect(result.status).toBe("failed");
    expect(result.notes).toContain(A11Y_FIXTURES_PAGE_RELATIVE);
    expect(result.notes).toContain(".gitignore:2:src/routes/dev/");
    // The refusal is TRUE: HEAD really does not carry the route, so a fresh
    // clone, CI and the a11y audit get a route that does not exist.
    expect(headTree(cwd)).not.toContain(A11Y_FIXTURES_PAGE_RELATIVE);
    // Nothing is left on disk: the file this run wrote and git refused would
    // otherwise make every later run noop on "already exists" — a false done
    // that outlives the fix.
    await expect(access(join(cwd, A11Y_FIXTURES_PAGE_RELATIVE))).rejects.toThrow();
    expect(gitOut(cwd, ["rev-parse", "--abbrev-ref", "HEAD"])).toBe("main");
    expect(gitOut(cwd, ["status", "--porcelain"])).toBe("");
  });
});
