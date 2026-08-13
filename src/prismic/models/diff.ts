import { sameModel } from "./canon.js";
import type { LocalEntry, ModelDiff, ModelKind, PrismicModel, RemoteEntry } from "./types.js";

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

type Zone = Record<string, unknown>;
const asZone = (v: unknown): Zone => (v !== null && typeof v === "object" ? (v as Zone) : {});

type Verb = "added" | "removed" | "changed";

/** Real fleet JSON nests at most 13 levels deep, and this only recurses at
 *  Group/Slices boundaries (Prismic does not nest those more than one level
 *  in practice) — so this bound sits comfortably above anything real data
 *  will hit. It exists purely to stop a malformed/pathological model from
 *  recursing without limit, not to clip genuine fleet depth. */
const MAX_FIELD_DEPTH = 20;

/** CAVEAT that applies to every add/remove pass in this file (`compareMeta`
 *  here AND `compareZone` below): they test raw key PRESENCE via
 *  `Object.hasOwn`, not `sameModel`. Only the CHANGED pass runs values
 *  through `sameModel`/`canon()`. So a key whose VALUE `canon` drops as
 *  noise (`null`/`""`) but that exists on only ONE side could, in
 *  principle, render an add/remove line for what is really serializer
 *  noise, not a real difference.
 *
 *  Bounded and currently harmless: 0 of the 1,167 real `""`/`null` keys in
 *  the fleet sit at a raw-presence level here — all are inside field
 *  configs, one level down, where the CHANGED pass's `sameModel` call does
 *  guard them — and a pair whose ONLY difference is canon-noise is
 *  classified `unchanged` by `diffModels` and never reaches `describeDiff`
 *  at all.
 *
 *  BUT that second bound is a property of the CALLER, not of this
 *  function. If any future caller ever runs `describeDiff` on a pair
 *  `diffModels` sorted into `unchanged` — a verbose mode, a debug flag —
 *  that bound disappears and this becomes a false-alarm source: crying
 *  "changed" on pure serializer noise is the INVERTED failure from the one
 *  this whole file exists to prevent, and the nightly drift sweep must
 *  never produce it. */

/** Flat key-diff for a METADATA object — the model's own top-level keys, or
 *  a variation's own top-level keys. Deliberately NOT recursive: metadata
 *  values (`label`, `name`, `repeatable`, …) are leaves, never Group/Slices
 *  containers, so there is nothing here for `compareZone` to descend into.
 *  `format` renders each line so metadata reads distinctly from the
 *  dot-notation field-path lines `compareZone` emits — `~ (model) label`
 *  must never be mistaken for a field path. */
const compareMeta = (
  a: Zone,
  b: Zone,
  excluded: readonly string[],
  format: (k: string, verb: Verb) => string,
): string[] => {
  const skip = new Set<string>(excluded);
  const out: string[] = [];
  for (const k of Object.keys(a)) {
    if (skip.has(k)) continue;
    if (!Object.hasOwn(b, k)) out.push(format(k, "added"));
  }
  for (const k of Object.keys(b)) {
    if (skip.has(k)) continue;
    if (!Object.hasOwn(a, k)) out.push(format(k, "removed"));
  }
  for (const k of Object.keys(a)) {
    if (skip.has(k) || !Object.hasOwn(b, k)) continue;
    if (!sameModel(a[k], b[k])) out.push(format(k, "changed"));
  }
  return out;
};

const modelMetaLine = (k: string, verb: Verb): string =>
  verb === "added"
    ? `+ (model) ${k}`
    : verb === "removed"
      ? `- (model) ${k} (REMOVED remotely)`
      : `~ (model) ${k}`;

const variationMetaLine = (id: string, k: string, verb: Verb): string =>
  verb === "added"
    ? `+ variation ${id}: ${k}`
    : verb === "removed"
      ? `- variation ${id}: ${k} (REMOVED remotely)`
      : `~ variation ${id}: ${k}`;

/** Top-level keys that hold FIELD structure, not metadata — excluded from
 *  the model-level metadata diff because each has its own dedicated pass. */
const MODEL_FIELD_KEYS = ["variations", "json"] as const;

/** A variation's own field zones. */
const VARIATION_FIELD_ZONES = ["primary", "items"] as const;

/** `imageUrl` is the slice-preview screenshot URL — Prismic-owned, and
 *  `canon()` (see canon.ts) already treats it as meaningless noise at ANY
 *  depth, dropping the key outright before comparing. A per-key metadata
 *  diff bypasses that whole-object canonicalization, so without this
 *  exclusion a stale on-disk `imageUrl` (nine real fleet repos carry one,
 *  per canon.ts) would surface as a spurious
 *  `~ variation X: imageUrl (changed)` line riding alongside — or instead
 *  of — a real change. */
