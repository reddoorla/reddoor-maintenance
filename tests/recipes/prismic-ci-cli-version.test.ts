import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  MIN_CLI_VERSION,
  atLeast,
  readLockedCliVersion,
} from "../../src/recipes/prismic-ci/cli-version.js";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "prismic-ci-version-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** A pnpm v9 lockfile importers block, the shape every fleet site ships. The
 *  `version:` carries the resolved semver followed by the whole peer-dependency
 *  suffix — real fleet lockfiles run that suffix past 400 characters. */
const lockfile = (body: string): string => `lockfileVersion: '9.0'\n\nimporters:\n\n  .:\n${body}`;

const dependencyBlock = (version: string, key = "dependencies"): string =>
  `    ${key}:\n` +
  `      '@reddoorla/maintenance':\n` +
  `        specifier: ^0.69.0\n` +
  `        version: ${version}\n` +
  `      '@slicemachine/adapter-sveltekit':\n` +
  `        specifier: ^0.3.0\n` +
  `        version: 0.3.87\n`;

describe("atLeast", () => {
  it("compares numerically, not lexicographically", () => {
    // THE TRAP, and the reason this is not a string comparison. As strings,
    // "0.9.0" > "0.83.0" — so a lexicographic gate would wave through a site
    // pinned to 0.9.0, which predates the command by seventy-four releases.
    expect(atLeast("0.9.0", "0.83.0")).toBe(false);
    expect(atLeast("0.83.0", "0.9.0")).toBe(true);
  });

  it("is inclusive of the minimum itself", () => {
    expect(atLeast("0.83.0", "0.83.0")).toBe(true);
  });

  it("handles each position independently", () => {
    expect(atLeast("0.82.9", "0.83.0")).toBe(false);
    expect(atLeast("0.83.1", "0.83.0")).toBe(true);
    expect(atLeast("1.0.0", "0.83.0")).toBe(true);
    expect(atLeast("0.69.0", "0.83.0")).toBe(false);
  });

  it("treats a prerelease of the minimum as BELOW it", () => {
    // 0.83.0-beta.1 precedes 0.83.0 in semver, and shipping the gate's own
    // benefit-of-the-doubt to a prerelease is how an unpublished build gets
    // waved through.
    expect(atLeast("0.83.0-beta.1", "0.83.0")).toBe(false);
  });
});

describe("readLockedCliVersion", () => {
  it("reads the version pnpm actually resolved, not the package.json range", async () => {
    // The whole reason this reads the LOCKFILE, measured on a real fleet repo:
    // espada's package.json says `^0.81.0` while its lockfile resolves 0.69.0,
    // and CI installs `--frozen-lockfile` — so the range is not what executes.
    // The fixture's `specifier:` is deliberately a range the `version:` does not
    // satisfy, so a parser that grabbed the wrong line would be caught here.
    await writeFile(join(dir, "pnpm-lock.yaml"), lockfile(dependencyBlock("0.69.0")));
    expect(await readLockedCliVersion(dir)).toEqual({ ok: true, version: "0.69.0" });
  });

  it("strips the peer-dependency suffix", async () => {
    const suffixed = "0.82.0(@sveltejs/kit@2.69.2(svelte@5.56.4))(typescript@5.9.3)";
    await writeFile(join(dir, "pnpm-lock.yaml"), lockfile(dependencyBlock(suffixed)));
    expect(await readLockedCliVersion(dir)).toEqual({ ok: true, version: "0.82.0" });
  });

  it("finds it under devDependencies too", async () => {
    await writeFile(
      join(dir, "pnpm-lock.yaml"),
      lockfile(dependencyBlock("0.83.0", "devDependencies")),
    );
    expect(await readLockedCliVersion(dir)).toEqual({ ok: true, version: "0.83.0" });
  });

  // THE THREE "I CANNOT ANSWER" CASES. Each is distinct from "too old" and from
  // each other, because this module's whole job is to feed a gate, and a gate
  // that cannot tell "old" from "unreadable" reports one as the other — the
  // absent-vs-unreadable collapse this feature exists to prevent, at the last
  // step before writing to a client repo.
  it("says so when there is no lockfile — never assumes a version", async () => {
    const r = await readLockedCliVersion(dir);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.reason).toMatch(/no pnpm-lock\.yaml/i);
  });

  it("says so when the package is absent from the lockfile", async () => {
    await writeFile(join(dir, "pnpm-lock.yaml"), lockfile("    dependencies:\n      svelte:\n"));
    const r = await readLockedCliVersion(dir);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.reason).toMatch(/not a dependency/i);
  });

  it("refuses to guess when the lockfile resolves TWO different versions", async () => {
    // A workspace whose importers disagree. Picking either one is a coin flip
    // that decides whether a client repo gets a workflow its binary cannot run.
    const twoImporters = `${dependencyBlock("0.83.0")}\n  packages/site:\n${dependencyBlock("0.69.0")}`;
    await writeFile(join(dir, "pnpm-lock.yaml"), lockfile(twoImporters));
    const r = await readLockedCliVersion(dir);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.reason).toMatch(/0\.69\.0/);
    expect(r.ok === false && r.reason).toMatch(/0\.83\.0/);
  });

  it("is happy when both importers agree — same version twice is not ambiguity", async () => {
    const twoImporters = `${dependencyBlock("0.83.0")}\n  packages/site:\n${dependencyBlock("0.83.0")}`;
    await writeFile(join(dir, "pnpm-lock.yaml"), lockfile(twoImporters));
    expect(await readLockedCliVersion(dir)).toEqual({ ok: true, version: "0.83.0" });
  });
});

describe("MIN_CLI_VERSION", () => {
  // Pinned deliberately. 0.83.0 is the FIRST published version whose bin carries
  // `prismic-models` — verified by installing it from the registry and running
  // `reddoor-maint prismic-models --help`, not by reading a changelog. Every
  // earlier published version, 0.82.0 included, exits "unknown command", so a
  // caller workflow installed alongside one fails on the first model PR.
  it("is the first published version carrying the command", () => {
    expect(MIN_CLI_VERSION).toBe("0.83.0");
    expect(atLeast("0.82.0", MIN_CLI_VERSION)).toBe(false);
  });
});
