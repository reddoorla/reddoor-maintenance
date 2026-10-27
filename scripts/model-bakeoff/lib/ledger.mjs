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
  const split5m = has ? split.ephemeral_5m_input_tokens || 0 : 0;
  const unsplit = Math.max(0, cw - cw1h - split5m);
  return {
    in: u.input_tokens || 0,
    out: u.output_tokens || 0,
    cr: u.cache_read_input_tokens || 0,
    cw,
    cw5m: split5m + unsplit,
    cw1h,
    ttlUnknown: unsplit > 0,
  };
}

export function mergeRecords(lists) {
  const byId = new Map();
  let crossFileRepeats = 0;
  for (const list of lists) {
    for (const r of list) {
      if (byId.has(r.id)) crossFileRepeats++;
      // The later file's copy wins, unless it is unfinished and an earlier one is not (#1435).
      if (r.unfinished && byId.get(r.id)?.unfinished === false) continue;
      byId.set(r.id, r);
    }
  }
  return { records: [...byId.values()], crossFileRepeats };
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
    const unfinished = m.stop_reason == null;
    // A stream-start line after the final one would only lose the final usage.
    if (unfinished && byId.get(m.id)?.unfinished === false) continue;
    byId.set(m.id, {
      id: m.id,
      model: m.model || "(none)",
      effort: o.effort || "(unset)",
      timestamp: o.timestamp,
      usage: usageOf(m.usage),
      // Claude Code writes a request's usage from the start of its stream and updates it only
      // when the stream ends with a stop_reason. A request with no line that has one keeps its
      // stream-start output count (4 to 16 tokens), so its cost is a floor (#1435).
      unfinished,
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
  unfinished: 0,
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
      if (r.unfinished) row.unfinished++;
      if (longPrompt) row.longPrompt++;
      if (cost === null) row.priced = false;
      else row.cost += cost;
    }
  }
  const sorted = [...rows.values()].sort((a, b) => b.requests - a.requests);
  return { rows: sorted, total };
}

const M = (n) => `${(n / 1e6).toFixed(2)}M`;

/**
 * A cost as printed: `unpriced`, an exact `$x`, or `≥$x (n of m unfinished)` when some of its
 * requests never got a final usage line, which makes the figure a lower bound (#1435). A record
 * collected before the count existed (`unfinished` undefined) prints as it always did.
 */
export function formatCost(cost, unfinished, requests, digits = 2) {
  if (cost === null) return "unpriced";
  const usd = `$${cost.toFixed(digits)}`;
  return unfinished ? `≥${usd} (${unfinished} of ${requests} unfinished)` : usd;
}

/** The note a table with a lower-bound cost prints under it. */
export const LOWER_BOUND_NOTE =
  "≥: a lower bound. An unfinished request's transcript keeps only its stream-start usage (stop_reason null), so its output tokens, thinking included, are undercounted (#1435).";

export function formatTable(summary) {
  const out = [
    "| model | effort | requests | input | cache read | cache write 5m / 1h | output | long-prompt requests | est. cost |",
    "|---|---|---|---|---|---|---|---|---|",
  ];
  for (const r of summary.rows) {
    out.push(
      `| ${r.model} | ${r.effort} | ${r.requests} | ${M(r.input)} | ${M(r.cacheRead)} | ${M(r.cacheWrite5m)} / ${M(r.cacheWrite1h)} | ${M(r.output)} | ${r.longPrompt} | ${formatCost(r.priced ? r.cost : null, r.unfinished, r.requests)} |`,
    );
  }
  const t = summary.total;
  // A total over priced rows only counts only their unfinished requests.
  const priced = t.priced ? [t] : summary.rows.filter((r) => r.priced);
  const unfinished = priced.reduce((n, r) => n + r.unfinished, 0);
  const requests = priced.reduce((n, r) => n + r.requests, 0);
  out.push(
    `| **total** | | ${t.requests} | ${M(t.input)} | ${M(t.cacheRead)} | ${M(t.cacheWrite5m)} / ${M(t.cacheWrite1h)} | ${M(t.output)} | ${t.longPrompt} | ${formatCost(t.cost, unfinished, requests)}${t.priced ? "" : " (priced rows only)"} |`,
  );
  return out.join("\n");
}
