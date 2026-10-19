export const PRICE_SOURCE =
  "claude-api skill price list (cached 2026-10-06), confirmed 2026-10-19; $ per million tokens";

export const PRICES = Object.freeze({
  "claude-opus-5-5": { in: 4, out: 20, cr: 0.2, cw5m: 5, cw1h: 8 },
  "claude-sonnet-5-5": { in: 2, out: 10, cr: 0.2, cw5m: 2.5, cw1h: 4 },
  "claude-haiku-5-5": {
    in: 0.1,
    out: 0.5,
    cr: 0.01,
    cw5m: 0.125,
    cw1h: 0.2,
    long: { above: 100000, in: 0.5, out: 2.5, cr: 0.05, cw5m: 0.625, cw1h: 1 },
  },
  "claude-fable-5-1": { in: 10, out: 50, cr: 0.25, cw5m: 12.5, cw1h: 20 },
});

export function* splitLines(text) {
  let start = 0;
  let idx;
  while ((idx = text.indexOf("\n", start)) !== -1) {
    yield text.slice(start, idx);
    start = idx + 1;
  }
  if (start < text.length) yield text.slice(start);
}

function usageOf(u) {
  const cw = u.cache_creation_input_tokens || 0;
  const split = u.cache_creation;
  const has = split && typeof split === "object";
  const cw1h = has ? split.ephemeral_1h_input_tokens || 0 : 0;
  const cw5m = has ? split.ephemeral_5m_input_tokens || 0 : cw;
  return {
    in: u.input_tokens || 0,
    out: u.output_tokens || 0,
    cr: u.cache_read_input_tokens || 0,
    cw,
    cw5m,
    cw1h,
    ttlUnknown: !has && cw > 0,
  };
}

export function usageRecords(lines) {
  const byId = new Map();
  const diag = { usageLines: 0, repeats: 0, parseErrors: 0, noId: 0 };
  for (const line of lines) {
    if (!line.includes('"usage"')) continue;
    let o;
    try {
      o = JSON.parse(line);
    } catch {
      diag.parseErrors++;
      continue;
    }
    const m = o && o.message;
    if (!m || m.role !== "assistant" || !m.usage) continue;
    diag.usageLines++;
    if (!m.id) {
      diag.noId++;
      continue;
    }
    if (byId.has(m.id)) diag.repeats++;
    byId.set(m.id, {
      id: m.id,
      model: m.model || "(none)",
      effort: o.effort || "(unset)",
      timestamp: o.timestamp,
      usage: usageOf(m.usage),
    });
  }
  return { records: [...byId.values()], diag };
}

export function priceRequest(model, u) {
  const card = PRICES[model];
  if (!card) return { cost: null, longPrompt: false };
  const prompt = u.in + u.cr + u.cw;
  const longPrompt = Boolean(card.long && prompt > card.long.above);
  const p = longPrompt ? card.long : card;
  const cost =
    (u.in * p.in + u.out * p.out + u.cr * p.cr + u.cw5m * p.cw5m + u.cw1h * p.cw1h) / 1e6;
  return { cost, longPrompt };
}

const newRow = (model, effort) => ({
  model,
  effort,
  requests: 0,
  input: 0,
  cacheRead: 0,
  cacheWrite5m: 0,
  cacheWrite1h: 0,
  output: 0,
  cost: 0,
  priced: true,
  longPrompt: 0,
  ttlUnknown: 0,
});

export function summarise(records) {
  const rows = new Map();
  const total = newRow("(all)", "(all)");
  for (const r of records) {
    const key = `${r.model}\u0000${r.effort}`;
    if (!rows.has(key)) rows.set(key, newRow(r.model, r.effort));
    const { cost, longPrompt } = priceRequest(r.model, r.usage);
    for (const row of [rows.get(key), total]) {
      row.requests++;
      row.input += r.usage.in;
      row.cacheRead += r.usage.cr;
      row.cacheWrite5m += r.usage.cw5m;
      row.cacheWrite1h += r.usage.cw1h;
      row.output += r.usage.out;
      if (r.usage.ttlUnknown) row.ttlUnknown++;
      if (longPrompt) row.longPrompt++;
      if (cost === null) row.priced = false;
      else row.cost += cost;
    }
  }
  const sorted = [...rows.values()].sort((a, b) => b.requests - a.requests);
  return { rows: sorted, total };
}

const M = (n) => `${(n / 1e6).toFixed(2)}M`;
const usd = (n) => `$${n.toFixed(2)}`;

export function formatTable(summary) {
  const out = [
    "| model | effort | requests | input | cache read | cache write 5m / 1h | output | long-prompt requests | est. cost |",
    "|---|---|---|---|---|---|---|---|---|",
  ];
  for (const r of summary.rows) {
    out.push(
      `| ${r.model} | ${r.effort} | ${r.requests} | ${M(r.input)} | ${M(r.cacheRead)} | ${M(r.cacheWrite5m)} / ${M(r.cacheWrite1h)} | ${M(r.output)} | ${r.longPrompt} | ${r.priced ? usd(r.cost) : "unpriced"} |`,
    );
  }
  const t = summary.total;
  out.push(
    `| **total** | | ${t.requests} | ${M(t.input)} | ${M(t.cacheRead)} | ${M(t.cacheWrite5m)} / ${M(t.cacheWrite1h)} | ${M(t.output)} | ${t.longPrompt} | ${usd(t.cost)}${t.priced ? "" : " (priced rows only)"} |`,
  );
  return out.join("\n");
}
