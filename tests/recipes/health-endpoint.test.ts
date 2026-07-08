import { describe, it, expect } from "vitest";
import { writeFile, mkdir, readFile, access } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve, dirname, join } from "node:path";
import { healthEndpoint } from "../../src/recipes/health-endpoint/index.js";
import {
  HEALTH_ENDPOINT_RELATIVE,
  HEALTH_ENDPOINT_TEMPLATE,
} from "../../src/recipes/health-endpoint/template.js";
import { copyFixtureToTmp } from "./_helpers/site-tmpdir.js";

const here = dirname(fileURLToPath(import.meta.url));
const pristine = resolve(here, "../fixtures/pristine-starter");

describe("recipes/health-endpoint", () => {
  it("writes the resilient /health endpoint on a clean site, commits, surfaces a branch", async () => {
    const cwd = await copyFixtureToTmp(pristine);
    const result = await healthEndpoint({ path: cwd });

    expect(result.status).toBe("applied");
    expect(result.commits).toHaveLength(1);
    expect(result.notes).toMatch(/branch: maint\/health-endpoint-/);

    const written = await readFile(join(cwd, HEALTH_ENDPOINT_RELATIVE), "utf-8");
    expect(written).toBe(HEALTH_ENDPOINT_TEMPLATE);
  });

  it("ports a resilient probe that namespace-imports $lib/prismicio (no fragile named import)", async () => {
    // The whole point of the ported template vs the starter's: a namespace import
    // + feature-detection, so an older clone lacking `isPlaceholderRepo` still builds.
    const cwd = await copyFixtureToTmp(pristine);
    await healthEndpoint({ path: cwd });
    const written = await readFile(join(cwd, HEALTH_ENDPOINT_RELATIVE), "utf-8");
    expect(written).toContain('import * as prismicio from "$lib/prismicio"');
    expect(written).not.toContain('import { createClient, isPlaceholderRepo }');
    expect(written).toContain("export const prerender = false");
  });

  it("noops when the endpoint already exists (does not clobber operator edits)", async () => {
    const cwd = await copyFixtureToTmp(pristine);
    const target = join(cwd, HEALTH_ENDPOINT_RELATIVE);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, "// custom operator /health, do not overwrite\n");
    execFileSync("git", ["add", "-A"], { cwd, stdio: "ignore" });
    execFileSync("git", ["commit", "-m", "add custom health"], { cwd, stdio: "ignore" });

    const result = await healthEndpoint({ path: cwd });
    expect(result.status).toBe("noop");
    expect(result.commits).toHaveLength(0);
    expect(result.notes).toMatch(/already exists/);

    const after = await readFile(target, "utf-8");
    expect(after).toBe("// custom operator /health, do not overwrite\n");
  });

  it("creates the health/ parent dir when it doesn't exist", async () => {
    const cwd = await copyFixtureToTmp(pristine);
    await expect(access(join(cwd, "src/routes/health"))).rejects.toThrow();
    await healthEndpoint({ path: cwd });
    await access(join(cwd, HEALTH_ENDPOINT_RELATIVE));
  });
});
