import { describe, it, expect } from "vitest";
import { writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve, dirname, join } from "node:path";
import { bumpDeps } from "../../src/recipes/bump-deps";
import { copyFixtureToTmp } from "./_helpers/site-tmpdir";
import type { SpawnFn } from "../../src/audits/util/spawn";

const here = dirname(fileURLToPath(import.meta.url));
const pristine = resolve(here, "../fixtures/pristine-starter");

function spawnSequence(
  responses: Array<{ cmd: string; args?: string[]; result: { code: number; stdout: string } }>,
): SpawnFn {
  let i = 0;
  return async (cmd, args) => {
    const exp = responses[i++];
    if (!exp) throw new Error(`unexpected spawn: ${cmd} ${args?.join(" ")}`);
    return { code: exp.result.code, stdout: exp.result.stdout, stderr: "" };
  };
}

describe("recipes/bump-deps", () => {
  it("returns noop when pnpm outdated reports nothing", async () => {
    const cwd = await copyFixtureToTmp(pristine);
    const result = await bumpDeps(
      { path: cwd },
      {
        spawn: spawnSequence([{ cmd: "pnpm", result: { code: 0, stdout: "{}" } }]),
      },
    );
    expect(result.status).toBe("noop");
  });

  it("bumps deps and commits when outdated reports drift", async () => {
    const cwd = await copyFixtureToTmp(pristine);

    const outdatedJson = JSON.stringify({
      vite: { current: "8.0.5", wanted: "8.0.10", latest: "8.0.10" },
    });

    // Simulate `pnpm up` actually changing the file so the commit creates content
    const mutatePkg = async (): Promise<{ code: number; stdout: string }> => {
      await writeFile(join(cwd, "fake-marker.txt"), `bumped at ${Date.now()}`, "utf-8");
      return { code: 0, stdout: "" };
    };

    const result = await bumpDeps(
      { path: cwd },
      {
        spawn: async (cmd, _args) => {
          if (cmd === "pnpm" && _args?.[0] === "outdated") {
            return { code: 0, stdout: outdatedJson, stderr: "" };
          }
          if (cmd === "pnpm" && _args?.[0] === "up") {
            const r = await mutatePkg();
            return { code: r.code, stdout: r.stdout, stderr: "" };
          }
          throw new Error(`unexpected spawn: ${cmd} ${_args?.join(" ")}`);
        },
      },
    );

    expect(result.status).toBe("applied");
    expect(result.commits.length).toBe(1);

    const branch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd,
      encoding: "utf-8",
    }).trim();
    expect(branch).toMatch(/^maint\/bump-deps-\d{8}T\d{6}Z$/);
  });

  it("refuses to run when working tree is dirty", async () => {
    const cwd = await copyFixtureToTmp(pristine);
    execFileSync("touch", ["dirty.txt"], { cwd });
    const outdatedJson = JSON.stringify({
      vite: { current: "8.0.5", wanted: "8.0.10", latest: "8.0.10" },
    });
    await expect(
      bumpDeps(
        { path: cwd },
        { spawn: spawnSequence([{ cmd: "pnpm", result: { code: 0, stdout: outdatedJson } }]) },
      ),
    ).rejects.toThrow(/working tree/i);
  });
});
