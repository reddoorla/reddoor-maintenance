import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  parseEnvFile,
  loadCredentialsIntoEnv,
  defaultCredentialsPath,
} from "../../src/util/credentials.js";

describe("parseEnvFile", () => {
  it("parses simple KEY=value lines", () => {
    expect(parseEnvFile("FOO=bar\nBAZ=qux")).toEqual({ FOO: "bar", BAZ: "qux" });
  });

  it("ignores blank lines and # comments", () => {
    const src = `
# this is a comment
FOO=bar

# another comment
BAZ=qux
`;
    expect(parseEnvFile(src)).toEqual({ FOO: "bar", BAZ: "qux" });
  });

  it("strips surrounding double or single quotes", () => {
    expect(parseEnvFile("FOO=\"bar baz\"\nBAZ='qux quux'")).toEqual({
      FOO: "bar baz",
      BAZ: "qux quux",
    });
  });

  it("keeps inner = signs in the value", () => {
    expect(parseEnvFile("URL=https://example.com/path?q=v")).toEqual({
      URL: "https://example.com/path?q=v",
    });
  });

  it("trims whitespace around key and value", () => {
    expect(parseEnvFile("  FOO  =  bar  ")).toEqual({ FOO: "bar" });
  });

  it("rejects keys that don't match the dotenv identifier shape", () => {
    // Lines without `=`, lines starting with `=`, and keys with invalid
    // characters (`-`, `.`, leading digit) are dropped — the file is a
    // credential bag, not a config DSL. (They now also warn; see below.)
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(parseEnvFile("no-equals\n=value\nFOO-BAR=baz\n1FOO=baz")).toEqual({});
    warn.mockRestore();
  });

  it("handles CRLF line endings", () => {
    expect(parseEnvFile("FOO=bar\r\nBAZ=qux\r\n")).toEqual({ FOO: "bar", BAZ: "qux" });
  });

  it("parses `export KEY=value` lines (common hand-edit)", () => {
    expect(parseEnvFile('export AIRTABLE_PAT=pat123\nexport BAZ="q u x"')).toEqual({
      AIRTABLE_PAT: "pat123",
      BAZ: "q u x",
    });
  });

  it("still parses a plain KEY=value alongside an exported one", () => {
    expect(parseEnvFile("FOO=bar\nexport BAZ=qux")).toEqual({ FOO: "bar", BAZ: "qux" });
  });

  it("warns (with line number) on an unparseable non-blank, non-comment line", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // Line 2 is malformed (no `=`); line 1 and 3 are fine.
    expect(parseEnvFile("FOO=bar\nthis is broken\nBAZ=qux")).toEqual({ FOO: "bar", BAZ: "qux" });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toContain("line 2");
    expect(warn.mock.calls[0]![0]).toContain("this is broken");
    warn.mockRestore();
  });

  it("does NOT warn on blank lines or comments", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    parseEnvFile("\n# a comment\n\nFOO=bar\n");
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("defaultCredentialsPath", () => {
  const originalXdg = process.env.XDG_CONFIG_HOME;

  afterEach(() => {
    if (originalXdg === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = originalXdg;
  });

  it("respects $XDG_CONFIG_HOME when set", () => {
    process.env.XDG_CONFIG_HOME = "/tmp/xdg-test";
    expect(defaultCredentialsPath()).toBe("/tmp/xdg-test/reddoor-maint/credentials.env");
  });

  it("falls back to ~/.config when $XDG_CONFIG_HOME is unset", () => {
    delete process.env.XDG_CONFIG_HOME;
    const p = defaultCredentialsPath();
    expect(p).toMatch(/\.config\/reddoor-maint\/credentials\.env$/);
    expect(p.startsWith("/")).toBe(true);
  });
});

describe("loadCredentialsIntoEnv", () => {
  let tmp: string;
  const setVars: string[] = [];

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), "creds-test-"));
  });

  afterEach(async () => {
    for (const k of setVars) delete process.env[k];
    setVars.length = 0;
    await rm(tmp, { recursive: true });
  });

  it("returns [] silently when the file does not exist", () => {
    expect(loadCredentialsIntoEnv(join(tmp, "does-not-exist.env"))).toEqual([]);
  });

  it("sets keys that are not already in process.env", async () => {
    const p = join(tmp, "c.env");
    await writeFile(p, "REDDOOR_TEST_NEW_KEY_A=hello\nREDDOOR_TEST_NEW_KEY_B=world");
    setVars.push("REDDOOR_TEST_NEW_KEY_A", "REDDOOR_TEST_NEW_KEY_B");
    expect(loadCredentialsIntoEnv(p).sort()).toEqual([
      "REDDOOR_TEST_NEW_KEY_A",
      "REDDOOR_TEST_NEW_KEY_B",
    ]);
    expect(process.env.REDDOOR_TEST_NEW_KEY_A).toBe("hello");
    expect(process.env.REDDOOR_TEST_NEW_KEY_B).toBe("world");
  });

  it("does NOT override existing process.env values", async () => {
    process.env.REDDOOR_TEST_EXISTING = "shell-value";
    setVars.push("REDDOOR_TEST_EXISTING");
    const p = join(tmp, "c.env");
    await writeFile(p, "REDDOOR_TEST_EXISTING=file-value");
    expect(loadCredentialsIntoEnv(p)).toEqual([]);
    expect(process.env.REDDOOR_TEST_EXISTING).toBe("shell-value");
  });
});
