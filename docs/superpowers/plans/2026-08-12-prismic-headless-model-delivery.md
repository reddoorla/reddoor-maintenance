# Headless Prismic model delivery — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a Prismic custom-type or slice-model change ride a normal PR — the PR comment shows the model delta, merging pushes it to Prismic, and a nightly sweep alarms on any divergence — so no human ever opens Slice Machine to deliver a schema change.

**Architecture:** A pure comparison core (`canon`/`diffModels`) sits under thin IO adapters (local fs, Prismic Types API, prettier) in a new `src/prismic/models/` module of `@reddoorla/maintenance`. One CLI command, `reddoor-maint prismic-models`, exposes it in two modes: **in-repo** (CI reads the cwd, token from `PRISMIC_WRITE_TOKEN`) and **fleet** (central, clones each site, writes a verdict to Airtable). A reusable workflow in `reddoorla/.github` wires `--dry` to `pull_request` (comment only) and `--apply` to `push: main`; a nightly sweep in this repo feeds the cockpit. `remoteOnly` models are reported, never deleted — encoded in the type system, not just in a comment.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), vitest, cac, Prismic Custom Types API (`https://customtypes.prismic.io`), Airtable (`Websites` table), GitHub Actions.

**Source spec:** [docs/superpowers/specs/2026-08-12-prismic-headless-model-delivery-design.md](../specs/2026-08-12-prismic-headless-model-delivery-design.md)

## Verification note — `vitest` does not typecheck

Every task below prints a `pnpm vitest run …` command and an expected result. **A green vitest run is not evidence that `pnpm typecheck` passes.** Vitest transpiles without type-checking, so a test file can be type-invalid and still run — and the task's "Expected: FAIL — cannot resolve …" step will look exactly as predicted while the file would never compile.

This was found live in Task 5: the plan's test file used a direct `as { variations: Array<…> }` cast, which TypeScript rejects for insufficient overlap because `PrismicModel.variations` is `unknown` through the index signature. The red run looked normal; only `pnpm typecheck` caught it. The fix is the two-step `as unknown as { … }`, and that pattern is expected anywhere a test reaches into `PrismicModel`'s loose fields.

**Run `pnpm typecheck` in every task, not just the ones that mention it.**

---

## Fleet measurements — and how to take one

**Measured 2026-08-12 from each repo's default branch (`origin/HEAD`) via `git ls-tree`. Never from a working tree — see the methodology note below, which is the more important half of this section.**

| Scope                                            | Custom types | Slices  | Variations |
| ------------------------------------------------ | ------------ | ------- | ---------- |
| **In scope** — 15 Prismic-configured live repos  | **68**       | **132** | **180**    |
| `reddoor-starter` (sentinel — correctly skipped) | 7            | 26      | —          |
| `canvas-starter` (sentinel — correctly skipped)  | 1            | 15      | —          |

The two starter templates carry `repositoryName: "your-prismic-repo-name"` and have no Prismic repository behind them, so `readPrismicConfig` returns `null` and they are correctly out of scope. `composition-hospitality` carries the same sentinel but has no local checkout — **a local-only sweep finds two sentinel repos, not three**, which is a trap worth knowing before you "correct" the number down.

Derived facts, same basis: all 180 variations carry a string `id` (so `assertVariationsHaveIds` is defensive, not a live repair); 171 of 180 `imageUrl` values are `""` and 9 hold a real URL; **zero** `imageUrl` keys sit anywhere other than on a variation.

### Never measure the fleet from a working tree

Earlier drafts cited 77/174/232, then 69/131/183. Both were wrong, and the second was wrong in a way that matters more than being off by one: **it was unreproducible.** Six of the fifteen sibling checkouts sit on feature branches, and the checkouts are live — someone else is working in them right now.

This was caught the hard way. Two measurements of `reddoor-website` taken from the same working tree roughly forty minutes apart returned **8 custom types / 15 slices** and then **7 / 9**. Nothing in this repo changed between them; the sibling checkout moved. A third of the fleet's numbers drifted underneath the very commits that were adding those numbers to comments — the same rot two review rounds had just been spent eliminating, reintroduced by the measurement method itself.

**The rule: measure against a named ref with git plumbing, never the filesystem.**

```bash
db=$(git -C "$repo" symbolic-ref --short refs/remotes/origin/HEAD)   # e.g. origin/main
git -C "$repo" ls-tree -r --name-only "$db" | grep -c '^customtypes/[^/]*/index\.json$'
git -C "$repo" ls-tree -r --name-only "$db" | grep -c '/model\.json$'
```

No checkout, no fetch, nothing written to a client repo. Two gotchas: `canvas-starter` has no `origin/HEAD` configured (fall back to `origin/main`), and `origin/HEAD` itself advances on fetch — so state the basis AND the date, which is what makes the figure reproducible rather than merely current.

**When quoting a fleet number in a comment, date it and say what it was measured against.** An undated count rots into a false claim; an undated count from a working tree was never true in the first place.

**One exception, deliberately preserved:** `diff.ts:215` records 174 slices / 77 custom types. That is an _experiment record_ — a mutation-testing run that actually happened over that model set — not a live count. It is a strict superset of the in-scope figure, so the evidence it documents is stronger, not staler. Do not reconcile it downward; that would claim an experiment nobody ran.

---

## A `repositoryName` collision is possible ACROSS repos

Found while reconciling the counts above: `the-tower` and `the-tower-burbank` **both** declare `repositoryName: "the-tower-burbank"`. Two GitHub repos, one Prismic repository.

**Confirmed unreachable by the sweep, 2026-08-13**, by a second measurement the first one could not make: the Airtable `Websites` inventory holds **no row whose `Git repo` is `reddoorla/the-tower`** (the two Tower rows are `The Tower Burbank` → `reddoorla/the-tower-burbank`, and a `legacy` `Tower Burbank` with no repo at all). The fleet sweep enumerates the inventory, not the GitHub org, so it never visits `the-tower` and the two repos are never in scope together. That is the reason it is safe — not the archive flag, which nothing reads.

This is benign today only because `the-tower` is archived — it is the predecessor of `the-tower-burbank`. But nothing in the pipeline notices it. `assertNoDuplicateIds` (Task 8) prevents two files inside one repo from claiming one model id; there is no equivalent guard preventing two repos from claiming one Prismic repository. Both would derive the same `PRISMIC_TOKEN_THE_TOWER_BURBANK`, both would treat their own `customtypes/` as the source of truth, and in a fleet sweep whichever ran second would overwrite the first — silently, with no diff shown, because each repo's own comparison is internally consistent.

**Task 17 must fail the fleet sweep on a `repositoryName` collision, naming both repos**, for the same reason Task 8 fails on a duplicate model id: only a human can say which repo is the intended owner.

---

## The absent-vs-unreadable rule — the defect class of this whole plan

Read this before implementing ANY task that reads something. It has now been found three separate times in three tasks, each time surviving the fix for the previous one, and the most dangerous instance is still ahead in Task 9.

**The rule: "I could not read X" must never produce the same result as "X does not exist."**

Everything in this pipeline compares a local set against a remote set and acts on the difference. An absent thing and an unreadable thing are opposite facts, but a `catch` that returns a default collapses them into one — and because the pipeline's whole job is to make the two sets match, that collapse doesn't error, it **acts**. It deletes, it creates, or it reports "in sync". Prismic's Migration API then silently drops document fields the model no longer declares, HTTP 200, no warning.

Where it has already been found:

| Task | Site                                     | Collapsed into          | Consequence                                                           |
| ---- | ---------------------------------------- | ----------------------- | --------------------------------------------------------------------- |
| 8    | `readFile` of a model file               | "no model here"         | One model silently missing; CI reports "in sync"                      |
| 8    | `readdir` filter dropping symlinked dirs | "not a model directory" | Same, and the guard added for the row above never even runs           |
| 6    | `readFile` of `slicemachine.config.json` | "not a Prismic site"    | A whole live site drops out of the fleet sweep; sweep reports success |

Each fix was written to close the row above it and did not close the next one, because each `catch` looked locally reasonable. The pattern is not "we forgot a case" — it is that **a catch-all default is the natural way to write this code**, and it is wrong every time.

**The discrimination rule.** Only the errno that genuinely means non-existence may take the absent branch:

- Filesystem reads: `ENOENT` only. `EACCES`, `EISDIR`, `ENOTDIR`, `ELOOP` and I/O errors all mean the thing is THERE and unreadable → throw, naming the repo-relative path, with `{ cause: e }`.
- Directory listings: same, with one deliberate asymmetry. When ENUMERATING candidates, an entry that resolves to a non-directory is legitimately not a candidate and may be skipped silently — but an entry that cannot be resolved AT ALL (a dangling symlink) may not.
- HTTP, and this is the one still ahead: **404 is the only status that means "this model does not exist."**

### Task 9 is where this class becomes destructive

`remoteModels()` fetches the current models from Prismic. If any failure — 401, 403, 429, 500, a timeout, a DNS blip, a JSON parse error on the response — is caught and turned into "Prismic has no models", then:

- every local model lands in `toCreate`,
- `remoteOnly` is empty, so the never-delete invariant has nothing to protect,
- and in `--apply` mode CI pushes the **entire model set** at a repository that may already have perfectly good models.

An expired token is the likely trigger, and token expiry on Prismic is undocumented. That is the single worst failure this plan can produce, and it is one `catch` away at all times.

So `remoteModels()` must: treat only a 404 on a single model as "not present"; throw on every other non-2xx with the status attached; throw on a body that does not parse; and **never** return an empty array as a way of expressing failure. An empty remote model set is a real, meaningful state (a brand-new Prismic repository) and it must be reachable ONLY by a successful call that genuinely returned nothing.

### ⚠️ The 404 clause above does NOT apply to a collection GET

Read this before acting on the rule, because the rule as stated will lead you into the exact bug it exists to prevent.

"404 means the thing does not exist" is true of `GET /customtypes/{id}` — a request for ONE model. **It is false of `GET /customtypes`**, the whole-collection read that `remoteModels()` actually performs. There, a 404 means the repository or the route is not there; it does not mean "this repository has no models". A typo'd or wrong `repositoryName` is the realistic trigger, and treating that 404 as an empty collection makes every local model look like `toCreate` and pushes the entire model set at whatever repository the header did reach.

This was found during Task 9 review, and the danger is specifically that the fix is a _plausible-looking one-liner_ someone writes **because they read the rule above and applied it one level up**:

```ts
if (res.status === 404) return []; // ← NEVER do this on a collection endpoint
```

`remote.ts` carries a comment at that exact site saying not to, and a test that fails if anyone does. Leave both.

The general form of the lesson: **the not-found signal is only meaningful for a request that named one thing.** For a request that asks "what is there?", there is no not-found — only success, or failure to find out.

### The test that proves it

Every read-shaped task gets one test of this form, and it is the load-bearing test of that task:

> Given the read fails with something other than the not-found signal, the function THROWS — it does not return an empty/default value.

If you cannot write that test for a function you are implementing, the function has a catch-all in it.

---

## A mutation harness can lie, and it lies in the direction that looks like success

Task 11 ran 17 mutations against a capability guard. Every one reported "caught". They were all worthless: the harness passed `--reporter=basic`, which does not exist in vitest 4, so vitest exited before running a single test and **every mutation read as caught because nothing ran.**

It was only noticed because four of the mutations were ones that _had_ to be caught for unrelated reasons, so the implementer had a prior expectation to check against. Without that, seventeen green results would have been reported as proof.

This is the same defect class as everything else in this plan, aimed at the tooling: **"the test failed" and "the test never ran" produced the same observation.**

**Required shape for every mutation harness in this project:**

1. Gate on the runner's **exit code**, not on output text.
2. Assert the **specific named test** appears in the failure list — not merely that something failed.
3. Assert a **test summary was actually produced**, proving the runner got far enough to run tests at all.
4. Carry at least two **CONTROLS that must stay GREEN** — an honest edit that should not trip the guard (a comment-only change, a local rename). Without controls, "everything reds" is indistinguishable from a harness that reds on anything.
5. Confirm the mutation **actually applied** (`git diff --stat`) before running. A no-op mutation reads exactly like a caught one.

Points 4 and 5 are opposite ends of the same failure: 5 catches a mutation that never happened, 4 catches a harness that fails regardless of the mutation.

---

## `pnpm exec` in a target repo can INSTALL into that repo

Found in Task 11. `pnpm exec prettier` inside a bare clone does not merely fail to find prettier — it runs a **full `pnpm install` in the client's repository first**, materialising `node_modules/`. That is an unrequested mutation of a live client repo performed by a read-shaped operation.

The fix used here is to resolve and spawn the target's binary **by absolute path** (`<repoRoot>/node_modules/.bin/prettier`, probed via `realpath` so a dangling shim reads as absent), which removes pnpm and corepack from the path entirely.

The general fact matters beyond this plan: **any recipe that shells `pnpm exec` into a target repo has this property.** `formatWithPrettier` has two other callers (`health-endpoint`, `smoke-suite`); they happen to run after an install, so their exposure is lower — but it is the same mechanism, and neither has a timeout.

Also note `defaultSpawn` only sets `detached` when `timeoutMs` is present, so a spawn without a timeout cannot have its process group killed.

## Two deliberate deviations from the spec

Both are stated up front so a reviewer can reject them before code is written.

1. **The prettier trap is fixed by write-then-format, not `--stdin-filepath`.** The spec says to pipe generated model JSON through the target repo's prettier via `--stdin-filepath`. This repo's `SpawnFn` (`src/audits/util/spawn.ts:17`) has no stdin channel, and `formatWithPrettier` (`src/recipes/_prettier.ts:24`) already runs `pnpm exec prettier --write <paths>` in the target repo — proven fleet-wide idiom. Writing the file then formatting it in place reaches the identical end state with existing, tested code.

2. **`--pull` is in scope.** The spec's module list has no pull-down function, but trap #2 ("generated JSON must be formatted by the target repo's own prettier") was only ever observed on a pull-down PR, and pull-down is the _safe_ answer to a `remoteOnly` model — the alternative being deletion, which the design forbids. Without it, a nightly drift alarm has no non-manual resolution. It is human-invoked only and never runs in CI.

## File structure

| File                                                      | Responsibility                                                                                   |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `src/prismic/models/types.ts`                             | `ModelKind`, `PrismicModel`, `LocalEntry`, `RemoteEntry`, `ModelDiff`, `PushReport`. Types only. |
| `src/prismic/models/canon.ts`                             | `canon()` / `sameModel()`. Pure. No imports.                                                     |
| `src/prismic/models/diff.ts`                              | `diffModels()`, `describeDiff()`, `withRemoteScreenshots()`. Pure.                               |
| `src/prismic/models/config.ts`                            | Read `slicemachine.config.json`: `repositoryName` + `libraries`.                                 |
| `src/prismic/models/token.ts`                             | `prismicTokenEnvName()`, `resolvePrismicToken()`. Env only.                                      |
| `src/prismic/models/local.ts`                             | `localModels(repoRoot)` — fs read of `customtypes/**` + each library.                            |
| `src/prismic/models/remote.ts`                            | `remoteModels()`, `sendModel()` — Types API fetch.                                               |
| `src/prismic/models/push.ts`                              | `pushModels()` — ordering (slices first) + the never-delete invariant.                           |
| `src/prismic/models/write.ts`                             | `writeModelFile()` — pull-down write + target-repo prettier.                                     |
| `src/prismic/models/index.ts`                             | Re-exports the public surface.                                                                   |
| `src/cli/commands/prismic-models.ts`                      | The command: in-repo / fleet / tokens-doctor modes.                                              |
| `src/cli/bin.ts`                                          | Register `prismic-models` (lazy import, matching every other command).                           |
| `src/reports/airtable/websites.ts`                        | 3 new `WebsiteRow` fields + `updatePrismicModels()`.                                             |
| `src/alerts/digest-collectors.ts`                         | `collectPrismicDriftAlerts()`.                                                                   |
| `src/alerts/attention.ts`                                 | `"prismic-drift"` added to `AttentionItem["kind"]`.                                              |
| `src/dashboard/fleet-cockpit.ts`, `src/reports/digest.ts` | Wire the collector.                                                                              |
| `src/recipes/prismic-ci/index.ts`                         | Rollout recipe: caller workflow → per-repo PR.                                                   |
| `src/types.ts`                                            | `"prismic-ci"` added to `RecipeName`.                                                            |
| `workflows/reusable/prismic-models.yml`                   | Source of truth for the `reddoorla/.github` reusable workflow.                                   |
| `.github/workflows/fleet-prismic-drift.yml`               | Nightly fleet sweep.                                                                             |
| `AUTONOMY.md`                                             | The model-push classification clause.                                                            |
| `docs/runbooks/prismic-model-delivery.md`                 | Token minting, secret distribution, drift response.                                              |

Tests mirror the source tree under `tests/prismic/models/`, `tests/cli/`, `tests/alerts/`, `tests/recipes/`.

---

## Phase A — the pure core (no network, no filesystem)

### Task 1: `canon()` and `sameModel()`, with the `""` → `null` fix

**Files:**

- Create: `src/prismic/models/canon.ts`
- Test: `tests/prismic/models/canon.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/prismic/models/canon.test.ts
import { describe, it, expect } from "vitest";
import { canon, sameModel } from "../../../src/prismic/models/canon.js";

describe("canon", () => {
  it("ignores key order", () => {
    expect(canon({ b: 1, a: 2 })).toEqual(canon({ a: 2, b: 1 }));
  });

  it("drops null values (Prismic injects `select: null` into Link fields)", () => {
    expect(sameModel({ type: "Link" }, { type: "Link", select: null })).toBe(true);
  });

  it("drops imageUrl (the slice preview screenshot lives only in Prismic)", () => {
    expect(
      sameModel({ id: "hero", imageUrl: "" }, { id: "hero", imageUrl: "https://x/y.png" }),
    ).toBe(true);
  });

  // THE TRAP. Slice Machine writes thumbnails as {"height":""}; Prismic coerces
  // that empty string to null on ingest and hands back a model with the key GONE.
  // Keeping "" while dropping null made the two copies permanently unequal — a
  // push sent "", Prismic stored null, and the next scan diffed again forever.
  // Verified by round-tripping a thumbnail through the Types API on the-pinnacle:
  // sent height:"", read back height:null.
  it("drops empty-string values, so a thumbnail height:'' equals a remote with no height", () => {
    const local = { name: "desktop", width: 1200, height: "" };
    const remote = { name: "desktop", width: 1200 };
    expect(sameModel(local, remote)).toBe(true);
  });

  it("still reports a real difference between '' and a non-empty value", () => {
    expect(sameModel({ placeholder: "" }, { placeholder: "Enter name" })).toBe(false);
  });

  it("recurses into arrays and nested objects", () => {
    const a = { variations: [{ id: "default", primary: { b: 1, a: null } }] };
    const b = { variations: [{ id: "default", primary: { a: undefined, b: 1 } }] };
    expect(sameModel(a, b)).toBe(true);
  });

  it("leaves primitives alone", () => {
    expect(canon(0)).toBe(0);
    expect(canon(false)).toBe(false);
    expect(canon("x")).toBe("x");
  });

  it("does not treat 0 or false as empty", () => {
    expect(sameModel({ n: 0 }, {})).toBe(false);
    expect(sameModel({ b: false }, {})).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/prismic/models/canon.test.ts`
Expected: FAIL — `Failed to resolve import "../../../src/prismic/models/canon.js"`

- [ ] **Step 3: Write minimal implementation**

```ts
// src/prismic/models/canon.ts
//
// Canonical form for comparing a model on disk against the copy REGISTERED in
// Prismic. Prismic hands its copy back through its own serializer, so it differs
// from the file on disk in ways that mean NOTHING: key order, an explicit
// `"select": null` added to Link fields, `imageUrl` (the slice preview
// screenshot — Prismic owns it, so whatever the file on disk holds is
// meaningless for comparison: usually `""`, but nine RichText models across the
// fleet carry a stale `https://…`), and — the one beachfront's original did not
// handle — EMPTY STRINGS.
//
// The empty-string rule is load-bearing, not cosmetic. Slice Machine writes
// image thumbnails to disk as {"name":"desktop","width":1200,"height":""}.
// Prismic coerces that "" to null on ingest and returns a model with the key
// absent. Filtering null but keeping "" made the two copies unequal FOREVER: a
// push sends "", Prismic stores null, the next scan diffs again. The nightly
// drift check would have alarmed on hedloc every night for a divergence that
// never existed. Proven by round-tripping a thumbnail through the Types API on
// the-pinnacle: sent height:"", read back height:null.
//
// Safe because the only comparison it collapses is `"" vs absent`, which IS the
// non-difference. `"" vs "something"` still differs (one side keeps the key),
// and `0`/`false` are untouched — they are not `""`.

/** Recursively normalise a model for comparison. Pure. */
export function canon(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canon);
  if (v !== null && typeof v === "object") {
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>)
        .filter(([k, x]) => x !== null && x !== undefined && x !== "" && k !== "imageUrl")
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([k, x]) => [k, canon(x)]),
    );
  }
  return v;
}

