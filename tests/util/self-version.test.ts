import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve, join } from "node:path";
import { readFileSync } from "node:fs";
import { selfPackageVersion, selfCaretRange } from "../../src/util/self-version.js";

const here = dirname(fileURLToPath(import.meta.url));
const distIndex = resolve(here, "../../dist/index.js");
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

// Regression for the silent-drift bug found in tonight's 2026-05-27 deep
// review: the OLD `here/../../package.json` shortcut held for `dist/cli/bin.js`
// (2 levels deep) but broke for `dist/index.js` (only 1 level deep) —
// silently returned "0.0.0" and consumers importing onboard from the library
// got `^0.0.0` pinned in their package.json. Vitest couldn't see this because
// it evaluates the source file where `import.meta.url` is correct.
//
// This suite spawns Node to invoke selfPackageVersion through the BUILT
// dist/index.js, simulating a consumer's library import.
describe("util/self-version dist-resolution regression (0.10.0–0.10.3 silent drift class)", () => {
  beforeAll(() => {
    if (!existsSync(distIndex)) {
      throw new Error(
        `dist/index.js not built — run 'pnpm build' before this test (the regression only manifests in built output).`,
      );
    }
  });

  function callViaDist(cwd: string): { version: string; caretRange: string } {
    const distUrl = `file://${distIndex.replace(/\\/g, "/")}`;
    const script = `
      import("${distUrl}")
        .then(m => {
          // Pass the BUNDLED module's own URL — that's what onboard does
          // internally via \`import.meta.url\`. Reproduces the dist context
          // exactly: the call site lives at dist/index.js (or wherever tsup
          // inlined onboard's code), so the walk-up has to find our
          // package.json from there.
          const u = "${distUrl}";
          process.stdout.write(JSON.stringify({
            version: m.selfPackageVersion(u),
            caretRange: m.selfCaretRange(u),
          }));
        })
        .catch(e => { process.stderr.write(String(e)); process.exit(1); });
    `;
    const out = execFileSync(process.execPath, ["--input-type=module", "-e", script], {
      cwd,
      encoding: "utf-8",
    });
    return JSON.parse(out) as { version: string; caretRange: string };
  }

  it("returns the real version (not '0.0.0') when called through dist/index.js", () => {
    const r = callViaDist(resolve(here, "../.."));
    expect(r.version).toBe(repoPkg.version);
    expect(r.caretRange).toBe(`^${repoPkg.version}`);
  });

  // The actual failure mode the bug shipped under: consumers run from cwd
  // unrelated to the install location. cwd MUST NOT influence resolution.
  it("returns the real version even when cwd is unrelated to the install location", () => {
    const r = callViaDist("/");
    expect(r.version).toBe(repoPkg.version);
    expect(r.caretRange).toBe(`^${repoPkg.version}`);
  });
});
