import { splitLines, usageRecords, priceRequest } from "./ledger.mjs";

const MARKER = /BAKEOFF-(ARM|REFEREE): ([a-z0-9][a-z0-9-]*)/;

export const FORBIDDEN = Object.freeze([
  /(^|[\s;&|(])gh\s/,
  /\bgit\s+(push|commit|tag|reset|checkout|stash)\b/,
  /\bcurl\b[^\n]*\s-X\s*(POST|PUT|PATCH|DELETE)\b/i,
]);

function textOf(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((b) => (b && b.type === "text" ? b.text : "")).join("\n");
}

export function readAgentTranscript(text) {
  const lines = [...splitLines(text)];
  let marker = null;
  const outputs = [];
  const failed = new Set();
  const bash = [];
  for (const line of lines) {
    let o;
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    const m = o && o.message;
    if (!m) continue;
    if (!marker && m.role === "user") {
      const hit = MARKER.exec(textOf(m.content));
      if (hit) marker = { kind: hit[1] === "ARM" ? "arm" : "referee", id: hit[2] };
    }
    if (m.role === "assistant" && Array.isArray(m.content)) {
      for (const b of m.content) {
        if (!b || b.type !== "tool_use") continue;
        if (b.name === "StructuredOutput") outputs.push(b);
        if (b.name === "Bash" && b.input && typeof b.input.command === "string") {
          bash.push(b.input.command);
        }
      }
    }
    if (m.role === "user" && Array.isArray(m.content)) {
      for (const b of m.content) {
        if (b && b.type === "tool_result" && b.is_error) failed.add(b.tool_use_id);
      }
    }
  }
  const accepted = outputs.filter((b) => !failed.has(b.id));
  const structured = accepted.length ? accepted[accepted.length - 1].input : null;
  const { records, diag } = usageRecords(lines);
  let cost = 0;
  let priced = true;
  let longPrompt = 0;
  for (const r of records) {
    const p = priceRequest(r.model, r.usage);
    if (p.cost === null) priced = false;
    else cost += p.cost;
    if (p.longPrompt) longPrompt++;
  }
  return {
    marker,
    structured,
    models: [...new Set(records.map((r) => r.model))].sort(),
    efforts: [...new Set(records.map((r) => r.effort))].sort(),
    requests: records.length,
    repeats: diag.repeats,
    cost: priced ? cost : null,
    longPrompt,
    bash,
    forbidden: bash.filter((c) => FORBIDDEN.some((re) => re.test(c))),
  };
}
