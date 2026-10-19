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

const NUMBER = /^-?\d+(\.\d+)?$/;

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

export function scoreRun(spec, reference, output) {
  const custom = spec.kinds || {};
  const checks = [];
  for (const col of spec.collections) {
    const items = (src) => (src && Array.isArray(src[col.name]) ? src[col.name] : []);
    const keyOf = (x) =>
      normalise(x && typeof x === "object" ? x[col.key] : undefined, col.keyKind, custom);
    const ref = new Map(items(reference).map((x) => [keyOf(x), x]));
    const out = new Map();
    const duplicates = [];
    const extras = [];
    for (const x of items(output)) {
      const k = keyOf(x);
      if (out.has(k)) duplicates.push(raw(x && x[col.key]));
      else out.set(k, x);
      if (!ref.has(k)) extras.push(raw(x && x[col.key]));
    }
    for (const [k, r] of ref) {
      const o = out.get(k);
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
    const extraKey = JSON.stringify([...new Set([...extras, ...duplicates])].sort());
    checks.push({
      collection: col.name,
      key: "(set)",
      field: "(no extra or duplicate items)",
      check: `${col.name} / no extra or duplicate items`,
      ok: extras.length === 0 && duplicates.length === 0,
      armKey: extraKey,
      refKey: "[]",
      armRaw: extras.length || duplicates.length ? JSON.stringify({ extras, duplicates }) : "[]",
      refRaw: "[]",
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
      if (c.ok || c.armRaw === MISSING) continue;
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
  const refWrong = new Map();
  for (const checks of Object.values(checksByArm)) {
    for (const c of checks) {
      const r = c.ok || c.armRaw === MISSING ? undefined : rulings[disagreementId(c)];
      if (r && r.refCorrect === false) refWrong.set(c.check, r);
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
  return { per, referenceErrors };
}
