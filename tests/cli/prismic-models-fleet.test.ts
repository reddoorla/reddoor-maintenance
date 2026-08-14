import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  prismicSweepExitCode,
  findRepositoryCollisions,
  findTokenEnvCollisions,
  findDuplicateSiteRows,
  describeCollisions,
  describeTokenEnvCollisions,
  describeDuplicateSiteRows,
  describeNothingChecked,
  resolveCheckoutCommit,
  summariseSweep,
  runPrismicModelsCommand,
  type SweepRow,
  type PrismicModelsDeps,
} from "../../src/cli/commands/prismic-models.js";
import type { RemoteEntry } from "../../src/prismic/models/index.js";
import type { SpawnFn } from "../../src/audits/util/spawn.js";

// Mirrors githubSignalsExitCode: a nightly sweep must go non-zero when failures
// are the MAJORITY, not only on a total wipeout — 11/12 unreadable repos is an
// outage that used to report success. DRIFT is not a failure: a site that reads
// fine and diverges is a finding to write to Airtable, not a broken sweep.
describe("prismicSweepExitCode", () => {
  it("exits 0 when every site was checked", () => {
    expect(prismicSweepExitCode(11, 0)).toBe(0);
  });
  it("exits 0 for a minority of failures", () => {
    expect(prismicSweepExitCode(10, 1)).toBe(0);
  });
  it("treats an exact tie as non-majority", () => {
    expect(prismicSweepExitCode(6, 6)).toBe(0);
  });
  it("exits 1 when failures are the majority", () => {
    expect(prismicSweepExitCode(1, 11)).toBe(1);
  });
  it("exits 1 on a total wipeout", () => {
    expect(prismicSweepExitCode(0, 12)).toBe(1);
  });
  it("does not count drift as failure", () => {
    // 11 checked (some drifting), 0 failed -> 0
    expect(prismicSweepExitCode(11, 0)).toBe(0);
  });
});

// Two repos CAN declare one repositoryName. `the-tower` and `the-tower-burbank`
// both declare "the-tower-burbank" today — benign only because `the-tower` is
// archived, and nothing in the pipeline notices. This is the fleet-level twin of
// Task 8's `assertNoDuplicateIds`: there, two files claiming one model id; here,
// two repos claiming one Prismic repository. Both would derive the same
// PRISMIC_TOKEN_*, both would treat their own customtypes/ as truth, and the one
// that ran second would overwrite the first with NO diff shown — each repo's own
// comparison is internally consistent, so neither can see the conflict. Only a
// human can say which repo owns the models.
describe("findRepositoryCollisions", () => {
  it("finds nothing when every site maps to a distinct Prismic repository", () => {
    expect(
      findRepositoryCollisions([
        { site: "the-pointe", repositoryName: "the-pointe" },
        { site: "espada", repositoryName: "espada" },
      ]),
    ).toEqual([]);
  });

  it("reports the shared repository naming BOTH sites", () => {
    expect(
      findRepositoryCollisions([
        { site: "the-tower", repositoryName: "the-tower-burbank" },
        { site: "the-tower-burbank", repositoryName: "the-tower-burbank" },
      ]),
    ).toEqual([{ repositoryName: "the-tower-burbank", sites: ["the-tower", "the-tower-burbank"] }]);
  });

  // A site with no Prismic config is not a collision, however many there are.
  it("ignores sites with no repositoryName", () => {
    expect(
      findRepositoryCollisions([
        { site: "1836dig", repositoryName: null },
        { site: "la-homelessness-youth", repositoryName: null },
      ]),
    ).toEqual([]);
  });

  it("reports all three sites when three claim one repository", () => {
    const [c] = findRepositoryCollisions([
      { site: "c", repositoryName: "shared" },
      { site: "a", repositoryName: "shared" },
      { site: "b", repositoryName: "shared" },
    ]);
    expect(c?.sites).toEqual(["a", "b", "c"]);
  });

  // MUTATION TARGET. The detector groups by NAME and has no notion of identity,
  // so one site listed twice in the inventory looked like two sites fighting over
  // a repository — and the remediation then sent an operator to change a
  // slicemachine.config.json in a live client repo for a conflict that does not
  // exist. A safety alarm that fires on its own inventory is an alarm that gets
  // ignored.
  it("is not fooled by one site listed twice in the inventory", () => {
    expect(
      findRepositoryCollisions([
        { site: "espada", repositoryName: "espada" },
        { site: "espada", repositoryName: "espada" },
      ]),
    ).toEqual([]);
  });

  // A site whose check FAILED usually DOES carry a repositoryName — the token,
  // local-models and remote-read failures all know which repository the config
  // named — and it belongs in the detector: that repo still claims the
  // repository, and its own CI still pushes to it on merge, whether or not this
  // sweep could read its models.
  it("still sees a collision when one of the two sites failed its check", () => {
    expect(
      findRepositoryCollisions([
        { site: "readable", repositoryName: "shared" },
        { site: "token-missing", repositoryName: "shared" },
      ]),
    ).toEqual([{ repositoryName: "shared", sites: ["readable", "token-missing"] }]);
  });

  // Two sites, two collisions, in a stable order regardless of inventory order —
  // the report is diffed run to run by an operator.
  it("sorts the collisions by repository name", () => {
    expect(
      findRepositoryCollisions([
        { site: "d", repositoryName: "zeta" },
        { site: "a", repositoryName: "alpha" },
        { site: "c", repositoryName: "zeta" },
        { site: "b", repositoryName: "alpha" },
      ]).map((c) => c.repositoryName),
    ).toEqual(["alpha", "zeta"]);
  });
});

