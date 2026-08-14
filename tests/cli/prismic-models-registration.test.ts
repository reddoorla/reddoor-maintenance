// The CLI surface of the model pipeline: is every mode the command implements
// reachable from a shell, and is every flag a shell can type actually honoured?
//
// TWO FAILURE SHAPES, and they fail in opposite directions:
//
//   - A flag cac does not know about HARD-ERRORS. `cli.parse()` rejects an
//     unknown option, so a mode that ships without its `.option()` line is not
//     "quietly ignored" — it is `Unknown option --tokens`, exit 1, in whatever
//     workflow typed it.
//   - A flag registered but NOT handled is the silent-no-op class this whole
//     pipeline exists to eliminate: `--write-airtable` parses, lands in `opts`,
//     is never read, and the run exits 0 having written nothing.
//
// So the checks below close the loop in BOTH directions, and the chain is:
// bin.ts's registered flags ↔ FLAGS (this file) ↔ PrismicModelsCommandOptions.
// The last link is a TYPE check, not a string one — see `_everyOptionHasAFlag`.
//
// The behavioural half spawns the CLI from SOURCE (tsx) rather than from
// `dist/`. A registration test that read a stale `dist/cli/bin.js` would answer
// a question about the last build, which is precisely the "I could not read the
// thing I claim to be describing" failure this pipeline is written against.
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import type { PrismicModelsCommandOptions } from "../../src/cli/commands/prismic-models.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../..");
const binSource = readFileSync(join(repoRoot, "src/cli/bin.ts"), "utf-8");

/**
 * Every flag this command accepts, and the option key it lands on.
 *
 * `satisfies` ties each value to a REAL key of `PrismicModelsCommandOptions`, so
 * a typo'd or removed option key is a tsc error rather than a flag that parses
 * into nothing.
 */
const FLAGS = {
  "--apply": "apply",
  "--pull": "pull",
  "--tokens": "tokens",
  "--fleet": "fleet",
  "--workdir": "workdir",
  "--write-airtable": "writeAirtable",
  "--comment-file": "commentFile",
} as const satisfies Record<string, keyof PrismicModelsCommandOptions>;

/**
 * THE REVERSE DIRECTION, at compile time: every option the command honours must
 * have a flag somebody can type. Without this, adding `--only-slices` to
 * `PrismicModelsCommandOptions` and wiring it into the command — but never into
 * bin.ts — is invisible to every string assertion below, because they can only
 * check the flags that ARE there.
 *
 * `cwd` is excluded because it is a GLOBAL cac option (`cli.option("--cwd
 * <path>")`), registered once for every command rather than on this one.
 */
type Uncovered = Exclude<
  keyof PrismicModelsCommandOptions,
  "cwd" | (typeof FLAGS)[keyof typeof FLAGS]
>;
const _everyOptionHasAFlag: [Uncovered] extends [never] ? true : Uncovered = true;

/** The `cli.command("prismic-models …")…` chain, sliced out of bin.ts so a flag
 *  registered on a DIFFERENT command cannot satisfy an assertion here. */
function commandBlock(source: string, command: string): string {
  const at = source.indexOf(`"${command} [site]"`);
  expect(at, `bin.ts registers no "${command} [site]" command`).toBeGreaterThan(-1);
  const start = source.lastIndexOf("\ncli", at);
  const nextRel = source.slice(at).search(/\ncli[.\n]/);
  return source.slice(start, nextRel === -1 ? undefined : at + nextRel);
}

/** The flags one command block registers. Whitespace-tolerant because prettier
 *  breaks a long `.option()` call across lines, and a formatting change must not
 *  be able to blind this check. */
