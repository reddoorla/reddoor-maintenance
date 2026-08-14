import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import {
  renderTokenDoctor,
  runPrismicModelsCommand,
  type PrismicModelsDeps,
  type TokenProbe,
} from "../../src/cli/commands/prismic-models.js";
import type { SpawnFn } from "../../src/audits/util/spawn.js";

const probe = (over: Partial<TokenProbe> = {}): TokenProbe => ({
  site: "Espada",
  status: "checked",
  repositoryName: "espada",
  expectedEnv: "PRISMIC_TOKEN_ESPADA",
  present: true,
  reads: true,
  ...over,
});

describe("renderTokenDoctor", () => {
  it("prints one row per site with the env var it looked for", () => {
    const out = renderTokenDoctor([probe()]);
    expect(out).toContain("Espada");
    expect(out).toContain("espada");
    expect(out).toContain("PRISMIC_TOKEN_ESPADA");
  });

  it("marks a missing token", () => {
    expect(renderTokenDoctor([probe({ present: false, reads: null })])).toContain("MISSING");
  });

  // Token expiry is undocumented (never proven either way). A token that is
  // PRESENT but no longer reads is the shape an expiry would take, so the doctor
  // has to distinguish the two rather than printing one "ok/not ok" column.
  it("distinguishes present-but-unreadable from missing", () => {
    const out = renderTokenDoctor([
      probe({ present: true, reads: false, error: "403 explicit deny" }),
    ]);
    expect(out).toContain("PRESENT BUT 403/FAILED");
    expect(out).toContain("403 explicit deny");
    expect(out).not.toContain("MISSING");
  });

  it("marks a working token OK", () => {
    expect(renderTokenDoctor([probe()])).toContain("OK");
  });

  // `reads: null` is "nobody checked", and this doctor never checks — it makes no
  // Prismic call at all. Printing OK for a secret that merely EXISTS is the
  // governing rule of this pipeline pointed at its own output: "I did not look"
  // must not render the same as "I looked and it works".
  it("does not report a present-but-unchecked token as OK", () => {
    const out = renderTokenDoctor([probe({ present: true, reads: null })]);
    expect(out).toContain("PRESENT (not verified)");
    expect(out).not.toMatch(/\bOK\b/);
    expect(out).not.toContain("MISSING");
  });

  it("skips a non-Prismic site with a reason instead of a fake failure", () => {
    const out = renderTokenDoctor([
      {
        site: "Data Dynamiq",
        status: "skipped",
        repositoryName: null,
        expectedEnv: null,
        present: false,
        reads: null,
      },
    ]);
    expect(out).toContain("Data Dynamiq");
    expect(out).toMatch(/no Prismic/i);
  });

  // THE GOVERNING RULE, at the doctor layer. A config that is THERE and broken
  // yields no repositoryName — exactly like a repo that has no Prismic at all —
  // so a renderer keyed on `repositoryName === null` reports a live site whose
  // config just broke as "no token needed", and the operator mints nothing.
  // Keyed on `status`, which is the same lesson `SiteCheckStatus` records one
  // screen up in the same file.
  it("does not report an unreadable site as a site with no Prismic", () => {
    const out = renderTokenDoctor([
      {
        site: "Hedloc",
        status: "failed",
        repositoryName: null,
        expectedEnv: null,
        present: false,
        reads: null,
        error: "slicemachine.config.json: invalid JSON",
      },
    ]);
    expect(out).toContain("Hedloc");
    expect(out).toContain("CANNOT TELL");
    expect(out).toContain("slicemachine.config.json");
    expect(out).not.toMatch(/no Prismic/i);
    expect(out).not.toContain("MISSING");
  });

  it("summarises the counts on the last line", () => {
    const out = renderTokenDoctor([
      probe(),
      probe({ site: "Hedloc", present: false, reads: null }),
    ]);
    expect(out.trim().split("\n").at(-1)).toMatch(/1 ok, 1 missing, 0 failing/);
  });

  // A site nobody could read must be COUNTED, not silently dropped out of the
  // total. A summary reading "0 ok, 0 missing, 0 failing" over a fleet of
  // unreadable checkouts is the same lie in one line.
  it("counts unreadable sites in the summary and says so above it", () => {
    const out = renderTokenDoctor([
      probe(),
      {
        site: "Hedloc",
        status: "failed",
        repositoryName: null,
        expectedEnv: null,
        present: false,
        reads: null,
        error: "boom",
      },
    ]);
    expect(out.trim().split("\n").at(-1)).toMatch(/1 unreadable/);
    expect(out).toMatch(/could not be read/i);
  });

  it("never prints a token value", () => {
    // Structural, not stylistic: `TokenProbe` carries no token field at all, so
    // there is nothing here that COULD be printed.
    const out = renderTokenDoctor([probe()]);
    expect(out).not.toContain("Bearer");
    expect(Object.keys(probe())).not.toContain("token");
  });

  // A length heuristic ("anything over 40 characters must be a secret") would be
  // WRONG on this fleet: medical-solutions-of-texas's Prismic repository is
  // `msot`, but a repository actually named `medical-solutions-of-texas` derives
  // a 40-character env var name. The guarantee is that no value is ever held,
  // not that long strings are suppressed — so the NAME must survive in full.
  it("prints a long env var name in full rather than eliding it", () => {
    const expectedEnv = "PRISMIC_TOKEN_MEDICAL_SOLUTIONS_OF_TEXAS";
    expect(expectedEnv.length).toBeGreaterThanOrEqual(40);
    const out = renderTokenDoctor([
      probe({ site: "MSOT", repositoryName: "medical-solutions-of-texas", expectedEnv }),
    ]);
    expect(out).toContain(expectedEnv);
  });
});

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "prismic-tokens-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const deps = (env: Record<string, string | undefined> = {}): PrismicModelsDeps => ({
  remoteModels: vi.fn(async () => []),
  sendModel: vi.fn(async () => {}),
  env,
  // The doctor spawns nothing. Injected so a regression that shells out shows up
  // as a call on this mock rather than as a real process.
  spawn: vi.fn<SpawnFn>(async () => ({ code: 0, stdout: "", stderr: "" })),
  // No test in this file writes to Airtable. Required (not optional) on the deps
  // type precisely so that stays true by construction: a stub that throws is the
  // only way this path can be reached from here.
  openVerdictSink: async () => {
    throw new Error("this test never opens Airtable");
  },
});

