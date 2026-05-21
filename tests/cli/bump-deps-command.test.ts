import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const binPath = resolve(here, "../../dist/cli/bin.js");

describe("cli: bump-deps", () => {
  beforeAll(() => {
    if (!existsSync(binPath)) throw new Error("run `pnpm build` first");
  });

  it("--help shows --group flag", () => {
    const out = execFileSync(process.execPath, [binPath, "bump-deps", "--help"], {
      encoding: "utf-8",
    });
    expect(out).toMatch(/--group/);
  });

  it("invalid --group exits 2", () => {
    let status = 0;
    try {
      execFileSync(process.execPath, [binPath, "bump-deps", "--group", "bogus"], {
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (err) {
      status = (err as { status?: number }).status ?? -1;
    }
    expect(status).toBe(2);
  });
});