/** True when two models are the same MODEL, ignoring serializer noise. */
export function sameModel(a: unknown, b: unknown): boolean {
  return JSON.stringify(canon(a)) === JSON.stringify(canon(b));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/prismic/models/canon.test.ts`
Expected: PASS — 8 tests

- [ ] **Step 5: Commit**

```bash
git add src/prismic/models/canon.ts tests/prismic/models/canon.test.ts
git commit -m "feat(prismic): canon() for model comparison, dropping empty strings

Prismic coerces \"\" to null on ingest, so a thumbnail height:\"\" on disk can
never equal the remote copy unless canon drops both. Verified by round-trip on
the-pinnacle."
```

---

### Task 2: model types

**Files:**

- Create: `src/prismic/models/types.ts`
- Test: none (types only — `pnpm typecheck` is the gate)

- [ ] **Step 1: Write the types**

```ts
// src/prismic/models/types.ts

/** Which Types API collection a model belongs to. Custom types live at
 *  `customtypes/<id>/index.json`; slices at `<library>/<Dir>/model.json`. */
export type ModelKind = "customtype" | "slice";

/** A Prismic model as JSON. Deliberately loose: this pipeline must round-trip
 *  every field Prismic holds, including ones it does not know about. Narrowing
 *  it to a hand-written schema is how fields get silently dropped — the exact
 *  failure class this module exists to prevent. */
export type PrismicModel = Record<string, unknown> & { id: string };

/** A model read from a repo working tree. `path` is always known here, which
 *  is what separates it from {@link RemoteEntry}. `id` mirrors `model.id`;
 *  both constructors derive it from the parsed model, so they cannot disagree. */
export type LocalEntry = {
  kind: ModelKind;
  id: string;
  model: PrismicModel;
  /** Repo-relative, forward-slashed. */
  path: string;
};

/** A model read from Prismic. It has no file on disk, so no `path`.
 *
 *  Kept distinct from {@link LocalEntry} so DIRECTION is a compile-time
 *  property, not a convention. `diffModels(local, remote)` with the
 *  arguments swapped would otherwise typecheck and silently invert
 *  `toCreate` and `remoteOnly` — CI would try to create models Prismic
 *  already holds and would report every local model as remote-only. The
 *  split makes that a type error. */
export type RemoteEntry = {
  kind: ModelKind;
  id: string;
  model: PrismicModel;
};

/** The four buckets a comparison sorts every model into. `remoteOnly` is the
 *  safety-critical one: it is REPORTED and never acted on by CI. */
export type ModelDiff = {
  toCreate: LocalEntry[];
  toUpdate: Array<{ local: LocalEntry; remote: RemoteEntry }>;
  unchanged: LocalEntry[];
  remoteOnly: RemoteEntry[];
};

/** Outcome of one push run.
 *
 *  `mode` is the MODE, not the verdict — read `failed` for that. A dry run
 *  populates `sent` with what it WOULD have sent, which is why the field
 *  cannot be read as "Prismic accepted these" without checking `mode` first. */
export type PushReport = {
  mode: "dry" | "apply";
  /** On `apply`, models Prismic accepted. On `dry`, models that would be sent. */
  sent: Array<{ kind: ModelKind; id: string; action: "insert" | "update" }>;
  /** `status` is the HTTP status when there was one. A 401/403 means the
   *  write token is dead or wrong (fix the secret); a 422 means Prismic
   *  rejected the model itself (fix the model). Those need different
   *  operator responses, and token expiry is undocumented — this is what
   *  tells them apart. */
  failed: Array<{ kind: ModelKind; id: string; error: string; status?: number }>;
};
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS (no output, exit 0)

- [ ] **Step 3: Commit**

```bash
git add src/prismic/models/types.ts
git commit -m "feat(prismic): model pipeline types"
```

---

### Task 3: `diffModels()`

**Files:**

- Create: `src/prismic/models/diff.ts`
- Test: `tests/prismic/models/diff.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/prismic/models/diff.test.ts
import { describe, it, expect } from "vitest";
import { diffModels } from "../../../src/prismic/models/diff.js";
import type { LocalEntry, RemoteEntry } from "../../../src/prismic/models/types.js";

const ctLocal = (id: string, model: Record<string, unknown> = {}): LocalEntry => ({
  kind: "customtype",
  id,
  model: { id, ...model },
  path: `customtypes/${id}/index.json`,
});
const ctRemote = (id: string, model: Record<string, unknown> = {}): RemoteEntry => ({
  kind: "customtype",
  id,
  model: { id, ...model },
});
const sliceLocal = (id: string, model: Record<string, unknown> = {}): LocalEntry => ({
  kind: "slice",
  id,
  model: { id, type: "SharedSlice", ...model },
  path: `src/lib/slices/${id}/model.json`,
});
const sliceRemote = (id: string, model: Record<string, unknown> = {}): RemoteEntry => ({
  kind: "slice",
  id,
  model: { id, type: "SharedSlice", ...model },
});

describe("diffModels", () => {
  it("sorts an identical fleet into `unchanged`", () => {
    const d = diffModels(
      [ctLocal("page"), sliceLocal("hero")],
      [ctRemote("page"), sliceRemote("hero")],
    );
    expect(d.unchanged.map((e) => e.id).sort()).toEqual(["hero", "page"]);
    expect(d.toCreate).toEqual([]);
    expect(d.toUpdate).toEqual([]);
    expect(d.remoteOnly).toEqual([]);
  });

  it("puts a local-only model in toCreate", () => {
    const d = diffModels([ctLocal("page"), ctLocal("blog")], [ctRemote("page")]);
    expect(d.toCreate.map((e) => e.id)).toEqual(["blog"]);
  });

  it("puts a changed model in toUpdate, carrying BOTH sides", () => {
    const d = diffModels(
      [ctLocal("page", { label: "Page v2" })],
      [ctRemote("page", { label: "Page" })],
    );
    expect(d.toUpdate).toHaveLength(1);
    expect(d.toUpdate[0]!.local.model.label).toBe("Page v2");
    expect(d.toUpdate[0]!.remote.model.label).toBe("Page");
  });

  it("puts a remote-only model in remoteOnly and NEVER anywhere else", () => {
    const d = diffModels([ctLocal("page")], [ctRemote("page"), ctRemote("frozen_page")]);
    expect(d.remoteOnly.map((e) => e.id)).toEqual(["frozen_page"]);
    expect(d.toCreate).toEqual([]);
    expect(d.toUpdate).toEqual([]);
  });

  // A custom type and a slice may legitimately share an id — they live in
  // different Types API collections. Keying on id alone would pair them and
  // report a phantom update that a push would then send to the wrong endpoint.
  it("keys on kind AND id, so a customtype never matches a slice of the same id", () => {
    const d = diffModels([ctLocal("hero")], [sliceRemote("hero")]);
    expect(d.toCreate.map((e) => e.kind)).toEqual(["customtype"]);
    expect(d.remoteOnly.map((e) => e.kind)).toEqual(["slice"]);
  });

  it("ignores serializer noise via sameModel (a `select: null` is not a diff)", () => {
    const d = diffModels(
      [ctLocal("page", { f: { type: "Link" } })],
      [ctRemote("page", { f: { type: "Link", select: null } })],
    );
    expect(d.unchanged.map((e) => e.id)).toEqual(["page"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/prismic/models/diff.test.ts`
Expected: FAIL — cannot resolve `../../../src/prismic/models/diff.js`

- [ ] **Step 3: Write minimal implementation**

```ts
// src/prismic/models/diff.ts
import { sameModel } from "./canon.js";
import type { LocalEntry, ModelDiff, ModelKind, RemoteEntry } from "./types.js";

/** Identity of a model ACROSS collections. A custom type and a slice can share
 *  an id (they are different Types API resources), so `kind` is part of the key —
 *  keying on id alone pairs them and reports a phantom update whose push would
 *  go to the wrong endpoint. */
const key = (e: { kind: ModelKind; id: string }): string => `${e.kind}:${e.id}`;

/** Sort local + remote models into the four buckets. Pure — no IO, no ordering
 *  assumptions. `remoteOnly` is reported only; nothing downstream may delete it. */
export function diffModels(local: LocalEntry[], remote: RemoteEntry[]): ModelDiff {
  const remoteByKey = new Map(remote.map((e) => [key(e), e]));
  const localKeys = new Set(local.map(key));
  const diff: ModelDiff = { toCreate: [], toUpdate: [], unchanged: [], remoteOnly: [] };
  for (const l of local) {
    const r = remoteByKey.get(key(l));
    if (!r) diff.toCreate.push(l);
    else if (sameModel(l.model, r.model)) diff.unchanged.push(l);
    else diff.toUpdate.push({ local: l, remote: r });
  }
  for (const r of remote) if (!localKeys.has(key(r))) diff.remoteOnly.push(r);
  return diff;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/prismic/models/diff.test.ts`
Expected: PASS — 6 tests

- [ ] **Step 5: Commit**

```bash
git add src/prismic/models/diff.ts tests/prismic/models/diff.test.ts
git commit -m "feat(prismic): diffModels sorts local vs remote into four buckets"
```

---

### Task 4: `describeDiff()` — readable field-level lines for the PR comment

**Files:**

- Modify: `src/prismic/models/diff.ts`
- Modify: `tests/prismic/models/diff.test.ts`

- [ ] **Step 1: Write the failing test (append to the existing file)**

```ts
// append to tests/prismic/models/diff.test.ts
import { describeDiff } from "../../../src/prismic/models/diff.js";

describe("describeDiff", () => {
  it("names an added field inside a slice variation", () => {
    const local = {
      id: "hero",
      variations: [
        { id: "default", primary: { title: { type: "Text" }, wash: { type: "Boolean" } } },
      ],
    };
    const remote = {
      id: "hero",
      variations: [{ id: "default", primary: { title: { type: "Text" } } }],
    };
    expect(describeDiff(local, remote)).toContain("+ default.primary.wash");
  });

  it("marks a field the REMOTE has and the local does not as REMOVED remotely", () => {
    const local = { id: "hero", variations: [{ id: "default", primary: {} }] };
    const remote = {
      id: "hero",
      variations: [{ id: "default", primary: { order_uids: { type: "Text" } } }],
    };
    expect(describeDiff(local, remote)).toContain(
      "- default.primary.order_uids (REMOVED remotely)",
    );
  });

  it("marks a changed field", () => {
    const local = { id: "hero", variations: [{ id: "default", primary: { t: { type: "Text" } } }] };
    const remote = {
      id: "hero",
      variations: [{ id: "default", primary: { t: { type: "StructuredText" } } }],
    };
    expect(describeDiff(local, remote)).toContain("~ default.primary.t (changed)");
  });

  it("reports a whole new variation and a whole removed one", () => {
    const local = { id: "hero", variations: [{ id: "default" }, { id: "wide" }] };
    const remote = { id: "hero", variations: [{ id: "default" }, { id: "narrow" }] };
    const lines = describeDiff(local, remote);
    expect(lines).toContain("+ variation wide (new)");
    expect(lines).toContain("- variation narrow (REMOVED remotely)");
  });

  // Custom types carry `json: { <Tab>: { <field>: {...} } }` instead of
  // variations. Without this branch every custom-type diff rendered as an empty
  // list and the PR comment said "changed" with no detail.
  it("walks a custom type's json tabs", () => {
    const local = {
      id: "page",
      json: { Main: { title: { type: "Text" }, hero_wash: { type: "Boolean" } } },
    };
    const remote = { id: "page", json: { Main: { title: { type: "Text" } } } };
    expect(describeDiff(local, remote)).toContain("+ Main.hero_wash");
  });

  it("reports a whole new tab", () => {
    const local = { id: "page", json: { Main: {}, SEO: { og: { type: "Text" } } } };
    const remote = { id: "page", json: { Main: {} } };
    expect(describeDiff(local, remote)).toContain("+ tab SEO (new)");
  });

  it("returns [] for a model with neither variations nor json", () => {
    expect(describeDiff({ id: "x" }, { id: "x" })).toEqual([]);
  });

  it("treats a missing remote as all-new without throwing", () => {
    const local = { id: "hero", variations: [{ id: "default", primary: { t: {} } }] };
    expect(describeDiff(local, undefined)).toContain("+ variation default (new)");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/prismic/models/diff.test.ts`
Expected: FAIL — `describeDiff is not a function`

- [ ] **Step 3: Write the implementation (append to `src/prismic/models/diff.ts`)**

```ts
// append to src/prismic/models/diff.ts

type Zone = Record<string, unknown>;
const asZone = (v: unknown): Zone => (v !== null && typeof v === "object" ? (v as Zone) : {});

/** Field-level lines for ONE model pair, used in PR comments and CLI output.
 *  Handles both shapes: slices carry `variations[]` each with `primary`/`items`
 *  zones; custom types carry `json: { <Tab>: { <field>: … } }`. A model with
 *  neither yields []. A missing `remote` renders everything as new. */
export function describeDiff(local: unknown, remote: unknown): string[] {
  const l = asZone(local);
  const r = asZone(remote);
  const lines: string[] = [];

  const compareZone = (label: string, lz: unknown, rz: unknown): void => {
    const a = asZone(lz);
    const b = asZone(rz);
    for (const k of Object.keys(a)) if (!(k in b)) lines.push(`+ ${label}.${k}`);
    for (const k of Object.keys(b)) if (!(k in a)) lines.push(`- ${label}.${k} (REMOVED remotely)`);
    for (const k of Object.keys(a))
      if (k in b && !sameModel(a[k], b[k])) lines.push(`~ ${label}.${k} (changed)`);
  };

  // Slice shape.
  if (Array.isArray(l.variations) || Array.isArray(r.variations)) {
    const lv = new Map(
      (Array.isArray(l.variations) ? l.variations : []).map((v) => [
        asZone(v).id as string,
        asZone(v),
      ]),
    );
    const rv = new Map(
      (Array.isArray(r.variations) ? r.variations : []).map((v) => [
        asZone(v).id as string,
        asZone(v),
      ]),
    );
    for (const [id, v] of lv) {
      const rr = rv.get(id);
      if (!rr) {
        lines.push(`+ variation ${id} (new)`);
        continue;
      }
      for (const zone of ["primary", "items"] as const)
        compareZone(`${id}.${zone}`, v[zone], rr[zone]);
    }
    for (const id of rv.keys()) if (!lv.has(id)) lines.push(`- variation ${id} (REMOVED remotely)`);
  }

  // Custom-type shape.
  if (l.json !== undefined || r.json !== undefined) {
    const lt = asZone(l.json);
    const rt = asZone(r.json);
    for (const tab of Object.keys(lt)) {
      if (!(tab in rt)) {
        lines.push(`+ tab ${tab} (new)`);
        continue;
      }
      compareZone(tab, lt[tab], rt[tab]);
    }
    for (const tab of Object.keys(rt))
      if (!(tab in lt)) lines.push(`- tab ${tab} (REMOVED remotely)`);
  }

  return lines;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/prismic/models/diff.test.ts`
Expected: PASS — 14 tests total in the file

- [ ] **Step 5: Commit**

```bash
git add src/prismic/models/diff.ts tests/prismic/models/diff.test.ts
git commit -m "feat(prismic): describeDiff renders field-level lines for slices and custom types"
```

---

### Task 5: `withRemoteScreenshots()`

**Files:**

- Modify: `src/prismic/models/diff.ts`
- Create: `tests/prismic/models/screenshots.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/prismic/models/screenshots.test.ts
import { describe, it, expect } from "vitest";
import { withRemoteScreenshots } from "../../../src/prismic/models/diff.js";
import type { PrismicModel } from "../../../src/prismic/models/types.js";

const local: PrismicModel = {
  id: "hero",
  variations: [
    { id: "default", imageUrl: "" },
    { id: "wide", imageUrl: "" },
  ],
};

describe("withRemoteScreenshots", () => {
  // A push REPLACES the model. Sending the local imageUrl — `""` on most models,
  // a stale URL on the nine RichText ones — would blank or rot every slice
  // preview in the editor UI as a side effect of adding one field.
  it("carries the remote imageUrl onto the model being sent", () => {
    const remote: PrismicModel = {
      id: "hero",
      variations: [{ id: "default", imageUrl: "https://img/hero-default.png" }],
    };
    const sent = withRemoteScreenshots(local, remote) as {
      variations: Array<Record<string, unknown>>;
    };
    expect(sent.variations[0]!.imageUrl).toBe("https://img/hero-default.png");
  });

  it("leaves a variation with no remote screenshot untouched", () => {
    const remote: PrismicModel = {
      id: "hero",
      variations: [{ id: "default", imageUrl: "https://img/hero-default.png" }],
    };
    const sent = withRemoteScreenshots(local, remote) as {
      variations: Array<Record<string, unknown>>;
    };
    expect(sent.variations[1]!.imageUrl).toBe("");
  });

  it("returns the local model unchanged when there is no remote (an insert)", () => {
    expect(withRemoteScreenshots(local, undefined)).toBe(local);
  });

  it("returns the local model unchanged for a custom type (no variations)", () => {
    const ct: PrismicModel = { id: "page", json: { Main: {} } };
    expect(withRemoteScreenshots(ct, { id: "page", json: { Main: {} } })).toBe(ct);
  });

  it("does not mutate the local model", () => {
    const remote: PrismicModel = {
      id: "hero",
      variations: [{ id: "default", imageUrl: "https://x.png" }],
    };
    withRemoteScreenshots(local, remote);
    expect((local.variations as Array<Record<string, unknown>>)[0]!.imageUrl).toBe("");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/prismic/models/screenshots.test.ts`
Expected: FAIL — `withRemoteScreenshots is not a function`

- [ ] **Step 3: Write the implementation (append to `src/prismic/models/diff.ts`)**

```ts
// append to src/prismic/models/diff.ts
import type { PrismicModel } from "./types.js";

/** The model to SEND: local semantics, remote screenshots.
 *
 *  A push REPLACES the model, and Prismic owns the preview screenshot, so the
 *  local `imageUrl` is never the value to send: it is `""` on most models and a
 *  STALE url on the nine RichText ones. Sending it would blank or rot the slice
 *  preview in the editor UI as a side effect of adding one field. Custom types
 *  have no variations and are returned untouched. Never mutates `local`.
 *
 *  Note the asymmetry with `canon`, which drops `imageUrl` entirely: comparison
 *  must ignore it, but a PUSH still has to carry a real value, and the only
 *  trustworthy one is the remote's. */
export function withRemoteScreenshots(
  local: PrismicModel,
  remote: PrismicModel | undefined,
): PrismicModel {
  if (!remote || !Array.isArray(local.variations)) return local;
  const shots = new Map(
    (Array.isArray(remote.variations) ? remote.variations : []).map((v) => {
      const o = asZone(v);
      return [o.id as string, o.imageUrl];
    }),
  );
  return {
    ...local,
    variations: local.variations.map((v) => {
      const o = asZone(v);
      const shot = shots.get(o.id as string);
      return shot ? { ...o, imageUrl: shot } : v;
    }),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/prismic/models/screenshots.test.ts`
Expected: PASS — 5 tests

- [ ] **Step 5: Commit**

```bash
git add src/prismic/models/diff.ts tests/prismic/models/screenshots.test.ts
git commit -m "feat(prismic): withRemoteScreenshots keeps editor previews across a push"
```

---

## Phase B — IO adapters

### Task 6: read `slicemachine.config.json`

**Files:**

- Create: `src/prismic/models/config.ts`
- Test: `tests/prismic/models/config.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/prismic/models/config.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readPrismicConfig } from "../../../src/prismic/models/config.js";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "prismic-config-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("readPrismicConfig", () => {
  it("reads repositoryName and libraries from slicemachine.config.json", async () => {
    await writeFile(
      join(dir, "slicemachine.config.json"),
      JSON.stringify({ repositoryName: "gallerysonder", libraries: ["./src/lib/slices"] }),
    );
    expect(await readPrismicConfig(dir)).toEqual({
      repositoryName: "gallerysonder",
      libraries: ["./src/lib/slices"],
    });
  });

  it("also accepts prismic.config.json (the CLI's renamed file)", async () => {
    await writeFile(
      join(dir, "prismic.config.json"),
      JSON.stringify({ repositoryName: "espada", libraries: ["./src/lib/slices"] }),
    );
    expect((await readPrismicConfig(dir))?.repositoryName).toBe("espada");
  });

  it("prefers slicemachine.config.json when both exist (the fleet's live file)", async () => {
    await writeFile(join(dir, "slicemachine.config.json"), JSON.stringify({ repositoryName: "a" }));
    await writeFile(join(dir, "prismic.config.json"), JSON.stringify({ repositoryName: "b" }));
    expect((await readPrismicConfig(dir))?.repositoryName).toBe("a");
  });

  it("returns null when the repo has no Prismic config (data-dynamiq, non-CMS sites)", async () => {
    expect(await readPrismicConfig(dir)).toBeNull();
  });

  // Only ENOENT means "not a Prismic site". A config that is THERE and cannot be
  // read must throw: returning null would silently reclass a live Prismic site
  // as a non-Prismic one and drop it from the fleet sweep with the sweep still
  // reporting success. A directory named slicemachine.config.json reproduces
  // this deterministically (EISDIR) with no permission games, so it works when
  // the suite runs as root in CI.
  it("THROWS when the config is present but unreadable", async () => {
    await mkdir(join(dir, "slicemachine.config.json"), { recursive: true });
    await expect(readPrismicConfig(dir)).rejects.toThrow(/present but unreadable/);
  });

  // ...and the fallback must not paper over it either: an unreadable
  // slicemachine.config.json must not silently fall through to a valid
  // prismic.config.json, because the site would then be swept against whichever
  // file happened to be readable.
  it("does not fall through to prismic.config.json when the first is unreadable", async () => {
    await mkdir(join(dir, "slicemachine.config.json"), { recursive: true });
    await writeFile(join(dir, "prismic.config.json"), JSON.stringify({ repositoryName: "b" }));
    await expect(readPrismicConfig(dir)).rejects.toThrow(/present but unreadable/);
  });

  it("defaults libraries to ./src/lib/slices when the key is absent", async () => {
    await writeFile(join(dir, "slicemachine.config.json"), JSON.stringify({ repositoryName: "x" }));
    expect((await readPrismicConfig(dir))?.libraries).toEqual(["./src/lib/slices"]);
  });

  // The `your-prismic-repo-name` sentinel ships in the starter and three fleet
  // repos still carry it. Treating it as a real repository name would send a
  // sweep at a repo that does not exist and report the 404 as drift.
  it("returns null for the unreplaced starter sentinel", async () => {
    await writeFile(
      join(dir, "slicemachine.config.json"),
      JSON.stringify({ repositoryName: "your-prismic-repo-name" }),
    );
    expect(await readPrismicConfig(dir)).toBeNull();
  });

  it("throws on malformed JSON rather than silently treating the repo as non-Prismic", async () => {
    await writeFile(join(dir, "slicemachine.config.json"), "{ not json");
    await expect(readPrismicConfig(dir)).rejects.toThrow(/slicemachine\.config\.json/);
  });

  it("throws when repositoryName is missing or not a string", async () => {
    await mkdir(join(dir, "sub"), { recursive: true });
    await writeFile(
      join(dir, "sub", "slicemachine.config.json"),
      JSON.stringify({ libraries: [] }),
    );
    await expect(readPrismicConfig(join(dir, "sub"))).rejects.toThrow(/repositoryName/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/prismic/models/config.test.ts`
Expected: FAIL — cannot resolve `../../../src/prismic/models/config.js`

- [ ] **Step 3: Write minimal implementation**

```ts
// src/prismic/models/config.ts
import { readFile } from "node:fs/promises";
import { join } from "node:path";

/** What this pipeline needs from a site's Prismic config. */
export type PrismicConfig = {
  /** The Prismic repository name — the `repository` header on every Types API call. */
  repositoryName: string;
  /** Slice library directories, repo-relative. Fleet-uniform at ["./src/lib/slices"],
   *  but read rather than assumed: alamo-anatomy points at a directory that does
   *  not exist, and assuming the path would make its models invisible instead of
   *  visibly empty. */
  libraries: string[];
};

/** Slice Machine's file, and the name the Prismic CLI renames it to. Both are
 *  read so an adopting repo does not go dark; slicemachine.config.json wins
 *  because that is the file every Prismic-configured fleet repo ships today
 *  (15 as of 2026-08-12; not every fleet site uses Prismic — 1836dig and the
 *  two LA-Homelessness sites have no config at all). */
const CONFIG_FILES = ["slicemachine.config.json", "prismic.config.json"] as const;

/** The starter's placeholder. Three fleet repos still carry it unreplaced. */
const SENTINEL = "your-prismic-repo-name";

/**
 * Read a repo's Prismic config, or null when it is not a Prismic site.
 *
 * null means "no Prismic here, skip this repo" — no config file at all, or a
 * repositoryName still set to the starter sentinel. A PRESENT but malformed
 * config THROWS: a repo that has Prismic and a broken config must surface as an
 * error, never as a silent skip. That distinction is the whole point of the
 * return type.
 *
 * "Present but unreadable" therefore has to throw as well, and only a genuine
 * ENOENT may fall through to the next candidate filename. An earlier draft
 * caught EVERY read error and continued, which made an unreadable config
 * indistinguishable from an absent one and returned null — silently reclassing
 * a live Prismic site as "not a Prismic site" and dropping it from the fleet
 * sweep entirely, with the sweep still reporting success. That is the same
 * silent-skip class as `localModels` (Task 8), one layer up and one order of
 * magnitude worse: there it loses one model, here it loses a whole site.
 */
export async function readPrismicConfig(repoRoot: string): Promise<PrismicConfig | null> {
  for (const name of CONFIG_FILES) {
    let raw: string;
    try {
      raw = await readFile(join(repoRoot, name), "utf-8");
    } catch (e) {
      // ENOENT is the ONLY error that means "this repo does not have this file".
      // EACCES, EISDIR (a directory named slicemachine.config.json), ELOOP and
      // I/O errors all mean the file is THERE and we cannot read it.
      if ((e as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw new Error(`${name}: present but unreadable (${(e as Error).message})`, { cause: e });
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      throw new Error(`${name}: invalid JSON (${(e as Error).message})`, { cause: e });
    }
    const cfg = parsed as { repositoryName?: unknown; libraries?: unknown };
    if (typeof cfg.repositoryName !== "string" || cfg.repositoryName.trim() === "") {
      throw new Error(`${name}: repositoryName is missing or not a string`);
    }
    if (cfg.repositoryName === SENTINEL) return null;
    const libraries =
      Array.isArray(cfg.libraries) && cfg.libraries.every((l) => typeof l === "string")
        ? (cfg.libraries as string[])
        : ["./src/lib/slices"];
    return { repositoryName: cfg.repositoryName, libraries };
  }
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/prismic/models/config.test.ts`
Expected: PASS — 8 tests

- [ ] **Step 5: Commit**

```bash
git add src/prismic/models/config.ts tests/prismic/models/config.test.ts
git commit -m "feat(prismic): read repositoryName + libraries from the site's Prismic config"
```

---

### Task 7: token resolution

**Files:**

- Create: `src/prismic/models/token.ts`
- Test: `tests/prismic/models/token.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/prismic/models/token.test.ts
import { describe, it, expect } from "vitest";
import { prismicTokenEnvName, resolvePrismicToken } from "../../../src/prismic/models/token.js";

describe("prismicTokenEnvName", () => {
  it("upper-snakes the repository name", () => {
    expect(prismicTokenEnvName("the-pointe-burbank")).toBe("PRISMIC_TOKEN_THE_POINTE_BURBANK");
  });

  it("handles a name with no separators", () => {
    expect(prismicTokenEnvName("gallerysonder")).toBe("PRISMIC_TOKEN_GALLERYSONDER");
  });

  it("collapses any non-alphanumeric run to a single underscore", () => {
    expect(prismicTokenEnvName("beach.front--dentistry")).toBe(
      "PRISMIC_TOKEN_BEACH_FRONT_DENTISTRY",
    );
  });
});

describe("resolvePrismicToken", () => {
  it("prefers the canonical per-repo env var", () => {
    const env = { PRISMIC_TOKEN_ESPADA: "canonical", PRISMIC_WRITE_TOKEN: "generic" };
    expect(resolvePrismicToken("espada", env, { allowGeneric: true })).toEqual({
      token: "canonical",
      source: "PRISMIC_TOKEN_ESPADA",
    });
  });

  // In-repo (CI) mode: the site's own Actions secret is the generic name, which
  // is what every site's code already reads. Fleet mode must NOT fall back to it —
  // one generic token pointed at 18 different repositories is a footgun.
  it("falls back to PRISMIC_WRITE_TOKEN only when generic is allowed", () => {
    const env = { PRISMIC_WRITE_TOKEN: "generic" };
    expect(resolvePrismicToken("espada", env, { allowGeneric: true })).toEqual({
      token: "generic",
      source: "PRISMIC_WRITE_TOKEN",
    });
    expect(resolvePrismicToken("espada", env, { allowGeneric: false })).toBeNull();
  });

  it("returns null when nothing is set", () => {
    expect(resolvePrismicToken("espada", {}, { allowGeneric: true })).toBeNull();
  });

  it("treats a whitespace-only value as absent", () => {
    expect(
      resolvePrismicToken("espada", { PRISMIC_TOKEN_ESPADA: "   " }, { allowGeneric: false }),
    ).toBeNull();
  });

  it("trims the token (a trailing newline from a secret paste 403s)", () => {
    expect(
      resolvePrismicToken("espada", { PRISMIC_TOKEN_ESPADA: "abc\n" }, { allowGeneric: false })
        ?.token,
    ).toBe("abc");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/prismic/models/token.test.ts`
Expected: FAIL — cannot resolve `../../../src/prismic/models/token.js`

- [ ] **Step 3: Write minimal implementation**

```ts
// src/prismic/models/token.ts

/** Where a resolved token came from — printed by the tokens doctor so an
 *  operator can see WHICH env var answered, never the value. */
export type ResolvedToken = { token: string; source: string };

/**
 * The canonical env var holding a Prismic repository's write token:
 * `PRISMIC_TOKEN_<REPOSITORY_NAME>` upper-snaked.
 *
 * One rule, derivable from the repository name alone — no hand-maintained map
 * from site slug to env var. The pre-existing central stash uses ad-hoc short
 * names (MSOT_PRISMIC, POINTE_PRISMIC, ALAMO_PRISMIC …) that cannot be derived
 * from anything; `prismic-models --tokens` prints the rename checklist rather
 * than encoding those aliases here, so the convention stays one line of code.
 */
export function prismicTokenEnvName(repositoryName: string): string {
  const slug = repositoryName
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return `PRISMIC_TOKEN_${slug}`;
}

/**
 * Resolve the write token for one Prismic repository.
 *
 * `allowGeneric` is the mode switch and it matters. IN-REPO (CI) runs set
 * `allowGeneric: true`: the site's own Actions secret is `PRISMIC_WRITE_TOKEN`,
 * the name every site's code already reads, and there is exactly one Prismic
 * repository in scope. FLEET runs set it FALSE: a single generic token in the
 * environment while iterating every fleet repository would silently attach the wrong
 * credential to every site after the first.
 */
export function resolvePrismicToken(
  repositoryName: string,
  env: Record<string, string | undefined>,
  opts: { allowGeneric: boolean },
): ResolvedToken | null {
  const canonical = prismicTokenEnvName(repositoryName);
  const names = opts.allowGeneric ? [canonical, "PRISMIC_WRITE_TOKEN"] : [canonical];
  for (const name of names) {
    const value = env[name]?.trim();
    if (value) return { token: value, source: name };
  }
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/prismic/models/token.test.ts`
Expected: PASS — 8 tests

- [ ] **Step 5: Commit**

```bash
git add src/prismic/models/token.ts tests/prismic/models/token.test.ts
git commit -m "feat(prismic): PRISMIC_TOKEN_<REPO> resolution, generic fallback in-repo only"
```

---

### Task 8: `localModels()`

**Files:**

- Create: `src/prismic/models/local.ts`
- Test: `tests/prismic/models/local.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/prismic/models/local.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { localModels } from "../../../src/prismic/models/local.js";

let dir: string;

async function writeJson(rel: string, value: unknown): Promise<void> {
  const full = join(dir, rel);
  await mkdir(join(full, ".."), { recursive: true });
  await writeFile(full, JSON.stringify(value, null, "\t") + "\n");
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "prismic-local-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("localModels", () => {
  it("reads custom types from customtypes/<dir>/index.json", async () => {
    await writeJson("customtypes/page/index.json", { id: "page", label: "Page" });
    const models = await localModels(dir, ["./src/lib/slices"]);
    expect(models).toEqual([
      {
        kind: "customtype",
        id: "page",
        model: { id: "page", label: "Page" },
        path: "customtypes/page/index.json",
      },
    ]);
  });

  // The slice DIRECTORY name is PascalCase and does NOT match the model id
  // (gallerysonder's ContentWidthMedia holds id "video_block"). Keying on the
  // directory would produce ids Prismic has never heard of.
  it("keys a slice by its model id, not its directory name", async () => {
    await writeJson("src/lib/slices/ContentWidthMedia/model.json", {
      id: "video_block",
      type: "SharedSlice",
    });
    const models = await localModels(dir, ["./src/lib/slices"]);
    expect(models[0]).toMatchObject({
      kind: "slice",
      id: "video_block",
      path: "src/lib/slices/ContentWidthMedia/model.json",
    });
  });

  it("returns customtypes and slices together", async () => {
    await writeJson("customtypes/page/index.json", { id: "page" });
    await writeJson("src/lib/slices/Hero/model.json", { id: "hero", type: "SharedSlice" });
    const models = await localModels(dir, ["./src/lib/slices"]);
    expect(models.map((m) => `${m.kind}:${m.id}`).sort()).toEqual([
      "customtype:page",
      "slice:hero",
    ]);
  });

  it("returns [] for a repo with neither directory", async () => {
    expect(await localModels(dir, ["./src/lib/slices"])).toEqual([]);
  });

  // alamo-anatomy's config points at a slice directory that does not exist.
  it("tolerates a configured library directory that is missing", async () => {
    await writeJson("customtypes/page/index.json", { id: "page" });
    const models = await localModels(dir, ["./src/lib/nowhere"]);
    expect(models.map((m) => m.id)).toEqual(["page"]);
  });

  it("skips a subdirectory with no model file rather than failing", async () => {
    await mkdir(join(dir, "src/lib/slices/NotASlice"), { recursive: true });
    await writeJson("src/lib/slices/Hero/model.json", { id: "hero", type: "SharedSlice" });
    expect((await localModels(dir, ["./src/lib/slices"])).map((m) => m.id)).toEqual(["hero"]);
  });

  // A silent skip here is the exact failure class this module exists to prevent:
  // a model that cannot be read looks identical to a model that does not exist,
  // and CI would then report "in sync" while the field was missing remotely.
  it("THROWS on malformed model JSON, naming the file", async () => {
    await mkdir(join(dir, "customtypes/page"), { recursive: true });
    await writeFile(join(dir, "customtypes/page/index.json"), "{ nope");
    await expect(localModels(dir, [])).rejects.toThrow(/customtypes\/page\/index\.json/);
  });

  it("THROWS when a model file has no string id", async () => {
    await writeJson("customtypes/page/index.json", { label: "Page" });
    await expect(localModels(dir, [])).rejects.toThrow(/id/);
  });

  it("reads multiple libraries", async () => {
    await writeJson("src/lib/slices/Hero/model.json", { id: "hero", type: "SharedSlice" });
    await writeJson("src/lib/blux/Band/model.json", { id: "blux_band", type: "SharedSlice" });
    const ids = (await localModels(dir, ["./src/lib/slices", "./src/lib/blux"])).map((m) => m.id);
    expect(ids.sort()).toEqual(["blux_band", "hero"]);
  });

  // Two directories CAN declare the same model id — the slice directory name and
  // the model `id` are independent (gallerysonder's `ContentWidthMedia/` holds
  // `video_block`), so nothing on disk prevents a collision. Left undetected it
  // is a silent, nondeterministic push: `diffModels` processes both entries
  // independently, one can land in `unchanged` while the other lands in
  // `toUpdate` against the SAME remote model, and the push sends whichever came
  // later in directory-read order. Detected here rather than papered over in
  // `diffModels`, because the operator has a real problem only they can fix.
  it("THROWS on two local files declaring the same id, naming BOTH paths", async () => {
    await writeJson("src/lib/slices/Hero/model.json", { id: "hero", type: "SharedSlice" });
    await writeJson("src/lib/slices/HeroLegacy/model.json", { id: "hero", type: "SharedSlice" });
    const err = await localModels(dir, ["./src/lib/slices"]).catch((e: Error) => e);
    expect((err as Error).message).toContain("src/lib/slices/Hero/model.json");
    expect((err as Error).message).toContain("src/lib/slices/HeroLegacy/model.json");
    expect((err as Error).message).toMatch(/duplicate/i);
  });

  // A custom type and a slice sharing an id is LEGAL — different Types API
  // collections — and `diffModels` already keys on kind+id. Only same-kind
  // collisions are an error.
  it("allows a customtype and a slice to share an id", async () => {
    await writeJson("customtypes/hero/index.json", { id: "hero" });
    await writeJson("src/lib/slices/Hero/model.json", { id: "hero", type: "SharedSlice" });
    const models = await localModels(dir, ["./src/lib/slices"]);
    expect(models.map((m) => m.kind).sort()).toEqual(["customtype", "slice"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/prismic/models/local.test.ts`
Expected: FAIL — cannot resolve `../../../src/prismic/models/local.js`

- [ ] **Step 3: Write minimal implementation**

```ts
// src/prismic/models/local.ts
import { readdir, readFile } from "node:fs/promises";
import { join, posix, relative, sep } from "node:path";
import type { LocalEntry, ModelKind, PrismicModel } from "./types.js";

/** Repo-relative, forward-slashed — the form used in PR comments and passed to
 *  the target repo's prettier, both of which are POSIX-shaped even on Windows. */
const relPath = (repoRoot: string, full: string): string =>
  relative(repoRoot, full).split(sep).join(posix.sep);

/** Parse one model file. Throws (never skips) on unreadable/malformed content or
 *  a missing id: a model that cannot be read is INDISTINGUISHABLE from a model
 *  that does not exist, and a silent skip would let CI report "in sync" while a
 *  field was actually missing in Prismic — the five-field drop this pipeline
 *  exists to prevent. */
async function readModel(repoRoot: string, full: string, kind: ModelKind): Promise<LocalEntry> {
  const rel = relPath(repoRoot, full);
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(full, "utf-8"));
  } catch (e) {
    throw new Error(`${rel}: ${(e as Error).message}`);
  }
  const model = parsed as Partial<PrismicModel>;
  if (typeof model.id !== "string" || model.id === "") {
    throw new Error(`${rel}: model has no string "id"`);
  }
  return { kind, id: model.id, model: model as PrismicModel, path: rel };
}

/** Directory entries, or [] when the directory does not exist. A configured
 *  library pointing nowhere (alamo-anatomy) must read as EMPTY, not as an error —
 *  it is a config wart, not a broken model. */
async function subdirs(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir, { withFileTypes: true }))
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return [];
  }
}

/** Whether a file exists and is readable as a model — used to skip a stray
 *  subdirectory (a leftover component folder) without failing the run. */
async function exists(full: string): Promise<boolean> {
  try {
    await readFile(full, "utf-8");
    return true;
  } catch {
    return false;
  }
}

/**
 * Every model on disk: custom types from `customtypes/<id>/index.json`, slices
 * from `<library>/<Dir>/model.json` for each configured library.
 *
 * Slices are keyed by the model's own `id`, NOT the directory name — the two
 * differ across the fleet (gallerysonder's `ContentWidthMedia` holds
 * `video_block`), and keying on the directory would send Prismic ids it has
 * never seen.
 */
export async function localModels(repoRoot: string, libraries: string[]): Promise<LocalEntry[]> {
  const out: LocalEntry[] = [];

  const ctRoot = join(repoRoot, "customtypes");
  for (const d of await subdirs(ctRoot)) {
    const full = join(ctRoot, d, "index.json");
    if (await exists(full)) out.push(await readModel(repoRoot, full, "customtype"));
  }

  for (const lib of libraries) {
    const libRoot = join(repoRoot, lib);
    for (const d of await subdirs(libRoot)) {
      const full = join(libRoot, d, "model.json");
      if (await exists(full)) out.push(await readModel(repoRoot, full, "slice"));
    }
  }

  assertNoDuplicateIds(out);
  return out;
}

/**
 * Refuse a repo where two files of the SAME kind declare the same model id.
 *
 * This is possible on disk because a slice's directory name and its model `id`
 * are independent — gallerysonder's `ContentWidthMedia/` holds `video_block` —
 * so two directories can quietly claim one id. Undetected, it is a silent and
 * NONDETERMINISTIC push: `diffModels` processes both entries independently, so
 * one can land in `unchanged` while the other lands in `toUpdate` against the
 * same remote model, and the push sends whichever `readdir` happened to yield
 * last. That is the silent-divergence class this module exists to prevent, so
 * it fails loudly here instead of being papered over in `diffModels` — the
 * collision is a real problem in the repo and only a human can say which file
 * is the intended one.
 *
 * Same id across DIFFERENT kinds is legal (custom types and slices are separate
 * Types API collections, and `diffModels` keys on kind+id), so the check is
 * scoped by kind.
 */
function assertNoDuplicateIds(entries: LocalEntry[]): void {
  const seen = new Map<string, string>();
  for (const e of entries) {
    const k = `${e.kind}:${e.id}`;
    const first = seen.get(k);
    if (first !== undefined) {
      throw new Error(
        `duplicate ${e.kind} id "${e.id}": declared by both ${first} and ${e.path}. ` +
          `Two files cannot own one model — delete or rename one.`,
      );
    }
    seen.set(k, e.path);
  }
}

/**
 * Refuse a slice model whose variation lacks a string `id`.
 *
 * The Types API cannot accept such a model, so this is a load-time rejection of
 * something that would fail on push anyway — but failing HERE names the file,
 * while failing there returns an opaque 422. It also protects the review gate:
 * `describeDiff` keys variations by id, so two id-less variations would collide
 * and the second one's field changes would silently never be compared. Measured
 * 2026-08-12: all 183 variations across the fleet's 131 in-scope slice models
 * carry an `id`, so this is defensive, not a live repair.
 */
function assertVariationsHaveIds(entries: LocalEntry[]): void {
  for (const e of entries) {
    const variations = e.model.variations;
    if (!Array.isArray(variations)) continue;
    variations.forEach((v, i) => {
      const id = (v as { id?: unknown } | null)?.id;
      if (typeof id !== "string" || id === "") {
        throw new Error(
          `${e.path}: variation at index ${i} has no string "id". ` +
            `Prismic rejects such a model, and the diff cannot describe it.`,
        );
      }
    });
  }
}
```

Call both from `localModels` before returning:

```ts
assertNoDuplicateIds(out);
assertVariationsHaveIds(out);
return out;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/prismic/models/local.test.ts`
Expected: PASS — 9 tests

- [ ] **Step 5: Commit**

```bash
git add src/prismic/models/local.ts tests/prismic/models/local.test.ts
git commit -m "feat(prismic): localModels reads customtypes + every configured slice library"
```

---

### Task 9: `remoteModels()` and `sendModel()` — the Types API

**Files:**

- Create: `src/prismic/models/remote.ts`
- Test: `tests/prismic/models/remote.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/prismic/models/remote.test.ts
import { describe, it, expect, vi } from "vitest";
import { CUSTOM_TYPES_API, remoteModels, sendModel } from "../../../src/prismic/models/remote.js";

const ok = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

// Every fake below declares the real fetch parameters even when it ignores them.
// `vi.fn(async () => …)` infers a ZERO-ARG signature, so a later
// `mock.calls[0] as [string, RequestInit]` is a type error — which vitest will
// not tell you, because vitest does not typecheck. The suite goes green while
// the file compiles nowhere. See the verification note at the top of this plan;
// this is the second time that trap has been hit.
type FetchFake = (url: string | URL, init?: RequestInit) => Promise<Response>;

describe("remoteModels", () => {
  it("GETs both collections and tags each entry with its kind", async () => {
    const fetchImpl = vi.fn(async (url: string | URL) =>
      String(url).endsWith("/customtypes")
        ? ok([{ id: "page", label: "Page" }])
        : ok([{ id: "hero", type: "SharedSlice" }]),
    );
    const models = await remoteModels("espada", "tok", fetchImpl as unknown as typeof fetch);
    expect(models.map((m) => `${m.kind}:${m.id}`).sort()).toEqual([
      "customtype:page",
      "slice:hero",
    ]);
  });

  it("sends the repository header and a bearer token, never a query string", async () => {
    const fetchImpl = vi.fn(async () => ok([]));
    await remoteModels("espada", "tok", fetchImpl as unknown as typeof fetch);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${CUSTOM_TYPES_API}/customtypes`);
    expect((init.headers as Record<string, string>).repository).toBe("espada");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
  });

  // The historical 403 that produced the "types can only push via Slice Machine"
  // rule was ONE stale token, not the API. The message has to say which, or the
  // next person re-derives the wrong conclusion.
  it("throws a message naming the status and repository on a 403", async () => {
    const fetchImpl = vi.fn(
      async () => new Response("explicit deny in an identity-based policy", { status: 403 }),
    );
    await expect(
      remoteModels("gallerysonder", "stale", fetchImpl as unknown as typeof fetch),
      // NOT `/403.*gallerysonder/s` — that silently also asserts ORDER, and the
      // implementation puts the repository BEFORE the status. Assert each token
      // independently, or the test fails against correct code for a reason that
      // has nothing to do with what it is testing.
    ).rejects.toThrow(/403/);
  });

  it("throws when the body is not an array", async () => {
    const fetchImpl = vi.fn(async () => ok({ notAnArray: true }));
    await expect(
      remoteModels("espada", "tok", fetchImpl as unknown as typeof fetch),
    ).rejects.toThrow(/expected an array/);
  });

  // An earlier draft SKIPPED an id-less remote entry. That is the absent-vs-
  // unreadable collapse on the remote side, and it is the dangerous direction:
  // a dropped remote entry makes its local counterpart look like `toCreate`, so
  // `--apply` pushes over a model that already exists, and a dropped entry with
  // no local counterpart never reaches `remoteOnly` — it becomes invisible to
  // the one bucket whose entire job is to report what only exists in Prismic.
  it("THROWS on a remote entry with no string id rather than dropping it", async () => {
    const fetchImpl = vi.fn(async (url: string | URL) =>
      String(url).endsWith("/customtypes") ? ok([{ label: "no id" }, { id: "page" }]) : ok([]),
    );
    await expect(
      remoteModels("espada", "tok", fetchImpl as unknown as typeof fetch),
    ).rejects.toThrow(/no string "id"/);
  });

  // The two tests below exist to stop anyone adding a catch. Neither failure can
  // be allowed to become an empty array: `remoteModels` returning [] means "this
  // Prismic repository has no models", which sends every local model to
  // `toCreate` and, in --apply, pushes the whole model set at a live repository.
  // An expired token is the likely real-world trigger and Prismic's token expiry
  // is undocumented.
  it("propagates a network-level fetch rejection (never returns [])", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    await expect(
      remoteModels("espada", "tok", fetchImpl as unknown as typeof fetch),
    ).rejects.toThrow(/fetch failed/);
  });

  it("throws when a 200 body is not JSON at all", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response("<html>gateway timeout</html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        }),
    );
    await expect(
      remoteModels("espada", "tok", fetchImpl as unknown as typeof fetch),
    ).rejects.toThrow(/customtypes/);
  });
});