// A collision must reach the operator, and it must go non-zero — it is the one
// finding no per-repo CI run can ever surface.
describe("describeCollisions", () => {
  it("renders nothing when there are no collisions", () => {
    expect(describeCollisions([])).toBe("");
  });

  it("names the repository and every claiming site", () => {
    const out = describeCollisions([
      { repositoryName: "the-tower-burbank", sites: ["the-tower", "the-tower-burbank"] },
    ]);
    expect(out).toContain("the-tower-burbank");
    expect(out).toContain("the-tower and the-tower-burbank");
    expect(out).toMatch(/overwrite each other/);
  });
});

// The SECOND axis of the same conflict, and the one nothing else can see. The
// collision detector groups by repositoryName, but the CREDENTIAL is keyed by
// `prismicTokenEnvName`, which upper-snakes and collapses non-alphanumerics — so
// two DIFFERENT Prismic repositories can derive one PRISMIC_TOKEN_*, and the
// sweep would then send one client's write token to another client's repository.
// That is the exact cross-wiring `allowGeneric: false` exists to prevent,
// reintroduced through the naming rule.
describe("findTokenEnvCollisions", () => {
  it("finds nothing when every repository derives a distinct env var", () => {
    expect(
      findTokenEnvCollisions([
        { site: "the-pointe", repositoryName: "the-pointe" },
        { site: "the-pointe-burbank", repositoryName: "the-pointe-burbank" },
      ]),
    ).toEqual([]);
  });

  // MUTATION TARGET. Two names that are DIFFERENT Prismic repositories and one
  // secret between them. Grouping by repositoryName cannot see this.
  it("reports two repositories that collapse onto one PRISMIC_TOKEN_*", () => {
    expect(
      findTokenEnvCollisions([
        { site: "a", repositoryName: "the-pointe" },
        { site: "b", repositoryName: "the.pointe" },
      ]),
    ).toEqual([
      {
        envName: "PRISMIC_TOKEN_THE_POINTE",
        entries: [
          { site: "a", repositoryName: "the-pointe" },
          { site: "b", repositoryName: "the.pointe" },
        ],
      },
    ]);
  });

  // The same repositoryName twice derives one env var by definition. Reporting it
  // here as well would print two alarms with two different fixes for one problem —
  // and only one of those fixes is the right one.
  it("leaves a plain repositoryName collision to the other detector", () => {
    expect(
      findTokenEnvCollisions([
        { site: "the-tower", repositoryName: "the-tower-burbank" },
        { site: "the-tower-burbank", repositoryName: "the-tower-burbank" },
      ]),
    ).toEqual([]);
  });

  it("is not fooled by one site listed twice in the inventory", () => {
    expect(
      findTokenEnvCollisions([
        { site: "espada", repositoryName: "espada" },
        { site: "espada", repositoryName: "espada" },
      ]),
    ).toEqual([]);
  });

  it("ignores sites with no repositoryName", () => {
    expect(
      findTokenEnvCollisions([
        { site: "1836dig", repositoryName: null },
        { site: "la-homelessness-youth", repositoryName: null },
      ]),
    ).toEqual([]);
  });

  // `prismicTokenEnvName` THROWS on a name with no alphanumeric characters. That
  // throw must not take the detector — and with it the whole sweep's report —
  // down; the site is already a named `failed` row elsewhere.
  it("survives a repositoryName that derives no env var at all", () => {
    expect(() =>
      findTokenEnvCollisions([
        { site: "broken", repositoryName: "---" },
        { site: "espada", repositoryName: "espada" },
      ]),
    ).not.toThrow();
    expect(findTokenEnvCollisions([{ site: "broken", repositoryName: "---" }])).toEqual([]);
  });
});

describe("describeTokenEnvCollisions", () => {
  it("renders nothing when there are none", () => {
    expect(describeTokenEnvCollisions([])).toBe("");
  });

  // The operator's fix is NOT the repositoryName collision's fix: neither config
  // is wrong, so "go and edit a slicemachine.config.json" would be false advice.
  it("names the secret, both sites and both repositories, and does not blame a config", () => {
    const out = describeTokenEnvCollisions([
      {
        envName: "PRISMIC_TOKEN_THE_POINTE",
        entries: [
          { site: "a", repositoryName: "the-pointe" },
          { site: "b", repositoryName: "the.pointe" },
        ],
      },
    ]);
    expect(out).toContain("PRISMIC_TOKEN_THE_POINTE");
    expect(out).toContain("a (the-pointe)");
    expect(out).toContain("b (the.pointe)");
    expect(out).toMatch(/DIFFERENT Prismic repositories/i);
    expect(out).toMatch(/do not "fix" one of them/i);
  });
});

// An inventory wart, reported as one. Never silently swallowed — the detectors
// now drop the duplicate row, and a fact nobody prints is a fact nobody fixes.
describe("findDuplicateSiteRows", () => {
  it("finds nothing when every site appears once", () => {
    expect(
      findDuplicateSiteRows([
        { site: "espada", repositoryName: "espada" },
        { site: "hedloc", repositoryName: "hedloc" },
      ]),
    ).toEqual([]);
  });

  it("reports the repeated site, its count and the repositories it declared", () => {
    expect(
      findDuplicateSiteRows([
        { site: "espada", repositoryName: "espada" },
        { site: "espada", repositoryName: "espada" },
      ]),
    ).toEqual([{ site: "espada", count: 2, repositoryNames: ["espada"] }]);
  });

  it("lists both names when one label carried two different repositories", () => {
    const [d] = findDuplicateSiteRows([
      { site: "espada", repositoryName: "espada" },
      { site: "espada", repositoryName: "hedloc" },
    ]);
    expect(d?.repositoryNames).toEqual(["espada", "hedloc"]);
  });
});

