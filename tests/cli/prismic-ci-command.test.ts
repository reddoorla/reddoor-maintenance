// The fleet face of the `prismic-ci` recipe — the command whose blast radius is
// FIFTEEN live client repositories, one pull request each.
//
// Every test below is one shape of the same failure: a run that did not deliver
// the workflow to a site must never render, or exit, like a run that did. The
// recipe itself is already written that way (a definitively-absent secret FAILS
// rather than noops); what this layer adds is the three facts only a fleet run
// can get wrong — an inventory that named nobody, a checkout nobody could
// establish, and a summary that totals per-site failures into a green exit.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  formatPrismicCiResults,
  runPrismicCiCommand,
  type PrismicCiCommandOptions,
} from "../../src/cli/commands/prismic-ci.js";
import { REUSABLE_WORKFLOW_PIN, isPinResolved } from "../../src/recipes/prismic-ci/template.js";
import type { RecipeResult, Site } from "../../src/types.js";

const r = (over: Partial<RecipeResult> = {}): RecipeResult => ({
  recipe: "prismic-ci",
  site: "Espada",
  status: "applied",
  commits: ["abc123"],
  notes: "opened PR https://github.com/reddoorla/espada/pull/9",
  ...over,
});

describe("formatPrismicCiResults", () => {
  it("lists the PR url for each applied site", () => {
    expect(formatPrismicCiResults([r()])).toContain("https://github.com/reddoorla/espada/pull/9");
  });

  it("reports a noop with its reason", () => {
    expect(
      formatPrismicCiResults([r({ status: "noop", notes: "not a Prismic site", commits: [] })]),
    ).toContain("not a Prismic site");
  });

  it("reports a failure", () => {
    expect(
      formatPrismicCiResults([r({ status: "failed", notes: "push rejected", commits: [] })]),
    ).toContain("failed");
  });

  it("summarises the counts", () => {
    const out = formatPrismicCiResults([r(), r({ site: "Hedloc", status: "noop", commits: [] })]);
    expect(out).toMatch(/1 applied, 1 noop, 0 failed/);
  });

  // THE COUNTS LINE IS NOT ENOUGH ON ITS OWN. A rollout in which every site
  // failed prints fifteen `[site] failed:` lines, and the one thing an operator
  // scrolling past them needs to know — that not one repository got the workflow
  // — is nowhere in the output except as an arithmetic exercise.
  it("says loudly when sites were attempted and not one was delivered", () => {
    const out = formatPrismicCiResults([
      r({ status: "failed", notes: "pin unresolved", commits: [] }),
      r({ site: "Hedloc", status: "failed", notes: "pin unresolved", commits: [] }),
    ]);
    expect(out).toMatch(/NO SITE GOT THE DELIVERY WORKFLOW/i);
    expect(out).toMatch(/0 applied, 0 noop, 2 failed/);
  });

  // …and it must NOT fire for a fleet that is simply already delivered. A
  // banner that shouts on every re-run of a finished rollout is a banner the
  // operator learns to scroll past, which is how the run above gets missed.
  it("stays quiet when nothing was applied because there was nothing to do", () => {
    const out = formatPrismicCiResults([
      r({ status: "noop", notes: "delivery workflow already current on main", commits: [] }),
    ]);
    expect(out).not.toMatch(/NO SITE GOT THE DELIVERY WORKFLOW/i);
  });
});

// ---------------------------------------------------------------------------
// The command.
// ---------------------------------------------------------------------------

let root: string;
let workdir: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "prismic-ci-cmd-"));
  workdir = join(root, ".workdir");
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/** One fleet checkout. Non-empty by default, so "no Prismic config here" is a
 *  fact about a readable repo rather than the killed-clone shape (which is its
 *  own failure, below). */
async function checkout(
  name: string,
  opts: { prismic?: boolean; gitDirOnly?: boolean } = {},
): Promise<void> {
  const d = join(root, name);
  await mkdir(d, { recursive: true });
  if (opts.gitDirOnly) {
    // Exactly what a `git clone` killed between "create .git" and "fill the
    // working tree" leaves behind, and what a fleet workdir then reuses forever.
    await mkdir(join(d, ".git"), { recursive: true });
    return;
  }
  await writeFile(join(d, "package.json"), JSON.stringify({ name }));
  if (opts.prismic !== false) {
    await writeFile(
      join(d, "slicemachine.config.json"),
      JSON.stringify({ repositoryName: name, libraries: ["./src/lib/slices"] }),
    );
  }
}

