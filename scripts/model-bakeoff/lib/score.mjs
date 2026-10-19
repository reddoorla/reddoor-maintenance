export const RULES = Object.freeze({
  dashes: (s) => s.replace(/[‐-―−]/g, "-"),
  whitespace: (s) => s.replace(/\s+/g, " ").trim(),
  casefold: (s) => s.toLowerCase(),
  punctuation: (s) => s.replace(/[^a-z0-9]/g, ""),
  titlePrefix: (s) => s.replace(/^\s*(det\.?|detective|dr\.?|mr\.?|mrs\.?|ms\.?)\s+/i, ""),
});

const PIPELINES = Object.freeze({
  string: ["dashes", "whitespace", "casefold"],
  text: ["dashes", "casefold", "punctuation"],
  name: ["titlePrefix", "dashes", "casefold", "punctuation"],
});

export const MISSING = "<missing>";

const NUMBER = /^-?\d+(\.\d+)?(e[+-]?\d+)?$/i;
export const PRESENT = "(present)";
export const EXTRA = "(extra)";
export const DUPLICATES = "(no duplicates)";

const str = (v) => (v === null || v === undefined ? "" : String(v));

export function normalise(value, kind, custom = {}) {
  if (kind.startsWith("set:")) {
    const inner = kind.slice(4);
    const list = Array.isArray(value)
      ? value
      : value === null || value === undefined
        ? []
        : [value];
    const members = [
      ...new Set(list.map((v) => normalise(v, inner, custom)).filter((v) => v !== "")),
    ];
    return JSON.stringify(members.sort());
  }
  if (typeof custom[kind] === "function") return String(custom[kind](value));
  if (kind === "number") {
    if (typeof value === "number") return Number.isFinite(value) ? String(value) : `NaN:${value}`;
    const s = RULES.whitespace(str(value));
    return NUMBER.test(s) ? String(Number(s)) : `NaN:${s}`;
  }
  if (kind === "boolean") {
    if (value === true || value === false) return String(value);
    const s = RULES.casefold(RULES.whitespace(str(value)));
    return s === "true" || s === "false" ? s : `?:${s}`;
  }
  if (kind === "file") {
    const s = RULES.casefold(RULES.whitespace(str(value)));
    return s.split("/").pop();
  }
  const steps = PIPELINES[kind];
  if (!steps) throw new Error(`unknown kind ${kind}`);
  return steps.reduce((s, rule) => RULES[rule](s), str(value));
}

const raw = (v) => (v === undefined ? MISSING : typeof v === "string" ? v : JSON.stringify(v));

function collectionTools(spec, col) {
  const custom = spec.kinds || {};
  const items = (src) => (src && Array.isArray(src[col.name]) ? src[col.name] : []);
  const keyOf = (x) =>
    normalise(x && typeof x === "object" ? x[col.key] : undefined, col.keyKind, custom);
  const firstByKey = (src) => {
    const m = new Map();
    const duplicates = [];
    for (const x of items(src)) {
      const k = keyOf(x);
      if (m.has(k)) duplicates.push(raw(x && x[col.key]));
      else m.set(k, x);
    }
    return { m, duplicates };
  };
  return { custom, firstByKey };
}

export function referenceDuplicates(spec, reference) {
  return spec.collections.flatMap((col) =>
    collectionTools(spec, col)
      .firstByKey(reference)
      .duplicates.map((d) => `${col.name} ${d}`),
  );
}

export function extraCandidates(spec, reference, outputs) {
  const out = {};
  for (const col of spec.collections) {
    const { firstByKey } = collectionTools(spec, col);
    const ref = firstByKey(reference).m;
    const seen = new Map();
    for (const o of outputs) {
      for (const [k, x] of firstByKey(o).m) {
        if (!ref.has(k) && !seen.has(k)) seen.set(k, raw(x && x[col.key]));
      }
    }
    out[col.name] = [...seen].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  }
  return out;
}

