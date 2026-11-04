import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scanOutdated } from "../../src/audits/deps-outdated.js";
import {
  capsFromPreset,
  loadHoldRules,
  capsFromRules,
  fetchOrgPreset,
  orgPreset,
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
/** The org preset is `text`; other files in reddoorla/.github come from `others`. */
function reader(text: string | null = PRESET, others: Record<string, string> = {}): PresetReader {
  return async (file) => (file === "renovate-config.json" ? text : (others[file] ?? null));
}

const ORG = "github>reddoorla/.github:renovate-config";
const siteExtending = (...ext: string[]) => JSON.stringify({ extends: ext });

async function scan(s: Site, preset: string | null = PRESET) {
  const dir = await site(s);
  const { spawn, views } = spawnFor(s.outdated);
  const holds = await loadHoldRules(dir, reader(preset));
  return { result: await scanOutdated(dir, spawn, holds), views };
}

async function scanWith(s: Site, r: PresetReader) {
  const dir = await site(s);
  const { spawn } = spawnFor(s.outdated);
  return { result: await scanOutdated(dir, spawn, await loadHoldRules(dir, r)) };
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
    await orgPreset(counted);
    await orgPreset(counted);
    expect(reads).toBe(1);
  });

  it("keeps a failed read for the process: the reader retried already, so no site waits again", async () => {
    let reads = 0;
    const down: PresetReader = async () => {
      reads++;
      return null;
    };
    for (let n = 0; n < 3; n++) {
      const { result } = await scanWith({ outdated: TS6 }, down);
      expect(result).toMatchObject({ behind: ["typescript@6"], held: [] });
    }
    expect(reads).toBe(1);
  });

  it("counts it, and does not throw, when the reader throws", async () => {
    const { result } = await scanWith({ outdated: TS6 }, async () => {
      throw new Error("ECONNRESET");
    });
    expect(result).toMatchObject({ behind: ["typescript@6"], held: [] });
  });

  it("prints DEPS_PRESET_UNREAD once for an unread preset, and still counts typescript behind", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const { result } = await scan({ outdated: TS6 }, null);
      expect(result).toMatchObject({ behind: ["typescript@6"], held: [] });
      const unread = warn.mock.calls.filter((c) => String(c[0]).includes("DEPS_PRESET_UNREAD"));
      expect(unread).toHaveLength(1);
    } finally {
      warn.mockRestore();
    }
  });

  it.each([
    ["another owner's preset", "github>someone-else/.github:renovate-config"],
    ["another file in the org repo", "github>reddoorla/.github:renovate-staging-flow"],
    ["a tagged preset", "github>reddoorla/.github:renovate-config#v1"],
  ])("counts it when the site extends %s only", async (_label, ext) => {
    const { result } = await scan({ outdated: TS6, renovate: JSON.stringify({ extends: [ext] }) });
    expect(result).toMatchObject({ behind: ["typescript@6"], held: [] });
  });

  it("follows the config file Renovate reads: .github/renovate.json", async () => {
    const dir = await site({ outdated: TS6, renovate: null });
    await mkdir(join(dir, ".github"));
    await writeFile(
      join(dir, ".github", "renovate.json"),
      JSON.stringify({ extends: ["github>reddoorla/.github:renovate-config"] }),
    );
    const { spawn } = spawnFor(TS6);
    const result = await scanOutdated(dir, spawn, await loadHoldRules(dir, reader()));
    expect(result).toMatchObject({ held: ["typescript@6"] });
  });

  it("follows a renovate key in package.json", async () => {
    const dir = await site({ outdated: TS6, renovate: null });
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({ renovate: { extends: ["github>reddoorla/.github:renovate-config"] } }),
    );
    const { spawn } = spawnFor(TS6);
    const result = await scanOutdated(dir, spawn, await loadHoldRules(dir, reader()));
    expect(result).toMatchObject({ held: ["typescript@6"] });
  });

  it("counts it when the file Renovate reads does not parse, even beside a valid later one", async () => {
    const dir = await site({ outdated: TS6, renovate: "{ not json" });
    await writeFile(
      join(dir, ".renovaterc"),
      JSON.stringify({ extends: ["github>reddoorla/.github:renovate-config"] }),
    );
    const { spawn } = spawnFor(TS6);
    const result = await scanOutdated(dir, spawn, await loadHoldRules(dir, reader()));
    expect(result).toMatchObject({ behind: ["typescript@6"], held: [] });
  });

  it("counts it when the site's own rule lifts the cap", async () => {
    const { result } = await scan({
      outdated: TS6,
      renovate: JSON.stringify({
        extends: ["github>reddoorla/.github:renovate-config"],
        packageRules: [{ matchPackageNames: ["typescript"], allowedVersions: "<8.0.0" }],
      }),
    });
    expect(result).toMatchObject({ behind: ["typescript@6"], held: [] });
  });

  it("still holds when the site's own rules leave typescript alone", async () => {
    const { result } = await scan({
      outdated: TS6,
      renovate: JSON.stringify({
        extends: ["github>reddoorla/.github:renovate-config"],
        packageRules: [{ matchPackageNames: ["satori"], allowedVersions: "<1.0.0" }],
      }),
    });
    expect(result).toMatchObject({ behind: [], held: ["typescript@6"] });
  });

  it("takes the newest allowed version whatever order the registry lists them in", async () => {
    // Taking the last listed (5.9.3) would read the cap's top major as 5 and count it.
    const dir = await site({ outdated: TS6 });
    const spawn: SpawnFn = async (_c, args) =>
      args[0] === "view"
        ? { code: 0, stdout: JSON.stringify(["6.0.3", "6.0.2", "5.9.3"]), stderr: "" }
        : { code: 1, stdout: JSON.stringify(TS6), stderr: "" };
    const result = await scanOutdated(dir, spawn, await loadHoldRules(dir, reader()));
    expect(result).toMatchObject({ behind: [], held: ["typescript@6"] });
  });
});