describe("sendModel", () => {
  it("POSTs a customtype insert to /customtypes/insert", async () => {
    const fetchImpl = vi.fn(async () => new Response("", { status: 201 }));
    await sendModel(
      "espada",
      "tok",
      { kind: "customtype", id: "page", model: { id: "page" } },
      "insert",
      fetchImpl as unknown as typeof fetch,
    );
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${CUSTOM_TYPES_API}/customtypes/insert`);
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ id: "page" });
  });

  it("POSTs a slice update to /slices/update", async () => {
    // `new Response("", { status: 204 })` THROWS — 204 is a null-body status and
    // the Response constructor rejects a body for it. The fake would never be
    // constructed and the failure surfaces from inside the code under test, as
    // if the request had failed. 204 is what the Types API really answers to an
    // update, so the fake has to be buildable: pass null, not "".
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 }));
    await sendModel(
      "espada",
      "tok",
      { kind: "slice", id: "hero", model: { id: "hero" } },
      "update",
      fetchImpl as unknown as typeof fetch,
    );
    expect((fetchImpl.mock.calls[0] as [string, RequestInit])[0]).toBe(
      `${CUSTOM_TYPES_API}/slices/update`,
    );
  });

  it("throws with the API's own message on a non-2xx", async () => {
    const fetchImpl = vi.fn(
      async () => new Response("slice hero references unknown field", { status: 422 }),
    );
    await expect(
      sendModel(
        "espada",
        "tok",
        { kind: "slice", id: "hero", model: { id: "hero" } },
        "update",
        fetchImpl as unknown as typeof fetch,
      ),
    ).rejects.toThrow(/422.*unknown field/s);
  });

  it("has no delete function at all", async () => {
    const mod = await import("../../../src/prismic/models/remote.js");
    expect(Object.keys(mod).some((k) => /delete|remove|destroy/i.test(k))).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/prismic/models/remote.test.ts`
Expected: FAIL — cannot resolve `../../../src/prismic/models/remote.js`

- [ ] **Step 3: Write minimal implementation**

```ts
// src/prismic/models/remote.ts
//
// The Prismic Custom Types API — the capability this whole design rests on, and
// the one that was believed impossible. Proven 2026-08-12: GET /customtypes and
// GET /slices returned 200 across five fleet repositories, POST
// /customtypes/insert returned 201 on the-pinnacle, and the historical 403 that
// produced the standing "types can only push via Slice Machine" rule reproduced
// on exactly ONE stale token (gallerysonder / reddoor-la) — a property of that
// credential, not of the API.
//
// There is deliberately NO delete function in this module. The API supports
// DELETE /customtypes/{id} (verified 204, zero residue), but a stale local
// checkout must never be able to remove a live content model, and the surest
// way to guarantee that is for the capability not to exist in the code at all.
// Deleting a model is an operator action taken in the Prismic dashboard.
import type { LocalEntry, ModelKind, PrismicModel, RemoteEntry } from "./types.js";

export const CUSTOM_TYPES_API = "https://customtypes.prismic.io";

/** Types API collection path for each model kind. */
const COLLECTION: Record<ModelKind, string> = { customtype: "customtypes", slice: "slices" };

const authHeaders = (repo: string, token: string): Record<string, string> => ({
  repository: repo,
  Authorization: `Bearer ${token}`,
});

async function getCollection(
  repo: string,
  token: string,
  kind: ModelKind,
  fetchImpl: typeof fetch,
): Promise<RemoteEntry[]> {
  const url = `${CUSTOM_TYPES_API}/${COLLECTION[kind]}`;
  const res = await fetchImpl(url, { headers: authHeaders(repo, token) });
  if (!res.ok) {
    // Name the status AND the repository: the one failure mode seen in the wild
    // is a stale/wrong token, and "403" alone is what got generalised last time
    // into "the API does not allow this". The status is also attached to the
    // Error object itself (not just interpolated into the message) so a caller
    // can tell a dead token (401/403 — fix the secret) apart from a rejected
    // model (422 — fix the model) without parsing text. Same idiom used
    // elsewhere in this codebase: `Object.assign(new Error(...), { exitCode })`.
    throw Object.assign(
      new Error(
        `GET ${url} [repository: ${repo}] -> ${res.status} ${(await res.text()).slice(0, 200)}`,
      ),
      { status: res.status },
    );
  }
  // A 200 whose body is not JSON (an HTML error page from a proxy, a truncated
  // response) must not surface as an opaque SyntaxError with no context. Wrapped,
  // never caught-and-defaulted — see the absent-vs-unreadable rule at the top of
  // this plan.
  let body: unknown;
  try {
    body = await res.json();
  } catch (e) {
    throw new Error(`GET ${url}: 200 but the body did not parse as JSON`, { cause: e });
  }
  if (!Array.isArray(body)) throw new Error(`GET ${url}: expected an array, got ${typeof body}`);
  return body.map((m, i) => {
    // THROW, never drop. Dropping an id-less remote entry is the absent-vs-
    // unreadable collapse pointed at the remote set, and it fails in the
    // destructive direction: the local counterpart then looks like `toCreate`
    // and --apply pushes over a model Prismic already holds, while an entry with
    // no local counterpart never reaches `remoteOnly` at all — invisible to the
    // one bucket that exists to report Prismic-only models.
    //
    // The trade is deliberate: a malformed entry fails this site's whole check
    // rather than silently corrupting it. Prismic has never returned such an
    // entry across the fleet; if it ever does, that is a real event an operator
    // needs to see, not one to route around.
    const id = (m as { id?: unknown } | null)?.id;
    if (typeof id !== "string" || id === "") {
      throw new Error(`GET ${url}: entry at index ${i} has no string "id"`);
    }
    return { kind, id, model: m as PrismicModel };
  });
}

/** Every model registered in one Prismic repository, both collections. */
export async function remoteModels(
  repo: string,
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<RemoteEntry[]> {
  const customtypes = await getCollection(repo, token, "customtype", fetchImpl);
  const slices = await getCollection(repo, token, "slice", fetchImpl);
  return [...customtypes, ...slices];
}

/** Create or REPLACE one model in Prismic. `update` replaces the whole model —
 *  which is why callers must send `withRemoteScreenshots(local, remote)` rather
 *  than the raw file on disk. */
export async function sendModel(
  repo: string,
  token: string,
  entry: Pick<LocalEntry, "kind" | "id" | "model">,
  action: "insert" | "update",
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const url = `${CUSTOM_TYPES_API}/${COLLECTION[entry.kind]}/${action}`;
  const res = await fetchImpl(url, {
    method: "POST",
    headers: { ...authHeaders(repo, token), "Content-Type": "application/json" },
    body: JSON.stringify(entry.model),
  });
  if (!res.ok) {
    // Same reasoning as getCollection above: attach `status` to the Error so
    // pushModels can distinguish a dead write token from a bad model.
    throw Object.assign(
      new Error(
        `POST ${url} [${entry.kind} ${entry.id}] -> ${res.status} ${(await res.text()).slice(0, 300)}`,
      ),
      { status: res.status },
    );
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/prismic/models/remote.test.ts && pnpm typecheck`
Expected: PASS — 11 tests, typecheck clean

- [ ] **Step 5: Commit**

```bash
git add src/prismic/models/remote.ts tests/prismic/models/remote.test.ts
git commit -m "feat(prismic): Types API reads + insert/update, with no delete path at all"
```

---

### Task 10: `pushModels()` — ordering and the never-delete invariant

**Files:**

- Create: `src/prismic/models/push.ts`
- Test: `tests/prismic/models/push.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/prismic/models/push.test.ts
import { describe, it, expect, vi } from "vitest";
import { pushModels } from "../../../src/prismic/models/push.js";
import type {
  LocalEntry,
  ModelDiff,
  ModelKind,
  RemoteEntry,
} from "../../../src/prismic/models/types.js";

const localEntry = (kind: ModelKind, id: string): LocalEntry => ({
  kind,
  id,
  model: { id },
  path: `${kind}/${id}`,
});
const remoteEntry = (kind: ModelKind, id: string): RemoteEntry => ({
  kind,
  id,
  model: { id },
});

const emptyDiff = (): ModelDiff => ({ toCreate: [], toUpdate: [], unchanged: [], remoteOnly: [] });

describe("pushModels", () => {
  it("sends nothing when apply is false, but still reports what it would send", async () => {
    const send = vi.fn();
    const diff = emptyDiff();
    diff.toCreate.push(localEntry("slice", "hero"));
    const report = await pushModels(diff, { apply: false, send });
    expect(send).not.toHaveBeenCalled();
    expect(report.mode).toBe("dry");
    expect(report.sent).toEqual([{ kind: "slice", id: "hero", action: "insert" }]);
  });

  // page's `slices` field references blux_* slice ids; a custom type whose
  // referenced slice is not yet registered is rejected. The reconciliation run
  // pushed 11 slices before 6 types on the-tower-burbank for exactly this reason.
  it("sends ALL slices before ANY custom type", async () => {
    const order: string[] = [];
    const send = vi.fn(async (e: LocalEntry) => {
      order.push(`${e.kind}:${e.id}`);
    });
    const diff = emptyDiff();
    diff.toCreate.push(localEntry("customtype", "page"), localEntry("slice", "blux_band"));
    diff.toUpdate.push({
      local: localEntry("customtype", "blog"),
      remote: remoteEntry("customtype", "blog"),
    });
    diff.toUpdate.push({
      local: localEntry("slice", "hero"),
      remote: remoteEntry("slice", "hero"),
    });
    await pushModels(diff, { apply: true, send });
    expect(order.slice(0, 2).every((k) => k.startsWith("slice:"))).toBe(true);
    expect(order.slice(2).every((k) => k.startsWith("customtype:"))).toBe(true);
  });

  it("uses insert for toCreate and update for toUpdate", async () => {
    const send = vi.fn();
    const diff = emptyDiff();
    diff.toCreate.push(localEntry("slice", "new_one"));
    diff.toUpdate.push({
      local: localEntry("slice", "old_one"),
      remote: remoteEntry("slice", "old_one"),
    });
    const report = await pushModels(diff, { apply: true, send });
    expect(report.sent).toEqual([
      { kind: "slice", id: "new_one", action: "insert" },
      { kind: "slice", id: "old_one", action: "update" },
    ]);
  });

  it("passes the remote copy so screenshots survive an update", async () => {
    const send = vi.fn();
    const local = localEntry("slice", "hero");
    const remote = { ...remoteEntry("slice", "hero"), model: { id: "hero", variations: [] } };
    const diff = emptyDiff();
    diff.toUpdate.push({ local, remote });
    await pushModels(diff, { apply: true, send });
    expect(send.mock.calls[0]![1]).toBe(remote.model);
  });

  // THE safety property: nothing in this function can act on a remote-only
  // model. `remoteOnly` lives on the diff, not the report — a caller who
  // needs to know which models are remote-only reads it there.
  it("never sends anything for a remote-only model", async () => {
    const send = vi.fn();
    const diff = emptyDiff();
    diff.remoteOnly.push(remoteEntry("customtype", "frozen_page"));
    await pushModels(diff, { apply: true, send });
    expect(send).not.toHaveBeenCalled();
    expect(diff.remoteOnly.map((e) => e.id)).toEqual(["frozen_page"]);
  });

  it("records a per-model failure and KEEPS GOING", async () => {
    const send = vi.fn(async (e: LocalEntry) => {
      if (e.id === "bad") throw new Error("422 unprocessable");
    });
    const diff = emptyDiff();
    diff.toCreate.push(localEntry("slice", "bad"), localEntry("slice", "good"));
    const report = await pushModels(diff, { apply: true, send });
    expect(report.failed).toEqual([{ kind: "slice", id: "bad", error: "422 unprocessable" }]);
    expect(report.sent.map((s) => s.id)).toEqual(["good"]);
  });

  it("does not record a failed model as sent", async () => {
    const send = vi.fn(async () => {
      throw new Error("boom");
    });
    const diff = emptyDiff();
    diff.toCreate.push(localEntry("slice", "hero"));
    const report = await pushModels(diff, { apply: true, send });
    expect(report.sent).toEqual([]);
  });

  // A cross-function invariant that otherwise lives only in someone's head.
  // `withRemoteScreenshots` ALTERS 179/179 real slice models that `diffModels`
  // classifies as `unchanged` — an imageUrl-only difference is exactly what
  // `canon` ignores and exactly what that function rewrites. That is harmless
  // ONLY because `unchanged` is never pushed. If a future refactor ever routed
  // `unchanged` through the send path, every slice in the fleet would be
  // rewritten on every run for no reason. Pin it.
  it("never sends an unchanged model", async () => {
    const send = vi.fn();
    const diff = emptyDiff();
    diff.unchanged.push(localEntry("slice", "hero"), localEntry("customtype", "page"));
    const report = await pushModels(diff, { apply: true, send });
    expect(send).not.toHaveBeenCalled();
    expect(report.sent).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/prismic/models/push.test.ts`
Expected: FAIL — cannot resolve `../../../src/prismic/models/push.js`

- [ ] **Step 3: Write minimal implementation**

```ts
// src/prismic/models/push.ts
import { withRemoteScreenshots } from "./diff.js";
import type { LocalEntry, ModelDiff, PrismicModel, PushReport } from "./types.js";

/** Sends one model. Injected so `pushModels` stays testable and so the fetch
 *  layer, not this one, owns credentials. */
export type SendFn = (
  entry: LocalEntry,
  remote: PrismicModel | undefined,
  action: "insert" | "update",
) => Promise<void>;

export type PushOptions = {
  /** false = dry run: compute and report, send nothing. */
  apply: boolean;
  send: SendFn;
  /**
   * There is no `true`. The type is `false | undefined` on purpose: a stale
   * local checkout must never be able to remove a live content model, and the
   * compiler is a better guarantee of that than a comment. `remoteOnly` models
   * are reported for a human; deleting one is a dashboard action.
   */
  allowDelete?: false;
};

/**
 * Apply a diff to Prismic.
 *
 * ORDER MATTERS: every slice goes before every custom type. A custom type's
 * `slices` field references slice ids by name, and Prismic rejects a type
 * referencing a slice it does not yet hold — the-tower-burbank's reconciliation
 * pushed 11 slices before 6 types for exactly this reason.
 *
 * FAILURE IS PER-MODEL: one rejected model is recorded and the run continues,
 * so a single bad model cannot silently strand the rest of a merge's changes
 * half-applied with no report of which half.
 */
export async function pushModels(diff: ModelDiff, opts: PushOptions): Promise<PushReport> {
  const work: Array<{
    entry: LocalEntry;
    remote: PrismicModel | undefined;
    action: "insert" | "update";
  }> = [
    ...diff.toCreate.map((entry) => ({ entry, remote: undefined, action: "insert" as const })),
    ...diff.toUpdate.map(({ local, remote }) => ({
      entry: local,
      remote: remote.model,
      action: "update" as const,
    })),
  ];
  // Slices first — see the ORDER MATTERS note above.
  work.sort((a, b) => (a.entry.kind === b.entry.kind ? 0 : a.entry.kind === "slice" ? -1 : 1));

  const report: PushReport = { mode: opts.apply ? "apply" : "dry", sent: [], failed: [] };

  for (const { entry, remote, action } of work) {
    if (!opts.apply) {
      report.sent.push({ kind: entry.kind, id: entry.id, action });
      continue;
    }
    try {
      await opts.send(
        { ...entry, model: withRemoteScreenshots(entry.model, remote) },
        remote,
        action,
      );
      report.sent.push({ kind: entry.kind, id: entry.id, action });
    } catch (e) {
      // Carry the HTTP status (when there is one) so a caller can tell a dead
      // write token (401/403 — fix the secret) apart from a rejected model
      // (422 — fix the model). The nightly sweep must not conflate the two.
      const err = e as Error & { status?: number };
      report.failed.push({
        kind: entry.kind,
        id: entry.id,
        error: err.message,
        ...(err.status !== undefined ? { status: err.status } : {}),
      });
    }
  }
  return report;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/prismic/models/push.test.ts`
Expected: PASS — 7 tests

- [ ] **Step 5: Commit**

```bash
git add src/prismic/models/push.ts tests/prismic/models/push.test.ts
git commit -m "feat(prismic): pushModels sends slices before types and cannot delete"
```

---

### Task 11: `writeModelFile()` — pull-down through the target repo's prettier

**Files:**

- Create: `src/prismic/models/write.ts`
- Test: `tests/prismic/models/write.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/prismic/models/write.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeModelFile, modelFilePath } from "../../../src/prismic/models/write.js";
import type { RemoteEntry } from "../../../src/prismic/models/types.js";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "prismic-write-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("modelFilePath", () => {
  it("puts a custom type at customtypes/<id>/index.json", () => {
    expect(
      modelFilePath(
        { kind: "customtype", id: "frozen_page", model: { id: "frozen_page" } },
        "./src/lib/slices",
      ),
    ).toBe("customtypes/frozen_page/index.json");
  });

  // Slice Machine's on-disk convention is a PascalCase directory. Deriving it
  // from the id is the only option for a model that exists ONLY in Prismic —
  // there is no local directory to reuse.
  it("puts a slice at <library>/<PascalCaseId>/model.json", () => {
    expect(
      modelFilePath(
        { kind: "slice", id: "video_block", model: { id: "video_block" } },
        "./src/lib/slices",
      ),
    ).toBe("src/lib/slices/VideoBlock/model.json");
  });

  it("handles an id that is already one word", () => {
    expect(
      modelFilePath({ kind: "slice", id: "hero", model: { id: "hero" } }, "./src/lib/slices"),
    ).toBe("src/lib/slices/Hero/model.json");
  });
});

describe("writeModelFile", () => {
  const entry: RemoteEntry = {
    kind: "customtype",
    id: "frozen_page",
    model: { id: "frozen_page", label: "Frozen" },
  };

  it("creates the directory and writes parseable JSON", async () => {
    const spawn = vi.fn(async () => ({ code: 0, stdout: "", stderr: "" }));
    const res = await writeModelFile(spawn, dir, entry, "./src/lib/slices");
    expect(res.path).toBe("customtypes/frozen_page/index.json");
    expect(JSON.parse(await readFile(join(dir, res.path), "utf-8"))).toEqual({
      id: "frozen_page",
      label: "Frozen",
    });
  });

  // THE TRAP. The first pull-down PR failed CI on `prettier --check` for
  // customtypes/frozen_page/index.json while catalog_page/index.json — generated
  // by the identical code path in the same run — passed. Formatting is
  // content-dependent, so no canonical JSON.stringify shape is safe. The fleet is
  // useTabs:true and prettier is enforced on every file in CI.
  it("formats the written file with the TARGET REPO's own prettier", async () => {
    const spawn = vi.fn(async () => ({ code: 0, stdout: "", stderr: "" }));
    await writeModelFile(spawn, dir, entry, "./src/lib/slices");
    expect(spawn).toHaveBeenCalledWith(
      "pnpm",
      ["exec", "prettier", "--write", "customtypes/frozen_page/index.json"],
      { cwd: dir },
    );
  });

  it("reports formatted:false (never throws) when prettier is unavailable", async () => {
    const spawn = vi.fn(async () => {
      throw new Error("ENOENT pnpm");
    });
    const res = await writeModelFile(spawn, dir, entry, "./src/lib/slices");
    expect(res.formatted).toBe(false);
    expect(JSON.parse(await readFile(join(dir, res.path), "utf-8"))).toMatchObject({
      id: "frozen_page",
    });
  });

  it("reports formatted:true on a clean prettier run", async () => {
    const spawn = vi.fn(async () => ({ code: 0, stdout: "", stderr: "" }));
    expect((await writeModelFile(spawn, dir, entry, "./src/lib/slices")).formatted).toBe(true);
  });

  it("writes tab-indented JSON with a trailing newline as the pre-prettier baseline", async () => {
    const spawn = vi.fn(async () => ({ code: 0, stdout: "", stderr: "" }));
    const res = await writeModelFile(spawn, dir, entry, "./src/lib/slices");
    const raw = await readFile(join(dir, res.path), "utf-8");
    expect(raw).toContain("\n\t");
    expect(raw.endsWith("\n")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/prismic/models/write.test.ts`
Expected: FAIL — cannot resolve `../../../src/prismic/models/write.js`

- [ ] **Step 3: Write minimal implementation**

```ts
// src/prismic/models/write.ts
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, posix, sep } from "node:path";
import type { SpawnFn } from "../../audits/util/spawn.js";
import { formatWithPrettier } from "../../recipes/_prettier.js";
import type { RemoteEntry } from "./types.js";

/** `video_block` -> `VideoBlock`. Slice Machine's on-disk directory convention.
 *  A model that exists only in Prismic has no local directory to reuse, so the
 *  name has to be derived. */
const pascal = (id: string): string =>
  id
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join("");

/** Repo-relative path a pulled-down model should live at. */
export function modelFilePath(entry: Pick<RemoteEntry, "kind" | "id">, library: string): string {
  if (entry.kind === "customtype") return posix.join("customtypes", entry.id, "index.json");
  const lib = library.replace(/^\.\//, "").split(sep).join(posix.sep);
  return posix.join(lib, pascal(entry.id), "model.json");
}

export type WriteResult = { path: string; formatted: boolean };

/**
 * Write one model into a repo and format it with THAT repo's own prettier.
 *
 * The formatting step is not cosmetic. The first pull-down PR of the 2026-08-12
 * reconciliation failed CI on `prettier --check` for
 * `customtypes/frozen_page/index.json` while `catalog_page/index.json` —
 * generated by the identical code path in the same run — passed. Prettier's
 * output for JSON is CONTENT-dependent, so there is no canonical
 * `JSON.stringify` shape that is safe fleet-wide; only the target repo's own
 * prettier knows the answer. The fleet is `useTabs: true` and CI runs
 * `prettier --check .` over every file.
 *
 * Formatting is best-effort by contract (`formatWithPrettier` never throws), so
 * the file is always written; `formatted: false` tells the caller to flag the
 * PR for a manual format check rather than losing the model.
 */
export async function writeModelFile(
  spawn: SpawnFn,
  repoRoot: string,
  entry: RemoteEntry,
  library: string,
): Promise<WriteResult> {
  const rel = modelFilePath(entry, library);
  const full = join(repoRoot, rel);
  await mkdir(dirname(full), { recursive: true });
  // Tabs + trailing newline is only a BASELINE that matches the fleet's prettier
  // config closely enough to minimise the rewrite; prettier below is the authority.
  await writeFile(full, JSON.stringify(entry.model, null, "\t") + "\n", "utf-8");
  const formatted = await formatWithPrettier(spawn, repoRoot, [rel]);
  return { path: rel, formatted };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/prismic/models/write.test.ts`
Expected: PASS — 8 tests

- [ ] **Step 5: Commit**

```bash
git add src/prismic/models/write.ts tests/prismic/models/write.test.ts
git commit -m "feat(prismic): pull-down writes go through the target repo's own prettier"
```

---

### Task 12: the module's public surface

**Files:**

- Create: `src/prismic/models/index.ts`
- Test: `tests/prismic/models/index.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/prismic/models/index.test.ts
import { describe, it, expect } from "vitest";
import { readdir, readFile } from "node:fs/promises";
import * as models from "../../../src/prismic/models/index.js";

describe("prismic/models public surface", () => {
  it("exports the comparison core, the adapters, and the push", () => {
    expect(Object.keys(models).sort()).toEqual(
      [
        "CUSTOM_TYPES_API",
        "canon",
        "describeDiff",
        "diffModels",
        "localModels",
        "modelFilePath",
        "prismicTokenEnvName",
        "pushModels",
        "readPrismicConfig",
        "remoteModels",
        "resolvePrismicToken",
        "sameModel",
        "sendModel",
        "withRemoteScreenshots",
        "writeModelFile",
      ].sort(),
    );
  });

  // Tripwire. The Types API can delete (verified 204), and the single most
  // important safety property in this design is that our code cannot. If someone
  // adds one, this test forces the conversation.
  //
  // NAME-BASED ALONE IS NOT A GUARD. The identical assertion in Task 9 was proven
  // insufficient by mutation on 2026-08-12: a reviewer wired a complete, working
  // DELETE into `sendModel` — an extra action in the union plus
  // `method: action === "delete" ? "DELETE" : "POST"` — and the whole suite went
  // green, tsc clean, with the test named "has no delete function at all"
  // reporting PASS. Inspecting exported NAMES cannot see a capability added
  // inside a function that already exists, which is exactly how it would really
  // arrive, because the writing function is already sitting there.
  //
  // So the surface check below is kept for the export-shaped case, and the
  // source-text check beside it covers the inline case. Both are needed; neither
  // is redundant with the other. Do not delete either as duplicative.
  it("exports no delete capability", () => {
    expect(
      Object.keys(models).some((k) => /delete|remove|destroy|purge|drop|unregister/i.test(k)),
    ).toBe(false);
  });

  // THE MODULE-WIDE CAPABILITY GUARD — build it here, once, over every file in
  // `src/prismic/models/`. Do not write a per-file copy anywhere else.
  //
  // Read this history before you touch it. The no-delete guard has now failed
  // THREE times, each fix closing exactly the channel the previous one missed:
  //
  //  1. Task 9 — an exported-NAME check. Blind to a working DELETE added INLINE
  //     inside `sendModel`. The suite went green with the test named "has no
  //     delete function at all" reporting PASS.
  //  2. Task 10 v1 — quoted-verb + STATIC-import check. Blind to
  //     `const { request } = await import("node:https")`, which three
  //     independent review lenses found. `await import()` is this codebase's
  //     dominant lazy-load idiom: 63 call sites across 12 files under `src/`,
  //     26 of them in `src/cli/bin.ts` (AST-counted 2026-08-12).
  //  3. Task 10 v2 — an AST allow-list over `push.ts` only. Correct, and it
  //     survived 12 attack shapes, but it left ONE hop: `./diff.js` is
  //     allow-listed, so IO added inside `diff.ts` and reached through
  //     `withRemoteScreenshots` looks clean from `push.ts`, and `diff.ts` had no
  //     guard of its own.
  //  4. Task 11 — an AST allow-list over SPECIFIERS. Defeated by
  //     `const { rm } = await import("node:fs/promises")`, which is a working
  //     recursive+force delete inside the very module that exists because
  //     remote-only models may never be deleted. The specifier walk DID see the
  //     dynamic import — and recorded `"node:fs/promises"`, which is ALREADY
  //     ALLOWED (the module legitimately needs mkdir/readFile/writeFile), so
  //     `new Set(...)` deduped it away. The bindings walk only inspected
  //     `ts.isImportDeclaration` nodes, so it never saw `rm` at all. Both
  //     assertions reported PASS.
  //
  // The pattern in the first three is the same and it is the first lesson:
  // **each fix was a DENY-LIST**, enumerating forbidden channels, and a new
  // channel always existed. Enumerating what is forbidden is unwinnable.
  // Enumerate what is ALLOWED instead, over the whole module at once, so there
  // is no seam between two guards and no unguarded file to hop to.
  //
  // The fourth adds the sharper lesson: **allow-listing the SOURCE is not
  // allow-listing the CAPABILITY.** `node:fs/promises` must stay allowed, so an
  // allow-list of specifiers can never express "may read and write files, may
  // not delete them". The allow-list has to be over the BINDINGS actually
  // obtained — by every mechanism, including destructuring from a dynamic
  // import, member access on a namespace import, and aliasing. A binding
  // obtained by a mechanism the walk cannot statically resolve must FAIL, never
  // be skipped.
  //
  // Parse with the TypeScript AST, not regex. That is load-bearing, not
  // stylistic: this guard has to QUOTE the constructs it forbids in order to
  // explain itself, and a Task 10 draft had already dropped a `request\(` check
  // because it tripped over its own prose. Syntax nodes cannot see inside a
  // comment. `remote.ts`'s header legitimately contains `DELETE
  // /customtypes/{id}` — that sentence is the REASON this rule exists and must
  // stay readable, so a text ban would fail on the commit that introduced it.
  //
  // Requirements, all of which earned their place by catching something:
  //
  //  a. Extract every module specifier by EVERY mechanism — static and bare
  //     `import`, `export … from`, dynamic `import()`, `import x = require()`,
  //     `typeof import()`, `require`, `createRequire` — for every `.ts` file in
  //     the directory. Each must appear in one explicit allow-list. A
  //     non-literal specifier (`import(someVar)`) is UNRESOLVABLE and must fail,
  //     never be skipped.
  //  a2. And extract every BINDING obtained from those specifiers, by every
  //     mechanism — named import, default, namespace member access, aliasing,
  //     and destructuring from a dynamic `import()`. Allow-list the bindings per
  //     specifier: `node:fs/promises` may yield `mkdir`, `readFile`,
  //     `writeFile`, `rename` — and NOT `rm`, `rmdir`, `unlink`, or `truncate`.
  //     This is the requirement that failure 4 proves cannot be skipped: the
  //     specifier list alone can never express "may write, may not delete",
  //     because the module genuinely needs that specifier. A binding whose
  //     origin the walk cannot resolve must FAIL.
  //  b. Run an INDEPENDENT token census for `import`/`require`. If the node walk
  //     recognised fewer than the tokens present, fail — that is a hole in the
  //     extractor, and it must fail as a hole rather than pass as a clean file.
  //  c. FAIL CLOSED. Assert a non-zero file count, a non-zero specifier count
  //     and a non-zero token count. A guard that silently examines nothing is
  //     worse than no guard.
  //  d. Allow-list FREE IDENTIFIERS, not the roots of call chains. Task 10 found
  //     this hole in its own first draft: `(0, eval)("…")` has a parenthesised
  //     comma expression as its callee, so a root-of-chain walk sees zero roots
  //     and waves it through. Only `remote.ts` may name `fetch`.
  //  e. Every quoted HTTP verb across the module must be GET or POST, and every
  //     `method:` must be the `"POST"` literal — which also closes the
  //     never-write-the-literal walk-around and catches PUT/PATCH.
  //
  // Prove it with mutation, and prove it against the real attack shapes rather
  // than a token one: dynamic import, `createRequire`, bare side-effect import,
  // `import x = require()`, `export * from`, a computed specifier, `new
  // Function()`, `(0, eval)()`, `globalThis.fetch`, `globalThis["fe"+"tch"]`.
  // Keep at least two CONTROLS that must stay green — an extra import of an
  // already-allowed module, and an ordinary local rename. A guard that fires on
  // honest edits gets deleted by the next person in a hurry, and then there is
  // no guard at all.
  //
  // Note this test imports the `typescript` package. It is already a
  // devDependency used by `pnpm typecheck`, but no other test in this repo does
  // that. It is a deliberate, single, module-wide precedent — which is precisely
  // why this lives in ONE test over the whole directory instead of three copies.
  //
  // KNOWN LIMIT — state it, do not paper over it. A source-local guard can only
  // see capabilities the source NAMES. A capability handed in as a PARAMETER is
  // invisible to it: `push.ts` already takes `send` this way, `write.ts` takes
  // `spawn`, and a future `deps: { rm }` would pass every assertion above while
  // carrying a delete straight into the module. Task 11 added a `spawn("rm", …)`
  // sentinel for the loudest version of this, but the general class is not
  // closable by reading this directory's source.
  //
  // What actually bounds it is the injection sites: those parameters are supplied
  // by the CLI command and by tests, both of which are in this repo and both of
  // which are reviewable. So the honest claim this guard makes is "no file in
  // this module ACQUIRES a delete capability", NOT "no delete can occur". Do not
  // let a comment elsewhere upgrade that claim — an overstated guarantee is how
  // the previous four versions of this guard got trusted past what they proved.
  it("grants no file in the module any capability beyond its allow-list", async () => {
    // Implementation is the engineer's, to requirements (a)–(e) above.
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/prismic/models/index.test.ts`
Expected: FAIL — cannot resolve `../../../src/prismic/models/index.js`

- [ ] **Step 3: Write minimal implementation**

```ts
// src/prismic/models/index.ts
export { canon, sameModel } from "./canon.js";
export { describeDiff, diffModels, withRemoteScreenshots } from "./diff.js";
export { readPrismicConfig, type PrismicConfig } from "./config.js";
export { prismicTokenEnvName, resolvePrismicToken, type ResolvedToken } from "./token.js";
export { localModels } from "./local.js";
export { CUSTOM_TYPES_API, remoteModels, sendModel } from "./remote.js";
export { pushModels, type PushOptions, type SendFn } from "./push.js";
export { modelFilePath, writeModelFile, type WriteResult } from "./write.js";
export type {
  LocalEntry,
  ModelDiff,
  ModelKind,
  PrismicModel,
  PushReport,
  RemoteEntry,
} from "./types.js";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/prismic/models/ && pnpm typecheck`
Expected: PASS — all Phase A + B suites green, typecheck clean

- [ ] **Step 5: Commit**

```bash
git add src/prismic/models/index.ts tests/prismic/models/index.test.ts
git commit -m "feat(prismic): export the models module surface, with a no-delete tripwire"
```

---

## Phase C — the CLI command

`reddoor-maint prismic-models [site] [--dry|--apply|--pull|--tokens] [--fleet <inv>] [--workdir <p>] [--write-airtable] [--comment-file <p>]`

Three callers, one command: CI in-repo (`--dry` on a PR, `--apply` on merge), the nightly fleet sweep (`--fleet airtable --write-airtable`), and an operator at a terminal (`--tokens`, `--pull`).

### Task 13: the report renderer (pure)

**Files:**

- Create: `src/cli/commands/prismic-models-report.ts`
- Test: `tests/cli/prismic-models-report.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/cli/prismic-models-report.test.ts
import { describe, it, expect } from "vitest";
import { renderModelReport, isClean } from "../../src/cli/commands/prismic-models-report.js";
import type { ModelDiff } from "../../src/prismic/models/index.js";

const emptyDiff = (): ModelDiff => ({ toCreate: [], toUpdate: [], unchanged: [], remoteOnly: [] });
const localEntry = (
  kind: "customtype" | "slice",
  id: string,
  model: Record<string, unknown> = {},
) => ({
  kind,
  id,
  model: { id, ...model },
  path: `${kind}/${id}`,
});
const remoteEntry = (
  kind: "customtype" | "slice",
  id: string,
  model: Record<string, unknown> = {},
) => ({
  kind,
  id,
  model: { id, ...model },
});

describe("isClean", () => {
  it("is clean when everything is unchanged", () => {
    const d = emptyDiff();
    d.unchanged.push(localEntry("slice", "hero"));
    expect(isClean(d)).toBe(true);
  });

  it("is not clean with a model to create", () => {
    const d = emptyDiff();
    d.toCreate.push(localEntry("slice", "hero"));
    expect(isClean(d)).toBe(false);
  });

  it("is not clean with a model to update", () => {
    const d = emptyDiff();
    d.toUpdate.push({ local: localEntry("slice", "hero"), remote: remoteEntry("slice", "hero") });
    expect(isClean(d)).toBe(false);
  });

  // A remote-only model IS drift. It is the out-of-band cloud edit the nightly
  // check exists to catch, and the silent-field-drop class in reverse.
  it("is not clean with a remote-only model", () => {
    const d = emptyDiff();
    d.remoteOnly.push(remoteEntry("customtype", "frozen_page"));
    expect(isClean(d)).toBe(false);
  });
});

describe("renderModelReport", () => {
  it("says everything matches on a clean diff", () => {
    const d = emptyDiff();
    d.unchanged.push(localEntry("slice", "hero"), localEntry("customtype", "page"));
    const out = renderModelReport("espada", d, { apply: false });
    expect(out).toContain("2 model(s) match Prismic");
    expect(out).not.toContain("REMOTE-ONLY");
  });

  it("lists new models under NEW with their repo path", () => {
    const d = emptyDiff();
    d.toCreate.push(localEntry("slice", "hero"));
    expect(renderModelReport("espada", d, { apply: false })).toContain(
      "NEW  slice hero  (slice/hero)",
    );
  });

  it("lists changed models with their field-level lines", () => {
    const d = emptyDiff();
    d.toUpdate.push({
      local: localEntry("slice", "hero", {
        variations: [{ id: "default", primary: { wash: { type: "Boolean" } } }],
      }),
      remote: remoteEntry("slice", "hero", { variations: [{ id: "default", primary: {} }] }),
    });
    const out = renderModelReport("espada", d, { apply: false });
    expect(out).toContain("CHANGED  slice hero");
    expect(out).toContain("+ default.primary.wash");
  });

  it("lists remote-only models under a REMOTE-ONLY heading that says they are never deleted", () => {
    const d = emptyDiff();
    d.remoteOnly.push(remoteEntry("customtype", "frozen_page"));
    const out = renderModelReport("espada", d, { apply: false });
    expect(out).toContain("REMOTE-ONLY");
    expect(out).toContain("frozen_page");
    expect(out).toMatch(/never deleted/i);
  });

  it("labels a dry run as a dry run and an applied run as pushed", () => {
    const d = emptyDiff();
    d.toCreate.push(localEntry("slice", "hero"));
    expect(renderModelReport("espada", d, { apply: false })).toMatch(/DRY RUN/);
    expect(renderModelReport("espada", d, { apply: true })).toMatch(/pushed/i);
  });

  it("surfaces per-model push failures", () => {
    const d = emptyDiff();
    d.toCreate.push(localEntry("slice", "hero"));
    const out = renderModelReport("espada", d, {
      apply: true,
      failed: [{ kind: "slice", id: "hero", error: "422 unprocessable" }],
    });
    expect(out).toContain("FAILED  slice hero: 422 unprocessable");
  });

  it("names the Prismic repository in the header so a wrong-repo run is obvious", () => {
    expect(renderModelReport("the-pointe-burbank", emptyDiff(), { apply: false })).toContain(
      "the-pointe-burbank",
    );
  });

  // TWO SOURCES OF TRUTH FOR ONE SAFETY-CRITICAL FACT. `remoteOnly` now exists on
  // BOTH the `ModelDiff` (where this renderer reads it) and on `PushReport` as
  // `remoteOnlyReported` — the field Task 10 added so that a consumer holding
  // only the report can still tell "this checkout lost every slice" apart from
  // "everything is in sync".
  //
  // Two sources for one fact is itself a defect shape: they can disagree, and
  // the disagreement is silent. It means something upstream is broken — a diff
  // computed against a different remote read than the push ran against, a report
  // built from a stale diff, or a caller passing a mismatched pair. Any of those
  // makes every other number in the report untrustworthy, because they were all
  // derived from the same inputs.
  //
  // So the renderer RECONCILES rather than picking a winner. It has both; the
  // check is nearly free; and a mismatch must be loud, because the quiet version
  // is a report that looks authoritative and is not.
  it("reconciles the diff's remoteOnly against the push report's, and says so loudly on a mismatch", () => {
    const d = emptyDiff();
    d.remoteOnly.push(remoteEntry("customtype", "frozen_page"));
    const out = renderModelReport("espada", d, {
      apply: true,
      report: {
        mode: "apply",
        sent: [],
        failed: [],
        // Disagrees with the diff above: the diff saw one remote-only model,
        // the push run recorded none.
        remoteOnlyReported: [],
      },
    });
    expect(out).toMatch(/INCONSISTENT/);
    expect(out).toContain("frozen_page");
  });

  it("says nothing about reconciliation when the two agree", () => {
    const d = emptyDiff();
    d.remoteOnly.push(remoteEntry("customtype", "frozen_page"));
    const out = renderModelReport("espada", d, {
      apply: true,
      report: {
        mode: "apply",
        sent: [],
        failed: [],
        remoteOnlyReported: [{ kind: "customtype", id: "frozen_page" }],
      },
    });
    expect(out).not.toMatch(/INCONSISTENT/);
    expect(out).toContain("REMOTE-ONLY");
  });

  // A dry run never builds a PushReport, so the reconciliation must be SKIPPED
  // rather than treated as "the report said none". Absent and empty are
  // different facts — the rule this whole plan is built around.
  it("does not report an inconsistency when there is no push report at all", () => {
    const d = emptyDiff();
    d.remoteOnly.push(remoteEntry("customtype", "frozen_page"));
    expect(renderModelReport("espada", d, { apply: false })).not.toMatch(/INCONSISTENT/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/cli/prismic-models-report.test.ts`
Expected: FAIL — cannot resolve `../../src/cli/commands/prismic-models-report.js`

- [ ] **Step 3: Write minimal implementation**

```ts
// src/cli/commands/prismic-models-report.ts
import { describeDiff, type ModelDiff, type PushReport } from "../../prismic/models/index.js";

/** No divergence of any kind between the repo and Prismic. `remoteOnly` counts:
 *  it is either an out-of-band cloud edit or a model the repo has forgotten, and
 *  both are drift the operator needs to see. */
export function isClean(diff: ModelDiff): boolean {
  return diff.toCreate.length === 0 && diff.toUpdate.length === 0 && diff.remoteOnly.length === 0;
}

/** `report` is the whole `PushReport` when a push actually ran, and ABSENT on a
 *  dry run — absent and empty are different facts, so do not default it to an
 *  empty report. `failed` remains for callers that have only the failure list. */
export type ReportOptions = {
  apply: boolean;
  failed?: PushReport["failed"];
  report?: PushReport;
};

/**
 * Reconcile the two places `remoteOnly` now lives.
 *
 * `ModelDiff.remoteOnly` is what the comparison saw; `PushReport
 * .remoteOnlyReported` is what the push run recorded. They are derived from the
 * same inputs and must agree. When they do not, something upstream is broken —
 * a diff computed against a different remote read than the push ran against, a
 * report built from a stale diff, or a caller pairing a report with the wrong
 * diff — and every other number in this report came from those same inputs, so
 * none of them can be trusted either.
 *
 * Returns the lines to render, empty when they agree or when there is no report
 * to reconcile against (a dry run never builds one).
 */
function reconcileRemoteOnly(diff: ModelDiff, report: PushReport | undefined): string[] {
  if (report === undefined) return [];
  const key = (e: { kind: string; id: string }) => `${e.kind}:${e.id}`;
  const fromDiff = new Set(diff.remoteOnly.map(key));
  const fromReport = new Set(report.remoteOnlyReported.map(key));
  const only = (a: Set<string>, b: Set<string>) => [...a].filter((k) => !b.has(k)).sort();
  const missingFromReport = only(fromDiff, fromReport);
  const missingFromDiff = only(fromReport, fromDiff);
  if (missingFromReport.length === 0 && missingFromDiff.length === 0) return [];
  return [
    "",
    `⚠ INCONSISTENT — the comparison and the push run disagree about which models` +
      ` exist only in Prismic. Treat every figure in this report as unreliable and` +
      ` re-run; do not act on it.`,
    ...missingFromReport.map(
      (k) => `    seen by the comparison, absent from the push report: ${k}`,
    ),
    ...missingFromDiff.map((k) => `    in the push report, absent from the comparison: ${k}`),
  ];
}

/** One site's model delta, plain text. Used verbatim as the PR comment body
 *  (inside a fenced block) and as CLI output — one renderer, so what CI shows a
 *  reviewer is exactly what an operator sees locally. */
export function renderModelReport(
  repositoryName: string,
  diff: ModelDiff,
  opts: ReportOptions,
): string {
  const lines: string[] = [`Prismic models — repository: ${repositoryName}`];

  // Reconcile FIRST, and render it even on an otherwise-clean diff. A mismatch
  // means the inputs disagree, so "clean" is exactly the verdict that must not
  // be printed unqualified — a report that says "nothing to push" while its own
  // two sources disagree is the most dangerous output this renderer can produce.
  const inconsistency = reconcileRemoteOnly(diff, opts.report);

  if (isClean(diff) && inconsistency.length === 0) {
    lines.push(`${diff.unchanged.length} model(s) match Prismic — nothing to push.`);
    return lines.join("\n");
  }

  for (const entry of diff.toCreate) {
    lines.push(`NEW  ${entry.kind} ${entry.id}  (${entry.path})`);
  }
  for (const { local, remote } of diff.toUpdate) {
    lines.push(`CHANGED  ${local.kind} ${local.id}  (${local.path})`);
    for (const l of describeDiff(local.model, remote.model)) lines.push(`    ${l}`);
  }
  if (diff.remoteOnly.length > 0) {
    lines.push("");
    lines.push(
      `REMOTE-ONLY — present in Prismic, absent from this repo. These are reported and` +
        ` never deleted by CI; pull them down with \`reddoor-maint prismic-models --pull\`` +
        ` or delete them in the Prismic dashboard.`,
    );
    for (const entry of diff.remoteOnly) lines.push(`    ${entry.kind} ${entry.id}`);
  }
  for (const f of opts.failed ?? opts.report?.failed ?? [])
    lines.push(`FAILED  ${f.kind} ${f.id}: ${f.error}`);

  lines.push(...inconsistency);

  lines.push("");
  const n = diff.toCreate.length + diff.toUpdate.length;
  lines.push(
    opts.apply
      ? `${n - (opts.failed ?? opts.report?.failed ?? []).length}/${n} model(s) pushed. ${diff.unchanged.length} already matched.`
      : `DRY RUN — nothing was sent. ${n} model(s) would be pushed; ${diff.unchanged.length} already match.`,
  );
  return lines.join("\n");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/cli/prismic-models-report.test.ts && pnpm typecheck`
Expected: PASS — 15 tests, typecheck clean

- [ ] **Step 5: Commit**

```bash
git add src/cli/commands/prismic-models-report.ts tests/cli/prismic-models-report.test.ts
git commit -m "feat(prismic): one renderer for the PR comment and the CLI output"
```

---

### Task 14: in-repo mode — `--dry` and `--apply`

**Files:**

- Create: `src/cli/commands/prismic-models.ts`
- Test: `tests/cli/prismic-models-command.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/cli/prismic-models-command.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runPrismicModelsCommand } from "../../src/cli/commands/prismic-models.js";
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

const deps = (remote: RemoteEntry[], send = vi.fn()) => ({
  remoteModels: vi.fn(async () => remote),
  sendModel: send,
  env: { PRISMIC_WRITE_TOKEN: "tok" } as Record<string, string | undefined>,
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
    const send = vi.fn();
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
    const send = vi.fn();
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
    const send = vi.fn();
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
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/cli/prismic-models-command.test.ts`
Expected: FAIL — cannot resolve `../../src/cli/commands/prismic-models.js`

- [ ] **Step 3: Write minimal implementation**

```ts
// src/cli/commands/prismic-models.ts
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  diffModels,
  localModels,
  prismicTokenEnvName,
  pushModels,
  readPrismicConfig,
  remoteModels as remoteModelsImpl,
  resolvePrismicToken,
  sendModel as sendModelImpl,
  type LocalEntry,
  type PrismicModel,
  type RemoteEntry,
} from "../../prismic/models/index.js";
import { isClean, renderModelReport } from "./prismic-models-report.js";

export type PrismicModelsCommandOptions = {
  apply?: boolean;
  pull?: boolean;
  tokens?: boolean;
  fleet?: string;
  workdir?: string;
  writeAirtable?: boolean;
  commentFile?: string;
  cwd?: string;
};

/** Injected IO, so the command is testable without a network or a real token. */
export type PrismicModelsDeps = {
  remoteModels: (repo: string, token: string) => Promise<RemoteEntry[]>;
  sendModel: (
    repo: string,
    token: string,
    entry: LocalEntry,
    action: "insert" | "update",
  ) => Promise<void>;
  env: Record<string, string | undefined>;
};

export const defaultDeps = (): PrismicModelsDeps => ({
  remoteModels: (repo, token) => remoteModelsImpl(repo, token),
  sendModel: (repo, token, entry, action) => sendModelImpl(repo, token, entry, action),
  env: process.env,
});

/** One site, one Prismic repository, one comparison. Shared by in-repo and fleet
 *  modes so a nightly verdict and a CI verdict can never disagree by construction. */
export async function checkOneSite(
  repoRoot: string,
  deps: PrismicModelsDeps,
  opts: { apply: boolean; allowGenericToken: boolean },
): Promise<{ output: string; code: number; clean: boolean | null; repositoryName?: string }> {
  const cfg = await readPrismicConfig(repoRoot);
  if (!cfg) {
    return { output: "not a Prismic site (no repositoryName) — skipped", code: 0, clean: null };
  }
  const resolved = resolvePrismicToken(cfg.repositoryName, deps.env, {
    allowGeneric: opts.allowGenericToken,
  });
  if (!resolved) {
    const names = [prismicTokenEnvName(cfg.repositoryName)];
    if (opts.allowGenericToken) names.push("PRISMIC_WRITE_TOKEN");
    return {
      output: `no write token for Prismic repository "${cfg.repositoryName}" — set ${names.join(" or ")}`,
      code: 1,
      clean: null,
      repositoryName: cfg.repositoryName,
    };
  }

  const local = await localModels(repoRoot, cfg.libraries);
  let remote: RemoteEntry[];
  try {
    remote = await deps.remoteModels(cfg.repositoryName, resolved.token);
  } catch (e) {
    return {
      output: `could not read Prismic models: ${(e as Error).message}`,
      code: 1,
      clean: null,
      repositoryName: cfg.repositoryName,
    };
  }

  const diff = diffModels(local, remote);
  const report = await pushModels(diff, {
    apply: opts.apply,
    send: (entry: LocalEntry, _remote: PrismicModel | undefined, action) =>
      deps.sendModel(cfg.repositoryName, resolved.token, entry, action),
  });

  return {
    // Pass the WHOLE report, not `failed: report.failed`.
    //
    // This is the only place in the plan that constructs `ReportOptions`, so
    // destructuring one field here is what decides whether Task 13's
    // reconciliation ever runs at all. With only `failed` supplied, `opts.report`
    // is undefined at every call site and every cross-check that needs a report —
    // remoteOnly, apply-vs-mode, and the sent/failed bucket invariant — silently
    // does nothing. The safeguard added after Task 10's review would ship dark and
    // never execute once. Found by the Task 13 implementer, 2026-08-13.
    //
    // Pass `report` INSTEAD OF `failed`, not in addition: with one source for the
    // failure list there is nothing to reconcile and that check correctly skips,
    // while the rest light up.
    output: renderModelReport(cfg.repositoryName, diff, {
      apply: opts.apply,
      report,
    }),
    // A dry run NEVER fails on drift: a model PR is supposed to differ from the
    // remote, and the comment is the review artifact, not a gate. Only a real
    // push failure (or an unreadable remote) is an error.
    code: report.failed.length > 0 ? 1 : 0,
    clean: isClean(diff),
    repositoryName: cfg.repositoryName,
  };
}

export async function runPrismicModelsCommand(
  site: string | undefined,
  opts: PrismicModelsCommandOptions,
  deps: PrismicModelsDeps = defaultDeps(),
): Promise<{ output: string; code: number }> {
  const cwd = opts.cwd ? resolve(opts.cwd) : process.cwd();
  const repoRoot = site ? resolve(cwd, site) : cwd;

  const result = await checkOneSite(repoRoot, deps, {
    apply: opts.apply === true,
    allowGenericToken: true,
  });
  if (opts.commentFile) {
    await writeFile(resolve(cwd, opts.commentFile), forComment(result.output), "utf-8");
  }
  return { output: result.output, code: result.code };
}

/**
 * GitHub rejects an issue comment body over 65,536 characters, so whatever posts
 * this has to shorten it — and a report that was shortened without saying so is
 * this pipeline's governing failure in its purest form: the reviewer sees a
 * complete-looking comment and approves a model change whose destructive lines
 * were the ones cut.
 *
 * A first-ever push is the realistic trigger, not an edge case. The fleet holds
 * 68 custom types and 132 slices across 15 repos (measured 2026-08-13 from each
 * repo's origin/HEAD), and an empty Prismic repository sorts EVERY local model
 * into `toCreate` with a field-level line each — which is exactly the shape of
 * Task 32's composition-hospitality proof.
 *
 * So truncate deliberately, keep the HEAD (the renderer puts the verdict and the
 * DESTRUCTIVE warning there precisely so they survive), and make the cut itself
 * loud enough that nobody mistakes the remainder for the whole.
 */
const GITHUB_COMMENT_LIMIT = 65_536;

export function forComment(body: string, limit = GITHUB_COMMENT_LIMIT): string {
  if (body.length <= limit) return body;
  const notice =
    `\n\n⚠ TRUNCATED — this report is ${body.length} characters and GitHub caps a` +
    ` comment at ${limit}. Everything below the cut is missing, including any` +
    ` further destructive lines. Run \`reddoor-maint prismic-models --dry\` locally` +
    ` for the whole report before approving.\n`;
  return body.slice(0, limit - notice.length) + notice;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/cli/prismic-models-command.test.ts`
Expected: PASS — 9 tests

- [ ] **Step 5: Commit**

```bash
git add src/cli/commands/prismic-models.ts tests/cli/prismic-models-command.test.ts
git commit -m "feat(prismic): prismic-models in-repo dry/apply, remote-only never pushed"
```

---

### Task 15: `--tokens` — the token doctor

**Files:**

- Modify: `src/cli/commands/prismic-models.ts`
- Create: `tests/cli/prismic-models-tokens.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/cli/prismic-models-tokens.test.ts
import { describe, it, expect, vi } from "vitest";
import { renderTokenDoctor, type TokenProbe } from "../../src/cli/commands/prismic-models.js";

const probe = (over: Partial<TokenProbe> = {}): TokenProbe => ({
  site: "Espada",
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
    expect(renderTokenDoctor([probe({ present: false, reads: false })])).toContain("MISSING");
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

  it("skips a non-Prismic site with a reason instead of a fake failure", () => {
    const out = renderTokenDoctor([
      {
        site: "Data Dynamiq",
        repositoryName: null,
        expectedEnv: null,
        present: false,
        reads: false,
      },
    ]);
    expect(out).toContain("Data Dynamiq");
    expect(out).toMatch(/no Prismic/i);
  });

  it("summarises the counts on the last line", () => {
    const out = renderTokenDoctor([
      probe(),
      probe({ site: "Hedloc", present: false, reads: false }),
    ]);
    expect(out.trim().split("\n").at(-1)).toMatch(/1 ok, 1 missing, 0 failing/);
  });

  it("never prints a token value", () => {
    const out = renderTokenDoctor([probe()]);
    expect(out).not.toMatch(/Bearer|[A-Za-z0-9_-]{40,}/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/cli/prismic-models-tokens.test.ts`
Expected: FAIL — `renderTokenDoctor is not exported`

- [ ] **Step 3: Write the implementation (append to `src/cli/commands/prismic-models.ts`)**

```ts
// append to src/cli/commands/prismic-models.ts

/** One site's token situation. `present` and `reads` are separate on purpose:
 *  Prismic write-token expiry is undocumented and was never proven either way,
 *  and "present but no longer reads" is exactly the shape an expiry would take.
 *  Collapsing them into one boolean would report an expired token as a missing
 *  one and send the operator to mint a duplicate. */
export type TokenProbe = {
  site: string;
  repositoryName: string | null;
  expectedEnv: string | null;
  present: boolean;
  reads: boolean;
  error?: string;
};

/** The operator's rename checklist AND the ongoing expiry doctor. Prints the env
 *  var NAME that was looked for, never a token value. */
export function renderTokenDoctor(probes: TokenProbe[]): string {
  const lines: string[] = [];
  let ok = 0;
  let missing = 0;
  let failing = 0;
  for (const p of probes) {
    if (p.repositoryName === null) {
      lines.push(`${p.site.padEnd(28)} —  no Prismic config (skipped)`);
      continue;
    }
    let verdict: string;
    if (!p.present) {
      verdict = "MISSING";
      missing++;
    } else if (!p.reads) {
      verdict = `PRESENT BUT 403/FAILED — ${p.error ?? "read failed"}`;
      failing++;
    } else {
      verdict = "OK";
      ok++;
    }
    lines.push(
      `${p.site.padEnd(28)} ${p.repositoryName.padEnd(26)} ${p.expectedEnv?.padEnd(38)} ${verdict}`,
    );
  }
  lines.push("");
  lines.push(`${ok} ok, ${missing} missing, ${failing} failing.`);
  return lines.join("\n");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/cli/prismic-models-tokens.test.ts`
Expected: PASS — 7 tests

- [ ] **Step 5: Commit**

```bash
git add src/cli/commands/prismic-models.ts tests/cli/prismic-models-tokens.test.ts
git commit -m "feat(prismic): token doctor separates missing from present-but-403"
```

---

### Task 16: `--pull` — bring a remote-only model into the repo

**Files:**

- Modify: `src/cli/commands/prismic-models.ts`
- Create: `tests/cli/prismic-models-pull.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/cli/prismic-models-pull.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, writeFile, readFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runPrismicModelsCommand } from "../../src/cli/commands/prismic-models.js";
import type { RemoteEntry } from "../../src/prismic/models/index.js";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "prismic-pull-"));
  await writeFile(
    join(dir, "slicemachine.config.json"),
    JSON.stringify({ repositoryName: "espada", libraries: ["./src/lib/slices"] }),
  );
  await mkdir(join(dir, "customtypes", "page"), { recursive: true });
  await writeFile(join(dir, "customtypes", "page", "index.json"), JSON.stringify({ id: "page" }));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const remote: RemoteEntry[] = [
  { kind: "customtype", id: "page", model: { id: "page" } },
  { kind: "customtype", id: "frozen_page", model: { id: "frozen_page", label: "Frozen" } },
  { kind: "slice", id: "video_block", model: { id: "video_block", type: "SharedSlice" } },
];

const deps = (spawn = vi.fn(async () => ({ code: 0, stdout: "", stderr: "" }))) => ({
  remoteModels: vi.fn(async () => remote),
  sendModel: vi.fn(),
  env: { PRISMIC_WRITE_TOKEN: "tok" } as Record<string, string | undefined>,
  spawn,
});

describe("runPrismicModelsCommand --pull", () => {
  it("writes each remote-only model into the repo at its conventional path", async () => {
    const r = await runPrismicModelsCommand(undefined, { cwd: dir, pull: true }, deps());
    expect(
      JSON.parse(await readFile(join(dir, "customtypes/frozen_page/index.json"), "utf-8")),
    ).toEqual({
      id: "frozen_page",
      label: "Frozen",
    });
    expect(
      JSON.parse(await readFile(join(dir, "src/lib/slices/VideoBlock/model.json"), "utf-8")),
    ).toMatchObject({ id: "video_block" });
    expect(r.code).toBe(0);
  });

  it("formats every written file with the target repo's own prettier", async () => {
    const spawn = vi.fn(async () => ({ code: 0, stdout: "", stderr: "" }));
    await runPrismicModelsCommand(undefined, { cwd: dir, pull: true }, deps(spawn));
    const written = spawn.mock.calls.flatMap((c) => (c[1] as string[]).slice(3));
    expect(written).toContain("customtypes/frozen_page/index.json");
    expect(written).toContain("src/lib/slices/VideoBlock/model.json");
  });

  it("flags the run when prettier could not run, without losing the models", async () => {
    const spawn = vi.fn(async () => {
      throw new Error("ENOENT");
    });
    const r = await runPrismicModelsCommand(undefined, { cwd: dir, pull: true }, deps(spawn));
    expect(r.output).toMatch(/could not prettier-format/i);
    expect(await readFile(join(dir, "customtypes/frozen_page/index.json"), "utf-8")).toContain(
      "frozen_page",
    );
  });

  it("does nothing and says so when there is no remote-only model", async () => {
    const d = deps();
    d.remoteModels = vi.fn(async () => [{ kind: "customtype", id: "page", model: { id: "page" } }]);
    const r = await runPrismicModelsCommand(undefined, { cwd: dir, pull: true }, d);
    expect(r.output).toMatch(/nothing to pull/i);
    expect(r.code).toBe(0);
  });

  // --pull is a repo mutation. Combining it with --apply in one invocation would
  // push and pull in the same breath with no review in between; refuse rather
  // than pick an order.
  it("refuses --pull with --apply (exit 2)", async () => {
    const r = await runPrismicModelsCommand(
      undefined,
      { cwd: dir, pull: true, apply: true },
      deps(),
    );
    expect(r.code).toBe(2);
    expect(r.output).toMatch(/cannot combine/i);
  });

  it("refuses --pull in fleet mode (exit 2) — it writes to a working tree", async () => {
    const r = await runPrismicModelsCommand(
      undefined,
      { cwd: dir, pull: true, fleet: "airtable" },
      deps(),
    );
    expect(r.code).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/cli/prismic-models-pull.test.ts`
Expected: FAIL — `--pull` writes nothing; assertions on missing files reject

- [ ] **Step 3: Write the implementation**

Add `spawn` to `PrismicModelsDeps` and a pull branch to `runPrismicModelsCommand`.

```ts
// in src/cli/commands/prismic-models.ts — extend the deps type
import { makeSpawn, type SpawnFn } from "../../audits/util/spawn.js";
import { PRETTIER_FLAG_NOTE } from "../../recipes/_prettier.js";
import { readPrismicConfig, writeModelFile } from "../../prismic/models/index.js";

export type PrismicModelsDeps = {
  remoteModels: (repo: string, token: string) => Promise<RemoteEntry[]>;
  sendModel: (
    repo: string,
    token: string,
    entry: LocalEntry,
    action: "insert" | "update",
  ) => Promise<void>;
  env: Record<string, string | undefined>;
  spawn: SpawnFn;
};

export const defaultDeps = (): PrismicModelsDeps => ({
  remoteModels: (repo, token) => remoteModelsImpl(repo, token),
  sendModel: (repo, token, entry, action) => sendModelImpl(repo, token, entry, action),
  env: process.env,
  spawn: makeSpawn(),
});

/**
 * Bring models that exist ONLY in Prismic into the repo, as files.
 *
 * This is the safe answer to `remoteOnly`. CI reports those models and can never
 * delete them, which leaves exactly two resolutions: adopt the model into the
 * repo (here) or delete it in the Prismic dashboard (a human, in a browser).
 * Without this the nightly drift alarm has no non-manual way to clear.
 *
 * Operator-invoked only — never in CI. It mutates a working tree, and the
 * resulting files are meant to land as a reviewed PR.
 */
async function pullRemoteOnly(
  repoRoot: string,
  deps: PrismicModelsDeps,
): Promise<{ output: string; code: number }> {
  const cfg = await readPrismicConfig(repoRoot);
  if (!cfg) return { output: "not a Prismic site (no repositoryName) — skipped", code: 0 };
  const resolved = resolvePrismicToken(cfg.repositoryName, deps.env, { allowGeneric: true });
  if (!resolved) {
    return {
      output: `no write token for "${cfg.repositoryName}" — set ${prismicTokenEnvName(cfg.repositoryName)} or PRISMIC_WRITE_TOKEN`,
      code: 1,
    };
  }
  const remote = await deps.remoteModels(cfg.repositoryName, resolved.token);
  const diff = diffModels(await localModels(repoRoot, cfg.libraries), remote);
  if (diff.remoteOnly.length === 0) {
    return { output: `nothing to pull — no remote-only models in ${cfg.repositoryName}`, code: 0 };
  }
  // NOT `cfg.libraries[0] ?? "./src/lib/slices"`. That default re-collapses a
  // distinction `config.ts` deliberately makes: an ABSENT `libraries` key gets
  // the fleet default there, but `libraries: []` is a STATEMENT — "this site has
  // no slice libraries" — and config.ts documents it as such. Fabricating the
  // fleet default here writes a slice model into a directory the site does not
  // use, and reports it as a successful pull. `writeModelFile` refuses a blank
  // library, so surface that refusal instead of inventing a path.
  //
  // `[0]` is also an unstated rule when several libraries exist. The fleet is
  // uniform at one today (measured 2026-08-13), so this is not yet a live
  // ambiguity — but say which one is chosen rather than letting index 0 decide
  // silently.
  const library = cfg.libraries[0];
  if (library === undefined || library.trim() === "") {
    return {
      output:
        `cannot pull slices into "${cfg.repositoryName}": its Prismic config declares no slice ` +
        `library. Add one to slicemachine.config.json, or pull only custom types.`,
      code: 1,
    };
  }

  // FAILURE IS PER-MODEL, exactly as in `pushModels`. The guards in
  // `writeModelFile` make refusals genuinely reachable — a directory already
  // occupied by a DIFFERENT model id is the live case (slice directory names are
  // derived from the id and the fleet copies slices between sites) — and a loop
  // that throws on the first refusal leaves the models it already wrote on disk
  // with no record of which. That is the same "report that silently omits
  // models" `push.ts` refuses to produce.
  // `writeModelFile` takes a FORMAT capability, not a process spawner. Task 12's
  // red team ran `run("rm", ["-rf", model])` through the injected `SpawnFn` and it
  // passed every assertion — so the module now holds "format these paths in this
  // repo" and never an arbitrary-argv primitive. The argv is built here, at the
  // single injection site, which is the one place a reviewer can see it.
  //
  // `deps.spawn` is a tsc ERROR now. Bind it in one line:
  const format: FormatModelFile = (root, paths, fmtOpts) =>
    formatWithPrettier(deps.spawn, root, paths, fmtOpts);

  const lines: string[] = [];
  let unformatted = 0;
  let refused = 0;
  for (const entry of diff.remoteOnly) {
    try {
      const res = await writeModelFile(format, repoRoot, entry, library);
      if (!res.formatted) unformatted++;
      lines.push(
        `pulled   ${entry.kind} ${entry.id}  -> ${res.path}${res.formatted ? "" : "  (unformatted)"}`,
      );
    } catch (e) {
      refused++;
      lines.push(
        `REFUSED  ${entry.kind} ${entry.id}  — ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
  if (unformatted > 0) lines.push(`⚠ ${PRETTIER_FLAG_NOTE}`);
  lines.push("");
  lines.push(
    `${diff.remoteOnly.length - refused} of ${diff.remoteOnly.length} model(s) pulled` +
      (refused > 0 ? `, ${refused} refused` : "") +
      `. Review, commit, and open a PR.`,
  );
  // A refusal is a real finding the operator must act on, so it must not exit 0.
  return { output: lines.join("\n"), code: refused > 0 ? 1 : 0 };
}
```

Then, at the top of `runPrismicModelsCommand`, before the in-repo path:

```ts
if (opts.pull) {
  if (opts.apply) {
    return { output: "cannot combine --pull with --apply — pull, review, then push", code: 2 };
  }
  if (opts.fleet) {
    return { output: "--pull is single-repo only (it writes to a working tree)", code: 2 };
  }
  return pullRemoteOnly(repoRoot, deps);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/cli/prismic-models-pull.test.ts tests/cli/prismic-models-command.test.ts`
Expected: PASS — 6 + 9 tests (update the in-repo test's `deps()` helper to include `spawn` if typecheck complains)

- [ ] **Step 5: Commit**

```bash
git add src/cli/commands/prismic-models.ts tests/cli/prismic-models-pull.test.ts tests/cli/prismic-models-command.test.ts
git commit -m "feat(prismic): --pull adopts remote-only models, formatted by the target repo"
```

---

### Task 17: fleet mode + the exit-code rule

**Files:**

- Modify: `src/cli/commands/prismic-models.ts`
- Create: `tests/cli/prismic-models-fleet.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/cli/prismic-models-fleet.test.ts
import { describe, it, expect } from "vitest";
import {
  prismicSweepExitCode,
  findRepositoryCollisions,
  describeCollisions,
} from "../../src/cli/commands/prismic-models.js";

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/cli/prismic-models-fleet.test.ts`
Expected: FAIL — `prismicSweepExitCode is not exported`

- [ ] **Step 3: Write the implementation (append to `src/cli/commands/prismic-models.ts`)**

```ts
// append to src/cli/commands/prismic-models.ts
import { resolveSites } from "../fleet/resolve-sites.js";
import { prepareFleetSites, appendSkipNotice, type SkippedSite } from "../fleet/prepare-sites.js";
import { fleetWorkdir } from "../../util/fleet-workdir.js";
import { siteLabel } from "../../util/site.js";

/** Exit code for a fleet sweep. Non-zero when failures are the MAJORITY of the
 *  fleet, matching `githubSignalsExitCode` — a run where 11/12 repos could not be
 *  read is an outage, not a flake. DRIFT is never a failure: a readable site that
 *  diverges is a finding written to Airtable, and reddening the nightly for it
 *  would make the alarm meaningless the first time someone edits a model. */
export function prismicSweepExitCode(checked: number, failed: number): number {
  return failed > checked ? 1 : 0;
}

/** One row per site from a fleet sweep, ready for the Airtable writer. */
export type SweepRow = {
  site: string;
  repositoryName: string | null;
  /** Did the check RUN — separate from what it found. `skipped` means this repo
   *  has no Prismic config; `failed` means we could not find out. Those were
   *  once both `clean: null`, which made a broken config score as a routine skip
   *  and disappear from the outage count. Carried through from `checkOneSite`,
   *  never re-derived. */
  status: "checked" | "skipped" | "failed";
  /** Does the repo match Prismic. Only meaningful when `status === "checked"`. */
  clean: boolean | null;
  detail: string;
};

/**
 * Sites that claim the same Prismic repository as another site.
 *
 * The fleet-level twin of `assertNoDuplicateIds`: there, two files inside one
 * repo claiming one model id; here, two repos claiming one Prismic repository.
 * It is possible today — `the-tower` and `the-tower-burbank` both declare
 * `repositoryName: "the-tower-burbank"`, benign only because `the-tower` is
 * archived and so is not in the fleet inventory.
 *
 * Why this DETECTS instead of throwing, unlike `assertNoDuplicateIds`: that one
 * aborts the read of a single broken repo, which is proportionate. Aborting here
 * would take the drift alarm offline for every site in the fleet because two
 * repos have a config problem — and the sweep is read-only, so nothing is being
 * corrupted at the moment of detection. The real damage happens later and
 * elsewhere: each repo's own CI pushes to the shared Prismic repository on
 * merge, and each overwrites the other. Neither repo can ever see it, because
 * each one's local-vs-remote comparison is internally consistent; the conflict
 * exists only BETWEEN them.
 *
 * That makes the fleet sweep the only vantage point in the whole system from
 * which this is visible — so it must report it loudly and go non-zero, and it
 * must name both sites, because only a human can say which repo is the owner.
 *
 * Sites with no Prismic config (`null`) never collide with each other.
 */
export type RepositoryCollision = { repositoryName: string; sites: string[] };

export function findRepositoryCollisions(
  rows: Array<{ site: string; repositoryName: string | null }>,
): RepositoryCollision[] {
  const bySite = new Map<string, string[]>();
  for (const r of rows) {
    if (r.repositoryName === null) continue;
    const list = bySite.get(r.repositoryName) ?? [];
    list.push(r.site);
    bySite.set(r.repositoryName, list);
  }
  return [...bySite.entries()]
    .filter(([, sites]) => sites.length > 1)
    .map(([repositoryName, sites]) => ({ repositoryName, sites: [...sites].sort() }));
}

/** The report block for a collision. Deliberately shouty: this is the one
 *  finding in the sweep that no per-repo CI run can ever surface. */
export function describeCollisions(collisions: RepositoryCollision[]): string {
  if (collisions.length === 0) return "";
  return [
    "## ⛔ Prismic repository claimed by more than one site",
    "",
    ...collisions.map(
      (c) =>
        `- **${c.repositoryName}** is claimed by ${c.sites.join(" and ")}. ` +
        `Each repo's CI pushes to it on merge, so they overwrite each other — ` +
        `and neither repo can detect this on its own. Fix the ` +
        `slicemachine.config.json in whichever repo is not the owner.`,
    ),
  ].join("\n");
}

/** Fleet mode: clone every site, compare each against its Prismic repository,
 *  never push. Read-only by construction — `apply` is not plumbed through here,
 *  because a fleet-wide model push outside CI is 🔴 under AUTONOMY.md. */
export async function sweepFleet(
  opts: PrismicModelsCommandOptions,
  deps: PrismicModelsDeps,
  cwd: string,
): Promise<{ rows: SweepRow[]; skipped: SkippedSite[] }> {
  const sites = await resolveSites({
    ...(opts.fleet !== undefined ? { fleet: opts.fleet } : {}),
    ...(opts.workdir !== undefined ? { workdir: opts.workdir } : {}),
    cwd,
  });
  const workdir = opts.workdir ?? fleetWorkdir();
  const prep = await prepareFleetSites(sites, { workdir });
  const rows: SweepRow[] = [];
  for (const s of prep.prepared) {
    // Fleet mode forbids the generic token: one PRISMIC_WRITE_TOKEN in the
    // environment while iterating every fleet repository would attach the wrong
    // credential to every site after the first.
    const r = await checkOneSite(s.path, deps, { apply: false, allowGenericToken: false });
    rows.push({
      site: siteLabel(s),
      repositoryName: r.repositoryName ?? null,
      // Carry `status` THROUGH. Do not re-derive a verdict here — see below.
      status: r.status,
      clean: r.clean,
      detail: r.output,
    });
  }
  return { rows, skipped: prep.skipped };
}
```

Wire it into `runPrismicModelsCommand` before the in-repo path:

```ts
if (opts.fleet) {
  const { rows, skipped } = await sweepFleet(opts, deps, cwd);

  // Count on `status`, NOT on `clean === null && repositoryName !== null`.
  //
  // That derivation was wrong in exactly the case the sweep exists to catch: a
  // config that is PRESENT AND BROKEN never yields a `repositoryName`, so it
  // scored identically to a genuine "not a Prismic site" skip and vanished from
  // the failure count. The absent-vs-unreadable collapse, reappearing inside the
  // rule meant to detect outages — found while fixing the same collapse one layer
  // down in `checkOneSite`, 2026-08-13.
  //
  // `checkOneSite` now returns an explicit `status: "checked" | "skipped" |
  // "failed"`, so the fleet layer reads a fact instead of inferring one from two
  // nulls. Never reconstruct this from `clean`: `clean` answers "does this site
  // match Prismic", which is only meaningful once `status === "checked"`.
  const checked = rows.filter((r) => r.status === "checked").length;
  const failed = rows.filter((r) => r.status === "failed").length;
  const body = rows.map((r) => `[${r.site}] ${r.detail}`).join("\n\n");

  // A collision forces non-zero regardless of the majority rule. It is not a
  // "site failed to read" — every site read fine — so `failed` cannot express
  // it, and a fleet where two repos overwrite each other's models must not
  // report success just because 15 of 15 sites were individually readable.
  const collisions = findRepositoryCollisions(rows);
  const collisionBlock = describeCollisions(collisions);
  const output = appendSkipNotice(collisionBlock ? `${collisionBlock}\n\n${body}` : body, skipped);
  const code = collisions.length > 0 ? 1 : prismicSweepExitCode(checked, failed);
  return { output, code };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/cli/prismic-models-fleet.test.ts && pnpm typecheck`
Expected: PASS — 12 tests, typecheck clean

- [ ] **Step 5: Commit**

```bash
git add src/cli/commands/prismic-models.ts tests/cli/prismic-models-fleet.test.ts
git commit -m "feat(prismic): fleet sweep is read-only, detects cross-repo repositoryName collisions"
```

---

### Task 17b: `--fleet --tokens` — the doctor across the whole fleet

**Added 2026-08-13.** The Task 17 implementer found that this plan documents `prismic-models --fleet airtable --tokens` in **three** places — Task 23's workflow comment, Task 27's operator step, and Task 32's live-proof step — and **no task implements it**. `runTokenDoctor` probes one checkout.

Left unrefused it is the failure class this plan exists to eliminate: it would print ONE row under a heading claiming to cover the fleet, and an operator would mint one secret believing they had covered fifteen. Task 17 refused it with `NOT IMPLEMENTED` (exit 1) rather than inventing a mode inside an unrelated commit, which was correct. This task builds it.

**It is also on the critical path for Task 32** — the operator step that tells you which `PRISMIC_TOKEN_*` secrets to mint is the first thing the live proof needs.

**Files:**

- Modify: `src/cli/commands/prismic-models.ts`
- Test: `tests/cli/prismic-models-tokens.test.ts`

**What it must do**

- Resolve the inventory exactly as `sweepFleet` does, prepare each site, and probe each one's token — reusing `probeSiteToken` and `renderTokenDoctor`, which already takes an array.
- **Count preparation failures as `failed` rows, not skips.** Task 17 fixed exactly this bug in the sweep: `prepareFleetSites` puts a clone failure in `skipped`, and building rows only from `prep.prepared` meant a fleet-wide clone outage reported `0 checked, 0 failed, exit 0`. The doctor has the identical shape and must not repeat it — a site whose checkout could not be established has an UNKNOWN token requirement, which is not the same as needing none.
- **Never print a token value.** Print env var NAMES and resolution status only. The existing test that no value can reach the output must cover this path too. Note the trap: a `{40,}` character-class regex matches `PRISMIC_TOKEN_MEDICAL_SOLUTIONS_OF_TEXAS` exactly, so assert the real property (the type holds no token; a token in `env` never appears in output), never a length heuristic.
- **`PRESENT (not verified)`, never `OK`.** Nothing here validates a token against the API, and claiming OK for a secret nobody tested is this plan's own rule pointed at the doctor's output.
- Remove `--fleet --tokens` from the refusal list, and confirm the remaining refusals still fire.
- Exit non-zero when any site's token is MISSING — the whole point is to gate the operator step.

**Fleet identity note.** The env var is derived from the **Prismic `repositoryName`**, not the repo directory name, and four differ: `medical-solutions-of-texas` → `msot`, `reddoor-website` → `reddoor-la`, `data-dynamiq` → `reddoor-wireframer`, `beachfront-dentistry` → `48bb12d1`. Printing repo → Prismic repository → env var is the whole value of this command; `48BB12D1` is otherwise unattributable to a site.

Also report the **derived-env-var collision** axis that Task 17 added to the collision detector: two distinct repositories that upper-snake onto one `PRISMIC_TOKEN_*` would silently share a credential, and the doctor is where an operator would notice before minting.

---

### Task 18: register the command in `bin.ts`

**Files:**

- Modify: `src/cli/bin.ts` (after the `self-updating` command block)
- Test: `tests/cli/prismic-models-registration.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/cli/prismic-models-registration.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const bin = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../../src/cli/bin.ts"),
  "utf-8",
);

describe("prismic-models CLI registration", () => {
  it("registers the command", () => {
    expect(bin).toContain('cli\n  .command("prismic-models [site]"');
  });

  it("declares every mode flag", () => {
    for (const flag of [
      "--apply",
      "--pull",
      "--tokens",
      "--fleet",
      "--workdir",
      "--comment-file",
    ]) {
      expect(bin).toContain(flag);
    }
  });

  // Every command module is loaded LAZILY (dynamic import inside .action()) so
  // the CLI's startup graph stays free of heavy transitive deps; the smoke-dist
  // gate asserts bin.js's STATIC import closure. A top-level import here would
  // break that gate.
  it("imports the command module lazily", () => {
    expect(bin).toContain('await import("./commands/prismic-models.js")');
    expect(bin).not.toMatch(/^import .*commands\/prismic-models/m);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/cli/prismic-models-registration.test.ts`
Expected: FAIL — bin.ts contains no `prismic-models` command

- [ ] **Step 3: Write the implementation (insert into `src/cli/bin.ts` after the `self-updating` block)**

```ts
cli
  .command(
    "prismic-models [site]",
    "Compare a site's Prismic models against its repo (dry by default).",
  )
  .option(
    "--apply",
    "Push local models to Prismic. Never deletes — remote-only models are reported.",
  )
  .option("--pull", "Write remote-only models into the repo (single-site; review + PR the result).")
  .option("--tokens", "Print the per-site write-token doctor: which env var, present?, reads?")
  .option("--fleet <inventory>", 'Inventory file (.json or .mjs/.js), or "airtable". Read-only.')
  .option("--workdir <path>", "Clone target for fleet mode (default ~/.reddoor-maint/sites)")
  .option("--write-airtable", "Fleet mode: persist each site's verdict to its Websites row")
  .option(
    "--comment-file <path>",
    "Write the report to this file (the CI workflow posts it as a PR comment)",
  )
  .action(
    async (
      site,
      opts: {
        apply?: boolean;
        pull?: boolean;
        tokens?: boolean;
        fleet?: string;
        workdir?: string;
        writeAirtable?: boolean;
        commentFile?: string;
        cwd?: string;
        verbose?: boolean;
      },
    ) =>
      runOrExit(
        async () =>
          (await import("./commands/prismic-models.js")).runPrismicModelsCommand(site, opts),
        opts,
      ),
  );
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/cli/prismic-models-registration.test.ts && pnpm build && node dist/cli/bin.js prismic-models --help`
Expected: PASS — 3 tests; `--help` lists the command and all six flags

- [ ] **Step 5: Commit**

```bash
git add src/cli/bin.ts tests/cli/prismic-models-registration.test.ts
git commit -m "feat(cli): register prismic-models (lazy-loaded, like every other command)"
```

---

## Phase D — the nightly drift check reaches the cockpit

**Operator precondition:** three columns on the Airtable `Websites` table. The code ships dark until they exist and must not break the nightly run in the meantime.

| Column                      | Type                                                   |
| --------------------------- | ------------------------------------------------------ |
| `Prismic Models`            | Single select: `pass`, `fail`                          |
| `Prismic Models Checked At` | Text (ISO 8601), matching `Function health checked at` |
| `Prismic Models Drift`      | Long text                                              |

### Task 19: persist a site's verdict

**Files:**

- Modify: `src/reports/airtable/websites.ts`
- Test: `tests/reports/airtable-prismic-models.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/reports/airtable-prismic-models.test.ts
import { describe, it, expect, vi } from "vitest";
import { mapRow, updatePrismicModels } from "../../src/reports/airtable/websites.js";

const fakeBase = (update: (args: unknown) => Promise<void>) =>
  (() => ({ update })) as unknown as Parameters<typeof updatePrismicModels>[0];

describe("mapRow — Prismic model columns", () => {
  it("maps the verdict, the timestamp, and the drift detail", () => {
    const row = mapRow({
      id: "rec1",
      fields: {
        Name: "Espada",
        "Prismic Models": "fail",
        "Prismic Models Checked At": "2026-08-12T06:00:00.000Z",
        "Prismic Models Drift": "CHANGED  slice hero",
      },
    });
    expect(row.prismicModels).toBe("fail");
    expect(row.prismicModelsCheckedAt).toBe("2026-08-12T06:00:00.000Z");
    expect(row.prismicModelsDrift).toBe("CHANGED  slice hero");
  });

  it("nulls all three when the operator has not added the columns yet", () => {
    const row = mapRow({ id: "rec1", fields: { Name: "Espada" } });
    expect(row.prismicModels).toBeNull();
    expect(row.prismicModelsCheckedAt).toBeNull();
    expect(row.prismicModelsDrift).toBeNull();
  });

  it("ignores a value that is not pass/fail", () => {
    expect(
      mapRow({ id: "r", fields: { Name: "x", "Prismic Models": "maybe" } }).prismicModels,
    ).toBeNull();
  });
});

describe("updatePrismicModels", () => {
  it("writes all three columns in one update", async () => {
    const update = vi.fn(async () => {});
    await updatePrismicModels(fakeBase(update), "rec1", {
      ok: "pass",
      checkedAt: "2026-08-12T06:00:00.000Z",
      drift: null,
    });
    expect(update).toHaveBeenCalledWith([
      {
        id: "rec1",
        fields: {
          "Prismic Models": "pass",
          "Prismic Models Checked At": "2026-08-12T06:00:00.000Z",
          "Prismic Models Drift": null,
        },
      },
    ]);
  });

  it("truncates a very long drift detail so Airtable accepts it", async () => {
    const update = vi.fn(async () => {});
    await updatePrismicModels(fakeBase(update), "rec1", {
      ok: "fail",
      checkedAt: "2026-08-12T06:00:00.000Z",
      drift: "x".repeat(120_000),
    });
    const fields = (update.mock.calls[0] as [Array<{ fields: Record<string, string> }>])[0][0]!
      .fields;
    expect(fields["Prismic Models Drift"]!.length).toBeLessThanOrEqual(50_000);
    expect(fields["Prismic Models Drift"]).toMatch(/truncated/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/reports/airtable-prismic-models.test.ts`
Expected: FAIL — `updatePrismicModels is not a function`

- [ ] **Step 3: Write the implementation**

Add to the `WebsiteRow` type (near `turnstileWidget`, `src/reports/airtable/websites.ts:147`):

```ts
/** Nightly Prismic model drift sweep. `pass` = the repo and the Prismic
 *  repository agree; `fail` = they diverge (a model to create/update, or a
 *  model present only in Prismic). null = never ran, or the operator-added
 *  columns do not exist yet. Freshness gated by `prismicModelsCheckedAt`. */
prismicModels: "pass" | "fail" | null;
prismicModelsCheckedAt: string | null;
/** The sweep's own report for this site — what diverged, verbatim. */
prismicModelsDrift: string | null;
```

Add to `mapRow` (near line 418):

```ts
    prismicModels: toVerdict(f["Prismic Models"]),
    prismicModelsCheckedAt: (f["Prismic Models Checked At"] as string | undefined) ?? null,
    prismicModelsDrift: (f["Prismic Models Drift"] as string | undefined) ?? null,
```

Add the writer near `updateGitHubSignals`:

```ts
/** Airtable long-text has a practical cap and the sweep's report can run long on
 *  a badly drifted site. Truncate rather than let the whole write fail — a
 *  truncated finding still tells the operator which site to look at. */
const MAX_DRIFT_CHARS = 50_000;

/**
 * Persist one site's Prismic model verdict.
 *
 * Best-effort AT THE CALL SITE: `Prismic Models*` are operator-added columns, so
 * until they exist Airtable throws UNKNOWN_FIELD_NAME. The nightly sweep must
 * survive that — same contract as `updateNextDueDates`.
 */
export async function updatePrismicModels(
  base: AirtableBase,
  recordId: string,
  verdict: { ok: "pass" | "fail"; checkedAt: string; drift: string | null },
): Promise<void> {
  const drift =
    verdict.drift !== null && verdict.drift.length > MAX_DRIFT_CHARS
      ? `${verdict.drift.slice(0, MAX_DRIFT_CHARS - 20)}\n…[truncated]`
      : verdict.drift;
  const fields: Record<string, string | null> = {
    "Prismic Models": verdict.ok,
    "Prismic Models Checked At": verdict.checkedAt,
    "Prismic Models Drift": drift,
  };
  await base(WEBSITES_TABLE).update([{ id: recordId, fields: fields as FieldSet }]);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/reports/airtable-prismic-models.test.ts && pnpm typecheck`
Expected: PASS — 5 tests, typecheck clean

- [ ] **Step 5: Commit**

```bash
git add src/reports/airtable/websites.ts tests/reports/airtable-prismic-models.test.ts
git commit -m "feat(airtable): Prismic model verdict columns + writer"
```

---

### Task 20: `--write-airtable` on the fleet sweep

**Files:**

- Modify: `src/cli/commands/prismic-models.ts`
- Create: `tests/cli/prismic-models-writeback.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/cli/prismic-models-writeback.test.ts
import { describe, it, expect, vi } from "vitest";
import { writeSweepToAirtable, type SweepRow } from "../../src/cli/commands/prismic-models.js";

const row = (over: Partial<SweepRow> = {}): SweepRow => ({
  site: "Espada",
  repositoryName: "espada",
  clean: true,
  detail: "3 model(s) match Prismic — nothing to push.",
  ...over,
});

const websites = [{ id: "rec1", name: "Espada" }] as Array<{ id: string; name: string }>;

describe("writeSweepToAirtable", () => {
  it("writes pass with a null drift for a clean site", async () => {
    const update = vi.fn(async () => {});
    await writeSweepToAirtable([row()], websites, update, "2026-08-12T06:00:00.000Z");
    expect(update).toHaveBeenCalledWith("rec1", {
      ok: "pass",
      checkedAt: "2026-08-12T06:00:00.000Z",
      drift: null,
    });
  });

  it("writes fail with the report as the drift detail", async () => {
    const update = vi.fn(async () => {});
    await writeSweepToAirtable(
      [row({ clean: false, detail: "CHANGED  slice hero" })],
      websites,
      update,
      "2026-08-12T06:00:00.000Z",
    );
    expect(update.mock.calls[0]![1]).toMatchObject({ ok: "fail", drift: "CHANGED  slice hero" });
  });

  // A site the sweep could not read has NO verdict. Writing `fail` would report
  // a dead token as model drift and send the operator hunting a schema change
  // that never happened; leaving the row alone keeps the last true value and lets
  // the freshness gate age it out.
  it("writes nothing for a site whose check failed (clean === null)", async () => {
    const update = vi.fn(async () => {});
    await writeSweepToAirtable(
      [row({ clean: null })],
      websites,
      update,
      "2026-08-12T06:00:00.000Z",
    );
    expect(update).not.toHaveBeenCalled();
  });

  it("skips a row with no matching Websites record", async () => {
    const update = vi.fn(async () => {});
    const res = await writeSweepToAirtable([row({ site: "Ghost" })], websites, update, "t");
    expect(update).not.toHaveBeenCalled();
    expect(res.failed.map((f) => f.slug)).toEqual(["Ghost"]);
  });

  // The columns are operator-added. Until they exist Airtable throws
  // UNKNOWN_FIELD_NAME on every row — that must not redden the nightly.
  it("records an UNKNOWN_FIELD_NAME as a soft failure and keeps going", async () => {
    const update = vi.fn(async () => {
      throw new Error("UNKNOWN_FIELD_NAME: Prismic Models");
    });
    const res = await writeSweepToAirtable([row(), row({ site: "Espada" })], websites, update, "t");
    expect(update).toHaveBeenCalledTimes(2);
    expect(res.written).toHaveLength(0);
    expect(res.failed).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/cli/prismic-models-writeback.test.ts`
Expected: FAIL — `writeSweepToAirtable is not exported`

- [ ] **Step 3: Write the implementation (append to `src/cli/commands/prismic-models.ts`)**

```ts
// append to src/cli/commands/prismic-models.ts
import { siteSlug } from "../../reports/airtable/websites.js";
import type { FleetWriteResult } from "../../audits/write-audits-to-airtable.js";

type UpdateVerdictFn = (
  recordId: string,
  verdict: { ok: "pass" | "fail"; checkedAt: string; drift: string | null },
) => Promise<void>;

/**
 * Persist a fleet sweep to Airtable, serially (Airtable's ~5 req/sec limit,
 * matching every other fleet writer).
 *
 * A row whose check FAILED (`clean === null`) is left untouched. Writing `fail`
 * for an unreadable site would report a dead token as model drift and send the
 * operator looking for a schema change that never happened; the freshness gate
 * in the collector ages the stale row out instead.
 */
export async function writeSweepToAirtable(
  rows: SweepRow[],
  websites: Array<{ id: string; name: string }>,
  update: UpdateVerdictFn,
  checkedAt: string,
): Promise<FleetWriteResult> {
  const byName = new Map(websites.map((w) => [w.name, w]));
  const result: FleetWriteResult = { written: [], failed: [] };
  for (const row of rows) {
    if (row.clean === null) continue;
    const target = byName.get(row.site);
    if (!target) {
      result.failed.push({ slug: siteSlug(row.site), error: "no Websites row matched" });
      continue;
    }
    try {
      await update(target.id, {
        ok: row.clean ? "pass" : "fail",
        checkedAt,
        drift: row.clean ? null : row.detail,
      });
      result.written.push({
        siteName: target.name,
        writes: [{ audit: "prismic-models", counts: {} }],
      });
    } catch (e) {
      result.failed.push({ slug: siteSlug(row.site), error: (e as Error).message });
    }
  }
  return result;
}
```

Wire it into the fleet branch of `runPrismicModelsCommand`:

```ts
if (opts.writeAirtable) {
  const { openBase, readAirtableConfig } = await import("../../reports/airtable/client.js");
  const { listWebsites, updatePrismicModels } = await import("../../reports/airtable/websites.js");
  const base = openBase(readAirtableConfig());
  const websites = await listWebsites(base);
  const w = await writeSweepToAirtable(
    rows,
    websites,
    (id, verdict) => updatePrismicModels(base, id, verdict),
    new Date().toISOString(),
  );
  const { formatFleetWriteSummary } = await import("../../audits/write-audits-to-airtable.js");
  return {
    output: appendSkipNotice(`${body}\n\n${formatFleetWriteSummary(w)}`, skipped),
    code: prismicSweepExitCode(checked, failed),
  };
}
```

Note `siteSlug(row.site)` matches on the Airtable Website NAME (Sonder, not gallerysonder) — `siteLabel(site)` returns `site.name` when set, which the Airtable inventory populates from that column.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/cli/prismic-models-writeback.test.ts && pnpm typecheck`
Expected: PASS — 5 tests, typecheck clean

- [ ] **Step 5: Commit**

```bash
git add src/cli/commands/prismic-models.ts tests/cli/prismic-models-writeback.test.ts
git commit -m "feat(prismic): fleet sweep writes each verdict to Airtable, never on a read failure"
```

---

### Task 21: `collectPrismicDriftAlerts`

**Files:**

- Modify: `src/alerts/attention.ts` (add `"prismic-drift"` to `AttentionItem["kind"]`)
- Modify: `src/alerts/digest-collectors.ts`
- Create: `tests/alerts/prismic-drift-alerts.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/alerts/prismic-drift-alerts.test.ts
import { describe, it, expect } from "vitest";
import { collectPrismicDriftAlerts } from "../../src/alerts/digest-collectors.js";
import type { WebsiteRow } from "../../src/reports/airtable/websites.js";

const NOW = new Date("2026-08-12T09:00:00.000Z");
const site = (over: Partial<WebsiteRow> = {}): WebsiteRow =>
  ({
    id: "rec1",
    name: "Espada",
    prismicModels: "fail",
    prismicModelsCheckedAt: "2026-08-12T06:00:00.000Z",
    prismicModelsDrift: "CHANGED  slice hero",
    ...over,
  }) as WebsiteRow;

describe("collectPrismicDriftAlerts", () => {
  it("raises one warning item for a drifting site", () => {
    const items = collectPrismicDriftAlerts([site()], "https://dash", NOW);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      key: "prismic-drift:rec1",
      kind: "prismic-drift",
      siteName: "Espada",
      severity: "warning",
      metric: 1,
    });
    expect(items[0]!.url).toContain("https://dash");
  });

  it("says nothing for a clean site", () => {
    expect(
      collectPrismicDriftAlerts([site({ prismicModels: "pass" })], "https://dash", NOW),
    ).toEqual([]);
  });

  it("says nothing when the sweep has never run (null verdict)", () => {
    expect(collectPrismicDriftAlerts([site({ prismicModels: null })], "https://dash", NOW)).toEqual(
      [],
    );
  });

  // A repo that stopped being swept must not show a phantom alarm forever —
  // same 3-day gate as the GitHub-signals and Turnstile collectors.
  it("drops a verdict older than 3 days", () => {
    const items = collectPrismicDriftAlerts(
      [site({ prismicModelsCheckedAt: "2026-08-05T06:00:00.000Z" })],
      "https://dash",
      NOW,
    );
    expect(items).toEqual([]);
  });

  it("keeps a verdict whose timestamp is unparseable — never silently drop a real failure", () => {
    const items = collectPrismicDriftAlerts(
      [site({ prismicModelsCheckedAt: "not a date" })],
      "https://dash",
      NOW,
    );
    expect(items).toHaveLength(1);
  });

  it("keeps a verdict with a null timestamp", () => {
    expect(
      collectPrismicDriftAlerts([site({ prismicModelsCheckedAt: null })], "https://dash", NOW),
    ).toHaveLength(1);
  });

  it("puts the first line of the drift detail in the title so the feed is actionable", () => {
    const items = collectPrismicDriftAlerts(
      [site({ prismicModelsDrift: "NEW  slice hero  (src/lib/slices/Hero/model.json)\nmore" })],
      "https://dash",
      NOW,
    );
    expect(items[0]!.title).toContain("NEW  slice hero");
  });

  it("falls back to a generic title when there is no detail", () => {
    const items = collectPrismicDriftAlerts(
      [site({ prismicModelsDrift: null })],
      "https://dash",
      NOW,
    );
    expect(items[0]!.title).toMatch(/diverge/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/alerts/prismic-drift-alerts.test.ts`
Expected: FAIL — `collectPrismicDriftAlerts is not a function`

- [ ] **Step 3: Write the implementation**

In `src/alerts/attention.ts`, add `| "prismic-drift"` to the `kind` union.

Append to `src/alerts/digest-collectors.ts`:

```ts
/** A model sweep older than this can't confirm the CURRENT state. The sweep is
 *  nightly, so 3 days (mirrors GITHUB_SIGNALS_STALE_DAYS) tolerates a weekend of
 *  runner flakes without letting a months-old verdict drive an alarm. */
const PRISMIC_DRIFT_STALE_DAYS = 3;

/** How long a `pass` may go unrefreshed before it is treated as unverified.
 *
 *  Deliberately LONGER than the drift window. The two windows answer opposite
 *  questions and the asymmetry is the point: an old `fail` is dropped because it
 *  may already be fixed, so 3 days keeps the alarm current. An old `pass` is
 *  ESCALATED because nobody has re-established it, and firing that at 3 days
 *  would alarm on a long weekend of runner flakes — the noise that gets a real
 *  alarm muted. A week means a `pass` nobody has confirmed for seven nights is
 *  surfaced, which is the interval over which a silently-dead nightly matters. */
const PRISMIC_STALE_PASS_DAYS = 7;

/**
 * One item per site whose repo and Prismic repository disagree, from the nightly
 * `prismic-models --fleet` sweep. PURE. Keyed `prismic-drift:<siteId>`; `metric`
 * 1 (binary); severity `warning`.
 *
 * `warning`, not `critical`: once CI owns delivery, drift means either an
 * out-of-band cloud edit or a push that did not land — both need a human, but
 * neither is actively losing leads or breaking a live page. Reserving `critical`
 * for the guardrails that are (Turnstile, delivery) keeps this signal legible.
 *
 * This is the only detector that can catch the silent-field-drop class. A unit
 * test cannot: the LOCAL model is correct — the binding constraint is the REMOTE
 * one, which needs the network.
 */
export function collectPrismicDriftAlerts(
  sites: WebsiteRow[],
  baseUrl: string,
  now: Date = new Date(),
): AttentionItem[] {
  const items: AttentionItem[] = [];
  for (const s of sites) {
    // THREE verdicts, not two — and this gate was HALF A GATE while it only knew
    // about "fail".
    //
    // `unknown` means the check RAN AND COULD NOT ANSWER: an unreadable checkout,
    // a dead write token, an unreachable Prismic. It must alarm. It is not drift,
    // so it gets its own wording — reporting a dead token as "models diverge"
    // sends the operator to fix a model when the job is to fix a secret.
    //
    // And the staleness rule was asymmetric in the dangerous direction. A stale
    // `fail` ages out after PRISMIC_DRIFT_STALE_DAYS; a stale `pass` was
    // IMMORTAL, because the loop skipped it before any freshness check ran. Prior
    // to the `unknown` verdict a failed sweep wrote nothing at all, so yesterday's
    // `pass` simply stood — a token that died on Monday read healthy forever.
    // Writing `unknown` closes the common case, but a site that stops being swept
    // ENTIRELY (dropped from the inventory, nightly disabled) still leaves a green
    // verdict behind, so `pass` gets a freshness gate of its own.
    if (s.prismicModels === "pass") {
      const at = s.prismicModelsCheckedAt;
      const ageMs = at === null ? Number.POSITIVE_INFINITY : now.getTime() - Date.parse(at);
      // A `pass` with no timestamp, an unparseable one, or one past the window is
      // a verdict nobody has re-established. Alarm rather than trust it.
      if (!Number.isFinite(ageMs) || ageMs > PRISMIC_STALE_PASS_DAYS * MS_PER_DAY) {
        items.push({
          key: `prismic-stale:${s.id}`,
          kind: "prismic-drift",
          siteName: s.name,
          title: `Prismic model check has not run recently — the last "pass" is unverified`,
          url: dashboardUrl(baseUrl, s.name),
          severity: "warning",
          metric: 1,
        });
      }
      continue;
    }

    if (s.prismicModels === "unknown") {
      const first = s.prismicModelsDrift?.split("\n").find((l) => l.trim() !== "");
      items.push({
        key: `prismic-unknown:${s.id}`,
        kind: "prismic-drift",
        siteName: s.name,
        title: first
          ? `Prismic model check could not run — ${first.trim()}`
          : "Prismic model check could not run",
        url: dashboardUrl(baseUrl, s.name),
        severity: "warning",
        metric: 1,
      });
      continue;
    }

    if (s.prismicModels !== "fail") continue;
    const at = s.prismicModelsCheckedAt;
    if (at !== null) {
      const ageMs = now.getTime() - Date.parse(at);
      // Parseable and beyond the window → stale, dropped. Unparseable (NaN) keeps
      // the item — never silently drop a real failure.
      if (Number.isFinite(ageMs) && ageMs > PRISMIC_DRIFT_STALE_DAYS * MS_PER_DAY) continue;
    }
    const first = s.prismicModelsDrift?.split("\n").find((l) => l.trim() !== "");
    items.push({
      key: `prismic-drift:${s.id}`,
      kind: "prismic-drift",
      siteName: s.name,
      title: first
        ? `Prismic models diverge from the repo — ${first.trim()}`
        : "Prismic models diverge from the repo",
      url: dashboardUrl(baseUrl, s.name),
      severity: "warning",
      metric: 1,
    });
  }
  return items;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/alerts/prismic-drift-alerts.test.ts && pnpm typecheck`
Expected: PASS — 8 tests, typecheck clean

- [ ] **Step 5: Commit**

```bash
git add src/alerts/attention.ts src/alerts/digest-collectors.ts tests/alerts/prismic-drift-alerts.test.ts
git commit -m "feat(alerts): collectPrismicDriftAlerts, 3-day freshness gate"
```

---

### Task 22: wire the collector into the cockpit and the digest

**Files:**

- Modify: `src/dashboard/fleet-cockpit.ts` (import at line ~22, spread at line ~514)
- Modify: `src/reports/digest.ts` (import at line ~14, `runCollector` at line ~333)
- Create: `tests/dashboard/prismic-drift-wiring.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/dashboard/prismic-drift-wiring.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const src = (rel: string) =>
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../src", rel), "utf-8");

// A collector nobody calls is the alarm-inversion failure: a nightly verdict
// that reaches the cockpit nowhere. These are cheap tripwires against exactly that.
describe("prismic drift wiring", () => {
  it("the cockpit calls collectPrismicDriftAlerts", () => {
    const s = src("dashboard/fleet-cockpit.ts");
    expect(s).toContain("collectPrismicDriftAlerts");
    expect(s).toContain("...collectPrismicDriftAlerts(sites, baseUrl, now)");
  });

  it("the digest calls collectPrismicDriftAlerts through runCollector", () => {
    const s = src("reports/digest.ts");
    expect(s).toContain('runCollector("prismic-drift"');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/dashboard/prismic-drift-wiring.test.ts`
Expected: FAIL — neither file mentions `collectPrismicDriftAlerts`

- [ ] **Step 3: Write the implementation**

In `src/dashboard/fleet-cockpit.ts`, add `collectPrismicDriftAlerts` to the existing import from `../alerts/digest-collectors.js` and add to the items array beside `collectCiAlerts`:

```ts
    ...collectPrismicDriftAlerts(sites, baseUrl, now),
```

In `src/reports/digest.ts`, add the same import and, beside the `ci` collector:

```ts
    ...runCollector("prismic-drift", () => collectPrismicDriftAlerts(websites, deps.baseUrl, now)),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/dashboard/ tests/reports/ && pnpm typecheck`
Expected: PASS — the new wiring tests plus every existing cockpit/digest suite still green

- [ ] **Step 5: Commit**

```bash
git add src/dashboard/fleet-cockpit.ts src/reports/digest.ts tests/dashboard/prismic-drift-wiring.test.ts
git commit -m "feat(cockpit): surface Prismic model drift in the cockpit and the digest"
```

---

## Phase E — CI delivery

### Task 23: the nightly fleet drift workflow

**Files:**

- Create: `.github/workflows/fleet-prismic-drift.yml`
- Create: `tests/build/fleet-prismic-drift-workflow.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/build/fleet-prismic-drift-workflow.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const wf = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../../.github/workflows/fleet-prismic-drift.yml"),
  "utf-8",
);

describe("fleet-prismic-drift workflow", () => {
  it("runs nightly before the 09:23 draft cron", () => {
    expect(wf).toMatch(/cron: "0 5 \* \* \*"/);
  });

  it("runs the sweep read-only — never --apply", () => {
    expect(wf).toContain("prismic-models --fleet airtable --write-airtable");
    expect(wf).not.toContain("--apply");
  });

  it("has no write permissions beyond the tracking issue", () => {
    expect(wf).toMatch(/contents: read/);
    expect(wf).toMatch(/issues: write/);
    expect(wf).not.toMatch(/contents: write/);
  });

  // Every per-site token has to be present for the sweep to read every fleet repository.
  it("passes the per-repo Prismic tokens through as an env block", () => {
    expect(wf).toContain("PRISMIC_TOKEN_");
    expect(wf).toContain("secrets.");
  });

  it("pins every action to a commit SHA, not a mutable tag", () => {
    const uses = [...wf.matchAll(/uses: (\S+)/g)].map((m) => m[1]!);
    expect(uses.length).toBeGreaterThan(0);
    for (const u of uses) expect(u).toMatch(/@[0-9a-f]{40}$/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/build/fleet-prismic-drift-workflow.test.ts`
Expected: FAIL — ENOENT `.github/workflows/fleet-prismic-drift.yml`

- [ ] **Step 3: Write the workflow**

```yaml
# .github/workflows/fleet-prismic-drift.yml
name: fleet-prismic-drift

# Nightly: does every fleet repo's content model still match the models
# REGISTERED in its Prismic repository? This is the instrument that proved the
# fleet clean before auto-push was enabled, the detector for out-of-band cloud
# edits (Type Builder, a hand-edit in the dashboard, a stray Slice Machine
# push), and the ONLY thing that can catch the silent-field-drop class — a unit
# test cannot, because the local model is correct and the binding constraint is
# the remote one.
#
# Read-only by construction: the command's fleet mode has no --apply path. A
# fleet-wide model push outside CI is 🔴 under AUTONOMY.md.
#
# 05:00 UTC — ahead of the 06:00 security sweep and the 09:23 report drafts, so
# a fresh verdict is on the row before the digest reads it.
on:
  schedule:
    - cron: "0 5 * * *"
  workflow_dispatch: {}

concurrency:
  group: fleet-prismic-drift
  cancel-in-progress: false

permissions:
  contents: read
  issues: write # open/close the nightly-failure tracking issue

jobs:
  drift:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7
      - uses: pnpm/action-setup@0977fd99725f1db4007ccb2928dbb4e90d06cc86 # v6
      - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7
        with:
          node-version: "24"
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm build

      # Fleet mode clones each site, so it needs a fleet-read token — the same
      # reddoor-renovate App identity the other fleet sweeps use.
      - uses: actions/create-github-app-token@bcd2ba49218906704ab6c1aa796996da409d3eb1 # v3.2.0
        id: app-token
        with:
          app-id: ${{ vars.RENOVATE_APP_ID }}
          private-key: ${{ secrets.RENOVATE_APP_PRIVATE_KEY }}
          owner: reddoorla

      # One PRISMIC_TOKEN_<REPOSITORY_NAME> per Prismic repository. Fleet mode
      # deliberately refuses the generic PRISMIC_WRITE_TOKEN — one generic token
      # in the environment while iterating every fleet repository would attach the wrong
      # credential to every site after the first. A repository with no secret
      # here is reported by `--tokens` as MISSING, not silently skipped.
      #
      # THE NAME COMES FROM THE PRISMIC repositoryName, NOT THE REPO SLUG. They
      # differ on real sites, verified 2026-08-12 by running readPrismicConfig
      # over every cloned fleet repo:
      #   medical-solutions-of-texas -> msot
      #   reddoor-website            -> reddoor-la
      #   beachfront-dentistry       -> 48bb12d1   (a hash, not a name)
      # An earlier draft of this list said PRISMIC_TOKEN_MEDICAL_SOLUTIONS_OF_TEXAS.
      # That secret would never have resolved, the sweep would have reported the
      # site as MISSING a token, and the fix would have looked like a credentials
      # problem rather than a naming one.
      #
      # Add a line per site as tokens are minted, and take the names from
      # `node dist/cli/bin.js prismic-models --fleet airtable --tokens` — it
      # derives them from each site's own config and is the only authority here.
      - name: Sweep the fleet for Prismic model drift
        id: sweep
        continue-on-error: true
        timeout-minutes: 30
        env:
          AIRTABLE_PAT: ${{ secrets.AIRTABLE_PAT }}
          AIRTABLE_BASE_ID: ${{ secrets.AIRTABLE_BASE_ID }}
          GH_TOKEN: ${{ steps.app-token.outputs.token }}
          PRISMIC_TOKEN_ALAMO_ANATOMY: ${{ secrets.PRISMIC_TOKEN_ALAMO_ANATOMY }}
          PRISMIC_TOKEN_CALTEX_LANDING: ${{ secrets.PRISMIC_TOKEN_CALTEX_LANDING }}
          PRISMIC_TOKEN_ERP_INDUSTRIAL: ${{ secrets.PRISMIC_TOKEN_ERP_INDUSTRIAL }}
          PRISMIC_TOKEN_ESPADA: ${{ secrets.PRISMIC_TOKEN_ESPADA }}
          PRISMIC_TOKEN_GALLERYSONDER: ${{ secrets.PRISMIC_TOKEN_GALLERYSONDER }}
          PRISMIC_TOKEN_HEDLOC: ${{ secrets.PRISMIC_TOKEN_HEDLOC }}
          # medical-solutions-of-texas's Prismic repository is named "msot".
          PRISMIC_TOKEN_MSOT: ${{ secrets.PRISMIC_TOKEN_MSOT }}
          PRISMIC_TOKEN_REVOGEN: ${{ secrets.PRISMIC_TOKEN_REVOGEN }}
          PRISMIC_TOKEN_THE_POINTE_BURBANK: ${{ secrets.PRISMIC_TOKEN_THE_POINTE_BURBANK }}
          PRISMIC_TOKEN_THE_TOWER_BURBANK: ${{ secrets.PRISMIC_TOKEN_THE_TOWER_BURBANK }}
          PRISMIC_TOKEN_VINEYARD_CUSTOM_HOMES: ${{ secrets.PRISMIC_TOKEN_VINEYARD_CUSTOM_HOMES }}
        run: node dist/cli/bin.js prismic-models --fleet airtable --write-airtable

      - name: Fail the run if the sweep failed
        if: steps.sweep.outcome == 'failure'
        run: |
          echo "::error::the Prismic model drift sweep failed (majority of the fleet unreadable)"
          exit 1

      - name: Open/update the prismic-drift-sweep-failing tracking issue
        if: failure()
        continue-on-error: true
        env:
          GH_TOKEN: ${{ github.token }}
        run: |
          title="Prismic model drift sweep failing"
          run_url="${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}"
          body=$(printf 'The nightly **fleet-prismic-drift** sweep failed.\n\nRun: %s\n\n_Auto-filed; auto-closes on the next green run._' "$run_url")
          existing=$(gh issue list --state open --json number,title \
            --jq "map(select(.title==\"$title\")) | .[0].number // empty" || true)
          if [ -n "$existing" ]; then
            gh issue comment "$existing" --body "$body"
          else
            gh issue create --title "$title" --body "$body"
          fi

      - name: Close the tracking issue on recovery
        if: success()
        continue-on-error: true
        env:
          GH_TOKEN: ${{ github.token }}
        run: |
          title="Prismic model drift sweep failing"
          for n in $(gh issue list --state open --json number,title \
            --jq "map(select(.title==\"$title\")) | .[].number" || true); do
            gh issue close "$n" --comment "Recovered — the Prismic drift sweep is green again."
          done
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/build/fleet-prismic-drift-workflow.test.ts && pnpm lint`
Expected: PASS — 5 tests; prettier accepts the YAML

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/fleet-prismic-drift.yml tests/build/fleet-prismic-drift-workflow.test.ts
git commit -m "ci: nightly Prismic model drift sweep, read-only, tracked by an issue"
```

> **Operator step (🔴, cannot be automated):** set the `PRISMIC_TOKEN_*` secrets on `reddoorla/reddoor-maintenance`. `node dist/cli/bin.js prismic-models --fleet airtable --tokens` prints the exact names and which are MISSING. Secrets are 🔴 under `AUTONOMY.md:47`.

---

### Task 24: the reusable workflow, authored here

**Files:**

- Create: `workflows/reusable/prismic-models.yml`
- Create: `tests/build/reusable-prismic-workflow.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/build/reusable-prismic-workflow.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const wf = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../../workflows/reusable/prismic-models.yml"),
  "utf-8",
);

describe("reusable prismic-models workflow", () => {
  it("is workflow_call only", () => {
    expect(wf).toContain("workflow_call:");
    expect(wf).not.toMatch(/^on:\s*\n\s*(push|pull_request):/m);
  });

  it("takes the write token as a secret, never an input", () => {
    expect(wf).toMatch(/secrets:\s*\n\s*prismic-write-token:/);
  });

  // The PR path must be incapable of writing to Prismic. A --dry that could be
  // flipped by a workflow input is a push that fires on any fork PR.
  it("uses --dry on pull_request and --apply only on a push to main", () => {
    expect(wf).toMatch(/github\.event_name == 'pull_request'/);
    expect(wf).toContain("--comment-file");
    expect(wf).toMatch(/github\.event_name == 'push'/);
    expect(wf).toContain("--apply");
  });

  it("posts the delta as a PR comment with pull-requests: write only on the PR path", () => {
    expect(wf).toContain("pull-requests: write");
    expect(wf).toContain("gh pr comment");
  });

  it("pins every action to a commit SHA", () => {
    for (const m of wf.matchAll(/uses: (\S+)/g)) expect(m[1]!).toMatch(/@[0-9a-f]{40}$/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/build/reusable-prismic-workflow.test.ts`
Expected: FAIL — ENOENT `workflows/reusable/prismic-models.yml`

- [ ] **Step 3: Write the workflow**

````yaml
# workflows/reusable/prismic-models.yml
#
# SOURCE OF TRUTH for reddoorla/.github/.github/workflows/prismic-models.yml.
# Authored here so it is tested and reviewed in the same PR as the CLI it calls;
# Task 25 copies it into reddoorla/.github and tags a release.
#
# Two paths, and the split is the safety property:
#   pull_request -> --dry, posts the model delta as a PR comment. CANNOT write to
#                   Prismic: the command's dry path never calls sendModel.
#   push to main -> --apply. The PR was the review gate (AUTONOMY.md 🟢).
#
# Deletion is impossible on both paths — the models module exports no delete.
name: prismic-models

on:
  workflow_call:
    inputs:
      node-version:
        type: string
        default: "24"
    secrets:
      prismic-write-token:
        required: true

jobs:
  prismic-models:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write # the PR comment; nothing here pushes code
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7
      - uses: pnpm/action-setup@0977fd99725f1db4007ccb2928dbb4e90d06cc86 # v6
      - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7
        with:
          node-version: ${{ inputs.node-version }}
          cache: pnpm
      - run: pnpm install --frozen-lockfile

      # Sites already depend on @reddoorla/maintenance, so this is the installed
      # bin — no extra install, and the version is whatever the site's lockfile
      # pins (Renovate moves it like any other dependency).
      - name: Show the model delta
        if: github.event_name == 'pull_request'
        env:
          PRISMIC_WRITE_TOKEN: ${{ secrets.prismic-write-token }}
        run: pnpm exec reddoor-maint prismic-models --comment-file prismic-models.txt

      - name: Post the delta as a PR comment
        if: github.event_name == 'pull_request'
        env:
          GH_TOKEN: ${{ github.token }}
        run: |
          {
            echo '### Prismic model delta'
            echo
            echo '```'
            cat prismic-models.txt
            echo '```'
          } > comment.md
          gh pr comment "${{ github.event.pull_request.number }}" --body-file comment.md

      - name: Push the models to Prismic
        if: github.event_name == 'push'
        env:
          PRISMIC_WRITE_TOKEN: ${{ secrets.prismic-write-token }}
        run: pnpm exec reddoor-maint prismic-models --apply
````

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/build/reusable-prismic-workflow.test.ts && pnpm lint`
Expected: PASS — 5 tests, lint clean

- [ ] **Step 5: Commit**

```bash
git add workflows/reusable/prismic-models.yml tests/build/reusable-prismic-workflow.test.ts
git commit -m "ci: author the reusable prismic-models workflow (dry on PR, apply on main)"
```

---

### Task 25: publish the reusable workflow to `reddoorla/.github`

This task lands a PR in a different repository. It runs outside the worktree.

- [ ] **Step 1: Clone and branch**

```bash
cd "$(mktemp -d)" && gh repo clone reddoorla/.github dot-github && cd dot-github
git checkout -b feat/prismic-models-reusable-workflow
```

- [ ] **Step 2: Copy the authored workflow**

```bash
cp ~/Documents/GitHub/reddoor-maintenance/.claude/worktrees/prismic-types-headless-delivery/workflows/reusable/prismic-models.yml \
   .github/workflows/prismic-models.yml
```

- [ ] **Step 3: Verify it parses as a reusable workflow**

Run: `gh workflow list --repo reddoorla/.github` after merge; before merge, confirm locally:

```bash
python3 -c "import yaml,sys; d=yaml.safe_load(open('.github/workflows/prismic-models.yml')); assert 'workflow_call' in d[True], d; print('workflow_call OK')"
```

Expected: `workflow_call OK`

- [ ] **Step 4: Commit, push, PR**

```bash
git add .github/workflows/prismic-models.yml
git commit -m "feat: reusable prismic-models workflow

Dry-run + PR comment on pull_request; --apply on push to main. Source of truth
lives in reddoor-maintenance at workflows/reusable/prismic-models.yml."
git push -u origin feat/prismic-models-reusable-workflow
gh pr create --title "Reusable prismic-models workflow" --body "Delivers Prismic model changes from a merged PR. Companion to reddoor-maintenance's \`prismic-models\` command. Dry-run comments on PRs; --apply on merge to main; deletion is impossible (the models module exports no delete path)."
```

- [ ] **Step 5: After merge — tag a release and record the pinned SHA**

```bash
gh release create v1.4.0 --repo reddoorla/.github --title v1.4.0 --notes "Add reusable prismic-models workflow"
gh api repos/reddoorla/.github/commits/v1.4.0 --jq .sha
```

Record that SHA — Task 26's caller template pins it.

---

### Task 26: the `prismic-ci` rollout recipe

**Files:**

- Modify: `src/types.ts` (add `"prismic-ci"` to `RecipeName`)
- Create: `src/recipes/prismic-ci/index.ts`
- Create: `src/recipes/prismic-ci/template.ts`
- Create: `tests/recipes/prismic-ci.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/recipes/prismic-ci.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, writeFile, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prismicCi } from "../../src/recipes/prismic-ci/index.js";
import { PRISMIC_CI_WORKFLOW } from "../../src/recipes/prismic-ci/template.js";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "prismic-ci-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const site = () => ({ path: dir, name: "Espada", gitRepo: "reddoorla/espada" });

const deps = (over: Record<string, unknown> = {}) => ({
  github: {
    defaultBranch: vi.fn(async () => "main"),
    repoSecretExists: vi.fn(async () => true),
    openPullRequest: vi.fn(async () => ({ url: "https://github.com/reddoorla/espada/pull/9" })),
    fileContentsOnBranch: vi.fn(async () => null),
  },
  pushBranch: vi.fn(async () => {}),
  ...over,
});

describe("PRISMIC_CI_WORKFLOW", () => {
  it("calls the reusable workflow pinned to a SHA", () => {
    expect(PRISMIC_CI_WORKFLOW).toMatch(
      /uses: reddoorla\/\.github\/\.github\/workflows\/prismic-models\.yml@[0-9a-f]{40}/,
    );
  });

  it("triggers on model paths only, on both pull_request and push to main", () => {
    expect(PRISMIC_CI_WORKFLOW).toContain("customtypes/**");
    expect(PRISMIC_CI_WORKFLOW).toContain("src/lib/slices/**/model.json");
    expect(PRISMIC_CI_WORKFLOW).toContain("pull_request:");
    expect(PRISMIC_CI_WORKFLOW).toContain("branches: [main]");
  });

  it("passes the site's own PRISMIC_WRITE_TOKEN secret through", () => {
    expect(PRISMIC_CI_WORKFLOW).toContain(
      "prismic-write-token: ${{ secrets.PRISMIC_WRITE_TOKEN }}",
    );
  });
});

describe("prismicCi", () => {
  it("noops on a repo with no Prismic config", async () => {
    const r = await prismicCi(site(), deps());
    expect(r.status).toBe("noop");
    expect(r.notes).toMatch(/not a Prismic site/i);
  });

  // A workflow whose secret is absent goes red on its first PR. Landing it
  // before the operator sets the secret converts a rollout into 18 red repos.
  it("noops when the repo has no PRISMIC_WRITE_TOKEN secret, naming what to set", async () => {
    await writeFile(
      join(dir, "slicemachine.config.json"),
      JSON.stringify({ repositoryName: "espada" }),
    );
    const d = deps();
    d.github.repoSecretExists = vi.fn(async () => false);
    const r = await prismicCi(site(), d);
    expect(r.status).toBe("noop");
    expect(r.notes).toContain("PRISMIC_WRITE_TOKEN");
  });

  it("noops when the workflow is already on the default branch and identical", async () => {
    await writeFile(
      join(dir, "slicemachine.config.json"),
      JSON.stringify({ repositoryName: "espada" }),
    );
    const d = deps();
    d.github.fileContentsOnBranch = vi.fn(async () => PRISMIC_CI_WORKFLOW);
    expect((await prismicCi(site(), d)).status).toBe("noop");
  });

  it("writes the workflow, commits, pushes, and opens a PR", async () => {
    await writeFile(
      join(dir, "slicemachine.config.json"),
      JSON.stringify({ repositoryName: "espada" }),
    );
    await mkdir(join(dir, "customtypes", "page"), { recursive: true });
    const d = deps();
    const r = await prismicCi(site(), d);
    expect(r.status).toBe("applied");
    expect(await readFile(join(dir, ".github/workflows/prismic-models.yml"), "utf-8")).toBe(
      PRISMIC_CI_WORKFLOW,
    );
    expect(d.github.openPullRequest).toHaveBeenCalled();
    expect(r.notes).toContain("https://github.com/reddoorla/espada/pull/9");
  });

  it("formats the written workflow with the site's own prettier", async () => {
    await writeFile(
      join(dir, "slicemachine.config.json"),
      JSON.stringify({ repositoryName: "espada" }),
    );
    const spawn = vi.fn(async () => ({ code: 0, stdout: "", stderr: "" }));
    await prismicCi(site(), deps({ spawn }));
    expect(spawn).toHaveBeenCalledWith(
      "pnpm",
      ["exec", "prettier", "--write", ".github/workflows/prismic-models.yml"],
      { cwd: dir },
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/recipes/prismic-ci.test.ts`
Expected: FAIL — cannot resolve `../../src/recipes/prismic-ci/index.js`

- [ ] **Step 3: Write the implementation**

`src/types.ts` — add `| "prismic-ci"` to `RecipeName`, and a line to `RECIPE_DESCRIPTIONS` in `src/cli/bin.ts`:

```ts
  "prismic-ci": "Add the Prismic model delivery workflow to a site via PR (dry on PRs, push on merge).",
```

`src/recipes/prismic-ci/template.ts` — replace `<SHA>` with the SHA recorded in Task 25:

```ts
/** The caller workflow every Prismic site gets. Fully generic — no per-site
 *  values — because the token is the site's own `PRISMIC_WRITE_TOKEN` secret,
 *  the name every site's code already reads. Contrast ci.yml, which is
 *  deliberately NOT templated because it carries per-site `netlify-site:`.
 *
 *  Path-filtered: this must not run on every commit, only when a model changes. */
export const PRISMIC_CI_WORKFLOW = `name: prismic-models
on:
  pull_request:
    paths:
      - "customtypes/**"
      - "src/lib/slices/**/model.json"
  push:
    branches: [main]
    paths:
      - "customtypes/**"
      - "src/lib/slices/**/model.json"
jobs:
  prismic-models:
    permissions:
      contents: read
      pull-requests: write
    uses: reddoorla/.github/.github/workflows/prismic-models.yml@<SHA> # v1.4.0
    secrets:
      prismic-write-token: \${{ secrets.PRISMIC_WRITE_TOKEN }}
`;
```

`src/recipes/prismic-ci/index.ts` — same branch/push/PR/restore shape as `selfUpdating` (`src/recipes/self-updating/index.ts:120-307`):

```ts
// src/recipes/prismic-ci/index.ts
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { makeSpawn, type SpawnFn } from "../../audits/util/spawn.js";
import { makeGitHub } from "../../github/gh.js";
import { readGitHubConfig } from "../../github/config.js";
import { readPrismicConfig } from "../../prismic/models/index.js";
import type { RecipeResult, Site } from "../../types.js";
import {
  branchName,
  checkoutBranch,
  commit as gitCommit,
  createBranch,
  currentBranch,
  isWorkingTreeClean,
  push as gitPush,
} from "../../util/git.js";
import { siteLabel } from "../../util/site.js";
import { formatWithPrettier, PRETTIER_FLAG_NOTE } from "../_prettier.js";
import { PRISMIC_CI_WORKFLOW } from "./template.js";

const WORKFLOW_PATH = ".github/workflows/prismic-models.yml";
const SECRET = "PRISMIC_WRITE_TOKEN";

export type PrismicCiDeps = {
  github?: {
    defaultBranch: (repo: string) => Promise<string>;
    repoSecretExists: (repo: string, name: string) => Promise<boolean>;
    fileContentsOnBranch: (repo: string, branch: string, path: string) => Promise<string | null>;
    openPullRequest: (
      repo: string,
      opts: { head: string; base: string; title: string; body: string },
    ) => Promise<{ url: string }>;
  };
  pushBranch?: (cwd: string, branch: string) => Promise<void>;
  spawn?: SpawnFn;
};

const resultOf = (
  site: Site,
  status: RecipeResult["status"],
  notes: string,
  commits: string[] = [],
): RecipeResult => ({
  recipe: "prismic-ci",
  site: siteLabel(site),
  status,
  commits,
  notes,
});

/**
 * Land the Prismic model delivery workflow in one repo, as a PR.
 *
 * Three gates run BEFORE any mutation, and the second one is the important one:
 * a workflow whose `PRISMIC_WRITE_TOKEN` secret does not exist yet goes red on
 * the repo's first model PR. Landing 18 of those turns a rollout into 18 red
 * repos and a lost afternoon, so the recipe refuses rather than assumes.
 */
export async function prismicCi(site: Site, deps: PrismicCiDeps = {}): Promise<RecipeResult> {
  const repo = site.gitRepo;
  if (!repo)
    return resultOf(site, "noop", "no gitRepo on this site — nothing to open a PR against");

  const cfg = await readPrismicConfig(site.path);
  if (!cfg) return resultOf(site, "noop", "not a Prismic site (no repositoryName) — skipped");

  // Same guard order as selfUpdating: an injected github wins, and a missing
  // token is a clean `failed` rather than a non-null assertion that throws.
  const ghConfig = readGitHubConfig();
  if (!deps.github && !ghConfig) return resultOf(site, "failed", "GITHUB_TOKEN not set");
  const gh = deps.github ?? makeGitHub({ token: ghConfig!.token });
  const spawn = deps.spawn ?? makeSpawn();

  if (!(await gh.repoSecretExists(repo, SECRET))) {
    return resultOf(
      site,
      "noop",
      `set the ${SECRET} Actions secret on ${repo} first — the workflow reds the repo without it`,
    );
  }

  const base = await gh.defaultBranch(repo).catch(() => "main");
  if ((await gh.fileContentsOnBranch(repo, base, WORKFLOW_PATH)) === PRISMIC_CI_WORKFLOW) {
    return resultOf(site, "noop", "delivery workflow already current on the default branch");
  }
  if (!(await isWorkingTreeClean(site.path))) {
    return resultOf(site, "failed", "working tree not clean — commit or stash first");
  }

  let original: string | null = null;
  try {
    original = await currentBranch(site.path);
  } catch {
    original = null;
  }
  const branch = branchName("prismic-ci");
  const commits: string[] = [];

  try {
    await createBranch(site.path, branch);
    const dest = join(site.path, WORKFLOW_PATH);
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, PRISMIC_CI_WORKFLOW, "utf-8");
    const formatted = await formatWithPrettier(spawn, site.path, [WORKFLOW_PATH]);
    const sha = await gitCommit(site.path, "ci: deliver Prismic model changes from merged PRs");
    if (sha) commits.push(sha);
    await (deps.pushBranch ?? gitPush)(site.path, branch);
    const pr = await gh.openPullRequest(repo, {
      head: branch,
      base,
      title: "Deliver Prismic model changes from merged PRs",
      body:
        "Adds the `prismic-models` workflow. On a PR touching `customtypes/**` or " +
        "`src/lib/slices/**/model.json` it comments the model delta and writes nothing; " +
        "on merge to main it pushes those models to Prismic. It can create and update " +
        "models but never delete — a model present only in Prismic is reported, not touched.",
    });
    const notes = `opened PR ${pr.url}${formatted ? "" : `; ⚠ ${PRETTIER_FLAG_NOTE}`}`;
    return resultOf(site, "applied", notes, commits);
  } catch (err) {
    return resultOf(site, "failed", err instanceof Error ? err.message : String(err), commits);
  } finally {
    // Restore the operator's branch on success AND on failure — otherwise a push
    // error strands the checkout on the recipe branch and the retry dies at
    // createBranch ("branch already exists"). Best-effort; never masks the result.
    if (original !== null && original !== branch) {
      try {
        await checkoutBranch(site.path, original);
      } catch (err) {
        console.warn(
          `warning: could not restore branch ${original} after prismic-ci: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
  }
}
```

`src/github/gh.ts` — add the secret probe beside the other repo queries:

```ts
  /** Does this repo have an Actions secret by this name? Values are never
   *  readable through the API — only existence — which is exactly what the
   *  rollout gate needs. 404 => absent. */
  repoSecretExists: async (repo: string, name: string): Promise<boolean> => {
    const res = await run(["api", `repos/${repo}/actions/secrets/${name}`], { allowFailure: true });
    return res.code === 0;
  },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/recipes/prismic-ci.test.ts && pnpm typecheck`
Expected: PASS — 8 tests, typecheck clean

- [ ] **Step 5: Commit**

```bash
git add src/types.ts src/cli/bin.ts src/github/gh.ts src/recipes/prismic-ci tests/recipes/prismic-ci.test.ts
git commit -m "feat(recipes): prismic-ci lands the delivery workflow as a per-repo PR

Gated on the repo actually being a Prismic site AND already holding its
PRISMIC_WRITE_TOKEN secret — a workflow landed without its secret reds the repo
on its first model PR."
```

---

### Task 27: expose `prismic-ci` as a fleet command

**Files:**

- Create: `src/cli/commands/prismic-ci.ts`
- Modify: `src/cli/bin.ts`
- Create: `tests/cli/prismic-ci-command.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/cli/prismic-ci-command.test.ts
import { describe, it, expect, vi } from "vitest";
import { formatPrismicCiResults } from "../../src/cli/commands/prismic-ci.js";
import type { RecipeResult } from "../../src/types.js";

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
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/cli/prismic-ci-command.test.ts`
Expected: FAIL — cannot resolve `../../src/cli/commands/prismic-ci.js`

- [ ] **Step 3: Write the implementation**

```ts
// src/cli/commands/prismic-ci.ts
import { resolve } from "node:path";
import { prismicCi } from "../../recipes/prismic-ci/index.js";
import type { RecipeResult } from "../../types.js";
import { resolveSites } from "../fleet/resolve-sites.js";
import { prepareFleetSites, appendSkipNotice, type SkippedSite } from "../fleet/prepare-sites.js";
import { runRecipeOverSites } from "../fleet/run-recipe-over-sites.js";
import { fleetWorkdir } from "../../util/fleet-workdir.js";

/** One line per site plus a counts summary — the shape every fleet rollout
 *  prints, so a sweep over 18 repos is scannable. */
export function formatPrismicCiResults(results: RecipeResult[]): string {
  const lines = results.map((r) => `[${r.site}] ${r.status}: ${r.notes ?? ""}`.trimEnd());
  const n = (s: RecipeResult["status"]) => results.filter((r) => r.status === s).length;
  lines.push("");
  lines.push(`${n("applied")} applied, ${n("noop")} noop, ${n("failed")} failed.`);
  return lines.join("\n");
}

export async function runPrismicCiCommand(
  site: string | undefined,
  opts: { fleet?: string; workdir?: string; cwd?: string },
): Promise<{ output: string; code: number }> {
  const cwd = opts.cwd ? resolve(opts.cwd) : process.cwd();
  let sites = await resolveSites({
    ...(site !== undefined ? { site } : {}),
    ...(opts.fleet !== undefined ? { fleet: opts.fleet } : {}),
    ...(opts.workdir !== undefined ? { workdir: opts.workdir } : {}),
    cwd,
  });
  let skipped: SkippedSite[] = [];
  if (opts.fleet) {
    const prep = await prepareFleetSites(sites, { workdir: opts.workdir ?? fleetWorkdir() });
    sites = prep.prepared;
    skipped = prep.skipped;
  }
  const results = await runRecipeOverSites("prismic-ci", sites, (s) => prismicCi(s));
  return {
    output: appendSkipNotice(formatPrismicCiResults(results), skipped),
    code: results.some((r) => r.status === "failed") ? 1 : 0,
  };
}
```

Register it in `src/cli/bin.ts` beside the other recipe commands:

```ts
cli
  .command("prismic-ci [site]", "Add the Prismic model delivery workflow to a site via PR.")
  .option("--fleet <inventory>", 'Inventory file (.json or .mjs/.js), or "airtable"')
  .option("--workdir <path>", "Clone target for fleet mode (default ~/.reddoor-maint/sites)")
  .action(
    async (site, opts: { fleet?: string; workdir?: string; cwd?: string; verbose?: boolean }) =>
      runOrExit(
        async () => (await import("./commands/prismic-ci.js")).runPrismicCiCommand(site, opts),
        opts,
      ),
  );
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/cli/prismic-ci-command.test.ts && pnpm build && node dist/cli/bin.js list-recipes`
Expected: PASS — 4 tests; `list-recipes` shows `prismic-ci`

- [ ] **Step 5: Commit**

```bash
git add src/cli/commands/prismic-ci.ts src/cli/bin.ts tests/cli/prismic-ci-command.test.ts
git commit -m "feat(cli): prismic-ci fleet command (per-repo PRs, never a mass push)"
```

---

## Phase F — policy, docs, release, rollout

### Task 28: the `AUTONOMY.md` clause

**Files:**

- Modify: `AUTONOMY.md`
- Create: `tests/build/autonomy-prismic-clause.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/build/autonomy-prismic-clause.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const doc = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../../AUTONOMY.md"),
  "utf-8",
);

// Live Prismic model writes were UNCLASSIFIED and are not `git revert`-able.
// An unclassified mutation is one an agent gets to reason about case by case,
// which is exactly how the 2026-07-26 unreviewed majors merged.
describe("AUTONOMY.md — Prismic model writes", () => {
  it("classifies model push via CI on a merged PR", () => {
    expect(doc).toMatch(/model push via CI on a merged PR/i);
  });

  it("classifies model DELETES as red", () => {
    expect(doc).toMatch(/model \*\*deletes\*\*/i);
  });

  it("classifies a fleet-wide model push outside CI as red", () => {
    expect(doc).toMatch(/fleet-wide model push outside CI/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/build/autonomy-prismic-clause.test.ts`
Expected: FAIL — AUTONOMY.md has no Prismic clause

- [ ] **Step 3: Write the clause**

Add to the 🟢 list:

```markdown
- **Prismic model push via CI on a merged PR** — the PR carried the delta as a
  comment and a human merged it, so the review gate already happened. The push
  is `--apply` on `push: main` only, it can create and update but never delete,
  and a model present only in Prismic is reported rather than touched.
```

Add to the 🔴 list, beside "Secrets":

```markdown
- **Prismic model deletes** — always. A model delete destroys published content's
  schema and is not `git revert`-able. The `prismic-models` code has no delete
  path at all (a tripwire test asserts this); deleting a model is a human action
  in the Prismic dashboard.
- **Any fleet-wide Prismic model push outside CI** — same rule as every other
  fleet-wide mutation: it lands as per-repo PRs, never an unattended mass push.
  `prismic-models --fleet` is read-only by construction for this reason.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/build/autonomy-prismic-clause.test.ts && pnpm lint`
Expected: PASS — 3 tests, prettier clean

- [ ] **Step 5: Commit**

```bash
git add AUTONOMY.md tests/build/autonomy-prismic-clause.test.ts
git commit -m "docs(autonomy): classify Prismic model writes (CI push 🟢, deletes 🔴)"
```

---

### Task 29: the runbook

**Files:**

- Create: `docs/runbooks/prismic-model-delivery.md`

- [ ] **Step 1: Write the runbook**

Cover, in this order:

1. **How a model change ships now.** Edit `customtypes/<id>/index.json` or `src/lib/slices/<Dir>/model.json` → PR → the `prismic-models` check comments the delta → merge → CI pushes. Author in Slice Machine locally if you like, commit, **but do not click Push in Slice Machine** — the drift check catches violations.
2. **Minting a write token.** Prismic dashboard → repository → Settings → API & Security → write token. Note the standing unknown: **expiry is undocumented**; the drift check surfaces an expired token as a repo that suddenly fails to READ, and `prismic-models --tokens` distinguishes MISSING from PRESENT BUT 403.
3. **Distributing tokens.** Per-repo: `gh secret set PRISMIC_WRITE_TOKEN --repo reddoorla/<repo>`. Central (for the nightly sweep): `gh secret set PRISMIC_TOKEN_<REPOSITORY_NAME> --repo reddoorla/reddoor-maintenance`. Both are 🔴 operator actions.
4. **Responding to a drift alarm.** Run `reddoor-maint prismic-models <site>` to see the delta. Local ahead → merge a PR touching the model paths, CI pushes. Remote ahead / remote-only → `reddoor-maint prismic-models <site> --pull`, review, PR. Never delete from CI.
5. **The `""` → `null` trap.** If a future change makes `canon` stop dropping `""`, hedloc-shaped sites alarm forever on a divergence that does not exist. `tests/prismic/models/canon.test.ts` is the guard.
6. **Prettier on generated JSON.** Pulled-down models are formatted by the _target repo's_ prettier. A PR that reds on `prettier --check` for a model file means that step did not run — check for the `could not prettier-format` flag in the command output.
7. **Slice Machine's status.** Still installed, still the local visual authoring tool, no longer the delivery path. Declared unmaintained 2026-07-20 with no sunset date; 2.21.5 shipped 17 days later. Do not run `prismic init` — it is destructive (`rm -r`s local slice directories absent from the remote, rewrites package.json + lockfile, AST-edits `vite.config.ts`, and makes remote writes even under `--no-setup`).
8. **Type Builder must stay OFF.** It saves straight to the cloud with no branch, no PR, no CI — enabling it removes Git as the gate. The drift check is the backstop that would catch it being used.

- [ ] **Step 2: Verify it lints**

Run: `pnpm lint`
Expected: PASS — prettier accepts the markdown

- [ ] **Step 3: Commit**

```bash
git add docs/runbooks/prismic-model-delivery.md
git commit -m "docs: Prismic model delivery runbook (tokens, drift response, traps)"
```

---

### Task 30: remove the vestigial `data-dynamiq` Prismic config

`data-dynamiq` has no Prismic but still ships a `slicemachine.config.json` pointing at a repository named `reddoor-wireframer`. Left in place it makes the nightly sweep try to read a repository this site has no token for, and report a false drift alarm forever.

- [ ] **Step 1: Confirm the site really has no Prismic**

```bash
cd ~/Documents/GitHub/data-dynamiq
cat slicemachine.config.json
grep -rn "@prismicio" package.json || echo "no prismic dependency"
ls customtypes src/lib/slices 2>/dev/null || echo "no model directories"
```

Expected: the config names `reddoor-wireframer`; no `@prismicio` dependency; no model directories.

- [ ] **Step 2: Branch and remove**

```bash
git checkout -b chore/remove-vestigial-slicemachine-config
git rm slicemachine.config.json
```

- [ ] **Step 3: Verify the build still passes without it**

Run: `pnpm install --frozen-lockfile && pnpm build`
Expected: PASS — nothing reads the file

- [ ] **Step 4: Commit, push, PR**

```bash
git commit -m "chore: drop the vestigial slicemachine.config.json

This site has no Prismic. The config pointed at a repository named
reddoor-wireframer and would make the nightly Prismic drift sweep report a
permanent false alarm."
git push -u origin chore/remove-vestigial-slicemachine-config
gh pr create --fill
```

- [ ] **Step 5: Confirm the sweep now skips it**

Run (from the maintenance worktree, after `pnpm build`):
`node dist/cli/bin.js prismic-models ~/Documents/GitHub/data-dynamiq`
Expected: `not a Prismic site (no repositoryName) — skipped`, exit 0

---

### Task 31: changeset and full gate

**Files:**

- Create: `.changeset/<generated-name>.md`

- [ ] **Step 1: Write the changeset**

```bash
pnpm changeset
```

Choose a **minor** bump. Summary:

```text
Add headless Prismic model delivery: a `prismic-models` command (dry / apply /
pull / token doctor, in-repo and fleet), a reusable CI workflow that comments the
model delta on a PR and pushes on merge, a nightly fleet drift sweep that reaches
the cockpit, and a `prismic-ci` rollout recipe. Model deletes are impossible by
construction — the module exports no delete path.
```

- [ ] **Step 2: Run the full pre-merge gate**

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm test:dist`
Expected: all PASS. `test:dist` matters here — it asserts `bin.js`'s static import closure, and the new command must stay lazily loaded.

- [ ] **Step 3: Commit**

```bash
git add .changeset
git commit -m "chore: changeset for headless Prismic model delivery"
```

---

### Task 32: prove it end-to-end on one real site

The success criteria are behavioural. This task verifies them against a live repository rather than asserting them.

**Which sites — measured 2026-08-13, and one of the three the operator named is NOT eligible.**

The operator chose the-pointe, composition-hospitality and alamo-anatomy, on the stated reasoning that none is yet a live client site. Two hold up; the third does not, and the reason is worth stating because it is the same absent-vs-unreadable distinction this plan is built on — "I did not find a Prismic repository" is not "the site is a good low-risk candidate."

| Candidate                 | Prismic `repositoryName` (from `origin/HEAD`)   | Airtable row                                                             | Eligible                           |
| ------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------ | ---------------------------------- |
| `alamo-anatomy`           | `alamo-anatomy`                                 | `Alamo Anatomy`, `launch period`, repo set                               | ✅                                 |
| `the-pointe-burbank`      | `the-pointe-burbank`                            | `the-pointe-burbank`, `in development`, repo set                         | ✅                                 |
| `the-pointe`              | `the-pointe`                                    | `The Pointe`, `legacy`, **no `Git repo`**                                | ⚠ real Prismic repo, but not swept |
| `composition-hospitality` | **`your-prismic-repo-name`** (starter sentinel) | `Composition Hospitality`, `probably not our problem`, **no `Git repo`** | ❌                                 |

`composition-hospitality` **has no Prismic repository at all** — it still carries the starter sentinel, so `readPrismicConfig` returns `null` and every path in this pipeline correctly treats it as not-a-Prismic-site. It cannot prove anything about model delivery until a Prismic repository is minted for it and `slicemachine.config.json` names it. It is also outside the swept inventory, so steps 1, 2 and 6 would never reach it either way.

**Substitute `the-pointe-burbank`** — `in development`, in the inventory, with a real Prismic repository, which is precisely the "not yet a live client site" property the operator was selecting for. Note that "pointe" is itself ambiguous between two eligible-looking repos and they resolve differently: `the-pointe` has a real Prismic repository but no inventory row, so it can prove the PR/merge path (steps 3–5) and nothing about the sweep (steps 1, 2, 6).

- [ ] **Step 1: Prove the sweep reads the whole fleet**

Run: `node dist/cli/bin.js prismic-models --fleet airtable --tokens`
Expected: one row per site, each printing repo → Prismic repository → env var name; every Prismic site `PRESENT (not verified)`; `0 failing`. Any `MISSING` is an operator token to mint before continuing.

**Not `OK`** — see Task 17b. Nothing in this step validates a token against the Prismic API, and printing `OK` for a secret nobody has exercised is this plan's own absent-vs-unreadable rule pointed at the doctor's output. The first thing that actually proves a token is step 2, which reads each repository.

- [ ] **Step 2: Prove the fleet is still clean**

Run: `node dist/cli/bin.js prismic-models --fleet airtable`
Expected: every site reports `model(s) match Prismic`, exit 0. (The 2026-08-12 reconciliation left the fleet at 11 of 11 CLEAN — a divergence here is new drift, and is the first thing this pipeline has ever caught.)

- [ ] **Step 3: Prove the PR path comments**

On one rolled-out site, open a PR that adds a harmless field to one custom type — e.g. a `Boolean` field in the `Main` tab of `customtypes/page/index.json`.

Expected: the `prismic-models` check runs and posts a comment containing `+ Main.<field>`; Prismic is unchanged (re-run `prismic-models <site>` locally and see the same pending delta).

- [ ] **Step 4: Prove the merge path pushes**

Merge that PR.

Expected: the `push` job runs `--apply`; a local `prismic-models <site>` afterwards reports `model(s) match Prismic`. That is success criterion 1 — an agent edited a model, opened a PR, and merging delivered it with no human step beyond the merge.

- [ ] **Step 5: Prove `remoteOnly` survives a push**

Before step 4, confirm any `remoteOnly` model listed in step 2 is **still listed** after the merge.

Expected: unchanged — criterion 2. If a remote-only model disappeared, stop and treat it as a P0: that is the field-drop class the whole design exists to prevent.

- [ ] **Step 6: Prove the nightly reaches the cockpit**

Run: `gh workflow run fleet-prismic-drift.yml --repo reddoorla/reddoor-maintenance`, wait for it, then check the cockpit.

Expected: `Prismic Models Checked At` is stamped on every swept row; a site you deliberately drift shows a `warning` item in the cockpit's Needs-you feed within the 3-day freshness window — criterion 3.

---

## Rollout order

Strictly sequential — each step's failure mode is prevented by the one before it.

1. Tasks 1–22 merge into `@reddoorla/maintenance` and **release** (the sites need the new `reddoor-maint` bin before any workflow can call it).
2. Operator mints and sets the central `PRISMIC_TOKEN_*` secrets; Task 23's nightly runs and Task 32 step 1 shows `0 missing, 0 failing`.
3. The nightly sweep runs for **at least three nights** and stays clean. This is the ordering constraint from the spec, re-applied: enabling auto-push against a drifting fleet overwrites the cloud with repo state. The reconciliation already proved 11 of 11 clean once; three nights proves the _instrument_ is clean too.
4. Task 25 merges in `reddoorla/.github` and is tagged; the SHA goes into Task 26's template.
5. Operator sets per-repo `PRISMIC_WRITE_TOKEN` secrets (🔴).
6. `prismic-ci` runs against **one** site. Task 32 steps 3–5 pass there before any other repo gets the workflow.
7. `prismic-ci --fleet airtable` opens the remaining per-repo PRs, reviewed and merged individually (`AUTONOMY.md:49` — fleet-wide mutations land as per-repo PRs).

## What this plan does NOT do

Stated so no one reads a gap as an oversight:

- **No migration to the Prismic CLI or `prismic.config.json`.** The CLI cannot authenticate in CI (`PRISMIC_TOKEN` is an undocumented user-session token that cannot bootstrap and never refreshes from env), and `prismic init` is destructive. `readPrismicConfig` reads both filenames so a future adoption is not blocked, and nothing else assumes either.
- **No Slice Machine removal.** It stays as the local visual authoring tool. Removing it is a separate decision, made safer by the fact that `prismic init` is destructive.
- **No Type Builder adoption.** It is Admin-only, human-only, and saves straight to the cloud with no branch, PR, or CI — the opposite of what agent-driven modeling needs. Its per-repo availability was never checked and this design does not need it.
- **No model deletion, ever, from any code path here.** Two tripwire tests assert the capability does not exist.
- **No answer to token expiry.** It remains undocumented and unproven. The `--tokens` doctor and the nightly read-failure path are the detection, not a fix.
- **beachfront-dentistry's `scripts/lib/slice-models.mjs` is left in place.** It is that repo's seed precondition and predates this module; converging them is out of scope.
- **This pipeline can never deliver a pure field REORDER.** `canon()` sorts keys before comparing, so a model whose fields were only reordered compares equal, lands in `unchanged`, and is never pushed or described — verified across all 251 fleet models, 0 of which register a reorder as a change. Prismic renders editor fields in JSON key order, so a reorder IS a real authoring intent that this delivery path silently drops. That is deliberate: without key-sorting, every model would diff forever against Prismic's own serializer output. It also matches Slice Machine's own key-order blindness, so the behaviour is not a regression. **An operator who reorders fields and sees "nothing to push" is hitting a known limitation, not a bug** — the runbook (Task 29) must say so, or it will be filed as one.
- **No structured diff records.** A review proposed `describeDiff` return `{ op, path[] }` objects for the renderer to format. Declined: the string output is already proven readable on real fleet models, and its only consumer would format it straight back into the same strings. Revisit only if the PR comment and the CLI need to diverge in formatting.