export function scoreRun(
  spec,
  reference,
  output,
  candidates = extraCandidates(spec, reference, [output]),
) {
  const checks = [];
  for (const col of spec.collections) {
    const { custom, firstByKey } = collectionTools(spec, col);
    const ref = firstByKey(reference).m;
    const { m: out, duplicates } = firstByKey(output);
    for (const [k, r] of ref) {
      const o = out.get(k);
      const presence = o ? "present" : "absent";
      checks.push({
        collection: col.name,
        key: k,
        field: PRESENT,
        check: `${col.name} ${r[col.key]} / ${PRESENT}`,
        ok: Boolean(o),
        armKey: presence,
        refKey: "present",
        armRaw: presence,
        refRaw: "present",
      });
      for (const [field, kind] of Object.entries(col.fields)) {
        const has = Boolean(o) && o[field] !== undefined;
        const armKey = has ? normalise(o[field], kind, custom) : MISSING;
        const refKey = normalise(r[field], kind, custom);
        checks.push({
          collection: col.name,
          key: k,
          field,
          check: `${col.name} ${r[col.key]} / ${field}`,
          ok: armKey === refKey,
          armKey,
          refKey,
          armRaw: has ? raw(o[field]) : MISSING,
          refRaw: raw(r[field]),
        });
      }
    }
    for (const [k, name] of candidates[col.name] || []) {
      const listed = out.has(k) ? "listed" : "not listed";
      checks.push({
        collection: col.name,
        key: k,
        field: EXTRA,
        check: `${col.name} ${name} / ${EXTRA}`,
        ok: !out.has(k),
        armKey: listed,
        refKey: "not listed",
        armRaw: listed,
        refRaw: "not listed",
      });
    }
    checks.push({
      collection: col.name,
      key: "(set)",
      field: DUPLICATES,
      check: `${col.name} / ${DUPLICATES}`,
      ok: duplicates.length === 0,
      armKey: JSON.stringify(duplicates.sort()),
      refKey: "[]",
      armRaw: JSON.stringify(duplicates),
      refRaw: "[]",
      mechanical: true,
    });
  }
  return checks;
}

export function disagreementId(c) {
  return `${c.check} :: ${c.armKey}`;
}

export function groupDisagreements(checksByArm) {
  const groups = new Map();
  for (const [arm, checks] of Object.entries(checksByArm)) {
    for (const c of checks) {
      if (c.ok || c.armRaw === MISSING || c.mechanical) continue;
      const id = disagreementId(c);
      if (!groups.has(id)) {
        groups.set(id, { id, check: c.check, armRaw: c.armRaw, refRaw: c.refRaw, arms: [] });
      }
      groups.get(id).arms.push(arm);
    }
  }
  return [...groups.values()];
}

export function finalScores(checksByArm, rulings = {}) {
  const per = {};
  const referenceErrors = [];
  const seenRefError = new Set();
  const verdicts = new Map();
  const itemOf = (c) => `${c.collection}\u0000${c.key}`;
  const checkItem = new Map();
  for (const checks of Object.values(checksByArm)) {
    for (const c of checks) {
      checkItem.set(c.check, { item: itemOf(c), presence: c.field === PRESENT });
      const r =
        c.ok || c.armRaw === MISSING || c.mechanical ? undefined : rulings[disagreementId(c)];
      if (!r) continue;
      if (!verdicts.has(c.check)) verdicts.set(c.check, { yes: [], no: [] });
      verdicts.get(c.check)[r.refCorrect === false ? "no" : "yes"].push(r);
    }
  }
  const refWrong = new Map();
  const contested = [];
  for (const [check, v] of verdicts) {
    if (v.no.length && v.yes.length) contested.push(check);
    else if (v.no.length) refWrong.set(check, v.no[0]);
  }
  const refutedItems = new Set();
  for (const [check, info] of checkItem) {
    if (info.presence && refWrong.has(check)) refutedItems.add(info.item);
  }
  const contradictions = contested.filter((check) => {
    const info = checkItem.get(check);
    return info.presence || !refutedItems.has(info.item);
  });
  for (const [arm, checks] of Object.entries(checksByArm)) {
    const p = { total: 0, correct: 0, unruled: 0, byField: {}, errors: [] };
    for (const c of checks) {
      if (c.field !== PRESENT && refutedItems.has(itemOf(c))) continue;
      let ok = c.ok && !refWrong.has(c.check);
      if (!c.ok) {
        const r = c.armRaw === MISSING || c.mechanical ? undefined : rulings[disagreementId(c)];
        if (r === undefined && c.armRaw !== MISSING && !c.mechanical) p.unruled++;
        ok = r ? r.armCorrect === true : false;
        if (r && refWrong.has(c.check) && !seenRefError.has(c.check)) {
          seenRefError.add(c.check);
          referenceErrors.push({ check: c.check, reference: c.refRaw, note: r.note || "" });
        }
      }
      p.total++;
      if (ok) p.correct++;
      const bf = (p.byField[`${c.collection}.${c.field}`] ??= { total: 0, correct: 0 });
      bf.total++;
      if (ok) bf.correct++;
      if (!ok) {
        const refuted = refWrong.get(c.check);
        const expected = refuted
          ? `not ${c.refRaw} (the referee refuted the reference: ${refuted.note || "no note"})`
          : c.refRaw;
        p.errors.push({ check: c.check, got: c.armRaw, expected });
      }
    }
    per[arm] = p;
  }
  return { per, referenceErrors, contradictions };
}
