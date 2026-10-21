import { describe, it, expect, vi } from "vitest";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, writeFile, chmod, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { join } from "node:path";

/**
 * #1611: a smoke suite whose spawn throws anything but a timeout (`EACCES` here) came
 * back from `runOneAudit` as `smoke: unexpected error`, a fail with no details. The
 * prior verdict was kept, yet `FLEET_SMOKE_UNMEASURED` counted only the timeout's
 * `NOT MEASURED` prefix, so the run printed `count=0` and `all 1 site(s) measured`.
 *
 * `EACCES` cannot be staged by file mode here (the container runs as root), so the
 * real spawn is replaced by one that throws exactly what node throws for it, and the
 * REAL `runOneAudit` turns that into the result the fleet sweep writes.
 */
vi.mock("../../src/audits/util/spawn.js", async (orig) => {
  const real = await orig<typeof import("../../src/audits/util/spawn.js")>();
  return {
    ...real,
    defaultSpawn: async (_cmd: string, args: readonly string[]) => {
      if (args[0] === "test:smoke") {
        throw Object.assign(new Error("spawn pnpm EACCES"), { code: "EACCES", errno: -13 });
      }
      return { code: 0, stdout: "", stderr: "" };
    },
  };
});

const { runOneAudit } = await import("../../src/audits/index.js");
const { formatUnmeasuredSmokeSummary, isUnmeasuredSmoke } =
  await import("../../src/audits/smoke.js");
const { stepRunScript, workflowPath } = await import("../build/_helpers/workflow-source.js");

async function siteWithSuite(): Promise<{ name: string; path: string }> {
  const dir = await mkdtemp(join(tmpdir(), "smoke-eacces-"));
  await writeFile(
    join(dir, "package.json"),
    JSON.stringify({ name: "acme", scripts: { "test:smoke": "playwright test" } }),
  );
  await mkdir(join(dir, "node_modules")); // installed: the suite spawn is what throws
  return { name: "acme", path: dir };
}

describe("#1611: a smoke spawn that throws EACCES is unmeasured", () => {
  it("runOneAudit returns a fail with no verdict, and it counts", async () => {
    const r = await runOneAudit(await siteWithSuite(), "smoke");
    expect(r.status).toBe("fail");
    expect(r.summary).toMatch(/^smoke: unexpected error — .*EACCES/);
    expect(r.details).toBeUndefined();
    expect(isUnmeasuredSmoke(r)).toBe(true);
    expect(formatUnmeasuredSmokeSummary([r])).toContain(
      "FLEET_SMOKE_UNMEASURED count=1 sites=acme",
    );
  });

  it("reds fleet-smoke.yml's never-measured check, naming the site", async () => {
    const r = await runOneAudit(await siteWithSuite(), "smoke");
    const step = stepRunScript(
      await readFile(workflowPath("fleet-smoke.yml"), "utf-8"),
      "Fleet smoke suite + write-back",
    );
    const dir = await mkdtemp(join(tmpdir(), "smoke-eacces-wf-"));
    await mkdir(join(dir, "bin"));
    // Only what the never-measured check reads; it runs before the write gate.
    await writeFile(
      join(dir, "canned.txt"),
      `FLEET_WRITE_SUMMARY wrote=0 failed=1 total=1\n${formatUnmeasuredSmokeSummary([r])}\n`,
    );
    await writeFile(
      join(dir, "bin", "node"),
      `#!/bin/sh\ncat "${join(dir, "canned.txt")}"\nexit 1\n`,
    );
    await chmod(join(dir, "bin", "node"), 0o755);
    const out = await promisify(execFile)("bash", ["-e", "-c", step], {
      cwd: dir,
      env: {
        ...process.env,
        PATH: `${join(dir, "bin")}:${process.env.PATH ?? ""}`,
        RUNNER_TEMP: dir,
      },
    }).then(
      (o) => ({ code: 0, text: o.stdout + o.stderr }),
      (e: { code?: number; stdout?: string; stderr?: string }) => ({
        code: e.code ?? 1,
        text: (e.stdout ?? "") + (e.stderr ?? ""),
      }),
    );
    expect(out.code).toBe(1);
    expect(out.text).toContain("::error::fleet smoke: 1 site(s) never measured — acme");
  });
});
