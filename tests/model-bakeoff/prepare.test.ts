import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { prepare, type Task } from "../../scripts/model-bakeoff/bakeoff.mjs";
import * as figmaInventory from "../../scripts/model-bakeoff/tasks/figma-inventory.mjs";
import * as pnpmUpdate from "../../scripts/model-bakeoff/tasks/pnpm-update.mjs";
import * as refuteClaims from "../../scripts/model-bakeoff/tasks/refute-claims.mjs";
import * as refuteRepo from "../../scripts/model-bakeoff/tasks/refute-repo.mjs";
import * as seededReview from "../../scripts/model-bakeoff/tasks/seeded-review.mjs";
import * as t4PlanTask from "../../scripts/model-bakeoff/tasks/t4-plan-task.mjs";
import * as t5Census from "../../scripts/model-bakeoff/tasks/t5-census.mjs";

// Typecheck is the test here: each task's hooks must fit the harness's Task type.
const TASKS: Task[] = [
  figmaInventory,
  pnpmUpdate,
  refuteClaims,
  refuteRepo,
  seededReview,
  t4PlanTask,
  t5Census,
];

const base = mkdtempSync(join(tmpdir(), "bakeoff-prepare-test-"));
// prepare freezes each run's input read-only, which stops a non-root rm (CI) inside it.
function writable(dir: string) {
  chmodSync(dir, 0o755);
  for (const e of readdirSync(dir, { withFileTypes: true }))
    if (e.isDirectory()) writable(join(dir, e.name));
}
afterAll(() => {
  writable(base);
  rmSync(base, { recursive: true, force: true });
});
const src = join(base, "src");
mkdirSync(join(src, "docs"), { recursive: true });
writeFileSync(join(src, "docs", "a.txt"), "a\n");

let n = 0;
const fresh = () => join(base, `run-${++n}`);
const quiet = () => vi.spyOn(console, "log").mockImplementation(() => {});

// A task with one source file, one arm and a computed truth; `over` replaces any of it.
function fake(over: Partial<Task> = {}): Task {
  return {
    id: "fake",
    title: "fake",
    row: 0,
    sources: [{ from: "docs", match: /\.txt$/, to: "docs" }],
    collections: [],
    schema: {},
    prompt: (d) => `read ${d}`,
    goldAddendum: "",
    arms: [{ id: "haiku-low-1", model: "haiku", effort: "low" }],
    gold: { id: "gold", model: "opus", effort: "high" },
    truth: () => ({ ok: true }),
    ...over,
  };
}

describe("prepare", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("covers every task module", () => {
    expect(TASKS.map((t) => t.id).sort()).toEqual([
      "figma-inventory",
      "pnpm-update",
      "refute-claims",
      "refute-repo",
      "seeded-review",
      "t4-plan-task",
      "t5-census",
    ]);
  });

  it("runs setup before the input is frozen and listed, with root only when --root is given", async () => {
    quiet();
    const calls: { input: string; work: string; ids: string[]; root?: string }[] = [];
    const setup: Task["setup"] = (o) => {
      calls.push(o);
      mkdirSync(o.input, { recursive: true });
      writeFileSync(join(o.input, "plan.md"), "plan\n");
    };
    const out = fresh();
    await prepare({ out, root: src }, fake({ setup }));
    expect(calls).toEqual([
      {
        input: join(out, "input"),
        work: join(out, "work"),
        ids: ["gold", "haiku-low-1"],
        root: src,
      },
    ]);
    const listed = JSON.parse(readFileSync(join(out, "manifest.json"), "utf8"));
    expect(Object.keys(listed)).toEqual([".", "docs", "docs/a.txt", "plan.md"]);
    expect((statSync(join(out, "input", "plan.md")).mode & 0o777).toString(8)).toBe("444");
    expect(JSON.parse(readFileSync(join(out, "truth.json"), "utf8"))).toEqual({ ok: true });

    // Without --root the sources come from this repository, and setup gets no root.
    const noRoot = fake({ setup, sources: [] });
    await prepare({ out: fresh() }, noRoot);
    expect(calls[1]!.root).toBeUndefined();
  });

  it("refuses a task with observe and no truth before building anything", async () => {
    const out = fresh();
    const { truth: _, ...rest } = fake({ observe: () => null });
    await expect(prepare({ out, root: src }, rest)).rejects.toThrow(
      "fake: a task with observe() needs a truth; the gold cannot be the reference",
    );
    expect(existsSync(out)).toBe(false);
  });

  it("leaves no run dir when setup throws, so the same --out works again", async () => {
    quiet();
    const out = fresh();
    const setup = () => {
      throw new Error("setup failed");
    };
    await expect(prepare({ out, root: src }, fake({ setup }))).rejects.toThrow("setup failed");
    expect(existsSync(out)).toBe(false);
    await prepare({ out, root: src }, fake());
    expect(existsSync(join(out, "workflow-args.json"))).toBe(true);
  });

  it("refuses a dangling symlink at --out and leaves it alone", async () => {
    const out = fresh();
    symlinkSync(join(base, "nowhere"), out);
    await expect(prepare({ out, root: src }, fake())).rejects.toThrow(
      `${out} exists; pick a fresh --out`,
    );
    expect(lstatSync(out).isSymbolicLink()).toBe(true);
  });

  it("removes the parents of --out it created when a step fails", async () => {
    quiet();
    const top = fresh();
    const truth = () => {
      throw new Error("truth failed");
    };
    await expect(
      prepare({ out: join(top, "a", "run"), root: src }, fake({ truth })),
    ).rejects.toThrow("truth failed");
    expect(existsSync(top)).toBe(false);
  });

  it("reports the step's own error when its cleanup also fails", async () => {
    quiet();
    const out = fresh();
    // A dangling link in the input makes the cleanup's statSync throw.
    const setup = (o: { input: string }) => {
      symlinkSync(join(base, "nowhere"), join(o.input, "dangling"));
      throw new Error("setup failed");
    };
    await expect(prepare({ out, root: src }, fake({ setup }))).rejects.toThrow("setup failed");
    expect(existsSync(out)).toBe(false);
  });

  it("leaves no run dir when truth throws after the input is frozen", async () => {
    quiet();
    const out = fresh();
    const truth = () => {
      throw new Error("truth failed");
    };
    await expect(prepare({ out, root: src }, fake({ truth }))).rejects.toThrow("truth failed");
    expect(existsSync(out)).toBe(false);
  });
});
