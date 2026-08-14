import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
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

  it("is a clean skip on a repo with no Prismic config", async () => {
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

  it("still refuses --tokens --fleet, which is not built yet", async () => {
    await site();
    const r = await runPrismicModelsCommand(
      undefined,
      { cwd: dir, tokens: true, fleet: "inventory.json" },
      deps({ PRISMIC_TOKEN_ESPADA: "value" }),
    );
    expect(r.code).toBe(1);
    expect(r.output).toContain("--fleet");
    expect(r.output).toContain("NOT IMPLEMENTED");
  });
});