describe("describeDuplicateSiteRows", () => {
  it("renders nothing when there are none", () => {
    expect(describeDuplicateSiteRows([])).toBe("");
  });

  it("says it is an inventory problem and tells the operator not to touch a config", () => {
    const out = describeDuplicateSiteRows([
      { site: "espada", count: 2, repositoryNames: ["espada"] },
    ]);
    expect(out).toContain("espada");
    expect(out).toMatch(/INVENTORY problem/i);
    expect(out).toMatch(/do not change a slicemachine\.config\.json/i);
  });
});

// A sweep in which nothing was checked learned nothing — the same reasoning as an
// inventory that resolves to zero sites, one step later in the pipeline.
describe("describeNothingChecked", () => {
  const row = (over: Partial<SweepRow>): SweepRow => ({
    site: "espada",
    repositoryName: "espada",
    commit: null,
    status: "checked",
    clean: true,
    detail: "",
    ...over,
  });

  it("says nothing when at least one site was checked", () => {
    expect(describeNothingChecked([row({}), row({ site: "b", status: "skipped" })])).toBe("");
  });

  it("refuses an all-skipped fleet", () => {
    const out = describeNothingChecked([
      row({ status: "skipped", clean: null, repositoryName: null }),
      row({ site: "b", status: "skipped", clean: null, repositoryName: null }),
    ]);
    expect(out).toMatch(/NOT ONE SITE WAS CHECKED/);
    expect(out).toMatch(/Do NOT read this exit as a result/i);
  });

  // The zero-sites refusal names the actual cause (an empty inventory) and this
  // one must not talk over it.
  it("leaves an empty sweep to the zero-sites refusal", () => {
    expect(describeNothingChecked([])).toBe("");
  });
});

// Every row lands in exactly one bucket, so a site can never fall out of the
// total — the same rule the token doctor's summary follows. A summary that
// counted only the outcomes an operator likes is how unreadable sites disappear.
describe("summariseSweep", () => {
  const row = (over: Partial<SweepRow>): SweepRow => ({
    site: "espada",
    repositoryName: "espada",
    commit: null,
    status: "checked",
    clean: true,
    detail: "",
    ...over,
  });

  it("counts each status and totals every row", () => {
    const out = summariseSweep([
      row({}),
      row({ site: "b", status: "failed", clean: null, repositoryName: null }),
      row({ site: "c", status: "skipped", clean: null, repositoryName: null }),
    ]);
    expect(out).toContain("1 checked, 1 failed, 1 skipped");
    expect(out).toContain("of 3 site(s)");
  });

  // "Could not read" must never render as "has no Prismic". The counts are
  // adjacent in one line, so the line says which is which in words.
  it("warns in words that unreadable is not the same as no-Prismic", () => {
    const out = summariseSweep([row({ status: "failed", clean: null })]);
    expect(out).toMatch(/could not be read/i);
    expect(out).toMatch(/NOT sites without Prismic/i);
  });

  it("does not warn when nothing failed", () => {
    expect(summariseSweep([row({})])).not.toMatch(/could not be read/i);
  });
});

// ---------------------------------------------------------------------------
// The sweep itself, end to end through the command, with NO network and NO git:
// every inventory entry points at a real directory that already exists, so
// `cloneIfNeeded` returns it untouched (it only spawns git for a missing
// checkout or to verify an expected repo identity, and these carry neither).
// ---------------------------------------------------------------------------

let root: string;
let workdir: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "prismic-fleet-"));
  workdir = join(root, "workdir");
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/** A remote for one Prismic repository: its models, a throw, or a payload that
 *  is not an array at all (the real `remoteModels` rejects that — this stands in
 *  for ANY unexpected throw between the input guards and the report). */
type RemoteFake = RemoteEntry[] | Error | "malformed";

const deps = (
  remote: Record<string, RemoteFake>,
  env: Record<string, string | undefined>,
  send: PrismicModelsDeps["sendModel"] = vi.fn(async () => {}),
): PrismicModelsDeps => ({
  remoteModels: vi.fn(async (repo: string) => {
    const r = remote[repo];
    if (r === undefined) throw new Error(`no fake remote registered for ${repo}`);
    if (r instanceof Error) throw r;
    if (r === "malformed") return undefined as unknown as RemoteEntry[];
    return r;
  }),
  sendModel: send,
  env,
  // A fleet sweep is read-only by construction: it must never shell out (that
  // is `--pull`'s prettier and the clone path, neither of which belongs here).
  spawn: vi.fn<SpawnFn>(async () => {
    throw new Error("the fleet sweep must never spawn a process");
  }),
  // No test in this file writes to Airtable. Required (not optional) on the deps
  // type precisely so that stays true by construction: a stub that throws is the
  // only way this path can be reached from here.
  openVerdictSink: async () => {
    throw new Error("this test never opens Airtable");
  },
});

type SiteSpec = {
  /** Write `slicemachine.config.json` with this repositoryName. */
  repositoryName?: string;
  /** Write a config file that is present and unparseable. */
  brokenConfig?: boolean;
  /** Write no config at all — a readable repo that is simply not a Prismic site. */
  noConfig?: boolean;
  /** Custom type ids to write under `customtypes/`. */
  models?: string[];
  /**
   * How this checkout's git metadata looks.
   *
   * `"killed-clone"` is the shape of F1: `.git` and NOTHING ELSE, which is what
   * `git clone` leaves when it dies after creating the repository and before
   * checking the working tree out. `"none"` is a directory of files that is not a
   * git checkout at all — the sweep must still compare it, and must say plainly
   * that it cannot name the commit.
   */
  git?: "loose" | "packed" | "detached" | "none" | "killed-clone";
};

