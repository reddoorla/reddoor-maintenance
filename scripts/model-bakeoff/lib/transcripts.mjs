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

const NESTED =
  /(?:^|[;&|(\n]\s*|\b(?:then|do|else)\s+)(?:(?:ba|z|da)?sh(?:\s+(?:[-+][a-z]*o\s+\S+|--?[\w-]+))*?\s+-[a-z]*c[a-z]*(?:\s+--)?|eval)\s+(['"])((?:\\.|(?!\1)[\s\S])*)\1/g;

const HEREDOC = /<<-?[ \t]*\\?(['"]?)(\w+)\1([^\n]*)\n([\s\S]*?)\n[ \t]*\2(?=\n|$)/g;
const SEPARATORS = /\n|;|&&|\|\||\||&|\$\(|`|\(|\)|\{|\}/;
const SHELLS = new Set(["sh", "bash", "zsh", "dash"]);
const KEYWORDS = new Set(["do", "then", "else", "elif", "if", "while", "until", "!", "time"]);
const WRAPPERS = new Set(["sudo", "nohup", "stdbuf", "nice", "timeout", "xargs", "env"]);
const WRAPPER_VALUE_OPTIONS = new Set([
  "--user",
  "--group",
  "--chdir",
  "--unset",
  "--signal",
  "--kill-after",
  "--adjustment",
  "--max-args",
  "--replace",
  "--delimiter",
]);
const PREFIXES = new Set(["command", "exec", "builtin"]);
const LOOKUPS = new Set(["which", "type", "hash", "whereis"]);
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
  "pull",
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
  "branch",
  "init",
  "update-ref",
  "config",
  "worktree",
]);
const CURL_VALUE_LETTERS = new Set([..."oHAuwebcrmKEUxYyzCDQtP"]);
const WRITE_METHODS = /^(POST|PUT|PATCH|DELETE)$/i;

export function unquoted(command) {
  return command.replace(/'[^']*'|"(?:\\.|[^"\\])*"/g, (q) =>
    /^(["'])[\w./@:=+-]+\1$/.test(q) ? q.slice(1, -1) : "''",
  );
}

export function heredocs(command) {
  const bodies = [];
  const text = command.replace(HEREDOC, (m, _q, _word, _rest, body, offset, whole) => {
    const lineStart = whole.lastIndexOf("\n", offset - 1) + 1;
    bodies.push({ opener: whole.slice(lineStart, offset) + m.slice(0, m.indexOf("\n")), body });
    return m.slice(0, m.indexOf("\n"));
  });
  return { text, bodies };
}

export function withoutHeredocs(command) {
  return heredocs(command).text;
}

export function substitutions(text) {
  const bodies = [];
  let quote = null;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote === "'") {
      if (ch === "'") quote = null;
      continue;
    }
    if (ch === "\\") {
      i++;
      continue;
    }
    if (ch === "'" && quote === null) {
      quote = "'";
      continue;
    }
    if (ch === '"') {
      quote = quote === '"' ? null : '"';
      continue;
    }
    if (ch === "`") {
      const end = text.indexOf("`", i + 1);
      if (end === -1) break;
      bodies.push(text.slice(i + 1, end));
      i = end;
      continue;
    }
    if (ch === "$" && text[i + 1] === "(") {
      let depth = 0;
      let j = i + 1;
      for (; j < text.length; j++) {
        if (text[j] === "(") depth++;
        else if (text[j] === ")" && --depth === 0) break;
      }
      bodies.push(text.slice(i + 2, j));
      i = j;
    }
  }
  return bodies;
}

export function segments(command) {
  return unquoted(withoutHeredocs(command))
    .split(SEPARATORS)
    .map((s) => s.trim().split(/\s+/).filter(Boolean))
    .filter((t) => t.length > 0);
}

const isRedirect = (t) => /^\d*(<<?|>>?|&>|>&|<&)/.test(t);

export function commandOf(tokens) {
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i];
    if (isRedirect(t)) {
      i += /^\d*(<<?|>>?|&>|>&|<&)$/.test(t) ? 2 : 1;
      continue;
    }
    const base = t
      .replace(/[<>].*$/, "")
      .split("/")
      .pop();
    if (KEYWORDS.has(t) || /^\w+=/.test(t)) {
      i++;
      continue;
    }
    if (PREFIXES.has(base)) {
      i++;
      while (i < tokens.length && tokens[i].startsWith("-")) {
        const option = tokens[i++];
        if (option === "-v" || option === "-V") return { name: "which", args: tokens.slice(i) };
        if (option === "-a") i++;
      }
      continue;
    }
    if (WRAPPERS.has(base)) {
      i++;
      while (i < tokens.length && (tokens[i].startsWith("-") || /^\d+[smhd]?$/.test(tokens[i]))) {
        const option = tokens[i++];
        const takesValue = /^-[A-Za-z]$/.test(option) || WRAPPER_VALUE_OPTIONS.has(option);
        if (takesValue && i < tokens.length && !tokens[i].startsWith("-")) i++;
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
  const sub = args[j];
  const rest = args.slice(j + 1);
  if (!GIT_WRITES.has(sub) || rest.includes("--help") || rest.includes("-h")) return false;
  const has = (...opts) => rest.some((a) => opts.some((o) => a === o || a.startsWith(`${o}=`)));
  if (sub === "tag")
    return (
      rest.some((a) => !a.startsWith("-")) &&
      !has("-l", "--list", "--contains", "--sort", "--points-at")
    );
  if (sub === "stash") return !["list", "show"].includes(rest[0]);
  if (sub === "apply") return !has("--stat", "--numstat", "--summary", "--check");
  if (sub === "branch")
    return (
      has(
        "-d",
        "-D",
        "-m",
        "-M",
        "-c",
        "-C",
        "-f",
        "--delete",
        "--move",
        "--copy",
        "--force",
        "--set-upstream-to",
        "-u",
      ) ||
      (rest.length > 0 && !rest[0].startsWith("-"))
    );
  if (sub === "config")
    return (
      !has("--get", "--get-all", "--get-regexp", "-l", "--list") &&
      rest.filter((a) => !a.startsWith("-")).length >= 2
    );
  if (sub === "worktree") return rest[0] !== "list";
  return true;
}

function curlWrites(args) {
  if (args.some((a) => a === "-G" || a === "--get")) return false;
  for (let k = 0; k < args.length; k++) {
    const a = args[k];
    if (a === "--request") {
      if (WRITE_METHODS.test(args[k + 1] || "")) return true;
      k++;
      continue;
    }
    if (a.startsWith("--request=")) {
      if (WRITE_METHODS.test(a.slice(10))) return true;
      continue;
    }
    if (/^--(data[\w-]*|form|upload-file|json)(=|$)/.test(a)) return true;
    if (a.startsWith("--") || !/^-[A-Za-z]/.test(a)) continue;
    for (let p = 1; p < a.length; p++) {
      const letter = a[p];
      if (letter === "X") {
        const method = a.slice(p + 1) || args[++k] || "";
        if (WRITE_METHODS.test(method)) return true;
        break;
      }
      if (letter === "d" || letter === "F" || letter === "T") return true;
      if (CURL_VALUE_LETTERS.has(letter)) {
        if (p === a.length - 1) k++;
        break;
      }
    }
  }
  return false;
}

function shellBody(args) {
  for (let k = 0; k < args.length; k++) {
    if (/^-[a-z]*c[a-z]*$/.test(args[k])) {
      const next = args[k + 1] === "--" ? args[k + 2] : args[k + 1];
      return next || null;
    }
  }
  return null;
}

export function forbiddenCommand(command, depth = 0) {
  if (depth > 4) return false;
  const { text, bodies } = heredocs(command);
  for (const tokens of segments(text)) {
    const c = commandOf(tokens);
    if (!c) continue;
    if (c.name === "gh") return true;
    if (LOOKUPS.has(c.name) && c.args.includes("gh")) return true;
    if (c.name === "git" && gitWrites(c.args)) return true;
    if (c.name === "curl" && curlWrites(c.args)) return true;
    if (SHELLS.has(c.name)) {
      const body = shellBody(c.args);
      if (body && body !== "''" && forbiddenCommand(body, depth + 1)) return true;
    }
  }
  for (const body of substitutions(text)) {
    if (forbiddenCommand(body, depth + 1)) return true;
  }
  for (const m of text.matchAll(NESTED)) {
    if (forbiddenCommand(m[2], depth + 1)) return true;
  }
  for (const { opener, body } of bodies) {
    const feeds = segments(opener).some((t) => {
      const c = commandOf(t);
      return c && (SHELLS.has(c.name) || c.name === "eval");
    });
    if (feeds && forbiddenCommand(body, depth + 1)) return true;
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
