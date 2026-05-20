# `@reddoor/maintenance` Inventory + Fleet + Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the two v1 inventory providers (`localPath`, `fromJsonFile`), the `--fleet` flag wiring across every CLI command, the optional clone-to-workdir behavior for fleet mode, and the changesets-based npm release pipeline — completing the v1 surface and shipping `0.1.0` to npm.

**Prerequisites:** Foundation, Audits, and Recipes plans complete. Tag `v0.0.3-recipes` exists locally.

**Architecture:**

- A provider is a `() => Promise<Site[]>`. The two built-ins are async functions returning the wrapped list.
- The CLI resolves `--fleet <value>` to a provider at runtime: JSON file → `fromJsonFile`, anything else (a `.js` or `.mjs` path) → dynamic-import the default export.
- `resolveSites({ site, fleet, cwd, workdir })` is the one place the fleet-or-single-site decision lives. Every command calls it.
- `cloneIfNeeded(site, workdir)` clones `site.repoUrl` into `<workdir>/<name>` when `site.path` doesn't look like a checkout. It returns a new `Site` with the rewritten path.
- Release uses changesets + a GitHub Action. `0.1.0` is the first public version (the prior tags `v0.0.x-*` are local development milestones; no `0.0.x` is published).

**Tech Stack:** Same as previous plans. Adds `@changesets/cli` as a devDep.

---

## File Structure

Files created or modified:

- `src/inventory/local.ts` — `localPath(path)`
- `src/inventory/json.ts` — `fromJsonFile(path)`
- `src/inventory/index.ts` — barrel
- `src/cli/fleet/resolve-sites.ts` — `resolveSites` shared helper
- `src/cli/fleet/clone-if-needed.ts` — `cloneIfNeeded(site, workdir)`
- `src/cli/commands/audit.ts` — modify: accept `--fleet`, `--workdir`
- `src/cli/commands/sync-configs.ts` — modify: same
- `src/cli/commands/bump-deps.ts` — modify: same
- `src/cli/commands/upgrade.ts` — modify: same
- `src/cli/bin.ts` — modify: declare global `--fleet`, `--workdir` flags
- `src/index.ts` — modify: export `localPath`, `fromJsonFile`
- `tests/inventory/local.test.ts`
- `tests/inventory/json.test.ts`
- `tests/cli/fleet/resolve-sites.test.ts`
- `tests/cli/fleet/clone-if-needed.test.ts`
- `tests/cli/audit-fleet.test.ts`
- `.changeset/` — initialized via `pnpm dlx @changesets/cli init`
- `.changeset/config.json` — modify: set `access: "public"`
- `.github/workflows/release.yml` — publish workflow

---

## Task 1: `localPath` provider

**Files:**

- Create: `src/inventory/local.ts`
- Test: `tests/inventory/local.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/inventory/local.test.ts
import { describe, it, expect } from "vitest";
import { localPath } from "../../src/inventory/local";

describe("inventory/localPath", () => {
  it("returns a Site[] of length 1 with the given path", async () => {
    const provider = localPath("/abs/path");
    const sites = await provider();
    expect(sites).toHaveLength(1);
    expect(sites[0]?.path).toBe("/abs/path");
  });

  it("infers name from the basename", async () => {
    const provider = localPath("/abs/foo/bar");
    const [site] = await provider();
    expect(site?.name).toBe("bar");
  });

  it("respects an explicit name override", async () => {
    const provider = localPath("/abs/foo/bar", { name: "explicit" });
    const [site] = await provider();
    expect(site?.name).toBe("explicit");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/inventory/local.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/inventory/local.ts`**

```ts
import { basename } from "node:path";
import type { InventoryProvider, Site } from "../types.js";

export type LocalPathOptions = {
  name?: string;
};

export function localPath(path: string, opts: LocalPathOptions = {}): InventoryProvider {
  const site: Site = { path, name: opts.name ?? basename(path) };
  return async () => [site];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test tests/inventory/local.test.ts`
Expected: PASS — all 3 cases.

- [ ] **Step 5: Commit**

```bash
git add src/inventory/local.ts tests/inventory/local.test.ts
git commit -m "feat(inventory): add localPath provider"
```

---

## Task 2: `fromJsonFile` provider

**Files:**

- Create: `src/inventory/json.ts`
- Test: `tests/inventory/json.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/inventory/json.test.ts
import { describe, it, expect } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fromJsonFile } from "../../src/inventory/json";

async function withJsonFile(payload: unknown): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "reddoor-inv-"));
  const path = join(dir, "inventory.json");
  await writeFile(path, JSON.stringify(payload), "utf-8");
  return path;
}

describe("inventory/fromJsonFile", () => {
  it("returns parsed sites", async () => {
    const path = await withJsonFile([
      { name: "a", path: "/abs/a" },
      { name: "b", path: "/abs/b", repoUrl: "git@github.com:o/b.git", meta: { tier: "1" } },
    ]);
    const sites = await fromJsonFile(path)();
    expect(sites).toHaveLength(2);
    expect(sites[0]?.name).toBe("a");
    expect(sites[1]?.repoUrl).toBe("git@github.com:o/b.git");
  });

  it("rejects with a clear message when the file isn't an array", async () => {
    const path = await withJsonFile({ name: "a", path: "/x" });
    await expect(fromJsonFile(path)()).rejects.toThrow(/array/i);
  });

  it("rejects with a clear message when a site is missing path", async () => {
    const path = await withJsonFile([{ name: "a" }]);
    await expect(fromJsonFile(path)()).rejects.toThrow(/path/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/inventory/json.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/inventory/json.ts`**

