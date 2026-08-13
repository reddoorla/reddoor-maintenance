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
