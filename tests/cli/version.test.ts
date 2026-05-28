import { describe, it, expect } from "vitest";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolvePackageVersion } from "../../src/cli/version.js";

describe("cli/resolvePackageVersion", () => {
  it("reads the version from the nearest matching package.json", async () => {
    const root = await mkdtemp(join(tmpdir(), "reddoor-vers-"));
    await mkdir(join(root, "dist", "cli"), { recursive: true });
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({ name: "@reddoorla/maintenance", version: "9.9.9-test" }),
      "utf-8",
    );
    expect(resolvePackageVersion(join(root, "dist", "cli"))).toBe("9.9.9-test");
  });

  // Regression for the silent-drift bug class found 2026-05-27 (same shape as
  // the bundled-assets ENOENT). The walk-up MUST keep going past unrelated
  // package.jsons that happen to sit above the bundle — e.g. an ancestor
  // workspace root, anything in node_modules.
  it("walks past unrelated package.jsons looking for ours by name", async () => {
    const root = await mkdtemp(join(tmpdir(), "reddoor-vers-skip-"));
    await mkdir(join(root, "node_modules", "@reddoorla", "maintenance", "dist", "cli"), {
      recursive: true,
    });
    // Wrong-name package.json at the workspace root — should be skipped.
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({ name: "consumer-site", version: "1.2.3" }),
      "utf-8",
    );
    // Our actual package.json deeper in node_modules.
    await writeFile(
      join(root, "node_modules", "@reddoorla", "maintenance", "package.json"),
      JSON.stringify({ name: "@reddoorla/maintenance", version: "0.10.4" }),
      "utf-8",
    );
    const result = resolvePackageVersion(
      join(root, "node_modules", "@reddoorla", "maintenance", "dist", "cli"),
    );
    expect(result).toBe("0.10.4");
  });

  it("returns 'unknown' when no matching package.json is reachable (Yarn PnP and similar)", async () => {
    const orphan = "/tmp/reddoor-orphan-dir-that-does-not-exist/dist/cli";
    expect(resolvePackageVersion(orphan)).toBe("unknown");
  });

  it("returns 'unknown' when our package.json is unparseable", async () => {
    const root = await mkdtemp(join(tmpdir(), "reddoor-vers-bad-"));
    await mkdir(join(root, "dist", "cli"), { recursive: true });
    await writeFile(join(root, "package.json"), "{not json", "utf-8");
    expect(resolvePackageVersion(join(root, "dist", "cli"))).toBe("unknown");
  });
});
