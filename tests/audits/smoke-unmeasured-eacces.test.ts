import { describe, it, expect, vi, onTestFinished } from "vitest";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, writeFile, chmod, readFile, rm } from "node:fs/promises";
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
    defaultSpawn: async (_cmd: string, args: readonly string[], opts?: { cwd?: string }) => {
      // Only acme's suite throws; any other site's suite passes, so a sweep can hold
      // one measured site beside the unmeasured one.
      // A site with no node_modules installs first; "noinstall"'s install fails.
      if (args[0] === "install" && opts?.cwd?.includes("smoke-eacces-noinstall")) {
        return { code: 1, stdout: "", stderr: "ERR_PNPM_FETCH_404" };
      }
      if (args[0] === "test:smoke" && opts?.cwd?.includes("smoke-eacces-acme")) {
        throw Object.assign(new Error("spawn pnpm EACCES"), { code: "EACCES", errno: -13 });
      }
      return { code: 0, stdout: "", stderr: "" };
    },
  };
});

const { runOneAudit } = await import("../../src/audits/index.js");
const { runAuditCommand } = await import("../../src/cli/commands/audit.js");
const { formatUnmeasuredSmokeSummary, isUnmeasuredSmoke } =
  await import("../../src/audits/smoke.js");
const { stepRunScript, workflowPath } = await import("../build/_helpers/workflow-source.js");

async function siteWithSuite(
  name = "acme",
  installed = true,
): Promise<{ name: string; path: string }> {
  const dir = await mkdtemp(join(tmpdir(), `smoke-eacces-${name}-`));
  onTestFinished(() => rm(dir, { recursive: true, force: true }));
  await writeFile(
    join(dir, "package.json"),
    JSON.stringify({ name: "acme", scripts: { "test:smoke": "playwright test" } }),
  );
  if (installed) await mkdir(join(dir, "node_modules")); // the suite spawn is what runs
  return { name, path: dir };
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

  it("the CLI's own output reds fleet-smoke.yml's never-measured check, naming the site", async () => {
    // Through runAuditCommand, the entry point the nightly runs: a JSON fleet of three
    // sites: one whose suite spawn throws EACCES, one whose deps will not install,
    // and one whose suite passes. No write-back, so no store is needed; the
    // unmeasured line prints for any fleet sweep that ran smoke.
    const sites = [
      await siteWithSuite("acme"),
      await siteWithSuite("healthy"),
      await siteWithSuite("noinstall", false),
    ];
    const dir = await mkdtemp(join(tmpdir(), "smoke-eacces-wf-"));
    onTestFinished(() => rm(dir, { recursive: true, force: true }));
    await writeFile(join(dir, "fleet.json"), JSON.stringify(sites));
    const { output } = await runAuditCommand(undefined, {
      fleet: join(dir, "fleet.json"),
      only: "smoke",
      workdir: join(dir, "work"),
      cwd: dir,
    });
    // acme's suite spawn threw EACCES (a fail), noinstall's deps would not install (a
    // skip): both unmeasured. The healthy site's suite ran and carries a verdict.
    expect(output).toMatch(/^smoke +fail +acme\n {2}smoke: unexpected error — .*EACCES/m);
    expect(output).toMatch(/^smoke +skip +noinstall\n {2}smoke: pnpm install failed/m);
    expect(output).toMatch(/^FLEET_SMOKE_UNMEASURED count=2 sites=acme,noinstall$/m);

    const step = stepRunScript(
      await readFile(workflowPath("fleet-smoke.yml"), "utf-8"),
      "Fleet smoke suite + write-back",
    );
    await mkdir(join(dir, "bin"));
    // The never-measured check runs before the write gate, so a summary line is all
    // the write half needs here.
    await writeFile(
      join(dir, "canned.txt"),
      `${output}\nFLEET_WRITE_SUMMARY wrote=1 failed=2 total=3\n`,
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
    expect(out.text).toContain("::error::fleet smoke: 2 site(s) never measured — acme,noinstall");
  });
});