describe("capsFromRules: Renovate's rule order", () => {
  const ts = (allowedVersions: string, extra: Record<string, unknown> = {}) => ({
    matchPackageNames: ["typescript"],
    allowedVersions,
    ...extra,
  });

  it("the last cap wins", () => {
    expect(capsFromRules([ts("<6.0.0"), ts("<7.0.0")])).toEqual(
      new Map([["typescript", "<7.0.0"]]),
    );
  });

  it("a later rule with no allowedVersions lifts nothing", () => {
    expect(
      capsFromRules([ts("<7.0.0"), { matchPackageNames: ["typescript"], rangeStrategy: "pin" }]),
    ).toEqual(new Map([["typescript", "<7.0.0"]]));
  });

  it.each([
    ["another matcher", { matchDepNames: ["typescript"], allowedVersions: "<8.0.0" }],
    ["a regex name", { matchPackageNames: ["/^typescript/"], allowedVersions: "<8.0.0" }],
    ["a glob name", { matchPackageNames: ["type*"], allowedVersions: "<8.0.0" }],
    ["a narrowed rule", ts("<8.0.0", { matchManagers: ["npm"] })],
  ])("a later cap reached through %s makes it unknown", (_label, rule) => {
    expect(capsFromRules([ts("<7.0.0"), rule])).toEqual(new Map());
  });

  it.each([
    ["matchDepTypes", { matchDepTypes: ["devDependencies"], allowedVersions: "<8.0.0" }],
    ["matchManagers alone", { matchManagers: ["npm"], allowedVersions: "<8.0.0" }],
    [
      "an exclusion of something else",
      { excludePackageNames: ["vite"], allowedVersions: "<8.0.0" },
    ],
    ["matchPackagePatterns", { matchPackagePatterns: ["^type"], allowedVersions: "<8.0.0" }],
    ["matchPackagePrefixes", { matchPackagePrefixes: ["type"], allowedVersions: "<8.0.0" }],
    ["no matcher at all", { allowedVersions: "<8.0.0" }],
    ["a negated name", { matchPackageNames: ["!vite"], allowedVersions: "<8.0.0" }],
    ["a brace glob", { matchPackageNames: ["{type,vite}script"], allowedVersions: "<8.0.0" }],
    ["a negated dep name", { matchDepNames: ["!vite"], allowedVersions: "<8.0.0" }],
  ])(
    "a later rule that might reach typescript without naming it (%s) makes the cap unknown",
    (_l, rule) => {
      expect(capsFromRules([ts("<7.0.0"), rule])).toEqual(new Map());
    },
  );

  it("a later rule for other named packages leaves the cap, whatever else it matches", () => {
    expect(
      capsFromRules([
        ts("<7.0.0"),
        { matchPackageNames: ["satori"], matchManagers: ["npm"], allowedVersions: "<1.0.0" },
        { matchDepNames: ["vite"], allowedVersions: "<8.0.0" },
      ]),
    ).toEqual(new Map([["typescript", "<7.0.0"]]));
  });

  it("an exclusion is a matcher too: the rule is not a fleet-wide hold", () => {
    expect(capsFromRules([ts("<7.0.0", { excludePackageNames: ["@types/node"] })])).toEqual(
      new Map(),
    );
  });
});

