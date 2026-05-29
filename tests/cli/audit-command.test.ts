import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const binPath = resolve(here, "../../dist/cli/bin.js");
const fixtures = resolve(here, "../fixtures");

function runCli(
  args: string[],
  opts: { allowNonZero?: boolean } = {},
): {
  stdout: string;
  status: number;
} {
  try {
    const stdout = execFileSync(process.execPath, [binPath, ...args], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { stdout, status: 0 };
  } catch (err) {
    const e = err as { status?: number; stdout?: Buffer | string };
    if (!opts.allowNonZero) throw err;
    return {
      stdout: e.stdout?.toString() ?? "",
      status: e.status ?? -1,
    };
  }
}

describe("cli: audit command", () => {
  beforeAll(() => {
    if (!existsSync(binPath)) throw new Error("run `pnpm build` first");
  });

  it("--only deps --json against pristine fixture returns pass with exit 0", () => {
    const { stdout, status } = runCli([
      "audit",
      resolve(fixtures, "pristine-starter"),
      "--only",
      "deps",
      "--json",
    ]);
    expect(status).toBe(0);
    const parsed = JSON.parse(stdout) as Array<{ audit: string; status: string }>;
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.audit).toBe("deps");
    expect(parsed[0]?.status).toBe("pass");
  });

  it("--only deps --json against pre-svelte5 fixture exits 1", () => {
    const { stdout, status } = runCli(
      ["audit", resolve(fixtures, "pre-svelte5"), "--only", "deps", "--json"],
      { allowNonZero: true },
    );
    expect(status).toBe(1);
    const parsed = JSON.parse(stdout);
    expect(parsed[0].status).toBe("fail");
  });

  it("unknown --only value exits 2", () => {
    const { status } = runCli(
      ["audit", resolve(fixtures, "pristine-starter"), "--only", "totally-fake"],
      { allowNonZero: true },
    );
    expect(status).toBe(2);
  });

  it("--write-airtable combined with --fleet exits 2 before running any audits", () => {
    // Fleet pools AuditResult[] across sites and the cwd-derived slug would
    // silently overwrite one site's dashboard with another's results.
    // Refuse fast so the operator doesn't burn fleet audit time discovering it.
    const { stdout, status } = runCli(
      [
        "audit",
        "--fleet",
        resolve(fixtures, "pristine-starter") + "/inventory.json",
        "--write-airtable",
      ],
      { allowNonZero: true },
    );
    expect(status).toBe(2);
    // Error goes to stderr; stdout should be clean of audit output (no spinners,
    // no result table) because we threw before any audit ran.
    expect(stdout).not.toMatch(/[✔❯] (deps|lighthouse|a11y|security|lint)/);
  });

  it("table output prints one line per audit when --json is omitted", () => {
    const { stdout, status } = runCli([
      "audit",
      resolve(fixtures, "pristine-starter"),
      "--only",
      "deps",
    ]);
    expect(status).toBe(0);
    expect(stdout).toMatch(/deps/);
    expect(stdout).toMatch(/pass/);
  });

  it("emits listr2 progress markers alongside the result table in non-TTY mode", () => {
    // Regression guard for the listr2 spinner integration: in a non-TTY
    // context (execFileSync), listr2's simple renderer prints `❯ deps`
    // when the task starts and `✔ deps: ... (Nms)` when it completes.
    // We assert both a progress marker AND the table line are present.
    const { stdout, status } = runCli([
      "audit",
      resolve(fixtures, "pristine-starter"),
      "--only",
      "deps",
    ]);
    expect(status).toBe(0);
    expect(stdout).toMatch(/[✔❯] deps/);
    expect(stdout).toMatch(/deps\s+pass\s+pristine-starter/);
  });
});