/** An inventory naming sites by directory. `gitRepo` is set because the recipe
 *  refuses a site without one — EXCEPT for a name passed with no directory
 *  behind it, which must also carry no clone source so `cloneIfNeeded` refuses
 *  it locally instead of reaching for the network. */
async function inventory(names: string[], opts: { unpreparable?: string[] } = {}): Promise<string> {
  const path = join(root, "inventory.json");
  await writeFile(
    path,
    JSON.stringify(
      names.map((name) =>
        opts.unpreparable?.includes(name)
          ? { name, path: join(root, name) }
          : { name, path: join(root, name), gitRepo: `reddoorla/${name}` },
      ),
    ),
  );
  return path;
}

/** A recipe fake that RECORDS which sites reached it. The absence assertions in
 *  this file are all of the form "the recipe was never called for that site",
 *  which a stubbed return value alone cannot express. */
function recipeFake(result: (site: Site) => RecipeResult = () => r()) {
  const calls: string[] = [];
  const runRecipe = vi.fn(async (site: Site) => {
    calls.push(site.name ?? site.path);
    return result(site);
  });
  return { runRecipe, calls };
}

const fleetOpts = (fleet: string): PrismicCiCommandOptions => ({ cwd: root, fleet, workdir });

describe("runPrismicCiCommand", () => {
  // THE STATE THE FLEET IS IN TODAY, end to end through the REAL recipe with the
  // REAL shipped pin: `REUSABLE_WORKFLOW_PIN.sha` is a placeholder until the
  // reusable workflow is published and tagged in reddoorla/.github, and while it
  // is, nothing may roll out. The failure this guards is not "a wrong PR" but a
  // quiet one: 15 sites refused, "0 applied, 0 failed", exit 0, read as a
  // finished rollout.
  it("refuses every site while the reusable-workflow pin is unresolved, and exits non-zero", async () => {
    expect(isPinResolved(REUSABLE_WORKFLOW_PIN)).toBe(false); // the premise, stated
    await checkout("espada");
    await checkout("hedloc");
    const fleet = await inventory(["espada", "hedloc"]);
    const res = await runPrismicCiCommand(undefined, fleetOpts(fleet));
    expect(res.code).toBe(1);
    expect(res.output).toMatch(/pin is unresolved/);
    expect(res.output).toContain("espada");
    expect(res.output).toContain("hedloc");
    expect(res.output).toMatch(/0 applied, 0 noop, 2 failed/);
    expect(res.output).toMatch(/NO SITE GOT THE DELIVERY WORKFLOW/i);
    // Nothing reached GitHub: the pin is checked before the first network call,
    // so no PR url can appear in this output.
    expect(res.output).not.toContain("https://github.com/");
  });

  // An inventory that names nobody is not a delivered fleet. The Airtable
  // inventory is view-filtered, so one filter change empties it with no error
  // anywhere — and "0 applied, 0 noop, 0 failed." exits 0 and reads like a
  // rollout with nothing left to do.
  it("refuses an inventory that resolved no sites", async () => {
    const fleet = await inventory([]);
    const f = recipeFake();
    const res = await runPrismicCiCommand(undefined, fleetOpts(fleet), { runRecipe: f.runRecipe });
    expect(res.code).toBe(1);
    expect(res.output).toMatch(/NO SITES/i);
    expect(f.runRecipe).not.toHaveBeenCalled();
  });

  // The bug Task 17 fixed in the sweep, in this command's shape.
  // `prepareFleetSites` isolates a clone failure into `skipped` so one bad row
  // cannot abort the fleet — and a command built from `prepared` alone then
  // reports a SHORTER rollout with no gap in it. A site nobody could clone is a
  // site that did not get the workflow.
  it("counts a site that could not be PREPARED as failed, never as a site with nothing to do", async () => {
    await checkout("espada");
    const fleet = await inventory(["espada", "ghost-site"], { unpreparable: ["ghost-site"] });
    const f = recipeFake();
    const res = await runPrismicCiCommand(undefined, fleetOpts(fleet), { runRecipe: f.runRecipe });
    expect(res.code).toBe(1);
    expect(res.output).toContain("ghost-site");
    expect(res.output).toMatch(/could not prepare this checkout/);
    expect(res.output).toMatch(/1 applied, 0 noop, 1 failed/);
    // The notice the fleet nightlies grep for a ::warning:: survives alongside
    // the row — the row is the COUNT, the notice is the operator signal.
    expect(res.output).toContain("site(s) skipped (could not prepare)");
    expect(f.calls).toEqual(["espada"]);
  });

  // A whole fleet nobody could clone — an expired App token, GitHub down, a full
  // disk — is the case the row above exists for, at fleet scale.
  it("exits non-zero when not one site could be prepared", async () => {
    const fleet = await inventory(["ghost-a", "ghost-b"], {
      unpreparable: ["ghost-a", "ghost-b"],
    });
    const f = recipeFake();
    const res = await runPrismicCiCommand(undefined, fleetOpts(fleet), { runRecipe: f.runRecipe });
    expect(res.code).toBe(1);
    expect(res.output).toMatch(/0 applied, 0 noop, 2 failed/);
    expect(res.output).toMatch(/NO SITE GOT THE DELIVERY WORKFLOW/i);
    expect(f.runRecipe).not.toHaveBeenCalled();
  });

  // THE ABSENT-VS-UNREADABLE RULE, at the one place this command can hit it. A
  // directory holding `.git` and nothing else is a killed clone; every file read
  // inside it is ENOENT, so the recipe's own config read answers "not a Prismic
  // site" and the site nooooops out of the rollout — on every run after the
  // first, because a fleet workdir reuses any non-empty directory forever.
  it("refuses a checkout with no working tree instead of letting it read as 'not a Prismic site'", async () => {
    await checkout("espada");
    await checkout("hedloc", { gitDirOnly: true });
    const fleet = await inventory(["espada", "hedloc"]);
    const f = recipeFake();
    const res = await runPrismicCiCommand(undefined, fleetOpts(fleet), { runRecipe: f.runRecipe });
    expect(res.code).toBe(1);
    expect(res.output).toMatch(/no working tree/);
    expect(res.output).not.toMatch(/not a Prismic site/);
    expect(res.output).toMatch(/1 applied, 0 noop, 1 failed/);
    // And the recipe never ran for it: a checkout nobody established is not a
    // tree to branch, commit and push from.
    expect(f.calls).toEqual(["espada"]);
  });

  // The other half of the same rule, and the one single-site mode can reach on
  // its own: `localPath` never checks that the path exists, so a typo'd
  // `reddoor-maint prismic-ci ./stie` arrives here as a directory whose every
  // read is ENOENT. "I could not read this checkout" is not "this repo has no
  // Prismic in it", and it must not become a noop the operator scrolls past.
  it("fails a single site whose checkout cannot be read, and never runs the recipe on it", async () => {
    const f = recipeFake();
    const res = await runPrismicCiCommand(
      join(root, "no-such-site"),
      { cwd: root },
      {
        runRecipe: f.runRecipe,
      },
    );
    expect(res.code).toBe(1);
    expect(res.output).toMatch(/cannot read this checkout/);
    // A `[site] noop:` ROW, not the word in the counts line: the failure this
    // pins is the unreadable checkout rendering as a site with nothing to do.
    expect(res.output).not.toMatch(/\] noop:/);
    expect(res.output).toMatch(/0 applied, 0 noop, 1 failed/);
    expect(f.runRecipe).not.toHaveBeenCalled();
  });

  // A repo that genuinely has no Prismic in it still noops, and a fleet of them
  // is a legitimate exit 0 — the guard above must not have swallowed the skip.
  it("still noops a readable repo that genuinely has no Prismic in it", async () => {
    await checkout("1836dig", { prismic: false });
    const fleet = await inventory(["1836dig"]);
    const f = recipeFake(() => r({ status: "noop", notes: "not a Prismic site", commits: [] }));
    const res = await runPrismicCiCommand(undefined, fleetOpts(fleet), { runRecipe: f.runRecipe });
    expect(res.code).toBe(0);
    expect(res.output).toMatch(/0 applied, 1 noop, 0 failed/);
    expect(f.calls).toEqual(["1836dig"]);
  });

  // Per-site isolation: one site that THROWS must not take the other fourteen
  // down with it, and must not be reported as anything but a failure.
  it("isolates a throwing site and still runs the rest", async () => {
    await checkout("espada");
    await checkout("hedloc");
    const fleet = await inventory(["espada", "hedloc"]);
    const f = recipeFake((site) => {
      if (site.name === "espada") throw new Error("git exploded");
      return r({ site: "hedloc" });
    });
    const res = await runPrismicCiCommand(undefined, fleetOpts(fleet), { runRecipe: f.runRecipe });
    expect(res.code).toBe(1);
    expect(res.output).toContain("git exploded");
    expect(res.output).toMatch(/1 applied, 0 noop, 1 failed/);
    expect(f.calls).toEqual(["espada", "hedloc"]);
  });

  // A green fleet run is possible, and it says what it did.
  it("reports the PR it opened per site and exits 0", async () => {
    await checkout("espada");
    const fleet = await inventory(["espada"]);
    const f = recipeFake();
    const res = await runPrismicCiCommand(undefined, fleetOpts(fleet), { runRecipe: f.runRecipe });
    expect(res.code).toBe(0);
    expect(res.output).toContain("https://github.com/reddoorla/espada/pull/9");
    expect(res.output).toMatch(/1 applied, 0 noop, 0 failed/);
  });

  // --dry is the only way to see the blast radius before firing it. It must
  // write nothing…
  it("--dry lists the sites without running the recipe", async () => {
    await checkout("espada");
    await checkout("hedloc");
    const fleet = await inventory(["espada", "hedloc"]);
    const f = recipeFake();
    const res = await runPrismicCiCommand(
      undefined,
      { ...fleetOpts(fleet), dry: true },
      { runRecipe: f.runRecipe },
    );
    expect(res.output).toMatch(/would/i);
    expect(res.output).toContain("espada");
    expect(res.output).toContain("hedloc");
    expect(f.runRecipe).not.toHaveBeenCalled();
  });

  // …and it must not promise a rollout the real run would refuse. While the pin
  // is unresolved a dry run that printed "2 sites would get a PR", exit 0, is a
  // preview of something that cannot happen.
  it("--dry refuses while the pin is unresolved rather than previewing PRs", async () => {
    await checkout("espada");
    const fleet = await inventory(["espada"]);
    const f = recipeFake();
    const res = await runPrismicCiCommand(
      undefined,
      { ...fleetOpts(fleet), dry: true },
      { runRecipe: f.runRecipe },
    );
    expect(res.code).toBe(1);
    expect(res.output).toMatch(/pin is unresolved/);
    expect(f.runRecipe).not.toHaveBeenCalled();
  });

  // Inherited from `resolveSites`, and worth pinning here: naming one site AND a
  // fleet is a malformed invocation (exit 2), not a fleet run.
  it("refuses a positional site alongside --fleet", async () => {
    const fleet = await inventory(["espada"]);
    await expect(runPrismicCiCommand("espada", fleetOpts(fleet))).rejects.toThrow(
      /cannot combine a positional/i,
    );
  });
});

