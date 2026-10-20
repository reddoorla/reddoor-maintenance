// OD 97(c): `src/webflow` and its `reddoor-maint webflow` subcommand were
// removed. The 10-19 conversions did not use it, and `scripts/webflow-capture`
// (a standalone script, kept) is the capture path now. This pins the removal
// at the CLI's surface: the word `webflow` must reach the unknown-command
// handler, not a stale registration whose lazy import no longer resolves.
//
// Spawned from SOURCE (tsx), as prospect-audit-registration.test.ts does, so
// it answers the live question rather than the last build's.
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../..");

function runCli(args: string[]): { out: string; code: number } {
  try {
    const out = execFileSync(
      join(repoRoot, "node_modules/.bin/tsx"),
      [join(repoRoot, "src/cli/bin.ts"), ...args],
      { stdio: ["ignore", "pipe", "pipe"] },
    ).toString();
    return { out, code: 0 };
  } catch (e) {
    const err = e as { stdout?: Buffer; stderr?: Buffer; status?: number };
    return {
      out: `${err.stdout?.toString() ?? ""}${err.stderr?.toString() ?? ""}`,
      code: err.status ?? 1,
    };
  }
}

describe("the webflow subcommand is removed", () => {
  it("`reddoor-maint webflow capture` is an unknown command", () => {
    const res = runCli(["webflow", "capture", "https://example.invalid"]);
    expect(res.code).toBe(1);
    expect(res.out).toContain("error: unknown command 'webflow'");
  });

  it("the module and its command file are gone", () => {
    expect(existsSync(join(repoRoot, "src/webflow"))).toBe(false);
    expect(existsSync(join(repoRoot, "src/cli/commands/webflow.ts"))).toBe(false);
  });
});
