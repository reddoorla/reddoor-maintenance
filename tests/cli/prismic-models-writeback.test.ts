// `--write-airtable`: the nightly sweep's verdicts reaching the fleet's record.
//
// THE ONE RULE, at the last hop before an operator reads it: "I could not read
// X" must never produce the same result as "X does not exist". Here it decides
// what a row whose CHECK FAILED writes. The plan said: nothing, "keeping the
// last true value". That is the failure, not the fix — the last value stops
// being true the moment the check starts failing, and NOTHING ages a stale
// `pass` out (the digest's freshness gate only examines failures). A dead token
// on Monday would leave a green tick in the dashboard until somebody noticed by
// hand. So a failed check writes `unknown`, which is neither "fine" nor "never
// ran", and the timestamp moves every night either way.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  runPrismicModelsCommand,
  sweepRowWriteback,
  writeSweepToAirtable,
  type PrismicModelsDeps,
  type PrismicVerdictSink,
  type SweepRow,
} from "../../src/cli/commands/prismic-models.js";
import type { PrismicModelsWriteback } from "../../src/reports/airtable/websites.js";
import type { RemoteEntry } from "../../src/prismic/models/index.js";
import type { SpawnFn } from "../../src/audits/util/spawn.js";

const SHA = "0123456789abcdef0123456789abcdef01234567";

const row = (over: Partial<SweepRow> = {}): SweepRow => ({
  site: "Espada",
  repositoryName: "espada",
  commit: { resolved: SHA },
  status: "checked",
  clean: true,
  detail: "3 model(s) match Prismic — nothing to push.",
  ...over,
});

const websites = [{ id: "rec1", name: "Espada" }];

/** A recorder for the one call the writer makes per site. */
const recorder = () => vi.fn<PrismicVerdictSink["update"]>(async () => {});

const written = (update: ReturnType<typeof recorder>, n = 0): [string, PrismicModelsWriteback] =>
  update.mock.calls[n]!;

// ---------------------------------------------------------------------------
// The mapping, on its own: sweep row in, record value out.
// ---------------------------------------------------------------------------
describe("sweepRowWriteback", () => {
  it("records a clean site as pass, with the previous finding cleared", () => {
    expect(sweepRowWriteback(row(), "t")).toEqual({
      verdict: "pass",
      checkedAt: "t",
      detail: null,
    });
  });

  it("records a drifted site as fail, with the report as the finding", () => {
    expect(sweepRowWriteback(row({ clean: false, detail: "CHANGED  slice hero" }), "t")).toEqual({
      verdict: "fail",
      checkedAt: "t",
      detail: "CHANGED  slice hero",
    });
  });

  // MUTATION TARGET, and the whole point of the task. A check that did not run
  // to a verdict is `unknown` — not `pass` (a green tick over an outage) and not
  // "leave the row alone" (yesterday's `pass`, standing, with no trace).
  it("records a FAILED check as unknown, never as pass and never as silence", () => {
    const w = sweepRowWriteback(
      row({ status: "failed", clean: null, detail: "could not read Prismic models: 403" }),
      "t",
    );
    expect(w.verdict).toBe("unknown");
    expect(w.checkedAt).toBe("t");
    expect(w.detail).toContain("403");
    // It must not be readable as drift: the operator's next move for a dead token
    // is nothing like their next move for a changed model.
    expect(w.detail).toMatch(/no verdict/i);
  });

  // A site that could not even be CLONED reaches the writer the same way, with no
  // commit to name. It is exactly as unchecked as the one above.
  it("records a prep failure (no checkout at all) as unknown", () => {
    const w = sweepRowWriteback(
      row({ commit: null, status: "failed", clean: null, detail: "could not prepare: no gitRepo" }),
      "t",
    );
    expect(w.verdict).toBe("unknown");
  });

  // A repo with no Prismic config has no verdict to hold — and blanking the cell
  // is what clears a `pass` from back when the site DID have Prismic.
  it("blanks the verdict for a repo that is not a Prismic site, and still stamps the time", () => {
    const w = sweepRowWriteback(
      row({ status: "skipped", clean: null, detail: "not a Prismic site (no repositoryName)" }),
      "t",
    );
    expect(w.verdict).toBeNull();
    expect(w.checkedAt).toBe("t");
    expect(w.detail).toContain("not a Prismic site");
  });

  // `status` and `clean` are independent fields, so this combination is
  // reachable by a bug rather than by design. It must fail SAFE.
  it("refuses to call a checked-but-verdictless row clean", () => {
    expect(sweepRowWriteback(row({ status: "checked", clean: null }), "t").verdict).toBe("unknown");
  });
});

