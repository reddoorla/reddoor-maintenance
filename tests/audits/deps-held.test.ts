import { describe, it, expect } from "vitest";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanOutdated } from "../../src/audits/deps-outdated.js";
import {
  capsFromPreset,
  loadHoldRules,
  orgPresetCaps,
  pinnedMajor,
  siteNodeMajor,
  type PresetReader,
} from "../../src/audits/deps-held.js";
import { depsAudit } from "../../src/audits/deps.js";
import type { SpawnFn } from "../../src/audits/util/spawn.js";

/** The org preset's three `allowedVersions` rules as they stood on 2026-11-04
 *  (`reddoorla/.github` `renovate-config.json` packageRules[9..11]), plus a
 *  rule narrowed by manager that must not count as a fleet-wide hold. */
const PRESET = JSON.stringify({
  extends: ["config:recommended"],
  packageRules: [
    { matchPackageNames: ["typescript"], allowedVersions: "<7.0.0" },
    { matchPackageNames: ["@libsql/client"], allowedVersions: "<0.9.0" },
    { matchPackageNames: ["cookie"], allowedVersions: "<2.0.0" },
    { matchManagers: ["npm"], matchPackageNames: ["vite"], allowedVersions: "<7.0.0" },
  ],
});

/** A registry with these versions published. `pnpm view pkg@<N.0.0 version --json`
 *  is answered by filtering; any other range form fails, as an unknown would. */
const REGISTRY: Record<string, string[]> = {
  typescript: ["5.9.3", "6.0.2", "6.0.3", "7.0.2"],
  vite: ["6.3.0", "7.1.0"],
};

type Site = {
  outdated: Record<string, { current: string; latest: string }>;
  renovate?: string | null;
  nvmrc?: string;
  engines?: string;
};

