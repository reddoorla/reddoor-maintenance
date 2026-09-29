import { describe, it, expect } from "vitest";
import { access, chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { analyticsTag, rangeFloor } from "../../src/recipes/analytics-tag/index.js";
import {
  HOOKS_CLIENT_RELATIVE,
  hooksClientTemplate,
} from "../../src/recipes/analytics-tag/template.js";
import { HAND_ADD_HOSTS } from "../../src/recipes/analytics-tag/csp-edit.js";
import { PRETTIER_FLAG_NOTE } from "../../src/recipes/_prettier.js";
import { RESTORED_NOTE } from "../../src/recipes/_head-guard.js";
import { runAnalyticsTagCommand } from "../../src/cli/commands/analytics-tag.js";
import { analyticsAudit } from "../../src/audits/analytics.js";
import type { SpawnFn, SpawnOptions } from "../../src/audits/util/spawn.js";
import { copyFixtureToTmp } from "./_helpers/site-tmpdir.js";

/**
 * The recipe, run against a real git checkout. Until round five its only
 * tests grepped its own source for words, so the refusal that keeps beachfront
 * from double-counting could be disabled with the words left in place.
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

/** The pristine starter, depending on a @reddoorla/maintenance that exports
 *  initAnalytics, plus `files`. */
async function site(
  files: Record<string, string> = {},
  deps: Record<string, string> = { "@reddoorla/maintenance": "^0.102.0" },
  executable: string[] = [],
): Promise<string> {
  return copyFixtureToTmp(pristine, async (dir) => {
    const pkgPath = join(dir, "package.json");
    const pkg = JSON.parse(await readFile(pkgPath, "utf8")) as {
      devDependencies: Record<string, string>;
    };
    Object.assign(pkg.devDependencies, deps);
    await writeFile(pkgPath, JSON.stringify(pkg, null, 2));
    for (const [rel, body] of Object.entries(files)) {
      await mkdir(dirname(join(dir, rel)), { recursive: true });
      await writeFile(join(dir, rel), body);
    }
    for (const rel of executable) await chmod(join(dir, rel), 0o755);
  });
}

const run = (cwd: string, id = ID, host = HOST, spawn = recordingSpawn().spawn) =>
  analyticsTag(
    { path: cwd },
    { measurementId: id, productionHost: host },
    { spawn, resolvePrettier: noPrettier },
  );

describe("recipes/analytics-tag, run for real", () => {
  it("writes the hook, commits only it, and the audit reads back what it wrote", async () => {
    const cwd = await site();
    const res = await run(cwd);
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

  it("is a noop only when the same ID already runs on the same host", async () => {
    const cwd = await site();
    expect((await run(cwd)).status).toBe("applied");
    const again = await run(cwd);
    expect(again.status).toBe("noop");
    expect(again.notes).toContain(`already starts ${ID} on ${HOST}`);
  });

  it("refuses a re-run with a DIFFERENT ID, naming both, instead of a silent noop", async () => {
    const cwd = await site();
    await run(cwd);
    const other = await run(cwd, "G-ZZZZZZZZZZ");
    expect(other.status).toBe("failed");
    expect(other.notes).toContain(ID);
    expect(other.notes).toContain("G-ZZZZZZZZZZ");
  });

  it("refuses an existing hook that does not start GA4, in every extension SvelteKit reads", async () => {
    // A hooks.client.ts written beside a hooks.client.js is ignored by
    // SvelteKit, while the recipe said applied and the audit passed.
    for (const rel of ["src/hooks.client.js", "src/hooks.client.ts", "src/hooks.client.mjs"]) {
      const cwd = await site({ [rel]: "export const handleError = () => {};\n" });
      const res = await run(cwd);
      expect(res.status).toBe("failed");
      expect(res.notes).toContain(rel);
      expect(res.notes).toContain(`initAnalytics({ measurementId: "${ID}"`);
      expect(git(cwd, "status", "--porcelain")).toBe("");
      if (rel !== HOOKS_CLIENT_RELATIVE) {
        expect(await exists(join(cwd, HOOKS_CLIENT_RELATIVE))).toBe(false);
      }
    }
  });

  it("refuses a site whose layout already calls initAnalytics with another ID", async () => {
    const cwd = await site({
      "src/routes/+layout.svelte": `<script>import { initAnalytics } from "@reddoorla/maintenance/client";\ninitAnalytics({ measurementId: "G-OLDOLDOLDX", productionHost: "${HOST}" });</script>`,
    });
    const res = await run(cwd);
    expect(res.status).toBe("failed");
    expect(res.notes).toContain("src/routes/+layout.svelte");
    expect(res.notes).toContain("G-OLDOLDOLDX");
  });

  it("refuses a site that already loads a tag, names the file, and writes nothing", async () => {
    const rel = "src/lib/components/Analytics.svelte";
    const cwd = await site({
      [rel]: '<script>script.src = "https://www.googletagmanager.com/gtag/js?id=" + ID;</script>\n',
    });
    const res = await run(cwd);
    expect(res.status).toBe("failed");
    expect(res.notes).toContain(rel);
    expect(res.notes).toContain("commit the removal");
    expect(await exists(join(cwd, HOOKS_CLIENT_RELATIVE))).toBe(false);
    expect(git(cwd, "status", "--porcelain")).toBe("");
  });

  it("refuses when it could not scan all of src/, rather than installing beside a loader it missed", async () => {
    const cwd = await site({
      "src/a.ts": "export {};\n",
      "src/b.ts": "export {};\n",
      "src/z.ts": "window.dataLayer = [];\n",
    });
    const res = await analyticsTag(
      { path: cwd },
      { measurementId: ID, productionHost: HOST },
      { spawn: recordingSpawn().spawn, resolvePrettier: noPrettier, scanCap: 1 },
    );
    expect(res.status).toBe("failed");
    expect(res.notes).toContain("could not rule out a loader");
    expect(await exists(join(cwd, HOOKS_CLIENT_RELATIVE))).toBe(false);
  });

  it("refuses a production host that is a URL, not a host", async () => {
    for (const bad of [
      "https://www.example.com",
      "www.example.com/",
      "www.example.com:443",
      "localhost",
    ]) {
      const res = await run(await site(), ID, bad);
      expect(res.status).toBe("failed");
      expect(res.notes).toContain("not a bare hostname");
    }
  });

  it("refuses a site whose packages cannot run the hook, and says what to bump", async () => {
    const old = await run(await site({}, { "@reddoorla/maintenance": "^0.101.0" }));
    expect(old.status).toBe("failed");
    expect(old.notes).toContain("0.102.0");
    const kit = await run(
      await site({}, { "@reddoorla/maintenance": "^0.102.0", "@sveltejs/kit": "^2.9.0" }),
    );
    expect(kit.status).toBe("failed");
    expect(kit.notes).toContain("2.10.0");
    const unreadable = await run(await site({}, { "@reddoorla/maintenance": "workspace:*" }));
    expect(unreadable.status).toBe("failed");
    expect(unreadable.notes).toContain("not one this recipe can read");
    expect(rangeFloor("^0.102.3")).toEqual([0, 102, 3]);
    expect(rangeFloor(">=1.2")).toEqual([1, 2, 0]);
  });

  it("never falls back to `pnpm exec prettier`, with the REAL resolver", async () => {
    // _prettier.ts documents the hazard. The recipe commits with `git add -A`.
    const cwd = await site();
    const { spawn, calls } = recordingSpawn();
    const res = await analyticsTag(
      { path: cwd },
      { measurementId: ID, productionHost: HOST },
      { spawn },
    );
    expect(res.status).toBe("applied");
    expect(calls).toEqual([]);
    expect(res.notes).toContain(PRETTIER_FLAG_NOTE);
  });

  it("runs the site's own prettier by absolute path, under a timeout, with the REAL resolver", async () => {
    const cwd = await site({ "node_modules/.bin/prettier": "#!/bin/sh\nexit 0\n" }, undefined, [
      "node_modules/.bin/prettier",
    ]);
    const { spawn, calls } = recordingSpawn();
    await analyticsTag({ path: cwd }, { measurementId: ID, productionHost: HOST }, { spawn });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.cmd).toBe(join(cwd, "node_modules/.bin/prettier"));
    expect(calls[0]?.args).toEqual(["--write", HOOKS_CLIENT_RELATIVE]);
    expect(calls[0]?.opts?.timeoutMs).toBe(60_000);
  });

  it("puts back a hook the site's .gitignore would keep out of the commit (#741)", async () => {
    const cwd = await site({ ".gitignore": "node_modules\nsrc/hooks.client.ts\n" });
    const res = await run(cwd);
    expect(res.status).toBe("failed");
    expect(res.notes).toContain(RESTORED_NOTE);
    expect(await exists(join(cwd, HOOKS_CLIENT_RELATIVE))).toBe(false);
  });

  it("turns the analytics hosts on for a createSvelteConfig csp, in the same commit", async () => {
    const cwd = await site({
      "svelte.config.js":
        'import { createSvelteConfig } from "@reddoorla/maintenance/configs/svelte";\n\nexport default createSvelteConfig({ csp: true });\n',
    });
    const res = await run(cwd);
    expect(res.status).toBe("applied");
    expect(await readFile(join(cwd, "svelte.config.js"), "utf8")).toContain(
      "createSvelteConfig({ csp: { analytics: true } })",
    );
    expect(headFiles(cwd)).toEqual([HOOKS_CLIENT_RELATIVE, "svelte.config.js"].sort());
    expect(res.notes).toContain("analytics hosts enabled");
  });

  it("formats the edited svelte.config.js too, with the site's own prettier", async () => {
    const cwd = await site(
      {
        "svelte.config.js":
          'import { createSvelteConfig } from "@reddoorla/maintenance/configs/svelte";\n\nexport default createSvelteConfig({ csp: true });\n',
        "node_modules/.bin/prettier": "#!/bin/sh\nexit 0\n",
      },
      undefined,
      ["node_modules/.bin/prettier"],
    );
    const { spawn, calls } = recordingSpawn();
    const res = await analyticsTag(
      { path: cwd },
      { measurementId: ID, productionHost: HOST },
      { spawn },
    );
    expect(res.status).toBe("applied");
    expect(calls[0]?.args).toEqual(["--write", HOOKS_CLIENT_RELATIVE, "svelte.config.js"]);
  });

  it("leaves a native kit.csp alone and gives every host to add by hand", async () => {
    const config =
      'import adapter from "@sveltejs/adapter-netlify";\n\nexport default {\n  kit: { adapter: adapter(), csp: { mode: "auto", directives: { "script-src": ["self"] } } },\n};\n';
    const cwd = await site({ "svelte.config.js": config });
    const res = await run(cwd);
    expect(res.status).toBe("applied");
    expect(await readFile(join(cwd, "svelte.config.js"), "utf8")).toBe(config);
    expect(headFiles(cwd)).toEqual([HOOKS_CLIENT_RELATIVE]);
    expect(res.notes).toContain("CSP NOT CHANGED");
    expect(res.notes).toContain("The browser refuses the loader");
    expect(res.notes).toContain(HAND_ADD_HOSTS);
  });

  it("on roalson's shape (a regex before kit.csp) still gives the hosts, and only says 'if'", async () => {
    const config = `const re = /^\\/properties\\/([^/]+)\\/?$/;\nexport default {\n  kit: { csp: { mode: "auto", directives: { "script-src": ["self"] } } },\n};\n`;
    const res = await run(await site({ "svelte.config.js": config }));
    expect(res.status).toBe("applied");
    expect(res.notes).toContain(HAND_ADD_HOSTS);
    expect(res.notes).toContain("If svelte.config.js sets a Content-Security-Policy");
    expect(res.notes).toContain("`analytics: true`");
  });

  it("does not say a site with no CSP refuses the loader, regex or not", async () => {
    const res = await run(
      await site({ "svelte.config.js": "const re = /x/g;\nexport default { kit: {} };\n" }),
    );
    expect(res.status).toBe("applied");
    expect(res.notes).not.toContain("refuses the loader until");
    expect(res.notes).toContain("no `csp` option in svelte.config.js");
    expect(res.notes).toContain(HAND_ADD_HOSTS);
  });
});

describe("reddoor-maint analytics-tag", () => {
  it("applies on the happy path and exits 0", async () => {
    const cwd = await site();
    const out = await runAnalyticsTagCommand(cwd, { measurementId: ID, productionHost: HOST });
    expect(out.code).toBe(0);
    expect(out.output).toContain("applied: 1 commit(s)");
    expect(await exists(join(cwd, HOOKS_CLIENT_RELATIVE))).toBe(true);
  });

  it("exits 1 on a refusal", async () => {
    const cwd = await site({
      "src/app.html":
        '<script async src="https://www.googletagmanager.com/gtag/js?id=G-X"></script>',
    });
    const out = await runAnalyticsTagCommand(cwd, { measurementId: ID, productionHost: HOST });
    expect(out.code).toBe(1);
    expect(out.output).toContain("failed:");
  });

  it("requires --production-host, because a checkout path carries no deployed URL", async () => {
    const cwd = await site();
    const out = await runAnalyticsTagCommand(cwd, { measurementId: ID });
    expect(out.code).toBe(2);
    expect(out.output).toContain("--production-host");
    expect(out.output).not.toContain("site row");
    expect(await exists(join(cwd, HOOKS_CLIENT_RELATIVE))).toBe(false);
  });

  it("refuses a URL as --production-host with exit 2", async () => {
    const cwd = await site();
    const out = await runAnalyticsTagCommand(cwd, {
      measurementId: ID,
      productionHost: "https://www.example.com",
    });
    expect(out.code).toBe(2);
    expect(out.output).toContain("bare hostname");
    expect(await exists(join(cwd, HOOKS_CLIENT_RELATIVE))).toBe(false);
  });

  it("the hook it writes names the audit command that actually exists", () => {
    const hook = hooksClientTemplate({ measurementId: ID, productionHost: HOST });
    // `audit analytics` reads "analytics" as a site path, and a bare-checkout
    // audit has no row to pair with, so the hook names the roster form.
    expect(hook.replace(/\s*\n\s*\*\s*/g, " ")).toContain(
      "reddoor-maint audit --fleet turso --only analytics",
    );
    expect(hook).not.toContain("reddoor-maint audit analytics");
  });
});
