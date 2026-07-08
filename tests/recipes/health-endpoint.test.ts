import { describe, it, expect } from "vitest";
import { writeFile, mkdir, readFile, access, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve, dirname, join } from "node:path";
import { healthEndpoint } from "../../src/recipes/health-endpoint/index.js";
import {
  HEALTH_ENDPOINT_RELATIVE,
  HEALTH_ENDPOINT_TEMPLATE,
  HEALTH_ENDPOINT_TEMPLATE_NO_PRISMIC,
} from "../../src/recipes/health-endpoint/template.js";
import type { SpawnFn, SpawnResult } from "../../src/audits/util/spawn.js";
import { copyFixtureToTmp } from "./_helpers/site-tmpdir.js";

const here = dirname(fileURLToPath(import.meta.url));
const pristine = resolve(here, "../fixtures/pristine-starter");

/** A fake spawn that records each invocation (and the on-disk /health content at
 * call time, to prove the file was written before prettier ran) and returns a
 * caller-supplied result — so tests never shell out to a real prettier/pnpm. */
type SpawnCall = {
  cmd: string;
  args: string[];
  cwd: string | undefined;
  fileAtCall: string | null;
};

function recordingSpawn(result: SpawnResult = { code: 0, stdout: "", stderr: "" }): {
  spawn: SpawnFn;
  calls: SpawnCall[];
} {
  const calls: SpawnCall[] = [];
  const spawn: SpawnFn = async (cmd, args, opts) => {
    let fileAtCall: string | null;
    try {
      fileAtCall = await readFile(join(opts?.cwd ?? "", HEALTH_ENDPOINT_RELATIVE), "utf-8");
    } catch {
      fileAtCall = null;
    }
    calls.push({ cmd, args: [...args], cwd: opts?.cwd, fileAtCall });
    return result;
  };
  return { spawn, calls };
}

describe("recipes/health-endpoint", () => {
  it("writes the resilient /health endpoint on a clean site, commits, surfaces a branch", async () => {
    const cwd = await copyFixtureToTmp(pristine);
    const { spawn } = recordingSpawn();
    const result = await healthEndpoint({ path: cwd }, { spawn });

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
    const { spawn } = recordingSpawn();
    await healthEndpoint({ path: cwd }, { spawn });
    const written = await readFile(join(cwd, HEALTH_ENDPOINT_RELATIVE), "utf-8");
    expect(written).toContain('import * as prismicio from "$lib/prismicio"');
    expect(written).not.toContain("import { createClient, isPlaceholderRepo }");
    expect(written).toContain("export const prerender = false");
  });

  it("runs the site's prettier on the written file BEFORE committing", async () => {
    const cwd = await copyFixtureToTmp(pristine);
    const { spawn, calls } = recordingSpawn();
    await healthEndpoint({ path: cwd }, { spawn });

    expect(calls).toHaveLength(1);
    const [call] = calls;
    if (!call) throw new Error("expected prettier to be invoked");
    expect(call.cmd).toBe("pnpm");
    expect(call.args).toEqual(["exec", "prettier", "--write", HEALTH_ENDPOINT_RELATIVE]);
    expect(call.cwd).toBe(cwd);
    // The file already existed on disk when prettier was invoked (write → format → commit).
    expect(call.fileAtCall).toBe(HEALTH_ENDPOINT_TEMPLATE);
  });

  it("still commits (best-effort) when prettier is unavailable, flagging it in notes", async () => {
    const cwd = await copyFixtureToTmp(pristine);
    const { spawn } = recordingSpawn({ code: 1, stdout: "", stderr: "prettier: not found" });
    const result = await healthEndpoint({ path: cwd }, { spawn });

    expect(result.status).toBe("applied");
    expect(result.commits).toHaveLength(1);
    expect(result.notes).toMatch(/could not prettier-format/);
  });

  it("emits a Prismic-free variant on a site without $lib/prismicio (no import, prismic: skipped)", async () => {
    const cwd = await copyFixtureToTmp(pristine);
    // Turn the fixture into a non-Prismic site: drop the prismicio module + commit.
    await rm(join(cwd, "src/lib/prismicio.ts"));
    execFileSync("git", ["add", "-A"], { cwd, stdio: "ignore" });
    execFileSync("git", ["commit", "-m", "drop prismicio (non-Prismic site)"], {
      cwd,
      stdio: "ignore",
    });

    const { spawn } = recordingSpawn();
    const result = await healthEndpoint({ path: cwd }, { spawn });

    expect(result.status).toBe("applied");
    expect(result.notes).toMatch(/Prismic-free/);

    const written = await readFile(join(cwd, HEALTH_ENDPOINT_RELATIVE), "utf-8");
    expect(written).toBe(HEALTH_ENDPOINT_TEMPLATE_NO_PRISMIC);
    expect(written).not.toContain('import * as prismicio from "$lib/prismicio"');
    expect(written).toContain('const prismic = "skipped" as const');
    expect(written).toContain("export const prerender = false");
  });

  it("noops when the endpoint already exists (does not clobber operator edits), never invoking prettier", async () => {
    const cwd = await copyFixtureToTmp(pristine);
    const target = join(cwd, HEALTH_ENDPOINT_RELATIVE);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, "// custom operator /health, do not overwrite\n");
    execFileSync("git", ["add", "-A"], { cwd, stdio: "ignore" });
    execFileSync("git", ["commit", "-m", "add custom health"], { cwd, stdio: "ignore" });

    const { spawn, calls } = recordingSpawn();
    const result = await healthEndpoint({ path: cwd }, { spawn });
    expect(result.status).toBe("noop");
    expect(result.commits).toHaveLength(0);
    expect(result.notes).toMatch(/already exists/);
    expect(calls).toHaveLength(0);

    const after = await readFile(target, "utf-8");
    expect(after).toBe("// custom operator /health, do not overwrite\n");
  });

  it("creates the health/ parent dir when it doesn't exist", async () => {
    const cwd = await copyFixtureToTmp(pristine);
    const { spawn } = recordingSpawn();
    await expect(access(join(cwd, "src/routes/health"))).rejects.toThrow();
    await healthEndpoint({ path: cwd }, { spawn });
    await access(join(cwd, HEALTH_ENDPOINT_RELATIVE));
  });
});
