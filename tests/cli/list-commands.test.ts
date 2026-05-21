import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const binPath = resolve(here, "../../dist/cli/bin.js");

function runCli(args: string[]): string {
  return execFileSync(process.execPath, [binPath, ...args], {
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

describe("cli: list commands", () => {
  beforeAll(() => {
    if (!existsSync(binPath)) {
      throw new Error(`dist/cli/bin.js missing — run \`pnpm build\` before running CLI tests.`);
    }
  });

  it("list-audits prints all v1 audit names", () => {
    const out = runCli(["list-audits"]);
    for (const name of ["deps", "lighthouse", "a11y", "security", "lint"]) {
      expect(out).toContain(name);
    }
  });

  it("list-recipes prints all v1 recipe names", () => {
    const out = runCli(["list-recipes"]);
    for (const name of [
      "sync-configs",
      "bump-deps",
      "svelte-4-to-5",
      "convert-to-pnpm",
      "onboard",
    ]) {
      expect(out).toContain(name);
    }
  });

  it("--help exits 0 and mentions reddoor-maint", () => {
    const out = runCli(["--help"]);
    expect(out).toMatch(/reddoor-maint/);
  });
});
