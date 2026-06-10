import { describe, it, expect } from "vitest";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve, dirname, join } from "node:path";
import { syncConfigs } from "../../src/recipes/sync-configs.js";
import { templatesByName } from "../../src/recipes/sync-configs/templates.js";
import { copyFixtureToTmp } from "./_helpers/site-tmpdir.js";

function gitListFiles(cwd: string): string[] {
  return execFileSync("git", ["ls-files"], { cwd, encoding: "utf-8" })
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

async function writeCommitted(cwd: string, relPath: string, contents: string): Promise<void> {
  const full = join(cwd, relPath);
  const dir = dirname(full);
  if (dir !== cwd) await mkdir(dir, { recursive: true });
  await writeFile(full, contents, "utf-8");
  execFileSync("git", ["add", "-A"], { cwd, stdio: "ignore" });
  execFileSync("git", ["commit", "-m", `add ${relPath}`], { cwd, stdio: "ignore" });
}

const here = dirname(fileURLToPath(import.meta.url));
const clean = resolve(here, "../fixtures/sync-clean");
const drift = resolve(here, "../fixtures/sync-drift");

describe("recipes/sync-configs", () => {
  it("returns noop when every template already matches", async () => {
    const cwd = await copyFixtureToTmp(clean);
    const result = await syncConfigs({ path: cwd });
    expect(result.status).toBe("noop");
    expect(result.commits).toHaveLength(0);
  });

  it("applies templates that differ and commits one per config", async () => {
    const cwd = await copyFixtureToTmp(drift);
    const result = await syncConfigs({ path: cwd });
    expect(result.status).toBe("applied");
    expect(result.commits.length).toBeGreaterThan(0);

    const eslintCfg = await readFile(join(cwd, "eslint.config.js"), "utf-8");
    expect(eslintCfg).toContain("@reddoorla/maintenance/configs/eslint");

    const branch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd,
      encoding: "utf-8",
    }).trim();
    expect(branch).toMatch(/^maint\/sync-configs-\d{8}T\d{9}Z$/);
  });

  it("running twice on drift leaves the second run as a noop", async () => {
    const cwd = await copyFixtureToTmp(drift);
    const first = await syncConfigs({ path: cwd });
    expect(first.status).toBe("applied");
    const second = await syncConfigs({ path: cwd });
    expect(second.status).toBe("noop");
    expect(second.commits).toHaveLength(0);
  });

  it("respects opts.which", async () => {
    const cwd = await copyFixtureToTmp(drift);
    const result = await syncConfigs({ path: cwd }, { which: ["prettier"] });
    expect(result.status).toBe("applied");
    expect(result.commits).toHaveLength(1);
    const eslintCfg = await readFile(join(cwd, "eslint.config.js"), "utf-8");
    expect(eslintCfg).not.toContain("@reddoorla/maintenance/configs/eslint");
  });

  it("refuses to run when the working tree is dirty", async () => {
    const cwd = await copyFixtureToTmp(drift);
    execFileSync("touch", ["dirty.txt"], { cwd });
    await expect(syncConfigs({ path: cwd })).rejects.toThrow(/working tree/i);
  });

  it("leaves a compliant svelte.config untouched, preserving custom aliases", async () => {
    // A site on the canonical pattern (createSvelteConfig + adapter-netlify) may add
    // its own kit.alias. Exact-match sync would clobber those every run; compliance
    // checking preserves them. Regression for the MSOT $utils alias loss (2026-06-04).
    const cwd = await copyFixtureToTmp(drift);
    const compliant = `import { createSvelteConfig } from "@reddoorla/maintenance/configs/svelte";
import adapter from "@sveltejs/adapter-netlify";

export default createSvelteConfig({
  kit: {
    adapter: adapter({ edge: false, split: false }),
    alias: { $utils: "src/lib/utils" },
  },
});
`;
    await writeCommitted(cwd, "svelte.config.js", compliant);

    const result = await syncConfigs({ path: cwd }, { which: ["svelte"] });
    expect(result.status).toBe("noop");

    const after = await readFile(join(cwd, "svelte.config.js"), "utf-8");
    expect(after).toBe(compliant);
    expect(after).toContain("$utils");
  });

  it("overwrites a non-compliant svelte.config with the canonical template", async () => {
    // sync-drift ships `export default { kit: {} }` — no createSvelteConfig, no
    // adapter-netlify — so it's off-pattern and must be brought to canonical.
    const cwd = await copyFixtureToTmp(drift);
    const result = await syncConfigs({ path: cwd }, { which: ["svelte"] });
    expect(result.status).toBe("applied");
    expect(result.commits).toHaveLength(1);

    const after = await readFile(join(cwd, "svelte.config.js"), "utf-8");
    expect(after).toContain("createSvelteConfig");
    expect(after).toContain("@sveltejs/adapter-netlify");
  });

  it("ships security headers in the canonical netlify template", () => {
    // Regression guard: the template once shipped header-less and a sync STRIPPED
    // live sites' security headers (gallerysonder, 2026-06-10). Never again.
    const [netlify] = templatesByName(["netlify"]);
    for (const header of [
      "Strict-Transport-Security",
      "X-Content-Type-Options",
      "X-Frame-Options",
      "Referrer-Policy",
      "Permissions-Policy",
      "Cross-Origin-Opener-Policy",
    ]) {
      expect(netlify?.contents).toContain(header);
    }
  });

  it("leaves a netlify.toml that already has [[headers]] untouched (preserves custom security config)", async () => {
    // A hardened netlify.toml (e.g. a site-specific CSP) must survive sync — an
    // exact overwrite would strip it. Regression for the gallerysonder header
    // loss (2026-06-10): compliance check, not exact-match, like svelte.config.
    const cwd = await copyFixtureToTmp(drift);
    const custom = `[build]
    command = "pnpm run build"
    publish = "build/"

[[headers]]
    for = "/*"
    [headers.values]
        Content-Security-Policy = "frame-ancestors 'self' https://example.com"
        Strict-Transport-Security = "max-age=63072000; includeSubDomains; preload"
`;
    await writeCommitted(cwd, "netlify.toml", custom);

    const result = await syncConfigs({ path: cwd }, { which: ["netlify"] });
    expect(result.status).toBe("noop");

    const after = await readFile(join(cwd, "netlify.toml"), "utf-8");
    expect(after).toBe(custom);
    expect(after).toContain("frame-ancestors");
  });

  it("backfills the security headers onto a header-less netlify.toml (the stripped state)", async () => {
    // The old template shipped no headers, so a prior sync left sites stripped.
    // A header-less file is non-compliant → it gets the upgraded template back.
    const cwd = await copyFixtureToTmp(drift);
    const stripped = `[build]
    command = "pnpm build"
    publish = "build/"
    functions = "functions/"

[build.environment]
    NODE_VERSION = "22"
    COREPACK_INTEGRITY_KEYS = "0"
`;
    await writeCommitted(cwd, "netlify.toml", stripped);

    const result = await syncConfigs({ path: cwd }, { which: ["netlify"] });
    expect(result.status).toBe("applied");

    const after = await readFile(join(cwd, "netlify.toml"), "utf-8");
    expect(after).toContain("[[headers]]");
    expect(after).toContain("Strict-Transport-Security");
    expect(after).toContain("X-Frame-Options");
  });

  it("backfills security headers onto a netlify.toml whose only [[headers]] block is non-security (cache-only)", async () => {
    // "Compliant" must mean "has a security baseline", not merely "has a
    // [[headers]] block" — a cache-control-only file (a common hand-addition)
    // is NOT hardened and must still receive HSTS/X-Frame-Options/etc.
    const cwd = await copyFixtureToTmp(drift);
    const cacheOnly = `[build]
    command = "pnpm build"
    publish = "build/"

[[headers]]
    for = "/_app/immutable/*"
    [headers.values]
        Cache-Control = "public, max-age=31536000, immutable"
`;
    await writeCommitted(cwd, "netlify.toml", cacheOnly);

    const result = await syncConfigs({ path: cwd }, { which: ["netlify"] });
    expect(result.status).toBe("applied");

    const after = await readFile(join(cwd, "netlify.toml"), "utf-8");
    expect(after).toContain("Strict-Transport-Security");
    expect(after).toContain("X-Frame-Options");
  });
});

