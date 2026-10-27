import { describe, it, expect } from "vitest";
import {
  mergeGitignore,
  findTrackedArtifacts,
  CANONICAL_GITIGNORE_ENTRIES,
  MANAGED_MARKER,
} from "../../../src/recipes/sync-configs/gitignore.js";

describe("CANONICAL_GITIGNORE_ENTRIES", () => {
  it("contains the SvelteKit build artifacts we want untracked across the fleet", () => {
    expect(CANONICAL_GITIGNORE_ENTRIES).toEqual(
      expect.arrayContaining([
        "node_modules/",
        "build/",
        "dist/",
        ".svelte-kit/",
        "coverage/",
        "playwright-report/",
        "test-results/",
        ".lighthouseci/",
        ".env",
        ".env.*",
        "!.env.example",
        ".DS_Store",
      ]),
    );
  });

  // The a11y audit writes a transient `.reddoor-a11y-spec-<rand>/` dir INSIDE
  // the site checkout (so the spec's `import @axe-core/playwright` resolves via
  // the site's node_modules). It's cleaned on the catchable paths, but a
  // timeout-SIGKILL of the parent leaves it behind — untracked files in a repo
  // whose self-updating CI checks for a clean tree. The fleet must ignore it.
  // (morning-brief 2026-06-10 MEDIUM-D; recurred from 06-05 M3.)
  it("ignores the a11y audit's transient spec dirs across the fleet", () => {
    expect(CANONICAL_GITIGNORE_ENTRIES).toContain(".reddoor-a11y-spec-*/");
  });
});

describe("mergeGitignore", () => {
  it("writes the canonical block when no .gitignore exists", () => {
    const result = mergeGitignore(null, ["build/", "dist/"]);
    expect(result.added).toEqual(["build/", "dist/"]);
    expect(result.content).toContain("build/");
    expect(result.content).toContain("dist/");
    expect(result.content).toContain(MANAGED_MARKER);
  });

  it("returns added=[] when every canonical entry is already present", () => {
    const existing = "node_modules/\nbuild/\ndist/\n";
    const result = mergeGitignore(existing, ["build/", "dist/"]);
    expect(result.added).toEqual([]);
    expect(result.content).toBe(existing);
  });

  it("appends only missing canonical entries, preserving existing content", () => {
    const existing = "node_modules/\nbuild/\n";
    const result = mergeGitignore(existing, ["build/", "dist/", ".svelte-kit/"]);
    expect(result.added).toEqual(["dist/", ".svelte-kit/"]);
    expect(result.content.startsWith("node_modules/\nbuild/\n")).toBe(true);
    expect(result.content).toContain("dist/");
    expect(result.content).toContain(".svelte-kit/");
    expect(result.content).toContain(MANAGED_MARKER);
  });

  it("treats `/build`, `build`, `build/`, and `/build/` as equivalent presence", () => {
    const variants = ["/build", "build", "/build/", "build/"];
    for (const v of variants) {
      const result = mergeGitignore(`${v}\n`, ["build/"]);
      expect(result.added).toEqual([]);
    }
  });

  it("ignores blank lines and comments when checking presence", () => {
    const existing = "# site entries\n\nbuild/\n\n# more\ndist/\n";
    const result = mergeGitignore(existing, ["build/", "dist/"]);
    expect(result.added).toEqual([]);
  });

  it("normalizes trailing whitespace when comparing", () => {
    const existing = "build/   \ndist/\n";
    const result = mergeGitignore(existing, ["build/"]);
    expect(result.added).toEqual([]);
  });

  it("re-running on its own previous output is a noop", () => {
    const first = mergeGitignore(null, CANONICAL_GITIGNORE_ENTRIES);
    expect(first.added).toEqual([...CANONICAL_GITIGNORE_ENTRIES]);
    const second = mergeGitignore(first.content, CANONICAL_GITIGNORE_ENTRIES);
    expect(second.added).toEqual([]);
    expect(second.content).toBe(first.content);
  });

  it("ensures the existing content ends with a newline before appending", () => {
    const existing = "node_modules/";
    const result = mergeGitignore(existing, ["build/"]);
    expect(result.content).toMatch(/^node_modules\/\n/);
    expect(result.content).toContain("build/");
  });
});

describe("findTrackedArtifacts", () => {
  it("returns tracked paths sitting under a canonical directory entry", () => {
    const tracked = ["build/index.html", "src/app.ts"];
    const canonical = ["build/", "dist/"];
    expect(findTrackedArtifacts(tracked, canonical)).toEqual(["build/index.html"]);
  });

  it("matches nested paths under directory entries", () => {
    const tracked = [
      ".svelte-kit/generated/index.ts",
      ".svelte-kit/output/server/index.js",
      "src/app.ts",
    ];
    const canonical = [".svelte-kit/"];
    expect(findTrackedArtifacts(tracked, canonical).sort()).toEqual([
      ".svelte-kit/generated/index.ts",
      ".svelte-kit/output/server/index.js",
    ]);
  });

  it("treats `/build/`-style root entries the same as `build/`", () => {
    const tracked = ["build/index.html"];
    expect(findTrackedArtifacts(tracked, ["/build/"])).toEqual(["build/index.html"]);
  });

  it("skips file-pattern entries (we only auto-untrack directories)", () => {
    const tracked = [".env", "app.log", ".DS_Store"];
    const canonical = [".env", "*.log", ".DS_Store"];
    expect(findTrackedArtifacts(tracked, canonical)).toEqual([]);
  });

  it("skips negation entries entirely", () => {
    const tracked = ["build/keep.html"];
    expect(findTrackedArtifacts(tracked, ["!build/keep.html"])).toEqual([]);
  });

  it("returns [] when no tracked files match", () => {
    const tracked = ["src/app.ts", "package.json"];
    const canonical = ["build/", "dist/"];
    expect(findTrackedArtifacts(tracked, canonical)).toEqual([]);
  });

  it("does not match `build-tools/foo.ts` against `build/`", () => {
    const tracked = ["build-tools/foo.ts"];
    expect(findTrackedArtifacts(tracked, ["build/"])).toEqual([]);
  });
});
