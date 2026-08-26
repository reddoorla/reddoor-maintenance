// `db restore` built its libSQL client with a url and NO auth token, so the
// documented invocation returned a bare `SERVER_ERROR: Server returned HTTP
// status 401` against any real hosted Turso database — i.e. against the only
// kind of target a real recovery has.
//
// The nightly rehearsal could never catch it: it restores into `:memory:`, and
// the 2026-08-26 manual rehearsal used a local `turso dev`, both of which
// require no auth at all. It was found by pointing the shipped command at an
// actual hosted database for the first time.
//
// A restore path that 401s is the worst possible thing to discover during a
// recovery, so it now refuses BEFORE the network with a named reason.
import { describe, it, expect } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { requiresAuthToken } from "../../src/db/dump.js";
import { runDbCommand } from "../../src/cli/commands/db.js";

describe("requiresAuthToken", () => {
  it("requires a token for hosted targets", () => {
    for (const url of [
      "libsql://reddoor-fleet-tucksravin.aws-us-west-2.turso.io",
      "https://reddoor-fleet-tucksravin.aws-us-west-2.turso.io",
      "wss://reddoor-fleet-tucksravin.aws-us-west-2.turso.io",
    ]) {
      expect(requiresAuthToken(url), url).toBe(true);
    }
  });

  it("does not require a token for local or in-process targets", () => {
    // `turso dev` and the in-memory scratch engine take no auth; demanding a
    // token for them would break the nightly rehearsal this guard protects.
    for (const url of [
      ":memory:",
      "file:local.db",
      "http://127.0.0.1:8099",
      "http://localhost:8080",
      "ws://[::1]:8080",
    ]) {
      expect(requiresAuthToken(url), url).toBe(false);
    }
  });

  it("treats an unparseable url as needing a token", () => {
    // Fail closed: a url shape we cannot classify must not silently skip auth
    // and resurface as an opaque 401.
    expect(requiresAuthToken("not a url")).toBe(true);
  });
});

describe("db restore — auth", () => {
  it("refuses a hosted target with no token, before touching the network", async () => {
    const r = await runDbCommand(
      "restore",
      { url: "libsql://example-org.turso.io", file: "/nonexistent-should-not-be-read.sql" },
      { restoreAuthToken: "" },
    );
    expect(r.code).toBe(1);
    expect(r.output).toBe("RESTORE refused=auth-token-absent");
  });

  // The refusal must come BEFORE the file read, so the failure names the real
  // problem rather than an ENOENT that sends you hunting for the dump.
  it("names the missing token rather than the missing file", async () => {
    const r = await runDbCommand(
      "restore",
      { url: "libsql://example-org.turso.io", file: "/nonexistent-should-not-be-read.sql" },
      { restoreAuthToken: "" },
    );
    expect(r.output).not.toMatch(/ENOENT|no such file/i);
  });

  it("still refuses a missing --url first — production stays out of reach", async () => {
    const r = await runDbCommand("restore", { file: "x.sql" }, { restoreAuthToken: "" });
    expect(r.code).toBe(1);
    expect(r.output).toMatch(/pass the TARGET database via --url/);
  });

  it("does not demand a token for a local target", async () => {
    // A real file with no manifest: reaching `manifest-absent` proves the auth
    // guard let a local url through AND that the dump was actually read.
    const dir = await mkdtemp(join(tmpdir(), "restore-auth-"));
    const file = join(dir, "no-manifest.sql");
    await writeFile(file, "CREATE TABLE t (a);\n", "utf-8");
    const r = await runDbCommand(
      "restore",
      { url: "http://127.0.0.1:1", file },
      { restoreAuthToken: "" },
    );
    expect(r.output).toBe("RESTORE refused=manifest-absent");
  });
});