/** A commit id that is not any real commit, so nothing can accidentally pass by
 *  agreeing with the machine this runs on. */
const SHA = "0123456789abcdef0123456789abcdef01234567";

/** Enough of a `.git` for `resolveCheckoutCommit` to read, written by hand: the
 *  sweep resolves the commit from FILES, never by shelling out to git, so the
 *  fixture is files too. */
async function makeGitDir(dir: string, mode: NonNullable<SiteSpec["git"]>): Promise<void> {
  if (mode === "none") return;
  const git = join(dir, ".git");
  await mkdir(git, { recursive: true });
  if (mode === "detached") {
    await writeFile(join(git, "HEAD"), `${SHA}\n`);
    return;
  }
  await writeFile(join(git, "HEAD"), "ref: refs/heads/main\n");
  if (mode === "packed") {
    // What a FRESH clone actually writes — no loose ref file at all.
    await writeFile(
      join(git, "packed-refs"),
      `# pack-refs with: peeled fully-peeled sorted \n${SHA} refs/heads/main\n`,
    );
    return;
  }
  await mkdir(join(git, "refs", "heads"), { recursive: true });
  await writeFile(join(git, "refs", "heads", "main"), `${SHA}\n`);
}

async function makeSite(name: string, spec: SiteSpec): Promise<void> {
  const dir = join(root, name);
  await mkdir(dir, { recursive: true });
  await makeGitDir(dir, spec.git ?? "loose");
  // A killed clone leaves the git metadata and no working tree — so nothing
  // below this line, which is the whole point of the fixture.
  if (spec.git === "killed-clone") return;
  // Something other than the config, so a no-config site is still a NON-EMPTY
  // directory and therefore a readable repo rather than a prep failure.
  await writeFile(join(dir, "package.json"), JSON.stringify({ name }));
  if (spec.brokenConfig) {
    await writeFile(join(dir, "slicemachine.config.json"), "{ this is not json");
  } else if (!spec.noConfig) {
    await writeFile(
      join(dir, "slicemachine.config.json"),
      JSON.stringify({ repositoryName: spec.repositoryName, libraries: ["./src/lib/slices"] }),
    );
  }
  for (const id of spec.models ?? []) {
    await mkdir(join(dir, "customtypes", id), { recursive: true });
    await writeFile(join(dir, "customtypes", id, "index.json"), JSON.stringify({ id }));
  }
}

/** An inventory naming sites by directory. A name with no directory behind it is
 *  a site that cannot be PREPARED — no checkout, and no gitRepo to clone from. */
async function inventory(names: string[]): Promise<string> {
  const path = join(root, "inventory.json");
  await writeFile(path, JSON.stringify(names.map((name) => ({ name, path: join(root, name) }))));
  return path;
}

const customType = (id: string): RemoteEntry => ({
  kind: "customtype",
  id,
  model: { id } as RemoteEntry["model"],
});

// The sweep REUSES checkouts and never refreshes them, so every verdict is about
// a commit rather than about that repo's default branch. Filesystem only — the
// sweep must never shell out, so the resolver reads `.git` itself.
describe("resolveCheckoutCommit", () => {
  it("resolves a loose ref", async () => {
    await makeSite("loose", { repositoryName: "loose" });
    expect(await resolveCheckoutCommit(join(root, "loose"))).toEqual({ resolved: SHA });
  });

  // What a fresh clone actually writes: no loose ref file at all.
  it("resolves a ref that lives only in packed-refs", async () => {
    await makeSite("packed", { repositoryName: "packed", git: "packed" });
    expect(await resolveCheckoutCommit(join(root, "packed"))).toEqual({ resolved: SHA });
  });

  it("resolves a detached HEAD", async () => {
    await makeSite("detached", { repositoryName: "detached", git: "detached" });
    expect(await resolveCheckoutCommit(join(root, "detached"))).toEqual({ resolved: SHA });
  });

  // "I could not read which commit" must never render as a commit — nor as
  // silence, which is why the reason comes back with it.
  it("returns a REASON rather than nothing when there is no .git", async () => {
    await makeSite("plain", { repositoryName: "plain", git: "none" });
    const r = await resolveCheckoutCommit(join(root, "plain"));
    expect(r).not.toHaveProperty("resolved");
    expect((r as { unresolved: string }).unresolved).toBeTruthy();
  });

  it("returns a reason for a directory that does not exist at all", async () => {
    expect(await resolveCheckoutCommit(join(root, "no-such-dir"))).not.toHaveProperty("resolved");
  });
});

