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
