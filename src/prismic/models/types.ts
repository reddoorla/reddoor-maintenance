// src/prismic/models/types.ts

/** Which Types API collection a model belongs to. Custom types live at
 *  `customtypes/<id>/index.json`; slices at `<library>/<Dir>/model.json`. */
export type ModelKind = "customtype" | "slice";

/** A Prismic model as JSON. Deliberately loose: this pipeline must round-trip
 *  every field Prismic holds, including ones it does not know about. Narrowing
 *  it to a hand-written schema is how fields get silently dropped — the exact
 *  failure class this module exists to prevent. */
export type PrismicModel = Record<string, unknown> & { id: string };

/** One model, local or remote. */
export type ModelEntry = {
  kind: ModelKind;
  id: string;
  model: PrismicModel;
  /** Repo-relative path. Present on LOCAL entries, absent on remote ones. */
  path?: string;
};

/** The four buckets a comparison sorts every model into. `remoteOnly` is the
 *  safety-critical one: it is REPORTED and never acted on by CI. */
export type ModelDiff = {
  toCreate: ModelEntry[];
  toUpdate: Array<{ local: ModelEntry; remote: ModelEntry }>;
  unchanged: ModelEntry[];
  remoteOnly: ModelEntry[];
};

/** Outcome of one push run. `sent` counts models actually accepted by Prismic;
 *  `failed` carries the id and the API's own message so an operator can act. */
export type PushReport = {
  applied: boolean;
  sent: Array<{ kind: ModelKind; id: string; action: "insert" | "update" }>;
  failed: Array<{ kind: ModelKind; id: string; error: string }>;
  /** Copied through from the diff so a caller never has to re-derive it. */
  remoteOnly: ModelEntry[];
};