const VARIATION_META_EXCLUDE = [...VARIATION_FIELD_ZONES, "imageUrl"] as const;

/** A field's nested comparison zone, if it has one. `Group` fields keep
 *  their member fields at `config.fields`; `Slices` fields keep their
 *  allowed slice choices at `config.choices`. Anything else has no children
 *  to recurse into. Returns `undefined` (not `{}`) for "not a container", so
 *  the caller can tell "no container" apart from "container with zero
 *  fields". */
const containerChildren = (field: unknown): Zone | undefined => {
  const f = asZone(field);
  if (f.type === "Group") return asZone(asZone(f.config).fields);
  if (f.type === "Slices") return asZone(asZone(f.config).choices);
  return undefined;
};

/** A container field's own definition with its CHILDREN key excluded —
 *  `fields` for Group, `choices` for Slices. Isolates "did the container's
 *  own config change" (a Group's `repeat` flag, a Slices field's `fieldset`
 *  label) from "did a child change", so `compareZone` can report the two
 *  independently instead of one hiding the other. */
const withoutChildren = (field: unknown, childrenKey: "fields" | "choices"): unknown => {
  const f = asZone(field);
  const cfg = asZone(f.config);
  const { [childrenKey]: _children, ...restCfg } = cfg;
  return { ...f, config: restCfg };
};

/** Field-zone diff — used for `primary`/`items`, custom-type tabs, and
 *  (recursively) the inside of Group/Slices containers. A field present on
 *  both sides but different is, by default, one `~ label.field (changed)`
 *  line. But when BOTH sides agree the field is the SAME container type
 *  (Group or Slices) and recursing into its children finds the actual
 *  difference, that specific child is reported instead of the opaque parent
 *  line — e.g. `+ Main.slices.lead_text` rather than `~ Main.slices
 *  (changed)`, which used to be the only signal a reviewer got for "someone
 *  removed a slice-zone choice" (137 real Group/Slices containers in the
 *  fleet, some hiding up to 28 children).
 *
 *  The container's OWN config (everything except its children) is ALSO
 *  compared whenever a child difference is found, not only when it isn't:
 *  reporting the child line alone was itself a metadata blind spot one
 *  level down from the one `describeDiff` fixes at the model/variation
 *  level — mutating a Group's `repeat` flag alongside a field addition
 *  rendered as a lone `+ Main.sections.new_field`, with the destructive
 *  half of the change invisible (155/155 real fleet containers, mutating
 *  both at once). If recursion finds nothing at all — the container's own
 *  config changed with byte-identical children — the generic changed line
 *  is still emitted, so the change never goes silent either way. */
const compareZone = (label: string, lz: unknown, rz: unknown, depth: number): string[] => {
  const a = asZone(lz);
  const b = asZone(rz);
  const out: string[] = [];
  for (const k of Object.keys(a)) if (!Object.hasOwn(b, k)) out.push(`+ ${label}.${k}`);
  for (const k of Object.keys(b))
    if (!Object.hasOwn(a, k)) out.push(`- ${label}.${k} (REMOVED remotely)`);
  for (const k of Object.keys(a)) {
    if (!Object.hasOwn(b, k) || sameModel(a[k], b[k])) continue;
    const childPath = `${label}.${k}`;
    if (depth < MAX_FIELD_DEPTH) {
      const av = asZone(a[k]);
      const bv = asZone(b[k]);
      if (av.type === bv.type && (av.type === "Group" || av.type === "Slices")) {
        const childrenKey = av.type === "Group" ? "fields" : "choices";
        const nested = compareZone(
          childPath,
          containerChildren(a[k]),
          containerChildren(b[k]),
          depth + 1,
        );
        if (nested.length > 0) {
          if (!sameModel(withoutChildren(a[k], childrenKey), withoutChildren(b[k], childrenKey)))
            out.push(`~ ${childPath} (changed)`);
          out.push(...nested);
          continue;
        }
      }
    }
    out.push(`~ ${childPath} (changed)`);
  }
  return out;
};