describe("recipes/sync-configs gitignore handling", () => {
  it("creates .gitignore from canonical when none exists", async () => {
    const cwd = await copyFixtureToTmp(drift);
    expect(gitListFiles(cwd)).not.toContain(".gitignore");

    await syncConfigs({ path: cwd });

    const content = await readFile(join(cwd, ".gitignore"), "utf-8");
    expect(content).toContain("node_modules/");
    expect(content).toContain(".svelte-kit/");
    expect(content).toContain("build/");
    expect(content).toContain("# canonical entries from @reddoorla/maintenance");
  });

  it("merges missing canonical entries into existing .gitignore, preserving site lines", async () => {
    const cwd = await copyFixtureToTmp(drift);
    await writeCommitted(cwd, ".gitignore", "node_modules\n\n# site-specific\nmy-custom-dir/\n");

    await syncConfigs({ path: cwd });

    const content = await readFile(join(cwd, ".gitignore"), "utf-8");
    expect(content).toContain("my-custom-dir/");
    expect(content).toContain("# site-specific");
    expect(content).toContain(".svelte-kit/");
    expect(content).toContain("build/");
    // existing node_modules entry preserved (no trailing slash style) — not duplicated
    expect(content.match(/^node_modules$/gm)?.length).toBe(1);
    expect(content).not.toMatch(/^node_modules\/$/m);
  });

  it("untracks tracked build artifacts as part of the gitignore commit", async () => {
    const cwd = await copyFixtureToTmp(drift);
    await writeCommitted(cwd, "build/index.html", "<html></html>");
    await writeCommitted(cwd, ".svelte-kit/generated/whatever.ts", "// stale");
    expect(gitListFiles(cwd)).toContain("build/index.html");
    expect(gitListFiles(cwd)).toContain(".svelte-kit/generated/whatever.ts");

    const result = await syncConfigs({ path: cwd }, { which: ["gitignore"] });
    expect(result.status).toBe("applied");
    expect(result.commits).toHaveLength(1);

    const tracked = gitListFiles(cwd);
    expect(tracked).not.toContain("build/index.html");
    expect(tracked).not.toContain(".svelte-kit/generated/whatever.ts");
    expect(tracked).toContain(".gitignore");
  });

  it("opts.which=['gitignore'] touches only .gitignore", async () => {
    const cwd = await copyFixtureToTmp(drift);
    const result = await syncConfigs({ path: cwd }, { which: ["gitignore"] });

    expect(result.status).toBe("applied");
    expect(result.commits).toHaveLength(1);

    const eslintCfg = await readFile(join(cwd, "eslint.config.js"), "utf-8");
    expect(eslintCfg).not.toContain("@reddoorla/maintenance/configs/eslint");
  });

  it("re-running gitignore sync against its own output is a noop", async () => {
    const cwd = await copyFixtureToTmp(drift);
    const first = await syncConfigs({ path: cwd }, { which: ["gitignore"] });
    expect(first.status).toBe("applied");
    const second = await syncConfigs({ path: cwd }, { which: ["gitignore"] });
    expect(second.status).toBe("noop");
    expect(second.commits).toHaveLength(0);
  });
});