```ts
import { readFile } from "node:fs/promises";
import type { InventoryProvider, Site } from "../types.js";

function validate(raw: unknown): Site[] {
  if (!Array.isArray(raw)) {
    throw new Error("inventory JSON must be an array of sites");
  }
  return raw.map((entry, i) => {
    if (!entry || typeof entry !== "object") {
      throw new Error(`inventory entry ${i} is not an object`);
    }
    const e = entry as Record<string, unknown>;
    if (typeof e.path !== "string" || e.path.length === 0) {
      throw new Error(`inventory entry ${i} is missing required field: path`);
    }
    return {
      path: e.path,
      name: typeof e.name === "string" ? e.name : undefined,
      repoUrl: typeof e.repoUrl === "string" ? e.repoUrl : undefined,
      meta:
        typeof e.meta === "object" && e.meta !== null
          ? (e.meta as Record<string, unknown>)
          : undefined,
    };
  });
}

export function fromJsonFile(path: string): InventoryProvider {
  return async () => {
    const raw = JSON.parse(await readFile(path, "utf-8")) as unknown;
    return validate(raw);
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test tests/inventory/json.test.ts`
Expected: PASS — all 3 cases.

- [ ] **Step 5: Commit**

```bash
git add src/inventory/json.ts tests/inventory/json.test.ts
git commit -m "feat(inventory): add fromJsonFile provider with validation"
```

---

## Task 3: Inventory barrel + public exports

**Files:**

- Create: `src/inventory/index.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Implement `src/inventory/index.ts`**

```ts
export { localPath, type LocalPathOptions } from "./local.js";
export { fromJsonFile } from "./json.js";
```

- [ ] **Step 2: Update `src/index.ts`** — add the inventory exports

Replace with:

```ts
export type {
  Site,
  AuditName,
  AuditResult,
  RecipeName,
  RecipeResult,
  ConfigName,
  InventoryProvider,
} from "./types.js";

export {
  runAudits,
  runAuditsAcross,
  ALL_AUDIT_NAMES,
  depsAudit,
  lintAudit,
  securityAudit,
  lighthouseAudit,
  a11yAudit,
} from "./audits/index.js";

export {
  syncConfigs,
  bumpDeps,
  upgradeSvelte4to5,
  ALL_RECIPE_NAMES,
  isRecipeName,
} from "./recipes/index.js";

export type {
  SyncConfigsOptions,
  BumpDepsOptions,
  UpgradeSvelte4to5Options,
} from "./recipes/index.js";

export { localPath, fromJsonFile, type LocalPathOptions } from "./inventory/index.js";
```

- [ ] **Step 3: Typecheck + build**

Run: `pnpm typecheck && pnpm build`
Expected: PASS — no type errors.

- [ ] **Step 4: Commit**

```bash
git add src/inventory/index.ts src/index.ts
git commit -m "feat(inventory): add barrel + public exports for providers"
```

---

## Task 4: `resolveSites` — the fleet-or-single-site decision

This helper resolves a CLI invocation into a `Site[]`. It's the single source of truth for how `[site]` and `--fleet <value>` interact.

**Files:**

- Create: `src/cli/fleet/resolve-sites.ts`
- Test: `tests/cli/fleet/resolve-sites.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/cli/fleet/resolve-sites.test.ts
import { describe, it, expect } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveSites } from "../../../src/cli/fleet/resolve-sites";

async function tmpJson(payload: unknown): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "reddoor-rs-"));
  const path = join(dir, "inv.json");
  await writeFile(path, JSON.stringify(payload), "utf-8");
  return path;
}

async function tmpJs(body: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "reddoor-rs-"));
  const path = join(dir, "inv.mjs");
  await writeFile(path, body, "utf-8");
  return path;
}

