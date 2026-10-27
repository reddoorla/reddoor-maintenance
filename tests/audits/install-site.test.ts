import { describe, it, expect } from "vitest";
import { mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installSiteDeps } from "../../src/audits/util/install-site.js";
import { a11yAudit, A11Y_INSTALL_ENV } from "../../src/audits/a11y.js";
import type { SpawnFn } from "../../src/audits/util/spawn.js";

/** P1-78c: the weekly fleet-a11y sweep runs on fresh clones with no node_modules. */
function recorder(codes: Record<string, number> = {}) {
  const calls: string[] = [];
  const spawn: SpawnFn = async (cmd, args) => {
    const line = [cmd, ...args].join(" ");
    calls.push(line);
    return { code: codes[line] ?? 0, stdout: "", stderr: "" };
  };
  return { calls, spawn };
}

describe("installSiteDeps", () => {
  it("installs a fresh clone, frozen, then the site's own chromium", async () => {
    const dir = await mkdtemp(join(tmpdir(), "install-site-"));
    const r = recorder();
    expect(await installSiteDeps(dir, r.spawn, { browser: true })).toBeNull();
    expect(r.calls).toEqual([
      "pnpm install --frozen-lockfile",
      "pnpm exec playwright install chromium",
    ]);
  });

  it("leaves a checkout that has node_modules alone", async () => {
    const dir = await mkdtemp(join(tmpdir(), "install-site-"));
    await mkdir(join(dir, "node_modules"));
    const r = recorder();
    expect(await installSiteDeps(dir, r.spawn, { browser: false })).toBeNull();
    expect(r.calls).toEqual([]);
  });

  it("retries unfrozen once, then says why it cannot run", async () => {
    const dir = await mkdtemp(join(tmpdir(), "install-site-"));
    const r = recorder({ "pnpm install --frozen-lockfile": 1, "pnpm install": 1 });
    expect(await installSiteDeps(dir, r.spawn, { browser: true })).toBe(
      "pnpm install failed (exit 1) — deps unavailable",
    );
    expect(r.calls).toEqual(["pnpm install --frozen-lockfile", "pnpm install"]);
  });
});

describe("a11yAudit's opt-in install", () => {
  it("with REDDOOR_A11Y_INSTALL=1, a clone that will not install is a skip, never a scan", async () => {
    const dir = await mkdtemp(join(tmpdir(), "install-site-"));
    const r = recorder({ "pnpm install --frozen-lockfile": 1, "pnpm install": 1 });
    const before = process.env[A11Y_INSTALL_ENV];
    process.env[A11Y_INSTALL_ENV] = "1";
    try {
      const res = await a11yAudit({ site: { name: "s", path: dir }, spawn: r.spawn } as never);
      expect(res.status).toBe("skip");
      expect(res.summary).toBe("a11y: pnpm install failed (exit 1) — deps unavailable");
    } finally {
      if (before === undefined) delete process.env[A11Y_INSTALL_ENV];
      else process.env[A11Y_INSTALL_ENV] = before;
    }
  });
});
