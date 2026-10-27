import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const binPath = resolve(here, "../../dist/cli/bin.js");

describe("cli: svelte-codemods", () => {
  beforeAll(() => {
    if (!existsSync(binPath)) throw new Error("run `pnpm build` first");
  });

  it("--help shows the svelte-codemods usage line", () => {
    const out = execFileSync(process.execPath, [binPath, "svelte-codemods", "--help"], {
      encoding: "utf-8",
    });
    expect(out).toMatch(/svelte-codemods\s+\[site\]/);
    expect(out).toMatch(/--fleet/);
  });

  it("appears in list-recipes output", () => {
    const out = execFileSync(process.execPath, [binPath, "list-recipes"], { encoding: "utf-8" });
    expect(out).toMatch(/svelte-codemods/);
  });
});
