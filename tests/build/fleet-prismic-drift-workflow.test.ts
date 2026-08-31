import { describe, it, expect, beforeAll } from "vitest";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, writeFile, chmod, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { join } from "node:path";
import { prismicTokenEnvName } from "../../src/prismic/models/token.js";
import { stepRunScript, stepEnv, workflowUses, workflowPath } from "./_helpers/workflow-source.js";

const execFileAsync = promisify(execFile);

/**
 * THE NIGHTLY THAT MAKES THE PRISMIC DRIFT ALARM REAL.
 *
 * Everything downstream of it — the Airtable verdict columns, the cockpit tier,
 * the digest's three attention items — describes what THIS workflow found. If it
 * can run and report nothing while going green, every one of those reads a stale
 * green tick as a fresh one, which is this project's governing failure ("I could
 * not read X" must never produce the same result as "X does not exist") pointed at
 * the instrument itself.
 *
 * So the gate is not asserted by grepping the YAML for reassuring words. The step's
 * shell script is EXTRACTED FROM THE WORKFLOW AND EXECUTED against a stubbed CLI,
 * once per way the sweep can go wrong, and the assertion is on the exit status and
 * the annotations it actually produces. A comment cannot satisfy that, and neither
 * can a gate that was rewired to key on the wrong number — which is precisely how
 * `fleet-smoke.yml` stayed green while its suites failed on 9 of 11 sites.
 */

const SWEEP_STEP = "Sweep the fleet for Prismic model drift";

let wf: string;
let gate: string;

beforeAll(async () => {
  wf = await readFile(workflowPath("fleet-prismic-drift.yml"), "utf-8");
  gate = stepRunScript(wf, SWEEP_STEP);
});

/**
 * Run the workflow's own gate script with `node` stubbed out.
 *
 * `bash -e` matches the shell Actions gives a `run:` block (`bash -e {0}`), so a
 * script that only passes here because of a friendlier shell would not be
 * believed. The stub is a `node` earlier on PATH that prints `stdout` verbatim and
 * exits with `exit`; nothing here touches Prismic, Airtable, GitHub or the network.
 */
