import { describe, it, expect } from "vitest";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve, join } from "node:path";
import { readFileSync } from "node:fs";
import { selfPackageVersion, selfCaretRange } from "../../src/util/self-version.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoPkg = JSON.parse(readFileSync(resolve(here, "../../package.json"), "utf-8")) as {
  version: string;
};

describe("util/self-version unit", () => {
  it("returns the real package version when called with this file's URL (src walk-up)", () => {
    expect(selfPackageVersion(import.meta.url)).toBe(repoPkg.version);
  });

  it("selfCaretRange wraps the version with a leading caret", () => {
    expect(selfCaretRange(import.meta.url)).toBe(`^${repoPkg.version}`);
  });

  it("walks past unrelated package.jsons looking for ours by name", async () => {
    const root = await mkdtemp(join(tmpdir(), "reddoor-selfver-skip-"));
    await mkdir(join(root, "node_modules", "@reddoorla", "maintenance", "dist"), {
      recursive: true,
    });
    // Wrong-name ancestor package.json (e.g. consumer's own).
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({ name: "consumer-site", version: "1.2.3" }),
    );
    // Our actual package.json deeper in node_modules.
    await writeFile(
      join(root, "node_modules", "@reddoorla", "maintenance", "package.json"),
      JSON.stringify({ name: "@reddoorla/maintenance", version: "0.10.4-test" }),
    );
    // Pretend a bundled module from inside our installed copy is calling us.
    const fakeCallerUrl = pathToFileURL(
      join(root, "node_modules", "@reddoorla", "maintenance", "dist", "fake.js"),
    ).toString();
    expect(selfPackageVersion(fakeCallerUrl)).toBe("0.10.4-test");
  });

  it("returns '0.0.0' when no matching package.json is reachable", () => {
    const fakeUrl = pathToFileURL("/tmp/reddoor-orphan-does-not-exist/dist/fake.js").toString();
    expect(selfPackageVersion(fakeUrl)).toBe("0.0.0");
  });
});

// The dist-resolution regression (silent-drift bug class found 2026-05-27)
// lives in scripts/smoke-dist.mjs and runs via `pnpm test:dist` after
// `pnpm build`. Keeping it out of vitest avoids an implicit "build first"
// dependency on `pnpm test` and gives the release gate a single home.