describe("capsFromRules: Renovate's legacy keys and name case (round 3)", () => {
  const CAP = { matchPackageNames: ["typescript"], allowedVersions: "<7.0.0" };
  const lifted = (rule: Record<string, unknown>) =>
    capsFromRules([CAP, { allowedVersions: "<8.0.0", ...rule }]).get("typescript");

  it.each([
    ["matchPackagePatterns", { matchPackageNames: ["eslint"], matchPackagePatterns: ["^type"] }],
    ["matchPackagePrefixes", { matchPackageNames: ["eslint"], matchPackagePrefixes: ["types"] }],
    ["matchDepPatterns", { matchDepNames: ["eslint"], matchDepPatterns: ["^type"] }],
    ["matchDepPrefixes", { matchDepNames: ["eslint"], matchDepPrefixes: ["type"] }],
    ["packagePatterns", { matchPackageNames: ["eslint"], packagePatterns: ["^type"] }],
    ["packageNames", { matchPackageNames: ["eslint"], packageNames: ["typescript"] }],
  ])("a name list with legacy %s lifts the cap (Renovate ORs it in)", (_k, rule) => {
    expect(lifted(rule)).toBeUndefined();
  });

  it("a name differing only in case lifts the cap (Renovate matches nocase)", () => {
    expect(lifted({ matchPackageNames: ["TypeScript"] })).toBeUndefined();
    expect(lifted({ matchDepNames: ["TYPESCRIPT"] })).toBeUndefined();
  });

  it.each([
    ["paths", { paths: ["apps/x/package.json"] }],
    ["managers", { managers: ["npm"] }],
    ["depTypeList", { depTypeList: ["devDependencies"] }],
    ["updateTypes", { updateTypes: ["major"] }],
    ["baseBranchList", { baseBranchList: ["staging"] }],
    ["languages", { languages: ["javascript"] }],
    ["datasources", { datasources: ["npm"] }],
  ])("a TypeScript cap narrowed by legacy %s is not a fleet-wide hold", (_k, extra) => {
    expect(capsFromRules([{ ...CAP, ...extra }]).get("typescript")).toBeUndefined();
  });

  it("a plain name list for another package still leaves the cap in force", () => {
    expect(lifted({ matchPackageNames: ["eslint"] })).toBe("<7.0.0");
  });
});

