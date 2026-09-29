import { describe, it, expect } from "vitest";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { analyticsTag } from "../../src/recipes/analytics-tag/index.js";
import {
  HOOKS_CLIENT_RELATIVE,
  hooksClientTemplate,
} from "../../src/recipes/analytics-tag/template.js";
import { PRETTIER_FLAG_NOTE } from "../../src/recipes/_prettier.js";
import { runAnalyticsTagCommand } from "../../src/cli/commands/analytics-tag.js";
import { analyticsAudit } from "../../src/audits/analytics.js";
import type { SpawnFn, SpawnOptions } from "../../src/audits/util/spawn.js";
import { copyFixtureToTmp } from "./_helpers/site-tmpdir.js";

/**
 * The recipe, run against a real git checkout. Until these, its only tests
 * grepped its own source for words ("findForeignAnalytics", "double every
 * session"), so the refusal that keeps beachfront from double-counting could be
 * disabled with the words left in place and the suite stayed green.
 */
const here = dirname(fileURLToPath(import.meta.url));
const pristine = resolve(here, "../fixtures/pristine-starter");
const ID = "G-ABCDEFGHIJ";
const HOST = "www.example.com";

function recordingSpawn(): {
  spawn: SpawnFn;
  calls: Array<{ cmd: string; args: string[]; opts: SpawnOptions | undefined }>;
} {
  const calls: Array<{ cmd: string; args: string[]; opts: SpawnOptions | undefined }> = [];
  const spawn: SpawnFn = async (cmd, args, opts) => {
    calls.push({ cmd, args: [...args], opts });
    return { code: 0, stdout: "", stderr: "" };
  };
  return { spawn, calls };
}

const noPrettier = async () => null;
const exists = (p: string) =>
  access(p).then(
    () => true,
    () => false,
  );
const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
const headFiles = (cwd: string) =>
  git(cwd, "show", "--name-only", "--format=", "HEAD").split("\n").filter(Boolean).sort();

async function withFile(rel: string, body: string): Promise<string> {
  return copyFixtureToTmp(pristine, async (dir) => {
    await mkdir(dirname(join(dir, rel)), { recursive: true });
    await writeFile(join(dir, rel), body);
  });
}

