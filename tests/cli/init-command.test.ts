import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const binPath = resolve(here, "../../dist/cli/bin.js");

describe("cli: init", () => {
  beforeAll(() => {
    if (!existsSync(binPath)) throw new Error("run `pnpm build` first");
  });

  it("--help shows the init usage line and core options", () => {
    const out = execFileSync(process.execPath, [binPath, "init", "--help"], { encoding: "utf-8" });
    expect(out).toMatch(/init\s+\[site\]/);
    expect(out).toMatch(/--fleet/);
    expect(out).toMatch(/--workdir/);
  });

  it("list-recipes describes init's chained sequence + a11y-fixtures-page", () => {
    const out = execFileSync(process.execPath, [binPath, "list-recipes"], { encoding: "utf-8" });
    expect(out).toMatch(/^init\s/m);
    expect(out).toMatch(/convert-to-pnpm/);
    expect(out).toMatch(/a11y-fixtures-page/);
    expect(out).toMatch(/^a11y-fixtures-page\s/m);
  });
});