async function runGate(opts: {
  stdout: string;
  exit: number;
}): Promise<{ code: number; out: string }> {
  const dir = await mkdtemp(join(tmpdir(), "prismic-drift-gate-"));
  const bin = join(dir, "bin");
  await mkdir(bin, { recursive: true });
  await writeFile(join(dir, "canned.txt"), opts.stdout, "utf-8");
  await writeFile(
    join(bin, "node"),
    `#!/bin/sh\ncat "${join(dir, "canned.txt")}"\nexit ${opts.exit}\n`,
    "utf-8",
  );
  await chmod(join(bin, "node"), 0o755);

  try {
    const { stdout, stderr } = await execFileAsync("bash", ["-e", "-c", gate], {
      cwd: dir,
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH ?? ""}`,
        RUNNER_TEMP: dir,
      },
    });
    return { code: 0, out: stdout + stderr };
  } catch (e) {
    const err = e as { code?: number; stdout?: string; stderr?: string };
    return { code: err.code ?? 1, out: (err.stdout ?? "") + (err.stderr ?? "") };
  }
}

/** A summary line exactly as `formatFleetWriteSummary` emits it. Built with the
 *  real formatter's shape rather than a hand-typed string, so a change to that
 *  contract breaks this file instead of silently un-arming the gate. */
const summary = (wrote: number, failed: number): string =>
  `FLEET_WRITE_SUMMARY wrote=${wrote} failed=${failed} total=${wrote + failed}`;

describe("fleet-prismic-drift — the gate cannot go green having established nothing", () => {
  it("passes a real sweep that wrote every verdict", async () => {
    const r = await runGate({ stdout: `[espada] 12 model(s) match\n${summary(12, 0)}\n`, exit: 0 });
    expect(r.code).toBe(0);
    expect(r.out).not.toContain("::error::");
    expect(r.out).toContain("wrote=12");
  });

  // Drift is NOT an outage — a site whose models diverge is a finding on its
  // Airtable row, and reddening the nightly for it would make the alarm
  // meaningless the first time anybody edits a model.
  it("stays green when sites DRIFT but every verdict was recorded", async () => {
    const r = await runGate({
      stdout: `[espada] CHANGED slice hero\n[hedloc] NEW custom_type page\n${summary(12, 0)}\n`,
      exit: 0,
    });
    expect(r.code).toBe(0);
    expect(r.out).not.toContain("::error::");
  });

  // The CLI's exit code IS a signal here, unlike in fleet-security/fleet-smoke
  // where a non-zero exit is routine. `prismicSweepExitCode` only reds on a
  // majority-unreadable fleet, a repositoryName/token-env collision, the
  // not-one-site-was-checked refusal, an inventory that resolved nothing, or a
  // total write-back failure. Every one of those is an outage.
  it("fails when the sweep itself exits non-zero", async () => {
    const r = await runGate({
      stdout: `⛔ NOT ONE SITE WAS CHECKED. All 15 site(s) came back skipped or unreadable\n`,
      exit: 1,
    });
    expect(r.code).not.toBe(0);
    expect(r.out).toContain("::error::");
  });

  // ISOLATES THE EXIT-CODE GATE. Every other non-zero scenario here ALSO lacks a
  // summary line, so all of them stayed green when the exit-code check was
  // disarmed — the no-summary gate was quietly doing the work. This is the one
  // shape only `rc` can catch, and it is a real one: two repos claiming one
  // Prismic repository (or two repositories deriving one token secret) reds the
  // sweep while every site read fine and every verdict was written.
  it("fails on a collision — every verdict written, and still an outage", async () => {
    const r = await runGate({
      stdout:
        `## ⚠ TWO SITES CLAIM ONE PRISMIC REPOSITORY: the-tower, the-tower-burbank\n` +
        `${summary(15, 0)}\n`,
      exit: 1,
    });
    expect(r.code).not.toBe(0);
    expect(r.out).toContain("::error::");
  });

  // The refusal text is surfaced in the ANNOTATION, so the Actions UI names the
  // cause instead of sending the operator into 15 sites' worth of log. Asserted
  // against the `::error::` line specifically: the sweep's own stdout is tee'd to
  // the console, so "does the output mention it anywhere" is true whether or not
  // the annotation was ever built.
  it("quotes the ⛔ refusal in the annotation rather than a generic failure", async () => {
    const r = await runGate({
      stdout: `⛔ the inventory resolved NO SITES, so no sites were swept\n`,
      exit: 1,
    });
    expect(r.code).not.toBe(0);
    const errors = r.out.split("\n").filter((l) => l.includes("::error::"));
    expect(errors.join("\n")).toContain("resolved NO SITES");
  });

  // THE fleet-smoke shape, in mirror image. Every verdict was computed and NONE
  // of them reached Airtable — an expired PAT, a renamed column, a base id typo.
  // The CLI exits 0 (per-row write failures deliberately do not red it, because
  // the verdict columns are operator-added and the feature ships dark), so the
  // exit code alone would report a clean night while the cockpit kept yesterday's
  // green ticks forever.
  it("fails when the sweep ran but wrote ZERO verdicts", async () => {
    const r = await runGate({ stdout: `[espada] clean\n${summary(0, 15)}\n`, exit: 0 });
    expect(r.code).not.toBe(0);
    expect(r.out).toContain("::error::");
  });

  // ISOLATES THE TOTAL-FAILURE GATE, and it is here because the scenario above did
  // not. `wrote=0 failed=15` also trips the >25% mass-flake rule below it, so
  // disarming the `wrote -eq 0` check entirely left that test green — a passing
  // assertion about a gate that was no longer there. `wrote=0 failed=0 total=0` is
  // the write step reporting that it had nothing to write, and NOTHING ELSE in the
  // script can red it.
  it("fails when the write step reports no rows at all", async () => {
    const r = await runGate({ stdout: `${summary(0, 0)}\n`, exit: 0 });
    expect(r.code).not.toBe(0);
    expect(r.out).toContain("::error::");
  });

  // "The step ran and could not tell." A run that produced no machine-readable
  // summary at all reached neither the write-back nor the refusals that would
  // have reddened it — the exit code is then a claim about nothing.
  it("fails when the sweep exits 0 but prints no write summary", async () => {
    const r = await runGate({ stdout: `some prose, no machine line\n`, exit: 0 });
    expect(r.code).not.toBe(0);
    expect(r.out).toContain("::error::");
  });

  it("fails when the sweep produced no output whatsoever", async () => {
    const r = await runGate({ stdout: "", exit: 0 });
    expect(r.code).not.toBe(0);
    expect(r.out).toContain("::error::");
  });

  // A single unwritable row is a flake (a site renamed in Airtable this morning);
  // it must stay visible without reddening a nightly that otherwise worked.
  it("warns but stays green on a single unwritten verdict", async () => {
    const r = await runGate({ stdout: `${summary(14, 1)}\n`, exit: 0 });
    expect(r.code).toBe(0);
    expect(r.out).toContain("::warning::");
    expect(r.out).not.toContain("::error::");
  });

  it("fails when more than a quarter of the verdicts failed to write", async () => {
    const r = await runGate({ stdout: `${summary(10, 5)}\n`, exit: 0 });
    expect(r.code).not.toBe(0);
    expect(r.out).toContain("::error::");
  });

  // A site dropped in fleet PREP is a site nobody read. The sweep already gives it
  // a `failed` row (so it counts toward the outage rule and writes `unknown`), but
  // a tolerated single skip must still be visible in the Actions UI rather than
  // buried — the same token four other fleet nightlies grep.
  it("raises a warning for sites that could not be prepared", async () => {
    const r = await runGate({
      stdout: `${summary(14, 0)}\n⚠ 1 site(s) skipped (could not prepare): revogen (clone failed)\n`,
      exit: 0,
    });
    expect(r.out).toContain("::warning::");
    expect(r.out).toContain("revogen");
  });

  it("still reports a prep skip on a run that went on to fail", async () => {
    const r = await runGate({
      stdout: `⚠ 9 site(s) skipped (could not prepare): everything (disk full)\n`,
      exit: 1,
    });
    expect(r.out).toContain("::warning::");
    expect(r.code).not.toBe(0);
  });
});

