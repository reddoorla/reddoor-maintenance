import { lstat, readdir, readFile, stat } from "node:fs/promises";
import { join, posix, relative, sep } from "node:path";
import type { LocalEntry, ModelKind, PrismicModel } from "./types.js";

/** Repo-relative, forward-slashed — the form used in PR comments and passed to
 *  the target repo's prettier, both of which are POSIX-shaped even on Windows. */
const relPath = (repoRoot: string, full: string): string =>
  relative(repoRoot, full).split(sep).join(posix.sep);

/**
 * Whether `full` is PROVEN not to exist — the ONLY condition under which this
 * reader is allowed to move on quietly.
 *
 * The polarity is the whole point: absence must be proved, never assumed. A
 * clean ENOENT is proof; every other outcome — a successful stat, EACCES on the
 * parent directory, ENOTDIR, an I/O error — answers "not proven absent", and
 * the caller then goes on to read the path and fails loudly with a real errno.
 * A helper that returned "absent" on ANY error (the obvious `try { … } catch {
 * return false }` shape) reintroduces exactly the failure this module exists to
 * prevent: an unreadable model becomes indistinguishable from a model that was
 * never there, CI reports "in sync", and the field is quietly missing in
 * Prismic — the same silence that has already cost live sites five fields.
 *
 * `lstat`, not `stat`, deliberately. `stat` follows symlinks, so a DANGLING
 * symlink answers ENOENT and would read as absent even though the repo plainly
 * contains an entry at that path. `lstat` sees the link itself, so a broken
 * link reads as present and the read that follows throws.
 */
async function isProvenAbsent(full: string): Promise<boolean> {
  try {
    await lstat(full);
    return false;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "ENOENT";
  }
}

/**
 * Parse one model file that we have already established is NOT proven absent.
 *
 * Throws — never skips — on unreadable content, malformed JSON, or a missing
 * id: a model that cannot be read is INDISTINGUISHABLE from a model that does
 * not exist, and a silent skip would let CI report "in sync" while a field was
 * actually missing in Prismic — the five-field drop this pipeline exists to
 * prevent.
 *
 * That covers the "present but not a regular file" case by construction: a
 * DIRECTORY named `model.json` fails the read with EISDIR and throws here. That
 * is the intended outcome — it is a broken repo, not an absent model, and the
 * operator needs to see it rather than have the site's model silently vanish
 * from the comparison.
 */
async function readModel(repoRoot: string, full: string, kind: ModelKind): Promise<LocalEntry> {
  const rel = relPath(repoRoot, full);
  let raw: string;
  try {
    raw = await readFile(full, "utf-8");
  } catch (e) {
    throw new Error(`${rel}: cannot read model file (${(e as Error).message})`, { cause: e });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(`${rel}: invalid JSON (${(e as Error).message})`, { cause: e });
  }
  // `null`, `[]` and `"a string"` are all valid JSON, so they reach here having
  // parsed cleanly. Without this guard, a file containing literal `null` throws
  // a raw TypeError from the `.id` read below — the ONE throw in this file that
  // would name neither the file nor a cause, leaving an operator with
  // "Cannot read properties of null" and 200-odd model files to search.
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    const got = parsed === null ? "null" : Array.isArray(parsed) ? "an array" : typeof parsed;
    throw new Error(`${rel}: model is not a JSON object (got ${got})`);
  }
  const model = parsed as Partial<PrismicModel>;
  if (typeof model.id !== "string" || model.id === "") {
    throw new Error(`${rel}: model has no string "id"`);
  }
  return { kind, id: model.id, model: model as PrismicModel, path: rel };
}

/**
 * The names of `dir`'s entries that are model DIRECTORIES, or [] when `dir`
 * itself is PROVEN absent.
 *
 * The two halves of that sentence are both load-bearing. A configured library
 * pointing nowhere (alamo-anatomy) must read as EMPTY — that is a config wart,
 * not a broken model, and failing the whole run over it would take a live site
 * out of the pipeline for a typo. But a directory that EXISTS and cannot be
 * listed must throw: reading it as empty would report every one of that site's
 * slices as absent, which downstream looks exactly like "this site deleted all
 * its slices". ENOTDIR is the concrete case worth surfacing — a library path
 * that points at a FILE is a config error, and answering [] would hide it.
 *
 * A SYMLINK to a directory counts as a directory. `readdir` reports it as
 * `isSymbolicLink()` and NOT `isDirectory()`, so the obvious
 * `.filter((d) => d.isDirectory())` drops a symlinked model directory with no
 * entry and no error — a present, perfectly readable model vanishing in
 * silence, which is the exact class this module exists to prevent. It would
 * also be internally inconsistent: at the FILE level this reader follows
 * symlinks happily (a symlinked `model.json` is read like any other file), so
 * refusing them one level up is an accident, not a policy.
 *
 * The polarity here is deliberately NOT the polarity of {@link isProvenAbsent},
 * and the difference is the difference between the two questions being asked:
 *
 *   - At the FILE level we already know a model is supposed to be at that exact
 *     path, so anything other than a clean ENOENT is an error.
 *   - Here we are ENUMERATING candidates, and a non-directory entry is
 *     legitimately not a candidate — a stray `README.md` in the slices folder
 *     is not a broken model, and a symlink to a file is the same thing wearing
 *     a hat. Both are skipped in silence.
 *
 * What we are never entitled to do is call an entry "not a candidate" when we
 * could not resolve it at all. A DANGLING symlink therefore throws rather than
 * skipping: it may well have been a model directory, and we cannot tell.
 *
 * Names are sorted so that read order — and therefore the file named "first" in
 * a duplicate-id error, and the order entries reach the PR comment — does not
 * depend on the filesystem's arbitrary directory ordering.
 */
