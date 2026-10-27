# Prismic Seed and Model-Sync Refusal (reddoor-maintenance) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `reddoor-maint prismic-seed <fixture> [site]` stages a site's pure fixture module into a Prismic migration release through the shared `runMigration`, and both it and `webflow migrate` REFUSE (exit 1, output starting `REFUSED:`) while any model the plan writes differs from the copy registered in Prismic — the silent field-drop class that shipped five missing fields on Beachfront.

**Architecture:** Three pure modules beside (never inside) `src/prismic/models/` — `seed/plan.ts` (fixture → `MigrationPlan`), `seed/in-sync.ts` (touched models → stale models → refusal text over `diffModels`/`describeDiff`), `seed/creds.ts` (repo id + token from the SITE's config via `readPrismicConfig` + `resolvePrismicToken`) — composed by one IO preflight (`seed/preflight.ts`) that both commands call before any Asset/Migration API request. `runMigration` gains four backward-compatible changes (per-doc `title`/`lang`, `stripEmpty`, decoded asset filename, an explicit `creds` argument with the env fallback kept) so the blux and webflow callers and their tests stay green.

**Tech Stack:** TypeScript (ESM, tsup), vitest 4, cac 6, tsx; reddoor-maintenance's `src/prismic/models/*` (config/token/local/remote/diff), `src/blux/emit/{plan,resolve-doc,run-migration}.ts`.

**Spec:** `docs/superpowers/specs/2026-09-08-webflow-rebuild-pipeline-design.md` §C4 ("Seed and sync"), gate: _a unit test proves `seed` refuses on a fixture whose model differs; a dry run against Beachfront's real repo reports the diff it would refuse on._

**Depends on:** nothing in plans A–C, E, F. This plan (D) is independent and may run in parallel; it is needed before the FIRST SEED of 29 Navy, not before its first slice. The match-harness recipe (plan C) installs `src/lib/site-pages.js` with the `documents(img)` export this plan defines as the contract — the two must agree on that name (they do; it is a decision, not a fact either plan derives).

**Repos touched:**

| Repo                 | Branch                          | Where                                                                                                                                     |
| -------------------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| reddoor-maintenance  | `feat/prismic-seed`             | worktree `/Users/tuckerlemos/Documents/GitHub/reddoor-maintenance/.worktrees/prismic-seed` (mandatory per its CLAUDE.md)                  |
| beachfront-dentistry | `feat/seed-fixture-documents`   | worktree `/Users/tuckerlemos/Documents/GitHub/beachfront-dentistry-seed-fixture` (sibling dir; `.worktrees/` is NOT gitignored there)     |
| reddoor-starter      | `docs/migration-standing-facts` | worktree `/Users/tuckerlemos/Documents/GitHub/reddoor-starter/.worktrees/migration-standing-facts` (`.worktrees/` is gitignored, line 35) |

Referred to below as `$MAINT`, `$BF`, `$STARTER`. Never commit on `main` in any of them.

**Assumptions:**

1. The maintenance main checkout is currently on `feat/audit-check-battery` (HEAD `9cd173a`, dirty: `src/prospect/site-checks.ts`), and `docs/workJournal.md` does NOT exist on that branch. It exists on `origin/main` (`50864ff`, #699). The worktree is therefore cut from `origin/main` (`686b08d`), not from the checkout's HEAD.
2. This plan file and the spec are untracked in the main checkout. Task 0 copies both into the worktree, runs prettier over them (both fail `prettier --check` as they stand, and `pnpm verify` checks `docs/superpowers/`) and commits them; if another plan (A/E) has already committed the spec to `origin/main` by then, copy only the plan.
3. The spec's C4 names the starter's `CLAUDE.md` Traps as a home for the Migration API facts; the decisions scope the starter change to `docs/migration.md` only (the starter gets ONE orientation line and a journal entry via plan E). This plan edits `docs/migration.md` only.
4. `StaleModel.reason` gains a third value, `"no local model"` (a touched model that exists in Prismic but not on disk — the fixture-vs-model test could not have checked it). Beachfront's original `assertModelsInSync` (`scripts/lib/slice-models.mjs:125-128`) reports the same case; the decisions list only `'not registered' | 'differs'`. Kept, because dropping it would let a seed proceed against a model nobody has verified.
5. `PlanDocument` gains `lang?: string` alongside the decided `title?: string`, and `fixtureToPlan` writes it — otherwise `--lang` would be a flag that parses and changes nothing, exactly the silent-no-op class `prismic-seed-registration.test.ts` exists to prevent. `runMigration` reads `doc.lang ?? "en-us"`; blux/webflow plans carry none, so their behaviour is unchanged.
6. `resolveSeedCreds` returns `libraries` alongside `{repositoryName, token, source}` because the same `readPrismicConfig` call yields it and `localModels` needs it; a superset of the decided shape, not a contradiction.
7. The Beachfront dry run needs a fixture exporting `documents(img)`. Beachfront's `src/lib/beachfront-pages.js` exports `assemblies`/`TITLES`/`META` (lines 207, 232, 267), so Task 11 adds the 12-line pure wrapper the facts (P7) prescribe, as its own Beachfront PR. Its `push-slice-models.mjs`/`push-custom-types.mjs`/`seed-pages.mjs` are superseded (spec C4 calls them retired) and NOT deleted by that PR; their retirement, and the `CLAUDE.md` lines that still name them (line 151, lines 163-165), is the Beachfront issue Task 11 Step 6 opens — a note in a PR body is not a tracker.
8. `PRISMIC_TOKEN_48BB12D1` was verified present in `~/.config/reddoor-maint/credentials.env` on 2026-09-08 (`grep -c` → 1). Task 13 Step 1 re-checks; if it is absent the dry run is deferred with a journal line, never skipped silently.
9. Beachfront has no `pnpm verify` script (its `package.json` has `lint` at line 13 and `test:unit` at line 16); its gate here is `pnpm lint && pnpm test:unit` plus CI.
10. Order at the end of the maintenance branch: `pnpm verify` + review (Task 12) → the Beachfront dry run from the worktree build (Task 13) → journal (with the dry run's output in it), PR, merge (Task 14). The dry run does not need the merge — `pnpm build` in the worktree is enough — and the journal must not be merged with its "Measured" paragraph unfinished.

---

## File structure

**reddoor-maintenance** (`$MAINT`)

| File                                                  | Responsibility                                                                                                                                                                                                                          |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/blux/emit/plan.ts` _(modify :14)_                | `PlanDocument` gains optional `title` and `lang`                                                                                                                                                                                        |
| `src/blux/emit/resolve-doc.ts` _(modify, append)_     | `stripEmpty` (drop `{}` at any depth, keep `[]`) and `assetFilename` (decoded, query-stripped url tail) — pure, covered                                                                                                                 |
| `src/blux/emit/run-migration.ts` _(modify)_           | `MigrationCreds` param with env fallback; posts `title`/`lang`; `stripEmpty` after `resolveDocData`; decoded filename dedupe                                                                                                            |
| `src/prismic/seed/plan.ts` _(new)_                    | `SeedDocument`, `SeedFixture`, `isSeedFixture`, `fixtureToPlan` — the fixture contract and the offline plan builder                                                                                                                     |
| `src/prismic/seed/in-sync.ts` _(new)_                 | `touchedModels`, `staleModels`, `untouchedDrift`, `renderRefusal` — pure, over `ModelDiff` + `describeDiff`                                                                                                                             |
| `src/prismic/seed/creds.ts` _(new)_                   | `resolveSeedCreds` — repo id + token from the site's own config, `PRISMIC_TOKEN_<REPO>` first; `describeThrown`                                                                                                                         |
| `src/prismic/seed/preflight.ts` _(new)_               | `seedPreflight` — creds → local → remote → diff → refuse; the one IO composition both commands call                                                                                                                                     |
| `src/cli/commands/prismic-seed.ts` _(new)_            | `runPrismicSeedCommand(fixture, site, opts, deps)` — import → plan → preflight → dry listing or `runMigration`                                                                                                                          |
| `src/cli/commands/webflow.ts` _(modify)_              | `migrate` gains `--site`, an injectable `deps`, and the preflight before `runMigration`; no longer reads `PRISMIC_REPOSITORY_NAME`                                                                                                      |
| `src/cli/bin.ts` _(modify)_                           | registers `prismic-seed <fixture> [site]` (`--apply`, `--lang`); `webflow` gains `--site <path>`; description corrected                                                                                                                 |
| `tests/blux/emit/resolve-doc.test.ts` _(modify)_      | `stripEmpty` + `assetFilename` cases                                                                                                                                                                                                    |
| `tests/blux/emit/run-migration-title.test.ts` _(new)_ | POST body carries `title`/`lang`, `{}` absent, encoded filename dedupes, explicit creds honoured, env fallback error kept                                                                                                               |
| `tests/prismic/seed/plan.test.ts` _(new)_             | marker resolves via `resolveDocData`; asset ids are urls; title carried; `{}` gone; lang precedence; no custom types                                                                                                                    |
| `tests/prismic/seed/in-sync.test.ts` _(new)_          | real carousel fixture with `review.primary.layout` deleted remotely ⇒ named; identical ⇒ []; untouched drift ⇒ warning; remoteOnly; no local model                                                                                      |
| `tests/prismic/seed/creds.test.ts` _(new)_            | env var derived from repositoryName; NAME printed, value never; generic fallback gated; not-a-site vs broken config                                                                                                                     |
| `tests/cli/prismic-seed-command.test.ts` _(new)_      | could-not-import; no `documents`; not-a-site; REFUSED + runner not called (even with `--apply`); dry lists; `--apply` calls runner once with creds; remote read failure ⇒ fails (not `REFUSED`), runner not called, value never printed |
| `tests/cli/prismic-seed-registration.test.ts` _(new)_ | FLAGS ↔ `PrismicSeedCommandOptions` ↔ bin.ts source; cac accepts every flag; handler reached                                                                                                                                            |
| `tests/webflow/command.test.ts` _(modify)_            | `migrate` with a stale injected remote ⇒ `REFUSED`; `--site` without a config ⇒ code 1                                                                                                                                                  |
| `docs/runbooks/prismic-model-delivery.md` _(modify)_  | §12 "Seeding documents — the refusal, and why it is not optional"                                                                                                                                                                       |
| `README.md` _(modify :52-65)_                         | CLI list gains `prismic-models` and `prismic-seed` lines                                                                                                                                                                                |
| `.changeset/prismic-seed.md` _(new)_                  | `"@reddoorla/maintenance": minor`                                                                                                                                                                                                       |
| `docs/workJournal.md` _(modify, append)_              | the session entry (Task 16)                                                                                                                                                                                                             |

**beachfront-dentistry** (`$BF`)

| File                                          | Responsibility                                                                                  |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `src/lib/beachfront-pages.js` _(append)_      | `export const documents = (img) => …` — the seed contract, lifted from `seed-pages.mjs:194-211` |
| `src/lib/beachfront-pages.test.ts` _(append)_ | `documents(img)` emits one page doc per assembly with the seed-pages payload shape              |
| `docs/workJournal.md` _(append)_              | the session entry (Task 16)                                                                     |

**reddoor-starter** (`$STARTER`)

| File                             | Responsibility                                                            |
| -------------------------------- | ------------------------------------------------------------------------- |
| `docs/migration.md` _(modify)_   | The fleet path (`prismic-models` → `prismic-seed`) and standing facts A–F |
| `docs/workJournal.md` _(append)_ | the session entry (Task 16)                                               |

---

### Task 0: Worktree, branch, and the plan committed

**Files:** Create: `$MAINT/docs/superpowers/plans/2026-09-08-webflow-pipeline-d-seed-sync.md` (copy) · Create (if absent on origin/main): `$MAINT/docs/superpowers/specs/2026-09-08-webflow-rebuild-pipeline-design.md` (copy)

- [ ] **Step 1: Cut the worktree from origin/main, not from the checkout's HEAD**

```bash
cd /Users/tuckerlemos/Documents/GitHub/reddoor-maintenance
git fetch origin
git worktree add .worktrees/prismic-seed -b feat/prismic-seed origin/main
cd .worktrees/prismic-seed
pnpm install --frozen-lockfile
git log --oneline -1
```

Expected: the last line prints `686b08d feat(scripts): ask which repos can take a push before sweeping, not after (#701)` (or a newer `origin/main` commit — record whichever it is in the journal).

If `git worktree add` or `pnpm install` is denied by the sandbox (`.worktrees/prismic-seed` is outside a session's default write allowlist when the session is rooted in another repo), re-run that command unsandboxed — it writes only inside this repo.

- [ ] **Step 2: Copy the plan (and the spec if origin/main lacks it), then make both prettier-clean**

`pnpm verify` runs `prettier --check .` and `.prettierignore` does not exclude `docs/superpowers/`, so the copied files must pass prettier or Task 12 Step 1 (and CI) goes red on the plan's own docs before any code is judged. Measured 2026-09-08: as copied, prettier would change 294 lines of the plan and 78 of the spec (table padding, embedded-code indentation). The one block in this plan that embeds a fence (Task 15 Step 2, the Migrate section) is delimited with four backticks for exactly this reason — prettier re-delimits a mis-nested block and moves prose out of it.

```bash
export MAINT=/Users/tuckerlemos/Documents/GitHub/reddoor-maintenance/.worktrees/prismic-seed
cp /Users/tuckerlemos/Documents/GitHub/reddoor-maintenance/docs/superpowers/plans/2026-09-08-webflow-pipeline-d-seed-sync.md "$MAINT/docs/superpowers/plans/"
test -f "$MAINT/docs/superpowers/specs/2026-09-08-webflow-rebuild-pipeline-design.md" \
  || cp /Users/tuckerlemos/Documents/GitHub/reddoor-maintenance/docs/superpowers/specs/2026-09-08-webflow-rebuild-pipeline-design.md "$MAINT/docs/superpowers/specs/"
cd "$MAINT" && pnpm exec prettier --write docs/superpowers/plans/2026-09-08-webflow-pipeline-d-seed-sync.md docs/superpowers/specs/2026-09-08-webflow-rebuild-pipeline-design.md && pnpm exec prettier --check docs/superpowers/plans/2026-09-08-webflow-pipeline-d-seed-sync.md docs/superpowers/specs/2026-09-08-webflow-rebuild-pipeline-design.md
git status --short
```

Expected: `All matched files use Prettier code style!`, then `?? docs/superpowers/plans/2026-09-08-webflow-pipeline-d-seed-sync.md` and, for the spec, either `?? docs/superpowers/specs/2026-09-08-webflow-rebuild-pipeline-design.md` (it was absent) or ` M …` (it was on origin/main but not prettier-clean; the reformat rides along in Step 4's commit) or nothing (present and already clean).

- [ ] **Step 3: Verify the baseline is green before touching anything**

```bash
cd "$MAINT" && pnpm build && pnpm test 2>&1 | tail -n 5
```

Expected: the tail shows `Test Files  N passed (N)` and `Tests  M passed (M)` with no `failed`. Record N and M — the closing `pnpm verify` must show strictly more tests.

- [ ] **Step 4: Commit**

```bash
cd "$MAINT"
git add docs/superpowers/plans/2026-09-08-webflow-pipeline-d-seed-sync.md docs/superpowers/specs/2026-09-08-webflow-rebuild-pipeline-design.md 2>/dev/null || git add docs/superpowers/plans/2026-09-08-webflow-pipeline-d-seed-sync.md
git commit -m "docs: plan D — prismic-seed and the model-sync refusal

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 1: `stripEmpty` and `assetFilename` — the two pure helpers the seed needs from the runner

**Files:** Modify: `$MAINT/src/blux/emit/resolve-doc.ts` (append after line 36) · Test: `$MAINT/tests/blux/emit/resolve-doc.test.ts` (append after line 29)

- [ ] **Step 1: Write the failing tests**

Append to `tests/blux/emit/resolve-doc.test.ts` (the file currently ends at line 29 with `});`), and change its line 2 import from `import { resolveDocData } from "../../../src/blux/emit/resolve-doc.js";` to:

```ts
import { assetFilename, resolveDocData, stripEmpty } from "../../../src/blux/emit/resolve-doc.js";
```

Append:

```ts
// Prismic rejects an unfilled Link/Image passed as `{}` ("link_type must be
// Web…"); an unfilled field must be OMITTED. Empty arrays are valid unfilled
// StructuredText/Group/slice zones and must survive. Ported from
// beachfront-dentistry scripts/seed-pages.mjs:63-84.
describe("stripEmpty", () => {
  it("drops an empty object at any depth and keeps empty arrays", () => {
    expect(
      stripEmpty({
        slices: [
          {
            slice_type: "section_grid",
            primary: { heading: [] },
            items: [{ item_link: {}, item_body: [] }],
          },
        ],
        meta: {},
      }),
    ).toEqual({
      slices: [
        { slice_type: "section_grid", primary: { heading: [] }, items: [{ item_body: [] }] },
      ],
    });
  });

  it("returns the root object even when everything inside it was empty", () => {
    expect(stripEmpty({ a: {} })).toEqual({});
  });

  it("leaves scalars, null and false alone", () => {
    expect(stripEmpty({ n: 0, s: "", b: false, nul: null })).toEqual({
      n: 0,
      s: "",
      b: false,
      nul: null,
    });
  });
});

// The Asset API stores the DECODED filename; a CDN url carries it
// percent-encoded (beachfront IMG.rvLeigh = `…/Leigh%20Lowery%20google.png`).
// Comparing the raw tail re-uploads such an asset on every run.
describe("assetFilename", () => {
  it("decodes a percent-encoded tail so it matches the library's stored name", () => {
    expect(assetFilename("https://cdn/x/657a2280_Leigh%20Lowery%20google.png", "id")).toBe(
      "657a2280_Leigh Lowery google.png",
    );
  });

  it("strips a query string", () => {
    expect(assetFilename("https://cdn/x/a.png?w=100", "id")).toBe("a.png");
  });

  it("falls back to the raw tail on a malformed escape rather than throwing", () => {
    expect(assetFilename("https://cdn/x/100%.png", "id")).toBe("100%.png");
  });

  it("uses the fallback when the url has no tail", () => {
    expect(assetFilename("https://cdn/x/", "the-id")).toBe("the-id");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd "$MAINT" && pnpm exec vitest run tests/blux/emit/resolve-doc.test.ts 2>&1 | tail -n 15
```

Expected: `SyntaxError: The requested module '../../../src/blux/emit/resolve-doc.js' does not provide an export named 'assetFilename'` (or `stripEmpty`) — the suite fails to load.

- [ ] **Step 3: Write the implementation**

Append to `src/blux/emit/resolve-doc.ts` after its final line 36 (`}`):

```ts
/** Drop every EMPTY OBJECT value at any depth. `{}` is what a fixture writes
 *  for an unfilled Link/Image, and the Migration API rejects it ("link_type
 *  must be Web…") — an unfilled field must be OMITTED. Empty ARRAYS are kept:
 *  `[]` is a valid unfilled StructuredText / Group / slice zone. The root
 *  object is always returned, even when it ends up empty. Ported from
 *  beachfront-dentistry scripts/seed-pages.mjs `stripEmpty`. */
export function stripEmpty<T>(v: T): T {
  if (Array.isArray(v)) return v.map(stripEmpty) as unknown as T;
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      const c = stripEmpty(val);
      if (c && typeof c === "object" && !Array.isArray(c) && Object.keys(c).length === 0) continue;
      out[k] = c;
    }
    return out as T;
  }
  return v;
}

/** The media-library filename an asset url dedupes against. The Asset API
 *  stores the DECODED name (`Leigh Lowery google.png`) while a CDN url carries
 *  it percent-encoded (`Leigh%20Lowery%20google.png`); comparing the raw url
 *  tail re-uploads every such asset on every run. A malformed escape falls
 *  back to the raw tail rather than throwing — a bad url should fail at fetch
 *  time, with the url in the message, not here. */
export function assetFilename(url: string, fallback: string): string {
  const tail = (url.split("/").pop() || fallback).split("?")[0]!;
  try {
    return decodeURIComponent(tail);
  } catch {
    return tail;
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd "$MAINT" && pnpm exec vitest run tests/blux/emit/resolve-doc.test.ts 2>&1 | tail -n 6
```

Expected: `Tests  8 passed (8)`.

- [ ] **Step 5: Commit**

```bash
cd "$MAINT" && pnpm exec prettier --write src/blux/emit/resolve-doc.ts tests/blux/emit/resolve-doc.test.ts
git add src/blux/emit/resolve-doc.ts tests/blux/emit/resolve-doc.test.ts
git commit -m "feat(migration): stripEmpty and a decoded asset filename, as pure helpers

The Migration API rejects {} for an unfilled Link/Image and the Asset API
stores decoded filenames; both bit beachfront's seed. Pure and covered here
so run-migration.ts (excluded from coverage) only composes them.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: `runMigration` — explicit creds, `title`/`lang`, `stripEmpty`, decoded filename

**Files:** Modify: `$MAINT/src/blux/emit/plan.ts:14` · Modify: `$MAINT/src/blux/emit/run-migration.ts:2,10-11,28-33,114-116,156-160,171,204-213,228,235` · Test: `$MAINT/tests/blux/emit/run-migration-title.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `tests/blux/emit/run-migration-title.test.ts` (mirrors `run-migration-doclookup.test.ts`'s `vi.stubGlobal("fetch", …)` + env save/restore in `afterEach`):

```ts
import { describe, it, expect, afterEach, vi } from "vitest";
import { runMigration } from "../../../src/blux/emit/run-migration.js";
import type { MigrationPlan } from "../../../src/blux/emit/plan.js";

function jsonRes(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => "",
  } as unknown as Response;
}

const ENV = ["PRISMIC_REPOSITORY_NAME", "PRISMIC_WRITE_TOKEN", "PRISMIC_ACCESS_TOKEN"] as const;
const ENCODED = "https://cdn/x/657a2280_Leigh%20Lowery%20google.png";

describe("runMigration — what the seed needs from the POST", () => {
  const saved: Record<string, string | undefined> = {};
  afterEach(() => {
    vi.unstubAllGlobals();
    for (const k of ENV) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("uses the caller's creds, posts title + lang, omits `{}` fields, and dedupes an encoded filename", async () => {
    // The generic env pair is ABSENT: creds must come from the parameter.
    for (const k of ENV) {
      saved[k] = process.env[k];
      delete process.env[k];
    }

    const posted: string[] = [];
    const mockFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("https://asset-api.prismic.io/assets?")) {
        // The library stores the DECODED name.
        return jsonRes({
          items: [
            {
              id: "leigh-id",
              filename: "657a2280_Leigh Lowery google.png",
              url: "https://images.prismic.io/repo/leigh",
            },
          ],
        });
      }
      if (url === "https://migration.prismic.io/documents" && init?.method === "POST") {
        posted.push(String(init.body));
        return jsonRes({ id: "new-doc" });
      }
      throw new Error(`unexpected fetch ${url} ${init?.method ?? ""}`);
    });
    vi.stubGlobal("fetch", mockFetch as unknown as typeof fetch);

    const plan: MigrationPlan = {
      customTypes: [],
      documents: [
        {
          type: "page",
          uid: "home",
          title: "Home",
          lang: "fr-fr",
          data: {
            title: [{ type: "heading1", text: "Home", spans: [] }],
            slices: [
              {
                slice_type: "section_grid",
                variation: "default",
                primary: { heading: [] },
                items: [{ item_link: {}, item_media: { __asset_id: ENCODED } }],
              },
            ],
          },
        },
      ],
      assets: [{ id: ENCODED, url: ENCODED, alt: "" }],
      stylesManifest: [],
      diagnostics: [],
    };

    const r = await runMigration(plan, () => {}, { repo: "repo", token: "tok" });
    expect(r.assetsReused).toBe(1);
    expect(r.assetsUploaded).toBe(0);
    expect(r.docsCreated).toBe(1);
    expect(posted).toHaveLength(1);
    const body = JSON.parse(posted[0]!) as {
      title: string;
      lang: string;
      data: { slices: { items: Record<string, unknown>[] }[] };
    };
    expect(body.title).toBe("Home");
    expect(body.lang).toBe("fr-fr");
    const item = body.data.slices[0]!.items[0]!;
    expect(item).not.toHaveProperty("item_link");
    expect(item.item_media).toEqual({ id: "leigh-id" });
    // …and the parameter's token is what went on the wire.
    const postInit = mockFetch.mock.calls.find((c) => c[1]?.method === "POST")?.[1];
    expect((postInit?.headers as Record<string, string>).Authorization).toBe("Bearer tok");
  });

  it("defaults title to the uid and lang to en-us for a plan that carries neither (blux/webflow)", async () => {
    for (const k of ENV) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
    const posted: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        if (url.startsWith("https://asset-api.prismic.io/assets?")) return jsonRes({ items: [] });
        if (url === "https://migration.prismic.io/documents" && init?.method === "POST") {
          posted.push(String(init.body));
          return jsonRes({ id: "new-doc" });
        }
        throw new Error(`unexpected fetch ${url}`);
      }) as unknown as typeof fetch,
    );
    const plan: MigrationPlan = {
      customTypes: [],
      documents: [{ type: "catalog_page", uid: "home", data: {} }],
      assets: [],
      stylesManifest: [],
      diagnostics: [],
    };
    await runMigration(plan, () => {}, { repo: "repo", token: "tok" });
    expect(JSON.parse(posted[0]!)).toMatchObject({ title: "home", lang: "en-us", data: {} });
  });

  it("still throws the generic env error when neither creds nor env are given (the blux/webflow contract)", async () => {
    for (const k of ENV) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
    const plan: MigrationPlan = {
      customTypes: [],
      documents: [],
      assets: [],
      stylesManifest: [],
      diagnostics: [],
    };
    await expect(runMigration(plan, () => {})).rejects.toThrow(
      "Set PRISMIC_REPOSITORY_NAME and PRISMIC_WRITE_TOKEN",
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd "$MAINT" && pnpm exec vitest run tests/blux/emit/run-migration-title.test.ts 2>&1 | tail -n 20
```

Expected: the first test fails — either with `Set PRISMIC_REPOSITORY_NAME and PRISMIC_WRITE_TOKEN` (the third argument is ignored today) or, if tsc runs first, `Object literal may only specify known properties, and 'title' does not exist in type 'PlanDocument'`.

- [ ] **Step 3: Write the implementation**

`src/blux/emit/plan.ts` line 14 — replace

```ts
export type PlanDocument = { type: string; uid: string; data: Record<string, unknown> };
```

with

```ts
export type PlanDocument = {
  type: string;
  uid: string;
  data: Record<string, unknown>;
  /** Editor display name; the runner falls back to the uid. Blux/webflow plans
   *  carry none; a site fixture supplies "Meet Our Team", not "our-team". */
  title?: string;
  /** Locale; the runner falls back to "en-us". */
  lang?: string;
};
```

`src/blux/emit/run-migration.ts`:

Line 2 — replace `import { resolveDocData } from "./resolve-doc.js";` with

```ts
import { assetFilename, resolveDocData, stripEmpty } from "./resolve-doc.js";
```

Lines 10-11 (inside the header comment) — replace

```ts
 *  bodies. Creds: PRISMIC_REPOSITORY_NAME + PRISMIC_WRITE_TOKEN (+ optional
 *  PRISMIC_ACCESS_TOKEN when the repo's Document API is private).
```

with

```ts
 *  bodies. Creds: an explicit `creds` argument (the seed command resolves
 *  PRISMIC_TOKEN_<REPO> from the site's own config) or, when omitted, the
 *  generic env pair PRISMIC_REPOSITORY_NAME + PRISMIC_WRITE_TOKEN (+ optional
 *  PRISMIC_ACCESS_TOKEN when the repo's Document API is private) that the
 *  blux/webflow paths still use.
```

Lines 28-33 — replace

```ts
function readCreds(): { repo: string; token: string } {
  const repo = process.env.PRISMIC_REPOSITORY_NAME;
  const token = process.env.PRISMIC_WRITE_TOKEN;
  if (!repo || !token) throw new Error("Set PRISMIC_REPOSITORY_NAME and PRISMIC_WRITE_TOKEN");
  return { repo, token };
}
```

with

```ts
/** Credentials for one live run. `accessToken` is only needed when the repo's
 *  Document API is private (the PUT-update lookup reads the master ref). */
export type MigrationCreds = { repo: string; token: string; accessToken?: string };

function readCreds(): MigrationCreds {
  const repo = process.env.PRISMIC_REPOSITORY_NAME;
  const token = process.env.PRISMIC_WRITE_TOKEN;
  if (!repo || !token) throw new Error("Set PRISMIC_REPOSITORY_NAME and PRISMIC_WRITE_TOKEN");
  return { repo, token, accessToken: process.env.PRISMIC_ACCESS_TOKEN };
}
```

Lines 114-116 — replace

```ts
async function lookupDocIds(repo: string): Promise<Map<string, string>> {
  const access = process.env.PRISMIC_ACCESS_TOKEN;
  const qs = access ? `?access_token=${access}` : "";
```

with

```ts
async function lookupDocIds(repo: string, accessToken?: string): Promise<Map<string, string>> {
  const qs = accessToken ? `?access_token=${accessToken}` : "";
```

Lines 156-160 — replace

```ts
export async function runMigration(
  plan: MigrationPlan,
  log: (line: string) => void = console.log,
): Promise<MigrationResult> {
  const { repo, token } = readCreds();
```

with

```ts
export async function runMigration(
  plan: MigrationPlan,
  log: (line: string) => void = console.log,
  creds?: MigrationCreds,
): Promise<MigrationResult> {
  const { repo, token, accessToken } = creds ?? readCreds();
```

Line 171 — replace

```ts
const filename = (a.url.split("/").pop() ?? a.id).split("?")[0]!;
```

with

```ts
const filename = assetFilename(a.url, a.id);
```

Lines 205-213 — replace

```ts
const { data, missingAssets: miss } = resolveDocData(doc.data, assetIdByUuid);
missingAssets.push(...miss);
const body = JSON.stringify({
  type: doc.type,
  uid: doc.uid,
  lang: "en-us",
  title: doc.uid,
  data,
});
```

with

```ts
const { data: resolved, missingAssets: miss } = resolveDocData(doc.data, assetIdByUuid);
missingAssets.push(...miss);
// `{}` for an unfilled Link/Image is rejected by the Migration API — an
// unfilled field must be absent. Applied AFTER resolution so a dropped
// missing-asset marker cannot leave an empty object behind either.
const data = stripEmpty(resolved);
const body = JSON.stringify({
  type: doc.type,
  uid: doc.uid,
  lang: doc.lang ?? "en-us",
  // The document's display name in the Prismic editor. Blux/webflow plans
  // carry none, so the uid stands in as before.
  title: doc.title ?? doc.uid,
  data,
});
```

Line 228 (now shifted; the line reading `docIds ??= await lookupDocIds(repo);`) — replace with

```ts
docIds ??= await lookupDocIds(repo, accessToken);
```

Line 235 (the `process.env.PRISMIC_ACCESS_TOKEN` ternary inside the update error) — replace

```ts
            (process.env.PRISMIC_ACCESS_TOKEN
```

with

```ts
            (accessToken
```

- [ ] **Step 4: Run the tests to verify they pass — including the two existing runner tests and every blux/webflow caller's suite**

```bash
cd "$MAINT" && pnpm typecheck && pnpm exec vitest run tests/blux/emit tests/cli/blux-command.test.ts tests/cli/blux-catalog-command.test.ts tests/cli/blux-migrate-catalog-command.test.ts tests/webflow 2>&1 | tail -n 8
```

Expected: typecheck prints nothing (exit 0); vitest prints `Test Files  … passed` with 0 failed, and the three new tests are among the passed. The doclookup/asseturls tests (env-fallback path) still pass unchanged.

- [ ] **Step 5: Commit**

```bash
cd "$MAINT" && pnpm exec prettier --write src/blux/emit/plan.ts src/blux/emit/run-migration.ts tests/blux/emit/run-migration-title.test.ts
git add src/blux/emit/plan.ts src/blux/emit/run-migration.ts tests/blux/emit/run-migration-title.test.ts
git commit -m "feat(migration): runMigration takes creds, posts title + lang, strips {} and decodes filenames

Env fallback kept for the blux/webflow callers and their tests; the seed
command passes PRISMIC_TOKEN_<REPO> without mutating process.env.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: `src/prismic/seed/plan.ts` — the fixture contract and `fixtureToPlan`

**Files:** Create: `$MAINT/src/prismic/seed/plan.ts` · Test: `$MAINT/tests/prismic/seed/plan.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/prismic/seed/plan.test.ts` (pattern: `tests/webflow/to-plan.test.ts` — call `resolveDocData` on the adapter's own output):

```ts
/** fixtureToPlan adapts a site's pure fixture module into the MigrationPlan the
 *  shared runner consumes. The load-bearing assertion is that the marker it
 *  writes is one resolveDocData actually resolves, so it is called on the
 *  adapter's own output rather than eyeballed. */
import { describe, it, expect } from "vitest";
import { resolveDocData } from "../../../src/blux/emit/resolve-doc.js";
import { fixtureToPlan, isSeedFixture, type SeedFixture } from "../../../src/prismic/seed/plan.js";

const HERO = "https://cdn/x/hero%20wide.jpg";
const CARD = "https://cdn/x/card.jpg";

/** An inline fixture shaped like a site's `documents(img)` export. */
const fixture: SeedFixture = {
  documents: (img) => [
    {
      type: "page",
      uid: "home",
      title: "Home",
      data: {
        title: [{ type: "heading1", text: "Home", spans: [] }],
        slices: [
          {
            slice_type: "hero",
            variation: "default",
            primary: { background_image: img(HERO, "Hero"), cta_link: {} },
            items: [],
          },
          {
            slice_type: "section_grid",
            variation: "default",
            primary: { heading: [] },
            items: [
              { item_media: img(CARD), item_link: {} },
              { item_media: img(CARD), item_link: {} },
            ],
          },
        ],
      },
    },
  ],
};

describe("fixtureToPlan", () => {
  it("(a) rewrites img(url) into the marker resolveDocData resolves, keyed by the url", () => {
    const plan = fixtureToPlan(fixture);
    const doc = plan.documents[0]!;
    const slices = doc.data.slices as { primary: Record<string, unknown> }[];
    expect(slices[0]!.primary.background_image).toEqual({ __asset_id: HERO });
    const resolved = resolveDocData(
      doc.data,
      new Map([
        [HERO, "ASSET_HERO"],
        [CARD, "ASSET_CARD"],
      ]),
    );
    expect(resolved.missingAssets).toEqual([]);
    const hero = (resolved.data.slices as { primary: { background_image: unknown } }[])[0]!;
    expect(hero.primary.background_image).toEqual({ id: "ASSET_HERO" });
  });

  it("(b) lists each url once as an asset whose id IS the url, carrying the first alt", () => {
    const plan = fixtureToPlan(fixture);
    expect(plan.assets).toEqual([
      { id: HERO, url: HERO, alt: "Hero" },
      { id: CARD, url: CARD, alt: "" },
    ]);
  });

  it("(c) carries the title and strips `{}` fields before the plan exists", () => {
    const doc = fixtureToPlan(fixture).documents[0]!;
    expect(doc).toMatchObject({ type: "page", uid: "home", title: "Home" });
    const json = JSON.stringify(doc.data);
    expect(json).not.toContain("cta_link");
    expect(json).not.toContain("item_link");
    // empty arrays are valid unfilled fields and survive
    expect(json).toContain('"heading":[]');
  });

  it("(d) lang: the option wins over the fixture's export, which wins over en-us", () => {
    expect(fixtureToPlan(fixture).documents[0]!.lang).toBe("en-us");
    expect(fixtureToPlan({ ...fixture, lang: "es-es" }).documents[0]!.lang).toBe("es-es");
    expect(fixtureToPlan({ ...fixture, lang: "es-es" }, { lang: "fr-fr" }).documents[0]!.lang).toBe(
      "fr-fr",
    );
  });

  it("(e) emits no custom types (the site repo's types ship through prismic-models)", () => {
    expect(fixtureToPlan(fixture).customTypes).toEqual([]);
  });
});

describe("isSeedFixture", () => {
  it("accepts a module exporting documents() and rejects beachfront's older assemblies() shape", () => {
    expect(isSeedFixture(fixture)).toBe(true);
    expect(isSeedFixture({ assemblies: () => ({}) })).toBe(false);
    expect(isSeedFixture(null)).toBe(false);
    expect(isSeedFixture("nope")).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd "$MAINT" && pnpm exec vitest run tests/prismic/seed/plan.test.ts 2>&1 | tail -n 8
```

Expected: `Error: Failed to load url ../../../src/prismic/seed/plan.js` (module does not exist).

- [ ] **Step 3: Write the implementation**

Create `src/prismic/seed/plan.ts`:

```ts
// Fixture → MigrationPlan, offline. Lives beside `src/prismic/models/`, never
// inside it: that directory is covered by an AST capability guard and an
// export pin (tests/prismic/models/index.test.ts), and this module reaches
// for the Migration API's plan shape, which is a channel the guard must not
// have to reason about.
import { assetRef } from "../../blux/emit/plan.js";
import type { MigrationPlan, PlanAsset, PlanDocument } from "../../blux/emit/plan.js";
import { stripEmpty } from "../../blux/emit/resolve-doc.js";

/** One document a site fixture wants staged: `PlanDocument` plus the editor
 *  display name — the fixture is the only place that knows a page is called
 *  "Meet Our Team" and not "our-team". */
export type SeedDocument = {
  type: string;
  uid: string;
  title: string;
  data: Record<string, unknown>;
};

/** The image resolver a fixture is called with. It returns whatever the
 *  consumer needs an Image field to hold: the seed hands back an asset marker;
 *  a site's dev/match route hands back `{ url, alt, … }` so the same module
 *  renders through the real SliceZone without a Prismic publish. */
export type SeedImageResolver = (url: string, alt?: string) => unknown;

/** THE FIXTURE CONTRACT — what `reddoor-maint prismic-seed <fixture>` imports.
 *
 *  A site's fixture module (`src/lib/site-pages.js` on a match-harness site)
 *  is PURE: no node:*, no fetch, no token, no side effects at import — Vite
 *  bundles it into the dev/match route and node imports it here. It exports:
 *
 *    export function documents(img: (url, alt?) => unknown): SeedDocument[]
 *    export const lang = "en-us"   // optional
 *
 *  Every Image field is written as `img(url, alt)`, never as a literal: that
 *  closure is how one module serves both consumers without knowing which one
 *  is calling. The Migration API silently DROPS every field the model
 *  registered in Prismic does not declare (HTTP 200, no warning) — the seed
 *  command refuses to run until the models it writes are in sync, and the
 *  site's fixture-vs-model unit test is the local half of that check. */
export type SeedFixture = {
  documents: (img: SeedImageResolver) => SeedDocument[];
  lang?: string;
};

export function isSeedFixture(mod: unknown): mod is SeedFixture {
  return (
    !!mod &&
    typeof mod === "object" &&
    typeof (mod as { documents?: unknown }).documents === "function"
  );
}

/** Calls `documents(img)` ONCE with a resolver that records every url it is
 *  handed and returns the `{ __asset_id: url }` marker `resolveDocData`
 *  resolves, so the documents and the asset list come out of the same pass.
 *  The url IS the `PlanAsset.id` (the filename-as-id precedent of
 *  `webflowToPlan`); `runMigration` dedupes the media library by the url's
 *  decoded filename. First alt wins per url, as in to-plan.ts.
 *
 *  `{}` values are stripped here as well as at the POST, so a dry run lists
 *  the payload that will actually be sent. */
export function fixtureToPlan(fixture: SeedFixture, opts: { lang?: string } = {}): MigrationPlan {
  const assets = new Map<string, string>();
  const img: SeedImageResolver = (url, alt) => {
    if (!assets.has(url)) assets.set(url, alt ?? "");
    return assetRef(url);
  };
  const lang = opts.lang ?? fixture.lang ?? "en-us";
  const documents: PlanDocument[] = fixture.documents(img).map((d) => ({
    type: d.type,
    uid: d.uid,
    title: d.title,
    lang,
    data: stripEmpty(d.data),
  }));
  const planAssets: PlanAsset[] = [...assets].map(([url, alt]) => ({ id: url, url, alt }));
  return { customTypes: [], documents, assets: planAssets, stylesManifest: [], diagnostics: [] };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd "$MAINT" && pnpm exec vitest run tests/prismic/seed/plan.test.ts 2>&1 | tail -n 6
```

Expected: `Tests  6 passed (6)`.

- [ ] **Step 5: Commit**

```bash
cd "$MAINT" && pnpm exec prettier --write src/prismic/seed/plan.ts tests/prismic/seed/plan.test.ts
git add src/prismic/seed/plan.ts tests/prismic/seed/plan.test.ts
git commit -m "feat(seed): the fixture contract, and fixtureToPlan

documents(img) → MigrationPlan in one pass; the url is the asset id, the
title rides along, {} is stripped before the plan exists.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: `src/prismic/seed/in-sync.ts` — touched models, stale models, the refusal text

**Files:** Create: `$MAINT/src/prismic/seed/in-sync.ts` · Test: `$MAINT/tests/prismic/seed/in-sync.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/prismic/seed/in-sync.test.ts` (pattern: `tests/prismic/models/diff.test.ts:23-60` — `readFixture` + the real Beachfront carousel slice and gallerysonder page type from `tests/fixtures/prismic-models/`):

```ts
// The seed precondition: every model the plan WRITES must be registered in
// Prismic in its current local form. Ported from beachfront-dentistry
// scripts/lib/slice-models.mjs `assertModelsInSync` (slices only) and extended
// to custom types — beachfront seeded `meta_title`/`meta_description` onto the
// `page` type and never checked it.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { diffModels } from "../../../src/prismic/models/index.js";
import type { LocalEntry, PrismicModel, RemoteEntry } from "../../../src/prismic/models/index.js";
import type { MigrationPlan } from "../../../src/blux/emit/plan.js";
import {
  renderRefusal,
  staleModels,
  touchedModels,
  untouchedDrift,
} from "../../../src/prismic/seed/in-sync.js";

const readFixture = (name: string): PrismicModel =>
  JSON.parse(
    readFileSync(
      fileURLToPath(new URL(`../../fixtures/prismic-models/${name}`, import.meta.url)),
      "utf-8",
    ),
  ) as PrismicModel;

// Real fleet models — see tests/prismic/models/diff.test.ts for why these two.
const carousel = readFixture("beachfront-dentistry-carousel-slice.json");
const page = readFixture("gallerysonder-page-customtype.json");

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const ctLocal = (model: PrismicModel): LocalEntry => ({
  kind: "customtype",
  id: model.id,
  model,
  path: `customtypes/${model.id}/index.json`,
});
const ctRemote = (model: PrismicModel): RemoteEntry => ({
  kind: "customtype",
  id: model.id,
  model,
});
const sliceLocal = (model: PrismicModel): LocalEntry => ({
  kind: "slice",
  id: model.id,
  model,
  path: `src/lib/slices/${model.id}/model.json`,
});
const sliceRemote = (model: PrismicModel): RemoteEntry => ({ kind: "slice", id: model.id, model });

const plan = (slices: string[], type = "page"): MigrationPlan => ({
  customTypes: [],
  documents: [
    {
      type,
      uid: "home",
      data: {
        slices: slices.map((slice_type) => ({
          slice_type,
          variation: "default",
          primary: {},
          items: [],
        })),
      },
    },
  ],
  assets: [],
  stylesManifest: [],
  diagnostics: [],
});

/** The carousel fixture with `review.primary.layout` removed — the exact field
 *  that shipped missing on beachfront. */
function carouselWithoutLayout(): PrismicModel {
  const m = clone(carousel);
  const review = (m.variations as { id: string; primary: Record<string, unknown> }[]).find(
    (v) => v.id === "review",
  )!;
  delete review.primary.layout;
  return m;
}

describe("touchedModels", () => {
  it("lists the custom type of every doc and the slice type of every slice, once each, sorted", () => {
    const p = plan(["hero", "carousel", "hero"]);
    p.documents.push({ type: "page", uid: "team", data: { slices: [{ slice_type: "carousel" }] } });
    p.documents.push({ type: "settings", uid: "settings", data: { site_name: "x" } }); // no zone
    expect(touchedModels(p)).toEqual([
      { kind: "customtype", id: "page" },
      { kind: "customtype", id: "settings" },
      { kind: "slice", id: "carousel" },
      { kind: "slice", id: "hero" },
    ]);
  });
});

describe("staleModels", () => {
  it("names a touched slice whose REMOTE lacks a field the local declares, with describeDiff's line", () => {
    const diff = diffModels(
      [ctLocal(page), sliceLocal(carousel)],
      [ctRemote(page), sliceRemote(carouselWithoutLayout())],
    );
    expect(staleModels(diff, touchedModels(plan(["carousel"])))).toEqual([
      { kind: "slice", id: "carousel", reason: "differs", lines: ["+ review.primary.layout"] },
    ]);
  });

  it("passes an identical fleet", () => {
    const diff = diffModels(
      [ctLocal(page), sliceLocal(carousel)],
      [ctRemote(page), sliceRemote(carousel)],
    );
    expect(staleModels(diff, touchedModels(plan(["carousel"])))).toEqual([]);
  });

  it("ignores drift on a model the plan does not touch — that is a warning, not a refusal", () => {
    const diff = diffModels(
      [ctLocal(page), sliceLocal(carousel)],
      [ctRemote(page), sliceRemote(carouselWithoutLayout())],
    );
    const touched = touchedModels(plan([])); // page only, no slices
    expect(staleModels(diff, touched)).toEqual([]);
    expect(untouchedDrift(diff, touched)).toEqual([{ kind: "slice", id: "carousel" }]);
  });

  it("never reports a remote-only model the plan does not touch", () => {
    const diff = diffModels([ctLocal(page)], [ctRemote(page), sliceRemote(carousel)]);
    expect(staleModels(diff, touchedModels(plan([])))).toEqual([]);
  });

  it("reports a touched slice with no local model — the fixture test could not have checked it", () => {
    const diff = diffModels([ctLocal(page)], [ctRemote(page), sliceRemote(carousel)]);
    expect(staleModels(diff, touchedModels(plan(["carousel"])))).toEqual([
      { kind: "slice", id: "carousel", reason: "no local model", lines: [] },
    ]);
  });

  it("reports a touched custom type Prismic has never seen as not registered", () => {
    const diff = diffModels([ctLocal(page), sliceLocal(carousel)], [sliceRemote(carousel)]);
    expect(staleModels(diff, touchedModels(plan(["carousel"])))).toEqual([
      { kind: "customtype", id: "page", reason: "not registered", lines: [] },
    ]);
  });
});

describe("renderRefusal", () => {
  it("starts with REFUSED:, names each model, indents the field lines, and says what to run", () => {
    const text = renderRefusal(
      [
        { kind: "customtype", id: "page", reason: "not registered", lines: [] },
        { kind: "slice", id: "carousel", reason: "differs", lines: ["+ review.primary.layout"] },
        { kind: "slice", id: "ghost", reason: "no local model", lines: [] },
      ],
      "./beachfront-dentistry",
    );
    expect(text.startsWith("REFUSED: 3 model(s)")).toBe(true);
    expect(text).toContain("silently DROP");
    expect(text).toContain("Nothing was uploaded and nothing was staged.");
    expect(text).toContain("  customtype page: NOT REGISTERED");
    expect(text).toContain("  slice carousel:\n    + review.primary.layout");
    expect(text).toContain("  slice ghost: no local model");
    expect(text).toContain("reddoor-maint prismic-models ./beachfront-dentistry --apply");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd "$MAINT" && pnpm exec vitest run tests/prismic/seed/in-sync.test.ts 2>&1 | tail -n 8
```

Expected: `Error: Failed to load url ../../../src/prismic/seed/in-sync.js`.

- [ ] **Step 3: Write the implementation**

Create `src/prismic/seed/in-sync.ts`:

```ts
// The seed precondition, as pure functions over the model pipeline's diff.
//
// The Migration API validates each document against the models registered in
// Prismic and silently drops every field the model does not declare — HTTP
// 200, no warning. Five such fields shipped on beachfront-dentistry
// (hero/subpage `image_position` `heading_style` `hero_wash`, carousel/review
// `layout`, collection_list/people `order_uids`): the fixture was right, the
// local model.json was right, the site's unit test was green, and the
// published pages rendered component defaults. A unit test cannot catch this;
// the binding constraint is the REMOTE model, which needs the network. Hence
// `staleModels`, called by prismic-seed and webflow migrate before any write.
import { describeDiff } from "../models/index.js";
import type { ModelDiff, ModelKind } from "../models/index.js";
import type { MigrationPlan } from "../../blux/emit/plan.js";

/** A model a migration plan WRITES: the custom type of every document, and the
 *  slice type of every entry in each document's `slices` zone. */
export type TouchedModel = { kind: ModelKind; id: string };

/** Why a touched model blocks the migration. `lines` are describeDiff's, for
 *  `differs` only. */
export type StaleModel = TouchedModel & {
  reason: "not registered" | "differs" | "no local model";
  lines: string[];
};

const key = (e: TouchedModel): string => `${e.kind}:${e.id}`;

/** Every model the plan's documents would be validated against — unique,
 *  sorted, custom types first. Pure. Only the `slices` zone is walked: that is
 *  the one place a document names a slice model. */
export function touchedModels(plan: MigrationPlan): TouchedModel[] {
  const seen = new Map<string, TouchedModel>();
  const add = (t: TouchedModel): void => {
    if (!seen.has(key(t))) seen.set(key(t), t);
  };
  for (const doc of plan.documents) {
    add({ kind: "customtype", id: doc.type });
    const slices = doc.data.slices;
    if (!Array.isArray(slices)) continue;
    for (const s of slices) {
      const id = (s as { slice_type?: unknown } | null)?.slice_type;
      if (typeof id === "string" && id !== "") add({ kind: "slice", id });
    }
  }
  return [...seen.values()].sort(
    (a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id),
  );
}

/** Scope is the models the plan TOUCHES. Drift on a model this migration never
 *  writes is the nightly sweep's business, not a reason to refuse a seed.
 *  `diff.remoteOnly` never appears here on its own; a touched model that
 *  exists only in Prismic reports as `no local model`, because the site's
 *  fixture-vs-model test could not have checked it. */
export function staleModels(diff: ModelDiff, touched: readonly TouchedModel[]): StaleModel[] {
  const toCreate = new Set(diff.toCreate.map(key));
  const toUpdate = new Map(diff.toUpdate.map((u) => [key(u.local), u] as const));
  const unchanged = new Set(diff.unchanged.map(key));
  const out: StaleModel[] = [];
  for (const t of touched) {
    const k = key(t);
    if (toCreate.has(k)) {
      out.push({ ...t, reason: "not registered", lines: [] });
    } else if (toUpdate.has(k)) {
      const u = toUpdate.get(k)!;
      out.push({ ...t, reason: "differs", lines: describeDiff(u.local.model, u.remote.model) });
    } else if (!unchanged.has(k)) {
      out.push({ ...t, reason: "no local model", lines: [] });
    }
  }
  return out;
}

/** Models that differ but that the plan does NOT write — printed as a warning,
 *  never a refusal. */
export function untouchedDrift(diff: ModelDiff, touched: readonly TouchedModel[]): TouchedModel[] {
  const t = new Set(touched.map(key));
  return [
    ...diff.toCreate.map((e) => ({ kind: e.kind, id: e.id })),
    ...diff.toUpdate.map((u) => ({ kind: u.local.kind, id: u.local.id })),
  ].filter((e) => !t.has(key(e)));
}

/** The refusal text both `prismic-seed` and `webflow migrate` print. Starts
 *  with `REFUSED:` — that prefix is the contract the tests and the operator
 *  grep for. `site` is echoed into the fix command exactly as the operator
 *  typed it. */
export function renderRefusal(stale: readonly StaleModel[], site: string): string {
  const lines = [
    `REFUSED: ${stale.length} model(s) this migration writes are not registered in Prismic ` +
      `in their current local form. The Migration API would silently DROP every field the ` +
      `remote model does not declare (HTTP 200, no warning). Nothing was uploaded and ` +
      `nothing was staged.`,
  ];
  for (const s of stale) {
    if (s.reason === "differs") {
      lines.push(`  ${s.kind} ${s.id}:`);
      for (const l of s.lines) lines.push(`    ${l}`);
    } else if (s.reason === "not registered") {
      lines.push(`  ${s.kind} ${s.id}: NOT REGISTERED`);
    } else {
      lines.push(`  ${s.kind} ${s.id}: no local model`);
    }
  }
  lines.push(
    `Push them first: reddoor-maint prismic-models ${site} --apply  (or merge the model PR so ` +
      `prismic-models.yml applies it), then re-run.`,
  );
  return lines.join("\n");
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd "$MAINT" && pnpm exec vitest run tests/prismic/seed/in-sync.test.ts 2>&1 | tail -n 6
```

Expected: `Tests  8 passed (8)`.

- [ ] **Step 5: Mutate the assertion and watch it go red, then put it back**

The first `staleModels` test must fail for the reason it claims — a field the LOCAL declares and the REMOTE lacks. Flip the direction on purpose: in `tests/prismic/seed/in-sync.test.ts`, temporarily change that test's `diffModels` call to delete the field from the LOCAL side instead:

```ts
const diff = diffModels(
  [ctLocal(page), sliceLocal(carouselWithoutLayout())],
  [ctRemote(page), sliceRemote(carousel)],
);
```

```bash
cd "$MAINT" && pnpm exec vitest run tests/prismic/seed/in-sync.test.ts -t "names a touched slice" 2>&1 | grep -A3 'lines'
```

Expected: the assertion fails with the OTHER direction's wording — `- "lines": ["+ review.primary.layout"]` vs `+ "lines": ["- review.primary.layout (only in Prismic — pushing DELETES it)"]`. That proves the test measures direction, not merely "something differs". Restore the original lines (local = `carousel`, remote = `carouselWithoutLayout()`), re-run, `8 passed`.

- [ ] **Step 6: Commit**

```bash
cd "$MAINT" && pnpm exec prettier --write src/prismic/seed/in-sync.ts tests/prismic/seed/in-sync.test.ts
git add src/prismic/seed/in-sync.ts tests/prismic/seed/in-sync.test.ts
git commit -m "feat(seed): touched → stale models over the model diff, and the REFUSED text

Beachfront's assertModelsInSync, ported onto diffModels/describeDiff and
extended to custom types; scope is the models the plan touches.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: `src/prismic/seed/creds.ts` — repo id and token from the site's own config

**Files:** Create: `$MAINT/src/prismic/seed/creds.ts` · Test: `$MAINT/tests/prismic/seed/creds.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/prismic/seed/creds.test.ts`:

```ts
// Repo id + token for ONE site, from the site's own config — never a hard-coded
// repository name (beachfront had `REPO = "48bb12d1"` in four scripts), never a
// sibling repo's .env (it read BEACHFRONT_DENTISTRY_WRITE_TOKEN out of
// reddoor-starter/.env). The env var NAME is reported; the value never is.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveSeedCreds } from "../../../src/prismic/seed/creds.js";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "seed-creds-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const site = (repositoryName: string): Promise<void> =>
  writeFile(
    join(dir, "slicemachine.config.json"),
    JSON.stringify({ repositoryName, libraries: ["./src/lib/slices"] }),
  );

describe("resolveSeedCreds", () => {
  it("derives the env var from the repository name and reports the NAME, not the value", async () => {
    await site("48bb12d1");
    const r = await resolveSeedCreds(
      dir,
      { PRISMIC_TOKEN_48BB12D1: "s3cr3t-value" },
      { allowGeneric: true },
    );
    expect(r).toEqual({
      ok: true,
      repositoryName: "48bb12d1",
      libraries: ["./src/lib/slices"],
      token: "s3cr3t-value",
      source: "PRISMIC_TOKEN_48BB12D1",
    });
  });

  it("falls back to PRISMIC_WRITE_TOKEN only when allowGeneric is set", async () => {
    await site("vida-legacy");
    const generic = { PRISMIC_WRITE_TOKEN: "generic-value" };
    expect(await resolveSeedCreds(dir, generic, { allowGeneric: true })).toMatchObject({
      ok: true,
      source: "PRISMIC_WRITE_TOKEN",
    });
    const refused = await resolveSeedCreds(dir, generic, { allowGeneric: false });
    expect(refused.ok).toBe(false);
    const error = (refused as { error: string }).error;
    expect(error).toContain("PRISMIC_TOKEN_VIDA_LEGACY");
    expect(error).not.toContain("generic-value");
  });

  it("is not a Prismic site without a config, and says so", async () => {
    const r = await resolveSeedCreds(dir, {}, { allowGeneric: true });
    expect(r.ok).toBe(false);
    expect((r as { error: string }).error).toContain("not a Prismic site");
  });

  it("treats the starter sentinel repositoryName as not-a-site", async () => {
    await site("your-prismic-repo-name");
    const r = await resolveSeedCreds(dir, { PRISMIC_WRITE_TOKEN: "x" }, { allowGeneric: true });
    expect(r.ok).toBe(false);
    expect((r as { error: string }).error).toContain("not a Prismic site");
  });

  it("distinguishes a broken config from a missing one", async () => {
    await writeFile(join(dir, "slicemachine.config.json"), "{not json");
    const r = await resolveSeedCreds(dir, {}, { allowGeneric: true });
    expect(r.ok).toBe(false);
    expect((r as { error: string }).error).toContain("present but unusable");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd "$MAINT" && pnpm exec vitest run tests/prismic/seed/creds.test.ts 2>&1 | tail -n 8
```

Expected: `Error: Failed to load url ../../../src/prismic/seed/creds.js`.

- [ ] **Step 3: Write the implementation**

Create `src/prismic/seed/creds.ts`:

```ts
import { prismicTokenEnvName, readPrismicConfig, resolvePrismicToken } from "../models/index.js";
import type { PrismicConfig } from "../models/index.js";

export type SeedCreds =
  | { ok: true; repositoryName: string; libraries: string[]; token: string; source: string }
  | { ok: false; error: string };

export const describeThrown = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** Repo id + write token for ONE site, from the site's own config — never a
 *  hard-coded repository name, never a sibling repo's `.env`.
 *
 *  Mirrors the single-site half of prismic-models' `readSiteInputs`:
 *  `readPrismicConfig` returns null for "no Prismic here" and THROWS for a
 *  config that is present and broken, and those two must stay distinct — a
 *  live site whose config broke must not read as "not a site".
 *
 *  The token comes from `PRISMIC_TOKEN_<REPO>` (credentials.env, loaded into
 *  the env at CLI start) or, with `allowGeneric`, from `PRISMIC_WRITE_TOKEN` —
 *  the in-repo CI name, acceptable only because a seed is a single-site run.
 *  `source` is the env var NAME, for printing; the value is never printed. */
export async function resolveSeedCreds(
  repoRoot: string,
  env: Record<string, string | undefined>,
  opts: { allowGeneric: boolean },
): Promise<SeedCreds> {
  let cfg: PrismicConfig | null;
  try {
    cfg = await readPrismicConfig(repoRoot);
  } catch (e) {
    return {
      ok: false,
      error: `Prismic config present but unusable in ${repoRoot}: ${describeThrown(e)}`,
    };
  }
  if (!cfg) {
    return {
      ok: false,
      error:
        `not a Prismic site: no slicemachine.config.json/prismic.config.json with a real ` +
        `repositoryName in ${repoRoot}`,
    };
  }
  let canonical: string;
  try {
    canonical = prismicTokenEnvName(cfg.repositoryName);
  } catch (e) {
    return {
      ok: false,
      error: `cannot work out which env var holds this repository's token: ${describeThrown(e)}`,
    };
  }
  const resolved = resolvePrismicToken(cfg.repositoryName, env, {
    allowGeneric: opts.allowGeneric,
  });
  if (!resolved) {
    const names = opts.allowGeneric ? `${canonical} or PRISMIC_WRITE_TOKEN` : canonical;
    return {
      ok: false,
      error:
        `no write token for Prismic repository "${cfg.repositoryName}" — set ${names} ` +
        `(in ~/.config/reddoor-maint/credentials.env, or the shell)`,
    };
  }
  return {
    ok: true,
    repositoryName: cfg.repositoryName,
    libraries: cfg.libraries,
    token: resolved.token,
    source: resolved.source,
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd "$MAINT" && pnpm exec vitest run tests/prismic/seed/creds.test.ts 2>&1 | tail -n 6
```

Expected: `Tests  5 passed (5)`.

- [ ] **Step 5: Commit**

```bash
cd "$MAINT" && pnpm exec prettier --write src/prismic/seed/creds.ts tests/prismic/seed/creds.test.ts
git add src/prismic/seed/creds.ts tests/prismic/seed/creds.test.ts
git commit -m "feat(seed): resolveSeedCreds — repo id and token from the site's own config

PRISMIC_TOKEN_<REPO> first, PRISMIC_WRITE_TOKEN only when allowed; the env
var name is what gets printed.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: `src/prismic/seed/preflight.ts` — the one IO composition both commands call

**Files:** Create: `$MAINT/src/prismic/seed/preflight.ts` · Test: covered by Task 7's command test (including the remote-read-failure path this header promises: a failure, never an empty model set, and never the token value) and Task 9's webflow test (this task only typechecks)

- [ ] **Step 1: Write the module**

Create `src/prismic/seed/preflight.ts`:

```ts
import type { MigrationPlan } from "../../blux/emit/plan.js";
import type { MigrationCreds } from "../../blux/emit/run-migration.js";
import { diffModels, localModels } from "../models/index.js";
import type { LocalEntry, RemoteEntry } from "../models/index.js";
import { describeThrown, resolveSeedCreds } from "./creds.js";
import { renderRefusal, staleModels, touchedModels, untouchedDrift } from "./in-sync.js";

/** Injected IO. `remoteModels` is the one network read; `env` is where the
 *  token comes from. Both commands' tests hand in stubs. */
export type SeedPreflightDeps = {
  remoteModels: (repo: string, token: string) => Promise<RemoteEntry[]>;
  env: Record<string, string | undefined>;
};

export type SeedPreflight =
  | { ok: true; creds: MigrationCreds; source: string; notes: string[] }
  | { ok: false; output: string; code: 1 };

/** Everything that must be true BEFORE a plan touches the Asset or Migration
 *  API, shared by `prismic-seed` and `webflow migrate`: the site is a Prismic
 *  site, its token resolves, its local models read, Prismic's models read, and
 *  every model the plan writes is registered in Prismic in its current local
 *  form. Any other answer is `{ ok: false }` with exit 1 and prose that says
 *  nothing was migrated — never a default that lets the migration proceed. A
 *  remote read failure in particular is a FAILURE, never an empty model set
 *  (which would sort every touched model into "not registered" and refuse for
 *  the wrong reason — or, in a future that skipped the check, push blind). */
export async function seedPreflight(
  plan: MigrationPlan,
  repoRoot: string,
  siteLabel: string,
  deps: SeedPreflightDeps,
): Promise<SeedPreflight> {
  const creds = await resolveSeedCreds(repoRoot, deps.env, { allowGeneric: true });
  if (!creds.ok) return { ok: false, output: `${creds.error} — nothing was migrated`, code: 1 };

  let local: LocalEntry[];
  try {
    local = await localModels(repoRoot, creds.libraries);
  } catch (e) {
    return {
      ok: false,
      output: `could not read this repo's own models: ${describeThrown(e)} — nothing was migrated`,
      code: 1,
    };
  }
  let remote: RemoteEntry[];
  try {
    remote = await deps.remoteModels(creds.repositoryName, creds.token);
  } catch (e) {
    return {
      ok: false,
      output:
        `could not read Prismic models for "${creds.repositoryName}" (token from ` +
        `${creds.source}): ${describeThrown(e)} — nothing was migrated`,
      code: 1,
    };
  }

  const diff = diffModels(local, remote);
  const touched = touchedModels(plan);
  const stale = staleModels(diff, touched);
  if (stale.length > 0) return { ok: false, output: renderRefusal(stale, siteLabel), code: 1 };

  const notes: string[] = [];
  const drift = untouchedDrift(diff, touched);
  if (drift.length > 0) {
    notes.push(
      `⚠ ${drift.length} model(s) this migration does not write differ from Prismic ` +
        `(not a refusal): ${drift.map((d) => `${d.kind} ${d.id}`).join(", ")}`,
    );
  }
  notes.push(
    `models in sync: ${touched.length} checked (${touched
      .map((t) => `${t.kind} ${t.id}`)
      .join(", ")})`,
  );
  return {
    ok: true,
    creds: {
      repo: creds.repositoryName,
      token: creds.token,
      accessToken: deps.env.PRISMIC_ACCESS_TOKEN,
    },
    source: creds.source,
    notes,
  };
}
```

- [ ] **Step 2: Verify it typechecks**

```bash
cd "$MAINT" && pnpm typecheck && echo TYPECHECK-OK
```

Expected: `TYPECHECK-OK` (tsc prints nothing on success).

- [ ] **Step 3: Commit**

```bash
cd "$MAINT" && pnpm exec prettier --write src/prismic/seed/preflight.ts
git add src/prismic/seed/preflight.ts
git commit -m "feat(seed): seedPreflight — creds, local, remote, diff, refuse; one composition for both commands

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: `prismic-seed` command

**Files:** Create: `$MAINT/src/cli/commands/prismic-seed.ts` · Test: `$MAINT/tests/cli/prismic-seed-command.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/cli/prismic-seed-command.test.ts` (pattern: `tests/cli/prismic-models-command.test.ts:15-55` — a site in a temp dir, a `deps` builder; the runner is injected through deps rather than `vi.mock`'d so a test can assert the creds it was handed):

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MigrationResult } from "../../src/blux/emit/run-migration.js";
import type { RemoteEntry } from "../../src/prismic/models/index.js";
import {
  runPrismicSeedCommand,
  type PrismicSeedDeps,
} from "../../src/cli/commands/prismic-seed.js";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "prismic-seed-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const PAGE = {
  id: "page",
  label: "Page",
  repeatable: true,
  json: { Main: { uid: { type: "UID" }, slices: { type: "Slices" } } },
};
const HERO = {
  id: "hero",
  type: "SharedSlice",
  variations: [
    {
      id: "default",
      primary: {
        heading: { type: "StructuredText" },
        hero_wash: { type: "Boolean" },
        background_image: { type: "Image" },
      },
      items: {},
    },
  ],
};

/** A site on disk: config + the `page` type + the `hero` slice. */
async function site(): Promise<void> {
  await writeFile(
    join(dir, "slicemachine.config.json"),
    JSON.stringify({ repositoryName: "48bb12d1", libraries: ["./src/lib/slices"] }),
  );
  await mkdir(join(dir, "customtypes", "page"), { recursive: true });
  await writeFile(join(dir, "customtypes", "page", "index.json"), JSON.stringify(PAGE));
  await mkdir(join(dir, "src", "lib", "slices", "Hero"), { recursive: true });
  await writeFile(join(dir, "src", "lib", "slices", "Hero", "model.json"), JSON.stringify(HERO));
}

/** What Prismic holds: identical, or a hero missing `hero_wash` — the field
 *  that shipped missing on beachfront. */
const remoteInSync: RemoteEntry[] = [
  { kind: "customtype", id: "page", model: PAGE },
  { kind: "slice", id: "hero", model: HERO },
];
const remoteStale: RemoteEntry[] = [
  { kind: "customtype", id: "page", model: PAGE },
  {
    kind: "slice",
    id: "hero",
    model: {
      ...HERO,
      variations: [
        {
          id: "default",
          primary: { heading: { type: "StructuredText" }, background_image: { type: "Image" } },
          items: {},
        },
      ],
    },
  },
];

const IMG = "https://cdn/x/hero.jpg";
const fixtureModule = {
  documents: (img: (u: string, alt?: string) => unknown) => [
    {
      type: "page",
      uid: "home",
      title: "Home",
      data: {
        slices: [
          {
            slice_type: "hero",
            variation: "default",
            primary: { heading: [], hero_wash: true, background_image: img(IMG), cta_link: {} },
            items: [],
          },
        ],
      },
    },
  ],
};

const result = (): MigrationResult => ({
  assetsUploaded: 1,
  assetsReused: 0,
  docsCreated: 1,
  docsUpdated: 0,
  missingAssets: [],
  assetUrlByCdn: new Map(),
});

const deps = (remote: RemoteEntry[], over: Partial<PrismicSeedDeps> = {}): PrismicSeedDeps => ({
  importFixture: vi.fn<PrismicSeedDeps["importFixture"]>(async () => fixtureModule),
  remoteModels: vi.fn<PrismicSeedDeps["remoteModels"]>(async () => remote),
  runMigration: vi.fn<PrismicSeedDeps["runMigration"]>(async () => result()),
  env: { PRISMIC_TOKEN_48BB12D1: "s3cr3t-value" },
  ...over,
});

describe("runPrismicSeedCommand", () => {
  it("fails with 'could not import' when the fixture does not load, touching nothing", async () => {
    await site();
    const d = deps(remoteInSync, {
      importFixture: vi.fn<PrismicSeedDeps["importFixture"]>(async () => {
        throw new Error("Cannot find module '/nope.js'");
      }),
    });
    const r = await runPrismicSeedCommand("nope.js", undefined, { cwd: dir }, d);
    expect(r.code).toBe(1);
    expect(r.output).toContain("could not import");
    expect(r.output).toContain("Cannot find module");
    expect(d.remoteModels).not.toHaveBeenCalled();
    expect(d.runMigration).not.toHaveBeenCalled();
  });

  it("rejects a module that does not export documents()", async () => {
    await site();
    const d = deps(remoteInSync, {
      importFixture: vi.fn<PrismicSeedDeps["importFixture"]>(async () => ({
        assemblies: () => ({}),
      })),
    });
    const r = await runPrismicSeedCommand("pages.js", undefined, { cwd: dir }, d);
    expect(r.code).toBe(1);
    expect(r.output).toContain("does not export documents(img)");
    expect(d.runMigration).not.toHaveBeenCalled();
  });

  it("is not a Prismic site without a config: code 1, nothing migrated", async () => {
    const d = deps(remoteInSync);
    const r = await runPrismicSeedCommand("pages.js", undefined, { cwd: dir }, d);
    expect(r.code).toBe(1);
    expect(r.output).toContain("not a Prismic site");
    expect(r.output).toContain("nothing was migrated");
    expect(d.runMigration).not.toHaveBeenCalled();
  });

  it("REFUSES when a touched model is stale in Prismic, naming model and field, and never calls the runner — even with --apply", async () => {
    await site();
    const d = deps(remoteStale);
    const r = await runPrismicSeedCommand("pages.js", undefined, { cwd: dir, apply: true }, d);
    expect(r.code).toBe(1);
    expect(r.output.startsWith("REFUSED")).toBe(true);
    expect(r.output).toContain("slice hero:");
    expect(r.output).toContain("+ default.primary.hero_wash");
    expect(r.output).toContain("reddoor-maint prismic-models . --apply");
    expect(d.runMigration).not.toHaveBeenCalled();
  });

  it("in sync + no --apply: code 0, lists what WOULD be staged, runner not called, token value never printed", async () => {
    await site();
    const d = deps(remoteInSync);
    const r = await runPrismicSeedCommand("pages.js", undefined, { cwd: dir }, d);
    expect(r.code).toBe(0);
    expect(r.output).toContain("models in sync: 2 checked (customtype page, slice hero)");
    expect(r.output).toContain("DRY RUN");
    expect(r.output).toContain('page home "Home" (1 slices, lang en-us)');
    expect(r.output).toContain("1 asset(s)");
    expect(r.output).toContain("token: PRISMIC_TOKEN_48BB12D1");
    expect(r.output).not.toContain("s3cr3t-value");
    expect(d.runMigration).not.toHaveBeenCalled();
  });

  it("--apply calls the runner once with the site's creds and documents carrying title, lang and no `{}` fields", async () => {
    await site();
    const d = deps(remoteInSync);
    const r = await runPrismicSeedCommand(
      "pages.js",
      undefined,
      { cwd: dir, apply: true, lang: "en-gb" },
      d,
    );
    expect(r.code).toBe(0);
    expect(d.runMigration).toHaveBeenCalledTimes(1);
    const [plan, , creds] = vi.mocked(d.runMigration).mock.calls[0]!;
    expect(creds).toEqual({ repo: "48bb12d1", token: "s3cr3t-value", accessToken: undefined });
    expect(plan.documents[0]).toMatchObject({
      type: "page",
      uid: "home",
      title: "Home",
      lang: "en-gb",
    });
    expect(JSON.stringify(plan.documents[0]!.data)).not.toContain("cta_link");
    expect(plan.assets).toEqual([{ id: IMG, url: IMG, alt: "" }]);
    expect(r.output).toContain(
      "1 created, 0 updated, 1 assets uploaded, 0 reused, 0 Missing asset",
    );
    expect(r.output).toContain("UNPUBLISHED migration release");
  });

  it("resolves [site] and the fixture path relative to cwd", async () => {
    await site();
    const d = deps(remoteInSync);
    const r = await runPrismicSeedCommand(join(dir, "pages.js"), dir, { cwd: tmpdir() }, d);
    expect(r.code).toBe(0);
    expect(vi.mocked(d.importFixture).mock.calls[0]![0]).toBe(join(dir, "pages.js"));
  });

  // preflight.ts promises that a remote read failure is a FAILURE, never an
  // empty model set (which would refuse every touched model for the wrong
  // reason). This is the one path that prints the token SOURCE inside an error
  // message, so it is also where a future edit would most easily leak a value.
  it("fails, not refuses, when Prismic's models cannot be read — runner never called, token value never printed", async () => {
    await site();
    const d = deps(remoteInSync, {
      remoteModels: vi.fn<PrismicSeedDeps["remoteModels"]>(async () => {
        throw new Error("401 Unauthorized");
      }),
    });
    const r = await runPrismicSeedCommand("pages.js", undefined, { cwd: dir, apply: true }, d);
    expect(r.code).toBe(1);
    expect(r.output.startsWith("REFUSED")).toBe(false);
    expect(r.output).toContain(
      'could not read Prismic models for "48bb12d1" (token from PRISMIC_TOKEN_48BB12D1)',
    );
    expect(r.output).toContain("401 Unauthorized");
    expect(r.output).toContain("nothing was migrated");
    expect(r.output).not.toContain("s3cr3t-value");
    expect(d.runMigration).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd "$MAINT" && pnpm exec vitest run tests/cli/prismic-seed-command.test.ts 2>&1 | tail -n 8
```

Expected: `Error: Failed to load url ../../src/cli/commands/prismic-seed.js`.

- [ ] **Step 3: Write the implementation**

Create `src/cli/commands/prismic-seed.ts`:

```ts
// `prismic-seed <fixture> [site]` — stage a site's fixture documents into a
// Prismic migration release through the shared runner. Dry by default.
//
// ORDER IS THE WHOLE POINT: import → plan → preflight (creds, local models,
// remote models, REFUSE on any touched model that is stale) → dry listing or
// runMigration. Nothing reaches the Asset or Migration API before the refusal
// has had its say, because the Migration API drops undeclared fields at HTTP
// 200 with no warning — the failure that shipped five missing fields on
// beachfront. Exit 1 on a refusal (a finding must not exit 0 — the `--pull`
// rule in prismic-models.ts); 2 stays reserved for contradictory flags, of
// which this command has none yet.
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { MigrationPlan } from "../../blux/emit/plan.js";
import { runMigration as runMigrationImpl } from "../../blux/emit/run-migration.js";
import type { MigrationCreds, MigrationResult } from "../../blux/emit/run-migration.js";
import { remoteModels as remoteModelsImpl } from "../../prismic/models/index.js";
import { describeThrown } from "../../prismic/seed/creds.js";
import { fixtureToPlan, isSeedFixture } from "../../prismic/seed/plan.js";
import { seedPreflight, type SeedPreflightDeps } from "../../prismic/seed/preflight.js";

export type PrismicSeedCommandOptions = {
  /** Write. Without it the command imports, plans, runs the preflight and
   *  prints what it WOULD stage. */
  apply?: boolean;
  /** Locale for every staged document; overrides the fixture's `lang` export. */
  lang?: string;
  cwd?: string;
};

/** Injected IO, so the command is testable with no network, no token and no
 *  fixture on disk. `runMigration` is injected rather than vi.mock'd so a test
 *  can assert the creds it was handed. */
export type PrismicSeedDeps = SeedPreflightDeps & {
  importFixture: (path: string) => Promise<unknown>;
  runMigration: (
    plan: MigrationPlan,
    log: (line: string) => void,
    creds: MigrationCreds,
  ) => Promise<MigrationResult>;
};

export const defaultSeedDeps = (): PrismicSeedDeps => ({
  importFixture: (path) => import(pathToFileURL(path).href) as Promise<unknown>,
  remoteModels: (repo, token) => remoteModelsImpl(repo, token),
  runMigration: (plan, log, creds) => runMigrationImpl(plan, log, creds),
  env: process.env,
});

export async function runPrismicSeedCommand(
  fixture: string | undefined,
  site: string | undefined,
  opts: PrismicSeedCommandOptions,
  deps: PrismicSeedDeps = defaultSeedDeps(),
): Promise<{ output: string; code: number }> {
  if (!fixture) {
    return {
      output: "prismic-seed needs a fixture module path (e.g. src/lib/site-pages.js).",
      code: 1,
    };
  }
  const cwd = opts.cwd ? resolve(opts.cwd) : process.cwd();
  const repoRoot = site ? resolve(cwd, site) : cwd;
  const fixturePath = resolve(cwd, fixture);
  const siteLabel = site ?? ".";

  // 1. The fixture — pure ESM, imported by node. A site module that reaches
  //    for `$lib` or a browser global fails HERE with the loader's message.
  let mod: unknown;
  try {
    mod = await deps.importFixture(fixturePath);
  } catch (e) {
    return { output: `could not import fixture ${fixturePath}: ${describeThrown(e)}`, code: 1 };
  }
  if (!isSeedFixture(mod)) {
    return {
      output:
        `fixture ${fixturePath} does not export documents(img) — see ` +
        `src/prismic/seed/plan.ts for the contract`,
      code: 1,
    };
  }

  // 2. The plan, offline.
  let plan: MigrationPlan;
  try {
    plan = fixtureToPlan(mod, { lang: opts.lang });
  } catch (e) {
    return {
      output: `fixture ${fixturePath} threw while building documents: ${describeThrown(e)}`,
      code: 1,
    };
  }
  if (plan.documents.length === 0) {
    return { output: `fixture ${fixturePath} returned no documents — nothing to stage`, code: 1 };
  }

  // 3. Creds from the SITE's config, both model sets, the refusal.
  const pre = await seedPreflight(plan, repoRoot, siteLabel, deps);
  if (!pre.ok) return { output: pre.output, code: pre.code };

  const lines = [...pre.notes];
  const summary = plan.documents.map((d) => {
    const n = Array.isArray(d.data.slices) ? (d.data.slices as unknown[]).length : 0;
    return `  ${d.type} ${d.uid} "${d.title ?? d.uid}" (${n} slices, lang ${d.lang ?? "en-us"})`;
  });

  // 4. Dry: say exactly what would be staged.
  if (!opts.apply) {
    lines.push(
      `DRY RUN — would stage ${plan.documents.length} document(s) and ${plan.assets.length} ` +
        `asset(s) into Prismic "${pre.creds.repo}" (token: ${pre.source}):`,
      ...summary,
      `Re-run with --apply to write. Documents land in an UNPUBLISHED migration release; ` +
        `publish it in the Prismic dashboard.`,
    );
    return { output: lines.join("\n"), code: 0 };
  }

  // 5. Apply. Progress to stderr (a throttled run takes minutes; silence reads
  //    as a hang); stdout stays the summary.
  const r = await deps.runMigration(plan, (line) => process.stderr.write(`${line}\n`), pre.creds);
  const miss =
    r.missingAssets.length === 0
      ? "0 Missing asset"
      : `${r.missingAssets.length} Missing asset: ${r.missingAssets.join(", ")}`;
  lines.push(
    `${r.docsCreated} created, ${r.docsUpdated} updated, ${r.assetsUploaded} assets uploaded, ` +
      `${r.assetsReused} reused, ${miss}`,
    ...summary,
    `Staged into an UNPUBLISHED migration release on "${pre.creds.repo}" — publish it in the ` +
      `Prismic dashboard. The release cannot be read back; a re-run re-POSTs each document and ` +
      `falls back to PUT by its master id.`,
  );
  return { output: lines.join("\n"), code: r.missingAssets.length === 0 ? 0 : 1 };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd "$MAINT" && pnpm typecheck && pnpm exec vitest run tests/cli/prismic-seed-command.test.ts 2>&1 | tail -n 6
```

Expected: `Tests  8 passed (8)`.

- [ ] **Step 5: Commit**

```bash
cd "$MAINT" && pnpm exec prettier --write src/cli/commands/prismic-seed.ts tests/cli/prismic-seed-command.test.ts
git add src/cli/commands/prismic-seed.ts tests/cli/prismic-seed-command.test.ts
git commit -m "feat(cli): prismic-seed <fixture> [site] — dry by default, refuses on model drift

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: Register `prismic-seed` in bin.ts, pinned both ways

**Files:** Modify: `$MAINT/src/cli/bin.ts` (insert after line 312, the `  );` that closes the `prismic-models` action; before line 314 `cli` / `.command("upgrade <upgrade> [site]"…`) · Test: `$MAINT/tests/cli/prismic-seed-registration.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/cli/prismic-seed-registration.test.ts` (pattern: `tests/cli/prismic-models-registration.test.ts` — FLAGS ↔ options type ↔ bin.ts source, then the CLI run from SOURCE via tsx):

```ts
// The CLI surface of prismic-seed: every flag the command honours is one a
// shell can type, and every flag bin.ts advertises is one the command reads.
// See tests/cli/prismic-models-registration.test.ts for the two failure shapes
// (an unregistered flag hard-errors in cac; a registered-but-unread flag is
// the silent no-op this pipeline exists to eliminate).
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import type { PrismicSeedCommandOptions } from "../../src/cli/commands/prismic-seed.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../..");
const binSource = readFileSync(join(repoRoot, "src/cli/bin.ts"), "utf-8");

const FLAGS = {
  "--apply": "apply",
  "--lang": "lang",
} as const satisfies Record<string, keyof PrismicSeedCommandOptions>;

/** Reverse direction, at compile time: every option the command honours has a
 *  flag. `cwd` is the GLOBAL cac option. */
type Uncovered = Exclude<
  keyof PrismicSeedCommandOptions,
  "cwd" | (typeof FLAGS)[keyof typeof FLAGS]
>;
const _everyOptionHasAFlag: [Uncovered] extends [never] ? true : Uncovered = true;

const COMMAND = '"prismic-seed <fixture> [site]"';

function commandBlock(source: string): string {
  const at = source.indexOf(COMMAND);
  expect(at, `bin.ts registers no ${COMMAND} command`).toBeGreaterThan(-1);
  const start = source.lastIndexOf("\ncli", at);
  const nextRel = source.slice(at).search(/\ncli[.\n]/);
  return source.slice(start, nextRel === -1 ? undefined : at + nextRel);
}

function registeredFlags(block: string): string[] {
  return [...block.matchAll(/\.option\(\s*"(--[a-z0-9-]+)/g)].map((m) => m[1]!);
}

function runCli(args: string[]): { out: string; code: number } {
  try {
    const out = execFileSync(join(repoRoot, "node_modules/.bin/tsx"), [
      join(repoRoot, "src/cli/bin.ts"),
      ...args,
    ]).toString();
    return { out, code: 0 };
  } catch (e) {
    const err = e as { stdout?: Buffer; stderr?: Buffer; status?: number };
    return {
      out: `${err.stdout?.toString() ?? ""}${err.stderr?.toString() ?? ""}`,
      code: err.status ?? 1,
    };
  }
}

describe("prismic-seed CLI registration — source", () => {
  it("registers the command and loads its module lazily", () => {
    expect(_everyOptionHasAFlag).toBe(true);
    const block = commandBlock(binSource);
    expect(block).toContain('await import("./commands/prismic-seed.js")');
    expect(block).toContain("runPrismicSeedCommand(fixture, site, opts)");
    expect(binSource).not.toMatch(/^import .*commands\/prismic-seed/m);
  });

  it("registers every flag the command honours, and no flag it does not", () => {
    const registered = registeredFlags(commandBlock(binSource));
    for (const flag of Object.keys(FLAGS)) {
      expect(registered, `bin.ts never registers ${flag}`).toContain(flag);
    }
    for (const flag of registered) {
      expect(Object.keys(FLAGS), `bin.ts registers ${flag}, which nothing reads`).toContain(flag);
    }
  });
});

describe("prismic-seed CLI registration — behaviour", () => {
  const emptyDir = () => mkdtempSync(join(tmpdir(), "prismic-seed-registration-"));

  // One spawn, every flag, and the HANDLER reached: the only thing in the CLI
  // that prints "could not import fixture" is runPrismicSeedCommand's step 1.
  it("cac accepts every flag and the handler runs", () => {
    const { out, code } = runCli([
      "prismic-seed",
      "./nope.mjs",
      "--apply",
      "--lang",
      "en-us",
      "--cwd",
      emptyDir(),
    ]);
    expect(out).not.toMatch(/unknown option/i);
    expect(out).not.toMatch(/unknown command/i);
    expect(out).toContain("could not import fixture");
    expect(code).toBe(1);
  });

  it("requires the fixture positional", () => {
    const { out, code } = runCli(["prismic-seed", "--cwd", emptyDir()]);
    expect(code).not.toBe(0);
    expect(out).toMatch(/missing required/i);
    expect(out).not.toContain("could not import fixture");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd "$MAINT" && pnpm exec vitest run tests/cli/prismic-seed-registration.test.ts 2>&1 | grep -E 'registers no|✓|×|passed|failed' | head
```

Expected: `bin.ts registers no "prismic-seed <fixture> [site]" command` and the behaviour test fails with `unknown command 'prismic-seed'` in `out`.

- [ ] **Step 3: Register the command**

In `src/cli/bin.ts`, between the `  );` that closes the `prismic-models` action (line 312) and the blank line before `cli\n  .command("upgrade <upgrade> [site]", …)` (line 314), insert:

```ts
// prismic-seed: dry by default, and the model-sync REFUSAL runs before any
// Migration API call. Both directions of the flag ↔ option link are pinned by
// tests/cli/prismic-seed-registration.test.ts.
cli
  .command(
    "prismic-seed <fixture> [site]",
    "Stage a site's fixture documents (documents(img) module) into a Prismic migration release. Dry by default; --apply writes. Refuses while any model it writes differs from Prismic.",
  )
  .option(
    "--apply",
    "Write: upload assets and POST/PUT the documents (the release stays unpublished)",
  )
  .option(
    "--lang <code>",
    "Locale for every document (default: the fixture's `lang` export, else en-us)",
  )
  .action(
    async (
      fixture: string,
      site: string | undefined,
      opts: { apply?: boolean; lang?: string; cwd?: string; verbose?: boolean },
    ) =>
      runOrExit(
        async () =>
          (await import("./commands/prismic-seed.js")).runPrismicSeedCommand(fixture, site, opts),
        opts,
      ),
  );
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd "$MAINT" && pnpm exec vitest run tests/cli/prismic-seed-registration.test.ts tests/cli/prismic-models-registration.test.ts 2>&1 | tail -n 6
```

Expected: both files pass (`Test Files  2 passed (2)`). If the "requires the fixture positional" test fails only on the `/missing required/i` wording, read cac's actual stderr from the failure output and replace the regex with cac's real phrase — the exit code assertion is the load-bearing one.

- [ ] **Step 5: Commit**

```bash
cd "$MAINT" && pnpm exec prettier --write src/cli/bin.ts tests/cli/prismic-seed-registration.test.ts
git add src/cli/bin.ts tests/cli/prismic-seed-registration.test.ts
git commit -m "feat(cli): register prismic-seed, pinned flag ↔ option ↔ handler

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: `webflow migrate` — `--site`, injectable deps, the refusal

**Files:** Modify: `$MAINT/src/cli/commands/webflow.ts:1-30,107-111` · Modify: `$MAINT/src/cli/bin.ts` (the `webflow` block, currently lines 844-863 before Task 8's insertion; anchor by text) · Test: `$MAINT/tests/webflow/command.test.ts` (imports at :3-8, append after :84)

- [ ] **Step 1: Write the failing tests**

In `tests/webflow/command.test.ts`, replace lines 3-8

```ts
import { mkdtempSync, readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { runWebflowCommand } from "../../src/cli/commands/webflow.js";
```

with

```ts
import { mkdtempSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { runWebflowCommand, type WebflowDeps } from "../../src/cli/commands/webflow.js";
import type { RemoteEntry } from "../../src/prismic/models/index.js";
```

and append after the file's last line (84):

```ts
// The migrate REFUSAL runs before any Migration API call, so it is testable
// offline: a capture dir + a site checkout + an injected remote model set. The
// push itself (runMigration) is still live I/O and still not exercised here.
const PAGE = { id: "page", label: "Page", json: { Main: { uid: { type: "UID" } } } };
const PERSON = {
  id: "person",
  label: "Person",
  json: { Main: { uid: { type: "UID" }, name: { type: "Text" }, media: { type: "Image" } } },
};

async function captureDir(): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), "wf-"));
  await writeFile(
    join(dir, "docs.json"),
    JSON.stringify([
      {
        type: "person",
        uid: "dr-quan",
        lang: "en-us",
        data: { name: "Dr. Quan", media: { __asset: "photo.jpg", alt: "Dr. Quan" } },
      },
    ]),
  );
  await writeFile(
    join(dir, "assets.json"),
    JSON.stringify([{ filename: "photo.jpg", url: "https://cdn/x/photo.jpg" }]),
  );
  return dir;
}

async function siteDir(types: Array<{ id: string }>): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), "wf-site-"));
  await writeFile(
    join(dir, "slicemachine.config.json"),
    JSON.stringify({ repositoryName: "48bb12d1" }),
  );
  for (const t of types) {
    await mkdir(join(dir, "customtypes", t.id), { recursive: true });
    await writeFile(join(dir, "customtypes", t.id, "index.json"), JSON.stringify(t));
  }
  return dir;
}

const webflowDeps = (remote: RemoteEntry[]): WebflowDeps => ({
  remoteModels: vi.fn(async () => remote),
  env: { PRISMIC_TOKEN_48BB12D1: "tok" },
});

it("webflow migrate REFUSES when a touched custom type is stale in Prismic, before any Migration API call", async () => {
  const site = await siteDir([PAGE, PERSON]);
  const remoteStale: RemoteEntry[] = [
    { kind: "customtype", id: "page", model: PAGE },
    {
      kind: "customtype",
      id: "person",
      model: { ...PERSON, json: { Main: { uid: { type: "UID" }, name: { type: "Text" } } } },
    },
  ];
  const res = await runWebflowCommand(
    "migrate",
    await captureDir(),
    { site },
    webflowDeps(remoteStale),
  );
  expect(res.code).toBe(1);
  expect(res.output.startsWith("REFUSED")).toBe(true);
  expect(res.output).toContain("customtype person:");
  expect(res.output).toContain("+ Main.media");
  expect(res.output).toContain(`reddoor-maint prismic-models ${site} --apply`);
});

it("webflow migrate with --site pointing at a non-Prismic dir: code 1, nothing migrated", async () => {
  const site = mkdtempSync(join(tmpdir(), "wf-nosite-"));
  const res = await runWebflowCommand("migrate", await captureDir(), { site }, webflowDeps([]));
  expect(res.code).toBe(1);
  expect(res.output).toContain("not a Prismic site");
  expect(res.output).toContain("nothing was migrated");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd "$MAINT" && pnpm exec vitest run tests/webflow/command.test.ts 2>&1 | tail -n 12
```

Expected: a type/load error on `WebflowDeps` (`does not provide an export named 'WebflowDeps'`) or, at runtime, the two new tests failing because `runWebflowCommand` ignores the 4th argument and throws `Set PRISMIC_REPOSITORY_NAME and PRISMIC_WRITE_TOKEN`.

- [ ] **Step 3: Write the implementation**

`src/cli/commands/webflow.ts` — replace lines 1-30

```ts
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { runMigration } from "../../blux/emit/run-migration.js";
import type { AssetRef } from "../../webflow/crawl.js";
import { collectAssets, crawlSite, liveFetcher } from "../../webflow/crawl.js";
import { webflowToPlan } from "../../webflow/to-plan.js";
import { irToDocs } from "../../webflow/to-docs.js";
import type { WfDoc } from "../../webflow/to-docs.js";
import type { WebflowIR } from "../../webflow/types.js";

export type WebflowCommandOptions = {
  /** Output directory for capture (default: webflow-out) / docs (default: dirname of the ir.json). */
  out?: string;
};

/** `webflow <action> [target]` — capture: live-crawl a Webflow site (baseUrl)
 *  into <out>/ir.json, progress streamed to stderr (a ~80-fetch crawl with a
 *  per-fetch courtesy delay takes about a minute; silence reads as a hang).
 *  docs: convert a saved ir.json into docs.json (Prismic entity docs, Task 6's
 *  irToDocs) + assets.json (the dedupe'd content-image manifest) beside it, or
 *  in --out. migrate: read a capture dir's docs.json + assets.json, build a
 *  MigrationPlan (to-plan), and push it via the shared runMigration runner —
 *  LIVE Prismic I/O, needs PRISMIC_REPOSITORY_NAME + PRISMIC_WRITE_TOKEN (read
 *  by runMigration itself); output ends with the Missing-asset count (the live
 *  acceptance gate is `0 Missing asset`). */
export async function runWebflowCommand(
  action: string,
  target: string | undefined,
  opts: WebflowCommandOptions = {},
): Promise<{ output: string; code: number }> {
```

with

```ts
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { runMigration } from "../../blux/emit/run-migration.js";
import { remoteModels } from "../../prismic/models/index.js";
import { seedPreflight, type SeedPreflightDeps } from "../../prismic/seed/preflight.js";
import type { AssetRef } from "../../webflow/crawl.js";
import { collectAssets, crawlSite, liveFetcher } from "../../webflow/crawl.js";
import { webflowToPlan } from "../../webflow/to-plan.js";
import { irToDocs } from "../../webflow/to-docs.js";
import type { WfDoc } from "../../webflow/to-docs.js";
import type { WebflowIR } from "../../webflow/types.js";

export type WebflowCommandOptions = {
  /** Output directory for capture (default: webflow-out) / docs (default: dirname of the ir.json). */
  out?: string;
  /** migrate: the site checkout whose Prismic config names the repository
   *  (default: cwd). The token is PRISMIC_TOKEN_<REPO> or PRISMIC_WRITE_TOKEN. */
  site?: string;
  cwd?: string;
};

/** Injected IO for the migrate preflight — see src/prismic/seed/preflight.ts. */
export type WebflowDeps = SeedPreflightDeps;

export const defaultWebflowDeps = (): WebflowDeps => ({
  remoteModels: (repo, token) => remoteModels(repo, token),
  env: process.env,
});

/** `webflow <action> [target]` — capture: live-crawl a Webflow site (baseUrl)
 *  into <out>/ir.json, progress streamed to stderr (a ~80-fetch crawl with a
 *  per-fetch courtesy delay takes about a minute; silence reads as a hang).
 *  docs: convert a saved ir.json into docs.json (Prismic entity docs, Task 6's
 *  irToDocs) + assets.json (the dedupe'd content-image manifest) beside it, or
 *  in --out. migrate: read a capture dir's docs.json + assets.json, build a
 *  MigrationPlan (to-plan), run the model-sync preflight against the site in
 *  --site (REFUSES, exit 1, while any model the plan writes differs from
 *  Prismic — the API drops undeclared fields at HTTP 200), then push it via
 *  the shared runMigration runner — LIVE Prismic I/O; repo + token come from
 *  the site's Prismic config, never from PRISMIC_REPOSITORY_NAME. Output ends
 *  with the Missing-asset count (the live acceptance gate is `0 Missing asset`). */
export async function runWebflowCommand(
  action: string,
  target: string | undefined,
  opts: WebflowCommandOptions = {},
  deps: WebflowDeps = defaultWebflowDeps(),
): Promise<{ output: string; code: number }> {
```

and replace lines 107-111 (now shifted by the import/type additions; anchor by text)

```ts
// runMigration reads PRISMIC_REPOSITORY_NAME + PRISMIC_WRITE_TOKEN itself and
// throws a clear "Set …" error before any I/O when they're unset; runOrExit
// surfaces that message. Progress to stderr, mirroring the capture action.
const plan = webflowToPlan({ docs, assets });
const r = await runMigration(plan, (line) => process.stderr.write(`${line}\n`));
```

with

```ts
const plan = webflowToPlan({ docs, assets });
// THE REFUSAL — before any Asset/Migration API call. Repo id + token come
// from the site's own Prismic config (`--site`, default cwd), never from a
// generic env pair; see src/prismic/seed/preflight.ts. Progress to stderr,
// mirroring the capture action.
const cwd = opts.cwd ? resolve(opts.cwd) : process.cwd();
const repoRoot = opts.site ? resolve(cwd, opts.site) : cwd;
const pre = await seedPreflight(plan, repoRoot, opts.site ?? ".", deps);
if (!pre.ok) return { output: pre.output, code: pre.code };
const r = await runMigration(plan, (line) => process.stderr.write(`${line}\n`), pre.creds);
```

`src/cli/bin.ts` — in the `webflow` block, replace the description string

```ts
    "Webflow import pipeline. capture: live-crawl a base url → <out>/ir.json, progress on stderr. docs: convert a saved ir.json → docs.json + assets.json (offline). migrate: push a capture dir's docs.json + assets.json to Prismic via the shared runner (needs PRISMIC_REPOSITORY_NAME + PRISMIC_WRITE_TOKEN).",
```

with

```ts
    "Webflow import pipeline. capture: live-crawl a base url → <out>/ir.json, progress on stderr. docs: convert a saved ir.json → docs.json + assets.json (offline). migrate: push a capture dir's docs.json + assets.json to Prismic via the shared runner; repo + token from --site's Prismic config; refuses while any model it writes differs from Prismic.",
```

and replace

```ts
  .option(
    "--out <dir>",
    "Output directory for capture (default: webflow-out) / docs (default: dirname of the ir.json)",
  )
  .action(
    async (
      action: string,
      target: string | undefined,
      opts: { out?: string; cwd?: string; verbose?: boolean },
    ) =>
```

with

```ts
  .option(
    "--out <dir>",
    "Output directory for capture (default: webflow-out) / docs (default: dirname of the ir.json)",
  )
  .option(
    "--site <path>",
    "migrate: the site checkout whose Prismic config names the repository (default: cwd); token from PRISMIC_TOKEN_<REPO> or PRISMIC_WRITE_TOKEN",
  )
  .action(
    async (
      action: string,
      target: string | undefined,
      opts: { out?: string; site?: string; cwd?: string; verbose?: boolean },
    ) =>
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
cd "$MAINT" && pnpm typecheck && pnpm exec vitest run tests/webflow 2>&1 | tail -n 6
```

Expected: `tests/webflow/command.test.ts` shows 10 passed (8 existing + 2 new); the other webflow files unchanged.

- [ ] **Step 5: Commit**

```bash
cd "$MAINT" && pnpm exec prettier --write src/cli/commands/webflow.ts src/cli/bin.ts tests/webflow/command.test.ts
git add src/cli/commands/webflow.ts src/cli/bin.ts tests/webflow/command.test.ts
git commit -m "feat(webflow): migrate refuses on model drift and reads repo + token from --site

The same preflight prismic-seed runs; PRISMIC_REPOSITORY_NAME is no longer
read on this path.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: Docs, README, changeset

**Files:** Modify: `$MAINT/docs/runbooks/prismic-model-delivery.md` (append after line 213) · Modify: `$MAINT/README.md:64` · Create: `$MAINT/.changeset/prismic-seed.md`

- [ ] **Step 1: Runbook §12**

Append to `docs/runbooks/prismic-model-delivery.md` after its last line (213, the end of §11):

```markdown
---

## 12. Seeding documents — the refusal, and why it is not optional

Model delivery (§1) and content seeding are two writes against two APIs, and the second silently depends on the first. The Migration API validates every document against the models **registered in Prismic** and drops every field the registered model does not declare — HTTP 200, no warning, no `details[]`. Beachfront shipped five such fields (`image_position`, `heading_style`, `hero_wash` on the heroes, `layout` on the carousel, `order_uids` on the collection list): the fixture was right, the local `model.json` was right, the site's fixture-vs-model unit test was green, and the published pages rendered component defaults because the models had not been pushed yet. A unit test cannot catch this — the binding constraint is the remote model, and only the network can read it.

So `reddoor-maint prismic-seed <fixture> [site]` and `reddoor-maint webflow migrate <dir> --site <path>` run the same preflight ([`src/prismic/seed/preflight.ts`](../../src/prismic/seed/preflight.ts)) before touching the Asset or Migration API:

1. `readPrismicConfig(site)` → the repository name. Not a Prismic site → exit 1, "nothing was migrated". A hard-coded repository id, or a token read out of another repo's `.env`, is exactly what this replaces.
2. `resolvePrismicToken` → `PRISMIC_TOKEN_<REPO>` from `~/.config/reddoor-maint/credentials.env` (loaded at CLI start), falling back to `PRISMIC_WRITE_TOKEN` because a seed is a single-site run. The output names the env var, never the value.
3. `localModels` + `remoteModels` + `diffModels`, then `staleModels` over the models the plan **touches** — the custom type of every document and the slice type of every slice. Drift on a model the plan does not write is printed as a `⚠` warning; it is the nightly sweep's business (§6), not a reason to refuse a seed.
4. Any touched model in `toCreate` (`NOT REGISTERED`), in `toUpdate` (the `describeDiff` lines, same wording as the PR comment), or absent locally (`no local model`) → output starting `REFUSED:`, exit 1, nothing uploaded, nothing staged. Fix it the §1 way — merge the model PR so `prismic-models.yml` applies it, or `reddoor-maint prismic-models <site> --apply` — then re-run.

Dry by default: without `--apply` the command imports the fixture, builds the plan, runs the preflight and lists exactly what it would stage. Exit 1 on a refusal because a refusal is a finding (the same rule as `--pull`); 2 stays reserved for contradictory flags.

**The fixture contract.** The command imports a pure ESM module — no `node:*`, no fetch, no token — exporting `documents(img)` that returns `{ type, uid, title, data }` per document, with every Image field written as `img(url, alt)`. The `match-harness` recipe installs an empty `src/lib/site-pages.js` in that shape, and the site's dev `/dev/match/[uid]` route renders the same module with `img → { url }`, so what the gates measured is what gets staged. `title` is the document's editor name (`"Meet Our Team"`, not `our-team`); `{}` for an unfilled Link/Image is stripped before the POST because the API rejects it; a percent-encoded asset filename is decoded so it dedupes against the library's stored name.

**What the runner cannot do, and where that went.** The Migration API's `PUT` replaces a document and never merges, and a staged document cannot be read back — `GET /documents` is refused at the gateway and the migration release is not a ref (`/api/v2` lists only `master` right after a successful POST). So: one writer per document type, every field in one payload, and a re-run re-POSTs and falls back to `PUT` by master id. Patch-style seeding (read master, merge, write) and uid-less singletons (`--doc-id`) are not built; the issue "prismic-seed: entity patch mode (carryOver) and singleton --doc-id" tracks them. Beachfront's `push-slice-models.mjs` / `push-custom-types.mjs` are superseded by `prismic-models`; its `seed-pages.mjs` is superseded by this command now that its fixture exports `documents`.
```

- [ ] **Step 2: README command list**

In `README.md`, after line 64 (`reddoor-maint upgrade svelte-4-to-5 [site]`) and before the closing ``` on line 65, insert:

```text
reddoor-maint prismic-models [site]           # compare the site's Prismic models (dry) / --apply push them
reddoor-maint prismic-seed <fixture> [site]   # stage a fixture module's documents (dry) / --apply; refuses on model drift
```

- [ ] **Step 3: Changeset**

Create `.changeset/prismic-seed.md`:

```markdown
---
"@reddoorla/maintenance": minor
---

`prismic-seed <fixture> [site]` stages a site's pure fixture module (`documents(img)`) into a Prismic migration release through the shared `runMigration`, and both it and `webflow migrate` now **refuse** — exit 1, output starting `REFUSED:` — while any model the plan writes differs from the copy registered in Prismic.

The Migration API drops every undeclared field at HTTP 200 with no warning; five such fields shipped on beachfront-dentistry with every gate green, because the only check that could have seen it needs the network. The refusal reads the site's own `slicemachine.config.json` for the repository and `PRISMIC_TOKEN_<REPO>` (or `PRISMIC_WRITE_TOKEN`) for the token, and prints the env var's name, never its value. Scope is the models the plan touches; untouched drift is a warning.

`webflow migrate` gains `--site <path>` for the same reason and no longer reads `PRISMIC_REPOSITORY_NAME`. `runMigration` accepts an explicit `creds` argument (the env fallback is kept for the blux path), posts each document's `title` and `lang`, strips `{}` fields the API rejects, and decodes percent-encoded asset filenames so they dedupe against the library instead of re-uploading.
```

- [ ] **Step 4: Format the docs, verify they are clean, and check the changeset parses**

Hand-authored markdown is rarely prettier-exact (it re-wraps embedded code and long table/list lines), so write first, then check:

```bash
cd "$MAINT" && pnpm exec prettier --write README.md docs/runbooks/prismic-model-delivery.md .changeset/prismic-seed.md && pnpm exec prettier --check README.md docs/runbooks/prismic-model-delivery.md .changeset/prismic-seed.md && pnpm exec changeset status 2>&1 | tail -n 5
```

Expected: `All matched files use Prettier code style!` and `changeset status` lists `@reddoorla/maintenance` under `minor` (the new file is picked up).

- [ ] **Step 5: Commit**

```bash
cd "$MAINT" && git add README.md docs/runbooks/prismic-model-delivery.md .changeset/prismic-seed.md
git commit -m "docs: runbook §12 — seeding documents, the refusal, and why; README; changeset

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 11: Beachfront — the fixture exports the seed contract

**Files:** Modify: `$BF/src/lib/beachfront-pages.js` (append after line 766) · Test: `$BF/src/lib/beachfront-pages.test.ts` (import at :25; append after :204)

- [ ] **Step 1: Worktree from origin/main**

```bash
cd /Users/tuckerlemos/Documents/GitHub/beachfront-dentistry
git fetch origin
git worktree add ../beachfront-dentistry-seed-fixture -b feat/seed-fixture-documents origin/main
export BF=/Users/tuckerlemos/Documents/GitHub/beachfront-dentistry-seed-fixture
cd "$BF" && pnpm install --frozen-lockfile && git log --oneline -1
```

Expected: the last line is `origin/main`'s head (`f1a4155 docs: adopt the work-journal convention (#43)` or newer).

If `git worktree add` or `pnpm install` is denied by the sandbox (the sibling directory is outside a session's default write allowlist), re-run that command unsandboxed — it writes only inside the two Beachfront checkouts.

- [ ] **Step 2: Write the failing test**

In `src/lib/beachfront-pages.test.ts`, replace line 25

```ts
import { assemblies, META, TITLES } from "./beachfront-pages.js";
```

with

```ts
import { assemblies, documents, META, TITLES } from "./beachfront-pages.js";
```

and append after the last line (204, `});`):

```ts
// The seed contract `reddoor-maint prismic-seed src/lib/beachfront-pages.js`
// imports: one { type, uid, title, data } per page. `data` is byte-identical
// to what scripts/seed-pages.mjs built, so the two cannot drift apart.
describe("documents(img) — the seed contract", () => {
  it("emits one page document per assembly with the seed-pages.mjs payload shape", () => {
    const docs = documents(stubImg) as Array<{
      type: string;
      uid: string;
      title: string;
      data: Record<string, unknown>;
    }>;
    const byUid = assemblies(stubImg) as Record<string, unknown>;
    expect(docs.map((d) => d.uid).sort()).toEqual(Object.keys(byUid).sort());
    for (const d of docs) {
      expect(d.type).toBe("page");
      expect(d.title).toBe(TITLES[d.uid as keyof typeof TITLES]);
      expect(d.data.title).toEqual([{ type: "heading1", text: d.title, spans: [] }]);
      expect(d.data.meta_description).toBe(META[d.uid]?.description);
      expect(d.data.slices).toEqual(byUid[d.uid]);
    }
    expect(docs.find((d) => d.uid === "home")!.data.meta_title).toBe(META.home!.title);
    expect(docs.find((d) => d.uid === "services")!.data).not.toHaveProperty("meta_title");
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
cd "$BF" && pnpm exec vitest run src/lib/beachfront-pages.test.ts 2>&1 | tail -n 8
```

Expected: `SyntaxError: The requested module './beachfront-pages.js' does not provide an export named 'documents'`.

- [ ] **Step 4: Write the implementation**

Append to `src/lib/beachfront-pages.js` after its last line (766):

```js
// =============================================================================
// SEED CONTRACT — what `reddoor-maint prismic-seed src/lib/beachfront-pages.js`
// imports: one { type, uid, title, data } per page document. Lifted verbatim
// from the payload scripts/seed-pages.mjs built (title / meta_title /
// meta_description / slices), so the two produce identical `data`. The seed
// calls `img` with (url, alt?); the assemblies pass only the url.
// =============================================================================
const titles = /** @type {Record<string, string>} */ (TITLES);
/** @param {(u: string, alt?: string) => unknown} img */
export const documents = (img) =>
  Object.entries(assemblies(img)).map(([uid, slices]) => ({
    type: "page",
    uid,
    title: titles[uid] ?? uid,
    data: {
      title: [head(1, titles[uid] ?? uid)],
      ...(META[uid]?.title ? { meta_title: META[uid].title } : {}),
      ...(META[uid]?.description ? { meta_description: META[uid].description } : {}),
      slices,
    },
  }));
```

- [ ] **Step 5: Format, then run the tests to verify they pass, then lint**

Beachfront's `pnpm lint` is `prettier --check . && eslint .` (package.json line 13), and the hand-formatted `documents` export above is unlikely to be prettier-exact, so write first — otherwise the lint fails on formatting, not substance:

```bash
cd "$BF" && pnpm exec prettier --write src/lib/beachfront-pages.js src/lib/beachfront-pages.test.ts
pnpm exec vitest run src/lib/beachfront-pages.test.ts 2>&1 | tail -n 6 && pnpm lint 2>&1 | tail -n 3
```

Expected: the file's test count is one higher than before and all pass; `pnpm lint` ends clean (prettier + eslint). If `svelte-check` is part of the site's CI, also `pnpm check` — the `titles` cast exists precisely so `TITLES[uid]` with a string index typechecks under `checkJs`.

- [ ] **Step 6: The retirement issue, then journal, commit, PR (GREEN)**

Spec C4 retires `push-slice-models.mjs` / `push-custom-types.mjs` in favour of `prismic-models`, and this PR supersedes `seed-pages.mjs`; none of the three is deleted here, and `CLAUDE.md` line 151 still instructs `node scripts/push-slice-models.mjs` while lines 163-165 still name the `reddoor-starter/.env` token path. Anything found and not fixed in the same PR gets an issue — opened FIRST, so the journal entry can cite its number:

```bash
cd "$BF" && gh issue create -R reddoorla/beachfront-dentistry \
  --title "Retire scripts/push-slice-models.mjs, push-custom-types.mjs, seed-pages.mjs and the CLAUDE.md lines naming them — superseded by reddoor-maint prismic-models / prismic-seed" \
  --body "Spec C4 (reddoor-maintenance docs/superpowers/specs/2026-09-08-webflow-rebuild-pipeline-design.md) retires these in favour of prismic-models; the fixture now exports documents(img) (branch feat/seed-fixture-documents, PR opened right after this issue). seed-entity-content.mjs and seed-settings.mjs are NOT superseded (maintenance issue: prismic-seed entity patch mode / --doc-id). CLAUDE.md:151 and :163-165 still name the old scripts and the reddoor-starter/.env token path."
```

Expected: the issue URL is printed; its number goes into the Beachfront journal entry (Task 16) where that entry cites "issue #<n>".

Append the Beachfront entry from Task 16 to `$BF/docs/workJournal.md` (with the issue number in it), then:

```bash
cd "$BF" && pnpm exec prettier --write docs/workJournal.md
git add src/lib/beachfront-pages.js src/lib/beachfront-pages.test.ts docs/workJournal.md
git commit -m "feat: beachfront-pages.js exports the seed contract; seed-pages.mjs is superseded

documents(img) returns the exact payload scripts/seed-pages.mjs built, so
reddoor-maint prismic-seed can stage these pages with the model-sync
refusal in front of it.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git push -u origin feat/seed-fixture-documents
gh pr create -R reddoorla/beachfront-dentistry --head feat/seed-fixture-documents --base main \
  --title "beachfront-pages.js exports the seed contract (documents(img))" \
  --body "$(cat <<'EOF'
`documents(img)` — one `{ type, uid, title, data }` per page, byte-identical `data` to what `scripts/seed-pages.mjs` builds — so `reddoor-maint prismic-seed src/lib/beachfront-pages.js .` can stage these pages behind the model-sync refusal (reddoor-maintenance `feat/prismic-seed`). Pure, no new imports. `seed-pages.mjs`, `push-slice-models.mjs` and `push-custom-types.mjs` are now superseded by `reddoor-maint prismic-seed` / `prismic-models`; retiring them, and the CLAUDE.md lines that still name them, is the issue opened alongside this PR.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: `gh pr create` prints the PR URL. Wait for CI green, confirm the PR's changed-file list is exactly the three files, then squash-merge (`gh pr merge --squash --delete-branch`) — GREEN tier. Record the PR number and merge SHA for the journal. The Task 13 dry run does NOT wait for this merge — it reads the fixture from this worktree.

---

### Task 12: `pnpm verify`, the built CLI, adversarial review (maintenance)

**Files:** none new (this task runs the gate; the branch lands in Task 14, after the Task 13 dry run)

- [ ] **Step 1: The full gate, exactly what CI runs**

```bash
cd "$MAINT" && pnpm verify 2>&1 | tail -n 25
```

Expected, in order: `tsc` silent; `eslint .` and `prettier --check .` clean (the plan and spec copied in Task 0 included); `tsup` builds `dist/cli/bin.js` plus a `prismic-seed-*.js` chunk; `vitest run --coverage` ends `Test Files  N+6 passed` / `Tests  M+43 passed` — 6 new files (run-migration-title, seed/plan, seed/in-sync, seed/creds, prismic-seed-command, prismic-seed-registration) and 43 new tests (7 resolve-doc + 3 run-migration-title + 6 seed/plan + 8 seed/in-sync + 5 seed/creds + 8 prismic-seed-command + 4 prismic-seed-registration + 2 webflow/command), with N and M from Task 0 Step 3 — and every coverage threshold at or above the floor (S 78 / B 67 / F 76 / L 80); `node scripts/smoke-dist.mjs` prints only `✓` lines. The two figures are the gate: a different count means a test was lost or duplicated, not that the expectation is loose.

- [ ] **Step 2: Prove the new command exists in the built CLI**

```bash
cd "$MAINT" && node dist/cli/bin.js --help | grep -E 'prismic-seed|webflow' && node dist/cli/bin.js prismic-seed --help | grep -E -- '--apply|--lang'
```

Expected: the help lists `prismic-seed <fixture> [site]` and the corrected `webflow` description; the sub-help lists both flags.

- [ ] **Step 3: Adversarial review (mandatory for maintenance PRs)**

Run `/code-review high` on the branch (or dispatch a reviewer subagent with the diff `git diff origin/main...HEAD`) with this brief: _"Find any path where a migration can reach the Asset/Migration API without the preflight (both commands), any place the token VALUE can reach stdout/stderr/an error message, any regression for the blux `migrate`/`migrate-catalog`/`migrate-site` callers of `runMigration` (env fallback, `pushCustomTypes` untouched), and any `{}`-stripping that could remove a legitimately-empty field a slice model requires."_ Address every CONFIRMED finding with a commit on the branch; re-run `pnpm verify`.

Do not push or open the PR yet. Task 13 runs the Beachfront dry run against this worktree's build, and Task 14 commits the journal entry — with that output in it — before the PR is opened.

---

### Task 13: Acceptance — the dry run against Beachfront's real repository

**Files:** none (reads only; the command is dry)

- [ ] **Step 1: Precondition — the token exists (name only, never the value)**

```bash
grep -c '^PRISMIC_TOKEN_48BB12D1=' ~/.config/reddoor-maint/credentials.env
```

Expected: `1`. **If `0`: OPERATOR (RED tier)** — mint a Custom Types API write token for Prismic repository `48bb12d1` (runbook §3) and add the line `PRISMIC_TOKEN_48BB12D1=<value>` to `~/.config/reddoor-maint/credentials.env`; the agent verifies with the same `grep -c` → `1`. Until then the dry run is **deferred** and the maintenance journal entry says so in one line ("dry run deferred: PRISMIC_TOKEN_48BB12D1 absent from credentials.env on <date>") — never skipped silently.

- [ ] **Step 2: Run it from the worktree build, against the Beachfront worktree**

The fixture is the Task 11 wrapper as it sits in the Beachfront WORKTREE (`$BF`, branch `feat/seed-fixture-documents`) — the Task 11 PR does not need to be merged, and neither does this branch: `pnpm build` in `$MAINT` builds the worktree's own `dist/`. The Beachfront worktree has the full checkout (`customtypes/`, 31 slice dirs, `slicemachine.config.json` with `repositoryName: "48bb12d1"`):

```bash
cd "$MAINT" && pnpm build >/dev/null && node dist/cli/bin.js prismic-seed \
  /Users/tuckerlemos/Documents/GitHub/beachfront-dentistry-seed-fixture/src/lib/beachfront-pages.js \
  /Users/tuckerlemos/Documents/GitHub/beachfront-dentistry-seed-fixture; echo "exit=$?"
```

Expected — ONE of two positive artefacts, both of which satisfy the spec gate ("a dry run against Beachfront's real repo reports the diff it would refuse on"):

- `REFUSED: <n> model(s) …` followed by `  <kind> <id>:` blocks with `describeDiff` lines and `Push them first: reddoor-maint prismic-models /Users/…/beachfront-dentistry-seed-fixture --apply …`, `exit=1`; or
- `models in sync: <k> checked (customtype page, slice …)` then `DRY RUN — would stage 5 document(s) and 23 asset(s) into Prismic "48bb12d1" (token: PRISMIC_TOKEN_48BB12D1):` with five `  page <uid> "<Title>" (<n> slices, lang en-us)` lines, `exit=0`.

Anything else (a stack trace, `not a Prismic site`, `no write token`, `could not read Prismic models`) is a failure of this plan, not of Beachfront — fix and re-run. One exception to read correctly: a `<sandbox_violations>` block naming `customtypes.prismic.io` (or a denied read of `~/.config/reddoor-maint/credentials.env`) means the sandbox blocked the network or the file, not that the token is bad — re-run the command unsandboxed before treating the output as the artefact.

- [ ] **Step 3: Cross-check the verdict against the model pipeline's own reading**

```bash
cd "$MAINT" && node dist/cli/bin.js prismic-models /Users/tuckerlemos/Documents/GitHub/beachfront-dentistry-seed-fixture | head -n 20
```

Expected: if the seed REFUSED, this report names the same models under "to update"/"to create"; if the seed said "in sync", this report says the touched models `match Prismic` (it may still list drift on models the seed does not touch — those appear in the seed's `⚠` line). The two must agree on every touched model; a disagreement is a defect in `staleModels` — fix it on the branch, re-run Task 12 Step 1, then re-run this task.

- [ ] **Step 4: Keep the output for the journal**

Keep the first eight lines of the Step 2 output and Step 3's verdict (agreed / disagreed on which models). Task 14 Step 1 pastes them under the "Measured" paragraph of the journal entry from Task 16 and checks that the token's NAME appears and its VALUE does not. Nothing is written to any repo in this task.

---

### Task 14: Journal, push, PR, merge (maintenance)

**Files:** Modify: `$MAINT/docs/workJournal.md` (append)

- [ ] **Step 1: Journal — with the dry run's output in it**

Append the maintenance entry from Task 16 to `$MAINT/docs/workJournal.md`. Its "Measured" paragraph is completed NOW from Task 13: directly under the paragraph, an indented block with the first eight lines of Task 13 Step 2's output verbatim, then one sentence saying whether Task 13 Step 3's `prismic-models` report named the same touched models. The entry is never committed with that paragraph unfinished; if Task 13 was deferred (token absent), the deferral line from Task 13 Step 1 stands in for the block.

```bash
cd "$MAINT" && pnpm exec prettier --write docs/workJournal.md
grep -c -E 'REFUSED: [0-9]+ model\(s\)|DRY RUN — would stage' docs/workJournal.md
grep -c "$(sed -n 's/^PRISMIC_TOKEN_48BB12D1=\(......\).*/\1/p' ~/.config/reddoor-maint/credentials.env)" docs/workJournal.md
git add docs/workJournal.md
git commit -m "docs(journal): prismic-seed and the model-sync refusal — why, what it cost, what was measured

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

Expected: the first `grep -c` prints `1` — only the pasted dry-run output contains either the `REFUSED: <n> model(s)` first line or the `DRY RUN — would stage` line (the entry's own prose mentions `REFUSED:` only before a backtick, and the token NAME in prose is no evidence anything was pasted); the second prints `0` — the value's first six characters are absent (this line can only deny a green, never grant one). Skip the second grep if Task 13 was deferred: with no token line the `sed` yields an empty pattern, and `grep -c ""` would count every line; in that case the first grep prints `0` too, and the deferral sentence is the record.

- [ ] **Step 2: Push, PR**

```bash
cd "$MAINT" && git push -u origin feat/prismic-seed
gh pr create -R reddoorla/reddoor-maintenance --head feat/prismic-seed --base main \
  --title "prismic-seed, and the model-sync refusal on every Migration API path" \
  --body "$(cat <<'EOF'
Spec C4 of `docs/superpowers/specs/2026-09-08-webflow-rebuild-pipeline-design.md`; plan `docs/superpowers/plans/2026-09-08-webflow-pipeline-d-seed-sync.md`.

- `prismic-seed <fixture> [site]` (dry by default, `--apply`, `--lang`): imports a site's pure `documents(img)` module, builds a `MigrationPlan`, resolves the repo + `PRISMIC_TOKEN_<REPO>` from the SITE's config, and **refuses** (exit 1, `REFUSED:`) while any model the plan writes differs from Prismic — the silent field-drop class that shipped five missing fields on Beachfront.
- `webflow migrate` runs the same preflight; gains `--site <path>`; no longer reads `PRISMIC_REPOSITORY_NAME`.
- `runMigration`: explicit `creds` (env fallback kept — blux callers and their tests untouched), posts `title`/`lang`, strips `{}`, decodes asset filenames.
- Everything new lives beside `src/prismic/models/`, never inside it (AST guard + export pin untouched).
- Runbook §12, README, changeset (minor).

Gate: `pnpm verify` green; the in-sync test was mutated (field deleted locally instead of remotely) and went red for the direction reason before being kept. Dry run against Beachfront's real repo recorded in the journal entry in this PR.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: `gh pr create` prints the PR URL.

- [ ] **Step 3: Merge (GREEN) and clean up**

When CI is green and the review is clean: confirm the PR's changed-file list matches the file structure table (no stacked commits from another branch), then `gh pr merge <n> -R reddoorla/reddoor-maintenance --squash --delete-branch`. Record the PR number and merge SHA in the journal entry's heading (amend the heading in the same PR before merge, or in the next session's entry — never rewrite the body). Do NOT run `changeset version` or publish — the release/version-packages PR is RED tier (operator).

---

### Task 15: Starter `docs/migration.md` — the standing facts

**Files:** Modify: `$STARTER/docs/migration.md` (:9-11 and :23-33; append after :39) · Modify: `$STARTER/docs/workJournal.md` (append)

- [ ] **Step 1: Worktree**

```bash
cd /Users/tuckerlemos/Documents/GitHub/reddoor-starter
git fetch origin
git worktree add .worktrees/migration-standing-facts -b docs/migration-standing-facts origin/main
export STARTER=/Users/tuckerlemos/Documents/GitHub/reddoor-starter/.worktrees/migration-standing-facts
cd "$STARTER" && pnpm install --frozen-lockfile && git log --oneline -1
```

Expected: `74768a3 docs: a corrected entry needs a pointer from where the reader lands (#116)` or newer.

- [ ] **Step 2: Edit `docs/migration.md`**

Replace lines 9-11

```markdown
- Environment variables:
  - `PRISMIC_REPOSITORY_NAME` — target repository
  - `PRISMIC_WRITE_TOKEN` — permanent write token, do not commit
```

with

```markdown
- A write token. On the fleet path below the repository name is read from this repo's `slicemachine.config.json` and the token from `PRISMIC_TOKEN_<REPOSITORY_NAME>` in `~/.config/reddoor-maint/credentials.env` (`PRISMIC_WRITE_TOKEN` is accepted as the in-repo CI fallback). Never commit a token, never read one out of another repo's `.env`, never hard-code the repository id.
```

Replace lines 23-33

```markdown
## Migrate

Author a Node migration script using `@prismicio/client`'s Migration API (`createMigration` + `writeClient.migrate`) and `@prismicio/migrate`'s `htmlAsRichText` helper. See [scripts/import/migrate.example.ts](../scripts/import/migrate.example.ts) for the shape.

The script:

1. Reads source content (XML / JSON / CSV / etc.)
2. Normalizes each row into a Custom-Type-shaped document
3. Converts HTML bodies into Slice variations (`htmlAsRichText` for prose; custom mappers for typed Slices)
4. Uploads referenced media via `migration.createAsset()` (auto-deduped by source file)
5. Submits via `writeClient.migrate(migration, { reporter })`
```

with (four-backtick outer fence: this block embeds a ```bash fence, and a three-backtick outer fence would close at the inner one — prettier then moves the two paragraphs below it out of the block)

````markdown
## Migrate — the fleet path

Content is authored as a **pure fixture module**, `src/lib/site-pages.js`, exporting `documents(img)` — one `{ type, uid, title, data }` per document, every Image field written as `img(url, alt)` — and staged with reddoor-maintenance's shared runner:

```bash
reddoor-maint prismic-models . --apply                    # 1. the models this repo declares, registered in Prismic
reddoor-maint prismic-seed src/lib/site-pages.js .        # 2. dry: what would be staged, and the model-sync check
reddoor-maint prismic-seed src/lib/site-pages.js . --apply  # 3. stage into an unpublished migration release
```

Step 2 **refuses** (exit 1, `REFUSED:`) while any model the documents write differs from the copy registered in Prismic, naming the model and the field — see fact C below for why that is not optional. The same module is what `/dev/match/[uid]` renders through the real `SliceZone` during matching, so what the gates measured is what gets staged. The runbook is `docs/runbooks/prismic-model-delivery.md` §12 in reddoor-maintenance.

The raw `@prismicio/client` shape (`createMigration` + `writeClient.migrate`, [scripts/import/migrate.example.ts](../scripts/import/migrate.example.ts)) is kept only as a reference for the API's document format. reddoor-maintenance abandoned it after the first live run: it creates documents hollow and PATCHes data in a later pass, swallows validation `details[]`, re-uploads every asset on retry, and cannot update an existing document.
````

Append after the last line (39):

```markdown
## What the Migration API does that no gate can see

Every one of these shipped a defect on a real build (beachfront-dentistry, 2026-08). They are true for every migration path — the fleet runner, the raw client, a hand-rolled script — and none of them produces an error.

- **A. `PUT` replaces, never merges.** `PUT /documents/{id}` overwrites the whole document. A second script that rebuilds its payload from the master document silently drops every field the first one staged, and which fields survive depends on run order. **One writer per document type, every field in one payload.** Add a field to a type by extending that type's existing fixture, never by adding a second writer beside it.
- **B. A staged document cannot be read back.** `GET https://migration.prismic.io/documents` is refused at the gateway (403) with write-token credentials, and the migration release is **not a ref**: measured immediately after a successful `POST` and on two retries, `/api/v2` listed exactly one ref, `master`. Between staging and publishing, a document is invisible to every reader. For a type with a `uid` that is survivable — a re-`POST` collides on the uid and the runner falls back to `PUT` by the master id. A **singleton** has no uid to collide on, so a blind re-run creates a second document and `getSingle` starts returning a coin flip; singleton seeding is not built (tracked in reddoor-maintenance as "prismic-seed: entity patch mode (carryOver) and singleton --doc-id").
- **C. Undeclared fields are dropped silently — HTTP 200, no warning.** The API validates each document against the model **registered in Prismic** and discards every field that model does not declare. Five fields shipped missing this way (`image_position`, `heading_style`, `hero_wash`, `layout`, `order_uids`): the fixture was right, the local `model.json` was right, the fixture-vs-model unit test was green, and the published pages rendered component defaults while every gate stayed green — the gates ran against `/dev/match/*`, which reads the fixture directly and never round-trips through Prismic. **A unit test cannot catch this; the binding constraint is the remote model.** That is what `prismic-seed`'s refusal reads. After any seed, diff a real route against its `/dev/match/*` twin rather than assuming they agree.
- **D. `{}` for an unfilled Link or Image is rejected** (`link_type must be Web…`). An unfilled field must be **omitted**; empty arrays (`[]`) are the valid unfilled StructuredText/Group. The fleet runner strips empty objects before the `POST`; a hand-rolled script must too.
- **E. `\n` is stripped from StructuredText, and heading fields disallow inline bold.** A hard line break cannot live in seeded content — it belongs in the component, or must be modelled as real structure (Prismic's serializer renders `\n` as `<br>` faithfully; it just never receives one). A `strong` span on a heading field whose model disallows it is dropped the same silent way; apply that emphasis at render time.
- **F. The write token reads the Custom Types API but the Migration API is write-only,** and the Slice Machine session in `~/.prismic` 403s on the Types API. One Custom Types API write token (Prismic → Settings → API & Security) serves both `prismic-models` and `prismic-seed`; the login session serves neither.
```

- [ ] **Step 3: Verify**

Positive checks first (each counts a string only the new text contains — today's `docs/migration.md` has zero of either), then the one denial:

```bash
cd "$STARTER" && pnpm exec prettier --write docs/migration.md && pnpm exec prettier --check docs/migration.md && grep -c '^- \*\*[A-F]\.' docs/migration.md && grep -c 'PRISMIC_TOKEN_<REPOSITORY_NAME>' docs/migration.md && grep -c 'reddoor-maint prismic-seed src/lib/site-pages.js' docs/migration.md
! grep -q PRISMIC_REPOSITORY_NAME docs/migration.md && echo GENERIC-PAIR-GONE
```

Expected: `All matched files use Prettier code style!`, `6` (facts A–F), `1` (the prerequisites line names the per-repo token variable), `2` (the two `prismic-seed` lines of the fleet-path block), and `GENERIC-PAIR-GONE` on its own line. The last line can only deny a green — the three counts are the evidence the edit landed.

- [ ] **Step 4: Journal, commit, PR (GREEN)**

Append the starter entry from Task 16 to `$STARTER/docs/workJournal.md`, then:

```bash
cd "$STARTER" && pnpm exec prettier --write docs/migration.md docs/workJournal.md
git add docs/migration.md docs/workJournal.md
git commit -m "docs(migration): the fleet seed path, and six Migration API facts no gate can see

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
git push -u origin docs/migration-standing-facts
gh pr create -R reddoorla/reddoor-starter --head docs/migration-standing-facts --base main \
  --title "docs/migration.md: the fleet seed path and the Migration API's standing facts" \
  --body "$(cat <<'EOF'
Spec C4 (`reddoor-maintenance/docs/superpowers/specs/2026-09-08-webflow-rebuild-pipeline-design.md`): the three Migration API facts that shipped defects — PUT replaces, a release cannot be read back, silent field drop — plus the three that cost a round each ({} rejected, \n stripped / no bold in headings, write-only token), documented where every site starts. The Migrate section now points at `reddoor-maint prismic-models` → `prismic-seed` and keeps the raw-client example only as an API-shape reference, with the reasons maintenance abandoned it.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Expected: PR URL printed; `pnpm verify` is not required for a docs-only change but CI runs prettier on it — wait for green, then squash-merge with `--delete-branch` (GREEN).

---

### Task 16: Journal entries (the last act in each repo)

Prose, why over what, newest at the bottom; the heading carries the date, a short title, and where it landed. Fill in PR numbers and SHAs once known; if a heading is written before the merge, put the branch name in the parentheses and let the next session's entry carry the SHA.

**reddoor-maintenance — `docs/workJournal.md`** (appended in Task 14 Step 1, after the Task 13 dry run; the "Measured" paragraph is completed from Task 13's output before the PR is opened — the entry below ends that paragraph where the pasted block begins):

```markdown
## 2026-09-08 — The seed refuses before it writes: prismic-seed, and the model-sync guard on every Migration API path (`feat/prismic-seed`)

Spec C4 of the Webflow rebuild pipeline design. The mechanism this ports is
Beachfront's `assertModelsInSync`, and the reason it exists is worth restating
because nothing about the failure is visible: the Migration API validates each
document against the model **registered in Prismic** and drops every field that
model does not declare at HTTP 200 with no warning. Beachfront shipped five such
fields with every gate green — the fixture was right, the local `model.json` was
right, the fixture-vs-model unit test passed, and the published pages rendered
component defaults, because the gates only ever ran against `/dev/match/*`,
which reads the fixture directly. A unit test cannot see the remote model. So
the check needs the network, and it needs to run before the first byte reaches
the Asset or Migration API.

**Where it lives, and why not in `src/prismic/models/`.** That directory is
covered by an AST capability guard and an export pin; the seed reaches for the
Migration API's plan shape and would have been a new channel inside the guarded
tree. Everything new sits beside it in `src/prismic/seed/` — `plan.ts`
(fixture → `MigrationPlan`), `in-sync.ts` (touched → stale over
`diffModels`/`describeDiff`, the `REFUSED:` text), `creds.ts` (repo id + token
from the SITE's own config), and `preflight.ts`, the one IO composition both
`prismic-seed` and `webflow migrate` call. `webflow migrate` no longer reads
`PRISMIC_REPOSITORY_NAME`; it takes `--site <path>` and reads
`slicemachine.config.json` like everything else in the model pipeline.

**Scope of the refusal.** Only the models the plan touches — the custom type of
every document and the slice type of every slice. Drift on a model the seed does
not write is printed as a warning and left to the nightly sweep. Beachfront's
version checked slices only; it seeded `meta_title`/`meta_description` onto the
`page` type and never checked the type. This one checks both. A touched model
that exists in Prismic but not on disk refuses too ("no local model") — the
site's fixture test could not have verified it.

**What `runMigration` had to gain**, each a defect the Beachfront seed had
already worked around in its own copy of the runner: a per-document `title`
(the runner posted the uid, so every page would have been named `our-team` in
the editor); `stripEmpty` after resolution (the fixture carries `item_link: {}`
and the API rejects it); a decoded asset filename (the library stores
`Leigh Lowery google.png`, the CDN url carries `%20`, and the raw tail re-uploads
it on every run); and an explicit `creds` argument so the seed passes
`PRISMIC_TOKEN_<REPO>` without mutating `process.env`. The env fallback stays
for the three blux callers and their tests. `lang` came along because `--lang`
would otherwise have been a flag that parses and changes nothing — the exact
class the registration tests exist to catch.

**Measured.** The in-sync test was mutated on purpose — the field deleted from
the local side instead of the remote — and went red with the other direction's
wording (`- review.primary.layout (only in Prismic — pushing DELETES it)`), so
it measures direction, not merely difference. The dry run against Beachfront's
real repository (`48bb12d1`, token `PRISMIC_TOKEN_48BB12D1` from
credentials.env, value never printed) from the worktree build, against the
Beachfront worktree's fixture, printed the following — first eight lines
verbatim — and `prismic-models` was then run on the same checkout to see
whether it named the same touched models:

**Not built, and where that went.** Patch-style entity seeding
(`seed-entity-content.mjs`'s read-master-then-merge) and uid-less singletons
(`seed-settings.mjs --doc-id`) — issue "prismic-seed: entity patch mode
(carryOver) and singleton --doc-id". The runner keys its update lookup on
`type::uid`, so neither fits without a read path it does not have. Beachfront's
`push-slice-models.mjs`, `push-custom-types.mjs` and `seed-pages.mjs` are
superseded; their retirement is tracked in that repo (the issue Task 11 Step 6
opened), not left to a note in a PR body.
```

Task 14 Step 1 inserts, directly after the "Measured" paragraph's colon: a blank line, the eight output lines indented four spaces, a blank line, and one sentence — "`prismic-models` named the same touched models" or the exact disagreement (which is a defect in `staleModels` and stops the PR until fixed). If Task 13 was deferred, the paragraph instead ends with the deferral line from Task 13 Step 1.

**beachfront-dentistry — `docs/workJournal.md`** (appended in Task 11 Step 6, after the retirement issue is opened so its number can be cited):

```markdown
## 2026-09-08 — beachfront-pages.js exports the seed contract; seed-pages.mjs is superseded (`feat/seed-fixture-documents`)

Twelve pure lines: `documents(img)` returns one `{ type, uid, title, data }`
per page, with `data` assembled exactly as `scripts/seed-pages.mjs` assembles it
(`title` heading, `meta_title` only where `META` overrides, `meta_description`,
`slices`). The point is not the wrapper; it is what now sits in front of it.
`reddoor-maint prismic-seed src/lib/beachfront-pages.js .` runs reddoor-
maintenance's model-sync refusal — the port of this repo's own
`assertModelsInSync`, extended to the `page` custom type this repo's version
never checked — before any byte reaches the Migration API, and it reads the
repository name from `slicemachine.config.json` and the token from
`PRISMIC_TOKEN_48BB12D1` in the operator's credentials file, instead of the
hard-coded `REPO = "48bb12d1"` and the `BEACHFRONT_DENTISTRY_WRITE_TOKEN` line
this repo has been reading out of `reddoor-starter/.env` (CLAUDE.md line 163).

`scripts/seed-pages.mjs`, `push-slice-models.mjs` and `push-custom-types.mjs`
are superseded (by `prismic-seed` and `prismic-models`) and left in place;
retiring them, and the CLAUDE.md lines that still name them (line 151, lines
163-165), is issue #<the number `gh issue create` printed in Task 11 Step 6> —
the spec calls them retired, and a sentence in a PR body is not a tracker.
`seed-entity-content.mjs` and `seed-settings.mjs` are NOT superseded — the
runner has no patch mode and no singleton path yet (maintenance issue
"prismic-seed: entity patch mode (carryOver) and singleton --doc-id").
```

**reddoor-starter — `docs/workJournal.md`** (appended in Task 15 Step 4):

```markdown
## 2026-09-08 — docs/migration.md records what the Migration API does that no gate can see (`docs/migration-standing-facts`)

Until today this document described one path — the raw `@prismicio/client`
`writeClient.migrate` example — and none of the three facts that shipped defects
on the first site built from this template: `PUT` replaces and never merges; a
staged document cannot be read back (the migration release is not even a ref —
`/api/v2` lists only `master` right after a successful `POST`); and undeclared
fields are dropped at HTTP 200 with no warning. Beachfront learned each of them
on a live repository and wrote them into its own `docs/migration.md`, where the
next site would never look. They are true for every migration path, so they
belong here, with the three that cost a round each (`{}` rejected for an
unfilled Link/Image, `\n` stripped from StructuredText and no bold in headings,
the token that reads the Types API but only writes the Migration API).

The Migrate section now describes the fleet path — `reddoor-maint
prismic-models . --apply`, then `prismic-seed src/lib/site-pages.js .`, which
refuses while any model the documents write differs from Prismic — and keeps
the raw-client example only as an API-shape reference, with the four reasons
reddoor-maintenance abandoned it after its first live run. The generic
`PRISMIC_REPOSITORY_NAME`/`PRISMIC_WRITE_TOKEN` pair is gone from the
prerequisites: the fleet path reads the repository from
`slicemachine.config.json` and the token from `PRISMIC_TOKEN_<REPO>`, and the
one thing every site should stop doing is reading a token out of another repo's
`.env` under a site-named variable. Spec: reddoor-maintenance
`docs/superpowers/specs/2026-09-08-webflow-rebuild-pipeline-design.md` §C4.
```

---

## Verification

The spec's C4 gate, as commands and the artefacts each must produce:

| Gate                                                                            | Command                                                                                                                                                | Positive artefact                                                                                                                                                                                                |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A unit test proves `seed` refuses on a fixture whose model differs              | `cd $MAINT && pnpm exec vitest run tests/cli/prismic-seed-command.test.ts -t "REFUSES"`                                                                | `✓ … REFUSES when a touched model is stale in Prismic, naming model and field, and never calls the runner — even with --apply`; the assertion checks `+ default.primary.hero_wash` and `runMigration` not called |
| The refusal names the missing field, in the right direction                     | Task 4 Step 5 mutation                                                                                                                                 | red with `- review.primary.layout (only in Prismic — pushing DELETES it)` when the deletion is flipped; green when restored                                                                                      |
| `webflow migrate` refuses too                                                   | `pnpm exec vitest run tests/webflow/command.test.ts -t "REFUSES"`                                                                                      | `✓ webflow migrate REFUSES when a touched custom type is stale …` with `+ Main.media`                                                                                                                            |
| A remote read failure is a failure, never an empty model set (preflight header) | `pnpm exec vitest run tests/cli/prismic-seed-command.test.ts -t "cannot be read"`                                                                      | `✓ … fails, not refuses, when Prismic's models cannot be read — runner never called, token value never printed`                                                                                                  |
| Every flag typed reaches the handler; no flag is a silent no-op                 | `pnpm exec vitest run tests/cli/prismic-seed-registration.test.ts`                                                                                     | 4 passed, including `could not import fixture` from a real tsx spawn                                                                                                                                             |
| blux/webflow callers of `runMigration` unchanged                                | `pnpm exec vitest run tests/blux tests/cli/blux-command.test.ts tests/cli/blux-catalog-command.test.ts tests/cli/blux-migrate-catalog-command.test.ts` | all passed, no edits to those files                                                                                                                                                                              |
| CI's exact gate                                                                 | `cd $MAINT && pnpm verify`                                                                                                                             | typecheck silent, lint clean, build, coverage ≥ floor, smoke-dist all `✓`                                                                                                                                        |
| A dry run against Beachfront's real repo reports the diff it would refuse on    | Task 13 Step 2                                                                                                                                         | `REFUSED: …` with `describeDiff` lines, exit 1 — or `models in sync: … DRY RUN — would stage 5 document(s) and 23 asset(s) into Prismic "48bb12d1"`, exit 0; and `prismic-models` agrees on every touched model  |
| Standing facts documented where every site starts                               | `cd $STARTER && grep -c '^- \*\*[A-F]\.' docs/migration.md`                                                                                            | `6`                                                                                                                                                                                                              |
| Records                                                                         | `git log --oneline -1 -- docs/workJournal.md` in each of `$MAINT`, `$BF`, `$STARTER`                                                                   | a 2026-09-08 commit in each                                                                                                                                                                                      |