describe("cli/fleet/resolveSites", () => {
  it("returns localPath site when only [site] is given", async () => {
    const sites = await resolveSites({ site: "/abs/foo", fleet: undefined, cwd: "/cwd" });
    expect(sites).toHaveLength(1);
    expect(sites[0]?.path).toBe("/abs/foo");
  });

  it("falls back to cwd when neither site nor fleet is given", async () => {
    const sites = await resolveSites({ site: undefined, fleet: undefined, cwd: "/cwd" });
    expect(sites[0]?.path).toBe("/cwd");
  });

  it("loads JSON inventory when --fleet points at a .json file", async () => {
    const fleet = await tmpJson([
      { name: "a", path: "/a" },
      { name: "b", path: "/b" },
    ]);
    const sites = await resolveSites({ site: undefined, fleet, cwd: "/cwd" });
    expect(sites.map((s) => s.name)).toEqual(["a", "b"]);
  });

  it("loads JS inventory when --fleet points at a .mjs file (default export)", async () => {
    const fleet = await tmpJs(
      `export default async () => [{ name: "from-js", path: "/from-js" }];`,
    );
    const sites = await resolveSites({ site: undefined, fleet, cwd: "/cwd" });
    expect(sites).toEqual([{ name: "from-js", path: "/from-js" }]);
  });

  it("rejects when both [site] and --fleet are provided", async () => {
    await expect(resolveSites({ site: "/abs", fleet: "/inv.json", cwd: "/cwd" })).rejects.toThrow(
      /cannot combine/i,
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/cli/fleet/resolve-sites.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/cli/fleet/resolve-sites.ts`**

```ts
import { pathToFileURL } from "node:url";
import { resolve, extname } from "node:path";
import type { InventoryProvider, Site } from "../../types.js";
import { localPath } from "../../inventory/local.js";
import { fromJsonFile } from "../../inventory/json.js";

export type ResolveSitesInput = {
  site?: string;
  fleet?: string;
  cwd: string;
};

export async function resolveSites(input: ResolveSitesInput): Promise<Site[]> {
  if (input.site && input.fleet) {
    throw Object.assign(new Error("cannot combine a positional [site] with --fleet"), {
      exitCode: 2,
    });
  }

  if (input.fleet) {
    const fleetPath = resolve(input.cwd, input.fleet);
    const ext = extname(fleetPath).toLowerCase();
    let provider: InventoryProvider;
    if (ext === ".json") {
      provider = fromJsonFile(fleetPath);
    } else if (ext === ".js" || ext === ".mjs" || ext === ".cjs") {
      const mod = (await import(pathToFileURL(fleetPath).href)) as {
        default?: InventoryProvider;
      };
      if (!mod.default || typeof mod.default !== "function") {
        throw Object.assign(new Error(`--fleet ${input.fleet}: default export is not a function`), {
          exitCode: 2,
        });
      }
      provider = mod.default;
    } else {
      throw Object.assign(
        new Error(`--fleet ${input.fleet}: unsupported extension ${ext || "(none)"}`),
        { exitCode: 2 },
      );
    }
    return provider();
  }

  return localPath(resolve(input.cwd, input.site ?? input.cwd))();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test tests/cli/fleet/resolve-sites.test.ts`
Expected: PASS — all 5 cases.

- [ ] **Step 5: Commit**

```bash
git add src/cli/fleet/resolve-sites.ts tests/cli/fleet/resolve-sites.test.ts
git commit -m "feat(cli): add resolveSites — JSON + JS inventory loading + single-site fallback"
```

---

## Task 5: `cloneIfNeeded` — clone-on-demand for fleet mode

**Behavior:**

- If `site.path` exists and is a non-empty directory, return the site as-is.
- Otherwise, require `site.repoUrl`. Compute `<workdir>/<name>` (using `site.name` or derived from `repoUrl`).
- If that target directory already exists, return a new `Site` pointing at it.
- Otherwise: `git clone <repoUrl> <target>`. Return a new `Site` pointing at `target`.

**Files:**

- Create: `src/cli/fleet/clone-if-needed.ts`
- Test: `tests/cli/fleet/clone-if-needed.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/cli/fleet/clone-if-needed.test.ts
import { describe, it, expect } from "vitest";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cloneIfNeeded } from "../../../src/cli/fleet/clone-if-needed";
import type { SpawnFn } from "../../../src/audits/util/spawn";

async function existingDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "reddoor-cif-"));
  await writeFile(join(dir, "placeholder.txt"), "x", "utf-8");
  return dir;
}

describe("cli/fleet/cloneIfNeeded", () => {
  it("returns the site unchanged when path is a non-empty directory", async () => {
    const path = await existingDir();
    const site = { path, name: "ok" };
    const cloneSpawn = (async () => {
      throw new Error("should not spawn");
    }) as SpawnFn;
    const result = await cloneIfNeeded(site, { workdir: "/never/used", spawn: cloneSpawn });
    expect(result).toEqual(site);
  });

  it("clones when path does not exist and repoUrl is provided", async () => {
    const workdir = await mkdtemp(join(tmpdir(), "reddoor-wd-"));
    let cloned = false;
    const spawn: SpawnFn = async (cmd, args) => {
      if (cmd === "git" && args[0] === "clone") {
        const target = args[args.length - 1] as string;
        await mkdir(target, { recursive: true });
        await writeFile(join(target, "ok"), "x", "utf-8");
        cloned = true;
        return { code: 0, stdout: "", stderr: "" };
      }
      throw new Error(`unexpected: ${cmd}`);
    };

    const site = {
      path: join(workdir, "missing"),
      name: "site-a",
      repoUrl: "git@example.com:a.git",
    };
    const result = await cloneIfNeeded(site, { workdir, spawn });

    expect(cloned).toBe(true);
    expect(result.path).toBe(join(workdir, "site-a"));
  });

  it("derives a name from repoUrl when site.name is missing", async () => {
    const workdir = await mkdtemp(join(tmpdir(), "reddoor-wd-"));
    const spawn: SpawnFn = async (_cmd, args) => {
      const target = args[args.length - 1] as string;
      await mkdir(target, { recursive: true });
      return { code: 0, stdout: "", stderr: "" };
    };
    const site = { path: "/not-exist", repoUrl: "git@github.com:owner/repo-name.git" };
    const result = await cloneIfNeeded(site, { workdir, spawn });
    expect(result.path).toBe(join(workdir, "repo-name"));
  });

  it("throws when path is missing and no repoUrl is set", async () => {
    const spawn: SpawnFn = async () => {
      throw new Error("should not spawn");
    };
    await expect(cloneIfNeeded({ path: "/not-exist" }, { workdir: "/wd", spawn })).rejects.toThrow(
      /repoUrl/,
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/cli/fleet/clone-if-needed.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/cli/fleet/clone-if-needed.ts`**

```ts
import { stat, readdir, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { Site } from "../../types.js";
import { defaultSpawn, type SpawnFn } from "../../audits/util/spawn.js";

export type CloneIfNeededOptions = {
  workdir: string;
  spawn?: SpawnFn;
};

function deriveNameFromRepoUrl(repoUrl: string): string {
  const slash = repoUrl.split("/").pop() ?? repoUrl;
  return slash.replace(/\.git$/, "");
}

async function isNonEmptyDir(path: string): Promise<boolean> {
  try {
    const s = await stat(path);
    if (!s.isDirectory()) return false;
    const entries = await readdir(path);
    return entries.length > 0;
  } catch {
    return false;
  }
}

export async function cloneIfNeeded(site: Site, opts: CloneIfNeededOptions): Promise<Site> {
  if (await isNonEmptyDir(site.path)) return site;

  if (!site.repoUrl) {
    throw new Error(`site path does not exist (${site.path}) and no repoUrl is set — cannot clone`);
  }

  const name = site.name ?? deriveNameFromRepoUrl(site.repoUrl);
  const target = join(opts.workdir, name);
  await mkdir(opts.workdir, { recursive: true });

  if (await isNonEmptyDir(target)) {
    return { ...site, name, path: target };
  }

  const spawn = opts.spawn ?? defaultSpawn;
  const result = await spawn("git", ["clone", site.repoUrl, target], {
    cwd: opts.workdir,
    timeoutMs: 5 * 60_000,
  });
  if (result.code !== 0) {
    throw new Error(`git clone failed (code ${result.code}): ${result.stderr}`);
  }
  return { ...site, name, path: target };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test tests/cli/fleet/clone-if-needed.test.ts`
Expected: PASS — all 4 cases.

- [ ] **Step 5: Commit**

```bash
git add src/cli/fleet/clone-if-needed.ts tests/cli/fleet/clone-if-needed.test.ts
git commit -m "feat(cli): add cloneIfNeeded for fleet-mode site materialization"
```

---

## Task 6: Wire `audit` to fleet

**Files:**

- Modify: `src/cli/commands/audit.ts`
- Modify: `src/cli/bin.ts`
- Test: `tests/cli/audit-fleet.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/cli/audit-fleet.test.ts
import { describe, it, expect, beforeAll } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const binPath = resolve(here, "../../dist/cli/bin.js");
const pristine = resolve(here, "../fixtures/pristine-starter");
const preSvelte5 = resolve(here, "../fixtures/pre-svelte5");

describe("cli: audit --fleet", () => {
  beforeAll(() => {
    if (!existsSync(binPath)) throw new Error("run `pnpm build` first");
  });

  it("runs audits across two sites from a JSON inventory and aggregates output", async () => {
    const dir = await mkdtemp(join(tmpdir(), "reddoor-fleet-"));
    const invPath = join(dir, "inv.json");
    await writeFile(
      invPath,
      JSON.stringify([
        { name: "alpha", path: pristine },
        { name: "beta", path: preSvelte5 },
      ]),
      "utf-8",
    );

    let stdout = "";
    let status = 0;
    try {
      stdout = execFileSync(
        process.execPath,
        [binPath, "audit", "--fleet", invPath, "--only", "deps", "--json"],
        { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] },
      );
    } catch (err) {
      const e = err as { status?: number; stdout?: Buffer | string };
      stdout = e.stdout?.toString() ?? "";
      status = e.status ?? -1;
    }
    expect(status).toBe(1); // beta should fail
    const parsed = JSON.parse(stdout) as Array<{ site: string; status: string }>;
    expect(parsed).toHaveLength(2);
    const alpha = parsed.find((r) => r.site === "alpha");
    const beta = parsed.find((r) => r.site === "beta");
    expect(alpha?.status).toBe("pass");
    expect(beta?.status).toBe("fail");
  });

  it("rejects [site] + --fleet together with exit 2", () => {
    let status = 0;
    try {
      execFileSync(
        process.execPath,
        [binPath, "audit", pristine, "--fleet", "/tmp/whatever.json"],
        { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] },
      );
    } catch (err) {
      status = (err as { status?: number }).status ?? -1;
    }
    expect(status).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm build && pnpm test tests/cli/audit-fleet.test.ts`
Expected: FAIL — `--fleet` not recognized.

- [ ] **Step 3: Replace `src/cli/commands/audit.ts`**

```ts
import { runAudits, ALL_AUDIT_NAMES } from "../../audits/index.js";
import type { AuditName, AuditResult } from "../../types.js";
import { resolveSites } from "../fleet/resolve-sites.js";
import { cloneIfNeeded } from "../fleet/clone-if-needed.js";

export type AuditCommandOptions = {
  only?: string;
  json?: boolean;
  fleet?: string;
  workdir?: string;
};

function parseOnly(value: string | undefined): AuditName[] | undefined {
  if (!value) return undefined;
  const names = value.split(",").map((s) => s.trim());
  for (const n of names) {
    if (!ALL_AUDIT_NAMES.includes(n as AuditName)) {
      throw Object.assign(new Error(`unknown audit in --only: ${n}`), { exitCode: 2 });
    }
  }
  return names as AuditName[];
}

function formatTable(results: AuditResult[]): string {
  return results
    .map((r) => `${r.audit.padEnd(12)} ${r.status.padEnd(5)} ${r.site}\n  ${r.summary}`)
    .join("\n");
}

function exitCode(results: AuditResult[]): number {
  return results.some((r) => r.status === "fail") ? 1 : 0;
}

export async function runAuditCommand(
  site: string | undefined,
  opts: AuditCommandOptions,
): Promise<{ output: string; code: number }> {
  const which = parseOnly(opts.only);

  let sites = await resolveSites({
    site,
    fleet: opts.fleet,
    cwd: process.cwd(),
  });

  if (opts.fleet) {
    const workdir = opts.workdir ?? `${process.env.HOME ?? ""}/.reddoor-maint/sites`;
    sites = await Promise.all(sites.map((s) => cloneIfNeeded(s, { workdir })));
  }

  const results: AuditResult[] = [];
  for (const s of sites) {
    const r = await runAudits(s, which);
    results.push(...r);
  }

  const output = opts.json ? JSON.stringify(results, null, 2) : formatTable(results);
  return { output, code: exitCode(results) };
}
```

- [ ] **Step 4: Modify `src/cli/bin.ts` — declare `--fleet` and `--workdir` on the `audit` command**

Find the `audit` command registration and replace with:

```ts
cli
  .command("audit [site]", "Run audits against a site (default: cwd).")
  .option("--only <names>", "Comma-separated audit names (e.g. deps,lighthouse)")
  .option("--json", "Machine-readable JSON output")
  .option("--fleet <inventory>", "Inventory file (.json or .mjs/.js); aggregates across sites")
  .option("--workdir <path>", "Clone target for fleet mode (default ~/.reddoor-maint/sites)")
  .action(
    async (site, opts: { only?: string; json?: boolean; fleet?: string; workdir?: string }) => {
      try {
        const { output, code } = await runAuditCommand(site, opts);
        console.log(output);
        process.exit(code);
      } catch (err) {
        const e = err as { exitCode?: number; message?: string };
        console.error(e.message ?? String(err));
        process.exit(e.exitCode ?? 1);
      }
    },
  );
```

- [ ] **Step 5: Build + run test to verify it passes**

Run: `pnpm build && pnpm test tests/cli/audit-fleet.test.ts`
Expected: PASS — both cases.

- [ ] **Step 6: Commit**

```bash
git add src/cli/commands/audit.ts src/cli/bin.ts tests/cli/audit-fleet.test.ts
git commit -m "feat(cli): wire --fleet and --workdir into the audit command"
```

---

## Task 7: Wire `sync-configs`, `bump-deps`, `upgrade` to fleet

These three commands all run a recipe per site. The pattern is identical: resolve sites, optionally clone, iterate.

**Files:**

- Modify: `src/cli/commands/sync-configs.ts`
- Modify: `src/cli/commands/bump-deps.ts`
- Modify: `src/cli/commands/upgrade.ts`
- Modify: `src/cli/bin.ts`

- [ ] **Step 1: Replace `src/cli/commands/sync-configs.ts`**

```ts
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { syncConfigs } from "../../recipes/sync-configs.js";
import { ALL_TEMPLATES, templatesByName } from "../../recipes/sync-configs/templates.js";
import type { ConfigName, RecipeResult } from "../../types.js";
import { resolveSites } from "../fleet/resolve-sites.js";
import { cloneIfNeeded } from "../fleet/clone-if-needed.js";

export type SyncConfigsCommandOptions = {
  only?: string;
  dry?: boolean;
  fleet?: string;
  workdir?: string;
};

function parseOnly(value?: string): ConfigName[] | undefined {
  return value ? (value.split(",").map((s) => s.trim()) as ConfigName[]) : undefined;
}

async function dryPlan(cwd: string, which?: ConfigName[]): Promise<string> {
  const targets = which ? templatesByName(which) : ALL_TEMPLATES;
  const lines: string[] = [];
  for (const t of targets) {
    let existing = "";
    try {
      existing = await readFile(join(cwd, t.path), "utf-8");
    } catch {}
    if (existing !== t.contents) lines.push(`would update ${t.path} (config: ${t.config})`);
  }
  return lines.length === 0 ? "no changes needed" : lines.join("\n");
}

function formatResult(r: RecipeResult): string {
  if (r.status === "noop") return `[${r.site}] noop: ${r.notes ?? "all configs in sync"}`;
  return `[${r.site}] applied: ${r.commits.length} commit(s)\n${r.notes ?? ""}`;
}

export async function runSyncConfigsCommand(
  site: string | undefined,
  opts: SyncConfigsCommandOptions,
): Promise<{ output: string; code: number }> {
  const which = parseOnly(opts.only);

  let sites = await resolveSites({
    site,
    fleet: opts.fleet,
    cwd: process.cwd(),
  });

  if (opts.fleet) {
    const workdir = opts.workdir ?? `${process.env.HOME ?? ""}/.reddoor-maint/sites`;
    sites = await Promise.all(sites.map((s) => cloneIfNeeded(s, { workdir })));
  }

  if (opts.dry) {
    const blocks: string[] = [];
    for (const s of sites) blocks.push(`[${s.name ?? s.path}]\n` + (await dryPlan(s.path, which)));
    return { output: blocks.join("\n\n"), code: 0 };
  }

  const results: RecipeResult[] = [];
  for (const s of sites) results.push(await syncConfigs(s, { which }));

  const output = results.map(formatResult).join("\n");
  const code = results.some((r) => r.status === "failed") ? 1 : 0;
  return { output, code };
}
```

- [ ] **Step 2: Replace `src/cli/commands/bump-deps.ts`**

```ts
import { bumpDeps, type BumpDepsGroup } from "../../recipes/bump-deps.js";
import type { RecipeResult } from "../../types.js";
import { resolveSites } from "../fleet/resolve-sites.js";
import { cloneIfNeeded } from "../fleet/clone-if-needed.js";

const GROUPS: BumpDepsGroup[] = ["patch", "minor", "major"];

export type BumpDepsCommandOptions = {
  group?: string;
  fleet?: string;
  workdir?: string;
};

function formatResult(r: RecipeResult): string {
  if (r.status === "noop") return `[${r.site}] noop: ${r.notes ?? ""}`;
  return `[${r.site}] applied: ${r.commits.length} commit(s)\n${r.notes ?? ""}`;
}

export async function runBumpDepsCommand(
  site: string | undefined,
  opts: BumpDepsCommandOptions,
): Promise<{ output: string; code: number }> {
  const group = (opts.group ?? "minor") as BumpDepsGroup;
  if (!GROUPS.includes(group)) {
    throw Object.assign(
      new Error(`unknown --group: ${group}. expected one of ${GROUPS.join(", ")}`),
      {
        exitCode: 2,
      },
    );
  }

  let sites = await resolveSites({
    site,
    fleet: opts.fleet,
    cwd: process.cwd(),
  });

  if (opts.fleet) {
    const workdir = opts.workdir ?? `${process.env.HOME ?? ""}/.reddoor-maint/sites`;
    sites = await Promise.all(sites.map((s) => cloneIfNeeded(s, { workdir })));
  }

  const results: RecipeResult[] = [];
  for (const s of sites) results.push(await bumpDeps(s, { group }));

  const output = results.map(formatResult).join("\n");
  const code = results.some((r) => r.status === "failed") ? 1 : 0;
  return { output, code };
}
```

- [ ] **Step 3: Replace `src/cli/commands/upgrade.ts`**

```ts
import { upgradeSvelte4to5 } from "../../recipes/svelte-5/index.js";
import type { RecipeResult } from "../../types.js";
import { resolveSites } from "../fleet/resolve-sites.js";
import { cloneIfNeeded } from "../fleet/clone-if-needed.js";

const KNOWN_UPGRADES = new Set(["svelte-4-to-5"]);

export type UpgradeCommandOptions = {
  fleet?: string;
  workdir?: string;
};

function formatResult(r: RecipeResult): string {
  if (r.status === "noop") return `[${r.site}] noop: ${r.notes ?? ""}`;
  return `[${r.site}] applied: ${r.commits.length} commit(s)\n${r.notes ?? ""}`;
}

export async function runUpgradeCommand(
  upgradeName: string | undefined,
  site: string | undefined,
  opts: UpgradeCommandOptions = {},
): Promise<{ output: string; code: number }> {
  if (!upgradeName || !KNOWN_UPGRADES.has(upgradeName)) {
    throw Object.assign(
      new Error(
        `unknown upgrade: ${upgradeName ?? "(none)"}. expected one of ${[...KNOWN_UPGRADES].join(", ")}`,
      ),
      { exitCode: 2 },
    );
  }

  let sites = await resolveSites({
    site,
    fleet: opts.fleet,
    cwd: process.cwd(),
  });

  if (opts.fleet) {
    const workdir = opts.workdir ?? `${process.env.HOME ?? ""}/.reddoor-maint/sites`;
    sites = await Promise.all(sites.map((s) => cloneIfNeeded(s, { workdir })));
  }

  const results: RecipeResult[] = [];
  for (const s of sites) {
    if (upgradeName === "svelte-4-to-5") {
      results.push(await upgradeSvelte4to5(s));
    }
  }

  const output = results.map(formatResult).join("\n");
  const code = results.some((r) => r.status === "failed") ? 1 : 0;
  return { output, code };
}
```

- [ ] **Step 4: Modify `src/cli/bin.ts` — add `--fleet` and `--workdir` to the three commands**

For each of `sync-configs`, `bump-deps`, and `upgrade`, add:

```ts
.option("--fleet <inventory>", "Inventory file (.json or .mjs/.js)")
.option("--workdir <path>", "Clone target for fleet mode (default ~/.reddoor-maint/sites)")
```

…and pass `opts` through to the command function as before. The action callbacks already destructure `opts`, so no further changes are needed.

- [ ] **Step 5: Re-run the full suite**

Run: `pnpm build && pnpm typecheck && pnpm lint && pnpm test`
Expected: PASS.

- [ ] **Step 6: Manual smoke against the existing fixtures**

```bash
node dist/cli/bin.js sync-configs --fleet tests/fleet-example.json --dry
```

(If `tests/fleet-example.json` doesn't exist, write one first with two fixture entries.)

- [ ] **Step 7: Commit**

```bash
git add src/cli/commands/sync-configs.ts src/cli/commands/bump-deps.ts src/cli/commands/upgrade.ts src/cli/bin.ts
git commit -m "feat(cli): wire --fleet and --workdir into sync-configs/bump-deps/upgrade"
```

---

## Task 7.5: Global CLI flags — `--cwd`, `--verbose`, `--no-color`

The spec lists three global flags every command should accept. `--workdir` is already wired (fleet-specific); the remaining three are command-agnostic and live as global options in `cac`.

- `--cwd <path>` overrides `process.cwd()` for the duration of the command (changes the default for `[site]` and the relative resolution of `--fleet <path>`).
- `--verbose` enables additional output. We expose this as a single boolean propagated through to commands via an internal `globalOpts` object; v1 honors it only in CLI error printers (full stack on `--verbose`).
- `--no-color` is `cac`'s built-in flag — `cac` automatically respects `NO_COLOR`/`--no-color`; no code change needed beyond documenting it in `--help`.

**Files:**

- Modify: `src/cli/bin.ts`
- Modify: `src/cli/commands/audit.ts`, `sync-configs.ts`, `bump-deps.ts`, `upgrade.ts` — accept `cwd?: string` in their option types, default to `process.cwd()`

- [ ] **Step 1: Modify `src/cli/bin.ts` to declare globals**

Add immediately after `const cli = cac("reddoor-maint");`:

```ts
cli.option("--cwd <path>", "Override working directory (default: process.cwd())");
cli.option("--verbose", "Verbose output (full stack on errors)");
```

(No code is needed for `--no-color`: cac respects `NO_COLOR` env + the flag automatically; the help output will list it.)

- [ ] **Step 2: Update every command's option type to accept `cwd?: string`**

For each of the four command files, add `cwd?: string` to its options type. In the action callback, pass `{ ...opts }` through. In each command function, replace `process.cwd()` with `opts.cwd ? resolve(opts.cwd) : process.cwd()`.

Example for `runAuditCommand`:

```ts
const cwd = opts.cwd ? resolve(opts.cwd) : process.cwd();
let sites = await resolveSites({ site, fleet: opts.fleet, cwd });
```

Apply the analogous change to `runSyncConfigsCommand`, `runBumpDepsCommand`, `runUpgradeCommand`.

- [ ] **Step 3: Modify the `audit` action callback in `bin.ts`** so it forwards `--cwd`:

```ts
.action(async (site, opts: { only?: string; json?: boolean; fleet?: string; workdir?: string; cwd?: string; verbose?: boolean }) => {
  try {
    const { output, code } = await runAuditCommand(site, opts);
    console.log(output);
    process.exit(code);
  } catch (err) {
    const e = err as { exitCode?: number; message?: string; stack?: string };
    console.error(opts.verbose ? e.stack ?? e.message : e.message ?? String(err));
    process.exit(e.exitCode ?? 1);
  }
});
```

Apply the same destructure shape (+`cwd?: string`, +`verbose?: boolean`) and the same error-stack-on-verbose pattern to the `sync-configs`, `bump-deps`, and `upgrade` action callbacks.

- [ ] **Step 4: Smoke check**

Run: `pnpm build`
Then: `node dist/cli/bin.js audit --cwd tests/fixtures/pristine-starter --only deps --json`
Expected: same output as if invoked from inside `tests/fixtures/pristine-starter`. Exit 0, JSON with a single `deps`/`pass` entry.

Run: `node dist/cli/bin.js --help`
Expected: help output lists `--cwd`, `--verbose`, and (via cac built-in) `--no-color`.

- [ ] **Step 5: Commit**

```bash
git add src/cli/bin.ts src/cli/commands/
git commit -m "feat(cli): add --cwd, --verbose, --no-color globals"
```

---

## Task 8: Initialize changesets

**Files:**

- Create: `.changeset/config.json` (via init, then edit)
- Modify: `package.json` — add `@changesets/cli` devDep + scripts

- [ ] **Step 1: Add changesets**

Run: `pnpm add -D @changesets/cli`
Expected: lockfile updated.

- [ ] **Step 2: Initialize changesets**

Run: `pnpm exec changeset init`
Expected: `.changeset/config.json` and `.changeset/README.md` created.

- [ ] **Step 3: Edit `.changeset/config.json` — set `access: "public"` and `baseBranch: "main"`**

Replace the file with:

```json
{
  "$schema": "https://unpkg.com/@changesets/config@3.0.0/schema.json",
  "changelog": "@changesets/cli/changelog",
  "commit": false,
  "fixed": [],
  "linked": [],
  "access": "public",
  "baseBranch": "main",
  "updateInternalDependencies": "patch",
  "ignore": []
}
```

- [ ] **Step 4: Add release scripts to `package.json`** — under `scripts`:

```json
"changeset": "changeset",
"version-packages": "changeset version",
"release": "pnpm run prepublishOnly && changeset publish"
```

- [ ] **Step 5: Create the first changeset for the 0.1.0 bump**

Run: `pnpm exec changeset add`

When prompted: select `@reddoor/maintenance`, mark as `minor`, summary: `Initial public release: configs, audits, recipes, inventory, CLI.`

This writes a file under `.changeset/<random>.md`.

- [ ] **Step 6: Commit**

```bash
git add .changeset package.json pnpm-lock.yaml
git commit -m "chore(release): initialize changesets for v0.1.0"
```

---

## Task 9: Release workflow

**Files:**

- Create: `.github/workflows/release.yml`

- [ ] **Step 1: Write `.github/workflows/release.yml`**

```yaml
name: release

on:
  push:
    branches: [main]

concurrency: ${{ github.workflow }}-${{ github.ref }}

jobs:
  release:
    runs-on: ubuntu-latest
    permissions:
      contents: write
      pull-requests: write
      id-token: write
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: pnpm/action-setup@v4
        with:
          version: 10.33.1

      - uses: actions/setup-node@v4
        with:
          node-version: "20"
          cache: pnpm
          registry-url: "https://registry.npmjs.org"

      - run: pnpm install --frozen-lockfile

      - run: pnpm typecheck
      - run: pnpm lint
      - run: pnpm build
      - run: pnpm test

      - name: Create release PR or publish
        uses: changesets/action@v1
        with:
          publish: pnpm run release
          version: pnpm run version-packages
          commit: "chore(release): version packages"
          title: "chore(release): version packages"
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          NPM_TOKEN: ${{ secrets.NPM_TOKEN }}
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "ci: add changesets release workflow (PR-or-publish on main)"
```

- [ ] **Step 3: Add the required secret on GitHub**

This step is manual and must be done by the repo owner:

1. Generate an npm automation token at https://www.npmjs.com/settings/<user>/tokens (type: "Automation"). Confirm the `@reddoor` scope exists on npm and the token has publish rights to it.
2. In the GitHub repo settings → Secrets and variables → Actions → New repository secret: `NPM_TOKEN` = the token from step 1.
3. Confirm `Settings → Actions → General → Workflow permissions` allows "Read and write" so the changesets action can open the version PR.

Do not commit anything for this step.

---

## Task 10: Pre-publish smoke + dry-run publish

- [ ] **Step 1: Full suite**

Run: `pnpm typecheck && pnpm lint && pnpm build && pnpm test`
Expected: every step exits 0.

- [ ] **Step 2: Confirm the published surface — `pnpm pack`**

Run: `pnpm pack`
Expected: creates `reddoor-maintenance-0.0.1.tgz` in the repo root.

Inspect: `tar -tzf reddoor-maintenance-0.0.1.tgz | sort`
Expected entries (at minimum):

- `package/dist/index.js`
- `package/dist/index.d.ts`
- `package/dist/cli/bin.js`
- `package/dist/configs/lighthouse.{js,d.ts}`
- `package/dist/configs/eslint.{js,d.ts}`
- `package/dist/configs/prettier.{js,d.ts}`
- `package/dist/configs/playwright-a11y.{js,d.ts}`
- `package/README.md`
- `package/package.json`

Remove the tarball: `rm reddoor-maintenance-0.0.1.tgz`

- [ ] **Step 3: Confirm changesets recognizes the pending release**

Run: `pnpm exec changeset status`
Expected: output mentions `@reddoor/maintenance` going to `0.1.0`.

- [ ] **Step 4: Tag the inventory+fleet+release milestone**

```bash
git tag -a v0.1.0-pre -m "All v1 plans complete; ready for first publish"
```

---

## Task 11: First publish (manual gate)

The actual publish happens via the GitHub Action on push to `main`. This task is the human gate: the repo owner pushes the branch, the action opens a "Version Packages" PR (or publishes directly when only changesets land), and the owner merges to trigger the npm release.

- [ ] **Step 1: Push the branch and tag**

```bash
git push origin main
git push origin v0.1.0-pre
```

- [ ] **Step 2: Watch the release workflow**

In GitHub Actions, observe the `release` job. Two outcomes:

- If there are pending changesets and no version bump yet: the action opens a "Version Packages" PR. Review and merge it; that merge triggers the actual publish.
- If the changeset has already been versioned in a prior PR: the action publishes immediately.

- [ ] **Step 3: Confirm npm**

Run (locally): `npm view @reddoor/maintenance version`
Expected: `0.1.0`

- [ ] **Step 4: Tag the public release**

```bash
git tag -a v0.1.0 -m "First public release of @reddoor/maintenance"
git push origin v0.1.0
```

---

## Definition of Done

- `localPath` and `fromJsonFile` providers exist, are public-API-exported, and have tests.
- `resolveSites` handles `[site]` only, `--fleet <json>`, `--fleet <js>`, and rejects the combination.
- `cloneIfNeeded` materializes missing sites via `git clone` and is testable with an injected spawn.
- The `audit`, `sync-configs`, `bump-deps`, and `upgrade` CLI commands all accept `--fleet` and `--workdir` and operate across multiple sites.
- The release workflow exists and uses changesets to gate version bumps + npm publishes.
- `@reddoor/maintenance@0.1.0` is published to npm.
- Tags `v0.1.0-pre` and `v0.1.0` exist (the latter pushed).
- All v1 spec requirements are satisfied across Foundation, Audits, Recipes, and Inventory+Fleet+Release plans.

## Out of scope (deferred future work — explicitly out of v1)

- Plugin / registry surface for third-party recipes.
- `@reddoor/maintenance-airtable` companion package (the ops repo wires Airtable via the JS escape hatch instead).
- `sync-configs` opt-out lockfile mechanism.
- Tagged real-tool integration tests for `lhci` and `playwright` (the CI-only test tier the spec mentions). Add these as a follow-up by creating `tests/integration/*.test.ts` files run via a `pnpm test:integration` script and skipped by the default `pnpm test`.
