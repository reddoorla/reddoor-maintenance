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

const HEREDOC = /<<-?[ \t]*\\?(['"]?)(\w+)\1([^\n]*)\n([\s\S]*?)\n[ \t]*\2(?=\n|$)/g;
const SHELLS = new Set(["sh", "bash", "zsh", "dash"]);
const KEYWORDS = new Set(["do", "then", "else", "elif", "if", "while", "until", "!", "time"]);
const WRAPPERS = new Set(["sudo", "nohup", "stdbuf", "nice", "timeout", "xargs", "env"]);
const WRAPPER_VALUE_OPTIONS = {
  sudo: ["-u", "-g", "-C", "-h", "-p", "-r", "-t", "-U", "--user", "--group", "--host", "--prompt"],
  nohup: [],
  stdbuf: ["-i", "-o", "-e"],
  nice: ["-n", "--adjustment"],
  timeout: ["-s", "-k", "--signal", "--kill-after"],
  xargs: ["-n", "-I", "-L", "-P", "-d", "-s", "-E", "-a", "--max-args", "--replace", "--delimiter"],
  env: ["-u", "-C", "-S", "--unset", "--chdir", "--split-string"],
};
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
  "remote",
  "notes",
  "submodule",
]);
const CURL_VALUE_LETTERS = new Set([..."oHAuwebcrmKEUxYyzCDQtP"]);
const WRITE_METHODS = /^(POST|PUT|PATCH|DELETE)$/i;
const writeMethod = (m) => WRITE_METHODS.test(m) || m.includes("$");
const FIND_EXEC = new Set(["-exec", "-execdir", "-ok", "-okdir"]);
const RESOLVED = /\$\((?:which|command -v) +([\w./-]+)\)|`(?:which|command -v) +([\w./-]+)`/g;

export function heredocs(command) {
  const bodies = [];
  const text = command.replace(HEREDOC, (m, q, _word, _rest, body, offset, whole) => {
    const lineStart = whole.lastIndexOf("\n", offset - 1) + 1;
    const expands = q === "" && !m.slice(0, m.indexOf("\n")).includes("\\");
    bodies.push({
      opener: whole.slice(lineStart, offset) + m.slice(0, m.indexOf("\n")),
      body,
      expands,
    });
    return m.slice(0, m.indexOf("\n"));
  });
  return { text, bodies };
}

export function withoutHeredocs(command) {
  return heredocs(command).text;
}

