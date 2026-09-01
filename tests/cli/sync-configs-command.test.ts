import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
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

  it("--dry agrees with the real run on compliance-checked configs", async () => {
    // --dry used to re-derive drift with its own `existing !== contents` byte
    // comparison, ignoring the compliance predicates the real run applies. It
    // therefore reported svelte.config.js and netlify.toml as "would update"
    // when a real sync leaves them alone — a preview that disagrees with the
    // command it previews trains everyone to ignore it.
    const cwd = await copyFixtureToTmp(drift);

    const compliantSvelte = `import adapter from "@sveltejs/adapter-netlify";
export default { kit: { adapter: adapter(), alias: { $utils: "src/lib/utils" } } };
`;
    const compliantNetlify = `[build]
  command = "pnpm build"

[[headers]]
  for = "/*"
  [headers.values]
    Strict-Transport-Security = "max-age=31536000"
`;
    await writeFile(join(cwd, "svelte.config.js"), compliantSvelte, "utf-8");
    await writeFile(join(cwd, "netlify.toml"), compliantNetlify, "utf-8");
    execFileSync("git", ["add", "-A"], { cwd });
    execFileSync("git", ["commit", "-m", "compliant configs"], { cwd });

    const dry = run(["sync-configs", "--dry"], cwd);
    expect(dry).not.toMatch(/svelte\.config\.js/);
    expect(dry).not.toMatch(/netlify\.toml/);

    // And the real run must genuinely leave both files byte-identical.
    run(["sync-configs"], cwd);
    expect(await readFile(join(cwd, "svelte.config.js"), "utf-8")).toBe(compliantSvelte);
    expect(await readFile(join(cwd, "netlify.toml"), "utf-8")).toBe(compliantNetlify);
  });

  it("noop on clean fixture", async () => {
    const cwd = await copyFixtureToTmp(clean);
    const out = run(["sync-configs"], cwd);
    expect(out).toMatch(/noop/);
  });
});
