// The pull-down path: a model that exists ONLY in Prismic, brought into the repo
// as a file. It is the safe answer to a `remoteOnly` model — the alternative
// being deletion, which this design forbids outright — and it is the only module
// here that writes into a LIVE CLIENT REPO. Human-invoked; never runs in CI.
//
// Which makes the failure to avoid the mirror image of the one the rest of this
// module guards against. Everywhere else the question is "did I really read
// nothing?"; here it is "is this path really free?" — and the two errors have
// the same shape, because a write onto an occupied path destroys a file exactly
// as silently as a failed read drops a model. Both answers must be PROVEN, never
// assumed, and the proof is what `occupantId` below is.
import { mkdir, readFile, realpath, rename, writeFile } from "node:fs/promises";
import { dirname, join, posix, relative, sep } from "node:path";
import type { SpawnFn } from "../../audits/util/spawn.js";
import { formatWithPrettier } from "../../recipes/_prettier.js";
import type { RemoteEntry } from "./types.js";

/**
 * The characters a model id may contain, as an ALLOW-LIST.
 *
 * The id is the one value in this module that is not ours: it arrives from
 * Prismic and it is spliced straight into a filesystem path under a client
 * repo's root. A deny-list of the shapes that scare us ("..", "/") is the guard
 * that has failed three times in this project, defeated each time by a shape
 * nobody listed — so this enumerates what is permitted and refuses everything
 * else.
 *
 * Measured 2026-08-13 from every in-scope repo's `origin/main` via `git ls-tree`
 * (never a working tree — eight of the fifteen checkouts sit on feature branches
 * that move): all 200 model ids in the fleet — 68 custom types, 132 slices — use
 * only `[a-z_]`, with a single camelCase outlier (`contractorTestimonials`).
 * `-` and digits are permitted because Prismic accepts them and neither can
 * change what a path means; nothing else is.
 *
 * If Prismic ever accepts an id outside this set, this THROWS and the operator
 * creates the file by hand. That is a stop, not a silent misplacement, and a
 * stop is the correct outcome for "I do not know where this belongs".
 */
const ID_ALLOWED = /^[A-Za-z0-9_-]+$/;

/**
 * A path segment we are willing to create inside a client repo, again as an
 * allow-list: it must START with a letter, a digit or an underscore.
 *
 * That one anchor is doing three separate jobs. It rejects `""`, `.` and `..`
 * (so the returned path cannot climb out of the repo or address itself); it
 * rejects a leading `-`, which the target repo's prettier would read as a FLAG
 * rather than a filename; and it rejects a leading `.`, so a pull-down cannot
 * quietly populate a dot-directory nobody looks at in review.
 */
const SEGMENT_ALLOWED = /^[A-Za-z0-9_][A-Za-z0-9._-]*$/;

/** `video_block` -> `VideoBlock`. Slice Machine's on-disk directory convention.
 *  A model that exists only in Prismic has no local directory to reuse, so the
 *  name has to be derived — and this is LOSSY (it drops every separator), which
 *  is why {@link ID_ALLOWED} is applied to the raw id BEFORE this runs. Checking
 *  only the output would wave `../../x` through as the innocuous `X`. */
const pascal = (id: string): string =>
  id
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join("");

/**
 * Repo-relative path a pulled-down model should live at.
 *
 * Custom types are keyed by id on disk — all 68 in the fleet sit in a directory
 * named exactly `model.id` — so that half is a fact. The slice half is a GUESS:
 * the directory name and the model id are independent, and 6 of the fleet's 132
 * slice directories differ from `pascal(id)` today (caltex-landing and hedloc
 * hold `content_width_media` in `ContentWidth/`; gallerysonder holds
 * `video_block` in `ContentWidthMedia/`). The guess is unavoidable — a
 * remote-only model has no local directory — but it must never be allowed to
 * land on another model's file, which is `writeModelFile`'s job, not this one's.
 *
 * The returned string has TWO readers with different rules: `join(repoRoot, …)`
 * resolves it against the repo, and the target repo's prettier resolves it
 * against its own cwd as an argv. They agree only for a plain relative path —
 * an absolute or climbing path makes the write and the format touch DIFFERENT
 * files, with both reporting success. Hence the per-segment check at the end.
 *
 * That check is a STRING-SHAPE check and nothing more. It proves the path spells
 * a plain relative location; it cannot prove where that location resolves to,
 * because a symlinked component (`customtypes`, or the slice library) redirects
 * the whole subtree without changing a single character of this string. The
 * containment guarantee for the write itself is {@link assertResolvesInsideRepo}
 * in `writeModelFile`, which resolves it.
 */
