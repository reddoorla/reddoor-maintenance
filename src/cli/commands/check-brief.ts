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
 * "Control:", the positive control that shows the same command can say yes.
 *
 * Only an allowlist of read-only command forms runs, through `execFile` with no
 * shell. Each line gets PASS, FAIL, COULD NOT RUN (allowed, but the
 * environment stopped it: a missing binary, a timeout, an HTTP refusal) or NOT
 * RUN (an [I] or [laptop] line, or a command off the allowlist). The report
 * never carries a command's output, because it is pasted into public PR bodies.
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
  exec: (file: string, args: string[], opts: { cwd: string }) => Promise<ExecResult>;
  env: NodeJS.ProcessEnv;
};

const TIMEOUT_MS = 30_000;

// ── Parsing ─────────────────────────────────────────────────────────────────

const SECTION_START = /^\*\*Verify first\.\*\*/;
// The next bold lead-in ("**Start here.**") or a heading ends the section.
const SECTION_END = /^(?:\*\*[A-Z][^*]*\.\*\*|#{1,6} )/;
const ITEM_START = /^\s*[-*] /;
const LINE_FORM =
  /^(.*?)\s+(?:—|--)\s+(``?)(.+?)\2\s*(?:→|->)\s*exit\s+(\d+)(?:\s*,\s*prints\s+(?:"((?:[^"\\]|\\.)*)"|`([^`]*)`))?\s*(\[laptop\])?\s*\.?$/;
const TAG_INFERRED = /\[I\]\s*\.?$/;
const TAG_LAPTOP = /\[laptop\]\s*\.?$/;
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

function identifiersIn(text: string): { kind: string; token: string }[] {
  const out: { kind: string; token: string }[] = [];
  for (const { kind, re } of IDENTIFIERS) {
    for (const m of text.matchAll(re)) out.push({ kind, token: m[0] });
  }
  return out;
}

function unescapeQuoted(s: string): string {
  return s.replace(/\\(.)/g, "$1");
}

