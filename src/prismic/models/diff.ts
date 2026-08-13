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