async function subdirs(repoRoot: string, dir: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (e) {
    if (await isProvenAbsent(dir)) return [];
    throw new Error(`${relPath(repoRoot, dir)}: cannot list directory (${(e as Error).message})`, {
      cause: e,
    });
  }

  const names: string[] = [];
  for (const d of entries) {
    if (d.isDirectory()) {
      names.push(d.name);
      continue;
    }
    // A plain file, socket, fifo — not a candidate, and not a problem.
    if (!d.isSymbolicLink()) continue;

    const full = join(dir, d.name);
    let target;
    try {
      // `stat`, which FOLLOWS the link — the one place in this file where
      // following is what we want, because the question is "what is on the
      // other end", not "is something here".
      target = await stat(full);
    } catch (e) {
      throw new Error(
        `${relPath(repoRoot, full)}: symlink cannot be resolved (${(e as Error).message}). ` +
          `A link we cannot follow may be a model directory — refusing to guess.`,
        { cause: e },
      );
    }
    if (target.isDirectory()) names.push(d.name);
  }
  return names.sort();
}

/**
 * Every model on disk: custom types from `customtypes/<id>/index.json`, slices
 * from `<library>/<Dir>/model.json` for each configured library.
 *
 * Slices are keyed by the model's own `id`, NOT the directory name — the two
 * differ across the fleet (gallerysonder's `ContentWidthMedia` holds
 * `video_block`), and keying on the directory would send Prismic ids it has
 * never seen.
 *
 * A subdirectory with no model file is skipped (a leftover component folder is
 * normal); anything present-but-unreadable throws. See {@link isProvenAbsent}
 * for why that line, and not "any error means absent", is where the skip stops.
 */
export async function localModels(repoRoot: string, libraries: string[]): Promise<LocalEntry[]> {
  const out: LocalEntry[] = [];

  const ctRoot = join(repoRoot, "customtypes");
  for (const d of await subdirs(repoRoot, ctRoot)) {
    const full = join(ctRoot, d, "index.json");
    if (await isProvenAbsent(full)) continue;
    out.push(await readModel(repoRoot, full, "customtype"));
  }

  // The same library listed twice — or listed as both "./src/lib/slices" and
  // "src/lib/slices" — is a config typo, not two libraries. Deduplicating on
  // the RESOLVED path keeps it a harmless wart (the same call as alamo-anatomy's
  // missing library) instead of a hard duplicate-id failure whose message would
  // nonsensically name one file as the collision partner of itself.
  for (const libRoot of new Set(libraries.map((lib) => join(repoRoot, lib)))) {
    for (const d of await subdirs(repoRoot, libRoot)) {
      const full = join(libRoot, d, "model.json");
      if (await isProvenAbsent(full)) continue;
      out.push(await readModel(repoRoot, full, "slice"));
    }
  }

  assertNoDuplicateIds(out);
  assertVariationsHaveIds(out);
  return out;
}

/**
 * Refuse a repo where two files of the SAME kind declare the same model id.
 *
 * This is possible on disk because a slice's directory name and its model `id`
 * are independent — gallerysonder's `ContentWidthMedia/` holds `video_block` —
 * so two directories can quietly claim one id. Undetected, it is a silent and
 * ARBITRARY push: `diffModels` processes both entries independently, so one can
 * land in `unchanged` while the other lands in `toUpdate` against the same
 * remote model, and the push sends whichever of the two directories sorts last.
 * (Sorting the listing made that stable, not correct — a stable coin flip is
 * still a coin flip, and nothing would tell the operator the other file was
 * ignored.) That is the silent-divergence class this module exists to prevent, so
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
 * something that would fail on push anyway — but WHERE it fails is the whole
 * value: here it names the file and the index, while on push Prismic answers
 * with an opaque 422 that names neither, against a repo the operator may not
 * have knowingly touched.
 *
 * It does NOT exist to protect `describeDiff`, which is safe on its own:
 * `diff.ts` keys an id-less variation by a positional `variations[i]` fallback
 * that is unique per side, precisely so two of them cannot collide there.
 *
 * Measured 2026-08-12: all 180 variations in the fleet's 132 slice models carry
 * an `id`, so this is defensive, not a live repair.
 *
 * That count — and every fleet count in this directory — is taken from each
 * repo's DEFAULT BRANCH (`origin/HEAD`) via git plumbing, never from the local
 * working tree. Six of the fifteen checkouts sit on feature branches at any
 * given moment, and one of them gained a commit mid-measurement, so a
 * working-tree count is not reproducible and drifted by 3 variations while
 * these very comments were being written. "In scope" excludes the starter
 * repos, whose sentinel `repositoryName` makes `readPrismicConfig` return null:
 * this pipeline never loads their models, so counting them would describe files
 * nothing reads.
 *
 * A model with no `variations` array is untouched — custom types have none at
 * all, so anything stricter here would reject every custom type in the fleet.
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