describe("recipes/analytics-tag, run for real", () => {
  it("writes the hook, commits only it, and the audit reads back what it wrote", async () => {
    const cwd = await copyFixtureToTmp(pristine);
    const { spawn } = recordingSpawn();
    const res = await analyticsTag(
      { path: cwd },
      { measurementId: ID, productionHost: HOST },
      { spawn, resolvePrettier: noPrettier },
    );
    expect(res.status).toBe("applied");
    expect(res.commits).toHaveLength(1);
    expect(await readFile(join(cwd, HOOKS_CLIENT_RELATIVE), "utf8")).toBe(
      hooksClientTemplate({ measurementId: ID, productionHost: HOST }),
    );
    expect(headFiles(cwd)).toEqual([HOOKS_CLIENT_RELATIVE]);

    const audit = await analyticsAudit({
      site: { path: cwd, deployedUrl: `https://${HOST}/` },
      analyticsDeps: { propertyId: "123456789" },
    });
    expect(audit.status).toBe("pass");
    expect(audit.summary).toContain(`${ID} is declared, paired with property 123456789`);
  });

  it("is a noop when the hook already exists, and writes nothing", async () => {
    const cwd = await withFile(HOOKS_CLIENT_RELATIVE, "export const init = () => {};\n");
    const res = await analyticsTag(
      { path: cwd },
      { measurementId: ID, productionHost: HOST },
      { spawn: recordingSpawn().spawn, resolvePrettier: noPrettier },
    );
    expect(res.status).toBe("noop");
    expect(git(cwd, "status", "--porcelain")).toBe("");
  });

  it("refuses a site that already loads a tag, names the file, and writes nothing", async () => {
    // beachfront's shape: its own component appends the loader in onMount with
    // no guard, so installing alongside would double every session.
    const rel = "src/lib/components/Analytics.svelte";
    const cwd = await withFile(
      rel,
      '<script>script.src = "https://www.googletagmanager.com/gtag/js?id=" + ID;</script>\n',
    );
    const res = await analyticsTag(
      { path: cwd },
      { measurementId: ID, productionHost: HOST },
      { spawn: recordingSpawn().spawn, resolvePrettier: noPrettier },
    );
    expect(res.status).toBe("failed");
    expect(res.notes).toContain(rel);
    expect(await exists(join(cwd, HOOKS_CLIENT_RELATIVE))).toBe(false);
    expect(git(cwd, "status", "--porcelain")).toBe("");
  });

  it("never falls back to `pnpm exec prettier` in a checkout with no prettier of its own", async () => {
    // _prettier.ts documents the hazard, measured 2026-08-13: in a repo with no
    // node_modules, `pnpm exec prettier` runs an unrequested install in the
    // target, then formats with the CALLING repo's prettier and exits 0. The
    // recipe commits with `git add -A`.
    const cwd = await copyFixtureToTmp(pristine);
    const { spawn, calls } = recordingSpawn();
    const res = await analyticsTag(
      { path: cwd },
      { measurementId: ID, productionHost: HOST },
      { spawn, resolvePrettier: noPrettier },
    );
    expect(res.status).toBe("applied");
    expect(calls).toEqual([]);
    expect(res.notes).toContain(PRETTIER_FLAG_NOTE);
  });

  it("runs the site's own prettier by absolute path, under a timeout", async () => {
    const cwd = await copyFixtureToTmp(pristine);
    const { spawn, calls } = recordingSpawn();
    const bin = "/site/node_modules/.bin/prettier";
    await analyticsTag(
      { path: cwd },
      { measurementId: ID, productionHost: HOST },
      { spawn, resolvePrettier: async () => bin },
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]?.cmd).toBe(bin);
    expect(calls[0]?.args).toEqual(["--write", HOOKS_CLIENT_RELATIVE]);
    expect(calls[0]?.opts?.timeoutMs).toBeGreaterThan(0);
  });

  it("turns the analytics hosts on for a createSvelteConfig csp, in the same commit", async () => {
    const cwd = await withFile(
      "svelte.config.js",
      'import { createSvelteConfig } from "@reddoorla/maintenance/configs/svelte";\n\nexport default createSvelteConfig({ csp: true });\n',
    );
    const res = await analyticsTag(
      { path: cwd },
      { measurementId: ID, productionHost: HOST },
      { spawn: recordingSpawn().spawn, resolvePrettier: noPrettier },
    );
    expect(res.status).toBe("applied");
    expect(await readFile(join(cwd, "svelte.config.js"), "utf8")).toContain(
      "createSvelteConfig({ csp: { analytics: true } })",
    );
    expect(headFiles(cwd)).toEqual([HOOKS_CLIENT_RELATIVE, "svelte.config.js"].sort());
    expect(res.notes).toContain("analytics hosts enabled");
  });

  it("leaves a native kit.csp alone and says which hosts to add by hand", async () => {
    const config =
      'import adapter from "@sveltejs/adapter-netlify";\n\nexport default {\n  kit: { adapter: adapter(), csp: { mode: "auto", directives: { "script-src": ["self"] } } },\n};\n';
    const cwd = await withFile("svelte.config.js", config);
    const res = await analyticsTag(
      { path: cwd },
      { measurementId: ID, productionHost: HOST },
      { spawn: recordingSpawn().spawn, resolvePrettier: noPrettier },
    );
    expect(res.status).toBe("applied");
    expect(await readFile(join(cwd, "svelte.config.js"), "utf8")).toBe(config);
    expect(headFiles(cwd)).toEqual([HOOKS_CLIENT_RELATIVE]);
    expect(res.notes).toContain("CSP NOT CHANGED");
    expect(res.notes).toContain("https://www.googletagmanager.com");
  });
});

describe("reddoor-maint analytics-tag", () => {
  it("requires --production-host, because a checkout path carries no deployed URL", async () => {
    // The CLI resolves a bare path, so there is no row and no deployedUrl to
    // derive a host from. The old failure blamed "the site row", which was
    // never read.
    const cwd = await copyFixtureToTmp(pristine);
    const out = await runAnalyticsTagCommand(cwd, { measurementId: ID });
    expect(out.code).toBe(2);
    expect(out.output).toContain("--production-host");
    expect(out.output).not.toContain("site row");
    expect(await exists(join(cwd, HOOKS_CLIENT_RELATIVE))).toBe(false);
  });

  it("the hook it writes names the audit command that actually exists", () => {
    // `reddoor-maint audit analytics` reads "analytics" as a site path.
    const hook = hooksClientTemplate({ measurementId: ID, productionHost: HOST });
    expect(hook).toContain("reddoor-maint audit --only analytics");
    expect(hook).not.toContain("reddoor-maint audit analytics");
  });
});