async function site(s: Site): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "reddoor-held-"));
  const pkg: Record<string, unknown> = {};
  if (s.engines !== undefined) pkg["engines"] = { node: s.engines };
  await writeFile(join(dir, "package.json"), JSON.stringify(pkg), "utf-8");
  await writeFile(join(dir, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n", "utf-8");
  await mkdir(join(dir, "node_modules"));
  const renovate =
    s.renovate === undefined
      ? JSON.stringify({ extends: ["github>reddoorla/.github:renovate-config"] })
      : s.renovate;
  if (renovate !== null) await writeFile(join(dir, "renovate.json"), renovate, "utf-8");
  if (s.nvmrc !== undefined) await writeFile(join(dir, ".nvmrc"), s.nvmrc, "utf-8");
  return dir;
}

function spawnFor(outdated: Site["outdated"]): { spawn: SpawnFn; views: string[] } {
  const views: string[] = [];
  const spawn: SpawnFn = async (_cmd, args) => {
    if (args[0] === "outdated") return { code: 1, stdout: JSON.stringify(outdated), stderr: "" };
    if (args[0] === "view") {
      views.push(args[1]!);
      const m = /^(.+)@<(\d+)\.0\.0$/.exec(args[1]!);
      if (!m || !REGISTRY[m[1]!]) return { code: 1, stdout: "", stderr: "E404" };
      const allowed = REGISTRY[m[1]!]!.filter((v) => Number.parseInt(v, 10) < Number(m[2]));
      return { code: 0, stdout: JSON.stringify(allowed), stderr: "" };
    }
    throw new Error(`unexpected spawn: ${args.join(" ")}`);
  };
  return { spawn, views };
}

/** A fresh reader per call, so the per-process memo never leaks between tests. */
function reader(text: string | null = PRESET): PresetReader {
  return async () => text;
}

async function scan(s: Site, preset: string | null = PRESET) {
  const dir = await site(s);
  const { spawn, views } = spawnFor(s.outdated);
  const holds = await loadHoldRules(dir, reader(preset));
  return { result: await scanOutdated(dir, spawn, holds), views };
}

const TS6 = { typescript: { current: "6.0.2", latest: "7.0.2" } };

describe("capsFromPreset", () => {
  it("reads the TypeScript cap, and only eligible packages with a plain name rule", () => {
    expect(capsFromPreset(JSON.parse(PRESET))).toEqual(new Map([["typescript", "<7.0.0"]]));
  });

  it("covers another capped package only when it is named eligible", () => {
    expect(capsFromPreset(JSON.parse(PRESET), ["typescript", "cookie", "vite"])).toEqual(
      new Map([
        ["typescript", "<7.0.0"],
        ["cookie", "<2.0.0"],
      ]),
    );
  });
});

describe("held by the preset's allowedVersions cap", () => {
  it("holds typescript@6 when 7 is outside <7.0.0 and 6 is the newest major allowed", async () => {
    const { result, views } = await scan({ outdated: TS6 });
    expect(result).toEqual({ outdated: 1, major: 0, behind: [], held: ["typescript@6"] });
    expect(views).toEqual(["typescript@<7.0.0"]);
  });

  it("still counts typescript@5: the cap allows 6, so the site is really behind", async () => {
    const { result } = await scan({
      outdated: { typescript: { current: "5.9.3", latest: "7.0.2" } },
    });
    expect(result).toMatchObject({ major: 1, behind: ["typescript@5"], held: [] });
  });

  it("counts it when the preset cannot be read", async () => {
    const { result } = await scan({ outdated: TS6 }, null);
    expect(result).toMatchObject({ behind: ["typescript@6"], held: [] });
  });

  it("counts it when the site does not extend the org preset", async () => {
    const { result } = await scan({
      outdated: TS6,
      renovate: JSON.stringify({ extends: ["config:recommended"] }),
    });
    expect(result).toMatchObject({ behind: ["typescript@6"], held: [] });
  });

  it("counts it when the site has no Renovate config at all", async () => {
    const { result } = await scan({ outdated: TS6, renovate: null });
    expect(result).toMatchObject({ behind: ["typescript@6"], held: [] });
  });

  it("counts it when the cap is a regex this audit does not evaluate", async () => {
    const preset = JSON.stringify({
      packageRules: [{ matchPackageNames: ["typescript"], allowedVersions: "/^6\\./" }],
    });
    const { result, views } = await scan({ outdated: TS6 }, preset);
    expect(result).toMatchObject({ behind: ["typescript@6"], held: [] });
    expect(views).toEqual([]);
  });

  it("does not hold a package the preset caps under a narrowed rule", async () => {
    const { result } = await scan({ outdated: { vite: { current: "6.3.0", latest: "7.1.0" } } });
    expect(result).toMatchObject({ behind: ["vite@6"], held: [] });
  });

  it("reads the preset once per process for the same reader", async () => {
    let reads = 0;
    const counted: PresetReader = async () => {
      reads++;
      return PRESET;
    };
    await orgPresetCaps(counted);
    await orgPresetCaps(counted);
    expect(reads).toBe(1);
  });
});

describe("@types/node held at the runtime major", () => {
  const types = (current: string) => ({ "@types/node": { current, latest: "26.0.0" } });

  it("holds @types/node@24 on a Node 24 site (.nvmrc)", async () => {
    const { result } = await scan({ outdated: types("24.10.1"), nvmrc: "24.22.1\n" });
    expect(result).toEqual({ outdated: 1, major: 0, behind: [], held: ["@types/node@24"] });
  });

  it("counts @types/node@25 on a Node 24 site: ahead of the runtime is not held", async () => {
    const { result } = await scan({ outdated: types("25.0.3"), nvmrc: "24" });
    expect(result).toMatchObject({ behind: ["@types/node@25"], held: [] });
  });

  it("counts @types/node@22 on a Node 24 site: behind the runtime is not held", async () => {
    const { result } = await scan({ outdated: types("22.1.0"), nvmrc: "v24" });
    expect(result).toMatchObject({ behind: ["@types/node@22"], held: [] });
  });

  it("counts it when the runtime cannot be read (no .nvmrc, no engines.node)", async () => {
    const { result } = await scan({ outdated: types("24.10.1") });
    expect(result).toMatchObject({ behind: ["@types/node@24"], held: [] });
  });

  it("falls back to engines.node when .nvmrc is missing", async () => {
    const { result } = await scan({ outdated: types("24.10.1"), engines: "^24.0.0" });
    expect(result).toMatchObject({ behind: [], held: ["@types/node@24"] });
  });

  it("falls back to engines.node when .nvmrc names no major (lts/*)", async () => {
    const { result } = await scan({ outdated: types("24.10.1"), nvmrc: "lts/*", engines: "24.x" });
    expect(result).toMatchObject({ behind: [], held: ["@types/node@24"] });
  });

  it("counts it when engines.node is an open range (>=24 admits 25)", async () => {
    const { result } = await scan({ outdated: types("24.10.1"), engines: ">=24" });
    expect(result).toMatchObject({ behind: ["@types/node@24"], held: [] });
  });

  it("needs no preset: the runtime hold applies on a site with no Renovate config", async () => {
    const { result } = await scan(
      { outdated: types("24.10.1"), nvmrc: "24", renovate: null },
      null,
    );
    expect(result).toMatchObject({ behind: [], held: ["@types/node@24"] });
  });
});

describe("runtime major parsing", () => {
  it.each([
    ["24", 24],
    ["v24.1.0", 24],
    ["24.22.1\n", 24],
    ["24.x", 24],
    ["^24.0.0", 24],
    ["~24.2", 24],
    [">=24", null],
    [">=20 <25", null],
    ["lts/*", null],
    ["node", null],
    ["", null],
  ])("%j pins %j", (spec, major) => {
    expect(pinnedMajor(spec)).toBe(major);
  });

  it("reads nothing from an empty directory", async () => {
    const dir = await mkdtemp(join(tmpdir(), "reddoor-held-empty-"));
    expect(await siteNodeMajor(dir)).toBeNull();
  });
});

describe("the deps audit end to end", () => {
  it("keeps held packages out of the major count and names them in the summary", async () => {
    const dir = await site({
      outdated: {},
      nvmrc: "24",
    });
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({
        devDependencies: { typescript: "^6.0.2", "@types/node": "^24.10.1", vitest: "^3.2.0" },
      }),
      "utf-8",
    );
    const { spawn } = spawnFor({
      typescript: { current: "6.0.2", latest: "7.0.2" },
      "@types/node": { current: "24.10.1", latest: "26.0.0" },
      vitest: { current: "3.2.0", latest: "4.0.1" },
    });
    const result = await depsAudit({
      site: { name: "held", path: dir } as never,
      spawn,
      renovatePreset: reader(),
    });
    const { outdated } = result.details as { outdated: Record<string, unknown> };
    expect(outdated).toEqual({
      outdated: 3,
      major: 1,
      behind: ["vitest@3"],
      held: ["@types/node@24", "typescript@6"],
    });
    expect(result.summary).toContain("(1 major); held on purpose: @types/node@24, typescript@6");
  });
});
