import { describe, it, expect } from "vitest";
import { writeFile, mkdir, readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve, dirname, join } from "node:path";
import { svelteCodemods } from "../../src/recipes/svelte-codemods.js";
import { copyFixtureToTmp } from "./_helpers/site-tmpdir.js";

const here = dirname(fileURLToPath(import.meta.url));
const pristine = resolve(here, "../fixtures/pristine-starter");

async function writeCommitted(cwd: string, relPath: string, contents: string): Promise<void> {
  const full = join(cwd, relPath);
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, contents, "utf-8");
  execFileSync("git", ["add", "-A"], { cwd, stdio: "ignore" });
  execFileSync("git", ["commit", "-m", `add ${relPath}`], { cwd, stdio: "ignore" });
}

describe("recipes/svelte-codemods", () => {
  it("returns noop when no .svelte files match any codemod", async () => {
    const cwd = await copyFixtureToTmp(pristine);
    await writeCommitted(
      cwd,
      "src/routes/+page.svelte",
      `<script>\n  let x = 1;\n</script>\n<p>{x}</p>\n`,
    );
    const result = await svelteCodemods({ path: cwd });
    expect(result.status).toBe("noop");
    expect(result.commits).toHaveLength(0);
  });

  it("applies state-effect-sync codemod across matching files in one commit", async () => {
    const cwd = await copyFixtureToTmp(pristine);
    const fileA = `<script lang="ts">
  let { data } = $props();
  let content = $state(data.page.data);
  $effect(() => { data; content = data.page.data });
</script>
<div>{content.title}</div>
`;
    const fileB = `<script>
  let { data } = $props();
  let view = $state(data.view);
  $effect(() => { data; view = data.view });
</script>
<p>{view}</p>
`;
    await writeCommitted(cwd, "src/routes/+layout.svelte", fileA);
    await writeCommitted(cwd, "src/routes/page/+page.svelte", fileB);

    const result = await svelteCodemods({ path: cwd });
    expect(result.status).toBe("applied");
    expect(result.commits).toHaveLength(1);

    const afterA = await readFile(join(cwd, "src/routes/+layout.svelte"), "utf-8");
    const afterB = await readFile(join(cwd, "src/routes/page/+page.svelte"), "utf-8");
    expect(afterA).toContain("let content = $derived(data.page.data);");
    expect(afterA).not.toMatch(/\$state\(data\.page\.data\)/);
    expect(afterB).toContain("let view = $derived(data.view);");
  });

  it("creates a maint/svelte-codemods-* branch", async () => {
    const cwd = await copyFixtureToTmp(pristine);
    await writeCommitted(
      cwd,
      "src/routes/+page.svelte",
      `<script>
  let { data } = $props();
  let content = $state(data.x);
  $effect(() => { data; content = data.x });
</script>
`,
    );
    await svelteCodemods({ path: cwd });
    const branch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd,
      encoding: "utf-8",
    }).trim();
    expect(branch).toMatch(/^maint\/svelte-codemods-\d{8}T\d{6}Z$/);
  });

  it("is idempotent — re-running returns noop", async () => {
    const cwd = await copyFixtureToTmp(pristine);
    await writeCommitted(
      cwd,
      "src/routes/+page.svelte",
      `<script>
  let { data } = $props();
  let content = $state(data.x);
  $effect(() => { data; content = data.x });
</script>
`,
    );
    const first = await svelteCodemods({ path: cwd });
    expect(first.status).toBe("applied");
    const second = await svelteCodemods({ path: cwd });
    expect(second.status).toBe("noop");
  });

  it("refuses to run when working tree is dirty AND there is work to do", async () => {
    const cwd = await copyFixtureToTmp(pristine);
    await writeCommitted(
      cwd,
      "src/routes/+page.svelte",
      `<script>
  let { data } = $props();
  let content = $state(data.x);
  $effect(() => { data; content = data.x });
</script>
`,
    );
    await writeFile(join(cwd, "dirty.txt"), "x", "utf-8");
    await expect(svelteCodemods({ path: cwd })).rejects.toThrow(/working tree/i);
  });

  it("returns noop on dirty tree when there is nothing to codemod", async () => {
    const cwd = await copyFixtureToTmp(pristine);
    await writeFile(join(cwd, "dirty.txt"), "x", "utf-8");
    const result = await svelteCodemods({ path: cwd });
    expect(result.status).toBe("noop");
  });
});