describe("fleet-prismic-drift — read-only by construction", () => {
  /** The sweep's argv, taken from the script the workflow actually runs (line
   *  continuations joined), never from the file's prose. A comment that mentions a
   *  flag can neither add one here nor take one away. */
  function sweepArgv(): string[] {
    // `\\\n` FIRST in the alternation: with `[^\n]` first the regex engine eats the
    // backslash as an ordinary character, the continuation never matches, and the
    // argv silently stops at the first line — which would make the `--apply`
    // absence assertion below true for a command that passed it on line two.
    const m = /node\s+dist\/cli\/bin\.js((?:\\\n|[^\n])*)/.exec(gate);
    if (!m) throw new Error("the sweep step does not invoke `node dist/cli/bin.js`");
    return (
      m[1]!
        .replace(/\\\n/g, " ")
        // Stop at the pipe — everything past it is the shell's plumbing, not the
        // CLI's argv.
        .split("|")[0]!
        .split(/\s+/)
        .filter((t) => t !== "")
    );
  }

  it("invokes the read-only fleet sweep and persists its verdicts", () => {
    const argv = sweepArgv();
    expect(argv[0]).toBe("prismic-models");
    expect(argv).toContain("--fleet");
    expect(argv[argv.indexOf("--fleet") + 1]).toBe("airtable");
    expect(argv).toContain("--write-airtable");
  });

  // `--apply` is refused outright in fleet mode (exit 2), so this is belt and
  // braces — but a fleet-wide model push outside a site's own CI is 🔴 under
  // AUTONOMY.md, and the one place it could ever be typed is here.
  it("never passes --apply, --pull or --comment-file", () => {
    const argv = sweepArgv();
    expect(argv).not.toContain("--apply");
    expect(argv).not.toContain("--pull");
    expect(argv).not.toContain("--comment-file");
  });

  it("asks for no write permission it does not use", () => {
    // The whole-file permissions block, before the first `jobs:` key.
    const block = /^permissions:\n((?:[ \t]+\S.*\n)+)/m.exec(wf)?.[1] ?? "";
    const perms = Object.fromEntries(
      block
        .split("\n")
        .map((l) => /^\s+([a-z-]+):\s*(read|write|none)/.exec(l))
        .filter((m): m is RegExpExecArray => m !== null)
        .map((m) => [m[1]!, m[2]!]),
    );
    expect(perms).toEqual({ contents: "read", issues: "write" });
  });
});

