import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const binPath = resolve(here, "../../dist/cli/bin.js");

describe("cli: convert-to-pnpm", () => {
  beforeAll(() => {
    if (!existsSync(binPath)) throw new Error("run `pnpm build` first");
  });

  it("--help mentions --fleet", () => {
    const out = execFileSync(process.execPath, [binPath, "convert-to-pnpm", "--help"], {
      encoding: "utf-8",
    });
    expect(out).toMatch(/--fleet/);
    expect(out).toMatch(/pnpm/i);
  });

  it("appears in the top-level --help output", () => {
    const out = execFileSync(process.execPath, [binPath, "--help"], { encoding: "utf-8" });
    expect(out).toMatch(/convert-to-pnpm/);
  });
});
