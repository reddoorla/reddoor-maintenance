// P1-120 phase 2: the CLI face. Warn mode never fails a site's CI; fail mode
// is the per-site switch; `--init` writes what a site needs.
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { annotation, runContentCheckCommand } from "../../src/cli/commands/content-check.js";
import { contentCheckWorkflow } from "../../src/content-check/workflow.js";

const FIXTURES = resolve(import.meta.dirname, "../fixtures/content-check");
const temps: string[] = [];
afterEach(() => {
  for (const t of temps.splice(0)) rmSync(t, { recursive: true, force: true });
});
function copyOf(fixture: string): string {
  const dir = mkdtempSync(join(tmpdir(), "content-check-cmd-"));
  temps.push(dir);
  cpSync(join(FIXTURES, fixture), dir, { recursive: true });
  return dir;
}
const run = (cwd: string, extra: Record<string, unknown> = {}) =>
  runContentCheckCommand({ cwd, env: {}, version: "0.118.0", ...extra });

const PAGE = "src/routes/+page.svelte";
const addLine = (dir: string, line: string): void =>
  writeFileSync(join(dir, PAGE), `${readFileSync(join(dir, PAGE), "utf8")}\n${line}\n`);

describe("warn mode (every site, for now)", () => {
  it("with no baseline, reports every literal and still exits 0", async () => {
    const r = await run(copyOf("dirty"));
    expect(r.code).toBe(0);
    expect(r.output).toContain("content-check: 24 NEW hard-coded literal(s)");
    expect(r.output).toContain(`warning ${PAGE}:22 phone "tel:+15550100199"`);
  });

  it("after --init, reports nothing until a literal is added, then only that one", async () => {
    const dir = copyOf("dirty");
    expect((await run(dir, { init: true })).code).toBe(0);
    const quiet = await run(dir);
    expect(quiet.output).toContain("content-check: 0 NEW hard-coded literal(s); 24 in 1 file(s)");
    addLine(dir, `<a href="tel:+15550100777">Call the office</a>`);
    const r = await run(dir);
    expect(r.code).toBe(0);
    expect(r.output.split("\n").filter((l) => l.startsWith("warning "))).toEqual([
      `warning ${PAGE}:35 phone "tel:+15550100777"`,
      `warning ${PAGE}:35 copy "Call the office"`,
    ]);
  });

  it("emits GitHub annotations only inside Actions", async () => {
    const dir = copyOf("dirty");
    const outside = await run(dir);
    expect(outside.output).not.toContain("::warning");
    const inside = await run(dir, { env: { GITHUB_ACTIONS: "true" } });
    expect(inside.output.split("\n").filter((l) => l.startsWith("::warning "))).toHaveLength(10);
  });

  it("says when the baseline holds literals the code no longer has", async () => {
    const dir = copyOf("dirty");
    await run(dir, { init: true });
    writeFileSync(join(dir, PAGE), "<p>{doc.intro}</p>\n");
    const r = await run(dir);
    expect(r.code).toBe(0);
    expect(r.output).toContain("24 baseline entries are no longer in the code");
  });
});

describe("fail mode (the per-site switch, off everywhere for now)", () => {
  it("exits 1 on a new literal, with error annotations", async () => {
    const dir = copyOf("dirty");
    await run(dir, { init: true });
    writeFileSync(join(dir, "content-check.json"), JSON.stringify({ mode: "fail" }));
    expect((await run(dir)).code).toBe(0);
    addLine(dir, `<h2>A brand new heading</h2>`);
    const r = await run(dir, { env: { GITHUB_ACTIONS: "true" } });
    expect(r.code).toBe(1);
    expect(r.output).toContain(`::error file=${PAGE},line=35,title=Hard-coded content (heading)::`);
  });

  it("--all lists every literal and never fails", async () => {
    const dir = copyOf("dirty");
    await run(dir, { init: true });
    writeFileSync(join(dir, "content-check.json"), JSON.stringify({ mode: "fail" }));
    const r = await run(dir, { all: true });
    expect(r.code).toBe(0);
    expect(r.output).toContain("content-check: 24 hard-coded literal(s), baseline ignored");
  });
});