/** Field-level lines for ONE model pair, used in PR comments, CLI output,
 *  and the nightly drift sweep. `remote` is optional so a first-ever push
 *  (nothing registered in Prismic yet) can still be described — everything
 *  local renders as new instead of throwing.
 *
 *  Three passes, not one: `primary`/`items`/`json`-tab field diffs are
 *  necessary but not sufficient. A model-level rename (`label`, `format`,
 *  `status`, `repeatable`) or a variation-level rename (`name`,
 *  `description`) touches NEITHER zone, so without the other two passes
 *  those changes rendered as zero lines while `diffModels` still sorted the
 *  pair into `toUpdate` — a PR comment reading "CHANGED customtype page"
 *  with nothing underneath it, and a reviewer approving a change they never
 *  actually saw. Verified against the real fleet: mutating slice `name` or
 *  `description` alone (174/174 real variations) and customtype `label`,
 *  `status`, `format`, or `repeatable` alone (77/77 real custom types) both
 *  rendered blank before this fix.
 *
 *  Those two counts are an EXPERIMENT RECORD, not a live inventory, and they
 *  deliberately do not match the 132 slice models / 68 custom types cited
 *  elsewhere in this directory. The run (2026-08-12) covered every model file
 *  ON DISK, including the two starter templates whose sentinel
 *  `repositoryName` keeps them out of this pipeline — a strict SUPERSET of
 *  what `readPrismicConfig` admits. That makes the evidence stronger than the
 *  in-scope figure would suggest: the blind spot reproduced across all 174 and
 *  all 77, the in-scope models among them. Do not "reconcile" these numbers
 *  down to the in-scope count — that would claim an experiment that was never
 *  run. `repeatable` flipping is destructive, not
 *  cosmetic — and this is also precisely what the nightly drift sweep exists
 *  to catch, since an out-of-band dashboard edit (someone renaming a type,
 *  say) IS a metadata-only edit by definition. */
export function describeDiff(local: PrismicModel, remote: PrismicModel | undefined): string[] {
  const l = asZone(local);
  const r = asZone(remote);
  const lines: string[] = [];

  // On an insert (no remote yet) EVERY key is new, so itemizing each one is
  // pure noise once the structural `+ tab X (new)` / `+ variation X (new)`
  // lines already say "this is all new" — verified against the real fleet:
  // the metadata pass alone produced 1,111 `+ (model) k` lines against 368
  // structural ones on inserts (75% noise), a custom type opening with five
  // `+ (model) …` lines before the first `+ tab Main (new)`.
  if (remote !== undefined) lines.push(...compareMeta(l, r, MODEL_FIELD_KEYS, modelMetaLine));

  // Slice shape.
  if (Array.isArray(l.variations) || Array.isArray(r.variations)) {
    const variationEntries = (arr: unknown): Array<[string, Zone]> =>
      Array.isArray(arr)
        ? arr.map((v, i) => {
            const z = asZone(v);
            // A cast (`z.id as string`) would LIE when `id` is absent: it
            // would compile-time-assert a string that isn't there at
            // runtime, and every id-less variation on a side would key to
            // the literal string "undefined" and collide with every OTHER
            // id-less variation on that SAME side — silently dropping all
            // but the last one's diff. 0 of the 180 in-scope fleet
            // variations lack an id (measured 2026-08-12 on each repo's
            // DEFAULT branch across the 15 repos this pipeline loads; the
            // starters carry a sentinel repositoryName and are never read),
            // so this is defensive, but the index fallback is unique per
            // side and its label says exactly what it is.
            const id = typeof z.id === "string" ? z.id : `variations[${i}]`;
            return [id, z] as [string, Zone];
          })
        : [];
    const lv = new Map(variationEntries(l.variations));
    const rv = new Map(variationEntries(r.variations));
    for (const [id, v] of lv) {
      const rr = rv.get(id);
      if (!rr) {
        lines.push(`+ variation ${id} (new)`);
        continue;
      }
      for (const zone of VARIATION_FIELD_ZONES)
        lines.push(...compareZone(`${id}.${zone}`, v[zone], rr[zone], 0));
      lines.push(
        ...compareMeta(v, rr, VARIATION_META_EXCLUDE, (k, verb) => variationMetaLine(id, k, verb)),
      );
    }
    for (const id of rv.keys()) if (!lv.has(id)) lines.push(`- variation ${id} (REMOVED remotely)`);
  }

  // Custom-type shape.
  if (l.json !== undefined || r.json !== undefined) {
    const lt = asZone(l.json);
    const rt = asZone(r.json);
    for (const tab of Object.keys(lt)) {
      if (!Object.hasOwn(rt, tab)) {
        lines.push(`+ tab ${tab} (new)`);
        continue;
      }
      lines.push(...compareZone(tab, lt[tab], rt[tab], 0));
    }
    for (const tab of Object.keys(rt))
      if (!Object.hasOwn(lt, tab)) lines.push(`- tab ${tab} (REMOVED remotely)`);
  }

  // A blank "CHANGED <model>" is the failure this function exists to prevent, and
  // three separate blind spots have now produced one (metadata, containers, zone
  // presence). This is the backstop: anything `sameModel` calls different MUST
  // render at least one line. It closes the known zone-presence class and
  // degrades any FUTURE blind spot to an honest "changed, no detail" instead of a
  // silent blank. It also turns the property test below from a sample into a
  // guarantee.
  if (lines.length === 0 && remote !== undefined && !sameModel(local, remote))
    lines.push("~ (model) changed (no field-level detail)");

  return lines;
}

