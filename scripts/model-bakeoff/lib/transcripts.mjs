import { splitLines, usageRecords, priceRequest } from "./ledger.mjs";

const MARKER = /\(BAKEOFF-(ARM|REFEREE): ([a-z0-9][a-z0-9-]*)\)\s*$/;
const ANY_MARKER = /\(BAKEOFF-(?:ARM|REFEREE): [a-z0-9][a-z0-9-]*\)/g;
const WRITE_TOOLS = new Set(["Write", "Edit", "NotebookEdit"]);
export const ALLOWED_TOOLS = Object.freeze([
  "Read",
  "Bash",
  "Glob",
  "Grep",
  "Write",
  "Edit",
  "NotebookEdit",
  "StructuredOutput",
  "ToolSearch",
]);

const NESTED = /\b(?:(?:ba|z|da)?sh\s+-[a-z]*c|eval)\s+(['"])((?:\\.|(?!\1)[\s\S])*)\1/g;
const HEREDOC = /<<-?[ \t]*(['"]?)(\w+)\1[^\n]*\n[\s\S]*?\n[ \t]*\2(?=\n|$)/g;
const SEPARATORS = /\n|;|&&|\|\||\||&|\$\(|`|\(|\)|\{|\}/;
const KEYWORDS = new Set(["do", "then", "else", "elif", "if", "while", "until", "!", "time"]);
const WRAPPERS = new Set(["sudo", "nohup", "stdbuf", "nice", "timeout", "xargs", "env"]);
const PREFIXES = new Set(["command", "exec", "builtin"]);
const GIT_VALUE_OPTIONS = new Set([
  "-C",
  "-c",
  "--git-dir",
  "--work-tree",
  "--namespace",
  "--exec-path",
  "--config-env",
]);
const GIT_WRITES = new Set([
  "push",
  "commit",
  "tag",
  "reset",
  "checkout",
  "switch",
  "stash",
  "rm",
  "add",
  "mv",
  "merge",
  "rebase",
  "clean",
  "restore",
  "apply",
  "am",
  "cherry-pick",
  "revert",
]);
const WRITE_METHODS = /^(POST|PUT|PATCH|DELETE)$/;

export function unquoted(command) {
  return command.replace(/'[^']*'|"(?:\\.|[^"\\])*"/g, (q) =>
    /^(["'])[\w./@:=+-]+\1$/.test(q) ? q.slice(1, -1) : "''",
  );
}

export function withoutHeredocs(command) {
  return command.replace(HEREDOC, (m) => m.slice(0, m.indexOf("\n")));
}

export function segments(command) {
  return unquoted(withoutHeredocs(command))
    .split(SEPARATORS)
    .map((s) => s.trim().split(/\s+/).filter(Boolean))
    .filter((t) => t.length > 0);
}

export function commandOf(tokens) {
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i];
    const base = t.split("/").pop();
    if (KEYWORDS.has(t) || /^\w+=/.test(t) || PREFIXES.has(base)) {
      i++;
      continue;
    }
    if (WRAPPERS.has(base)) {
      i++;
      while (i < tokens.length && (tokens[i].startsWith("-") || /^\d+[smhd]?$/.test(tokens[i]))) {
        const option = tokens[i++];
        if (/^-[A-Za-z]$/.test(option) && i < tokens.length && !tokens[i].startsWith("-")) i++;
      }
      continue;
    }
    return { name: base, args: tokens.slice(i + 1) };
  }
  return null;
}

function gitWrites(args) {
  let j = 0;
  while (j < args.length && args[j].startsWith("-")) j += GIT_VALUE_OPTIONS.has(args[j]) ? 2 : 1;
  return GIT_WRITES.has(args[j]);
}

function curlWrites(args) {
  return args.some((a, k) => {
    if (a === "-X" || a === "--request") return WRITE_METHODS.test(args[k + 1] || "");
    if (a.startsWith("--request=")) return WRITE_METHODS.test(a.slice(10));
    if (/^--(data[\w-]*|form|upload-file|json)(=|$)/.test(a)) return true;
    if (/^-X/.test(a)) return WRITE_METHODS.test(a.slice(2));
    return /^-[A-Za-z]/.test(a) && !a.startsWith("--") && /[dFT]/.test(a.match(/^-[A-Za-z]+/)[0]);
  });
}

export function forbiddenCommand(command, depth = 0) {
  for (const tokens of segments(command)) {
    const c = commandOf(tokens);
    if (!c) continue;
    if (c.name === "gh") return true;
    if (c.name === "which" && c.args.includes("gh")) return true;
    if (c.name === "git" && gitWrites(c.args)) return true;
    if (c.name === "curl" && curlWrites(c.args)) return true;
  }
  if (depth > 3) return false;
  for (const m of withoutHeredocs(command).matchAll(NESTED)) {
    if (forbiddenCommand(m[2], depth + 1)) return true;
  }
  return false;
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
  const otherTools = [];
  let prompt = "";
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
      prompt = t;
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
        if (!ALLOWED_TOOLS.includes(b.name)) otherTools.push(String(b.name));
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
    otherTools,
    prompt,
    forbidden: bash.filter((c) => forbiddenCommand(c)),
  };
}
