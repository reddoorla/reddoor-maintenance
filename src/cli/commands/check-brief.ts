import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

/**
 * `reddoor-maint check-brief <brief.md> [--cwd <dir>]` (P1-33 next-7, #1598).
 *
 * At least 15 journal entries record a brief or dispatch fact that was wrong: a
 * free-text name, absence or position nobody re-measured, several of which
 * reached the operator (williamson-homes#3; #1012 and #1020 calling Discord,
 * Figma and MarkUp unreachable). This reads a brief's "Verify first" section,
 * where each claim is one line in one of two forms:
 *
 *   - <claim> — `<command>` → exit <n>[, prints "<text>"] [laptop]
 *   - <claim> [I]
 *
 * and runs each command, so the worker learns which facts hold before building
 * on them. An absence claim is followed by a line whose claim starts
 * "Control:", the positive control that shows the same command can say yes;
 * the absence line passes only when its control passes too.
 *
 * Only an allowlist of read-only command forms runs, through `execFile` with no
 * shell, no stdin and a minimal environment. Each line gets PASS, FAIL, COULD
 * NOT RUN (allowed, but the environment stopped it: a missing binary, a
 * timeout, an HTTP refusal, a control that did not pass) or NOT RUN (an [I] or
 * [laptop] line, or a command off the allowlist). The report never carries a
 * command's output, because it is pasted into public PR bodies.
 */

export type VerifyLine =
  | {
      kind: "command";
      n: number;
      claim: string;
      command: string;
      exit: number;
      prints: string | undefined;
      laptop: boolean;
    }
  | { kind: "inferred"; n: number; claim: string }
  | { kind: "laptop"; n: number; claim: string };

export type Status = "PASS" | "FAIL" | "COULD NOT RUN" | "NOT RUN";

export type LineResult = { n: number; claim: string; status: Status; why: string };

export type ExecResult = {
  /** The exit code, or null when the program never ran or was killed. */
  code: number | null;
  stdout: string;
  stderr: string;
  error?: "ENOENT" | "TIMEOUT" | "OTHER";
};

export type CheckBriefDeps = {
  exec: (
    file: string,
    args: string[],
    opts: { cwd: string; env: NodeJS.ProcessEnv },
  ) => Promise<ExecResult>;
  /** What `env-set` reads, and what each child's minimal env is drawn from.
   *  In the CLI this is `process.env` after `loadCredentialsIntoEnv()`, so a
   *  key held only in `~/.config/reddoor-maint/credentials.env` reads "set". */
  env: NodeJS.ProcessEnv;
  /** Where a relative brief path resolves (the commands run in `--cwd`). */
  processCwd: () => string;
};

const TIMEOUT_MS = 30_000;

// ── Parsing ─────────────────────────────────────────────────────────────────

