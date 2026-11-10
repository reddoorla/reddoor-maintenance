// Dependency-boundary check for the light subpath: every module under
// src/video-pipeline/ (not node/) imports only node:crypto or its own siblings.
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const dir = join(dirname(fileURLToPath(import.meta.url)), "../../src/video-pipeline");

describe("video-pipeline: dependency boundary", () => {
  const files = readdirSync(dir).filter((f) => f.endsWith(".ts"));

  it("finds the light modules", () => {
    expect(files).toEqual(
      expect.arrayContaining([
        "index.ts",
        "key.ts",
        "manifest.ts",
        "classify.ts",
        "webhook.ts",
        "dispatch.ts",
        "relay.ts",
        "stuck.ts",
      ]),
    );
  });

  it("every import is node:crypto or a relative sibling", () => {
    const specs: { file: string; spec: string }[] = [];
    for (const file of files) {
      const text = readFileSync(join(dir, file), "utf-8");
      for (const m of text.matchAll(/^\s*(?:import|export)\b[^'"`]*?from\s+["']([^"']+)["']/gm)) {
        specs.push({ file, spec: m[1]! });
      }
    }
    expect(specs.length).toBeGreaterThan(0);
    const bad = specs.filter(({ spec }) => spec !== "node:crypto" && !spec.startsWith("./"));
    expect(bad).toEqual([]);
  });
});
