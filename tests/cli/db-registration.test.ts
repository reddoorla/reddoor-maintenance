// The CLI surface of `db <action>`: is every option the command READS actually
// typeable in a shell? Mirrors prospect-audit-registration.test.ts.
//
// This exists because `db restore` shipped unrunnable. `DbCommandOptions` had
// `url?`, `runDbCommand` read `opts.url` to pick the restore target, and the CLI
// registered only `--file` — so `--url` hard-errored at parse time and the
// command's ONLY reachable outcome was its own usage error. Every unit test
// passed, because they call `runDbCommand` directly and never go through cac.
//
// A restore path that cannot be invoked is the worst possible thing to discover
// during a recovery, and the freeze makes that dump the entire rollback story.
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import type { DbCommandOptions } from "../../src/cli/commands/db.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../..");
const binSource = readFileSync(join(repoRoot, "src/cli/bin.ts"), "utf-8");
const dbSource = readFileSync(join(repoRoot, "src/cli/commands/db.ts"), "utf-8");

/** The `db` command's own registration block, so a `--url` belonging to some
 *  other command cannot satisfy these assertions. */
function dbCommandBlock(): string {
  const start = binSource.indexOf('"db <action>"');
  expect(start, "the db command is no longer registered in bin.ts").toBeGreaterThan(-1);
  const rest = binSource.slice(start);
  const end = rest.indexOf("\ncli\n");
  return end === -1 ? rest : rest.slice(0, end);
}

/** Flags the shell can type, mapped to the option key each lands on. `satisfies`
 *  ties every value to a REAL key of DbCommandOptions, so a renamed option is a
 *  tsc error rather than a flag that parses into nothing. */
const FLAGS = {
  "--file": "file",
  "--url": "url",
} satisfies Record<string, keyof DbCommandOptions>;

describe("db command — CLI registration", () => {
  it("registers every flag the command reads off opts", () => {
    // Derived from the source, not from a hand-kept list: a new `opts.foo` read
    // in db.ts fails here until bin.ts grows a `--foo`.
    const read = new Set(
      [...dbSource.matchAll(/\bopts\.([a-zA-Z][a-zA-Z0-9]*)/g)].map((m) => m[1]!),
    );
    // `cwd` and `verbose` are global options on every command, not db's own.
    read.delete("cwd");
    read.delete("verbose");

    const block = dbCommandBlock();
    const missing = [...read].filter(
      (key) => !new RegExp(`\\.option\\(\\s*\\n?\\s*"--${key}[ <]`).test(block),
    );
    expect(
      missing.sort(),
      "db.ts reads these options but bin.ts registers no flag for them — the command is unreachable from a shell",
    ).toEqual([]);
    // Vacuity guard: if the `opts.` scan ever stops matching, the assertion above
    // passes by finding nothing to check.
    expect(read.size).toBeGreaterThan(1);
  });

  it("every flag in FLAGS is really registered (the other direction)", () => {
    const block = dbCommandBlock();
    for (const flag of Object.keys(FLAGS)) {
      expect(block, `${flag} is not registered on the db command`).toMatch(
        new RegExp(`\\.option\\(\\s*\\n?\\s*"${flag}[ <]`),
      );
    }
  });

  it("cac actually accepts both flags together, from a shell", () => {
    // The behavioural half, run from SOURCE so it answers the live question
    // rather than the last build's. An unregistered flag is a cac hard-error at
    // parse time; a missing dump file is a clean refusal AFTER parsing. So
    // reaching the refusal proves both flags parsed.
    const run = () =>
      execFileSync(
        "node",
        [
          "--import",
          "tsx",
          join(repoRoot, "src/cli/bin.ts"),
          "db",
          "restore",
          "--url",
          "http://127.0.0.1:1", // never connected to: the file check refuses first
          "--file",
          join(repoRoot, "does-not-exist.sql"),
        ],
        { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] },
      );
    let combined: string;
    try {
      combined = run();
    } catch (e) {
      const err = e as { stdout?: string; stderr?: string };
      combined = `${err.stdout ?? ""}${err.stderr ?? ""}`;
    }
    expect(combined, "cac rejected a flag the command needs").not.toMatch(/Unknown option/);
    // And it got far enough to act on the arguments rather than dying at parse.
    expect(combined).toMatch(/ENOENT|does-not-exist/);
  }, 60_000);

  it("restore refuses without --url, so it can never default to production", () => {
    // The guard that matters most: a restore that fell back to the ambient
    // TURSO_DATABASE_URL would overwrite the live store.
    expect(dbSource).toMatch(/restore: pass the TARGET database via --url/);
    expect(dbSource).toMatch(/RESTORE refused=target-not-empty/);
    expect(dbSource).toMatch(/RESTORE refused=manifest-absent/);
  });
});