const SECTION_START = /^\*\*Verify first\.\*\*/;
// The next bold lead-in ("**Start here.**") or a heading ends the section.
const SECTION_END = /^(?:\*\*[A-Z][^*]*\.\*\*|#{1,6} )/;
const FENCE = /^\s*(?:```|~~~)/;
const ITEM_START = /^\s*(?:[-*+]|\d+[.)])\s+/;
// The claim is greedy, so a claim holding its own " — `x` " still ends at the
// last dash before the command.
const LINE_FORM =
  /^(.*)\s+(?:—|--)\s+(``?)(.+?)\2\s*(?:→|->)\s*exit\s+(\d+)(?:\s*,\s*prints\s+(?:"((?:[^"\\]|\\.)*)"|`([^`]*)`))?\s*(\[laptop\])?\s*\.?$/;
const LEAD_TAG = /^\[(I|laptop)\]\s*/;
const TAG_INFERRED = /\[I\]\s*\.?$/;
const TAG_LAPTOP = /\[laptop\]\s*\.?$/;
const LOOKS_RUNNABLE = /`[^`]+`\s*(?:→|->)\s*exit\s+\d+/;
const CONTROL = /^(?:positive\s+)?control\b/i;

const ABSENCE =
  /\b(?:absent|missing|unset|not set|unreachable|not reachable|(?:cannot|can't|could not) be reached|does not exist|doesn't exist|no such|not found|never (?:ran|run|shipped|opened|set|existed)|not shipped|nothing (?:runs|calls|reads|uses)|(?:has|have|holds|carries) no|is gone|was removed)\b/i;

/** Identifier-shaped tokens, by kind. The template never lets these be [I]. */
const IDENTIFIERS: { kind: string; re: RegExp }[] = [
  { kind: "env var", re: /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g },
  { kind: "PR or issue", re: /(?:\b[\w.-]+\/)?(?:[\w.-]+)?#[1-9]\d*\b/g },
  {
    kind: "version",
    re: /\bv\d+(?:\.\d+)*\b|\b\d+\.\d+\.\d+\b|\b[a-z][\w-]*@v?\d+\.\d+\b/gi,
  },
  {
    kind: "host",
    re: /\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|io|dev|app|net|org|co|ai)\b/gi,
  },
];
// In prose "about 2.5" is not a version, so two-part numbers are left out
// above; on an [I] line, where any version is forbidden, they count.
const TWO_PART_VERSION = /\b\d+\.\d+\b/g;

function identifiersIn(text: string): { kind: string; token: string }[] {
  const out: { kind: string; token: string }[] = [];
  for (const { kind, re } of IDENTIFIERS) {
    for (const m of text.matchAll(re)) out.push({ kind, token: m[0] });
  }
  return out;
}

const WORD = /\w/;

/** Whether `text` occurs in `hay` as a whole token: where the text starts or
 *  ends with a word character, the character beyond it must not be one. So
 *  "0" is not found in "10", nor `MANTIS_PRISMIC` in `MANTIS_PRISMIC_X`. */
export function containsToken(hay: string, text: string): boolean {
  if (text === "") return true;
  const first = WORD.test(text[0] as string);
  const last = WORD.test(text[text.length - 1] as string);
  for (let at = hay.indexOf(text); at !== -1; at = hay.indexOf(text, at + 1)) {
    const before = hay[at - 1];
    const after = hay[at + text.length];
    if (first && before !== undefined && WORD.test(before)) continue;
    if (last && after !== undefined && WORD.test(after)) continue;
    return true;
  }
  return false;
}

function unescapeQuoted(s: string): string {
  return s.replace(/\\(.)/g, "$1");
}

/** Read a brief's Verify-first lines and the warnings its other text earns. */
export function parseBrief(md: string): { lines: VerifyLine[]; warnings: string[] } {
  const all = md.split(/\r?\n/);
  const warnings: string[] = [];
  // One entry per physical section line; null marks a break between sections,
  // which also ends the item in progress.
  const sectionLines: (string | null)[] = [];
  const outside: string[] = [];
  let sections = 0;
  let inSection = false;
  let inFence = false;
  let fencedSkipped = false;
  for (const raw of all) {
    if (SECTION_START.test(raw)) {
      sections++;
      inSection = true;
      inFence = false;
      sectionLines.push(null);
      // Text on the lead-in line itself ("**Verify first.** `cmd`") is part of the section.
      sectionLines.push(raw.replace(SECTION_START, ""));
      continue;
    }
    if (inSection && FENCE.test(raw)) {
      inFence = !inFence;
      sectionLines.push("");
      continue;
    }
    if (inSection && inFence) {
      // A heading-shaped comment in a fence must not end the section, and a
      // claim in a fence is not a line: say so rather than drop it quietly.
      if (raw.trim() !== "") fencedSkipped = true;
      continue;
    }
    if (inSection && SECTION_END.test(raw)) inSection = false;
    if (inSection) sectionLines.push(raw);
    else outside.push(raw);
  }
  if (fencedSkipped) {
    warnings.push("a code block in Verify first is not read: put each claim on its own line");
  }

  // Items: a bullet or number starts one, an indented or unbulleted line
  // continues it, a blank line ends it. Prettier wraps long bullets, so a claim
  // often spans lines.
  const items: string[] = [];
  let cur: string | null = null;
  for (const raw of sectionLines) {
    if (raw === null || raw.trim() === "") {
      if (cur !== null) items.push(cur);
      cur = null;
    } else if (ITEM_START.test(raw)) {
      if (cur !== null) items.push(cur);
      cur = raw.replace(ITEM_START, "").trim();
    } else {
      cur = cur === null ? raw.trim() : `${cur} ${raw.trim()}`;
    }
  }
  if (cur !== null) items.push(cur);

  const lines: VerifyLine[] = [];
  for (const rawItem of items) {
    const n = lines.length + 1;
    let item = rawItem;
    let leadTag: string | undefined;
    const lead = LEAD_TAG.exec(item);
    if (lead) {
      leadTag = lead[1];
      item = item.slice(lead[0].length);
    }
    const inferred = leadTag === "I" || TAG_INFERRED.test(item);
    const m = inferred ? null : LINE_FORM.exec(item);
    if (m) {
      const printed = m[5] !== undefined ? unescapeQuoted(m[5]) : m[6];
      lines.push({
        kind: "command",
        n,
        claim: (m[1] ?? "").trim(),
        command: (m[3] ?? "").trim(),
        exit: Number(m[4]),
        prints: printed,
        laptop: m[7] !== undefined || leadTag === "laptop",
      });
    } else if (inferred) {
      const claim = item.replace(TAG_INFERRED, "").trim();
      lines.push({ kind: "inferred", n, claim });
      if (LOOKS_RUNNABLE.test(claim)) {
        warnings.push(`line ${n} has a command but is tagged [I], so it was not run`);
      }
    } else if (leadTag === "laptop" || TAG_LAPTOP.test(item)) {
      lines.push({ kind: "laptop", n, claim: item.replace(TAG_LAPTOP, "").trim() });
    } else {
      warnings.push(`Verify-first text not in check-brief form: "${clip(rawItem)}"`);
    }
  }

  if (sections === 0) warnings.push("the brief has no **Verify first.** section");
  if (sections > 1) warnings.push(`the brief has ${sections} Verify-first sections; all are read`);
  if (lines.length === 0) warnings.push("no Verify-first line is in check-brief form");

  for (const [i, line] of lines.entries()) {
    if (ABSENCE.test(line.claim)) {
      const next = lines[i + 1];
      if (!next || !CONTROL.test(next.claim)) {
        warnings.push(`line ${line.n} is an absence claim with no positive control under it`);
      }
    }
    if (line.kind === "inferred") {
      const ids = [
        ...identifiersIn(line.claim).map((x) => x.token),
        ...[...line.claim.matchAll(TWO_PART_VERSION)].map((x) => x[0]),
      ];
      if (ids.length > 0) {
        warnings.push(
          `line ${line.n} is [I] but names an identifier (${[...new Set(ids)].join(", ")}); identifiers need a command`,
        );
      }
    }
  }

  const section = sectionLines.filter((l) => l !== null).join("\n");
  const prose = outside.join("\n").replace(/<!--[\s\S]*?-->/g, "");

  const uncovered = new Map<string, Set<string>>();
  for (const { kind, token } of identifiersIn(prose)) {
    if (containsToken(section, token)) continue;
    const set = uncovered.get(kind) ?? new Set<string>();
    set.add(token);
    uncovered.set(kind, set);
  }
  for (const [kind, set] of uncovered) {
    const tokens = [...set];
    const shown = tokens.slice(0, 12).join(", ");
    const more = tokens.length > 12 ? ` (+${tokens.length - 12} more)` : "";
    warnings.push(`${kind} named outside Verify first, no line covers it: ${shown}${more}`);
  }

  // An absence sentence is covered when every identifier or code span in it
  // appears in the Verify-first section; a sentence with neither is never covered.
  for (const sentence of prose.replace(/\s*\n\s*/g, " ").split(/(?<=[.!?])\s+/)) {
    if (!ABSENCE.test(sentence)) continue;
    const named = [
      ...identifiersIn(sentence).map((x) => x.token),
      ...[...sentence.matchAll(/`([^`]+)`/g)].map((x) => x[1] ?? ""),
    ].filter(Boolean);
    if (named.length > 0 && named.every((t) => containsToken(section, t))) continue;
    warnings.push(`absence phrase not covered by a Verify-first line: "${clip(sentence)}"`);
  }

  return { lines, warnings };
}