const site = (repositoryName = "espada"): Promise<void> =>
  writeFile(
    join(dir, "slicemachine.config.json"),
    JSON.stringify({ repositoryName, libraries: ["./src/lib/slices"] }),
  );

describe("runPrismicModelsCommand --tokens", () => {
  // repo -> Prismic repository -> env var, on one line. The three genuinely
  // differ (beachfront-dentistry's Prismic repository is `48bb12d1`), and a
  // secret name nobody can attribute to a site is a secret nobody mints.
  it("prints the repo, the Prismic repository and the secret name it looked for", async () => {
    await site();
    const r = await runPrismicModelsCommand(
      undefined,
      { cwd: dir, tokens: true },
      deps({ PRISMIC_TOKEN_ESPADA: "value" }),
    );
    expect(r.output).toContain(basename(dir));
    expect(r.output).toContain("espada");
    expect(r.output).toContain("PRISMIC_TOKEN_ESPADA");
    expect(r.code).toBe(0);
  });

  it("exits 1 naming the secret nobody has minted yet", async () => {
    await site();
    const r = await runPrismicModelsCommand(undefined, { cwd: dir, tokens: true }, deps({}));
    expect(r.code).toBe(1);
    expect(r.output).toContain("PRISMIC_TOKEN_ESPADA");
    expect(r.output).toContain("MISSING");
  });

  // `resolvePrismicToken` treats a whitespace-only value as absent, so a doctor
  // that called it present would report a secret the pipeline itself refuses.
  it("counts a whitespace-only secret as missing, exactly as the resolver does", async () => {
    await site();
    const r = await runPrismicModelsCommand(
      undefined,
      { cwd: dir, tokens: true },
      deps({ PRISMIC_TOKEN_ESPADA: "   " }),
    );
    expect(r.code).toBe(1);
    expect(r.output).toContain("MISSING");
  });

  // This is the per-repository checklist, and the header says so. The generic
  // name is what the in-repo CI run falls back to (Task 24) — it is not this
  // repository's secret, so it cannot tick this repository's box.
  it("reports the canonical secret as missing even when a generic one is set", async () => {
    await site();
    const r = await runPrismicModelsCommand(
      undefined,
      { cwd: dir, tokens: true },
      deps({ PRISMIC_WRITE_TOKEN: "generic" }),
    );
    expect(r.code).toBe(1);
    expect(r.output).toContain("MISSING");
  });

  // THE MUTATION TARGET. A config that is present and broken must not land on
  // the "no Prismic here" skip: that reports a live client's site as needing no
  // secret at all, and it exits 0 while doing it.
  it("does not report an unreadable config as a site that needs no token", async () => {
    await writeFile(join(dir, "slicemachine.config.json"), "{ not json");
    const r = await runPrismicModelsCommand(undefined, { cwd: dir, tokens: true }, deps({}));
    expect(r.code).toBe(1);
    expect(r.output).toContain("CANNOT TELL");
    expect(r.output).toContain("slicemachine.config.json");
    expect(r.output).not.toMatch(/no Prismic/i);
  });

  // Same rule one layer out: a checkout that is not there is not a repo without
  // Prismic. Every config read under a missing directory is ENOENT, which reads
  // as "this repo has no Prismic config" all the way to a green exit.
  it("does not report a missing checkout as a site that needs no token", async () => {
    const missing = join(dir, "no-such-checkout");
    const r = await runPrismicModelsCommand(missing, { cwd: dir, tokens: true }, deps({}));
    expect(r.code).toBe(1);
    expect(r.output).toContain("CANNOT TELL");
    expect(r.output).not.toMatch(/no Prismic/i);
  });

  // The same rule again for the checkout that EXISTS and holds nothing but a
  // `.git` — what a killed clone leaves. The doctor's skip row says "this repo
  // needs no secret", which is the same wrong answer as the sweep's, so the
  // check is shared rather than repeated.
  it("does not report a checkout with no working tree as a site that needs no token", async () => {
    await mkdir(join(dir, ".git"), { recursive: true });
    const r = await runPrismicModelsCommand(undefined, { cwd: dir, tokens: true }, deps({}));
    expect(r.code).toBe(1);
    expect(r.output).toContain("CANNOT TELL");
    expect(r.output).toMatch(/no working tree/i);
  });

  // A repo with no Prismic config is a repo with FILES in it and no config; an
  // empty directory is a checkout that was never established, and is now its own
  // failure (see the working-tree test above).
  it("is a clean skip on a repo with no Prismic config", async () => {
    await writeFile(join(dir, "package.json"), "{}");
    const r = await runPrismicModelsCommand(undefined, { cwd: dir, tokens: true }, deps({}));
    expect(r.code).toBe(0);
    expect(r.output).toMatch(/no Prismic/i);
  });

  // THE MUTATION TARGET. The doctor exists to name secrets; a doctor that
  // printed one would put a live write credential into CI logs, an operator's
  // scrollback, and any file the output is piped to.
  it("never prints the token value it found", async () => {
    await site();
    const value = "prismic-write-token-value-that-must-never-be-printed";
    const r = await runPrismicModelsCommand(
      undefined,
      { cwd: dir, tokens: true },
      deps({ PRISMIC_TOKEN_ESPADA: value, PRISMIC_WRITE_TOKEN: "generic-value-also-secret" }),
    );
    expect(r.output).not.toContain(value);
    expect(r.output).not.toContain("generic-value-also-secret");
    expect(r.output).toContain("PRISMIC_TOKEN_ESPADA");
  });

  // The doctor answers "is the secret set", never "does it work" — a fleet-wide
  // Prismic call per site is not a thing a checklist may do behind an operator's
  // back, and the report says "not verified" precisely because of this.
  it("makes no Prismic call at all", async () => {
    await site();
    const d = deps({ PRISMIC_TOKEN_ESPADA: "value" });
    const r = await runPrismicModelsCommand(undefined, { cwd: dir, tokens: true }, d);
    expect(d.remoteModels).not.toHaveBeenCalled();
    expect(d.sendModel).not.toHaveBeenCalled();
    expect(r.output).toContain("not verified");
  });

  // `--apply` is the flag that writes to a live client's Prismic repository.
  // Accepting it alongside a read-only doctor and quietly ignoring it would exit
  // 0 having pushed nothing, which an operator reads as "the push worked".
  it("refuses --tokens with --apply (exit 2) and pushes nothing", async () => {
    await site();
    const d = deps({ PRISMIC_TOKEN_ESPADA: "value" });
    const r = await runPrismicModelsCommand(undefined, { cwd: dir, tokens: true, apply: true }, d);
    expect(r.code).toBe(2);
    expect(r.output).toMatch(/cannot combine/i);
    expect(d.sendModel).not.toHaveBeenCalled();
    expect(d.remoteModels).not.toHaveBeenCalled();
  });

  // `--comment-file` is the in-repo check's review artifact. Accepting it here
  // and writing nothing leaves a workflow waiting on a file that never appears.
  it("refuses --tokens with --comment-file (exit 2)", async () => {
    await site();
    const r = await runPrismicModelsCommand(
      undefined,
      { cwd: dir, tokens: true, commentFile: join(dir, "comment.md") },
      deps({ PRISMIC_TOKEN_ESPADA: "value" }),
    );
    expect(r.code).toBe(2);
    expect(r.output).toMatch(/cannot combine/i);
  });

  // Task 15 implements --tokens, so it leaves the guard's list. The guard must
  // still fire for the modes that really are unbuilt.
  it("no longer reports --tokens as unimplemented", async () => {
    await site();
    const r = await runPrismicModelsCommand(
      undefined,
      { cwd: dir, tokens: true },
      deps({ PRISMIC_TOKEN_ESPADA: "value" }),
    );
    expect(r.output).not.toContain("NOT IMPLEMENTED");
  });

  // Task 17b builds `--tokens --fleet`, so the last entry leaves the
  // unimplemented-combination guard — and the guard goes with it, for the reason
  // Task 20 gave when it deleted the per-flag table: a guard that lists nothing
  // protects nothing while still reading like protection to the next person.
  // What must not go with it is the REFUSALS, which are a different fact
  // entirely (see the conflicts suite below).
  it("no longer reports --tokens --fleet as unimplemented", async () => {
    await site();
    const fleet = join(dir, "inventory.json");
    await writeFile(fleet, JSON.stringify([{ name: "espada", path: dir }]));
    const r = await runPrismicModelsCommand(
      undefined,
      { cwd: dir, tokens: true, fleet, workdir: join(dir, ".workdir") },
      deps({ PRISMIC_TOKEN_ESPADA: "value" }),
    );
    expect(r.output).not.toContain("NOT IMPLEMENTED");
  });
});