export function substitutions(text, { heredoc = false } = {}) {
  const bodies = [];
  let quote = null;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (heredoc && (ch === "'" || ch === '"' || ch === "#")) continue;
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
    if (ch === "#" && quote === null && (i === 0 || /[\s;&|(]/.test(text[i - 1]))) {
      while (i + 1 < text.length && text[i + 1] !== "\n") i++;
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

const SEPARATORS = new Set(["\n", ";", "|", "&", "(", ")", "{", "}", "`"]);

export function lex(text) {
  const segs = [];
  let tokens = [];
  let cur = null;
  let between = "";
  const endToken = () => {
    if (cur !== null) tokens.push(cur);
    cur = null;
  };
  const endSegment = (sep = "$(") => {
    endToken();
    if (tokens.length) {
      Object.defineProperty(tokens, "piped", { value: /^\|&?$/.test(between) });
      segs.push(tokens);
      between = "";
    }
    tokens = [];
    if (segs.length) between += sep;
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "'") {
      const end = text.indexOf("'", i + 1);
      const stop = end === -1 ? text.length : end;
      cur = (cur ?? "") + text.slice(i + 1, stop);
      i = stop;
    } else if (ch === '"') {
      let j = i + 1;
      let value = "";
      while (j < text.length && text[j] !== '"') {
        if (text[j] === "\\" && j + 1 < text.length) {
          value += text[j + 1];
          j += 2;
        } else value += text[j++];
      }
      cur = (cur ?? "") + value;
      i = j;
    } else if (ch === "\\") {
      cur = (cur ?? "") + (text[i + 1] ?? "");
      i++;
    } else if (ch === "#" && cur === null) {
      while (i + 1 < text.length && text[i + 1] !== "\n") i++;
    } else if (ch === "$" && text[i + 1] === "(") {
      endSegment();
      i++;
    } else if (SEPARATORS.has(ch)) {
      endSegment(ch === "\n" ? "" : ch);
    } else if (/\s/.test(ch)) {
      endToken();
    } else {
      cur = (cur ?? "") + ch;
    }
  }
  endSegment();
  return segs;
}

export function segments(command) {
  return lex(withoutHeredocs(command));
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
        if (option === "-v" || option === "-V") return null;
        if (option === "-a") i++;
      }
      continue;
    }
    if (WRAPPERS.has(base)) {
      i++;
      while (i < tokens.length && (tokens[i].startsWith("-") || /^\d+[smhd]?$/.test(tokens[i]))) {
        const option = tokens[i++];
        const takesValue = WRAPPER_VALUE_OPTIONS[base].includes(option);
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
  const firstWord = (valueOptions = []) => {
    for (let k = 0; k < rest.length; k++) {
      if (valueOptions.includes(rest[k])) k++;
      else if (!rest[k].startsWith("-")) return rest[k];
    }
    return undefined;
  };
  if (["clean", "rm", "add"].includes(sub)) {
    const dryRun = rest.some((a) => shortCluster(a) && a.slice(1).split("e")[0].includes("n"));
    return !dryRun && !has("--dry-run");
  }
  if (sub === "tag")
    return (
      rest.some((a) => !a.startsWith("-")) &&
      !has(
        "-l",
        "--list",
        "--contains",
        "--no-contains",
        "--merged",
        "--no-merged",
        "--sort",
        "--points-at",
        "-v",
        "--verify",
      ) &&
      !rest.some((a) => /^-n\d*$/.test(a))
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
      (!has(
        "-l",
        "--list",
        "-a",
        "--all",
        "-r",
        "--remotes",
        "--contains",
        "--no-contains",
        "--merged",
        "--no-merged",
        "--points-at",
        "--show-current",
        "--sort",
        "--format",
      ) &&
        rest.some((a) => !a.startsWith("-")))
    );
  if (sub === "config") {
    if (
      has(
        "--unset",
        "--unset-all",
        "--add",
        "--replace-all",
        "--remove-section",
        "--rename-section",
        "--edit",
        "-e",
      )
    )
      return true;
    if (has("--get", "--get-all", "--get-regexp", "--get-urlmatch", "-l", "--list")) return false;
    const valueOptions = ["-f", "--file", "--blob", "--type", "--default", "--comment"];
    const words = [];
    for (let k = 0; k < rest.length; k++) {
      if (valueOptions.includes(rest[k])) k++;
      else if (!rest[k].startsWith("-")) words.push(rest[k]);
    }
    if (["get", "list"].includes(words[0])) return false;
    return (
      ["set", "unset", "rename-section", "remove-section", "edit"].includes(words[0]) ||
      words.length >= 2
    );
  }
  if (sub === "worktree") return rest[0] !== "list";
  if (sub === "remote") {
    const op = firstWord();
    return op !== undefined && !["show", "get-url"].includes(op);
  }
  if (sub === "notes") {
    const op = firstWord(["--ref"]);
    return op !== undefined && !["list", "show", "get-ref"].includes(op);
  }
  if (sub === "submodule") {
    const op = firstWord();
    return op !== undefined && !["status", "summary"].includes(op);
  }
  return true;
}

function shortCluster(a) {
  return a.startsWith("-") && !a.startsWith("--") && /^-[A-Za-z]/.test(a);
}

function curlGet(args) {
  return args.some((a) => {
    if (a === "--get") return true;
    if (!shortCluster(a)) return false;
    for (const letter of a.slice(1)) {
      if (letter === "G") return true;
      if (letter === "X" || CURL_VALUE_LETTERS.has(letter)) return false;
    }
    return false;
  });
}

function curlWrites(args) {
  const get = curlGet(args);
  for (let k = 0; k < args.length; k++) {
    const a = args[k];
    if (a === "--request") {
      if (writeMethod(args[k + 1] || "")) return true;
      k++;
      continue;
    }
    if (a.startsWith("--request=")) {
      if (writeMethod(a.slice(10))) return true;
      continue;
    }
    if (/^--(form|upload-file|json)(=|$)/.test(a)) return true;
    if (/^--data[\w-]*(=|$)/.test(a)) {
      if (!get) return true;
      continue;
    }
    if (!shortCluster(a)) continue;
    for (let p = 1; p < a.length; p++) {
      const letter = a[p];
      if (letter === "X") {
        const method = a.slice(p + 1) || args[++k] || "";
        if (writeMethod(method)) return true;
        break;
      }
      if (letter === "F" || letter === "T") return true;
      if (letter === "d") {
        if (!get) return true;
        if (p === a.length - 1) k++;
        break;
      }
      if (CURL_VALUE_LETTERS.has(letter)) {
        if (p === a.length - 1) k++;
        break;
      }
    }
  }
  return false;
}

function wgetWrites(args) {
  return args.some(
    (a, k) =>
      /^--(post-data|post-file|body-data|body-file)(=|$)/.test(a) ||
      (a === "--method" && writeMethod(args[k + 1] || "")) ||
      (a.startsWith("--method=") && writeMethod(a.slice(9))),
  );
}

function findExecs(args) {
  const groups = [];
  for (let k = 0; k < args.length; k++) {
    if (!FIND_EXEC.has(args[k])) continue;
    const start = k + 1;
    while (k + 1 < args.length && args[k + 1] !== ";" && args[k + 1] !== "+") k++;
    groups.push(args.slice(start, k + 1));
  }
  return groups;
}

function readsStdin(args) {
  for (let k = 0; k < args.length; k++) {
    if (args[k] === "-s" || args[k] === "--") return true;
    if (!args[k].startsWith("-")) return false;
    if (args[k] === "-o" || args[k] === "+o") k++;
  }
  return true;
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

function segmentForbidden(tokens, previous, depth) {
  const c = commandOf(tokens);
  if (!c) return false;
  if (c.name === "gh") return true;
  if (c.name === "git" && gitWrites(c.args)) return true;
  if (c.name === "curl" && curlWrites(c.args)) return true;
  if (c.name === "wget" && wgetWrites(c.args)) return true;
  if (c.name === "eval" && forbiddenCommand(c.args.join(" "), depth + 1)) return true;
  if (c.name === "find" && depth < 4) {
    if (findExecs(c.args).some((g) => segmentForbidden(g, null, depth + 1))) return true;
  }
  if (SHELLS.has(c.name)) {
    const body = shellBody(c.args);
    if (body && forbiddenCommand(body, depth + 1)) return true;
    const herestring = c.args.indexOf("<<<");
    if (herestring !== -1 && forbiddenCommand(c.args[herestring + 1] || "", depth + 1)) return true;
    if (!body && tokens.piped && previous && readsStdin(c.args)) {
      const feeder = commandOf(previous);
      if (feeder && ["echo", "printf"].includes(feeder.name)) {
        const fed = feeder.args.filter((a) => !/^-[neE]+$/.test(a)).join(" ");
        if (forbiddenCommand(fed.replace(/\\n/g, "\n"), depth + 1)) return true;
      }
    }
  }
  return false;
}

export function forbiddenCommand(command, depth = 0) {
  if (depth > 4) return false;
  const { text, bodies } = heredocs(command.replace(RESOLVED, (_m, a, b) => a ?? b));
  let previous = null;
  for (const tokens of lex(text)) {
    if (segmentForbidden(tokens, previous, depth)) return true;
    previous = tokens;
  }
  for (const body of substitutions(text)) {
    if (forbiddenCommand(body, depth + 1)) return true;
  }
  for (const { opener, body, expands } of bodies) {
    if (expands) {
      for (const sub of substitutions(body, { heredoc: true })) {
        if (forbiddenCommand(sub, depth + 1)) return true;
      }
    }
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