function clip(s: string, max = 80): string {
  const t = s.trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

// ── The allowlist ───────────────────────────────────────────────────────────

/** Split a command the way a shell would split plain words and quotes, but
 *  refuse everything a shell would *do*: pipes, lists, redirects, expansions,
 *  globs. No shell runs it, so a line that needs one is refused rather than
 *  run with a meaning its writer did not intend. */
export function tokenize(
  cmd: string,
): { ok: true; argv: string[] } | { ok: false; reason: string } {
  const argv: string[] = [];
  let word: string | null = null;
  let i = 0;
  while (i < cmd.length) {
    const c = cmd[i] as string;
    if (c === " " || c === "\t") {
      if (word !== null) argv.push(word);
      word = null;
      i++;
    } else if (c === "'") {
      const close = cmd.indexOf("'", i + 1);
      if (close === -1) return { ok: false, reason: "unclosed quote" };
      word = (word ?? "") + cmd.slice(i + 1, close);
      i = close + 1;
    } else if (c === '"') {
      let j = i + 1;
      let buf = "";
      for (; j < cmd.length && cmd[j] !== '"'; j++) {
        const d = cmd[j] as string;
        if (d === "$" || d === "`") return { ok: false, reason: `needs a shell (${d})` };
        if (d === "\\" && j + 1 < cmd.length) buf += cmd[++j];
        else buf += d;
      }
      if (j >= cmd.length) return { ok: false, reason: "unclosed quote" };
      word = (word ?? "") + buf;
      i = j + 1;
    } else if ("|&;<>()`$*~\\".includes(c)) {
      return { ok: false, reason: `needs a shell (${c})` };
    } else {
      word = (word ?? "") + c;
      i++;
    }
  }
  if (word !== null) argv.push(word);
  if (argv.length === 0) return { ok: false, reason: "empty command" };
  return { ok: true, argv };
}

/** Whether the flags after a `gh api` path leave it a plain GET. The same
 *  allowlist as `scripts/land-prs.mjs`'s `isReadOnlyApiCall` (nothing but
 *  `--jq <expr>`, so `-X`, `--method`, `-f`, `-F` and `--input` all refuse),
 *  copied because `scripts/` is not in the published package; a test pins the
 *  two to the same answers. */
export function isReadOnlyApiCall(args: string[]): boolean {
  for (let i = 0; i < args.length; i += 2) {
    if (args[i] !== "--jq" || i + 1 >= args.length) return false;
  }
  return true;
}

/** Whether `arg` names one of `longs` or a prefix of it (GNU tools and git both
 *  take an unambiguous prefix: `--outp` is `--output`), or carries one of
 *  `shorts` anywhere in a bundle of short flags (`-iO` holds `-O`). */
function namesOption(arg: string, longs: string[], shorts = ""): boolean {
  if (arg.startsWith("--")) {
    const name = arg.split("=")[0] as string;
    return name.length >= 3 && longs.some((l) => l.startsWith(name));
  }
  if (arg.startsWith("-") && arg.length > 1) {
    return [...arg.slice(1)].some((ch) => shorts.includes(ch));
  }
  return false;
}

const GIT_READ = new Set([
  "log",
  "show",
  "grep",
  "ls-files",
  "ls-tree",
  "rev-parse",
  "cat-file",
  "diff",
  "status",
  "for-each-ref",
  "merge-base",
  "describe",
  "blame",
]);
// Options that make a read-only git subcommand write a file, run a program, or
// reach out with a program of the caller's choosing.
const GIT_DANGEROUS = [
  "--output",
  "--open-files-in-pager",
  "--ext-diff",
  "--textconv",
  "--upload-pack",
  "--exec",
];
// Prepended to every git run: no index refresh under a lock (another session
// may share the worktree), and no config-driven program (fsmonitor hook,
// pager, external diff).
const GIT_GLOBALS = [
  "--no-optional-locks",
  "-c",
  "core.fsmonitor=false",
  "-c",
  "core.pager=cat",
  "-c",
  "diff.external=",
];
// textconv drivers are named in .gitattributes and run from config.
const GIT_NO_TEXTCONV = new Set(["log", "show", "diff", "grep", "blame"]);
const READ_ONLY_FILES = new Set(["ls", "cat", "head", "tail", "wc", "grep", "test"]);
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
// A brief's line could otherwise test one guessed prefix at a time against a
// secret through `prints`: PASS or FAIL is a bit, and the report is public.
const SENSITIVE_PATH =
  /^\/(?:proc|dev|sys)(?:\/|$)|(?:^|[/:])(?:\.env(?:\.[^/]*)?|[^/]*credentials[^/]*|[^/]*secret[^/]*|\.netrc|\.npmrc|\.git-credentials|id_[a-z0-9]+|[^/]*\.pem|[^/]*\.key)$/i;

export type Classified =
  { ok: true; argv: string[]; builtin?: "env-set" } | { ok: false; reason: string };

/** Decide whether a Verify-first command may run, and with what argv. An
 *  allowlist: a form nobody listed is refused, however harmless it looks. */
export function classifyCommand(cmd: string): Classified {
  const t = tokenize(cmd);
  if (!t.ok) return t;
  const argv = t.argv;
  const [bin, sub, ...rest] = argv;
  const refuse = (reason: string): Classified => ({ ok: false, reason });

  if (bin === "env-set") {
    if (argv.length !== 2 || !ENV_NAME.test(sub ?? ""))
      return refuse("env-set takes one variable name");
    return { ok: true, argv, builtin: "env-set" };
  }
  if (bin === "gh") {
    if (sub !== "api") return refuse("gh: only `gh api` is allowed");
    const [path, ...flags] = rest;
    if (!path || path.startsWith("-")) return refuse("gh api: the path comes first");
    if (!isReadOnlyApiCall(flags)) return refuse("gh api: only `--jq <expr>` may follow the path");
    return { ok: true, argv };
  }
  // Only path-shaped arguments: a grep pattern such as 'secret scanning' is not a path.
  const pathy = (a: string) => /[/.]/.test(a);
  if (argv.slice(1).some((a) => pathy(a) && SENSITIVE_PATH.test(a.split("=").pop() as string))) {
    return refuse("a path that may hold a secret");
  }
  if (bin === "git") {
    if (!sub || !GIT_READ.has(sub)) return refuse(`git ${sub ?? ""}: not a read-only subcommand`);
    const shorts = sub === "grep" ? "O" : "";
    if (rest.some((a) => namesOption(a, GIT_DANGEROUS, shorts))) {
      return refuse("git: an option that writes or runs a program");
    }
    const extra = GIT_NO_TEXTCONV.has(sub) ? ["--no-textconv"] : [];
    if (sub === "log" || sub === "show" || sub === "diff") extra.push("--no-ext-diff");
    return { ok: true, argv: ["git", ...GIT_GLOBALS, sub, ...extra, ...rest] };
  }
  if (bin === "sed") {
    // Exactly `sed -n <a>[,<b>]p <file>…`: GNU sed reads options after the
    // script too, and -i edits in place, w writes, e executes.
    const [range, ...files] = rest;
    if (
      sub !== "-n" ||
      !/^(?:\d+|\$)(?:,(?:\d+|\$))?p$/.test(range ?? "") ||
      files.length === 0 ||
      files.some((f) => f.startsWith("-"))
    ) {
      return refuse("sed: only `sed -n <a>[,<b>]p <file>`");
    }
    return { ok: true, argv };
  }
  if (bin === "rg") {
    if (argv.slice(1).some((a) => namesOption(a, ["--pre", "--pre-glob", "--search-zip"], "z"))) {
      return refuse("rg: an option that runs a program");
    }
    return { ok: true, argv };
  }
  if (bin === "tail" && argv.slice(1).some((a) => namesOption(a, ["--follow", "--retry"], "fF"))) {
    return refuse("tail: follow never ends");
  }
  if (bin === "wc" && argv.slice(1).some((a) => namesOption(a, ["--files0-from"]))) {
    return refuse("wc: --files0-from reads a list of paths");
  }
  if (bin && READ_ONLY_FILES.has(bin)) return { ok: true, argv };
  if (
    (bin === "node" || bin === "pnpm" || bin === "npm") &&
    argv.length === 2 &&
    sub === "--version"
  ) {
    return { ok: true, argv };
  }
  if (bin === "npm" && sub === "view") return { ok: true, argv };
  return refuse(`${bin}: not an allowed read-only form`);
}

/** The built-in `env-set NAME`: whether a variable holds a non-blank value.
 *  It prints `set` or `unset`, never the value. */
export function envSet(name: string, env: NodeJS.ProcessEnv): { code: number; stdout: string } {
  return env[name]?.trim() ? { code: 0, stdout: "set" } : { code: 1, stdout: "unset" };
}

const BASE_ENV = [
  "PATH",
  "HOME",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TERM",
  "TMPDIR",
  "HTTPS_PROXY",
  "HTTP_PROXY",
  "NO_PROXY",
  "https_proxy",
  "http_proxy",
  "no_proxy",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "NODE_EXTRA_CA_CERTS",
  "GIT_SSL_CAINFO",
];
const GH_ENV = ["GH_TOKEN", "GITHUB_TOKEN", "GH_HOST", "GH_CONFIG_DIR", "XDG_CONFIG_HOME"];

/** The environment a child gets: enough to find programs and reach the
 *  network, plus gh's own token for gh. No other variable, so no line can read
 *  a secret out of its own environment. */
export function childEnv(bin: string, env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const k of bin === "gh" ? [...BASE_ENV, ...GH_ENV] : BASE_ENV) {
    if (env[k] !== undefined) out[k] = env[k];
  }
  return out;
}