// ---------------------------------------------------------------------------
// `--tokens --fleet`: the doctor across the whole fleet.
//
// The mode the plan documents in three places — the nightly workflow's comment,
// the rollout recipe's operator step, and the live-proof step — and the one an
// operator reads to decide which PRISMIC_TOKEN_* secrets to mint. Every failure
// shape below is the same one: a site whose secret requirement nobody
// established must never render as a site that needs no secret.
// ---------------------------------------------------------------------------

let fleetRoot: string;
let fleetWork: string;
beforeEach(async () => {
  fleetRoot = await mkdtemp(join(tmpdir(), "prismic-tokens-fleet-"));
  fleetWork = join(fleetRoot, ".workdir");
});
afterEach(async () => {
  await rm(fleetRoot, { recursive: true, force: true });
});

/** One fleet checkout. Always non-empty, so a site with NO config is a readable
 *  repo rather than the killed-clone shape (which is its own failure). */
const fleetSite = async (
  name: string,
  repositoryName?: string,
  opts: { brokenConfig?: boolean } = {},
): Promise<void> => {
  const d = join(fleetRoot, name);
  await mkdir(d, { recursive: true });
  await writeFile(join(d, "package.json"), JSON.stringify({ name }));
  if (opts.brokenConfig) {
    await writeFile(join(d, "slicemachine.config.json"), "{ this is not json");
    return;
  }
  if (repositoryName !== undefined) {
    await writeFile(
      join(d, "slicemachine.config.json"),
      JSON.stringify({ repositoryName, libraries: ["./src/lib/slices"] }),
    );
  }
};