describe("every rule Renovate applies must be known", () => {
  const STAGING = "github>reddoorla/.github:renovate-staging-flow";

  it("holds when another org preset the site extends is read and leaves typescript alone", async () => {
    const dir = await site({ outdated: TS6, renovate: siteExtending(ORG, STAGING) });
    const { spawn } = spawnFor(TS6);
    const r = reader(PRESET, {
      "renovate-staging-flow.json": JSON.stringify({ baseBranchPatterns: ["staging"] }),
    });
    expect(await scanOutdated(dir, spawn, await loadHoldRules(dir, r))).toMatchObject({
      held: ["typescript@6"],
    });
  });

  it("counts it when another org preset the site extends cannot be read", async () => {
    const { result } = await scan({ outdated: TS6, renovate: siteExtending(ORG, STAGING) });
    expect(result).toMatchObject({ behind: ["typescript@6"], held: [] });
  });

  it("counts it when a later org preset lifts the cap", async () => {
    const dir = await site({ outdated: TS6, renovate: siteExtending(ORG, STAGING) });
    const { spawn } = spawnFor(TS6);
    const r = reader(PRESET, {
      "renovate-staging-flow.json": JSON.stringify({
        packageRules: [{ matchDepTypes: ["devDependencies"], allowedVersions: "<99.0.0" }],
      }),
    });
    expect(await scanOutdated(dir, spawn, await loadHoldRules(dir, r))).toMatchObject({
      behind: ["typescript@6"],
      held: [],
    });
  });

  it("counts it when the site also extends a preset outside reddoorla/.github", async () => {
    const { result } = await scan({
      outdated: TS6,
      renovate: siteExtending(ORG, "github>someone-else/presets:ts"),
    });
    expect(result).toMatchObject({ behind: ["typescript@6"], held: [] });
  });

  it("follows builtin presets as rule-free", async () => {
    const { result } = await scan({
      outdated: TS6,
      renovate: siteExtending("config:recommended", ORG),
    });
    expect(result).toMatchObject({ held: ["typescript@6"] });
  });

  it("counts it when the site sets ignorePresets", async () => {
    const { result } = await scan({
      outdated: TS6,
      renovate: JSON.stringify({ extends: [ORG], ignorePresets: [ORG] }),
    });
    expect(result).toMatchObject({ behind: ["typescript@6"], held: [] });
  });

  it("counts it when the site nests packageRules under a manager", async () => {
    const { result } = await scan({
      outdated: TS6,
      renovate: JSON.stringify({
        extends: [ORG],
        npm: { packageRules: [{ matchPackageNames: ["typescript"], allowedVersions: "*" }] },
      }),
    });
    expect(result).toMatchObject({ behind: ["typescript@6"], held: [] });
  });

  it("counts it when the org preset itself extends an unreadable org preset", async () => {
    const preset = JSON.stringify({
      extends: ["config:recommended", "github>reddoorla/.github:extra"],
      packageRules: [{ matchPackageNames: ["typescript"], allowedVersions: "<7.0.0" }],
    });
    const { result } = await scan({ outdated: TS6 }, preset);
    expect(result).toMatchObject({ behind: ["typescript@6"], held: [] });
  });

  it("counts it when a second org preset extends one that cannot be read", async () => {
    const dir = await site({ outdated: TS6, renovate: siteExtending(ORG, STAGING) });
    const { spawn } = spawnFor(TS6);
    const r = reader(PRESET, {
      "renovate-staging-flow.json": JSON.stringify({ extends: ["github>reddoorla/.github:extra"] }),
    });
    expect(await scanOutdated(dir, spawn, await loadHoldRules(dir, r))).toMatchObject({
      behind: ["typescript@6"],
      held: [],
    });
  });

  it("counts a site already above the cap", async () => {
    const { result } = await scan({
      outdated: { typescript: { current: "7.0.2", latest: "8.0.1" } },
    });
    expect(result).toMatchObject({ behind: ["typescript@7"], held: [] });
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

  it.each(["lts/*", "lts/jod", "node", ">=22"])(
    "counts it when .nvmrc is %j: the alias decides the runtime, so engines.node is not read",
    async (nvmrc) => {
      const { result } = await scan({ outdated: types("24.10.1"), nvmrc, engines: "24.x" });
      expect(result).toMatchObject({ behind: ["@types/node@24"], held: [] });
    },
  );

  it("falls back to engines.node when .nvmrc is blank", async () => {
    const { result } = await scan({ outdated: types("24.10.1"), nvmrc: "\n", engines: "24.x" });
    expect(result).toMatchObject({ behind: [], held: ["@types/node@24"] });
  });

  it("counts it when engines.node admits two majors (^24 || ^26)", async () => {
    const { result } = await scan({ outdated: types("24.10.1"), engines: "^24.0.0 || ^26.0.0" });
    expect(result).toMatchObject({ behind: ["@types/node@24"], held: [] });
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

  it("uses the injected preset: one with no cap holds nothing", async () => {
    const dir = await site({ outdated: {}, nvmrc: "24" });
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({ devDependencies: { typescript: "^6.0.2" } }),
    );
    const { spawn } = spawnFor(TS6);
    const result = await depsAudit({
      site: { name: "held", path: dir } as never,
      spawn,
      renovatePreset: reader(JSON.stringify({ packageRules: [] })),
    });
    expect((result.details as { outdated: unknown }).outdated).toEqual({
      outdated: 1,
      major: 1,
      behind: ["typescript@6"],
      held: [],
    });
  });
});

describe("fetchOrgPreset: the network reader (P1-98 review)", () => {
  const URL_OK = "https://raw.githubusercontent.com/reddoorla/.github/HEAD/renovate-config.json";
  const ok = (text: string) =>
    ({ ok: true, status: 200, text: async () => text }) as unknown as Response;
  const fail = () => ({ ok: false, status: 503, text: async () => "down" }) as unknown as Response;

  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("fetches the org preset from the default branch's HEAD, by its file name", async () => {
    const fetchMock = vi.fn(async (_url: string) => ok("{}"));
    vi.stubGlobal("fetch", fetchMock);
    expect(await fetchOrgPreset("renovate-config.json")).toBe("{}");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0]).toBe(URL_OK);
  });

  it("fetches another file of the org repo from that file's own path", async () => {
    const fetchMock = vi.fn(async (_url: string) => ok("{}"));
    vi.stubGlobal("fetch", fetchMock);
    expect(await fetchOrgPreset("renovate-staging-flow.json")).toBe("{}");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0]).toBe(
      "https://raw.githubusercontent.com/reddoorla/.github/HEAD/renovate-staging-flow.json",
    );
  });

  it("retries after a failed attempt, 2 s later, and returns the retry's text", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("ECONNRESET"))
      .mockResolvedValueOnce(ok("X"));
    vi.stubGlobal("fetch", fetchMock);
    const p = fetchOrgPreset("renovate-config.json");
    await vi.advanceTimersByTimeAsync(2_000);
    expect(await p).toBe("X");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries after a non-ok response too", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(fail()).mockResolvedValueOnce(ok("X"));
    vi.stubGlobal("fetch", fetchMock);
    const p = fetchOrgPreset("renovate-config.json");
    await vi.advanceTimersByTimeAsync(2_000);
    expect(await p).toBe("X");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("gives up after exactly three attempts and returns null", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("ECONNRESET"));
    vi.stubGlobal("fetch", fetchMock);
    const p = fetchOrgPreset("renovate-config.json");
    await vi.advanceTimersByTimeAsync(6_000);
    expect(await p).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

describe("org preset references: foreign, cycles, case and other files (P1-98 review)", () => {
  const STAGING = "github>reddoorla/.github:renovate-staging-flow";

  it("counts it when the site also extends a foreign preset whose file name is the org's", async () => {
    const { result } = await scan({
      outdated: TS6,
      renovate: siteExtending(ORG, "github>someone-else/presets:renovate-config"),
    });
    expect(result).toMatchObject({ behind: ["typescript@6"], held: [] });
  });

  it("counts it when the site extends another org-repo file that itself caps typescript", async () => {
    const dir = await site({ outdated: TS6, renovate: siteExtending(STAGING) });
    const { spawn } = spawnFor(TS6);
    const r = reader(PRESET, {
      "renovate-staging-flow.json": JSON.stringify({
        packageRules: [{ matchPackageNames: ["typescript"], allowedVersions: "<7.0.0" }],
      }),
    });
    expect(await scanOutdated(dir, spawn, await loadHoldRules(dir, r))).toMatchObject({
      behind: ["typescript@6"],
      held: [],
    });
  });

  it("counts it, and returns, when a preset in the org repo extends itself", async () => {
    const self = JSON.stringify({
      extends: [ORG],
      packageRules: [{ matchPackageNames: ["typescript"], allowedVersions: "<7.0.0" }],
    });
    const { result } = await scan({ outdated: TS6 }, self);
    expect(result).toMatchObject({ behind: ["typescript@6"], held: [] });
  });

  it("counts it, and returns, when presets in the org repo extend one another without end", async () => {
    // Each file is distinct, so the per-file memo never cuts the walk short: only the
    // depth guard can. Past 50 reads the reader throws, so a missing guard fails the
    // call-count bound below rather than hanging the run on microtasks.
    let calls = 0;
    const chain: PresetReader = async (file) => {
      calls++;
      if (calls > 50) throw new Error("walked past 50 presets: no depth guard");
      if (file === "renovate-config.json")
        return JSON.stringify({ extends: ["github>reddoorla/.github:c0"] });
      const n = Number(/^c(\d+)\.json$/.exec(file)?.[1]);
      return JSON.stringify({ extends: [`github>reddoorla/.github:c${n + 1}`] });
    };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const { result } = await scanWith({ outdated: TS6 }, chain);
      expect(result).toMatchObject({ behind: ["typescript@6"], held: [] });
      expect(calls).toBeLessThanOrEqual(10);
    } finally {
      warn.mockRestore();
    }
  }, 5_000);

  it("holds when the site extends the org preset under a mixed-case owner name", async () => {
    const { result } = await scan({
      outdated: TS6,
      renovate: siteExtending("github>RedDoorLA/.github:renovate-config"),
    });
    expect(result).toMatchObject({ held: ["typescript@6"] });
  });
});