// ── Running ─────────────────────────────────────────────────────────────────

/** An HTTP refusal or a failure to reach the host: the command was allowed, and
 *  the environment stopped it before it could answer. A 404 is an answer. */
export function refusedBy(stderr: string): string | null {
  const code = "(401|403|407|429|5\\d\\d)";
  const http = new RegExp(
    `\\bHTTP ${code}\\b|\\bE${code}\\b|\\b${code} (?:Unauthorized|Forbidden|Proxy Authentication Required|Too Many Requests|Internal Server Error|Bad Gateway|Service Unavailable|Gateway Timeout)\\b`,
  ).exec(stderr);
  if (http) return `refused (HTTP ${http[1] ?? http[2] ?? http[3]})`;
  if (
    /Could not resolve host|unable to access|connection reset by peer|TLS handshake timeout|i\/o timeout|Connection refused|\bE(?:CONNREFUSED|NOTFOUND|AI_AGAIN|TIMEDOUT|CONNRESET|HOSTUNREACH|NETUNREACH)\b/i.test(
      stderr,
    )
  ) {
    return "could not reach the host";
  }
  return null;
}

/** Map `execFile`'s callback arguments to an {@link ExecResult}. */
export function execResultFrom(err: unknown, stdout: string, stderr: string): ExecResult {
  if (!err) return { code: 0, stdout, stderr };
  const e = err as { code?: unknown; killed?: boolean };
  if (e.code === "ENOENT") return { code: null, stdout, stderr, error: "ENOENT" };
  if (e.killed) return { code: null, stdout, stderr, error: "TIMEOUT" };
  if (typeof e.code === "number") return { code: e.code, stdout, stderr };
  return { code: null, stdout, stderr, error: "OTHER" };
}

