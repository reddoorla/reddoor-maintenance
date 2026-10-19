import { splitLines, usageRecords, priceRequest } from "./ledger.mjs";

const MARKER = /\(BAKEOFF-(ARM|REFEREE): ([a-z0-9][a-z0-9-]*)\)\s*$/;
const ANY_MARKER = /\(BAKEOFF-(?:ARM|REFEREE): [a-z0-9][a-z0-9-]*\)/g;
const WRITE_TOOLS = new Set(["Write", "Edit", "NotebookEdit"]);

export const FORBIDDEN = Object.freeze([
  /(^|[;&|(`]|\$\()\s*(sudo\s+)?(env\s+)?(\w+=\S*\s+)*(\S*\/)?gh(\s|$)/,
  /\bwhich\s+gh\b/,
  /\bgit\b(\s+(-[cC]\s+\S+|--?[\w-]+(=\S+)?))*\s+(push|commit|tag|reset|checkout|switch|stash|rm|add|mv|merge|rebase|clean|restore|apply|am|cherry-pick|revert)\b/,
  /\bcurl\b.*(\s-X\s*(POST|PUT|PATCH|DELETE)\b|\s--request(\s+|=)(POST|PUT|PATCH|DELETE)\b|\s(-d|-F|--data[\w-]*|--form|--upload-file|-T)(\s|=))/i,
]);

export function unquoted(command) {
  return command.replace(/'[^']*'|"(?:\\.|[^"\\])*"/g, (q) =>
    /^["']gh["']$/.test(q) ? "gh" : "''",
  );
}

export function forbiddenCommand(command) {
  const plain = unquoted(command);
  return FORBIDDEN.some((re) => re.test(plain));
}

function textOf(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((b) => (b && b.type === "text" ? b.text : "")).join("\n");
}

export function readAgentTranscript(text) {
  const lines = [...splitLines(text)];
  let marker = null;
  let markerError = null;
  let sawUser = false;
  const outputs = [];
  const failed = new Set();
  const bash = [];
  const writes = [];
  const mcp = [];
  for (const line of lines) {
    let o;
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    const m = o && o.message;
    if (!m) continue;
    if (!sawUser && m.role === "user") {
      sawUser = true;
      const t = textOf(m.content);
      const hit = MARKER.exec(t);
      const count = (t.match(ANY_MARKER) || []).length;
      if (hit && count === 1) marker = { kind: hit[1] === "ARM" ? "arm" : "referee", id: hit[2] };
      else if (count > 0)
        markerError = `the first prompt holds ${count} markers and does not end with exactly one`;
    }
    if (m.role === "assistant" && Array.isArray(m.content)) {
      for (const b of m.content) {
        if (!b || b.type !== "tool_use") continue;
        if (b.name === "StructuredOutput") outputs.push(b);
        if (b.name === "Bash" && b.input && typeof b.input.command === "string") {
          bash.push(b.input.command);
        }
        if (WRITE_TOOLS.has(b.name) && b.input) {
          writes.push(String(b.input.file_path ?? b.input.notebook_path ?? ""));
        }
        if (typeof b.name === "string" && b.name.startsWith("mcp__")) mcp.push(b.name);
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
    markerError,
    structured,
    models: [...new Set(records.map((r) => r.model))].sort(),
    efforts: [...new Set(records.map((r) => r.effort))].sort(),
    requests: records.length,
    repeats: diag.repeats,
    cost: priced ? cost : null,
    longPrompt,
    bash,
    writes,
    mcp,
    forbidden: bash.filter(forbiddenCommand),
  };
}
