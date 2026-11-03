import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

/**
 * A pnpm override of a package this repo also depends on directly must be written
 * `$<name>`, which takes its value from package.json, not as a literal version.
 *
 * The shared Renovate preset (`reddoorla/.github` `renovate-config.json`) disables
 * Renovate on `pnpm-workspace.overrides`, so Renovate bumps the package.json entry and
 * never the override. A literal override then outranks the bump without a word:
 * `vite: "8.2.4"` sat under package.json's `"vite": "8.3.5"` from #1721 (2026-10-26)
 * until #1894's lockfile resolved 8.3.5 against it and failed `--frozen-lockfile`
 * with "version 8.3.5 doesn't satisfy range 8.2.4".
 *
 * Selector keys (`tmp@<0.2.6`) pin transitive ranges and are left alone.
 */

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "../..");

type Pkg = Record<string, Record<string, string> | undefined>;

export function literalOverridesOfDirectDeps(
  overrides: Record<string, string>,
  pkg: Pkg,
): string[] {
  const direct = new Set(
    ["dependencies", "devDependencies", "optionalDependencies"].flatMap((k) =>
      Object.keys(pkg[k] ?? {}),
    ),
  );
  return Object.entries(overrides)
    .filter(([key]) => !/.@/.test(key) && direct.has(key))
    .filter(([key, value]) => value !== `$${key}`)
    .map(([key, value]) => `${key}: ${JSON.stringify(value)}`);
}

describe("pnpm-workspace overrides of direct dependencies", () => {
  it("track package.json with $<name>", () => {
    const ws = yaml.load(readFileSync(join(ROOT, "pnpm-workspace.yaml"), "utf8")) as {
      overrides?: Record<string, string>;
    };
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as Pkg;
    expect(literalOverridesOfDirectDeps(ws.overrides ?? {}, pkg)).toEqual([]);
  });

  it("flags a literal pin and spares selectors and transitive names", () => {
    const pkg = { devDependencies: { vite: "8.3.5", "google-auth-library": "^10.6.2" } };
    expect(
      literalOverridesOfDirectDeps(
        {
          vite: "8.2.4",
          "google-auth-library": "$google-auth-library",
          "tmp@<0.2.6": ">=0.2.6",
          "@scope/pkg": "1.0.0",
        },
        pkg,
      ),
    ).toEqual(['vite: "8.2.4"']);
  });
});