const defaultExec: CheckBriefDeps["exec"] = (file, args, opts) =>
  new Promise((done) => {
    const child = execFile(
      file,
      args,
      {
        cwd: opts.cwd,
        env: opts.env,
        timeout: TIMEOUT_MS,
        maxBuffer: 16 * 1024 * 1024,
        encoding: "utf8",
      },
      (err, stdout, stderr) => done(execResultFrom(err, stdout, stderr)),
    );
    // Nothing reads from the terminal: `cat /dev/stdin` or a prompt ends at once.
    child.stdin?.end();
  });

async function runLine(line: VerifyLine, cwd: string, deps: CheckBriefDeps): Promise<LineResult> {
  const base = { n: line.n, claim: line.claim };
  if (line.kind === "inferred")
    return { ...base, status: "NOT RUN", why: "[I]: an inference, nothing to run" };
  if (line.kind === "laptop" || line.laptop) {
    return { ...base, status: "NOT RUN", why: "[laptop]: runs only on the laptop" };
  }
  const c = classifyCommand(line.command);
  if (!c.ok) return { ...base, status: "NOT RUN", why: c.reason };

  let result: ExecResult;
  if (c.builtin === "env-set") {
    result = { ...envSet(c.argv[1] as string, deps.env), stderr: "" };
  } else {
    const [file, ...args] = c.argv as [string, ...string[]];
    result = await deps.exec(file, args, { cwd, env: childEnv(file, deps.env) });
    if (result.error === "ENOENT")
      return { ...base, status: "COULD NOT RUN", why: `${file} is not installed` };
    if (result.error === "TIMEOUT") {
      return { ...base, status: "COULD NOT RUN", why: `timed out after ${TIMEOUT_MS / 1000} s` };
    }
    if (result.code === null)
      return { ...base, status: "COULD NOT RUN", why: `${file} did not run` };
    const refused = result.code !== 0 ? refusedBy(result.stderr) : null;
    if (refused) return { ...base, status: "COULD NOT RUN", why: `${file} ${refused}` };
  }

  if (result.code !== line.exit) {
    return { ...base, status: "FAIL", why: `exit ${result.code}, expected ${line.exit}` };
  }
  if (line.prints !== undefined && !containsToken(result.stdout, line.prints)) {
    return {
      ...base,
      status: "FAIL",
      why: `exit ${line.exit}, but the expected text was not printed`,
    };
  }
  return {
    ...base,
    status: "PASS",
    why: line.prints !== undefined ? `exit ${line.exit}, text printed` : `exit ${line.exit}`,
  };
}

