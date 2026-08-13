/** Which Types API collection a model belongs to. Custom types live at
 *  `customtypes/<id>/index.json`; slices at `<library>/<Dir>/model.json`. */
export type ModelKind = "customtype" | "slice";

/** A Prismic model as JSON. Deliberately loose: this pipeline must round-trip
 *  every field Prismic holds, including ones it does not know about. Narrowing
 *  it to a hand-written schema is how fields get silently dropped — the exact
 *  failure class this module exists to prevent. */
export type PrismicModel = Record<string, unknown> & { id: string };

/** A model read from a repo working tree. `path` is always known here, which is
 *  what separates it from {@link RemoteEntry}. `id` mirrors `model.id`; both
 *  constructors derive it from the parsed model, so they cannot disagree. */
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
 *  property, not a convention. `diffModels(local, remote)` with the arguments
 *  swapped would otherwise typecheck and silently invert `toCreate` and
 *  `remoteOnly` — CI would try to create models Prismic already holds and would
 *  report every local model as remote-only. The split makes that a type error. */
export type RemoteEntry = {
  kind: ModelKind;
  id: string;
  model: PrismicModel;
};

/** The four buckets a comparison sorts every model into. `remoteOnly` is the
 *  safety-critical one: it is REPORTED and never acted on by CI, because a stale
 *  local checkout must never be able to remove a live content model. */
export type ModelDiff = {
  toCreate: LocalEntry[];
  toUpdate: Array<{ local: LocalEntry; remote: RemoteEntry }>;
  unchanged: LocalEntry[];
  remoteOnly: RemoteEntry[];
};

/** Outcome of one push run.
 *
 *  `mode` is the MODE, not the verdict — read `failed` for that. A dry run
 *  populates `sent` with what it WOULD have sent, which is why the field cannot
 *  be read as "Prismic accepted these" without checking `mode` first. */
export type PushReport = {
  mode: "dry" | "apply";
  /** On `apply`, models Prismic accepted. On `dry`, models that would be sent. */
  sent: Array<{ kind: ModelKind; id: string; action: "insert" | "update" }>;
  /** `status` is the HTTP status when there was one. A 401/403 means the write
   *  token is dead or wrong (fix the secret); a 422 means Prismic rejected the
   *  model itself (fix the model). Those need different operator responses, and
   *  token expiry is undocumented — this is what tells them apart. */
  failed: Array<{ kind: ModelKind; id: string; error: string; status?: number }>;
};