function registeredFlags(block: string): string[] {
  return [...block.matchAll(/\.option\(\s*"(--[a-z0-9-]+)/g)].map((m) => m[1]!);
}

/** Run the CLI from SOURCE. Returns the exit code alongside the output rather
 *  than throwing, because a refusal is a result here, not an error. */
function runCli(args: string[]): { out: string; code: number } {
  try {
    const out = execFileSync(join(repoRoot, "node_modules/.bin/tsx"), [
      join(repoRoot, "src/cli/bin.ts"),
      ...args,
    ]).toString();
    return { out, code: 0 };
  } catch (e) {
    const err = e as { stdout?: Buffer; stderr?: Buffer; status?: number };
    return {
      out: `${err.stdout?.toString() ?? ""}${err.stderr?.toString() ?? ""}`,
      code: err.status ?? 1,
    };
  }
}

describe("prismic-models CLI registration — source", () => {
  it("registers the command", () => {
    expect(binSource).toContain('"prismic-models [site]"');
  });

  // Every command module is loaded LAZILY (dynamic import inside `.action()`) so
  // the CLI's startup graph stays free of heavy transitive deps; the smoke-dist
  // gate asserts bin.js's STATIC import closure. A top-level import here would
  // break that gate — and would drag this command's chain into every consuming
  // fleet site's `reddoor-maint audit` run.
  it("imports the command module lazily", () => {
    expect(commandBlock(binSource, "prismic-models")).toContain(
      'await import("./commands/prismic-models.js")',
    );
    expect(binSource).not.toMatch(/^import .*commands\/prismic-models/m);
  });

  it("registers every flag the command honours", () => {
    const registered = registeredFlags(commandBlock(binSource, "prismic-models"));
    for (const flag of Object.keys(FLAGS)) {
      expect(registered, `bin.ts never registers ${flag}`).toContain(flag);
    }
  });

  // The silent-no-op direction: a flag bin.ts advertises that the command does
  // not read parses fine, exits 0, and does nothing anybody asked for.
  it("registers no flag the command does not honour", () => {
    const registered = registeredFlags(commandBlock(binSource, "prismic-models"));
    for (const flag of registered) {
      expect(Object.keys(FLAGS), `bin.ts registers ${flag}, which nothing reads`).toContain(flag);
    }
  });
});

// The source assertions above prove bin.ts SAYS the right thing. These prove the
// CLI DOES it — that cac accepts each flag and that it reaches the handler.
describe("prismic-models CLI registration — behaviour", () => {
  const emptyDir = () => mkdtempSync(join(tmpdir(), "prismic-registration-"));

  // One spawn, every flag. cac rejects an unknown option outright, so a missing
  // `.option()` line shows up here as `Unknown option`, not as a subtle default.
  it("cac accepts every flag (an unregistered one is a hard error)", () => {
    const { out } = runCli([
      "prismic-models",
      "--apply",
      "--pull",
      "--tokens",
      "--fleet",
      "x",
      "--workdir",
      "y",
      "--write-airtable",
      "--comment-file",
      "z",
      "--cwd",
      emptyDir(),
    ]);
    expect(out).not.toMatch(/unknown option/i);
    // …and it must not have fallen through to cac's unknown-COMMAND handler
    // either, which would exit 1 with a message about the command itself.
    expect(out).not.toMatch(/unknown command/i);
  });

  // Reaching the HANDLER, not merely the parser: `--tokens` selects a mode whose
  // output nothing else in this command produces.
  it("routes --tokens to the token doctor", () => {
    const dir = emptyDir();
    const withFlag = runCli(["prismic-models", "--tokens", "--cwd", dir]);
    expect(withFlag.out).toMatch(/write-token doctor/i);
    // The control: the same invocation without the flag must NOT print it, or the
    // assertion above proves nothing about the flag.
    const without = runCli(["prismic-models", "--cwd", dir]);
    expect(without.out).not.toMatch(/write-token doctor/i);
  });

  // `--write-airtable` is the flag whose handler is still a refusal. Either way
  // the run must SAY the flag was seen — an invocation that quietly ran the
  // in-repo check instead is the failure this file is about.
  it("acts on --write-airtable rather than ignoring it", () => {
    const dir = emptyDir();
    const r = runCli(["prismic-models", "--write-airtable", "--cwd", dir]);
    expect(r.out).toMatch(/write-airtable/);
    expect(r.code).not.toBe(0);
  });
});
