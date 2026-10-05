import { describe, it, expect, beforeAll } from "vitest";
import { load } from "js-yaml";
import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  stepEnv,
  stepRunScript,
  workflowPath,
  withoutComments,
} from "./_helpers/workflow-source.js";

const execFileAsync = promisify(execFile);

const STEP = "Sync each site's models from Prismic";
const FETCH_STEP = "Read each site's models from Prismic";
let wf: string;
let gate: string;

beforeAll(async () => {
  wf = await readFile(workflowPath("fleet-prismic-sync.yml"), "utf-8");
  gate = stepRunScript(wf, STEP);
});

/** The step's own script, run under `bash -e` with `node` stubbed to print
 *  `stdout` and exit `exit`, as the drift workflow's test does. */
async function runGate(opts: {
  stdout: string;
  exit: number;
  ref?: string;
}): Promise<{ code: number; out: string }> {
  const dir = await mkdtemp(join(tmpdir(), "prismic-sync-gate-"));
  const bin = join(dir, "bin");
  await mkdir(bin, { recursive: true });
  await writeFile(join(dir, "canned.txt"), opts.stdout, "utf-8");
  await writeFile(
    join(bin, "node"),
    `#!/bin/sh\necho "$@" > "${join(dir, "argv.txt")}"\ncat "${join(dir, "canned.txt")}"\nexit ${opts.exit}\n`,
    "utf-8",
  );
  await chmod(join(bin, "node"), 0o755);
  try {
    const { stdout, stderr } = await execFileAsync("bash", ["-e", "-c", gate], {
      cwd: dir,
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH ?? ""}`,
        RUNNER_TEMP: dir,
        GITHUB_REF: opts.ref ?? "refs/heads/main",
      },
    });
    return { code: 0, out: stdout + stderr + (await readFile(join(dir, "argv.txt"), "utf-8")) };
  } catch (e) {
    const err = e as { code?: number; stdout?: string; stderr?: string };
    return { code: err.code ?? 1, out: (err.stdout ?? "") + (err.stderr ?? "") };
  }
}

const summary = (failed: number): string =>
  `PRISMIC_SYNC_SUMMARY sites=13 opened=1 updated=0 unchanged=0 closed=0 in_sync=${12 - failed} would_open=0 skipped=0 failed=${failed}`;

describe("fleet-prismic-sync — the gate", () => {
  it("passes a run that synced every site, and asks the CLI to open PRs", async () => {
    const r = await runGate({
      stdout: `opened Fixture — opened https://x\n${summary(0)}\n`,
      exit: 0,
    });
    expect(r.code).toBe(0);
    expect(r.out).not.toContain("::error::");
    expect(r.out).toContain("prismic-sync --fleet turso --stage publish --open-prs --plan");
  });

  it("never asks for PRs from a run on any ref but main", async () => {
    const r = await runGate({
      stdout: `would-open Fixture — would push\n${summary(0)}\n`,
      exit: 0,
      ref: "refs/heads/claude/wip",
    });
    expect(r.code).toBe(0);
    expect(r.out).toContain("prismic-sync --fleet turso --stage publish --plan");
    expect(r.out).not.toContain("--open-prs");
  });

  it("fails when a site failed, naming it", async () => {
    const r = await runGate({
      stdout: `failed     Hedloc — 1 model(s) refused\n${summary(1)}\n`,
      exit: 1,
    });
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/::error::.*Hedloc/);
  });

  it("warns on the run for a held or declined site, and stays green", async () => {
    const r = await runGate({
      stdout: `held       Hedloc — prismic-sync carries commits\ndeclined   Espada — closed unmerged\nopened     Fixture — x\n${summary(0)}\n`,
      exit: 0,
    });
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/::warning::held\s+Hedloc/);
    expect(r.out).toMatch(/::warning::declined\s+Espada/);
    expect(r.out).not.toMatch(/::warning::opened/);
  });

  it("fails a green exit that printed no summary", async () => {
    const r = await runGate({ stdout: "nothing useful\n", exit: 0 });
    expect(r.code).not.toBe(0);
    expect(r.out).toContain("::error::");
  });

  it("names the refusal when the run stopped before any site", async () => {
    const r = await runGate({ stdout: "⛔ the inventory resolved no sites\n", exit: 1 });
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/::error::.*resolved no sites/);
  });
});