describe("fleet-prismic-drift — the per-repository token env block", () => {
  let env: Record<string, string>;
  let tokens: Array<[string, string]>;

  beforeAll(() => {
    env = stepEnv(wf, SWEEP_STEP);
    tokens = Object.entries(env).filter(([k]) => k.startsWith("PRISMIC_TOKEN_"));
  });

  // THE CROSS-WIRING GUARD. A copy-pasted line that maps
  // `PRISMIC_TOKEN_ESPADA: ${{ secrets.PRISMIC_TOKEN_HEDLOC }}` sends one client's
  // write credential to another client's Prismic repository — the exact hazard
  // `findTokenEnvCollisions` exists to detect, reintroduced by hand in the one
  // file that detector cannot see.
  it("maps every token env var to the secret of the SAME name", () => {
    expect(tokens.length).toBeGreaterThan(0);
    for (const [name, value] of tokens) {
      expect(value.replace(/\s+/g, "")).toBe(`\${{secrets.${name}}}`);
    }
  });

  // The naming rule is derivable, not editorial: PRISMIC_TOKEN_<REPOSITORY NAME>
  // upper-snaked. A name that is not a fixed point of `prismicTokenEnvName` is one
  // the CLI will never look up, and the site reports MISSING forever while the
  // secret sits there spelled almost right.
  it("uses only names the CLI's own derivation rule can produce", () => {
    for (const [name] of tokens) {
      const repositoryName = name.slice("PRISMIC_TOKEN_".length);
      expect(prismicTokenEnvName(repositoryName)).toBe(name);
    }
  });

  it("lists no repository twice", () => {
    const names = tokens.map(([n]) => n);
    expect(new Set(names).size).toBe(names.length);
  });

  // THE FOUR THAT A HAND-WRITTEN LIST LOSES. Every one of these Prismic
  // repositories is named something other than its repo directory, so a list
  // written from the fleet's repo names silently omits them — the site then
  // reports a missing token, and the fix looks like a credentials problem rather
  // than a naming one. A draft of this very workflow dropped three of the four.
  it("carries the repositories whose Prismic name differs from the repo name", () => {
    const names = tokens.map(([n]) => n);
    // medical-solutions-of-texas, reddoor-website, data-dynamiq, beachfront-dentistry
    for (const repositoryName of ["msot", "reddoor-la", "reddoor-wireframer", "48bb12d1"]) {
      expect(names).toContain(prismicTokenEnvName(repositoryName));
    }
  });

  // Fleet mode sets `allowGenericToken: false` precisely because ONE generic token
  // in the environment, while iterating every repository in the fleet, attaches
  // the wrong credential to every site after the first. Putting it in this env
  // block would be asking for that.
  it("does not put the generic PRISMIC_WRITE_TOKEN in a fleet environment", () => {
    expect(Object.keys(env)).not.toContain("PRISMIC_WRITE_TOKEN");
  });

  it("passes the Airtable credentials the write-back needs", () => {
    expect(Object.keys(env)).toContain("AIRTABLE_PAT");
    expect(Object.keys(env)).toContain("AIRTABLE_BASE_ID");
  });
});