describe("--init", () => {
  it("writes the workflow pinned to this version, a warn-mode config and the baseline", async () => {
    const dir = copyOf("clean");
    const r = await run(dir, { init: true });
    expect(r.output).toContain(
      "wrote .github/workflows/content-check.yml (pinned to @reddoorla/maintenance@0.118.0)",
    );
    expect(readFileSync(join(dir, ".github/workflows/content-check.yml"), "utf8")).toBe(
      contentCheckWorkflow("0.118.0"),
    );
    expect(JSON.parse(readFileSync(join(dir, "content-check.json"), "utf8")).mode).toBe("warn");
    // The clean page's baseline is empty: a new site starts clean.
    expect(JSON.parse(readFileSync(join(dir, "content-check.baseline.json"), "utf8"))).toEqual({
      version: 1,
      counts: {},
    });
  });

  it("keeps a site's existing settings", async () => {
    const dir = copyOf("clean");
    writeFileSync(
      join(dir, "content-check.json"),
      JSON.stringify({ mode: "fail", exempt: ["x/**"] }),
    );
    const r = await run(dir, { init: true });
    expect(r.output).toContain("kept content-check.json (mode: fail)");
    expect(JSON.parse(readFileSync(join(dir, "content-check.json"), "utf8")).exempt).toEqual([
      "x/**",
    ]);
  });

  it("re-run, keeps the baseline, so it absorbs no new literal (round 1)", async () => {
    const dir = copyOf("dirty");
    await run(dir, { init: true });
    addLine(dir, `<p>A brand new sentence</p>`);
    const again = await run(dir, { init: true, version: "0.119.0" });
    expect(again.output).toContain("kept content-check.baseline.json");
    expect(readFileSync(join(dir, ".github/workflows/content-check.yml"), "utf8")).toContain(
      "@reddoorla/maintenance@0.119.0",
    );
    expect((await run(dir)).output).toContain(`warning ${PAGE}:35 copy "A brand new sentence"`);
    // With --write-baseline as well, it does re-record.
    await run(dir, { init: true, writeBaseline: true });
    expect((await run(dir)).output).toContain("content-check: 0 NEW hard-coded literal(s)");
  });

  it("refuses to pin a release older than the command (round 1)", async () => {
    const dir = copyOf("clean");
    await expect(run(dir, { init: true, version: "0.117.2" })).rejects.toThrow(/no content-check/);
    await expect(run(dir, { init: true, version: "0.99.0" })).rejects.toThrow(/no content-check/);
    expect(existsSync(join(dir, ".github/workflows/content-check.yml"))).toBe(false);
    expect(contentCheckWorkflow("1.0.0")).toContain("@reddoorla/maintenance@1.0.0");
  });

  it("refuses to pin a version that is not a release", async () => {
    const dir = copyOf("clean");
    await expect(run(dir, { init: true, version: "unknown" })).rejects.toThrow(/cannot pin/);
    expect(existsSync(join(dir, ".github/workflows/content-check.yml"))).toBe(false);
  });
});

describe("the workflow", () => {
  const wf = contentCheckWorkflow("0.118.0");

  it("runs the pinned package's check, not the site's installed copy", () => {
    expect(wf).toContain(
      "run: npx --yes --package=@reddoorla/maintenance@0.118.0 -- reddoor-maint content-check",
    );
    expect(wf).not.toContain("pnpm install");
  });

  it("runs on pull requests and on pushes to main and staging, read-only", () => {
    expect(wf).toContain("  pull_request:\n  push:\n    branches: [main, staging]\n");
    expect(wf).toContain("permissions:\n  contents: read\n");
  });

  it("pins every action to a commit", () => {
    const uses = [...wf.matchAll(/uses: (\S+)/g)].map((m) => m[1]!);
    expect(uses.length).toBe(2);
    for (const u of uses) expect(u).toMatch(/@[0-9a-f]{40}$/);
  });
});

describe("a broken settings or baseline file", () => {
  it("fails with exit code 2 instead of guessing", async () => {
    const dir = copyOf("clean");
    writeFileSync(join(dir, "content-check.baseline.json"), "{");
    await expect(run(dir)).rejects.toMatchObject({ exitCode: 2 });
  });
});

describe("annotations", () => {
  it("escapes the characters GitHub's command syntax reserves", () => {
    expect(
      annotation(
        { file: "src/a,b:c.svelte", line: 3, kind: "copy", text: "50% off\nnow" },
        "warning",
      ),
    ).toBe(
      `::warning file=src/a%2Cb%3Ac.svelte,line=3,title=Hard-coded content (copy)::"50%25 off%0Anow" is written in code, so an editor cannot change it. Read it from a Prismic field (a code fallback behind the field is fine), or exempt it in content-check.json.`,
    );
  });
});
