import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The fail-closed half of #753.
 *
 * `MATCH_HARNESS_PREVIOUS` is what lets an already-installed site take a fix:
 * the recipe byte-compares the site's copy against renders it previously
 * shipped and `replace`s a match. A changed body whose predecessor was never
 * recorded gets `flag` instead — the site is accused of a hand edit it never
 * made, and since the recipe never overwrites a flagged file, that file stays
 * broken. Nothing enforced the pairing; the generator's own comment called
 * snapshotting "a manual step at release time", which is a person remembering.
 *
 * The guard is driven here as a SUBPROCESS, the way
 * `tests/hooks/subagent-stop-guard.test.ts` drives its hook: the exit code and
 * the message are the whole contract, and a release is stopped by a non-zero
 * exit rather than by an exported function returning a list.
 *
 * `--template` / `--previous` / `--corpus` point the two compared sides and the
 * snapshot store at fixtures, so every arm below runs without standing up a git
 * repository with tags in it. The last case takes the overrides away and runs
 * the guard against the real tree, which is the one that proves the instrument
 * passes on known-good input.
 */

const here = dirname(fileURLToPath(import.meta.url));
const GUARD = resolve(here, "../../scripts/check-match-harness-snapshots.mjs");

type Row = { name: string; rel: string; body: string; owner: "recipe" | "site" };

/** A `template.ts`-shaped text. Bodies must end in a newline: the generator
 *  emits `` `${escaped}`; `` with the closing backtick on its own line, and the
 *  guard's parser reconstructs exactly that. */
function templateText(rows: Row[]): string {
  const esc = (b: string) => b.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
  const parts: string[] = [];
  for (const r of rows) {
    parts.push(`export const ${r.name}_RELATIVE = ${JSON.stringify(r.rel)};`);
    parts.push(`export const ${r.name}_TEMPLATE = \`${esc(r.body)}\`;`, "");
  }
  parts.push("export const MATCH_HARNESS_FILES: readonly HarnessFile[] = [");
  for (const r of rows) {
    parts.push(
      `  { rel: ${r.name}_RELATIVE, template: ${r.name}_TEMPLATE, owner: ${JSON.stringify(r.owner)} },`,
    );
  }
  parts.push("];", "");
  return parts.join("\n");
}

const GATE: Row = {
  name: "GATE_SH",
  rel: "matching/gate.sh",
  body: "#!/usr/bin/env bash\necho gate\n",
  owner: "recipe",
};
const FLOORS: Row = {
  name: "FLOORS_MJS",
  rel: "matching/floors.mjs",
  body: "export const FLOORS = [];\n",
  owner: "site",
};

let root: string;

/** Run the guard over fixtures. Resolves either way — the exit CODE is under
 *  test, and a helper that threw on refusal would make "refused for some other
 *  reason" look identical to the refusal being asserted. */
async function guard(
  previous: Row[],
  current: Row[],
  snapshots: Array<{ rel: string; body: string }> = [],
): Promise<{ code: number; out: string }> {
  const dir = await mkdtemp(join(root, "case-"));
  const prevPath = join(dir, "previous.ts");
  const curPath = join(dir, "current.ts");
  const corpus = join(dir, "corpus");
  await writeFile(prevPath, templateText(previous), "utf-8");
  await writeFile(curPath, templateText(current), "utf-8");
  for (const s of snapshots) {
    const target = join(corpus, "0.95.1", s.rel);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, s.body, "utf-8");
  }
  await mkdir(corpus, { recursive: true });
  try {
    const out = execFileSync(
      process.execPath,
      [GUARD, "--template", curPath, "--previous", prevPath, "--corpus", corpus],
      { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] },
    );
    return { out, code: 0 };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { out: `${err.stdout ?? ""}${err.stderr ?? ""}`, code: err.status ?? -1 };
  }
}

describe("the match-harness release guard refuses an unsnapshotted body (#753)", () => {
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "mh-guard-"));
  });

  it("passes when no shipped body changed at all", async () => {
    const { code, out } = await guard([GATE, FLOORS], [GATE, FLOORS]);
    expect(code).toBe(0);
    expect(out).toMatch(/every recipe-owned body that changed carries a committed snapshot/);
  });

  it("REFUSES a recipe-owned body that changed with no snapshot of what shipped", async () => {
    // THE CASE THE GUARD EXISTS FOR. Every site on the previous release
    // byte-compares its gate.sh against MATCH_HARNESS_PREVIOUS; with no entry
    // the compare fails and the file is flagged, then never written again.
    const changed = { ...GATE, body: "#!/usr/bin/env bash\necho gate v2\n" };
    const { code, out } = await guard([GATE, FLOORS], [changed, FLOORS]);
    expect(code).toBe(1);
    expect(out).toContain("matching/gate.sh");
    expect(out).toMatch(/no committed snapshot/);
    expect(out).toMatch(/accused of a hand edit it never/);
  });

  it("passes that same change once the previous body IS snapshotted — the GRANT", async () => {
    // The mirror. A guard proven only to refuse is indistinguishable from one
    // that cannot pass: this is the identical change with the snapshot added,
    // and it must go green or the guard blocks every legitimate release.
    const changed = { ...GATE, body: "#!/usr/bin/env bash\necho gate v2\n" };
    const { code } = await guard(
      [GATE, FLOORS],
      [changed, FLOORS],
      [{ rel: GATE.rel, body: GATE.body }],
    );
    expect(code).toBe(0);
  });

  it("does not police a SITE-owned body, which the recipe never consults", async () => {
    // `planFileWrite` returns `skip` for a site record before `previous` is
    // ever read, so demanding a snapshot for one would block releases to
    // protect a comparison that never happens.
    const changed = { ...FLOORS, body: "export const FLOORS = [1];\n" };
    const { code } = await guard([GATE, FLOORS], [GATE, changed]);
    expect(code).toBe(0);
  });

  it("refuses rather than passing when it parsed nothing — the vacuity arm", async () => {
    // A parser that silently matched nothing would report a clean bill of
    // health over zero comparisons, which is the exact shape of false green
    // this guard is meant to end.
    const { code, out } = await guard([], []);
    expect(code).toBe(1);
    expect(out).toMatch(/nothing was actually compared/);
  });

  it("passes on the real tree — the instrument works on known-good input", async () => {
    // No overrides: the committed template.ts against the newest v* tag. This
    // needs tags, which is why ci.yml's checkout takes `fetch-depth: 0`; on a
    // shallow clone the guard refuses loudly instead of passing.
    const out = execFileSync(process.execPath, [GUARD], { encoding: "utf-8" });
    expect(out).toMatch(/OK — \d+ bodies compared against v/);
  });
});
