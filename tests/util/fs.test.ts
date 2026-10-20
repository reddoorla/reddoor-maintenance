import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathExists, readJsonIfExists, readTextIfExists } from "../../src/util/fs.js";

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "util-fs-"));
  await writeFile(join(dir, "a.txt"), "hello");
  await writeFile(join(dir, "good.json"), '{"n":1}');
  await writeFile(join(dir, "bad.json"), "{not json");
  await mkdir(join(dir, "sub"));
  await symlink(join(dir, "nowhere"), join(dir, "dangling"));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("pathExists", () => {
  it("is true for a file and for a directory", async () => {
    expect(await pathExists(join(dir, "a.txt"))).toBe(true);
    expect(await pathExists(join(dir, "sub"))).toBe(true);
  });

  it("is false for a missing path and for a symlink whose target is missing", async () => {
    expect(await pathExists(join(dir, "missing"))).toBe(false);
    expect(await pathExists(join(dir, "dangling"))).toBe(false);
  });
});

describe("readTextIfExists", () => {
  it("returns the file's text, or null when it cannot be read", async () => {
    expect(await readTextIfExists(join(dir, "a.txt"))).toBe("hello");
    expect(await readTextIfExists(join(dir, "missing"))).toBeNull();
    expect(await readTextIfExists(join(dir, "sub"))).toBeNull();
  });
});

describe("readJsonIfExists", () => {
  it("parses the file, or returns null when it is missing or not JSON", async () => {
    expect(await readJsonIfExists<{ n: number }>(join(dir, "good.json"))).toEqual({ n: 1 });
    expect(await readJsonIfExists(join(dir, "missing.json"))).toBeNull();
    expect(await readJsonIfExists(join(dir, "bad.json"))).toBeNull();
  });
});
