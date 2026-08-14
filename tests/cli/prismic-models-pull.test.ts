import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { access, mkdtemp, rm, writeFile, readFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  runPrismicModelsCommand,
  type PrismicModelsDeps,
} from "../../src/cli/commands/prismic-models.js";
import type { SpawnFn } from "../../src/audits/util/spawn.js";
import type { RemoteEntry } from "../../src/prismic/models/index.js";

let dir: string;

const config = (over: Record<string, unknown> = {}): Promise<void> =>
  writeFile(
    join(dir, "slicemachine.config.json"),
    JSON.stringify({ repositoryName: "espada", libraries: ["./src/lib/slices"], ...over }),
  );

/** `writeModelFile` resolves the TARGET repo's own prettier at
 *  `<root>/node_modules/.bin/prettier` and refuses to format at all when it is
 *  not there — so a fixture without one exercises the degraded path and never
 *  the spawn. The file only has to exist: the spawn itself is injected. */
const withPrettier = async (): Promise<string> => {
  await mkdir(join(dir, "node_modules", ".bin"), { recursive: true });
  const bin = join(dir, "node_modules", ".bin", "prettier");
  await writeFile(bin, "#!/bin/sh\n");
  return bin;
};

const localCustomType = async (id: string, model: Record<string, unknown> = {}): Promise<void> => {
  await mkdir(join(dir, "customtypes", id), { recursive: true });
  await writeFile(join(dir, "customtypes", id, "index.json"), JSON.stringify({ id, ...model }));
};

const exists = async (p: string): Promise<boolean> => {
  try {
    await access(join(dir, p));
    return true;
  } catch {
    return false;
  }
};

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "prismic-pull-"));
  await config();
  await localCustomType("page");
  await withPrettier();
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const remote: RemoteEntry[] = [
  { kind: "customtype", id: "page", model: { id: "page" } },
  { kind: "customtype", id: "frozen_page", model: { id: "frozen_page", label: "Frozen" } },
  { kind: "slice", id: "video_block", model: { id: "video_block", type: "SharedSlice" } },
];

const okSpawn = () => vi.fn<SpawnFn>(async () => ({ code: 0, stdout: "", stderr: "" }));

const deps = (over: Partial<PrismicModelsDeps> = {}): PrismicModelsDeps => ({
  remoteModels: vi.fn(async () => remote),
  sendModel: vi.fn(async () => {}),
  env: { PRISMIC_WRITE_TOKEN: "tok" },
  spawn: okSpawn(),
  ...over,
});