function cell(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/\s+/g, " ");
}

/** Check a brief. The brief path resolves against the process's cwd; the
 *  commands run in `opts.cwd`. Exit 1 when any line FAILs, 2 on a usage error. */
export async function runCheckBrief(
  briefPath: string | undefined,
  opts: { cwd?: string | undefined },
  deps: Partial<CheckBriefDeps> = {},
): Promise<{ output: string; code: number; results: LineResult[]; warnings: string[] }> {
  if (!briefPath) {
    return {
      output: "usage: reddoor-maint check-brief <brief.md> [--cwd <dir>]",
      code: 2,
      results: [],
      warnings: [],
    };
  }
  const full: CheckBriefDeps = {
    exec: deps.exec ?? defaultExec,
    env: deps.env ?? process.env,
    processCwd: deps.processCwd ?? (() => process.cwd()),
  };
  let md: string;
  try {
    md = await readFile(resolve(full.processCwd(), briefPath), "utf8");
  } catch {
    return { output: `check-brief: cannot read ${briefPath}`, code: 2, results: [], warnings: [] };
  }
  const cwd = resolve(full.processCwd(), opts.cwd ?? ".");
  const { lines, warnings } = parseBrief(md);

  const results: LineResult[] = [];
  // Serially: lines can share a rate-limited host, and order reads naturally.
  for (const line of lines) results.push(await runLine(line, cwd, full));

  // An absence that passed is only as good as its control: a control that did
  // not pass shows nothing about whether the command could have said yes.
  for (const [i, line] of lines.entries()) {
    const r = results[i];
    const next = lines[i + 1];
    const control = results[i + 1];
    if (!r || r.status !== "PASS" || !ABSENCE.test(line.claim)) continue;
    if (next && control && CONTROL.test(next.claim) && control.status !== "PASS") {
      results[i] = {
        ...r,
        status: "COULD NOT RUN",
        why: `${r.why}, but its control (line ${next.n}) did not pass`,
      };
    }
  }

  const count = (s: Status) => results.filter((r) => r.status === s).length;
  const out: string[] = [`check-brief: ${briefPath}`, ""];
  if (results.length > 0) {
    out.push("| # | Status | Claim | Why |", "| - | ------ | ----- | --- |");
    for (const r of results)
      out.push(`| ${r.n} | ${r.status} | ${cell(r.claim)} | ${cell(r.why)} |`);
    out.push("");
  }
  out.push(
    `${count("PASS")} PASS, ${count("FAIL")} FAIL, ${count("COULD NOT RUN")} COULD NOT RUN, ${count("NOT RUN")} NOT RUN.`,
  );
  if (warnings.length > 0) {
    out.push("", "Warnings:", ...warnings.map((w) => `- ${w}`));
  }
  return { output: out.join("\n"), code: count("FAIL") > 0 ? 1 : 0, results, warnings };
}