describe("fleet-prismic-sync — wiring", () => {
  it("carries exactly the drift sweep's per-repository Prismic tokens, and no generic one", async () => {
    const drift = await readFile(workflowPath("fleet-prismic-drift.yml"), "utf-8");
    const names = (env: Record<string, string>) =>
      Object.keys(env)
        .filter((k) => k.startsWith("PRISMIC_"))
        .sort();
    const mine = names(stepEnv(wf, FETCH_STEP));
    expect(mine).toEqual(names(stepEnv(drift, "Sweep the fleet for Prismic model drift")));
    expect(mine.length).toBeGreaterThan(10);
    expect(mine).not.toContain("PRISMIC_WRITE_TOKEN");
  });

  it("pushes as the reddoor-renovate App, minted org-wide", () => {
    const env = stepEnv(wf, STEP);
    expect(env.GH_TOKEN).toBe("${{ steps.app-token.outputs.token }}");
    const src = withoutComments(wf);
    expect(src).toContain("app-id: ${{ vars.RENOVATE_APP_ID }}");
    expect(src).toContain("private-key: ${{ secrets.RENOVATE_APP_PRIVATE_KEY }}");
    expect(src).toMatch(/owner: reddoorla/);
  });

  it("names the drift workflow by its real name, or it never fires", async () => {
    const drift = await readFile(workflowPath("fleet-prismic-drift.yml"), "utf-8");
    const name = /^name:\s*(\S+)\s*$/m.exec(drift)?.[1];
    expect(name).toBe("fleet-prismic-drift");
    expect(withoutComments(wf)).toContain(`workflows: [${name}]`);
  });

  it("runs after the drift sweep, only for main's runs", () => {
    const src = withoutComments(wf);
    expect(src).toMatch(/workflow_run:\n\s+workflows: \[fleet-prismic-drift\]/);
    expect(src).toContain("github.event.workflow_run.head_branch == 'main'");
  });
});

type Job = {
  permissions?: unknown;
  if?: string;
  needs?: string | string[];
  steps: Array<{
    name?: string;
    uses?: string;
    run?: string;
    with?: Record<string, unknown>;
    env?: Record<string, string>;
  }>;
};
const jobs = (): Record<string, Job> => (load(wf) as { jobs: Record<string, Job> }).jobs;
const text = (j: Job): string => JSON.stringify(j);

describe("fleet-prismic-sync — no site code beside a credential", () => {
  it("has exactly the three jobs", () => {
    expect(Object.keys(jobs()).sort()).toEqual(["build", "fetch", "publish"]);
  });

  it("gives the build job no permission, no secret and no token", () => {
    const build = jobs().build!;
    expect(build.permissions).toEqual({});
    expect(text(build)).not.toMatch(/secrets\.|_TOKEN|github\.token|create-github-app-token/);
  });

  it("runs a site's own tools only in the build job, inside a container pinned by digest", () => {
    const { fetch, build, publish } = jobs();
    const site = build!.steps.find((s) => s.name === "Build the site in a container")!;
    expect(site.run).toMatch(/docker run --rm\b/);
    expect(site.run).toMatch(/node:24-bookworm@sha256:[0-9a-f]{64}/);
    expect(site.run).toContain(":/runner/build.mjs:ro");
    for (const j of [fetch!, publish!]) {
      expect(text(j)).not.toMatch(/docker run|build\.mjs --in/);
    }
  });

  it("restores and saves no cache in any job", () => {
    for (const [name, j] of Object.entries(jobs())) {
      expect({ name, cache: text(j).match(/"cache"|actions\/cache/) }).toEqual({
        name,
        cache: null,
      });
    }
  });

  it("mints a read-only token for fetch and the write token only in publish", () => {
    const tokens = Object.entries(jobs()).flatMap(([name, j]) =>
      j.steps
        .filter((s) => s.uses?.startsWith("actions/create-github-app-token@"))
        .map((s) => ({
          name,
          perms: Object.keys(s.with ?? {})
            .filter((k) => k.startsWith("permission-"))
            .map((k) => `${k}=${String(s.with![k])}`),
        })),
    );
    expect(tokens).toEqual([
      { name: "fetch", perms: ["permission-contents=read"] },
      { name: "publish", perms: ["permission-contents=write", "permission-pull-requests=write"] },
    ]);
  });

  it("gives the Prismic tokens to the fetch job alone", () => {
    const { build, publish } = jobs();
    expect(text(build!)).not.toContain("PRISMIC_");
    expect(text(publish!)).not.toContain("PRISMIC_TOKEN_");
  });

  it("publishes nothing unless the fetch and every build leg succeeded", () => {
    const publish = jobs().publish!;
    expect(publish.needs).toEqual(["fetch", "build"]);
    const first = publish.steps[0]!;
    expect(first.name).toBe("Require the fetch and every build leg");
    expect(first.env).toEqual({
      FETCH: "${{ needs.fetch.result }}",
      BUILD: "${{ needs.build.result }}",
    });
  });
});