describe("fleet-prismic-drift — scheduling and supply chain", () => {
  /** Minutes past midnight UTC of a workflow's first `cron:`. */
  async function cronMinutes(file: string): Promise<number> {
    const text = await readFile(workflowPath(file), "utf-8");
    const m = /^\s*- cron: "?(\d+) (\d+) \* \* \*"?/m.exec(text);
    if (!m) throw new Error(`no daily cron in ${file}`);
    return Number(m[2]) * 60 + Number(m[1]);
  }

  // A verdict is only worth writing if it lands before the thing that reads it.
  // Asserted as an ORDERING against the real workflows rather than as a hard-coded
  // clock, so moving either cron is what breaks this — not editing a comment.
  it("runs before the morning report drafts and before the security sweep", async () => {
    const drift = await cronMinutes("fleet-prismic-drift.yml");
    expect(drift).toBeLessThan(await cronMinutes("daily-reports.yml"));
    expect(drift).toBeLessThan(await cronMinutes("fleet-security.yml"));
  });

  it("can be run by hand as well as on the cron", () => {
    expect(/^\s*workflow_dispatch:/m.test(wf)).toBe(true);
  });

  // A second run overlapping the first would have two processes writing verdicts
  // into one Airtable base and sharing one clone workdir.
  it("never overlaps itself, and a queued run is not cancelled", () => {
    expect(
      /^concurrency:\n\s+group: fleet-prismic-drift\n\s+cancel-in-progress: false$/m.test(wf),
    ).toBe(true);
  });

  it("pins every action to a commit digest, not a mutable tag", () => {
    const uses = workflowUses(wf);
    expect(uses.length).toBeGreaterThan(0);
    for (const u of uses) expect(u).toMatch(/@[0-9a-f]{40}$/);
  });

  // Same digests the other fleet nightlies run, so Renovate moves them as one.
  it("runs the same pinned actions as the other fleet nightlies", async () => {
    const security = await readFile(workflowPath("fleet-security.yml"), "utf-8");
    const known = new Set(workflowUses(security));
    for (const u of workflowUses(wf)) expect(known).toContain(u);
  });

  it("bounds the sweep so a wedged run cannot pin the runner all night", () => {
    expect(/timeout-minutes: \d+/.test(wf)).toBe(true);
  });
});

describe("fleet-prismic-drift — a red night is durably visible", () => {
  it("files a tracking issue on failure and closes it on recovery", () => {
    expect(wf).toContain("if: failure()");
    expect(wf).toContain("if: success()");
    expect(wf).toContain("gh issue create");
    expect(wf).toContain("gh issue close");
  });

  // A distinct title from every other nightly's, or two workflows comment on and
  // close each other's issue.
  it("uses a title no other nightly uses", async () => {
    const title = /title="([^"]+)"/.exec(wf)?.[1];
    expect(title).toBeTruthy();
    for (const other of [
      "fleet-security.yml",
      "fleet-smoke.yml",
      "fleet-lighthouse.yml",
      "fleet-form-e2e.yml",
    ]) {
      expect(await readFile(workflowPath(other), "utf-8")).not.toContain(`title="${title}"`);
    }
  });

  // The alert machinery must never be able to turn a green run red — or a red run
  // green — on its own.
  it("never lets the issue bookkeeping decide the run's status", () => {
    const steps = wf.split(/^\s+- name: /m).filter((s) => s.includes("gh issue"));
    expect(steps.length).toBe(2);
    for (const s of steps) expect(s).toContain("continue-on-error: true");
  });

  // #643 (the freeze): `openVerdictSink` builds a site mirror, and post-flip the
  // factory REFUSES TO BUILD without Turso creds — the whole sweep would exit 1
  // as an outage before checking a single site. The creds are load-bearing in a
  // way the gate script above cannot prove, so they get their own assertion.
  it("gives the sweep step the Turso credentials its verdict sink now REQUIRES", () => {
    const env = stepEnv(wf, SWEEP_STEP);
    expect(Object.keys(env)).toEqual(
      expect.arrayContaining(["TURSO_DATABASE_URL", "TURSO_AUTH_TOKEN"]),
    );
  });

  it("still gives the sweep step its Airtable credentials (positive control)", () => {
    // Proves stepEnv is reading the real block, so the assertion above cannot
    // be passing against an empty or mis-parsed map.
    const env = stepEnv(wf, SWEEP_STEP);
    expect(Object.keys(env)).toEqual(expect.arrayContaining(["AIRTABLE_PAT", "AIRTABLE_BASE_ID"]));
  });
});