// ---------------------------------------------------------------------------
// The write itself: joining rows to records, and never losing one silently.
// ---------------------------------------------------------------------------
describe("writeSweepToAirtable", () => {
  it("writes pass with a null drift for a clean site", async () => {
    const update = recorder();
    const res = await writeSweepToAirtable([row()], websites, update, "2026-08-12T06:00:00.000Z");
    expect(written(update)).toEqual([
      "rec1",
      { verdict: "pass", checkedAt: "2026-08-12T06:00:00.000Z", detail: null },
    ]);
    expect(res.failed).toEqual([]);
    expect(res.written).toHaveLength(1);
  });

  it("writes fail with the report as the drift detail", async () => {
    const update = recorder();
    await writeSweepToAirtable(
      [row({ clean: false, detail: "CHANGED  slice hero" })],
      websites,
      update,
      "t",
    );
    expect(written(update)[1]).toMatchObject({ verdict: "fail", detail: "CHANGED  slice hero" });
  });

  // The plan wrote NOTHING here. That is the stale-`pass` bug: see the head of
  // this file.
  it("writes unknown — not nothing — for a site whose check failed", async () => {
    const update = recorder();
    const res = await writeSweepToAirtable(
      [row({ status: "failed", clean: null, detail: "cannot read this checkout" })],
      websites,
      update,
      "t",
    );
    expect(update).toHaveBeenCalledTimes(1);
    expect(written(update)[1].verdict).toBe("unknown");
    expect(res.written).toHaveLength(1);
  });

  // Airtable's Name is the fleet's join key everywhere else in this repo, via
  // siteSlug — so "Espada" and "espada" are one site, exactly as they are for
  // `audit --write-airtable`.
  it("joins on the slug, not on an exact name match", async () => {
    const update = recorder();
    const res = await writeSweepToAirtable(
      [row({ site: "espada" })],
      [{ id: "rec1", name: "Espada" }],
      update,
      "t",
    );
    expect(written(update)[0]).toBe("rec1");
    expect(res.failed).toEqual([]);
  });

  it("reports a row with no matching Websites record instead of dropping it", async () => {
    const update = recorder();
    const res = await writeSweepToAirtable([row({ site: "Ghost" })], websites, update, "t");
    expect(update).not.toHaveBeenCalled();
    expect(res.failed.map((f) => f.slug)).toEqual(["ghost"]);
    expect(res.failed[0]!.error).toMatch(/no Websites row/i);
  });

  // Two records whose names slug the same is an ambiguous join, and a verdict
  // written to the wrong client's row is worse than a verdict not written.
  it("refuses to guess when two Websites rows match one site", async () => {
    const update = recorder();
    const res = await writeSweepToAirtable(
      [row()],
      // Two rows that differ only in case slug identically — the realistic shape
      // of a duplicated site in the Websites table.
      [
        { id: "rec1", name: "Espada" },
        { id: "rec2", name: "ESPADA" },
      ],
      update,
      "t",
    );
    expect(update).not.toHaveBeenCalled();
    expect(res.failed[0]!.error).toMatch(/2 Websites rows/i);
  });

  // The columns are operator-added. Until they exist Airtable throws
  // UNKNOWN_FIELD_NAME on every row — that must not stop the sweep, and it must
  // not vanish either.
  it("records an UNKNOWN_FIELD_NAME as a soft failure and keeps going", async () => {
    const update = vi.fn<PrismicVerdictSink["update"]>(async () => {
      throw new Error("UNKNOWN_FIELD_NAME: Prismic Models");
    });
    const res = await writeSweepToAirtable(
      [row(), row({ site: "Hedloc" })],
      [
        { id: "rec1", name: "Espada" },
        { id: "rec2", name: "Hedloc" },
      ],
      update,
      "t",
    );
    expect(update).toHaveBeenCalledTimes(2);
    expect(res.written).toHaveLength(0);
    expect(res.failed).toHaveLength(2);
    expect(res.failed[0]!.error).toMatch(/UNKNOWN_FIELD_NAME/);
  });

  // A thrown non-Error would otherwise render as `undefined` through the usual
  // `(e as Error).message` cast — a write that failed for a blank reason.
  it("names the reason for a thrown non-Error", async () => {
    const update = vi.fn<PrismicVerdictSink["update"]>(async () => {
      throw "rate limited";
    });
    const res = await writeSweepToAirtable([row()], websites, update, "t");
    expect(res.failed[0]!.error).toContain("rate limited");
  });

  // EVERY row lands in exactly one bucket. A row that is neither written nor
  // reported is a site the operator believes was covered and was not.
  it("accounts for every row", async () => {
    const update = recorder();
    const rows = [
      row(),
      row({ site: "Hedloc", clean: false }),
      row({ site: "Ghost" }),
      row({ site: "Skipped", status: "skipped", clean: null }),
      row({ site: "Broken", status: "failed", clean: null }),
    ];
    const res = await writeSweepToAirtable(
      rows,
      [
        { id: "rec1", name: "Espada" },
        { id: "rec2", name: "Hedloc" },
        { id: "rec4", name: "Skipped" },
        { id: "rec5", name: "Broken" },
      ],
      update,
      "t",
    );
    expect(res.written.length + res.failed.length).toBe(rows.length);
  });
});

