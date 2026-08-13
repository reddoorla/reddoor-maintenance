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
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, posix, sep } from "node:path";
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
 * files, with both reporting success. Hence the per-segment check at the end,
 * which is the containment guarantee for this whole module: no realpath check
 * follows it, deliberately, because local.ts reads models through symlinks by
 * design and a realpath rule here would refuse to write back the very files it
 * reads.
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
 * Formatting is best-effort by contract (`formatWithPrettier` never throws), so
 * the file is always written; `formatted: false` tells the caller to flag the PR
 * for a manual format check rather than losing the model. It is one bit and it
 * deliberately merges two causes — prettier absent (a clone with no
 * node_modules) and prettier exiting non-zero — because the operator's next
 * action is identical for both and the CLI prints the same `PRETTIER_FLAG_NOTE`.
 * The consequence is bounded and visible downstream: an unformatted file reds
 * the target repo's own `prettier --check` in CI, which is how the trap above
 * was found in the first place.
 *
 * NOTHING here is best-effort, though. Every way this can fail to write the
 * RIGHT file at the RIGHT path throws, because a pull-down that silently writes
 * the wrong file is indistinguishable from one that worked.
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

  // If the write below fails, this directory stays behind empty. That is
  // deliberate and not worth "fixing": undoing it needs a delete verb, and this
  // module imports none — the pull-down is the safe answer to a model CI may
  // never delete, so it does not get the ability to remove things in order to
  // tidy up after itself. An empty directory is visible in `git status` and
  // harmless; a delete verb in this file is neither.
  try {
    await mkdir(dirname(full), { recursive: true });
  } catch (e) {
    throw new Error(
      `${posix.dirname(rel)}: cannot create the directory for this model ` +
        `(${(e as Error).message})`,
      { cause: e },
    );
  }

  try {
    // Tabs + trailing newline is only a BASELINE that matches the fleet's
    // prettier config closely enough to minimise the rewrite; prettier below is
    // the authority.
    //
    // `wx` when we proved the path free — an exclusive create, so the kernel
    // rechecks atomically what `occupantId` could only observe a moment ago.
    // That closes two holes at once, and the second is not hypothetical: a
    // DANGLING symlink answers ENOENT on read (local.ts documents the same lie
    // from the reading side), so without `wx` this would happily write the model
    // through the link to wherever it points — outside the repo, if the link
    // says so.
    await writeFile(full, JSON.stringify(entry.model, null, "\t") + "\n", {
      encoding: "utf-8",
      flag: occupant === null ? "wx" : "w",
    });
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

  const formatted = await formatWithPrettier(spawn, repoRoot, [rel]);
  return { path: rel, formatted };
}
