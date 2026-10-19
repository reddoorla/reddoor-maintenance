import { describe, it, expect, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { flagValue, isMain, proxyReexecEnv, realOrSelf, sleep } from "../../scripts/lib/cli.mjs";

const SCRIPTS = join(dirname(fileURLToPath(import.meta.url)), "../../scripts");
const LIB = join(SCRIPTS, "lib/cli.mjs");
const libUrl = pathToFileURL(LIB).href;
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

describe("isMain", () => {
  it("is true when argv[1] is the module itself, false otherwise", () => {
    expect(isMain(libUrl, LIB)).toBe(true);
    expect(isMain(libUrl, join(SCRIPTS, "land-prs.mjs"))).toBe(false);
    expect(isMain(libUrl, undefined)).toBe(false);
    expect(isMain(libUrl, "")).toBe(false);
  });

  it("sees through a symlink to the module (the reason realpath is there)", () => {
    const d = mkdtempSync(join(tmpdir(), "cli-lib-"));
    dirs.push(d);
    const link = join(d, "link.mjs");
    symlinkSync(LIB, link);
    expect(isMain(libUrl, link)).toBe(true);
  });

  it("falls back to the bare path when argv[1] does not exist", () => {
    expect(isMain(libUrl, "/no/such/file.mjs")).toBe(false);
    expect(realOrSelf("/no/such/file.mjs")).toBe("/no/such/file.mjs");
  });
});

describe("flagValue", () => {
  it("returns the value, and refuses a missing one or the next flag", () => {
    expect(flagValue("x", "--ref")).toBe("x");
    expect(flagValue("-1", "--ref")).toBe("-1");
    expect(() => flagValue(undefined, "--ref")).toThrow("--ref needs a value");
    expect(() => flagValue("--force", "--ref")).toThrow("--ref needs a value");
  });
});

describe("proxyReexecEnv", () => {
  it("re-execs only when a proxy is set and NODE_USE_ENV_PROXY is not already 1", () => {
    expect(proxyReexecEnv({})).toBeNull();
    expect(proxyReexecEnv({ HTTPS_PROXY: "http://p", NODE_USE_ENV_PROXY: "1" })).toBeNull();
    expect(proxyReexecEnv({ https_proxy: "http://p", PATH: "/bin" })).toEqual({
      https_proxy: "http://p",
      PATH: "/bin",
      NODE_USE_ENV_PROXY: "1",
    });
  });
});

describe("sleep", () => {
  it("resolves after the delay", async () => {
    const t = Date.now();
    await sleep(20);
    expect(Date.now() - t).toBeGreaterThanOrEqual(15);
  });
});

// Each script that imports the shared guard still runs as `node scripts/x.mjs` (or
// `pnpm tsx scripts/x.mts`). A bad argument makes each one exit before any IO, so the exit
// code and the script's own stderr prefix prove main() ran: if isMain were false, every one
// would exit 0 with no output.
describe("scripts that use the shared isMain still run main() when invoked directly", () => {
  const TSX = ["--import", "tsx"];
  const cases: Array<[string, string[], number, string]> = [
    ["land-prs.mjs", ["--frobnicate"], 2, "land-prs:"],
    ["nightly-conductor.mjs", ["--only"], 1, "nightly-conductor: Error: --only needs a value"],
    ["pm-cockpit.mts", ["--frobnicate"], 2, "pm-cockpit:"],
    ["refresh-disposable-domains.mts", ["--frobnicate"], 1, "refresh-disposable-domains:"],
  ];
  it.each(cases)("%s %j exits %i", (file, args, code, stderr) => {
    const pre = file.endsWith(".mts") ? TSX : [];
    const r = spawnSync(process.execPath, [...pre, join(SCRIPTS, file), ...args], {
      encoding: "utf-8",
      env: { PATH: process.env.PATH ?? "" },
    });
    expect(r.stderr).toContain(stderr);
    expect(r.status).toBe(code);
  });
});