// ---------------------------------------------------------------------------
// The flag, end to end through the command — no network, no git, no Airtable.
// ---------------------------------------------------------------------------

let root: string;
let workdir: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "prismic-writeback-"));
  workdir = join(root, "workdir");
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function makeSite(name: string, repositoryName: string, models: string[]): Promise<void> {
  const dir = join(root, name);
  await mkdir(join(dir, ".git", "refs", "heads"), { recursive: true });
  await writeFile(join(dir, ".git", "HEAD"), "ref: refs/heads/main\n");
  await writeFile(join(dir, ".git", "refs", "heads", "main"), `${SHA}\n`);
  await writeFile(join(dir, "package.json"), JSON.stringify({ name }));
  await writeFile(
    join(dir, "slicemachine.config.json"),
    JSON.stringify({ repositoryName, libraries: ["./src/lib/slices"] }),
  );
  for (const id of models) {
    await mkdir(join(dir, "customtypes", id), { recursive: true });
    await writeFile(join(dir, "customtypes", id, "index.json"), JSON.stringify({ id }));
  }
}

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

/** A sink that records, plus the calls it recorded. */
const fakeSink = (sites: Array<{ id: string; name: string }>) => {
  const update = recorder();
  const open = vi.fn(async (): Promise<PrismicVerdictSink> => ({ websites: sites, update }));
  return { update, open };
};

const deps = (
  remote: Record<string, RemoteEntry[]>,
  env: Record<string, string | undefined>,
  openVerdictSink: PrismicModelsDeps["openVerdictSink"] = async () => {
    throw new Error("this test never opens Airtable");
  },
): PrismicModelsDeps => ({
  remoteModels: vi.fn(async (repo: string) => {
    const r = remote[repo];
    if (r === undefined) throw new Error(`no fake remote registered for ${repo}`);
    return r;
  }),
  sendModel: vi.fn(async () => {}),
  env,
  spawn: vi.fn<SpawnFn>(async () => {
    throw new Error("the fleet sweep must never spawn a process");
  }),
  openVerdictSink,
});