/** An inventory naming sites by directory. A name with no directory behind it
 *  and no gitRepo is a site that cannot be PREPARED — no checkout, no clone
 *  source — which is the fleet-wide clone outage in miniature. */
const fleetInventory = async (names: string[]): Promise<string> => {
  const path = join(fleetRoot, "inventory.json");
  await writeFile(
    path,
    JSON.stringify(names.map((name) => ({ name, path: join(fleetRoot, name) }))),
  );
  return path;
};

describe("runPrismicModelsCommand --tokens --fleet", () => {
  // THE WHOLE VALUE OF THE COMMAND: repo → Prismic repository → secret, on one
  // line, for every site. Four fleet repos differ between the two names, and
  // PRISMIC_TOKEN_48BB12D1 is otherwise unattributable to any site on earth.
  it("prints repo, Prismic repository and secret for EVERY site in the inventory", async () => {
    await fleetSite("espada", "espada");
    await fleetSite("beachfront-dentistry", "48bb12d1");
    const fleet = await fleetInventory(["espada", "beachfront-dentistry"]);
    const r = await runPrismicModelsCommand(
      undefined,
      { cwd: fleetRoot, tokens: true, fleet, workdir: fleetWork },
      deps({ PRISMIC_TOKEN_ESPADA: "a", PRISMIC_TOKEN_48BB12D1: "b" }),
    );
    expect(r.code).toBe(0);
    expect(r.output).toContain("espada");
    expect(r.output).toContain("PRISMIC_TOKEN_ESPADA");
    expect(r.output).toContain("beachfront-dentistry");
    expect(r.output).toContain("48bb12d1");
    expect(r.output).toContain("PRISMIC_TOKEN_48BB12D1");
    // Both rows, not one: a single-row table under a fleet-wide heading is the
    // exact failure this mode was refused for until it existed.
    expect(r.output).toContain("2 unverified");
  });

  // Nothing here calls Prismic, so "the secret is set" is all that was learnt.
  // OK for a credential nobody tested is this pipeline's governing rule pointed
  // at the doctor's own output.
  it("reports a set secret as PRESENT (not verified), never OK", async () => {
    await fleetSite("espada", "espada");
    const fleet = await fleetInventory(["espada"]);
    const d = deps({ PRISMIC_TOKEN_ESPADA: "a" });
    const r = await runPrismicModelsCommand(
      undefined,
      { cwd: fleetRoot, tokens: true, fleet, workdir: fleetWork },
      d,
    );
    expect(r.output).toContain("PRESENT (not verified)");
    expect(r.output).not.toMatch(/\bOK\b/);
    expect(d.remoteModels).not.toHaveBeenCalled();
    expect(d.sendModel).not.toHaveBeenCalled();
  });

  // The gate on the operator step: a checklist with an unminted secret on it
  // must not exit 0, or the rollout proceeds against a fleet that cannot push.
  it("exits 1 naming the secret nobody has minted yet", async () => {
    await fleetSite("espada", "espada");
    await fleetSite("hedloc", "hedloc");
    const fleet = await fleetInventory(["espada", "hedloc"]);
    const r = await runPrismicModelsCommand(
      undefined,
      { cwd: fleetRoot, tokens: true, fleet, workdir: fleetWork },
      deps({ PRISMIC_TOKEN_ESPADA: "a" }),
    );
    expect(r.code).toBe(1);
    expect(r.output).toContain("PRISMIC_TOKEN_HEDLOC");
    expect(r.output).toContain("MISSING");
    expect(r.output).toContain("1 missing");
  });

  // THE MUTATION TARGET, and the bug Task 17 fixed in the sweep, in the doctor's
  // own shape: `prepareFleetSites` isolates a clone failure into `skipped`, so a
  // doctor built from `prep.prepared` alone drops that site off the checklist
  // entirely — 1 site listed, exit 0, and an operator mints one secret believing
  // they covered two. A checkout nobody could establish has an UNKNOWN token
  // requirement, which is not the same as needing none.
  it("counts a site that could not be PREPARED as unreadable, never as needing no token", async () => {
    await fleetSite("espada", "espada");
    // No directory and no gitRepo → cloneIfNeeded refuses; prep records it.
    const fleet = await fleetInventory(["espada", "ghost-site"]);
    const r = await runPrismicModelsCommand(
      undefined,
      { cwd: fleetRoot, tokens: true, fleet, workdir: fleetWork },
      deps({ PRISMIC_TOKEN_ESPADA: "a" }),
    );
    expect(r.code).toBe(1);
    expect(r.output).toContain("ghost-site");
    expect(r.output).toContain("CANNOT TELL");
    expect(r.output).toContain("1 unreadable");
    expect(r.output).not.toMatch(/needs no token/);
    // The notice the fleet nightlies grep for a ::warning:: survives alongside
    // the row — the row is the COUNT, the notice is the operator signal.
    expect(r.output).toContain("site(s) skipped (could not prepare)");
  });

  // The case the count exists for. Under a prepared-only doctor this printed an
  // empty checklist and exited 0: a fleet-wide clone outage reported as "no
  // secrets needed".
  it("exits 1 when the whole fleet fails to prepare", async () => {
    const fleet = await fleetInventory(["ghost-a", "ghost-b"]);
    const r = await runPrismicModelsCommand(
      undefined,
      { cwd: fleetRoot, tokens: true, fleet, workdir: fleetWork },
      deps({}),
    );
    expect(r.code).toBe(1);
    expect(r.output).toContain("2 unreadable");
    expect(r.output).not.toMatch(/needs no token/);
  });

  // Same rule inside a checkout that WAS prepared: a config that is present and
  // broken yields no repositoryName, exactly like a repo with no Prismic at all.
  it("does not report a broken config as a site with no Prismic", async () => {
    await fleetSite("espada", "espada");
    await fleetSite("hedloc", undefined, { brokenConfig: true });
    const fleet = await fleetInventory(["espada", "hedloc"]);
    const r = await runPrismicModelsCommand(
      undefined,
      { cwd: fleetRoot, tokens: true, fleet, workdir: fleetWork },
      deps({ PRISMIC_TOKEN_ESPADA: "a" }),
    );
    expect(r.code).toBe(1);
    expect(r.output).toContain("CANNOT TELL");
    expect(r.output).toContain("slicemachine.config.json");
    expect(r.output).toContain("1 unreadable");
    expect(r.output).not.toMatch(/needs no token/);
  });

  it("still skips a readable repo that genuinely has no Prismic in it", async () => {
    await fleetSite("espada", "espada");
    await fleetSite("1836dig");
    const fleet = await fleetInventory(["espada", "1836dig"]);
    const r = await runPrismicModelsCommand(
      undefined,
      { cwd: fleetRoot, tokens: true, fleet, workdir: fleetWork },
      deps({ PRISMIC_TOKEN_ESPADA: "a" }),
    );
    expect(r.code).toBe(0);
    expect(r.output).toContain("1 skipped");
    expect(r.output).toContain("needs no token");
  });

  // THE MUTATION TARGET. This mode reads EVERY site's secret out of one
  // environment, so a doctor that printed a value would spill the whole fleet's
  // write credentials into a CI log in one run. Asserted as the real property —
  // a value planted in `env` never reaches the output — never as a length
  // heuristic, which PRISMIC_TOKEN_MEDICAL_SOLUTIONS_OF_TEXAS (40 characters)
  // would trip on the NAME while proving nothing about the value.
  it("never prints any site's token value", async () => {
    await fleetSite("espada", "espada");
    await fleetSite("beachfront-dentistry", "48bb12d1");
    const fleet = await fleetInventory(["espada", "beachfront-dentistry"]);
    const espadaToken = "espada-write-token-value-that-must-never-be-printed";
    const beachfrontToken = "beachfront-write-token-value-that-must-never-be-printed";
    const r = await runPrismicModelsCommand(
      undefined,
      { cwd: fleetRoot, tokens: true, fleet, workdir: fleetWork },
      deps({
        PRISMIC_TOKEN_ESPADA: espadaToken,
        PRISMIC_TOKEN_48BB12D1: beachfrontToken,
        PRISMIC_WRITE_TOKEN: "generic-value-also-secret",
      }),
    );
    expect(r.output).not.toContain(espadaToken);
    expect(r.output).not.toContain(beachfrontToken);
    expect(r.output).not.toContain("generic-value-also-secret");
    // The NAMES are the product, and they survive in full.
    expect(r.output).toContain("PRISMIC_TOKEN_ESPADA");
    expect(r.output).toContain("PRISMIC_TOKEN_48BB12D1");
    // Structural, not stylistic: the row type has no field a value could sit in.
    expect(Object.keys(probe())).not.toContain("token");
  });

  // The second axis of the collision, and the one the doctor is the right place
  // to catch: two DIFFERENT Prismic repositories that upper-snake onto one
  // PRISMIC_TOKEN_* would silently share a credential, so an operator must see
  // it BEFORE minting rather than after one client's token reaches another
  // client's repository.
  it("reports two repositories deriving one secret, and goes non-zero for it", async () => {
    await fleetSite("the-pointe", "the-pointe");
    await fleetSite("the-pointe-two", "the.pointe");
    const fleet = await fleetInventory(["the-pointe", "the-pointe-two"]);
    const r = await runPrismicModelsCommand(
      undefined,
      { cwd: fleetRoot, tokens: true, fleet, workdir: fleetWork },
      // BOTH secrets resolve, so without the collision rule this run is exit 0
      // with a checklist that looks complete.
      deps({ PRISMIC_TOKEN_THE_POINTE: "a" }),
    );
    expect(r.code).toBe(1);
    expect(r.output).toContain("PRISMIC_TOKEN_THE_POINTE");
    expect(r.output).toContain("the.pointe");
    expect(r.output).toMatch(/more than one Prismic repository/i);
  });

  // The sweep's finding, in the doctor's output, because the doctor inflates the
  // same way: a site listed twice is probed twice, so its row and its verdict are
  // counted twice ("2 unverified" for one site). `findTokenEnvCollisions` then
  // silently DEDUPES it — correctly, it is not a collision — which leaves the
  // inflation with nothing anywhere that says why. A NOTE, not an alarm and not
  // part of the exit code: every row was really probed, no secret is wrong, and
  // the thing to change is the inventory.
  it("says a duplicated inventory row is why the counts are inflated", async () => {
    await fleetSite("espada", "espada");
    const fleet = await fleetInventory(["espada", "espada"]);
    const r = await runPrismicModelsCommand(
      undefined,
      { cwd: fleetRoot, tokens: true, fleet, workdir: fleetWork },
      deps({ PRISMIC_TOKEN_ESPADA: "a" }),
    );
    expect(r.code).toBe(0);
    expect(r.output).toMatch(/listed more than once in the inventory/i);
    // Both rows were really probed, so the count says so rather than hiding one.
    expect(r.output).toContain("2 unverified");
    // The duplicate is NOT the two-repositories-one-secret alarm: one site
    // repeated derives one env var, and sending the operator to rename a Prismic
    // repository for it would be a live-client change for a conflict that does
    // not exist.
    expect(r.output).not.toMatch(/more than one Prismic repository/i);
  });

  // An inventory that names nobody is not a fleet with no secrets to mint. The
  // Airtable inventory is view-filtered, so one filter change empties it with no
  // error anywhere — and an empty checklist reads exactly like a finished one.
  it("refuses an inventory that resolved no sites instead of printing an empty checklist", async () => {
    const fleet = await fleetInventory([]);
    const r = await runPrismicModelsCommand(
      undefined,
      { cwd: fleetRoot, tokens: true, fleet, workdir: fleetWork },
      deps({}),
    );
    expect(r.code).toBe(1);
    expect(r.output).toMatch(/NO SITES/i);
  });

  // The shape of the failures nobody has thought of yet: every site coming back
  // "no Prismic config" is what an emptied set of checkouts looks like, and it
  // prints as a confident "this fleet needs no secrets at all", exit 0.
  it("refuses a run in which not one site's requirement was established", async () => {
    await fleetSite("a");
    await fleetSite("b");
    const fleet = await fleetInventory(["a", "b"]);
    const r = await runPrismicModelsCommand(
      undefined,
      { cwd: fleetRoot, tokens: true, fleet, workdir: fleetWork },
      deps({}),
    );
    expect(r.code).toBe(1);
    expect(r.output).toMatch(/NOT ONE SITE/i);
  });
});