describe("Renovate shapes the audit does not model leave the cap unknown (round 4)", () => {
  const LIFT = "github>reddoorla/.github:lift";
  it("an extglob name may reach typescript (minimatch extglob)", () => {
    for (const name of ["@(typescript|eslint)", "+(typescript)"]) {
      const caps = capsFromRules([
        { matchPackageNames: ["typescript"], allowedVersions: "<7.0.0" },
        { matchPackageNames: [name], allowedVersions: "<8.0.0" },
      ]);
      expect(caps.get("typescript")).toBeUndefined();
    }
  });

  it("a plain scoped name for another package still leaves the cap in force", () => {
    const caps = capsFromRules([
      { matchPackageNames: ["typescript"], allowedVersions: "<7.0.0" },
      { matchPackageNames: ["@types/node", "svelte-check"], allowedVersions: "<25.0.0" },
    ]);
    expect(caps.get("typescript")).toBe("<7.0.0");
  });

  it.each([
    ["devDependencies", { devDependencies: { allowedVersions: "<8.0.0" } }],
    ["packages", { packages: [{ matchPackageNames: ["typescript"], allowedVersions: "<8.0.0" }] }],
    ["pathRules", { pathRules: [{ paths: ["package.json"], allowedVersions: "<8.0.0" }] }],
    ["depTypes", { depTypes: [{ depType: "devDependencies", allowedVersions: "<8.0.0" }] }],
  ])(
    "a legacy top-level %s, which Renovate migrates into packageRules, counts it",
    async (_k, extra) => {
      const { result } = await scan({
        outdated: TS6,
        renovate: JSON.stringify({ extends: [ORG], ...extra }),
      });
      expect(result).toMatchObject({ behind: ["typescript@6"], held: [] });
    },
  );

  it("an extends inside a packageRule counts it (Renovate resolves it)", async () => {
    const r = reader(PRESET, { "lift.json": JSON.stringify({ allowedVersions: "<8.0.0" }) });
    const { result } = await scanWith(
      {
        outdated: TS6,
        renovate: JSON.stringify({
          extends: [ORG],
          packageRules: [{ matchPackageNames: ["typescript"], extends: [LIFT] }],
        }),
      },
      r,
    );
    expect(result).toMatchObject({ behind: ["typescript@6"], held: [] });
  });

  it("an extends under a manager block counts it (it can bring packageRules)", async () => {
    const r = reader(PRESET, {
      "lift.json": JSON.stringify({
        packageRules: [{ matchPackageNames: ["typescript"], allowedVersions: "<8.0.0" }],
      }),
    });
    const { result } = await scanWith(
      { outdated: TS6, renovate: JSON.stringify({ extends: [ORG], npm: { extends: [LIFT] } }) },
      r,
    );
    expect(result).toMatchObject({ behind: ["typescript@6"], held: [] });
  });

  it("an ordinary nested object (lockFileMaintenance) still holds", async () => {
    const { result } = await scan({
      outdated: TS6,
      renovate: JSON.stringify({
        extends: [ORG],
        lockFileMaintenance: { enabled: true, schedule: ["before 5am on monday"] },
      }),
    });
    expect(result).toMatchObject({ behind: [], held: ["typescript@6"] });
  });
});