describe("runPrismicModelsCommand — --write-airtable", () => {
  // THE GUARD THIS TASK REMOVED used to be the only thing standing between
  // `--write-airtable` and a silent no-op. Outside fleet mode the flag has
  // nothing to write, so it must be refused rather than accepted and ignored.
  it("refuses --write-airtable without --fleet", async () => {
    const r = await runPrismicModelsCommand(
      undefined,
      { cwd: root, writeAirtable: true },
      deps({}, {}),
    );
    expect(r.code).toBe(2);
    expect(r.output).toContain("--write-airtable");
    expect(r.output).toMatch(/--fleet/);
    // …and it must not have quietly done the in-repo comparison instead.
    expect(r.output).not.toMatch(/model\(s\) match Prismic/);
  });

  it("no longer reports --write-airtable as unimplemented", async () => {
    await makeSite("espada", "espada", ["page"]);
    const fleet = await inventory(["espada"]);
    const sink = fakeSink([{ id: "rec1", name: "espada" }]);
    const r = await runPrismicModelsCommand(
      undefined,
      { cwd: root, fleet, workdir, writeAirtable: true },
      deps({ espada: [customType("page")] }, { PRISMIC_TOKEN_ESPADA: "a" }, sink.open),
    );
    expect(r.output).not.toContain("NOT IMPLEMENTED");
  });

  it("writes each swept site's verdict and says so in the report", async () => {
    await makeSite("espada", "espada", ["page"]);
    await makeSite("hedloc", "hedloc", ["page"]);
    const fleet = await inventory(["espada", "hedloc"]);
    const sink = fakeSink([
      { id: "rec1", name: "espada" },
      { id: "rec2", name: "hedloc" },
    ]);
    const r = await runPrismicModelsCommand(
      undefined,
      { cwd: root, fleet, workdir, writeAirtable: true },
      deps(
        // espada agrees with Prismic; hedloc's remote is empty, so it diverges.
        { espada: [customType("page")], hedloc: [] },
        { PRISMIC_TOKEN_ESPADA: "a", PRISMIC_TOKEN_HEDLOC: "b" },
        sink.open,
      ),
    );
    expect(sink.update).toHaveBeenCalledTimes(2);
    expect(written(sink.update, 0)[1].verdict).toBe("pass");
    expect(written(sink.update, 1)[1].verdict).toBe("fail");
    // A real timestamp, not the empty string a missing argument would leave.
    expect(written(sink.update, 0)[1].checkedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(r.output).toContain("FLEET_WRITE_SUMMARY wrote=2 failed=0 total=2");
    // The sweep's own report must survive the write step, not be replaced by it.
    expect(r.output).toContain("[espada]");
    expect(r.output).toContain("2 checked, 0 failed, 0 skipped");
    expect(r.code).toBe(0);
  });

  // The control for the test above: without the flag, nothing may touch Airtable.
  it("opens no Airtable connection without the flag", async () => {
    await makeSite("espada", "espada", ["page"]);
    const fleet = await inventory(["espada"]);
    const sink = fakeSink([{ id: "rec1", name: "espada" }]);
    const r = await runPrismicModelsCommand(
      undefined,
      { cwd: root, fleet, workdir },
      deps({ espada: [customType("page")] }, { PRISMIC_TOKEN_ESPADA: "a" }, sink.open),
    );
    expect(sink.open).not.toHaveBeenCalled();
    expect(r.output).not.toContain("FLEET_WRITE_SUMMARY");
  });

  // A site nobody could read reaches Airtable as `unknown`, through the whole
  // command — the end-to-end form of the mapping test above.
  it("persists unknown for a site whose check failed", async () => {
    await makeSite("espada", "espada", ["page"]);
    const fleet = await inventory(["espada"]);
    const sink = fakeSink([{ id: "rec1", name: "espada" }]);
    // No PRISMIC_TOKEN_ESPADA in the environment: the check cannot run.
    const r = await runPrismicModelsCommand(
      undefined,
      { cwd: root, fleet, workdir, writeAirtable: true },
      deps({ espada: [customType("page")] }, {}, sink.open),
    );
    expect(written(sink.update)[1].verdict).toBe("unknown");
    expect(r.output).toContain("1 site(s) could not be read");
  });

  // THE PLAN'S WIRING DROPPED THIS. Its `--write-airtable` branch returned early
  // with `prismicSweepExitCode(checked, failed)` alone, so a fleet where two
  // repos overwrite each other's models — every site individually readable —
  // exited 0 as soon as anybody added the flag.
  it("keeps the collision alarm's exit code with the flag on", async () => {
    await makeSite("the-tower", "the-tower-burbank", ["page"]);
    await makeSite("the-tower-burbank", "the-tower-burbank", ["page"]);
    const fleet = await inventory(["the-tower", "the-tower-burbank"]);
    const sink = fakeSink([
      { id: "rec1", name: "the-tower" },
      { id: "rec2", name: "the-tower-burbank" },
    ]);
    const r = await runPrismicModelsCommand(
      undefined,
      { cwd: root, fleet, workdir, writeAirtable: true },
      deps(
        { "the-tower-burbank": [customType("page")] },
        { PRISMIC_TOKEN_THE_TOWER_BURBANK: "a" },
        sink.open,
      ),
    );
    expect(r.output).toContain("claimed by more than one site");
    expect(r.code).toBe(1);
  });

  // Ships dark: until the operator adds the three columns every write throws
  // UNKNOWN_FIELD_NAME. The nightly must not redden for it — the machine-readable
  // FLEET_WRITE_SUMMARY line is what a workflow gates on.
  it("does not redden the sweep when the columns do not exist yet", async () => {
    await makeSite("espada", "espada", ["page"]);
    const fleet = await inventory(["espada"]);
    const update = vi.fn<PrismicVerdictSink["update"]>(async () => {
      throw new Error("UNKNOWN_FIELD_NAME: Prismic Models");
    });
    const r = await runPrismicModelsCommand(
      undefined,
      { cwd: root, fleet, workdir, writeAirtable: true },
      deps({ espada: [customType("page")] }, { PRISMIC_TOKEN_ESPADA: "a" }, async () => ({
        websites: [{ id: "rec1", name: "espada" }],
        update,
      })),
    );
    expect(r.code).toBe(0);
    expect(r.output).toContain("FLEET_WRITE_SUMMARY wrote=0 failed=1 total=1");
  });

  // "Asked to write and wrote nothing" must never exit 0 — that is the silent
  // no-op the flag guard existed to prevent, arriving by another door. The report
  // is kept: it is the only thing this run produced.
  it("keeps the report and goes non-zero when Airtable cannot be opened at all", async () => {
    await makeSite("espada", "espada", ["page"]);
    const fleet = await inventory(["espada"]);
    const r = await runPrismicModelsCommand(
      undefined,
      { cwd: root, fleet, workdir, writeAirtable: true },
      deps({ espada: [customType("page")] }, { PRISMIC_TOKEN_ESPADA: "a" }, async () => {
        throw new Error("AIRTABLE_PAT is not set");
      }),
    );
    expect(r.code).not.toBe(0);
    expect(r.output).toContain("AIRTABLE_PAT is not set");
    expect(r.output).toContain("[espada]");
    expect(r.output).toMatch(/nothing was written/i);
  });
});