// The refusals that must SURVIVE Task 17b. `--tokens --fleet` leaving the
// unimplemented list is not a licence for the contradictions, which are a
// different fact with a different exit code (2 — a malformed invocation, not a
// finding about a site).
describe("runPrismicModelsCommand — refusals that outlive --tokens --fleet", () => {
  const cases: Array<[string, Parameters<typeof runPrismicModelsCommand>[1]]> = [
    ["--fleet --apply", { fleet: "inventory.json", apply: true }],
    ["--fleet --comment-file", { fleet: "inventory.json", commentFile: "comment.md" }],
    ["--fleet --pull", { fleet: "inventory.json", pull: true }],
    ["--tokens --apply", { tokens: true, apply: true }],
    ["--tokens --comment-file", { tokens: true, commentFile: "comment.md" }],
    ["--tokens --pull", { tokens: true, pull: true }],
    ["--tokens --fleet --apply", { tokens: true, fleet: "inventory.json", apply: true }],
    ["--write-airtable without --fleet", { writeAirtable: true }],
    // NEW WITH THIS TASK. `--write-airtable` persists a fleet SWEEP's per-site
    // model verdicts; the doctor produces none. Before Task 17b this pair was
    // caught by the unimplemented-combination guard on its way past; with
    // `--tokens --fleet` built, the tokens branch runs FIRST and the run would
    // print a checklist, write nothing, and exit 0 for an operator who asked for
    // a write-back.
    [
      "--tokens --fleet --write-airtable",
      { tokens: true, fleet: "inventory.json", writeAirtable: true },
    ],
  ];
  for (const [name, opts] of cases) {
    it(`still refuses ${name}`, async () => {
      const d = deps({ PRISMIC_TOKEN_ESPADA: "value" });
      const r = await runPrismicModelsCommand(undefined, { ...opts, cwd: fleetRoot }, d);
      expect(r.code).toBe(2);
      expect(r.output).toMatch(/cannot combine|needs --fleet/i);
      expect(d.sendModel).not.toHaveBeenCalled();
      expect(d.remoteModels).not.toHaveBeenCalled();
    });
  }
});