describe("runPrismicModelsCommand — fleet sweep", () => {
  it("checks every site in the inventory and names each one", async () => {
    await makeSite("espada", { repositoryName: "espada", models: ["page"] });
    await makeSite("hedloc", { repositoryName: "hedloc", models: ["page"] });
    const fleet = await inventory(["espada", "hedloc"]);
    const r = await runPrismicModelsCommand(
      undefined,
      { cwd: root, fleet, workdir },
      deps(
        { espada: [customType("page")], hedloc: [customType("page")] },
        { PRISMIC_TOKEN_ESPADA: "a", PRISMIC_TOKEN_HEDLOC: "b" },
      ),
    );
    expect(r.code).toBe(0);
    expect(r.output).toContain("[espada]");
    expect(r.output).toContain("[hedloc]");
    expect(r.output).toContain("2 checked, 0 failed, 0 skipped");
  });

  it("no longer reports --fleet as unimplemented", async () => {
    await makeSite("espada", { repositoryName: "espada", models: ["page"] });
    const fleet = await inventory(["espada"]);
    const r = await runPrismicModelsCommand(
      undefined,
      { cwd: root, fleet, workdir },
      deps({ espada: [customType("page")] }, { PRISMIC_TOKEN_ESPADA: "a" }),
    );
    expect(r.output).not.toContain("NOT IMPLEMENTED");
  });

  // MUTATION TARGET. A config that is PRESENT AND BROKEN yields no
  // repositoryName, exactly like a repo with no Prismic at all — so the
  // `clean === null && repositoryName !== null` derivation scored a live client's
  // broken site as a routine skip and it vanished from the failure count. Count
  // `status`, which says which of the two it was.
  it("counts a present-but-broken config as FAILED, never as a skip", async () => {
    await makeSite("espada", { repositoryName: "espada", models: ["page"] });
    await makeSite("hedloc", { brokenConfig: true });
    const fleet = await inventory(["espada", "hedloc"]);
    const r = await runPrismicModelsCommand(
      undefined,
      { cwd: root, fleet, workdir },
      deps({ espada: [customType("page")] }, { PRISMIC_TOKEN_ESPADA: "a" }),
    );
    expect(r.output).toContain("1 checked, 1 failed, 0 skipped");
    expect(r.output).toMatch(/present but unusable/i);
    // A tie is not a majority, so this run is still exit 0 — the COUNT is what
    // this test pins, not the code.
    expect(r.code).toBe(0);
  });

  it("counts a repo with no Prismic config as a skip, not a failure", async () => {
    await makeSite("espada", { repositoryName: "espada", models: ["page"] });
    await makeSite("1836dig", { noConfig: true });
    const fleet = await inventory(["espada", "1836dig"]);
    const r = await runPrismicModelsCommand(
      undefined,
      { cwd: root, fleet, workdir },
      deps({ espada: [customType("page")] }, { PRISMIC_TOKEN_ESPADA: "a" }),
    );
    expect(r.code).toBe(0);
    expect(r.output).toContain("1 checked, 0 failed, 1 skipped");
  });

  // Drift is a finding, not an outage. Reddening the nightly for it would make
  // the alarm meaningless the first time somebody edits a model.
  it("stays exit 0 when a readable site has drifted", async () => {
    await makeSite("espada", { repositoryName: "espada", models: ["page"] });
    const fleet = await inventory(["espada"]);
    const r = await runPrismicModelsCommand(
      undefined,
      { cwd: root, fleet, workdir },
      deps({ espada: [] }, { PRISMIC_TOKEN_ESPADA: "a" }),
    );
    expect(r.code).toBe(0);
    expect(r.output).toContain("1 checked, 0 failed, 0 skipped");
  });

  it("exits 1 when failures are the majority of the fleet", async () => {
    await makeSite("espada", { repositoryName: "espada", models: ["page"] });
    await makeSite("hedloc", { brokenConfig: true });
    await makeSite("revogen", { brokenConfig: true });
    const fleet = await inventory(["espada", "hedloc", "revogen"]);
    const r = await runPrismicModelsCommand(
      undefined,
      { cwd: root, fleet, workdir },
      deps({ espada: [customType("page")] }, { PRISMIC_TOKEN_ESPADA: "a" }),
    );
    expect(r.code).toBe(1);
    expect(r.output).toContain("1 checked, 2 failed, 0 skipped");
  });

  // MUTATION TARGET. `prepareFleetSites` isolates a per-site prep failure into
  // `skipped` so one bad row cannot abort the fleet — but a sweep that only
  // walked `prepared` never counted those sites at all, and a fleet-wide clone
  // outage then reported "0 checked, 0 failed", exit 0, with a warning nobody
  // gates on. A checkout that could not be prepared is a site nobody READ.
  it("counts a site that could not be prepared as failed, not silently dropped", async () => {
    await makeSite("espada", { repositoryName: "espada", models: ["page"] });
    // No directory and no gitRepo → cloneIfNeeded refuses; prep records it.
    const fleet = await inventory(["espada", "ghost-site"]);
    const r = await runPrismicModelsCommand(
      undefined,
      { cwd: root, fleet, workdir },
      deps({ espada: [customType("page")] }, { PRISMIC_TOKEN_ESPADA: "a" }),
    );
    expect(r.output).toContain("1 checked, 1 failed, 0 skipped");
    expect(r.output).toContain("[ghost-site]");
    expect(r.output).toMatch(/could not prepare/i);
    // The notice the nightly greps for a ::warning:: is still there — the row is
    // the COUNT, the notice is the operator signal, and neither replaces the other.
    expect(r.output).toContain("site(s) skipped (could not prepare)");
  });

  // The case the count exists for: nobody could be cloned, so nothing was
  // compared. Under a prepared-only sweep this was 0 checked / 0 failed → exit 0,
  // a fleet-wide outage reported as a clean night.
  it("exits 1 when the whole fleet fails to prepare", async () => {
    const fleet = await inventory(["ghost-a", "ghost-b"]);
    const r = await runPrismicModelsCommand(undefined, { cwd: root, fleet, workdir }, deps({}, {}));
    expect(r.code).toBe(1);
    expect(r.output).toContain("0 checked, 2 failed, 0 skipped");
  });

  // MUTATION TARGET. One repo with a broken config, an unreadable model set or a
  // duplicate model id must not take the other fourteen down with it.
  it("does not abort the sweep when the FIRST site is broken", async () => {
    await makeSite("broken", { brokenConfig: true });
    await makeSite("espada", { repositoryName: "espada", models: ["page"] });
    await makeSite("hedloc", { repositoryName: "hedloc", models: ["page"] });
    const fleet = await inventory(["broken", "espada", "hedloc"]);
    const r = await runPrismicModelsCommand(
      undefined,
      { cwd: root, fleet, workdir },
      deps(
        { espada: [customType("page")], hedloc: [customType("page")] },
        { PRISMIC_TOKEN_ESPADA: "a", PRISMIC_TOKEN_HEDLOC: "b" },
      ),
    );
    expect(r.output).toContain("[espada]");
    expect(r.output).toContain("[hedloc]");
    expect(r.output).toContain("2 checked, 1 failed, 0 skipped");
  });

  // MUTATION TARGET. An unexpected throw from the comparison of one site — the
  // real `remoteModels` validates its payload, so this stands in for any future
  // throw between the input guards and the rendered report — is recorded against
  // THAT site and does not end the run.
  it("records an unexpected throw against the site and keeps sweeping", async () => {
    await makeSite("espada", { repositoryName: "espada", models: ["page"] });
    await makeSite("hedloc", { repositoryName: "hedloc", models: ["page"] });
    const fleet = await inventory(["espada", "hedloc"]);
    const r = await runPrismicModelsCommand(
      undefined,
      { cwd: root, fleet, workdir },
      deps(
        { espada: "malformed", hedloc: [customType("page")] },
        { PRISMIC_TOKEN_ESPADA: "a", PRISMIC_TOKEN_HEDLOC: "b" },
      ),
    );
    expect(r.output).toContain("[hedloc]");
    expect(r.output).toContain("1 checked, 1 failed, 0 skipped");
  });

  // MUTATION TARGET. Every site read fine, so `failed` cannot express this — and
  // a fleet where two repos overwrite each other's models must not report success
  // just because every site was individually readable.
  it("forces a non-zero exit when two sites claim one Prismic repository", async () => {
    await makeSite("the-tower", { repositoryName: "the-tower-burbank", models: ["page"] });
    await makeSite("the-tower-burbank", { repositoryName: "the-tower-burbank", models: ["page"] });
    const fleet = await inventory(["the-tower", "the-tower-burbank"]);
    const r = await runPrismicModelsCommand(
      undefined,
      { cwd: root, fleet, workdir },
      deps({ "the-tower-burbank": [customType("page")] }, { PRISMIC_TOKEN_THE_TOWER_BURBANK: "a" }),
    );
    expect(r.code).toBe(1);
    expect(r.output).toContain("the-tower and the-tower-burbank");
    // DETECTED, not thrown: aborting would take the drift alarm offline for the
    // whole fleet over a config problem in one pair, so every site is still swept.
    expect(r.output).toContain("2 checked, 0 failed, 0 skipped");
  });

  // Fleet mode forbids the generic token. One PRISMIC_WRITE_TOKEN in the
  // environment while iterating every fleet repository would attach the wrong
  // credential to every site after the first — so it must resolve NOTHING here,
  // even though in-repo mode accepts it.
  it("refuses the generic PRISMIC_WRITE_TOKEN", async () => {
    await makeSite("espada", { repositoryName: "espada", models: ["page"] });
    const fleet = await inventory(["espada"]);
    const d = deps({ espada: [customType("page")] }, { PRISMIC_WRITE_TOKEN: "generic" });
    const r = await runPrismicModelsCommand(undefined, { cwd: root, fleet, workdir }, d);
    expect(r.code).toBe(1);
    expect(r.output).toContain("PRISMIC_TOKEN_ESPADA");
    expect(r.output).not.toContain("PRISMIC_WRITE_TOKEN");
    expect(d.remoteModels).not.toHaveBeenCalled();
  });

  // Read-only BY CONSTRUCTION: `apply` is not plumbed through fleet mode at all,
  // so drift across the fleet can never become a push.
  it("never pushes, even when every site has drifted", async () => {
    await makeSite("espada", { repositoryName: "espada", models: ["page"] });
    await makeSite("hedloc", { repositoryName: "hedloc", models: ["page"] });
    const fleet = await inventory(["espada", "hedloc"]);
    const send = vi.fn(async () => {});
    const r = await runPrismicModelsCommand(
      undefined,
      { cwd: root, fleet, workdir },
      deps(
        { espada: [], hedloc: [] },
        { PRISMIC_TOKEN_ESPADA: "a", PRISMIC_TOKEN_HEDLOC: "b" },
        send,
      ),
    );
    expect(send).not.toHaveBeenCalled();
    expect(r.output).toContain("2 checked, 0 failed, 0 skipped");
  });

  // `--apply` is the flag that writes to a live client's Prismic repository.
  // Accepting it beside a mode that cannot push and quietly sweeping read-only
  // exits 0 having pushed nothing — which the operator reads as "the fleet was
  // pushed". A fleet-wide push outside CI is 🔴 under AUTONOMY.md, so this is a
  // refusal and not a feature request.
  it("refuses --fleet --apply (exit 2) and pushes nothing", async () => {
    await makeSite("espada", { repositoryName: "espada", models: ["page"] });
    const fleet = await inventory(["espada"]);
    const send = vi.fn(async () => {});
    const d = deps({ espada: [] }, { PRISMIC_TOKEN_ESPADA: "a" }, send);
    const r = await runPrismicModelsCommand(
      undefined,
      { cwd: root, fleet, workdir, apply: true },
      d,
    );
    expect(r.code).toBe(2);
    expect(r.output).toMatch(/cannot combine/i);
    expect(send).not.toHaveBeenCalled();
    expect(d.remoteModels).not.toHaveBeenCalled();
  });

  // The comment file is ONE repo's review artifact. A fleet run that accepted it
  // and wrote nothing would leave a workflow waiting on a file that never appears.
  it("refuses --fleet --comment-file (exit 2)", async () => {
    await makeSite("espada", { repositoryName: "espada", models: ["page"] });
    const fleet = await inventory(["espada"]);
    const r = await runPrismicModelsCommand(
      undefined,
      { cwd: root, fleet, workdir, commentFile: join(root, "comment.md") },
      deps({ espada: [] }, { PRISMIC_TOKEN_ESPADA: "a" }),
    );
    expect(r.code).toBe(2);
    expect(r.output).toMatch(/cannot combine/i);
  });

  // MUTATION TARGET. An unset workflow variable expands to the EMPTY STRING, and
  // `--fleet ""` fell through every truthiness test in the chain: resolveSites
  // read it as "no fleet" and returned the cwd, so the nightly swept the
  // maintenance repo, found no Prismic config, and reported a clean fleet
  // forever. The whole drift alarm, off, green.
  it("refuses --fleet with an empty value instead of sweeping the cwd", async () => {
    await makeSite("espada", { repositoryName: "espada", models: ["page"] });
    const d = deps({ espada: [] }, { PRISMIC_TOKEN_ESPADA: "a" });
    const r = await runPrismicModelsCommand(undefined, { cwd: root, fleet: "", workdir }, d);
    expect(r.code).toBe(2);
    expect(r.output).toContain("--fleet");
    expect(d.remoteModels).not.toHaveBeenCalled();
  });

  it("refuses a non-string --fleet rather than crashing", async () => {
    const r = await runPrismicModelsCommand(
      undefined,
      { cwd: root, fleet: true as unknown as string, workdir },
      deps({}, {}),
    );
    expect(r.code).toBe(2);
    expect(r.output).toContain("--fleet");
    expect(r.output).toContain("boolean");
  });

  // An inventory that resolves to nothing compared nothing. Exit 0 there is a
  // green tick for a run that learned nothing — and the Airtable inventory is
  // view-filtered, so one filter change empties it without any error at all.
  it("exits 1 when the inventory resolves to zero sites", async () => {
    const fleet = await inventory([]);
    const r = await runPrismicModelsCommand(undefined, { cwd: root, fleet, workdir }, deps({}, {}));
    expect(r.code).toBe(1);
    expect(r.output).toMatch(/no sites/i);
  });

  // MUTATION TARGET — F1. `cloneIfNeeded` accepts ANY non-empty directory as
  // that site's checkout, and `git clone` creates `.git` BEFORE checking the
  // working tree out. So a clone killed in between (its own 5-minute timeout, a
  // cancelled job, a reboot, a full disk) leaves a directory holding `.git`
  // alone — which is non-empty, so no clone is ever attempted again; every config
  // read in it is ENOENT, so the site reported "not a Prismic site — skipped",
  // exit 0, ON EVERY RUN AFTER THE FIRST. One interrupted clone silently retired
  // that site's drift alarm for good.
  it("fails a checkout that holds only a .git, and never calls it 'not a Prismic site'", async () => {
    await makeSite("espada", { repositoryName: "espada", models: ["page"] });
    await makeSite("hedloc", { git: "killed-clone" });
    const fleet = await inventory(["espada", "hedloc"]);
    const r = await runPrismicModelsCommand(
      undefined,
      { cwd: root, fleet, workdir },
      deps({ espada: [customType("page")] }, { PRISMIC_TOKEN_ESPADA: "a" }),
    );
    expect(r.output).toContain("1 checked, 1 failed, 0 skipped");
    expect(r.output).toMatch(/no working tree/i);
    expect(r.output).not.toMatch(/not a Prismic site/i);
  });

  // The DURABILITY is what makes it severe: the leftover directory is still
  // non-empty on the next run, so the verdict has to hold rather than decay back
  // into a green skip.
  it("keeps failing that checkout on the next run", async () => {
    await makeSite("hedloc", { git: "killed-clone" });
    const fleet = await inventory(["hedloc"]);
    const run = () =>
      runPrismicModelsCommand(undefined, { cwd: root, fleet, workdir }, deps({}, {}));
    const first = await run();
    const second = await run();
    expect(first.code).toBe(1);
    expect(second.code).toBe(1);
    expect(second.output).toContain("0 checked, 1 failed, 0 skipped");
    expect(second.output).not.toMatch(/not a Prismic site/i);
  });

  // MUTATION TARGET — F1. Not one site compared, so the run learned nothing. The
  // majority rule cannot express it: 0 checked / 0 failed is exactly what a fleet
  // that legitimately holds no Prismic sites looks like, and "skipped" is inferred
  // from a MISSING config file — so anything that empties the checkouts turns the
  // whole fleet green.
  it("exits 1 when every site was skipped, not one checked", async () => {
    await makeSite("1836dig", { noConfig: true });
    await makeSite("la-homelessness-youth", { noConfig: true });
    const fleet = await inventory(["1836dig", "la-homelessness-youth"]);
    const r = await runPrismicModelsCommand(undefined, { cwd: root, fleet, workdir }, deps({}, {}));
    expect(r.code).toBe(1);
    expect(r.output).toContain("0 checked, 0 failed, 2 skipped");
    expect(r.output).toMatch(/NOT ONE SITE WAS CHECKED/);
  });

  // MUTATION TARGET — F2. Two DIFFERENT Prismic repositories deriving ONE
  // PRISMIC_TOKEN_*. There is no repositoryName collision here, so the other
  // detector sees nothing — and the sweep is attaching one client's credential to
  // another client's repository, which is the worst thing fleet mode can do.
  it("goes non-zero when two repositories derive one token secret", async () => {
    await makeSite("a", { repositoryName: "the-pointe", models: ["page"] });
    await makeSite("b", { repositoryName: "the.pointe", models: ["page"] });
    const fleet = await inventory(["a", "b"]);
    const r = await runPrismicModelsCommand(
      undefined,
      { cwd: root, fleet, workdir },
      deps(
        { "the-pointe": [customType("page")], "the.pointe": [customType("page")] },
        { PRISMIC_TOKEN_THE_POINTE: "one-token-for-two-clients" },
      ),
    );
    expect(r.code).toBe(1);
    expect(r.output).toContain("PRISMIC_TOKEN_THE_POINTE");
    expect(r.output).toMatch(/One token secret derived by more than one/i);
    // REPORTED SEPARATELY from a repositoryName collision: the fixes differ, and
    // these two configs are both correct.
    expect(r.output).not.toMatch(/claimed by more than one site/i);
    // Detected, not thrown — every site is still swept.
    expect(r.output).toContain("2 checked, 0 failed, 0 skipped");
  });

  // MUTATION TARGET — F3. One site listed twice is an inventory wart, not two
  // sites fighting over a repository. Reporting it as a collision sends the
  // operator to change a live client repo's slicemachine.config.json for a
  // conflict that does not exist, and reddens the nightly while doing it.
  it("reports a duplicated inventory row as a note, not as a collision", async () => {
    await makeSite("espada", { repositoryName: "espada", models: ["page"] });
    const fleet = await inventory(["espada", "espada"]);
    const r = await runPrismicModelsCommand(
      undefined,
      { cwd: root, fleet, workdir },
      deps({ espada: [customType("page")] }, { PRISMIC_TOKEN_ESPADA: "a" }),
    );
    expect(r.code).toBe(0);
    expect(r.output).not.toContain("⛔");
    expect(r.output).toMatch(/listed more than once in the inventory/i);
    // Both rows were really swept, so the count says so rather than hiding it.
    expect(r.output).toContain("2 checked, 0 failed, 0 skipped");
  });

  // F4. The sweep reuses whatever checkout is in the workdir and never refreshes
  // it, so a verdict can describe a tree from days ago while main has moved. It is
  // reported rather than refreshed — see resolveCheckoutCommit — so the report has
  // to say WHICH commit it compared, and say that it never refreshed it.
  it("names the commit each verdict describes and says no checkout was refreshed", async () => {
    await makeSite("espada", { repositoryName: "espada", models: ["page"] });
    const fleet = await inventory(["espada"]);
    const r = await runPrismicModelsCommand(
      undefined,
      { cwd: root, fleet, workdir },
      deps({ espada: [customType("page")] }, { PRISMIC_TOKEN_ESPADA: "a" }),
    );
    expect(r.output).toContain(`[espada] @ ${SHA.slice(0, 12)}`);
    expect(r.output).toMatch(/never fetches, pulls or resets a checkout/i);
  });

  // A checkout whose commit cannot be read is still compared — but it must say so
  // in the place the commit would have been, rather than leaving a blank that
  // reads like "no commit".
  it("says the commit was NOT RESOLVED rather than leaving it blank", async () => {
    await makeSite("espada", { repositoryName: "espada", models: ["page"], git: "none" });
    const fleet = await inventory(["espada"]);
    const r = await runPrismicModelsCommand(
      undefined,
      { cwd: root, fleet, workdir },
      deps({ espada: [customType("page")] }, { PRISMIC_TOKEN_ESPADA: "a" }),
    );
    expect(r.output).toContain("1 checked, 0 failed, 0 skipped");
    expect(r.output).toContain("COMMIT NOT RESOLVED");
  });

  // Task 20 built `--write-airtable`, so the nightly's real invocation
  // (`--fleet airtable --write-airtable`) must now SWEEP rather than refuse — the
  // inverse of what this case asserted while the mode was unbuilt, and worth
  // keeping in that form: a refusal that outlives its reason is a nightly that
  // silently stops sweeping.
  //
  // This file's deps hand over a sink that throws, so the write step reports that
  // nothing was written and the run goes non-zero — which is the right answer for
  // "asked to write, wrote nothing", and is asserted here as such. The verdicts
  // actually landing is tests/cli/prismic-models-writeback.test.ts.
  it("sweeps rather than refusing when --write-airtable is added to --fleet", async () => {
    await makeSite("espada", { repositoryName: "espada", models: ["page"] });
    const fleet = await inventory(["espada"]);
    const d = deps({ espada: [customType("page")] }, { PRISMIC_TOKEN_ESPADA: "a" });
    const r = await runPrismicModelsCommand(
      undefined,
      { cwd: root, fleet, workdir, writeAirtable: true },
      d,
    );
    expect(r.output).not.toContain("NOT IMPLEMENTED");
    expect(d.remoteModels).toHaveBeenCalled();
    expect(r.output).toContain("1 checked, 0 failed, 0 skipped");
    // Asked to write, wrote nothing, said so, and did not exit 0.
    expect(r.output).toMatch(/NOTHING WAS WRITTEN/);
    expect(r.code).toBe(1);
  });
});
