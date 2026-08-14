import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  prismicSweepExitCode,
  findRepositoryCollisions,
  describeCollisions,
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

// Every row lands in exactly one bucket, so a site can never fall out of the
// total — the same rule the token doctor's summary follows. A summary that
// counted only the outcomes an operator likes is how unreadable sites disappear.
describe("summariseSweep", () => {
  const row = (over: Partial<SweepRow>): SweepRow => ({
    site: "espada",
    repositoryName: "espada",
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
};

async function makeSite(name: string, spec: SiteSpec): Promise<void> {
  const dir = join(root, name);
  await mkdir(dir, { recursive: true });
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

  // Task 20 implements --write-airtable. Until then a fleet sweep that ran and
  // wrote nothing would report success to a workflow that believes the rows were
  // updated, which is the same silent no-op the guard exists to stop.
  it("still refuses --write-airtable alongside the implemented --fleet", async () => {
    await makeSite("espada", { repositoryName: "espada", models: ["page"] });
    const fleet = await inventory(["espada"]);
    const d = deps({ espada: [customType("page")] }, { PRISMIC_TOKEN_ESPADA: "a" });
    const r = await runPrismicModelsCommand(
      undefined,
      { cwd: root, fleet, workdir, writeAirtable: true },
      d,
    );
    expect(r.code).toBe(1);
    expect(r.output).toContain("--write-airtable");
    expect(r.output).toContain("NOT IMPLEMENTED");
    expect(d.remoteModels).not.toHaveBeenCalled();
  });
});
