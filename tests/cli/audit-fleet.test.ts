import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const binPath = resolve(here, "../../dist/cli/bin.js");
const pristine = resolve(here, "../fixtures/pristine-starter");
const preSvelte5 = resolve(here, "../fixtures/pre-svelte5");

describe("cli: audit --fleet", () => {
  beforeAll(() => {
    if (!existsSync(binPath)) throw new Error("run `pnpm build` first");
  });

  it("runs audits across two sites from a JSON inventory and aggregates output", async () => {
    const dir = await mkdtemp(join(tmpdir(), "reddoor-fleet-"));
    const invPath = join(dir, "inv.json");
    await writeFile(
      invPath,
      JSON.stringify([
        { name: "alpha", path: pristine },
        { name: "beta", path: preSvelte5 },
      ]),
      "utf-8",
    );

    let stdout: string;
    let status = 0;
    try {
      stdout = execFileSync(
        process.execPath,
        [binPath, "audit", "--fleet", invPath, "--only", "deps", "--json"],
        { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] },
      );
    } catch (err) {
      const e = err as { status?: number; stdout?: Buffer | string };
      stdout = e.stdout?.toString() ?? "";
      status = e.status ?? -1;
    }
    expect(status).toBe(1);
    const parsed = JSON.parse(stdout) as Array<{ site: string; status: string }>;
    expect(parsed).toHaveLength(2);
    const alpha = parsed.find((r) => r.site === "alpha");
    const beta = parsed.find((r) => r.site === "beta");
    expect(alpha?.status).toBe("pass");
    expect(beta?.status).toBe("fail");
  });

  it("rejects [site] + --fleet together with exit 2", () => {
    let status = 0;
    try {
      execFileSync(
        process.execPath,
        [binPath, "audit", pristine, "--fleet", "/tmp/whatever.json"],
        { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] },
      );
    } catch (err) {
      status = (err as { status?: number }).status ?? -1;
    }
    expect(status).toBe(2);
  });
});
