import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { copyFixtureToTmp } from "../recipes/_helpers/site-tmpdir.js";

const here = dirname(fileURLToPath(import.meta.url));
const binPath = resolve(here, "../../dist/cli/bin.js");
const drift = resolve(here, "../fixtures/sync-drift");
const clean = resolve(here, "../fixtures/sync-clean");

function run(args: string[], cwd: string): string {
  return execFileSync(process.execPath, [binPath, ...args], {
    encoding: "utf-8",
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

describe("cli: sync-configs", () => {
  beforeAll(() => {
    if (!existsSync(binPath)) throw new Error("run `pnpm build` first");
  });

  it("applies templates on the drift fixture and exits 0", async () => {
    const cwd = await copyFixtureToTmp(drift);
    const out = run(["sync-configs"], cwd);
    expect(out).toMatch(/applied/);
    expect(out).toMatch(/sync-configs/);
  });

  it("--dry prints the planned diff without changing files", async () => {
    const cwd = await copyFixtureToTmp(drift);
    const out = run(["sync-configs", "--dry"], cwd);
    expect(out).toMatch(/would update/i);
    const branch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd,
      encoding: "utf-8",
    }).trim();
    expect(branch).toBe("main");
  });

  it("noop on clean fixture", async () => {
    const cwd = await copyFixtureToTmp(clean);
    const out = run(["sync-configs"], cwd);
    expect(out).toMatch(/noop/);
  });
});