export function modelFilePath(entry: Pick<RemoteEntry, "kind" | "id">, library: string): string {
  if (!ID_ALLOWED.test(entry.id)) {
    throw new Error(
      `refusing to derive a file path for ${entry.kind} id ${JSON.stringify(entry.id)}: ` +
        `a model id may contain only letters, digits, "_" and "-". ` +
        `Create the file by hand rather than letting this guess where it goes.`,
    );
  }

  let rel: string;
  if (entry.kind === "customtype") {
    rel = posix.join("customtypes", entry.id, "index.json");
  } else {
    const lib = library.replace(/^\.\//, "").split(sep).join(posix.sep).trim();
    if (lib === "") {
      throw new Error(
        `refusing to place slice "${entry.id}": no slice library was given. ` +
          `An empty library is not the fleet default — config.ts treats "libraries: []" as ` +
          `"this site has no slice library" — so there is nowhere to put this model.`,
      );
    }
    const dir = pascal(entry.id);
    if (dir === "") {
      throw new Error(
        `refusing to place slice ${JSON.stringify(entry.id)}: it has no letters or digits, ` +
          `so it yields no directory name.`,
      );
    }
    rel = posix.join(lib, dir, "model.json");
  }

  const bad = rel.split(posix.sep).filter((s) => !SEGMENT_ALLOWED.test(s));
  if (bad.length > 0) {
    throw new Error(
      `refusing to write ${entry.kind} "${entry.id}" to ${JSON.stringify(rel)}: ` +
        `the path segment(s) ${JSON.stringify(bad)} are not a plain relative location inside ` +
        `the repo. Check the "libraries" entry in this site's Prismic config.`,
    );
  }
  return rel;
}

export type WriteResult = { path: string; formatted: boolean };

/**
 * The model id declared by whatever already occupies `full`, or `null` when that
 * path is PROVEN free.
 *
 * The polarity is the same one local.ts states and for the same reason, pointed
 * the other way: only a clean ENOENT proves a path is free. EACCES, ENOTDIR
 * (a file where a directory should be), EISDIR, ELOOP and I/O errors all mean
 * something is there, or that we cannot tell — and "cannot tell" must not be
 * spelled the same way as "nothing there" when the next statement overwrites it.
 *
 * A file that is there but does not parse, or parses without a string `id`,
 * throws rather than being treated as free: an unidentifiable file is precisely
 * the one we must not clobber. There is no reading of "I could not understand
 * this file" that justifies replacing it.
 */
async function occupantId(rel: string, full: string): Promise<string | null> {
  let raw: string;
  try {
    raw = await readFile(full, "utf-8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new Error(
      `${rel}: cannot be read, so this pipeline cannot tell whether a model is already ` +
        `there (${(e as Error).message}). Refusing to write over what it cannot see.`,
      { cause: e },
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(
      `${rel}: already exists and is not valid JSON (${(e as Error).message}). ` +
        `Refusing to overwrite a file this pipeline cannot identify.`,
      { cause: e },
    );
  }
  const id = (parsed as { id?: unknown } | null)?.id;
  if (typeof id !== "string" || id === "") {
    throw new Error(
      `${rel}: already exists but declares no string "id", so there is no way to tell ` +
        `whether it is the model being pulled down. Refusing to overwrite it.`,
    );
  }
  return id;
}

/**
 * `realpath` of the deepest ancestor of `p` that exists.
 *
 * Only ENOENT walks up — the same polarity `occupantId` uses, for the same
 * reason. EACCES, ELOOP (a symlink cycle) and ENOTDIR are "I cannot tell where
 * this resolves", and the answer to that must never be spelled the same way as
 * "it resolves here".
 */
async function realpathOfNearestExisting(p: string): Promise<string> {
  let cur = p;
  for (;;) {
    try {
      return await realpath(cur);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
        throw new Error(`${cur}: cannot be resolved (${(e as Error).message})`, { cause: e });
      }
      const parent = dirname(cur);
      /* c8 ignore next 2 -- unreachable: repoRoot is an ancestor and realpaths. */
      if (parent === cur) throw new Error(`${p}: no ancestor of this path exists`, { cause: e });
      cur = parent;
    }
  }
}

/**
 * Refuse unless `dir` really resolves inside `repoRoot`.
 *
 * `modelFilePath`'s per-segment check proves the path is spelled as a plain
 * relative location. It cannot prove where it LANDS: make `customtypes` — or a
 * site's slice library — a symlink to a sibling directory and every segment
 * still reads as innocuous, `readFile` answers ENOENT at the leaf so the path
 * reads as PROVEN free, `mkdir -p` follows the link, and the exclusive create
 * succeeds. The model lands in the sibling, which in this fleet is another LIVE
 * CLIENT REPO, and the returned repo-relative path is a lie.
 *
 * This is deliberately ASYMMETRIC with local.ts, which reads models through
 * symlinks by design and must keep doing so. Reading through a symlink returns
 * a file the operator put there; writing through one puts a file somewhere the
 * operator never named. The two directions do not deserve the same rule, and
 * this rule is only ever applied to the write path.
 *
 * Nothing under `customtypes/` or a slice library is a symlink in any of the 15
 * in-scope repos (measured 2026-08-13 from each repo's `origin/main` via
 * `git ls-tree`: zero entries of mode 120000), so this is a latent hole rather
 * than a live one — which is exactly when it is cheap to close.
 */
async function assertResolvesInsideRepo(repoRoot: string, rel: string, dir: string): Promise<void> {
  const realRoot = await realpathOfNearestExisting(repoRoot);
  const real = await realpathOfNearestExisting(dir);
  if (real !== realRoot && !real.startsWith(realRoot + sep)) {
    throw new Error(
      `refusing to write ${rel}: it resolves to ${real}, which is outside this repo ` +
        `(${realRoot}). A symlinked path component redirects the write while every segment ` +
        `of the repo-relative path still looks ordinary — and every sibling of a repo in ` +
        `this fleet is another live client repo.`,
    );
  }
}

/**
 * Absolute path to the TARGET repo's OWN prettier, or `null` when it has none.
 *
 * This exists because the alternative — spawn and let resolution sort it out —
 * cannot tell the two answers apart, and the whole justification for formatting
 * through the target's binary instead of `--stdin-filepath` is that it is the
 * TARGET's. Measured 2026-08-13, `pnpm exec prettier` in a fixture repo with no
 * `node_modules`:
 *
 *  - it first runs a dependency check and executes a full `pnpm install` in the
 *    target — an unrequested mutation of a live client repo, and the thing that
 *    would hang a pull-down on a slow or unreachable registry;
 *  - in a repo that does not depend on prettier, it then falls through to the
 *    CALLING repo's `node_modules/.bin` (which `pnpm reddoor-maint …` puts on
 *    PATH), formats the client's file with a binary the client does not have,
 *    and exits 0 — so `formatted: true` reports a format the target never did.
 *
 * `node_modules/.bin/prettier` under the repo root is the right probe rather
 * than a resolve-from-`repoRoot`: Node's algorithm walks UP, which would find
 * the maintenance repo's own prettier for any clone checked out beneath it —
 * the precise confusion this is here to end. All 15 in-scope repos declare
 * prettier as a root devDependency and pnpm materialises the shim there
 * (measured 2026-08-13).
 *
 * Every failure collapses to `null`, including EACCES: unlike a read on the
 * model path, "I cannot tell" here costs only `formatted: false`, which is the
 * conservative flag and the documented degraded path.
 */
async function targetPrettierBin(repoRoot: string): Promise<string | null> {
  try {
    // realpath doubles as the existence probe, so this module does not need a
    // `stat` capability on top of the one it already has — and it resolves the
    // shim, so a DANGLING `.bin/prettier` reads as absent rather than present.
    return await realpath(join(repoRoot, "node_modules", ".bin", "prettier"));
  } catch {
    return null;
  }
}

/**
 * How long the target's prettier gets before the pull-down gives up on it.
 *
 * A stalled format wedges a human-invoked CLI with nothing printed and no
 * `formatted: false` — the one outcome worse than not formatting. 60s is this
 * repo's established budget for a CLI spawn that may touch the network
 * (`gh.ts` ×7, `deps-outdated`); it is deliberately far above remote.ts's 15s
 * HTTP budget, because this is process startup rather than one request, and far
 * below the 5-minute install budgets, because it formats ONE small JSON file.
 *
 * A timeout also makes {@link SpawnFn}'s default implementation detach the
 * child (spawn.ts only sets `detached` when `timeoutMs` is present), so the
 * kill reaches prettier and not just a wrapper.
 */
const PRETTIER_TIMEOUT_MS = 60_000;

/** Serial number for temp files, so a retry inside one process cannot collide
 *  with a temp its own earlier attempt left behind. */
let tmpSeq = 0;

/**
 * Write one model into a repo and format it with THAT repo's own prettier.
 *
 * The formatting step is not cosmetic. The first pull-down PR of the 2026-08-12
 * reconciliation failed CI on `prettier --check` for
 * `customtypes/frozen_page/index.json` while `catalog_page/index.json` —
 * generated by the identical code path in the same run — passed. Prettier's
 * output for JSON is CONTENT-dependent, so there is no canonical
 * `JSON.stringify` shape that is safe fleet-wide; only the target repo's own
 * prettier knows the answer, and a pull-down PR that imposes OUR house style
 * instead buries the real change in a diff full of reformatting noise.
 *
 * Which is why the target's prettier is resolved POSITIVELY, by
 * {@link targetPrettierBin}, and run by absolute path. Spawning `pnpm exec
 * prettier` and reading the exit code cannot distinguish "the target's prettier
 * formatted this" from "the target has none and the calling repo's prettier
 * guessed" — both are 0 — and the second answer is the one this whole deviation
 * from `--stdin-filepath` exists to avoid.
 *
 * Formatting is best-effort by contract (`formatWithPrettier` never throws), so
 * the file is always written; `formatted: false` tells the caller to flag the PR
 * for a manual format check rather than losing the model. It is one bit and it
 * deliberately merges three causes — the target has no prettier, its prettier
 * exited non-zero, or it timed out — because the operator's next action is
 * identical for all three and the CLI prints the same `PRETTIER_FLAG_NOTE`. The
 * consequence is bounded and visible downstream: an unformatted file reds the
 * target repo's own `prettier --check` in CI, which is how the trap above was
 * found in the first place.
 *
 * One residual is worth naming rather than papering over: prettier's own
 * `--write` is not atomic, so a format killed by the timeout can in principle
 * leave the model half-rewritten. The window is prettier's, not ours, and it
 * opens only after the complete model is already on disk — the stall this
 * guards against (process startup) is before prettier writes anything.
 *
 * NOTHING else here is best-effort. Every way this can fail to write the RIGHT
 * file at the RIGHT path throws, because a pull-down that silently writes the
 * wrong file is indistinguishable from one that worked.
 */
export async function writeModelFile(
  spawn: SpawnFn,
  repoRoot: string,
  entry: RemoteEntry,
  library: string,
): Promise<WriteResult> {
  // `entry.id` picks the PATH; `entry.model.id` is what every later reader keys
  // on (local.ts reads the body, never the directory name). remote.ts derives
  // both from the same parsed model so they cannot disagree — and `sendModel`
  // re-checks it anyway at the other end of the pipeline, because the parameter
  // is structural and any caller can hand over a pair that no constructor built.
  // The same argument holds here, with a worse consequence: a mismatch files the
  // model under a name nothing reads, so the next run sees it as remote-only
  // again and pulls a SECOND copy — a loop that never converges, in silence.
  const bodyId = (entry.model as { id?: unknown }).id;
  if (typeof bodyId !== "string" || bodyId === "" || bodyId !== entry.id) {
    throw new Error(
      `refusing to write ${entry.kind} "${entry.id}": the model body's id is ` +
        `${JSON.stringify(bodyId)}. The path is derived from one and every reader of the ` +
        `file keys on the other, so this model would never be found again.`,
    );
  }

  const rel = modelFilePath(entry, library);
  const full = join(repoRoot, rel);
  const dir = dirname(full);

  // FIRST, before anything reads or creates: prove this path resolves inside the
  // repo. Ordering it here means a symlinked component is reported as what it is
  // rather than as whatever the sibling repo happens to hold — and it means the
  // pull-down never so much as reads a file outside the repo it was pointed at.
  await assertResolvesInsideRepo(repoRoot, rel, dir);

  // Proven free, or occupied by this exact model. Anything else — another
  // model's file, a file we cannot parse, a path we cannot read — throws above.
  const occupant = await occupantId(rel, full);
  if (occupant !== null && occupant !== entry.id) {
    throw new Error(
      `refusing to pull ${entry.kind} "${entry.id}" into ${rel}: that file already holds ` +
        `"${occupant}". A slice's directory name and its model id are independent — 6 of the ` +
        `fleet's 132 slice directories differ (measured 2026-08-13) — so the directory this ` +
        `derives can belong to a different model. Move or rename the existing model, or ` +
        `create this one by hand.`,
    );
  }

  // If the write below fails, this directory stays behind empty — and so, on the
  // refresh path, may a partial temp file. Both are deliberate and neither is
  // worth "fixing": undoing them needs a delete verb, and this module imports
  // none. The pull-down is the safe answer to a model CI may never delete, so it
  // does not get the ability to remove things in order to tidy up after itself.
  // Leftovers are visible in `git status`, are named in the error that produced
  // them, and are read by nothing; a delete verb in this file is none of those.
  try {
    await mkdir(dir, { recursive: true });
  } catch (e) {
    throw new Error(
      `${posix.dirname(rel)}: cannot create the directory for this model ` +
        `(${(e as Error).message})`,
      { cause: e },
    );
  }

  // Again, now that the directory exists. The check above resolved the deepest
  // ancestor that existed AT THE TIME — `mkdir -p` follows symlinks, so that
  // check is what stops a link from putting a directory inside a sibling repo;
  // this one resolves the leaf that will actually be written into. `mkdir` only
  // ever creates real directories, so the two agree unless something changed
  // underneath us, and this is the answer that counts because it is the last one
  // before the write.
  await assertResolvesInsideRepo(repoRoot, rel, dir);

  // Two spaces + a trailing newline is a BASELINE, not an opinion: prettier
  // below is the authority, and this only decides what a file looks like when
  // prettier could not run. Measured 2026-08-13 from each of the 15 in-scope
  // repos' `origin/main` via `git ls-tree`: 180 of the 200 committed model
  // files are 2-space indented and only 20 are tab-indented (erp-industrial and
  // gallerysonder, the only two repos that set `useTabs: true`; the other 13
  // either set no `useTabs` or ship no prettier config at all, and prettier's
  // default is spaces). A tab baseline reds `prettier --check` in 13 of 15
  // repos on exactly the degraded path this baseline is for.
  const body = JSON.stringify(entry.model, null, 2) + "\n";

  if (occupant === null) {
    try {
      // `wx` — an exclusive create, so the kernel rechecks atomically what
      // `occupantId` could only observe a moment ago. That closes two holes at
      // once, and the second is not hypothetical: a DANGLING symlink answers
      // ENOENT on read (local.ts documents the same lie from the reading side),
      // so without `wx` this would happily write the model through the link to
      // wherever it points — outside the repo, if the link says so.
      //
      // This path deliberately does NOT go through the temp+rename below.
      // `rename` overwrites unconditionally; there is no exclusive variant of
      // it, so routing the free path through a rename would trade a proven
      // guarantee (nothing is destroyed, ever) for a lesser one (a new file is
      // never partial). `link()` would give both — it fails EEXIST if the name
      // is taken — but only at the cost of an `unlink` to clear the temp, and a
      // delete verb in this module is precisely what the channels guard in
      // write.test.ts exists to forbid. The free path has nothing to destroy,
      // so it does not need to buy the protection twice.
      await writeFile(full, body, { encoding: "utf-8", flag: "wx" });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "EEXIST") {
        throw new Error(
          `${rel}: nothing readable was at this path a moment ago and something is there now — ` +
            `a dangling symlink, or a concurrent write. Refusing to overwrite it.`,
          { cause: e },
        );
      }
      throw e;
    }
  } else {
    // The sanctioned same-id refresh — the ONE path in this module that may
    // legitimately destroy bytes in a live client repo, which is why it is the
    // one path that must never destroy them by accident.
    //
    // A plain `w` opens with O_TRUNC: any failure between the truncate and the
    // last byte — ENOSPC, EDQUOT, EIO, or the operator interrupting this
    // human-invoked CLI — leaves the live model as a fragment that is not valid
    // JSON. That wreckage is self-latching, because the fragment is exactly
    // what `occupantId` reads on the retry, so the retry refuses too; and it is
    // indistinguishable from this module's other failures, every one of which
    // provably leaves the repo untouched.
    //
    // Writing a complete temp file first and renaming it over the target makes
    // the replacement a single atomic step: the model path holds the old model
    // or the new one, never a fragment. Same directory, so it is the same
    // filesystem and `rename` cannot fail with EXDEV.
    const tmp = `${full}.${process.pid}-${(tmpSeq += 1)}.tmp`;
    const tmpRel = relative(repoRoot, tmp);
    try {
      // `wx` on the temp too: never adopt a file some earlier run left here.
      await writeFile(tmp, body, { encoding: "utf-8", flag: "wx" });
    } catch (e) {
      throw new Error(
        `${rel}: could not stage the replacement model (${(e as Error).message}). ` +
          `The model already in the repo is UNTOUCHED. A partial ${tmpRel} may be left ` +
          `behind — delete it; nothing reads it.`,
        { cause: e },
      );
    }
    try {
      // `rename` replaces the NAME, so if the model path is a symlink (to
      // somewhere inside this repo — anywhere else was refused above) it is
      // replaced by a regular file rather than written through. No entry under
      // `customtypes/` or a slice library is a symlink in any in-scope repo
      // (measured 2026-08-13), and were one to appear the swap shows up in
      // `git diff` as a 120000→100644 mode change rather than silently.
      await rename(tmp, full);
    } catch (e) {
      throw new Error(
        `${rel}: could not replace the model with the staged copy ` +
          `(${(e as Error).message}). The model already in the repo is UNTOUCHED and the ` +
          `staged copy is at ${tmpRel} — delete it; nothing reads it.`,
        { cause: e },
      );
    }
  }

  // Resolved, never resolved-by-PATH: see targetPrettierBin.
  const bin = await targetPrettierBin(repoRoot);
  const formatted =
    bin === null
      ? false
      : await formatWithPrettier(spawn, repoRoot, [rel], { bin, timeoutMs: PRETTIER_TIMEOUT_MS });
  return { path: rel, formatted };
}
