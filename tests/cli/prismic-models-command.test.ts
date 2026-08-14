import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  checkOneSite,
  forComment,
  runPrismicModelsCommand,
  DEFAULT_COMMENT_LIMIT,
  type PrismicModelsDeps,
} from "../../src/cli/commands/prismic-models.js";
import type { RemoteEntry } from "../../src/prismic/models/index.js";
import type { SpawnFn } from "../../src/audits/util/spawn.js";

let dir: string;

async function site(repositoryName = "espada"): Promise<void> {
  await writeFile(
    join(dir, "slicemachine.config.json"),
    JSON.stringify({ repositoryName, libraries: ["./src/lib/slices"] }),
  );
}
async function customType(id: string, model: Record<string, unknown> = {}): Promise<void> {
  await mkdir(join(dir, "customtypes", id), { recursive: true });
  await writeFile(join(dir, "customtypes", id, "index.json"), JSON.stringify({ id, ...model }));
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "prismic-cmd-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const sender = () => vi.fn(async () => {});

const deps = (
  remote: RemoteEntry[],
  send: PrismicModelsDeps["sendModel"] = sender(),
): PrismicModelsDeps => ({
  remoteModels: vi.fn(async () => remote),
  sendModel: send,
  env: { PRISMIC_WRITE_TOKEN: "tok" },
  // Only `--pull` ever reaches for this, and nothing in this file asks for it —
  // a call would be the in-repo check shelling out, which it must never do.
  spawn: vi.fn<SpawnFn>(async () => ({ code: 0, stdout: "", stderr: "" })),
  // No test in this file writes to Airtable. Required (not optional) on the deps
  // type precisely so that stays true by construction: a stub that throws is the
  // only way this path can be reached from here.
  openVerdictSink: async () => {
    throw new Error("this test never opens Airtable");
  },
});

describe("runPrismicModelsCommand — in-repo", () => {
  it("reports a clean repo with exit 0", async () => {
    await site();
    await customType("page", { label: "Page" });
    const r = await runPrismicModelsCommand(
      undefined,
      { cwd: dir },
      deps([{ kind: "customtype", id: "page", model: { id: "page", label: "Page" } }]),
    );
    expect(r.code).toBe(0);
    expect(r.output).toContain("match Prismic");
  });

  it("defaults to a dry run — sends nothing even when models differ", async () => {
    await site();
    await customType("page", { label: "Page v2" });
    const send = sender();
    const r = await runPrismicModelsCommand(
      undefined,
      { cwd: dir },
      deps([{ kind: "customtype", id: "page", model: { id: "page", label: "Page" } }], send),
    );
    expect(send).not.toHaveBeenCalled();
    expect(r.output).toContain("DRY RUN");
    // A model PR is SUPPOSED to differ from the remote — the comment is the
    // review artifact, not a gate. Failing here would red every model PR.
    expect(r.code).toBe(0);
  });

  it("--apply sends the changed models and exits 0", async () => {
    await site();
    await customType("page", { label: "Page v2" });
    const send = sender();
    const r = await runPrismicModelsCommand(
      undefined,
      { cwd: dir, apply: true },
      deps([{ kind: "customtype", id: "page", model: { id: "page", label: "Page" } }], send),
    );
    expect(send).toHaveBeenCalledTimes(1);
    expect(r.code).toBe(0);
    expect(r.output).toMatch(/1\/1 model\(s\) pushed/);
  });

  it("--apply exits 1 when a model is rejected", async () => {
    await site();
    await customType("page", { label: "Page v2" });
    const send = vi.fn(async () => {
      throw new Error("422 unprocessable");
    });
    const r = await runPrismicModelsCommand(
      undefined,
      { cwd: dir, apply: true },
      deps([{ kind: "customtype", id: "page", model: { id: "page", label: "Page" } }], send),
    );
    expect(r.code).toBe(1);
    expect(r.output).toContain("FAILED");
  });

  it("never sends anything for a remote-only model, even with --apply", async () => {
    await site();
    await customType("page");
    const send = sender();
    const r = await runPrismicModelsCommand(
      undefined,
      { cwd: dir, apply: true },
      deps(
        [
          { kind: "customtype", id: "page", model: { id: "page" } },
          { kind: "customtype", id: "frozen_page", model: { id: "frozen_page" } },
        ],
        send,
      ),
    );
    expect(send).not.toHaveBeenCalled();
    expect(r.output).toContain("REMOTE-ONLY");
    expect(r.code).toBe(0);
  });

  // The fixture writes a file because a repo with no Prismic config is a repo
  // with FILES in it and no config. A bare empty directory is a different fact —
  // a checkout that was never established — and it now fails rather than
  // reporting the reassuring skip this test is about.
  it("is a clean skip (exit 0) on a repo with no Prismic config", async () => {
    await writeFile(join(dir, "package.json"), "{}");
    const r = await runPrismicModelsCommand(undefined, { cwd: dir }, deps([]));
    expect(r.code).toBe(0);
    expect(r.output).toMatch(/not a Prismic site/i);
  });

  // A wired repo that has lost its secret must go RED, not quietly pass. Silent
  // success here is how a delivery pipeline stops delivering without anyone noticing.
  it("exits 1 with a named env var when the token is missing", async () => {
    await site();
    const d = deps([]);
    d.env = {};
    const r = await runPrismicModelsCommand(undefined, { cwd: dir }, d);
    expect(r.code).toBe(1);
    expect(r.output).toContain("PRISMIC_TOKEN_ESPADA");
    expect(r.output).toContain("PRISMIC_WRITE_TOKEN");
  });

  // The token is missing on an --apply run: nothing may go on the wire, and the
  // remote must not even be read. A push that starts without a credential and
  // discovers it halfway is a half-applied merge.
  it("sends nothing and reads nothing when the token is missing on --apply", async () => {
    await site();
    await customType("page", { label: "Page v2" });
    const send = sender();
    const d = deps([{ kind: "customtype", id: "page", model: { id: "page" } }], send);
    d.env = {};
    const r = await runPrismicModelsCommand(undefined, { cwd: dir, apply: true }, d);
    expect(r.code).toBe(1);
    expect(send).not.toHaveBeenCalled();
    expect(d.remoteModels).not.toHaveBeenCalled();
  });

  it("exits 1 when the remote read fails, quoting the API error", async () => {
    await site();
    const d = deps([]);
    d.remoteModels = vi.fn(async () => {
      throw new Error("GET /customtypes [repository: espada] -> 403 explicit deny");
    });
    const r = await runPrismicModelsCommand(undefined, { cwd: dir }, d);
    expect(r.code).toBe(1);
    expect(r.output).toContain("403");
  });

  // `remoteModels` is INJECTED, so this command can promise nothing about what
  // it throws. `(e as Error).message` on a thrown string renders "undefined" —
  // an unreadable remote reported as a blank reason.
  it("quotes a non-Error rejection from the remote read rather than 'undefined'", async () => {
    await site();
    const d = deps([]);
    d.remoteModels = vi.fn(async () => {
      throw "403 explicit deny (thrown as a string)";
    });
    const r = await runPrismicModelsCommand(undefined, { cwd: dir }, d);
    expect(r.code).toBe(1);
    expect(r.output).toContain("403 explicit deny");
    expect(r.output).not.toContain("undefined");
  });

  // ABSENT vs UNREADABLE, at the command layer. `readPrismicConfig` throws for a
  // config that is THERE and broken; turning that into the "not a Prismic site"
  // skip would drop a live site out of CI with a green check.
  it("exits 1 naming the config file when it is present but unparseable", async () => {
    await writeFile(join(dir, "slicemachine.config.json"), "{ not json");
    const r = await runPrismicModelsCommand(undefined, { cwd: dir }, deps([]));
    expect(r.code).toBe(1);
    expect(r.output).toContain("slicemachine.config.json");
    expect(r.output).not.toMatch(/not a Prismic site/i);
  });

  // Same rule one layer down: a model file that is present and unreadable must
  // not be compared as if the repo simply did not declare that model.
  it("exits 1 naming the model file when the repo's own models cannot be read", async () => {
    await site();
    await mkdir(join(dir, "customtypes", "page"), { recursive: true });
    await writeFile(join(dir, "customtypes", "page", "index.json"), "{ not json");
    const send = sender();
    const r = await runPrismicModelsCommand(
      undefined,
      { cwd: dir, apply: true },
      deps([{ kind: "customtype", id: "page", model: { id: "page" } }], send),
    );
    expect(r.code).toBe(1);
    expect(r.output).toContain("customtypes/page/index.json");
    expect(r.output).not.toContain("match Prismic");
    expect(send).not.toHaveBeenCalled();
  });

  // `prismicTokenEnvName` throws for a repositoryName with no alphanumerics —
  // every such repo would otherwise collapse onto the bare `PRISMIC_TOKEN_`
  // prefix. Reaching it must be a reported error, not an unhandled crash that
  // loses the report and writes no comment.
  it("exits 1 when no token env var can be derived from the repositoryName", async () => {
    await site("---");
    const r = await runPrismicModelsCommand(undefined, { cwd: dir }, deps([]));
    expect(r.code).toBe(1);
    expect(r.output).toContain("---");
  });

  it("--comment-file writes the report to disk for the workflow to post", async () => {
    await site();
    await customType("page");
    const out = join(dir, "comment.md");
    await runPrismicModelsCommand(
      undefined,
      { cwd: dir, commentFile: out },
      deps([{ kind: "customtype", id: "page", model: { id: "page" } }]),
    );
    expect(await readFile(out, "utf-8")).toContain("Prismic models");
  });

  it("--comment-file writes exactly what the CLI printed, under a run stamp", async () => {
    await site();
    await customType("page", { label: "Page v2" });
    const out = join(dir, "comment.md");
    const r = await runPrismicModelsCommand(
      undefined,
      { cwd: dir, commentFile: out },
      deps([{ kind: "customtype", id: "page", model: { id: "page", label: "Page" } }]),
    );
    const body = await readFile(out, "utf-8");
    // The report itself is verbatim — the reviewer and the operator must see the
    // same characters. Only a provenance line sits above it.
    expect(body.endsWith(r.output)).toBe(true);
  });

  // A comment file with no identity cannot be told apart from the PREVIOUS run's.
  // The CLI dying before it writes leaves the old file in place, and on a re-used
  // workspace that stale report gets posted as this run's output.
  it("--comment-file stamps the run that wrote it", async () => {
    await site();
    await customType("page");
    const out = join(dir, "comment.md");
    const d = deps([{ kind: "customtype", id: "page", model: { id: "page" } }]);
    d.env = { ...d.env, GITHUB_RUN_ID: "4242", GITHUB_RUN_ATTEMPT: "3", GITHUB_SHA: "deadbee" };
    await runPrismicModelsCommand(undefined, { cwd: dir, commentFile: out }, d);
    const [stamp] = (await readFile(out, "utf-8")).split("\n");
    expect(stamp).toContain("run 4242");
    expect(stamp).toContain("attempt 3");
    expect(stamp).toContain("deadbee");
    expect(stamp).toContain("espada");
    expect(stamp).toMatch(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/);
  });

  // Outside CI there is no run id to quote, and a stamp that said nothing would
  // be no better than no stamp.
  it("stamps a local run with a pid and a timestamp", async () => {
    await site();
    await customType("page");
    const out = join(dir, "comment.md");
    await runPrismicModelsCommand(
      undefined,
      { cwd: dir, commentFile: out },
      deps([{ kind: "customtype", id: "page", model: { id: "page" } }]),
    );
    const [stamp] = (await readFile(out, "utf-8")).split("\n");
    expect(stamp).toContain(`local pid ${process.pid}`);
    expect(stamp).toMatch(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/);
  });

  // `--comment-file ""` is what an unset workflow variable expands to. Falsy, so
  // the write was skipped in silence: a green check on a model PR with no review
  // comment on it at all.
  it("exits non-zero on an empty --comment-file instead of silently writing nothing", async () => {
    await site();
    await customType("page");
    const send = sender();
    const r = await runPrismicModelsCommand(
      undefined,
      { cwd: dir, commentFile: "   ", apply: true },
      deps([{ kind: "customtype", id: "page", model: { id: "page" } }], send),
    );
    expect(r.code).toBe(1);
    expect(r.output).toContain("--comment-file");
    expect(send).not.toHaveBeenCalled();
  });

  // A flag parser hands back `true` for `--comment-file` with no value. `resolve`
  // throws on it, and that throw used to sit outside the try and take the whole
  // command — report included — down with it.
  it("reports a non-string --comment-file rather than crashing", async () => {
    await site();
    await customType("page");
    const r = await runPrismicModelsCommand(
      undefined,
      { cwd: dir, commentFile: true as unknown as string },
      deps([{ kind: "customtype", id: "page", model: { id: "page" } }]),
    );
    expect(r.code).toBe(1);
    expect(r.output).toContain("--comment-file");
    expect(r.output).toContain("boolean");
  });

  // Task 18 registered these flags; Tasks 15/16/17/20 implemented them. In
  // between, they were accepted and IGNORED — `--fleet inventory.json` ran an
  // in-repo check of the cwd and reported a successful sweep, exit 0 — and a
  // table of unimplemented modes refused each one until its task landed.
  //
  // `--write-airtable` was the last entry and Task 20 built it, so the table is
  // gone. The hole it covered is NOT: `--write-airtable` on the in-repo check has
  // nothing to write, and accepting it would compare this one repo and exit 0 for
  // an operator who asked for a fleet write-back. The mode conflict is what
  // stands there now — exit 2, because it is a malformed invocation rather than a
  // finding about a site.
  it("refuses --write-airtable outside fleet mode instead of doing something else", async () => {
    await site();
    await customType("page");
    const send = sender();
    const r = await runPrismicModelsCommand(
      undefined,
      { cwd: dir, writeAirtable: true },
      deps([{ kind: "customtype", id: "page", model: { id: "page" } }], send),
    );
    expect(r.code).toBe(2);
    expect(r.output).toContain("--write-airtable");
    expect(r.output).toContain("--fleet");
    expect(send).not.toHaveBeenCalled();
    // It must not have quietly run the in-repo comparison instead.
    expect(r.output).not.toContain("match Prismic");
  });

  // The nightly's real invocation, `--fleet airtable --write-airtable`, was
  // refused outright until Task 20 and now runs. That case moved to the suites
  // that own fleet fixtures — prismic-models-fleet.test.ts (the sweep still
  // happens) and prismic-models-writeback.test.ts (the verdicts land) — rather
  // than growing an inventory in this in-repo suite. What stays here is the
  // in-repo half above: the flag must not be accepted without --fleet.

  // A flag parser leaves `false` behind for a boolean flag nobody typed. Since
  // Tasks 15 and 16 that also has to hold for the IMPLEMENTED modes: `tokens:
  // false` and `pull: false` must reach the in-repo comparison, not the doctor
  // and not a pull-down that writes into the working tree.
  it("does not trip the guard on flags that were not asked for", async () => {
    await site();
    await customType("page");
    const r = await runPrismicModelsCommand(
      undefined,
      { cwd: dir, pull: false, tokens: false, writeAirtable: false },
      deps([{ kind: "customtype", id: "page", model: { id: "page" } }]),
    );
    expect(r.code).toBe(0);
    expect(r.output).not.toContain("NOT IMPLEMENTED");
    expect(r.output).toContain("match Prismic");
  });

  // No comment means no review artifact. A dry run that silently failed to write
  // it would leave a green check on a model PR nobody ever saw the delta for.
  it("goes non-zero and says so when the comment file cannot be written", async () => {
    await site();
    await customType("page");
    const r = await runPrismicModelsCommand(
      undefined,
      { cwd: dir, commentFile: join(dir, "no-such-dir", "comment.md") },
      deps([{ kind: "customtype", id: "page", model: { id: "page" } }]),
    );
    expect(r.code).toBe(1);
    expect(r.output).toMatch(/could not write the comment file/i);
    // The report itself is not lost with it.
    expect(r.output).toContain("match Prismic");
  });

  // The realistic trigger is a first-ever push, not an edge case: an empty
  // Prismic repository sorts every local model into toCreate with a field line
  // each. A comment shortened without saying so is this pipeline's governing
  // failure — the reviewer sees a complete-looking report and approves a change
  // whose destructive lines were the ones cut.
  it("--comment-file truncates loudly past the GitHub cap, keeping the head", async () => {
    await site();
    const fields: Record<string, unknown> = {};
    for (let i = 0; i < 1200; i++) {
      fields[`field_${String(i).padStart(4, "0")}_${"x".repeat(50)}`] = { type: "Text" };
    }
    await customType("page", { json: { Main: fields } });
    const out = join(dir, "comment.md");
    const r = await runPrismicModelsCommand(
      undefined,
      { cwd: dir, commentFile: out },
      deps([{ kind: "customtype", id: "page", model: { id: "page", json: { Main: {} } } }]),
    );
    const body = await readFile(out, "utf-8");
    // The CLI's own output is COMPLETE — only the comment is budgeted.
    expect(r.output.length).toBeGreaterThan(65_536);
    // Under the CAP, with headroom left for the wrapper the workflow adds.
    expect(body.length).toBeLessThanOrEqual(DEFAULT_COMMENT_LIMIT);
    expect(body.startsWith("⚠ TRUNCATED")).toBe(true);
    // The report's own head — the repository name — still survives the cut.
    expect(body).toContain("Prismic models — repository: espada");
    // The tail notice stays — the head marker points at it — and quotes the real
    // size of what was cut, which is the report plus the run stamp above it.
    expect(body.trimEnd().endsWith("before approving.")).toBe(true);
    const quoted = /this report is (\d+) characters/.exec(body)?.[1];
    expect(Number(quoted)).toBeGreaterThan(r.output.length);
  });
});

describe("checkOneSite", () => {
  it("reports a matching repo as clean", async () => {
    await site();
    await customType("page");
    const r = await checkOneSite(
      dir,
      deps([{ kind: "customtype", id: "page", model: { id: "page" } }]),
      {
        apply: false,
        allowGenericToken: true,
      },
    );
    expect(r.clean).toBe(true);
    expect(r.status).toBe("checked");
    expect(r.repositoryName).toBe("espada");
  });

  // THE WRITE DESTINATION. `repositoryName` is the `repository:` header on every
  // Types API call, so it is the single value that decides WHICH live client's
  // Prismic repository this pushes to — and nothing else in the suite pins it.
  // Task 17 threads a second repository identity through the same function.
  it("sends to the repository the config names, with that repository's own token", async () => {
    await site("the-pinnacle");
    await customType("page", { label: "Page v2" });
    const send = sender();
    const d = deps(
      [{ kind: "customtype", id: "page", model: { id: "page", label: "Page" } }],
      send,
    );
    // The canonical per-site secret AND a generic one, so a mix-up is visible:
    // resolution must pick the site's own.
    d.env = { PRISMIC_TOKEN_THE_PINNACLE: "pinnacle-token", PRISMIC_WRITE_TOKEN: "generic-token" };
    await checkOneSite(dir, d, { apply: true, allowGenericToken: true });

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(
      "the-pinnacle",
      "pinnacle-token",
      expect.objectContaining({ id: "page" }),
      "update",
    );
    // The read side is the same identity: a comparison against one repository
    // followed by a push to another is a diff computed for the wrong site.
    expect(d.remoteModels).toHaveBeenCalledWith("the-pinnacle", "pinnacle-token");
  });

  // A repoRoot that does not exist makes every config read ENOENT, which
  // `readPrismicConfig` correctly reads as "this repo does not have this file"
  // and, candidates exhausted, returns null for. That null used to land on the
  // "not a Prismic site — skipped" green exit: a typo'd path, a bad
  // `working-directory:`, or a clone that failed all reported success — under
  // `--apply` too.
  it("errors on a repoRoot that does not exist instead of skipping it", async () => {
    const missing = join(dir, "no-such-checkout");
    const send = sender();
    const r = await checkOneSite(missing, deps([], send), { apply: true, allowGenericToken: true });
    expect(r.code).toBe(1);
    expect(r.status).toBe("failed");
    expect(r.clean).toBeNull();
    expect(r.output).toContain(missing);
    expect(r.output).not.toMatch(/not a Prismic site/i);
    expect(send).not.toHaveBeenCalled();
  });

  // Asserted on the CHECKOUT message specifically, not just on the exit code.
  // Reading `<a-file>/slicemachine.config.json` is ENOTDIR, which
  // `readPrismicConfig` already refuses to read as "no config here" — so without
  // the guard this path exits 1 anyway, blaming a config file that does not
  // exist. Mutation-tested: pinning only `code` left the guard unpinned here.
  it("errors when the repoRoot is a file rather than a checkout", async () => {
    const notADir = join(dir, "a-file");
    await writeFile(notADir, "");
    const r = await checkOneSite(notADir, deps([]), { apply: false, allowGenericToken: true });
    expect(r.code).toBe(1);
    expect(r.status).toBe("failed");
    expect(r.output).toContain("cannot read this checkout");
    expect(r.output).not.toMatch(/not a Prismic site/i);
  });

  // MUTATION TARGET. `git clone` creates `.git` and fills the working tree
  // afterwards, so a clone killed in between leaves a directory holding `.git`
  // and nothing else. Every config read inside it is ENOENT — indistinguishable
  // from a repo that has no Prismic — and `cloneIfNeeded` treats any non-empty
  // directory as an established checkout, so the reassuring skip would repeat
  // forever. A directory is not a working tree.
  it("errors on a checkout that holds only a .git instead of skipping it", async () => {
    await mkdir(join(dir, ".git"), { recursive: true });
    const send = sender();
    const r = await checkOneSite(dir, deps([], send), { apply: true, allowGenericToken: true });
    expect(r.code).toBe(1);
    expect(r.status).toBe("failed");
    expect(r.clean).toBeNull();
    expect(r.output).toContain(dir);
    expect(r.output).toMatch(/no working tree/i);
    expect(r.output).not.toMatch(/not a Prismic site/i);
    expect(send).not.toHaveBeenCalled();
  });

  // The same fact with nothing at all in the directory. "I could not establish a
  // checkout" is not "this repo has no Prismic", however empty the evidence.
  it("errors on an empty directory rather than reporting no Prismic", async () => {
    const r = await checkOneSite(dir, deps([]), { apply: false, allowGenericToken: true });
    expect(r.code).toBe(1);
    expect(r.status).toBe("failed");
    expect(r.output).not.toMatch(/not a Prismic site/i);
  });

  // `clean: null` alone cannot say which of these happened, and they are
  // opposite operational facts: one is routine, the other is an outage.
  it("separates a skip from a failure by status, not by a null verdict", async () => {
    // A real repo that is not a Prismic site: files, no config. An empty
    // directory is neither, and is now its own failure.
    await writeFile(join(dir, "package.json"), "{}");
    const skipped = await checkOneSite(dir, deps([]), { apply: false, allowGenericToken: true });
    expect(skipped.status).toBe("skipped");
    expect(skipped.clean).toBeNull();
    expect(skipped.code).toBe(0);

    await writeFile(join(dir, "slicemachine.config.json"), "{ not json");
    const broken = await checkOneSite(dir, deps([]), { apply: false, allowGenericToken: true });
    expect(broken.status).toBe("failed");
    expect(broken.clean).toBeNull();
    expect(broken.code).toBe(1);
    // Neither learns a repositoryName, so a sweep counting `repositoryName !==
    // null` reads these two identically. That is what `status` is for.
    expect(skipped.repositoryName).toBeUndefined();
    expect(broken.repositoryName).toBeUndefined();
  });

  // Zero models on BOTH sides is a misconfiguration wearing a clean run, and the
  // renderer says so in words. The machine-readable verdict that reaches Airtable
  // and the cockpit must not disagree with the report printed above it.
  it("does not report clean when nothing was found on either side", async () => {
    await site();
    const r = await checkOneSite(dir, deps([]), { apply: false, allowGenericToken: true });
    expect(r.code).toBe(0);
    expect(r.output).toContain("NOTHING WAS FOUND ON EITHER SIDE");
    expect(r.clean).toBe(false);
  });

  // Fleet mode passes allowGenericToken: false — one PRISMIC_WRITE_TOKEN in the
  // environment must not attach itself to every repository in the sweep.
  it("refuses the generic token when allowGenericToken is false", async () => {
    await site();
    const r = await checkOneSite(dir, deps([]), { apply: false, allowGenericToken: false });
    expect(r.code).toBe(1);
    expect(r.output).toContain("PRISMIC_TOKEN_ESPADA");
    expect(r.output).not.toContain("PRISMIC_WRITE_TOKEN");
  });
});

describe("forComment", () => {
  it("passes a body that fits through untouched", () => {
    expect(forComment("Prismic models — repository: espada\nclean", 2_000)).toBe(
      "Prismic models — repository: espada\nclean",
    );
  });

  it("keeps the head, stays within the limit, and says it cut", () => {
    const body = `Prismic models — repository: espada\n${"- (field) gone\n".repeat(500)}`;
    const out = forComment(body, 2_000);
    expect(out.length).toBeLessThanOrEqual(2_000);
    expect(out).toContain("Prismic models — repository: espada");
    expect(out).toContain("TRUNCATED");
    expect(out).toContain(String(body.length));
    expect(out).toContain("2000");
    expect(out.endsWith(body)).toBe(false);
  });

  // 65,536 is GitHub's cap on the WHOLE comment, and the workflow wraps this body
  // in a heading and a fenced block. A body truncated to exactly the cap
  // overflows once wrapped -> HTTP 422 -> NO COMMENT AT ALL, which is not a
  // shortened review gate but the absence of one, on a PR that changes models on
  // a live client's site.
  it("leaves the wrapper room inside GitHub's real cap by default", () => {
    const wrap = (b: string) => `### Prismic model delta\n\n\`\`\`\n${b}\n\`\`\`\n`;
    const body = "- (field) gone\n".repeat(20_000);
    const out = forComment(body);
    expect(body.length).toBeGreaterThan(65_536);
    expect(wrap(out).length).toBeLessThanOrEqual(65_536);
    expect(DEFAULT_COMMENT_LIMIT).toBeLessThan(65_536);
  });

  // The truncation notice is the one line saying "you are not reading the whole
  // thing", and GitHub collapses a long comment FROM THE TOP — so the tail is the
  // least-read position in the longest possible comment.
  it("marks the truncation at the head as well as the tail", () => {
    const body = "- (field) gone\n".repeat(500);
    const out = forComment(body, 2_000);
    expect(out.startsWith("⚠ TRUNCATED")).toBe(true);
    expect(out.trimEnd().endsWith("before approving.")).toBe(true);
  });

  // The recovery instruction is the only thing a reviewer who cannot see the
  // whole report is told to do. `--dry` does not exist and cac hard-errors on it.
  it("tells the reviewer a command that exists", () => {
    const out = forComment("x".repeat(5_000), 2_000);
    expect(out).toContain("reddoor-maint prismic-models");
    expect(out).not.toContain("--dry");
  });

  // Silently emitting the notice alone would overrun the very budget the caller
  // asked to be kept — the overflow this parameter exists to prevent.
  it("refuses a limit smaller than the warning itself", () => {
    expect(() => forComment("x".repeat(5_000), 100)).toThrow(/smaller than the truncation warning/);
    // Checked even when the body would have fitted, so the misconfiguration
    // surfaces on the first run rather than on the first long report.
    expect(() => forComment("x", 100)).toThrow(/smaller than the truncation warning/);
  });

  // The cut is by code unit, so it can land between the halves of an astral
  // character and leave a lone surrogate — invalid text in the file the workflow
  // posts. Both parities are exercised by sweeping the limit.
  it("never ends the kept head on half a surrogate pair", () => {
    const body = "😀".repeat(5000);
    for (let limit = 700; limit < 720; limit++) {
      expect(forComment(body, limit)).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
    }
  });
});

// The renderer's head says "⚠ INCONSISTENT — ... do not act on this" in PROSE.
// The machine-readable verdict below it must not say `clean`, and the run must
// not exit 0 — a green check under a report that disowns its own figures is a
// reviewer approving numbers nobody stands behind.
//
// The disagreement is INJECTED because it is unreachable through today's
// constructor: `checkOneSite` builds the diff and the push report from one read,
// so they agree by construction. That is exactly the argument the reconciliation
// is written against ("agreement by construction is a property of today's
// caller, not of this function's inputs"), and Task 17 adds a second caller.
describe("checkOneSite — an inconsistent report is not clean", () => {
  afterEach(() => {
    vi.doUnmock("../../src/cli/commands/prismic-models-report.js");
    vi.resetModules();
  });

  const withReconciliation = async (lines: string[]) => {
    vi.resetModules();
    vi.doMock("../../src/cli/commands/prismic-models-report.js", async (importOriginal) => ({
      ...(await importOriginal<typeof import("../../src/cli/commands/prismic-models-report.js")>()),
      reconcileReport: () => lines,
    }));
    return import("../../src/cli/commands/prismic-models.js");
  };

  it("reports clean: false and exits 1 when the inputs disagree", async () => {
    await site();
    await customType("page");
    const mod = await withReconciliation(["    mode: rendering as a DRY RUN, but ..."]);
    const r = await mod.checkOneSite(
      dir,
      deps([{ kind: "customtype", id: "page", model: { id: "page" } }]),
      { apply: false, allowGenericToken: true },
    );
    expect(r.clean).toBe(false);
    expect(r.code).toBe(1);
    // Not `null`: the check ran to completion and produced a finding. `null`
    // would count toward Task 17's majority-failure rule and write nothing at
    // all in Task 19.
    expect(r.status).toBe("checked");
  });

  it("still reports a consistent clean run as clean", async () => {
    await site();
    await customType("page");
    const mod = await withReconciliation([]);
    const r = await mod.checkOneSite(
      dir,
      deps([{ kind: "customtype", id: "page", model: { id: "page" } }]),
      { apply: false, allowGenericToken: true },
    );
    expect(r.clean).toBe(true);
    expect(r.code).toBe(0);
  });
});