/** Read a brief's Verify-first lines and the warnings its other text earns. */
export function parseBrief(md: string): { lines: VerifyLine[]; warnings: string[] } {
  const all = md.split(/\r?\n/);
  const start = all.findIndex((l) => SECTION_START.test(l));
  const warnings: string[] = [];
  const sectionLines: string[] = [];
  const outside: string[] = [];
  if (start === -1) {
    outside.push(...all);
  } else {
    let end = all.length;
    for (let i = start + 1; i < all.length; i++) {
      if (SECTION_END.test(all[i] ?? "")) {
        end = i;
        break;
      }
    }
    // Text on the lead-in line itself ("**Verify first.** `cmd`") is part of the section.
    sectionLines.push((all[start] ?? "").replace(SECTION_START, ""), ...all.slice(start + 1, end));
    outside.push(...all.slice(0, start), ...all.slice(end));
  }

  // Items: a bullet starts one, an indented or unbulleted line continues it, a
  // blank line ends it. Prettier wraps long bullets, so a claim often spans lines.
  const items: string[] = [];
  let cur: string | null = null;
  for (const raw of sectionLines) {
    if (raw.trim() === "") {
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
  for (const item of items) {
    const n = lines.length + 1;
    const m = LINE_FORM.exec(item);
    if (m) {
      const printed = m[5] !== undefined ? unescapeQuoted(m[5]) : m[6];
      lines.push({
        kind: "command",
        n,
        claim: (m[1] ?? "").trim(),
        command: (m[3] ?? "").trim(),
        exit: Number(m[4]),
        prints: printed,
        laptop: m[7] !== undefined,
      });
    } else if (TAG_INFERRED.test(item)) {
      lines.push({ kind: "inferred", n, claim: item.replace(TAG_INFERRED, "").trim() });
    } else if (TAG_LAPTOP.test(item)) {
      lines.push({ kind: "laptop", n, claim: item.replace(TAG_LAPTOP, "").trim() });
    } else {
      warnings.push(`Verify-first text not in check-brief form: "${clip(item)}"`);
    }
  }

  if (start === -1) warnings.push("the brief has no **Verify first.** section");
  if (lines.length === 0) warnings.push("no Verify-first line is in check-brief form");

  for (const [i, line] of lines.entries()) {
    if (ABSENCE.test(line.claim)) {
      const next = lines[i + 1];
      if (!next || !CONTROL.test(next.claim)) {
        warnings.push(`line ${line.n} is an absence claim with no positive control under it`);
      }
    }
    if (line.kind === "inferred") {
      const ids = identifiersIn(line.claim);
      if (ids.length > 0) {
        warnings.push(
          `line ${line.n} is [I] but names an identifier (${ids.map((x) => x.token).join(", ")}); identifiers need a command`,
        );
      }
    }
  }

  const section = sectionLines.join("\n");
  const prose = outside.join("\n").replace(/<!--[\s\S]*?-->/g, "");

  const uncovered = new Map<string, Set<string>>();
  for (const { kind, token } of identifiersIn(prose)) {
    if (section.includes(token)) continue;
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
    if (named.length > 0 && named.every((t) => section.includes(t))) continue;
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

const GIT_READ = new Set([
  "log",
  "show",
  "grep",
  "ls-files",
  "ls-tree",
  "ls-remote",
  "rev-parse",
  "cat-file",
  "diff",
  "status",
  "for-each-ref",
  "merge-base",
  "describe",
  "blame",
]);
// Flags that make a read-only git subcommand write a file or run a program.
const GIT_WRITES = /^(?:--output|-O|--open-files-in-pager|--ext-diff)/;
const READ_ONLY_FILES = new Set(["ls", "cat", "head", "tail", "wc", "grep", "test"]);
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

export type Classified =
  { ok: true; argv: string[]; builtin?: "env-set" } | { ok: false; reason: string };

/** Decide whether a Verify-first command may run. An allowlist: a form nobody
 *  listed is refused, however harmless it looks. */
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
  if (bin === "git") {
    if (!sub || !GIT_READ.has(sub)) return refuse(`git ${sub ?? ""}: not a read-only subcommand`);
    if (rest.some((a) => GIT_WRITES.test(a))) return refuse("git: a flag that writes or runs");
    return { ok: true, argv };
  }
  if (bin === "sed") {
    // Only `sed -n <line>[,<line>]p <file>…`: -i edits in place, w writes, e executes.
    if (sub !== "-n" || !/^(?:\d+|\$)(?:,(?:\d+|\$))?p$/.test(rest[0] ?? "") || rest.length < 2) {
      return refuse("sed: only `sed -n <a>[,<b>]p <file>`");
    }
    return { ok: true, argv };
  }
  if (bin === "rg") {
    if (argv.some((a) => /^(?:--pre|-z$|--search-zip)/.test(a)))
      return refuse("rg: a flag that runs a program");
    return { ok: true, argv };
  }
  if (bin === "tail" && argv.some((a) => /^(?:-f|-F|--follow)/.test(a))) {
    return refuse("tail: follow never ends");
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

// ── Running ─────────────────────────────────────────────────────────────────

/** An HTTP refusal or a failure to reach the host: the command was allowed, and
 *  the environment stopped it before it could answer. A 404 is an answer. */
function refusedBy(stderr: string): string | null {
  const http = /\(HTTP (401|403|407|429|5\d\d)\)|\bHTTP (401|403|407|429|5\d\d)\b/.exec(stderr);
  if (http) return `refused (HTTP ${http[1] ?? http[2]})`;
  if (
    /Could not resolve host|unable to access|connection reset by peer|TLS handshake timeout|i\/o timeout|Connection refused/i.test(
      stderr,
    )
  ) {
    return "could not reach the host";
  }
  return null;
}

const defaultExec: CheckBriefDeps["exec"] = (file, args, opts) =>
  new Promise((done) => {
    execFile(
      file,
      args,
      { cwd: opts.cwd, timeout: TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024, encoding: "utf8" },
      (err, stdout, stderr) => {
        if (!err) return done({ code: 0, stdout, stderr });
        const e = err as NodeJS.ErrnoException & { killed?: boolean; code?: unknown };
        if (e.code === "ENOENT") return done({ code: null, stdout, stderr, error: "ENOENT" });
        if (e.killed) return done({ code: null, stdout, stderr, error: "TIMEOUT" });
        if (typeof e.code === "number") return done({ code: e.code, stdout, stderr });
        return done({ code: null, stdout, stderr, error: "OTHER" });
      },
    );
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
    const [file, ...args] = c.argv;
    result = await deps.exec(file as string, args, { cwd });
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
  if (line.prints !== undefined && !result.stdout.includes(line.prints)) {
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
  let md: string;
  try {
    md = await readFile(resolve(briefPath), "utf8");
  } catch {
    return { output: `check-brief: cannot read ${briefPath}`, code: 2, results: [], warnings: [] };
  }
  const full: CheckBriefDeps = { exec: deps.exec ?? defaultExec, env: deps.env ?? process.env };
  const cwd = resolve(opts.cwd ?? process.cwd());
  const { lines, warnings } = parseBrief(md);

  const results: LineResult[] = [];
  // Serially: lines can share a rate-limited host, and order reads naturally.
  for (const line of lines) results.push(await runLine(line, cwd, full));

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
