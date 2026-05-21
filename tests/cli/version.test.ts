import { describe, it, expect } from "vitest";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolvePackageVersion } from "../../src/cli/version.js";

describe("cli/resolvePackageVersion", () => {
  it("reads the version from the package.json two levels up", async () => {
    const root = await mkdtemp(join(tmpdir(), "reddoor-vers-"));
    await mkdir(join(root, "dist", "cli"), { recursive: true });
    await writeFile(join(root, "package.json"), JSON.stringify({ version: "9.9.9-test" }), "utf-8");
    expect(resolvePackageVersion(join(root, "dist", "cli"))).toBe("9.9.9-test");
  });

  it("returns 'unknown' when no package.json is reachable (Yarn PnP and similar)", async () => {
    // Pointing at /tmp/some-nonexistent-path-that-cannot-have-a-pkg-json. There
    // is no package.json two levels up so the read must fail without throwing.
    const orphan = "/tmp/reddoor-orphan-dir-that-does-not-exist/dist/cli";
    expect(resolvePackageVersion(orphan)).toBe("unknown");
  });

  it("returns 'unknown' when package.json is unparseable", async () => {
    const root = await mkdtemp(join(tmpdir(), "reddoor-vers-bad-"));
    await mkdir(join(root, "dist", "cli"), { recursive: true });
    await writeFile(join(root, "package.json"), "{not json", "utf-8");
    expect(resolvePackageVersion(join(root, "dist", "cli"))).toBe("unknown");
  });
});
