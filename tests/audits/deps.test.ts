import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { resolve, dirname, join } from "node:path";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { depsAudit } from "../../src/audits/deps.js";
import type { SpawnFn } from "../../src/audits/util/spawn.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = resolve(here, "../fixtures");

describe("audits/deps", () => {
  it("pristine-starter passes", async () => {
    const result = await depsAudit({
      site: { path: resolve(fixtures, "pristine-starter") },
    });
    expect(result.audit).toBe("deps");
    expect(result.status).toBe("pass");
    expect(result.summary).toMatch(/in line with baseline|no drift/i);
  });

  it("drifted-configs warns on bumped svelte/vite (ahead of baseline)", async () => {
    const result = await depsAudit({
      site: { path: resolve(fixtures, "drifted-configs") },
    });
    expect(result.status).toBe("warn");
    const { entries } = result.details as { entries: Array<{ pkg: string; drift: string }> };
    const svelte = entries.find((d) => d.pkg === "svelte");
    const vite = entries.find((d) => d.pkg === "vite");
    expect(svelte?.drift).toBe("newer");
    expect(vite?.drift).toBe("newer");
  });

  it("pre-svelte5 fails on major-version lag for svelte", async () => {
    const result = await depsAudit({
      site: { path: resolve(fixtures, "pre-svelte5") },
    });
    expect(result.status).toBe("fail");
    const { entries } = result.details as { entries: Array<{ pkg: string; drift: string }> };
    const svelte = entries.find((d) => d.pkg === "svelte");
    expect(svelte?.drift).toBe("major");
  });

  it("uses site.name in result when provided", async () => {
    const result = await depsAudit({
      site: { path: resolve(fixtures, "pristine-starter"), name: "labeled-site" },
    });
    expect(result.site).toBe("labeled-site");
  });

  it("falls back to site.path when site.name is missing", async () => {
    const result = await depsAudit({
      site: { path: resolve(fixtures, "pristine-starter") },
    });
    expect(result.site).toBe(resolve(fixtures, "pristine-starter"));
  });

  it("reports a real outdated-install count in details when a lockfile is present", async () => {
    const dir = await mkdtemp(join(tmpdir(), "reddoor-deps-"));
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({ dependencies: { svelte: "^5.55.10" } }),
      "utf-8",
    );
    await writeFile(join(dir, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n", "utf-8");
    const spawn: SpawnFn = async (_cmd, args) => {
      if (args[0] === "install") return { code: 0, stdout: "", stderr: "" };
      if (args[0] === "outdated") {
        return {
          code: 1, // outdated exits non-zero when there ARE outdated deps
          stdout: JSON.stringify({ vite: { current: "5.0.0", latest: "6.0.0" } }),
          stderr: "",
        };
      }
      throw new Error(`unexpected: ${args.join(" ")}`);
    };

    const result = await depsAudit({ site: { path: dir }, spawn });
    const { outdated } = result.details as { outdated: { outdated: number; major: number } | null };
    expect(outdated).toEqual({ outdated: 1, major: 1 });
    expect(result.summary).toMatch(/outdated/i);
  });

  it("leaves outdated null (and the summary unchanged) when there is no lockfile", async () => {
    const result = await depsAudit({ site: { path: resolve(fixtures, "pristine-starter") } });
    const { outdated } = result.details as { outdated: unknown };
    expect(outdated).toBeNull();
    expect(result.summary).not.toMatch(/outdated/i);
  });
});
