import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  checkOneSite,
  forComment,
  runPrismicModelsCommand,
  type PrismicModelsDeps,
} from "../../src/cli/commands/prismic-models.js";
import type { RemoteEntry } from "../../src/prismic/models/index.js";

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

  it("is a clean skip (exit 0) on a repo with no Prismic config", async () => {
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

  it("--comment-file writes exactly what the CLI printed when it fits", async () => {
    await site();
    await customType("page", { label: "Page v2" });
    const out = join(dir, "comment.md");
    const r = await runPrismicModelsCommand(
      undefined,
      { cwd: dir, commentFile: out },
      deps([{ kind: "customtype", id: "page", model: { id: "page", label: "Page" } }]),
    );
    expect(await readFile(out, "utf-8")).toBe(r.output);
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
    expect(body.length).toBeLessThanOrEqual(65_536);
    expect(body.startsWith("Prismic models — repository: espada")).toBe(true);
    expect(body).toContain("TRUNCATED");
    expect(body).toContain(String(r.output.length));
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
    expect(r.repositoryName).toBe("espada");
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
    expect(forComment("Prismic models — repository: espada\nclean", 500)).toBe(
      "Prismic models — repository: espada\nclean",
    );
  });

  it("keeps the head, stays within the limit, and says it cut", () => {
    const body = `Prismic models — repository: espada\n${"- (field) gone\n".repeat(500)}`;
    const out = forComment(body, 500);
    expect(out.length).toBeLessThanOrEqual(500);
    expect(out.startsWith("Prismic models — repository: espada")).toBe(true);
    expect(out).toContain("TRUNCATED");
    expect(out).toContain(String(body.length));
    expect(out).toContain("500");
    expect(out.endsWith(body)).toBe(false);
  });

  // The cut is by code unit, so it can land between the halves of an astral
  // character and leave a lone surrogate — invalid text in the file the workflow
  // posts. Both parities are exercised by sweeping the limit.
  it("never ends the kept head on half a surrogate pair", () => {
    const body = "😀".repeat(5000);
    for (let limit = 400; limit < 420; limit++) {
      expect(forComment(body, limit)).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
    }
  });
});