describe("runPrismicModelsCommand --pull", () => {
  it("writes each remote-only model into the repo at its conventional path", async () => {
    const d = deps();
    const r = await runPrismicModelsCommand(undefined, { cwd: dir, pull: true }, d);
    expect(
      JSON.parse(await readFile(join(dir, "customtypes/frozen_page/index.json"), "utf-8")),
    ).toEqual({ id: "frozen_page", label: "Frozen" });
    expect(
      JSON.parse(await readFile(join(dir, "src/lib/slices/VideoBlock/model.json"), "utf-8")),
    ).toMatchObject({ id: "video_block" });
    expect(r.code).toBe(0);
    // A pull-down is the OPPOSITE direction. Nothing may go to Prismic on it.
    expect(d.sendModel).not.toHaveBeenCalled();
  });

  it("formats every written file with the target repo's own prettier", async () => {
    const spawn = okSpawn();
    await runPrismicModelsCommand(undefined, { cwd: dir, pull: true }, deps({ spawn }));
    // The binary is resolved under the TARGET's root and run by absolute path —
    // `pnpm exec prettier` would install into a live client repo and, failing
    // that, format with the CALLING repo's prettier while exiting 0.
    for (const call of spawn.mock.calls) {
      expect(call[0]).toMatch(/node_modules\/\.bin\/prettier$/);
      expect(call[1][0]).toBe("--write");
    }
    const written = spawn.mock.calls.flatMap((c) => c[1].slice(1));
    expect(written).toContain("customtypes/frozen_page/index.json");
    expect(written).toContain("src/lib/slices/VideoBlock/model.json");
  });

  it("flags the run when prettier could not run, without losing the models", async () => {
    const spawn = vi.fn<SpawnFn>(async () => {
      throw new Error("ENOENT");
    });
    const r = await runPrismicModelsCommand(undefined, { cwd: dir, pull: true }, deps({ spawn }));
    expect(r.output).toMatch(/could not prettier-format/i);
    expect(await readFile(join(dir, "customtypes/frozen_page/index.json"), "utf-8")).toContain(
      "frozen_page",
    );
    // Best-effort BY CONTRACT: the model is on disk and the note is loud. Losing
    // a pulled model to a formatting failure is the worse outcome of the two.
    expect(r.code).toBe(0);
  });

  it("does nothing and says so when there is no remote-only model", async () => {
    const r = await runPrismicModelsCommand(
      undefined,
      { cwd: dir, pull: true },
      deps({ remoteModels: vi.fn(async () => [remote[0]!]) }),
    );
    expect(r.output).toMatch(/nothing to pull/i);
    expect(r.code).toBe(0);
    expect(await exists("customtypes/frozen_page")).toBe(false);
  });

  // THE MUTATION TARGET. `writeModelFile` genuinely refuses, and the live case
  // is a directory already holding a DIFFERENT model id — slice directory names
  // are derived from the id and the fleet copies slices between sites. A loop
  // that threw on the first refusal would leave the models it had already
  // written on disk with no record of which, and a run that exited 0 would
  // report a pull-down that did not happen.
  it("records a per-model refusal, keeps going, and does not exit 0", async () => {
    await localCustomType("frozen_page", { id: "someone_elses_model" } as Record<string, unknown>);
    const r = await runPrismicModelsCommand(
      undefined,
      { cwd: dir, pull: true },
      deps({
        remoteModels: vi.fn(async () => [
          { kind: "customtype" as const, id: "frozen_page", model: { id: "frozen_page" } },
          { kind: "customtype" as const, id: "catalog_page", model: { id: "catalog_page" } },
        ]),
      }),
    );
    expect(r.output).toContain("REFUSED");
    expect(r.output).toContain("frozen_page");
    // The model AFTER the refusal was still written — the loop did not abort.
    expect(
      JSON.parse(await readFile(join(dir, "customtypes/catalog_page/index.json"), "utf-8")),
    ).toEqual({ id: "catalog_page" });
    // And the file that caused the refusal is untouched.
    expect(
      JSON.parse(await readFile(join(dir, "customtypes/frozen_page/index.json"), "utf-8")),
    ).toEqual({ id: "someone_elses_model" });
    expect(r.code).toBe(1);
    expect(r.output).toMatch(/1 of 2 model\(s\) pulled, 1 refused/);
  });

  // `libraries: []` is a STATEMENT — config.ts documents it as "this site has no
  // slice libraries" — not an absence to default. Fabricating ./src/lib/slices
  // writes a slice into a directory the site does not use and calls it a
  // success. The refusal is PER-MODEL: a custom type needs no library and must
  // still come down.
  it("refuses only the slices when the site declares no slice library", async () => {
    await config({ libraries: [] });
    const r = await runPrismicModelsCommand(undefined, { cwd: dir, pull: true }, deps());
    expect(await exists("customtypes/frozen_page/index.json")).toBe(true);
    expect(r.output).toContain("REFUSED");
    expect(r.output).toContain("video_block");
    expect(r.output).toMatch(/no slice library/i);
    // No fabricated fleet default anywhere on disk.
    expect(await exists("src/lib/slices")).toBe(false);
    expect(await exists("src")).toBe(false);
    expect(r.code).toBe(1);
  });

  it("says which slice library it wrote into", async () => {
    await config({ libraries: ["./src/lib/blocks", "./src/lib/slices"] });
    const r = await runPrismicModelsCommand(undefined, { cwd: dir, pull: true }, deps());
    expect(r.output).toContain("src/lib/blocks");
    expect(await exists("src/lib/blocks/VideoBlock/model.json")).toBe(true);
  });

  // THE GOVERNING RULE, on the write path. Every one of these must refuse to
  // write anything: a pull-down computed from a half-read repo sorts models the
  // repo already has into `remoteOnly` and overwrites them with the remote's
  // copy — losing exactly the local edits that were waiting to be pushed.
  it("exits 1 without writing when the checkout cannot be read", async () => {
    const missing = join(dir, "no-such-checkout");
    const r = await runPrismicModelsCommand(missing, { cwd: dir, pull: true }, deps());
    expect(r.code).toBe(1);
    expect(r.output).toContain("cannot read this checkout");
    expect(r.output).not.toMatch(/not a Prismic site/i);
  });

  it("exits 1 without writing when the config is present and broken", async () => {
    await writeFile(join(dir, "slicemachine.config.json"), "{ not json");
    const r = await runPrismicModelsCommand(undefined, { cwd: dir, pull: true }, deps());
    expect(r.code).toBe(1);
    expect(r.output).toContain("slicemachine.config.json");
    expect(r.output).not.toMatch(/not a Prismic site/i);
    expect(await exists("customtypes/frozen_page")).toBe(false);
  });

  it("exits 1 without writing when the repo's own models cannot be read", async () => {
    await writeFile(join(dir, "customtypes", "page", "index.json"), "{ not json");
    const r = await runPrismicModelsCommand(undefined, { cwd: dir, pull: true }, deps());
    expect(r.code).toBe(1);
    expect(r.output).toContain("customtypes/page/index.json");
    // NOT "the repo declares no models" — that reading turns every remote model
    // into a remote-only one and pulls the lot over the top of the repo.
    expect(await exists("customtypes/frozen_page")).toBe(false);
    expect(await exists("src/lib/slices/VideoBlock")).toBe(false);
  });

  it("exits 1 without writing when Prismic cannot be read", async () => {
    const r = await runPrismicModelsCommand(
      undefined,
      { cwd: dir, pull: true },
      deps({
        remoteModels: vi.fn(async () => {
          throw new Error("GET /customtypes [repository: espada] -> 403 explicit deny");
        }),
      }),
    );
    expect(r.code).toBe(1);
    expect(r.output).toContain("403");
    expect(await exists("customtypes/frozen_page")).toBe(false);
  });

  it("exits 1 naming the env var when there is no write token", async () => {
    const r = await runPrismicModelsCommand(undefined, { cwd: dir, pull: true }, deps({ env: {} }));
    expect(r.code).toBe(1);
    expect(r.output).toContain("PRISMIC_TOKEN_ESPADA");
    expect(await exists("customtypes/frozen_page")).toBe(false);
  });

  it("is a clean skip on a repo with no Prismic config", async () => {
    await rm(join(dir, "slicemachine.config.json"));
    const r = await runPrismicModelsCommand(undefined, { cwd: dir, pull: true }, deps());
    expect(r.code).toBe(0);
    expect(r.output).toMatch(/not a Prismic site/i);
  });

  // --pull is a repo mutation. Combining it with --apply in one invocation would
  // push and pull in the same breath with no review in between; refuse rather
  // than pick an order.
  it("refuses --pull with --apply (exit 2)", async () => {
    const d = deps();
    const r = await runPrismicModelsCommand(undefined, { cwd: dir, pull: true, apply: true }, d);
    expect(r.code).toBe(2);
    expect(r.output).toMatch(/cannot combine/i);
    expect(d.sendModel).not.toHaveBeenCalled();
    expect(await exists("customtypes/frozen_page")).toBe(false);
  });

  it("refuses --pull in fleet mode (exit 2) — it writes to a working tree", async () => {
    const r = await runPrismicModelsCommand(
      undefined,
      { cwd: dir, pull: true, fleet: "airtable" },
      deps(),
    );
    expect(r.code).toBe(2);
    expect(r.output).toMatch(/cannot combine/i);
  });

  it("refuses --pull with --tokens (exit 2) — two modes, one invocation", async () => {
    const r = await runPrismicModelsCommand(
      undefined,
      { cwd: dir, pull: true, tokens: true },
      deps(),
    );
    expect(r.code).toBe(2);
    expect(r.output).toMatch(/cannot combine/i);
  });

  it("refuses --pull with --comment-file (exit 2)", async () => {
    const r = await runPrismicModelsCommand(
      undefined,
      { cwd: dir, pull: true, commentFile: join(dir, "comment.md") },
      deps(),
    );
    expect(r.code).toBe(2);
    expect(r.output).toMatch(/cannot combine/i);
  });

  // Task 16 implements --pull, so it leaves the guard's list — but the guard
  // must still fire for the modes that really are unbuilt, including alongside
  // an implemented one.
  it("no longer reports --pull as unimplemented", async () => {
    const r = await runPrismicModelsCommand(undefined, { cwd: dir, pull: true }, deps());
    expect(r.output).not.toContain("NOT IMPLEMENTED");
  });

  it("still refuses --pull --write-airtable, which is not built yet", async () => {
    const r = await runPrismicModelsCommand(
      undefined,
      { cwd: dir, pull: true, writeAirtable: true },
      deps(),
    );
    expect(r.code).toBe(1);
    expect(r.output).toContain("--write-airtable");
    expect(r.output).toContain("NOT IMPLEMENTED");
    expect(await exists("customtypes/frozen_page")).toBe(false);
  });
});
