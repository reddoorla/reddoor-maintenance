// The CLI surface of the prospect-audit command: is it reachable from a shell,
// and is every flag a shell can type actually honoured? Mirrors
// prismic-models-registration.test.ts's two-failure-shape structure:
//
//   - A flag cac does not know about HARD-ERRORS at parse time.
//   - A flag registered but NOT read is the silent-no-op class this pipeline
//     exists to eliminate.
//
// So the checks below close the loop in BOTH directions: bin.ts's registered
// flags ↔ FLAGS (this file) ↔ ProspectAuditCliOptions. The last link is a TYPE
// check, not a string one — see `_everyOptionHasAFlag`.
//
// `deps` is the one key on ProspectAuditCliOptions with no flag: it is a test
// seam (injected pipeline deps), documented as "Never set from the CLI", so it
// is excluded the same way the prismic-models file excludes the global `cwd`.
//
// The behavioural half spawns the CLI from SOURCE (tsx), not `dist/`, so it
// answers the live question rather than the last build's. It proves cac
// accepts every flag by pairing them with a deliberately non-http `<url>` —
// that fails `isHttpUrl` immediately, after cac has already parsed (or
// rejected) every option, but before the command ever touches the network,
// Turso, or the filesystem. Proving each flag's VALUE actually reaches
// runProspectAuditCommand's logic (business/competitors substitution,
// --no-probes skipping the probe stage, --out and --json changing delivery)
// is covered in-process by prospect-audit-command.test.ts and
// prospect-audit-persistence.test.ts, which call the command directly with
// injected deps — there is no flag-only observable difference before the
// pipeline runs to distinguish them at the subprocess level without either a
// live audit or a CLI-exposed deps-injection channel, which the type
// deliberately does not offer.
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import type { ProspectAuditCliOptions } from "../../src/cli/commands/prospect-audit.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../..");
const binSource = readFileSync(join(repoRoot, "src/cli/bin.ts"), "utf-8");

/** Every flag this command accepts, and the option key it lands on. `satisfies`
 *  ties each value to a REAL key of ProspectAuditCliOptions, so a typo'd or
 *  removed option key is a tsc error rather than a flag that parses into
 *  nothing. */
const FLAGS = {
  "--business": "business",
  "--competitors": "competitors",
  "--no-probes": "probes",
  "--out": "out",
  "--json": "json",
} as const satisfies Record<string, keyof ProspectAuditCliOptions>;

type Uncovered = Exclude<
  keyof ProspectAuditCliOptions,
  "deps" | (typeof FLAGS)[keyof typeof FLAGS]
>;
const _everyOptionHasAFlag: [Uncovered] extends [never] ? true : Uncovered = true;

/** The `cli.command("prospect-audit <url>")…` chain, sliced out of bin.ts so a
 *  flag registered on a DIFFERENT command cannot satisfy an assertion here. */
function commandBlock(source: string, registration: string): string {
  const at = source.indexOf(`"${registration}"`);
  expect(at, `bin.ts registers no "${registration}" command`).toBeGreaterThan(-1);
  const start = source.lastIndexOf("\ncli", at);
  const nextRel = source.slice(at).search(/\ncli[.\n]/);
  return source.slice(start, nextRel === -1 ? undefined : at + nextRel);
}

/** Whitespace-tolerant because prettier breaks a long `.option()` call across
 *  lines, and a formatting change must not be able to blind this check. */
function registeredFlags(block: string): string[] {
  return [...block.matchAll(/\.option\(\s*"(--[a-z0-9-]+)/g)].map((m) => m[1]!);
}

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

describe("prospect-audit CLI registration — source", () => {
  it("registers the command", () => {
    expect(binSource).toContain('"prospect-audit <url>"');
  });

  // Every command module is loaded LAZILY (dynamic import inside `.action()`)
  // so the CLI's startup graph stays free of prospect-audit's heaviest deps
  // (Anthropic SDK, Playwright, libSQL/kysely); the smoke-dist gate asserts
  // bin.js's STATIC import closure. A top-level import here would break that
  // gate — and would drag this command's chain into every consuming fleet
  // site's `reddoor-maint audit` run.
  it("imports the command module lazily", () => {
    expect(commandBlock(binSource, "prospect-audit <url>")).toContain(
      'await import("./commands/prospect-audit.js")',
    );
    expect(binSource).not.toMatch(/^import .*commands\/prospect-audit/m);
  });

  it("registers every flag the command honours", () => {
    const registered = registeredFlags(commandBlock(binSource, "prospect-audit <url>"));
    for (const flag of Object.keys(FLAGS)) {
      expect(registered, `bin.ts never registers ${flag}`).toContain(flag);
    }
  });

  // The silent-no-op direction: a flag bin.ts advertises that the command does
  // not read parses fine, exits 0, and does nothing anybody asked for.
  it("registers no flag the command does not honour", () => {
    const registered = registeredFlags(commandBlock(binSource, "prospect-audit <url>"));
    for (const flag of registered) {
      expect(Object.keys(FLAGS), `bin.ts registers ${flag}, which nothing reads`).toContain(flag);
    }
  });
});

// The source assertions above prove bin.ts SAYS the right thing. This proves
// cac itself accepts every flag — a missing `.option()` line is `Unknown
// option`, exit 1, at PARSE time, before the command's own logic ever runs.
describe("prospect-audit CLI registration — behaviour", () => {
  it("cac accepts every flag (an unregistered one is a hard error)", () => {
    // A non-http <url> makes runProspectAuditCommand's own isHttpUrl guard
    // return immediately — after cac has fully parsed every flag below, but
    // before any network, Turso, or filesystem work — so this proves parsing
    // alone, deliberately, without running a real audit.
    const { out, code } = runCli([
      "prospect-audit",
      "not-a-url",
      "--business",
      "Acme Roofing",
      "--competitors",
      "rival.example,other.example",
      "--no-probes",
      "--out",
      "ignored.html",
      "--json",
    ]);
    expect(out).not.toMatch(/unknown option/i);
    expect(out).not.toMatch(/unknown command/i);
    // The guard it DID hit — proof the run reached the command's own logic
    // rather than dying somewhere in cac's parser.
    expect(out).toMatch(/https?:\/\//);
    expect(code).toBe(2);
  });
});