// ---------------------------------------------------------------------------
// Registration. A command nobody can type is a command nobody runs, and a flag
// that parses but is never read is the silent no-op class this whole pipeline is
// written against — so both directions are checked, the second at the type
// level.
// ---------------------------------------------------------------------------

const binSource = await readFile(
  resolve(dirname(fileURLToPath(import.meta.url)), "../../src/cli/bin.ts"),
  "utf-8",
);

/** The `cli.command("prismic-ci …")…` chain, sliced out of bin.ts so a flag
 *  registered on a DIFFERENT command cannot satisfy an assertion here. */
function commandBlock(source: string, command: string): string {
  const at = source.indexOf(`"${command} [site]"`);
  expect(at, `bin.ts registers no "${command} [site]" command`).toBeGreaterThan(-1);
  const start = source.lastIndexOf("\ncli", at);
  const nextRel = source.slice(at).search(/\ncli[.\n]/);
  return source.slice(start, nextRel === -1 ? undefined : at + nextRel);
}

/** Every flag this command accepts, and the option key it lands on. `satisfies`
 *  ties each value to a REAL key, so a typo'd key is a tsc error rather than a
 *  flag that parses into nothing. */
const FLAGS = {
  "--fleet": "fleet",
  "--workdir": "workdir",
  "--dry": "dry",
} as const satisfies Record<string, keyof PrismicCiCommandOptions>;

/** THE REVERSE DIRECTION, at compile time: every option the command honours must
 *  have a flag somebody can type. `cwd` is excluded — it is a GLOBAL cac option
 *  registered once for every command. */
type Uncovered = Exclude<keyof PrismicCiCommandOptions, "cwd" | (typeof FLAGS)[keyof typeof FLAGS]>;
const _everyOptionHasAFlag: [Uncovered] extends [never] ? true : Uncovered = true;

describe("bin.ts registration", () => {
  it("registers prismic-ci and wires it to the command", () => {
    const block = commandBlock(binSource, "prismic-ci");
    expect(block).toContain("runPrismicCiCommand");
    expect(_everyOptionHasAFlag).toBe(true);
  });

  it("registers every flag the command reads", () => {
    const block = commandBlock(binSource, "prismic-ci");
    for (const flag of Object.keys(FLAGS)) {
      expect(block, `bin.ts does not register ${flag} on prismic-ci`).toContain(`"${flag}`);
    }
  });
});