/** A push REPLACES the whole model, and Prismic — not the repo — owns the
 *  slice-preview screenshot at `variations[].imageUrl`: it is `""` on disk
 *  for most models and a stale URL on nine real fleet RichText models (see
 *  canon.ts). Sending the local value would blank or rot every slice
 *  preview in the editor as a side effect of pushing one unrelated field
 *  change. This is the deliberate asymmetry with `canon()`: comparison
 *  DROPS `imageUrl` entirely (it must never cause a diff), but a push still
 *  has to put a real value on the wire, and the only trustworthy one is
 *  whatever is currently live on the remote.
 *
 *  PRESENCE, not truthiness — the remote's value wins whenever the MATCHED
 *  remote variation HAS an `imageUrl` KEY, including when its value is
 *  `""`. A truthy check (`shot ? … : v`) looks equivalent and is tempting
 *  to "simplify" back to, but it is not: it conflates "no remote data for
 *  this id" (nothing is known, so keeping local is correct) with "remote
 *  explicitly reports `""`" (Prismic currently has NO screenshot for this
 *  variation — that IS the live truth). Falling through to local on a
 *  remote `""` doesn't preserve a preview, it WRITES a stale URL onto a
 *  variation that currently has none — the exact damage this function
 *  exists to prevent, on exactly the nine RichText models that carry one.
 *  The check has to be `Object.hasOwn(remoteVariation, "imageUrl")`, not
 *  `shots.has(id)`: an id MATCH alone is not proof the matched remote
 *  variation carries the key at all — without this, a matched remote
 *  variation that genuinely has no `imageUrl` property would overwrite a
 *  real local URL with `undefined`.
 *
 *  A variation with no string `id` is left untouched rather than matched by
 *  array index. `describeDiff` can fall back to an index label
 *  (`variations[i]`) because a wrong pairing there only costs a mislabeled
 *  comment line; here a wrong pairing WRITES the wrong screenshot onto a
 *  live variation on push. Guessing identity is the wrong trade when being
 *  wrong is destructive instead of cosmetic, so an id-less local variation
 *  just passes through with whatever `imageUrl` it already has.
 *
 *  On an INSERT (`remote === undefined`) there is no remote to defer to at
 *  all, but the local value is still not safe to send verbatim — nine real
 *  fleet repos carry a stale on-disk URL, and sending it on a fresh insert
 *  is the exact damage this function exists to prevent, just on the one
 *  path with no remote value to fall back on. Every variation's `imageUrl`
 *  is normalised to `""` instead (unconditionally — there is no matching
 *  happening here, so the id-less-variation caveat above does not apply):
 *  `""` is what Slice Machine writes normally and what 171 of the 180
 *  in-scope fleet variations already carry (measured 2026-08-12 on each
 *  repo's DEFAULT branch across the 15 repos this pipeline loads; the other
 *  9 hold a real URL and NONE omit the key), so it is proven acceptable to
 *  the Types API. The KEY stays present — never deleted —
 *  because an absent `imageUrl` is unproven against the API, and a live
 *  push is not the place to find out. */
export function withRemoteScreenshots(
  local: PrismicModel,
  remote: PrismicModel | undefined,
): PrismicModel {
  if (!Array.isArray(local.variations)) return local;

  if (!remote) {
    return {
      ...local,
      variations: local.variations.map((v) => ({ ...asZone(v), imageUrl: "" })),
    };
  }

  const shots = new Map(
    (Array.isArray(remote.variations) ? remote.variations : [])
      .map((v) => asZone(v))
      .filter((o): o is Zone & { id: string } => typeof o.id === "string")
      .map((o) => [o.id, o] as const),
  );
  return {
    ...local,
    variations: local.variations.map((v) => {
      const o = asZone(v);
      if (typeof o.id !== "string") return v;
      const remoteVariation = shots.get(o.id);
      if (!remoteVariation || !Object.hasOwn(remoteVariation, "imageUrl")) return v;
      return { ...o, imageUrl: remoteVariation.imageUrl };
    }),
  };
}