describe("fleet-prismic-sync — the publish job's first step", () => {
  const script = () => stepRunScript(wf, "Require the fetch and every build leg");
  const runIt = async (fetchResult: string, buildResult: string) => {
    try {
      const { stdout } = await execFileAsync("bash", ["-e", "-c", script()], {
        env: { ...process.env, FETCH: fetchResult, BUILD: buildResult },
      });
      return { code: 0, out: stdout };
    } catch (e) {
      const err = e as { code?: number; stdout?: string };
      return { code: err.code ?? 1, out: err.stdout ?? "" };
    }
  };

  it("passes a successful fetch with a successful or skipped build", async () => {
    expect((await runIt("success", "success")).code).toBe(0);
    expect((await runIt("success", "skipped")).code).toBe(0);
  });

  it("refuses a failed or cancelled fetch or build leg", async () => {
    for (const [f, b] of [
      ["failure", "skipped"],
      ["cancelled", "skipped"],
      ["success", "failure"],
      ["success", "cancelled"],
    ]) {
      const r = await runIt(f!, b!);
      expect({ f, b, code: r.code }).toEqual({ f, b, code: 1 });
      expect(r.out).toContain("::error::");
    }
  });
});

describe("fleet-prismic-sync — what leaves a build leg", () => {
  const STEP_KEEP = "Keep only plain files from the container";

  it("removes links and special files, and keeps plain ones", async () => {
    const dir = await mkdtemp(join(tmpdir(), "prismic-sync-keep-"));
    const out = join(dir, "built", "s0");
    await mkdir(join(out, "files", "customtypes", "page"), { recursive: true });
    await writeFile(join(out, "result.json"), '{"ok":true}\n', "utf-8");
    await writeFile(join(out, "files", "customtypes", "page", "index.json"), "{}\n", "utf-8");
    await writeFile(join(dir, "host-secret"), "secret\n", "utf-8");
    await symlink(join(dir, "host-secret"), join(out, "files", "prismicio-types.d.ts"));
    await symlink("/etc", join(out, "files", "linkdir"));
    await execFileAsync("mkfifo", [join(out, "files", "fifo")]);
    const { stdout } = await execFileAsync("bash", ["-e", "-c", stepRunScript(wf, STEP_KEEP)], {
      env: { ...process.env, RUNNER_TEMP: dir, SITE_ID: "s0" },
    });
    expect(stdout).toContain("::warning::s0: removed");
    const left = (await execFileAsync("find", [out, "-mindepth", "1"])).stdout
      .trim()
      .split("\n")
      .map((p) => p.slice(out.length + 1))
      .sort();
    expect(left).toEqual([
      "files",
      "files/customtypes",
      "files/customtypes/page",
      "files/customtypes/page/index.json",
      "result.json",
    ]);
    expect(await readFile(join(dir, "host-secret"), "utf-8")).toBe("secret\n");
  });

  it("is silent and keeps everything when the output is plain", async () => {
    const dir = await mkdtemp(join(tmpdir(), "prismic-sync-keep-"));
    const out = join(dir, "built", "s1");
    await mkdir(join(out, "files"), { recursive: true });
    await writeFile(join(out, "result.json"), '{"ok":true}\n', "utf-8");
    const { stdout } = await execFileAsync("bash", ["-e", "-c", stepRunScript(wf, STEP_KEEP)], {
      env: { ...process.env, RUNNER_TEMP: dir, SITE_ID: "s1" },
    });
    expect(stdout).not.toContain("::warning::");
    expect(await readFile(join(out, "result.json"), "utf-8")).toBe('{"ok":true}\n');
  });

  it("checks the output before uploading it, and uploads built/ so the root holds <id>/", () => {
    const steps = jobs().build!.steps;
    const keep = steps.findIndex((s) => s.name === STEP_KEEP);
    const upload = steps.findIndex((s) => s.uses?.startsWith("actions/upload-artifact@"));
    expect(keep).toBeGreaterThan(-1);
    expect(keep).toBeLessThan(upload);
    expect(steps[upload]!.with!.path).toBe("${{ runner.temp }}/built");
  });

  it("merges the legs' artifacts, so one leg lands at built/<id> as many do", () => {
    const dl = jobs().publish!.steps.find(
      (s) => s.uses?.startsWith("actions/download-artifact@") && s.with?.pattern,
    )!;
    expect(dl.with).toEqual({
      pattern: "prismic-sync-built-*",
      "merge-multiple": true,
      path: "${{ runner.temp }}/built",
    });
  });
});
