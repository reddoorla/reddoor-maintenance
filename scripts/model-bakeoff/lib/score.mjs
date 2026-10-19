export const RULES = Object.freeze({
  dashes: (s) => s.replace(/[\u2010-\u2015\u2212]/g, "-"),
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

const str = (v) => (v === null || v === undefined ? "" : String(v));

export function normalise(value, kind) {
  if (kind.startsWith("set:")) {
    const inner = kind.slice(4);
    const list = Array.isArray(value)
      ? value
      : value === null || value === undefined
        ? []
        : [value];
    return [...new Set(list.map((v) => normalise(v, inner)).filter((v) => v !== ""))]
      .sort()
      .join("|");
  }
  if (kind === "number") {
    const n = typeof value === "number" ? value : Number(RULES.whitespace(str(value)));
    return Number.isFinite(n) ? String(n) : `NaN:${str(value)}`;
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

function indexBy(items, keyKind) {
  const m = new Map();
  for (const item of Array.isArray(items) ? items : []) {
    if (item && typeof item === "object") m.set(normalise(item.key, keyKind), item);
  }
  return m;
}

const raw = (v) => (v === undefined ? MISSING : typeof v === "string" ? v : JSON.stringify(v));

export function scoreRun(spec, reference, output) {
  const checks = [];
  for (const col of spec.collections) {
    const keyed = (src) =>
      (src && Array.isArray(src[col.name]) ? src[col.name] : []).map((x) => ({
        ...x,
        key: x ? x[col.key] : undefined,
      }));
    const ref = indexBy(keyed(reference), col.keyKind);
    const out = indexBy(keyed(output), col.keyKind);
    for (const [k, r] of ref) {
      const o = out.get(k);
      for (const [field, kind] of Object.entries(col.fields)) {
        const armKey = o ? normalise(o[field], kind) : MISSING;
        const refKey = normalise(r[field], kind);
        checks.push({
          collection: col.name,
          key: k,
          field,
          check: `${col.name} ${r.key} / ${field}`,
          ok: armKey === refKey,
          armKey,
          refKey,
          armRaw: o ? raw(o[field]) : MISSING,
          refRaw: raw(r[field]),
        });
      }
    }
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
      if (c.ok) continue;
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
  const refWrong = new Set();
  for (const checks of Object.values(checksByArm)) {
    for (const c of checks) {
      const r = c.ok || c.armRaw === MISSING ? undefined : rulings[disagreementId(c)];
      if (r && r.refCorrect === false) refWrong.add(c.check);
    }
  }
  for (const [arm, checks] of Object.entries(checksByArm)) {
    const p = { total: 0, correct: 0, unruled: 0, byField: {}, errors: [] };
    for (const c of checks) {
      let ok = c.ok && !refWrong.has(c.check);
      if (!c.ok) {
        const r = c.armRaw === MISSING ? undefined : rulings[disagreementId(c)];
        if (r === undefined && c.armRaw !== MISSING) p.unruled++;
        ok = r ? r.armCorrect === true : false;
        if (r && r.refCorrect === false && !seenRefError.has(c.check)) {
          seenRefError.add(c.check);
          referenceErrors.push({ check: c.check, reference: c.refRaw, note: r.note || "" });
        }
      }
      p.total++;
      if (ok) p.correct++;
      const bf = (p.byField[`${c.collection}.${c.field}`] ??= { total: 0, correct: 0 });
      bf.total++;
      if (ok) bf.correct++;
      if (!ok) p.errors.push({ check: c.check, got: c.armRaw, expected: c.refRaw });
    }
    per[arm] = p;
  }
  return { per, referenceErrors };
}
